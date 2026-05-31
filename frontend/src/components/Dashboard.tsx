import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { stockApi, gmApi } from "../api";
import { StockReport, GMDashboard, GMAlert } from "../types";
import { formatCurrency } from "../utils/stock";
import { LowStockAlerts } from "./LowStockAlerts";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { PageSpinner, Spinner } from "./shared/Spinner";
import { useStockSocket } from "../hooks/useStockSocket";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  const str = String(value);
  const valCls =
    str.length > 9
      ? "text-[16px] sm:text-[22px] lg:text-[28px]"
      : str.length > 6
      ? "text-[20px] sm:text-[26px] lg:text-[28px]"
      : "text-[28px]";

  return (
    <div className="bg-[#0a0a0a] rounded-[8px] px-4 sm:px-6 py-5 border border-[#1a1a1a] min-w-0">
      <p className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] truncate">{label}</p>
      <p className={`mt-2 font-semibold text-white tracking-tight leading-none truncate ${valCls}`}>{value}</p>
      {sub && <p className="mt-2 text-xs text-[#555] truncate">{sub}</p>}
    </div>
  );
}

// ── Sparkline SVG chart ───────────────────────────────────────────────────────
// Receives already-sliced daily points — no internal grouping.

function Sparkline({ points }: { points: { date: string; total: number }[] }) {
  if (points.length < 2) return null;

  const W        = 600;
  const H        = 160;
  const PADX     = 80;   // wider right margin so axis labels don't overlap dots
  const PADY_T   = 24;
  const PADY_B   = 32;
  const EDGE_THR = 80;   // px from right edge — flip label anchor when dot is this close

  const vals  = points.map((p) => p.total);
  const minV  = Math.min(...vals);
  const maxV  = Math.max(...vals);
  const range = maxV - minV || 1;
  const avg   = vals.reduce((s, v) => s + v, 0) / vals.length;

  const x = (i: number) => PADX + (i / (points.length - 1)) * (W - PADX * 2);
  const y = (v: number) => PADY_T + ((maxV - v) / range) * (H - PADY_T - PADY_B);

  const d       = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const highIdx = vals.indexOf(maxV);
  const lowIdx  = vals.indexOf(minV);
  const avgY    = y(avg);

  // Dot positions
  const highX = x(highIdx);
  const highY = y(maxV);
  const lowX  = x(lowIdx);
  const lowY  = y(minV);

  // Right-side axis label positions
  const maxLabelY = PADY_T - 6;
  const minLabelY = H - PADY_B + 12;

  // Flip dot label anchor if dot is near the right edge
  const highNearRight = highX > W - EDGE_THR;
  const lowNearRight  = lowX  > W - EDGE_THR;

  // Vertical collision: if high dot label (highY - 7) and max axis label are within 20px, offset
  const highDotLabelY   = highY - 7;
  const highLabelOffset = Math.abs(highDotLabelY - maxLabelY) < 20 ? 14 : 0;

  // Adaptive date labels
  const step        = points.length <= 7 ? 1 : points.length <= 35 ? 7 : 15;
  const dateIndices = points
    .map((_, i) => i)
    .filter((i) => i % step === 0 || i === points.length - 1);

  function shortDate(iso: string): string {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
        {/* Average dashed line */}
        <line x1={PADX} y1={avgY.toFixed(1)} x2={W - PADX} y2={avgY.toFixed(1)}
          stroke="#333" strokeWidth="1" strokeDasharray="4 4" />
        <text x={PADX} y={(avgY - 3).toFixed(1)} fill="#444" fontSize="10">avg</text>

        {/* Main line */}
        <path d={d} fill="none" stroke="#3dbf8a" strokeWidth="2" strokeLinejoin="round" />

        {/* High dot + label — flip anchor near right edge; offset if too close to max label */}
        <circle cx={highX.toFixed(1)} cy={highY.toFixed(1)} r="4" fill="#3dbf8a" />
        <text
          x={highX.toFixed(1)}
          y={(highDotLabelY - highLabelOffset).toFixed(1)}
          fill="#3dbf8a" fontSize="10"
          textAnchor={highNearRight ? "end" : "middle"}
        >
          {formatCurrency(maxV)}
        </text>

        {/* Low dot + label — flip anchor near right edge */}
        <circle cx={lowX.toFixed(1)} cy={lowY.toFixed(1)} r="4" fill="#ef4444" />
        <text
          x={lowX.toFixed(1)}
          y={(lowY + 15).toFixed(1)}
          fill="#ef4444" fontSize="10"
          textAnchor={lowNearRight ? "end" : "middle"}
        >
          {formatCurrency(minV)}
        </text>

        {/* Max axis label — top-right, inside chart area */}
        <text x={(W - PADX + 6).toFixed(1)} y={maxLabelY} fill="#555" fontSize="10" textAnchor="start">
          {formatCurrency(maxV)}
        </text>

        {/* Min axis label — bottom-right, inside chart area */}
        <text x={(W - PADX + 6).toFixed(1)} y={minLabelY} fill="#555" fontSize="10" textAnchor="start">
          {formatCurrency(minV)}
        </text>

        {/* Date labels */}
        {dateIndices.map((i) => (
          <text key={i} x={x(i).toFixed(1)} y={H - 8} fill="#555" fontSize="10"
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
            {shortDate(points[i].date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── Single bar row ────────────────────────────────────────────────────────────

function BarRow({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-[#888]">{label}</span>
        <span className="text-white">{formatCurrency(amount)}</span>
      </div>
      <div className="h-2 rounded-full bg-[#1a1a1a] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ── Alert banner ──────────────────────────────────────────────────────────────

function AlertBanner({ alerts, lang }: { alerts: GMAlert[]; lang: string }) {
  if (alerts.length === 0) return null;
  return (
    <div className="rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] p-4 space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${a.severity === "critical" ? "bg-[#ef4444]" : "bg-[#f59e0b]"}`} />
          <p className={`text-[13px] ${a.severity === "critical" ? "text-[#ef4444]" : "text-[#f59e0b]"}`}>
            {lang === "es" ? a.messagEs : a.message}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Metric value color ────────────────────────────────────────────────────────

function laborColor(pct: number) {
  if (pct > 45) return "text-[#ef4444]";
  if (pct > 35) return "text-[#f59e0b]";
  return "text-[#3dbf8a]";
}

function primeColor(pct: number) {
  if (pct > 75) return "text-[#ef4444]";
  if (pct > 65) return "text-[#f59e0b]";
  return "text-[#3dbf8a]";
}

// ── Colored stat card ─────────────────────────────────────────────────────────

function ColorStatCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="bg-[#0a0a0a] rounded-[8px] px-4 sm:px-6 py-5 border border-[#1a1a1a] min-w-0">
      <p className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] truncate">{label}</p>
      <p className={`mt-2 text-[24px] font-semibold tracking-tight leading-none truncate ${valueColor ?? "text-white"}`}>{value}</p>
    </div>
  );
}

// ── Period metric helpers ─────────────────────────────────────────────────────

type Period = "daily" | "weekly" | "monthly";

function periodDays(period: Period) {
  return period === "daily" ? 7 : period === "weekly" ? 30 : 90;
}

function deriveTrend(slice: { date: string; total: number }[]): "up" | "down" | "flat" {
  const last7  = slice.slice(-7).reduce((s, d) => s + d.total, 0);
  const prior7 = slice.slice(-14, -7).reduce((s, d) => s + d.total, 0);
  if (prior7 === 0) return "flat";
  if (last7 > prior7 * 1.01) return "up";
  if (last7 < prior7 * 0.99) return "down";
  return "flat";
}

function deriveAlerts(
  laborPct:     number,
  primeCostPct: number,
  trend:        "up" | "down" | "flat",
  slice:        { date: string; total: number }[],
  name:         string
): GMAlert[] {
  const alerts: GMAlert[] = [];
  if (laborPct > 45)
    alerts.push({ type: "HIGH_LABOR", severity: "critical",  locationName: name, message: `Labor cost is critically high at ${laborPct.toFixed(1)}%`, messagEs: `El costo de labor está en nivel crítico: ${laborPct.toFixed(1)}%` });
  else if (laborPct > 35)
    alerts.push({ type: "HIGH_LABOR", severity: "warning",   locationName: name, message: "Labor cost is above 35% — review scheduling",             messagEs: "El costo de labor supera el 35% — revisa los horarios" });
  if (primeCostPct > 75)
    alerts.push({ type: "HIGH_PRIME_COST", severity: "critical", locationName: name, message: `Prime cost is critically high at ${primeCostPct.toFixed(1)}%`, messagEs: `El costo primo está en nivel crítico: ${primeCostPct.toFixed(1)}%` });
  else if (primeCostPct > 65)
    alerts.push({ type: "HIGH_PRIME_COST", severity: "warning",  locationName: name, message: "Prime cost above 65% — review food and labor spend",         messagEs: "El costo primo supera el 65% — revisa gastos de comida y labor" });
  if (trend === "down") {
    const last7  = slice.slice(-7).reduce((s, d) => s + d.total, 0);
    const prior7 = slice.slice(-14, -7).reduce((s, d) => s + d.total, 0);
    if (prior7 > 0) {
      const drop = ((prior7 - last7) / prior7) * 100;
      if (drop > 20)
        alerts.push({ type: "SALES_DROP", severity: "critical", locationName: name, message: "Sales dropped more than 20% vs prior week — immediate attention needed", messagEs: "Las ventas bajaron más del 20% vs la semana anterior — atención inmediata" });
      else if (drop > 10)
        alerts.push({ type: "SALES_DROP", severity: "warning",  locationName: name, message: "Sales dropped more than 10% vs prior week",                             messagEs: "Las ventas bajaron más del 10% vs la semana anterior" });
    }
  }
  return alerts;
}

function computeMetrics(period: Period, gmData: GMDashboard) {
  const r2    = (v: number) => Math.round(v * 100) / 100;
  const all   = gmData.sales.dailyTotals;
  const N     = periodDays(period);
  const slice = all.slice(-N);

  if (period === "weekly") {
    // Weekly is the native 30-day window — use API values directly (most accurate)
    const { sales, labor, primeCost, restaurant } = gmData;
    const trend  = deriveTrend(slice);
    return {
      salesTotal:   sales.total,
      byCategory:   { ...sales.byCategory } as Record<string, number>,
      laborTotal:   labor.total,
      laborPct:     labor.laborPct,
      breakdown:    { ...labor.breakdown },
      primeCostValue: primeCost.value,
      primeCostPct: primeCost.pct,
      trend,
      alerts:       deriveAlerts(labor.laborPct, primeCost.pct, trend, slice, restaurant.name),
      slicedPoints: slice,
    };
  }

  // For daily (7 days) and monthly (90 days): scale the 30-day API values proportionally
  const weeklySlice    = all.slice(-30);
  const weeklySales    = weeklySlice.reduce((s, d) => s + d.total, 0);
  const periodSales    = slice.reduce((s, d) => s + d.total, 0);
  const ratio          = weeklySales > 0 ? periodSales / weeklySales : 0;

  const byCategory = Object.fromEntries(
    Object.entries(gmData.sales.byCategory).map(([k, v]) => [k, r2(v * ratio)])
  ) as Record<string, number>;

  const laborTotal = r2(gmData.labor.total * ratio);
  const breakdown  = {
    fohLabor:   r2(gmData.labor.breakdown.fohLabor   * ratio),
    bohLabor:   r2(gmData.labor.breakdown.bohLabor   * ratio),
    management: r2(gmData.labor.breakdown.management * ratio),
  };
  const laborPct       = periodSales > 0 ? r2((laborTotal / periodSales) * 100) : 0;
  const primeCostValue = r2((byCategory.FOOD ?? 0) + laborTotal);
  const primeCostPct   = periodSales > 0 ? r2((primeCostValue / periodSales) * 100) : 0;
  const trend          = deriveTrend(slice);

  return {
    salesTotal:     r2(periodSales),
    byCategory,
    laborTotal,
    laborPct,
    breakdown,
    primeCostValue,
    primeCostPct,
    trend,
    alerts:         deriveAlerts(laborPct, primeCostPct, trend, slice, gmData.restaurant.name),
    slicedPoints:   slice,
  };
}

// ── GM Performance Section ────────────────────────────────────────────────────

function GMPerformanceSection() {
  const { t, lang } = useLanguage();
  const p = t.performance;
  const [gmData,    setGmData]    = useState<GMDashboard | null>(null);
  const [gmLoading, setGmLoading] = useState(true);
  const [gmError,   setGmError]   = useState(false);
  const [period,    setPeriod]    = useState<Period>("weekly");

  useEffect(() => {
    gmApi.getDashboard()
      .then(setGmData)
      .catch(() => setGmError(true))
      .finally(() => setGmLoading(false));
  }, []);

  if (gmLoading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-[#555]">
        <Spinner size="sm" /> <span className="text-[13px]">{p.subtitle}…</span>
      </div>
    );
  }

  if (gmError || !gmData) {
    return (
      <div className="px-4 py-3 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a] text-[13px] text-[#555]">
        Unable to load performance data.
      </div>
    );
  }

  const m = computeMetrics(period, gmData);

  const trendText  = m.trend === "up" ? p.trendUp : m.trend === "down" ? p.trendDown : p.trendFlat;
  const trendColor = m.trend === "up" ? "text-[#3dbf8a]" : m.trend === "down" ? "text-[#ef4444]" : "text-[#555]";

  const periodSubtitle = period === "daily" ? p.last7days : period === "weekly" ? p.last30days : p.last90days;
  const chartTitle     = period === "daily" ? p.chartSalesDaily : period === "weekly" ? p.chartSalesWeekly : p.chartSalesMontly;

  const catColors: Record<string, string> = {
    FOOD: "#3dbf8a", BEER: "#f59e0b", LIQUOR: "#8b5cf6", WINE: "#ef4444",
  };
  const catLabels: Record<string, string> = {
    FOOD: p.food, BEER: p.beer, LIQUOR: p.liquor, WINE: p.wine,
  };
  const laborColors = ["#3dbf8a", "#f59e0b", "#8b5cf6"];

  return (
    <div className="space-y-4">
      {/* Section header + period toggle */}
      <div>
        <h2 className="text-[16px] font-semibold text-white">{p.title}</h2>
        <p className="text-[13px] text-[#555] mt-0.5">{periodSubtitle}</p>
        <div className="flex gap-1 mt-3">
          {(["daily", "weekly", "monthly"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setPeriod(v)}
              className={`text-[11px] px-3 py-1 rounded-[6px] transition-colors ${
                period === v
                  ? "bg-[#3dbf8a] text-white"
                  : "border border-[#2a2a2a] text-[#555] hover:text-white"
              }`}
            >
              {v === "daily" ? p.viewDaily : v === "weekly" ? p.viewWeekly : p.viewMonthly}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <div className="rounded-[8px] border border-[#1a1a1a] bg-[#0a0a0a] p-4">
        <p className="text-[11px] font-semibold text-[#555] uppercase tracking-[0.08em] mb-3">{p.alerts}</p>
        {m.alerts.length === 0 ? (
          <p className="text-[13px] text-[#3dbf8a]">{p.noAlerts}</p>
        ) : (
          <AlertBanner alerts={m.alerts} lang={lang} />
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard       label={p.totalSales}   value={formatCurrency(m.salesTotal)} />
        <ColorStatCard  label={p.laborPct}     value={`${m.laborPct.toFixed(1)}%`}     valueColor={laborColor(m.laborPct)} />
        <ColorStatCard  label={p.primeCostPct} value={`${m.primeCostPct.toFixed(1)}%`} valueColor={primeColor(m.primeCostPct)} />
        <ColorStatCard  label={p.trend}        value={trendText}                        valueColor={trendColor} />
      </div>

      {/* Sales by category */}
      <div className="bg-[#0a0a0a] rounded-[8px] border border-[#1a1a1a] p-5 space-y-3">
        <p className="text-[13px] font-semibold text-white">{p.salesByCategory}</p>
        {Object.entries(m.byCategory).map(([cat, amount]) => (
          <BarRow
            key={cat}
            label={catLabels[cat] ?? cat}
            amount={amount}
            total={m.salesTotal}
            color={catColors[cat] ?? "#555"}
          />
        ))}
      </div>

      {/* Labor breakdown */}
      <div className="bg-[#0a0a0a] rounded-[8px] border border-[#1a1a1a] p-5 space-y-3">
        <p className="text-[13px] font-semibold text-white">{p.laborCost}</p>
        {[
          { label: p.fohLabor,   amount: m.breakdown.fohLabor,   color: laborColors[0] },
          { label: p.bohLabor,   amount: m.breakdown.bohLabor,   color: laborColors[1] },
          { label: p.management, amount: m.breakdown.management, color: laborColors[2] },
        ].map(({ label, amount, color }) => (
          <BarRow key={label} label={label} amount={amount} total={m.laborTotal} color={color} />
        ))}
      </div>

      {/* Sales sparkline — shows sliced daily data for the selected period */}
      {m.slicedPoints.length > 1 && (
        <div className="bg-[#0a0a0a] rounded-[8px] border border-[#1a1a1a] p-5">
          <p className="text-[13px] font-semibold text-white mb-3">{chartTitle}</p>
          <Sparkline points={m.slicedPoints} />
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const pageTitle = user?.restaurantName ? `${user.restaurantName} ${t.dashboard.title}` : t.dashboard.title;
  const [report, setReport] = useState<StockReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Primary multi-location owners land on the group overview instead of the single dashboard.
  // Branch members (groupId != null) are NOT redirected — they get their own location's dashboard.
 
  const loadReport = useCallback(() => {
    stockApi.report().then(setReport).catch(() => {});
  }, []);

  useEffect(() => {
    stockApi.report()
      .then(setReport)
      .finally(() => setLoading(false));
  }, []);

  useStockSocket(() => {
    loadReport();
  });

  // Normalize category names from the backend (remap legacy ones)
  const catMap = t.categories;
  function normalizeCat(raw: string): string {
    return catMap[raw] ?? raw;
  }

  if (loading) return <PageSpinner />;

  // Merge categories that map to the same display name
  const mergedByCategory = (() => {
    if (!report) return {};
    const merged: Record<string, { count: number; value: number }> = {};
    for (const [raw, data] of Object.entries(report.byCategory)) {
      const display = normalizeCat(raw);
      if (!merged[display]) merged[display] = { count: 0, value: 0 };
      merged[display].count += data.count;
      merged[display].value += data.value;
    }
    return merged;
  })();

  return (
    <div className="p-8 space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-white">{pageTitle}</h1>
        <p className="text-[13px] text-[#555] mt-1">{t.dashboard.subtitle}</p>
      </div>

      <OnboardingChecklist />

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t.dashboard.totalProducts}  value={report.totalProducts} />
            <StatCard label={t.dashboard.inventoryValue} value={formatCurrency(report.totalValue)} color="green" />
            <StatCard label={t.dashboard.belowMinimum}   value={report.belowMinimumCount} color={report.belowMinimumCount > 0 ? "yellow" : "green"} />
            <StatCard label={t.dashboard.categories}     value={Object.keys(mergedByCategory).length} />
          </div>

          {/* Category breakdown */}
          {Object.keys(mergedByCategory).length > 0 && (
            <div className="bg-[#0a0a0a] rounded-[8px] border border-[#1a1a1a] p-5">
              <h2 className="text-[13px] font-semibold text-white mb-4">{t.dashboard.valueByCategory}</h2>
              <div className="space-y-3">
                {Object.entries(mergedByCategory)
                  .sort(([, a], [, b]) => b.value - a.value)
                  .map(([cat, { count, value }]) => {
                    const pct = report.totalValue > 0
                      ? Math.round((value / report.totalValue) * 100)
                      : 0;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-700 dark:text-gray-300 font-medium">{cat}</span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {count} {t.common.items} · {formatCurrency(value)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      <LowStockAlerts compact />

      {/* Phase 5: GM Performance section — ADMIN only */}
      {user?.role === "ADMIN" && (
        <div className="pt-2 border-t border-[#1a1a1a]">
          <GMPerformanceSection />
        </div>
      )}
    </div>
  );
}
