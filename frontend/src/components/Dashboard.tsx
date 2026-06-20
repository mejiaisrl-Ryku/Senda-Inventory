import React, { useEffect, useState, useCallback } from "react";
import { stockApi, gmApi } from "../api";
import { StockReport, GMDashboard, GMAlert } from "../types";
import { formatCurrency } from "../utils/stock";
import { LowStockAlerts } from "./LowStockAlerts";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { PageSpinner, Spinner } from "./shared/Spinner";
import DateRangePicker from "./shared/DateRangePicker";
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

// ── GM Performance Section ────────────────────────────────────────────────────

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); }

function GMPerformanceSection() {
  const { t, lang } = useLanguage();
  const p = t.performance;
  const [gmData,    setGmData]    = useState<GMDashboard | null>(null);
  const [gmLoading, setGmLoading] = useState(true);
  const [gmError,   setGmError]   = useState(false);

  const [startDate, setStartDate] = useState(() => daysAgoISO(90));
  const [endDate,   setEndDate]   = useState(() => toISO(new Date()));

  function fetchData(start: string, end: string) {
    setGmLoading(true);
    setGmError(false);
    gmApi.getDashboard(start, end)
      .then(setGmData)
      .catch(() => setGmError(true))
      .finally(() => setGmLoading(false));
  }

  useEffect(() => { fetchData(startDate, endDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(s: string, e: string) {
    setStartDate(s);
    setEndDate(e);
    fetchData(s, e);
  }

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

  const { sales, labor, primeCost, alerts } = gmData;
  const trendText  = sales.trend === "up" ? p.trendUp : sales.trend === "down" ? p.trendDown : p.trendFlat;
  const trendColor = sales.trend === "up" ? "text-[#3dbf8a]" : sales.trend === "down" ? "text-[#ef4444]" : "text-[#555]";

  const catColors: Record<string, string> = {
    FOOD: "#3dbf8a", BEER: "#f59e0b", LIQUOR: "#8b5cf6", WINE: "#ef4444",
  };
  const catLabels: Record<string, string> = {
    FOOD: p.food, BEER: p.beer, LIQUOR: p.liquor, WINE: p.wine,
  };
  const laborColors = ["#3dbf8a", "#f59e0b", "#8b5cf6"];

  return (
    <div className="space-y-4">
      {/* Section header + date picker */}
      <div>
        <h2 className="text-[16px] font-semibold text-white">{p.title}</h2>
        <div className="mt-3">
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={handleDateChange} />
        </div>
      </div>

      {/* Alerts */}
      <div className="rounded-[8px] border border-[#1a1a1a] bg-[#0a0a0a] p-4">
        <p className="text-[11px] font-semibold text-[#555] uppercase tracking-[0.08em] mb-3">{p.alerts}</p>
        {alerts.length === 0 ? (
          <p className="text-[13px] text-[#3dbf8a]">{p.noAlerts}</p>
        ) : (
          <AlertBanner alerts={alerts} lang={lang} />
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard       label={p.totalSales}   value={formatCurrency(sales.total)} />
        <ColorStatCard  label={p.laborPct}     value={`${labor.laborPct.toFixed(1)}%`}     valueColor={laborColor(labor.laborPct)} />
        <ColorStatCard  label={p.primeCostPct} value={`${primeCost.pct.toFixed(1)}%`}      valueColor={primeColor(primeCost.pct)} />
        <ColorStatCard  label={p.trend}        value={trendText}                            valueColor={trendColor} />
      </div>

      {/* Sales by category */}
      <div className="bg-[#0a0a0a] rounded-[8px] border border-[#1a1a1a] p-5 space-y-3">
        <p className="text-[13px] font-semibold text-white">{p.salesByCategory}</p>
        {Object.entries(sales.byCategory).map(([cat, amount]) => (
          <BarRow
            key={cat}
            label={catLabels[cat] ?? cat}
            amount={amount}
            total={sales.total}
            color={catColors[cat] ?? "#555"}
          />
        ))}
      </div>

      {/* Labor breakdown */}
      <div className="bg-[#0a0a0a] rounded-[8px] border border-[#1a1a1a] p-5 space-y-3">
        <p className="text-[13px] font-semibold text-white">{p.laborCost}</p>
        {[
          { label: p.fohLabor,   amount: labor.breakdown.fohLabor,   color: laborColors[0] },
          { label: p.bohLabor,   amount: labor.breakdown.bohLabor,   color: laborColors[1] },
          { label: p.management, amount: labor.breakdown.management, color: laborColors[2] },
        ].map(({ label, amount, color }) => (
          <BarRow key={label} label={label} amount={amount} total={labor.total} color={color} />
        ))}
      </div>

    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const pageTitle = user?.restaurantName ? `${user.restaurantName} ${t.dashboard.title}` : t.dashboard.title;
  const [report, setReport] = useState<StockReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Primary multi-location owners land on the group overview instead of the single dashboard.
  // Branch members (groupId != null) are NOT redirected — they get their own location's dashboard.
 
  const loadReport = useCallback(() => {
    stockApi.report()
      .then(setReport)
      .catch((err) => console.error('[Dashboard] Socket reload failed:', err));
  }, []);

  useEffect(() => {
    stockApi.report()
      .then(setReport)
      .catch((err) => {
        console.error('[Dashboard] Stock report failed:', err);
        setError(err?.response?.data?.message || 'Failed to load stock report');
      })
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

      {error && (
        <div className="px-4 py-3 rounded-[8px] bg-[#1a1a1a] border border-[#ef4444] text-[13px] text-[#ef4444]">
          <strong>Error:</strong> {error}
        </div>
      )}

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
