import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ownerApi } from "../../api";
import { OwnerDashboard as OwnerDashboardData, OwnerLocationData, GMAlert, PnLSummary } from "../../types";
import { formatCurrency } from "../../utils/stock";
import { PageSpinner } from "../shared/Spinner";
import DateRangePicker from "../shared/DateRangePicker";
import { useLanguage, LangToggle } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function laborColor(pct: number): string {
  if (pct > 45) return "text-[#ef4444]";
  if (pct > 35) return "text-[#f59e0b]";
  return "text-[#3dbf8a]";
}

function primeColor(pct: number): string {
  if (pct > 75) return "text-[#ef4444]";
  if (pct > 65) return "text-[#f59e0b]";
  return "text-[#3dbf8a]";
}

function pnlPrimeColor(pct: number): string {
  return pct > 70 ? "text-[#ef4444]" : pct > 60 ? "text-[#f59e0b]" : "text-white";
}

function grossColor(pct: number): string {
  return pct >= 35 ? "text-[#3dbf8a]" : pct >= 20 ? "text-[#f59e0b]" : "text-[#ef4444]";
}

function trendArrow(trend: "up" | "down" | "flat"): { symbol: string; color: string } {
  if (trend === "up")   return { symbol: "↑", color: "text-[#3dbf8a]" };
  if (trend === "down") return { symbol: "↓", color: "text-[#ef4444]" };
  return                       { symbol: "→", color: "text-[#555]"    };
}

// ── Small stat card ───────────────────────────────────────────────────────────

function StatCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="bg-[#0a0a0a] rounded-[8px] px-4 sm:px-6 py-5 border border-[#1a1a1a] min-w-0">
      <p className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] truncate">{label}</p>
      <p className={`mt-2 text-[22px] font-semibold tracking-tight leading-none truncate ${valueColor ?? "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

// ── Inline bar row ────────────────────────────────────────────────────────────

function BarRow({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-[#666]">{label}</span>
        <span className="text-[#888]">{formatCurrency(amount)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ── Alert list (expandable) ───────────────────────────────────────────────────

function AlertList({ alerts, lang }: { alerts: GMAlert[]; lang: string }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-2 border-t border-[#111]">
      {alerts.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.severity === "critical" ? "bg-[#ef4444]" : "bg-[#f59e0b]"}`} />
          <p className={`text-[11px] leading-relaxed ${a.severity === "critical" ? "text-[#ef4444]" : "text-[#f59e0b]"}`}>
            {lang === "es" ? a.messagEs : a.message}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Location card ─────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  FOOD:     "#3dbf8a",
  BEER:     "#f59e0b",
  LIQUOR:   "#8b5cf6",
  WINE:     "#ef4444",
  BUYOUTS:  "#06b6d4",
  EVENTS:   "#f97316",
  DELIVERY: "#84cc16",
};

function LocationCard({
  loc,
  catLabels,
  laborLabels,
  lang,
  trendLabel,
}: {
  loc:          OwnerLocationData;
  catLabels:    Record<string, string>;
  laborLabels:  { laborCost: string; foh: string; boh: string; mgmt: string };
  lang:         string;
  trendLabel:   (t: "up" | "down" | "flat") => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const arrow     = trendArrow(loc.sales.trend);
  const hasAlerts = loc.alerts.length > 0;
  const bd        = loc.labor.breakdown;

  return (
    <div className="bg-[#0a0a0a] rounded-[10px] border border-[#1a1a1a] overflow-hidden">
      {/* Card header — badge removed (Change 1) */}
      <div className="px-5 py-4 border-b border-[#111]">
        <p className="text-[14px] font-semibold text-white truncate">{loc.restaurant.name}</p>
        {loc.restaurant.address && (
          <p className="text-[11px] text-[#444] mt-0.5 truncate">{loc.restaurant.address}</p>
        )}
      </div>

      {/* Metrics row */}
      <div className="px-5 py-3 grid grid-cols-4 gap-3 border-b border-[#111]">
        <div>
          <p className="text-[10px] text-[#444] uppercase tracking-wider">Sales</p>
          <p className="text-[13px] font-semibold text-white mt-0.5">{formatCurrency(loc.sales.total)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#444] uppercase tracking-wider">Labor %</p>
          <p className={`text-[13px] font-semibold mt-0.5 ${laborColor(loc.labor.laborPct)}`}>
            {loc.labor.laborPct.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#444] uppercase tracking-wider">Prime %</p>
          <p className={`text-[13px] font-semibold mt-0.5 ${primeColor(loc.primeCost.pct)}`}>
            {loc.primeCost.pct.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#444] uppercase tracking-wider">Trend</p>
          <p className={`text-[13px] font-semibold mt-0.5 ${arrow.color}`}>{arrow.symbol}</p>
        </div>
      </div>

      {/* Category bars — all 7 categories, hide empties (Change 2) */}
      <div className="px-5 py-3 space-y-1.5 border-b border-[#111]">
        {(Object.entries(loc.sales.byCategory) as [string, number][])
          .filter(([, amt]) => amt > 0)
          .map(([cat, amt]) => (
            <BarRow
              key={cat}
              label={catLabels[cat] ?? cat}
              amount={amt}
              total={loc.sales.total}
              color={CAT_COLORS[cat] ?? "#555"}
            />
          ))}
      </div>

      {/* Labor breakdown (Change 3) */}
      <div className="px-5 py-3 space-y-1.5 border-b border-[#111]">
        <p className="text-[10px] font-semibold text-[#444] uppercase tracking-wider mb-2">
          {laborLabels.laborCost}
        </p>
        <BarRow label={laborLabels.foh}  amount={bd.fohLabor}   total={loc.labor.total} color="#3dbf8a" />
        <BarRow label={laborLabels.boh}  amount={bd.bohLabor}   total={loc.labor.total} color="#f59e0b" />
        <BarRow label={laborLabels.mgmt} amount={bd.management} total={loc.labor.total} color="#8b5cf6" />
      </div>

      {/* Alerts toggle */}
      {hasAlerts && (
        <div className="px-5 py-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-[#f59e0b] hover:text-[#fbbf24] transition-colors"
          >
            <span>{loc.alerts.length} alert{loc.alerts.length !== 1 ? "s" : ""}</span>
            <span>{expanded ? "▲" : "▼"}</span>
          </button>
          {expanded && <AlertList alerts={loc.alerts} lang={lang} />}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function OwnerDashboard() {
  const { t, lang } = useLanguage();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const o = t.owner;
  const p = t.performance;

  const [data,         setData]         = useState<OwnerDashboardData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(false);
  const [startDate,    setStartDate]    = useState(() => daysAgoISO(30));
  const [endDate,      setEndDate]      = useState(() => toISO(new Date()));
  const [pnlSummary,   setPnlSummary]   = useState<PnLSummary | null>(null);
  const [pnlLoading,   setPnlLoading]   = useState(true);
  const [pnlError,     setPnlError]     = useState(false);

  function fetchData(start: string, end: string) {
    setLoading(true);
    setError(false);
    ownerApi.getDashboard(start, end)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  function fetchPnLSummary(start: string, end: string) {
    setPnlLoading(true);
    setPnlError(false);
    ownerApi.getPnLSummary(start, end)
      .then(setPnlSummary)
      .catch(() => setPnlError(true))
      .finally(() => setPnlLoading(false));
  }

  useEffect(() => { fetchData(startDate, endDate); fetchPnLSummary(startDate, endDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(s: string, e: string) {
    setStartDate(s);
    setEndDate(e);
    fetchData(s, e);
    fetchPnLSummary(s, e);
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  if (loading) return <PageSpinner />;

  if (error || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-[15px] text-[#888]">Unable to load dashboard data.</p>
          <button
            onClick={() => window.location.reload()}
            className="text-[13px] text-[#3dbf8a] hover:text-[#4dcf9a] transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { ownerAccount, locations, summary } = data;

  const catLabels: Record<string, string> = {
    FOOD:     p.food,
    BEER:     p.beer,
    LIQUOR:   p.liquor,
    WINE:     p.wine,
    BUYOUTS:  o.buyouts,
    EVENTS:   o.events,
    DELIVERY: o.delivery,
  };

  const laborLabels = {
    laborCost: o.laborCost,
    foh:       o.fohLabor,
    boh:       o.bohLabor,
    mgmt:      o.management,
  };

  function trendLabel(trend: "up" | "down" | "flat") {
    if (trend === "up")   return p.trendUp;
    if (trend === "down") return p.trendDown;
    return p.trendFlat;
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Top bar */}
      <header className="border-b border-[#1a1a1a] bg-[#0a0a0a] px-6 py-4 flex items-center justify-between gap-4">
        <p className="text-[13px] text-white font-medium truncate">{ownerAccount.name}</p>
        <div className="flex items-center gap-3 shrink-0">
          <LangToggle />
          <button
            onClick={handleLogout}
            className="text-[12px] text-[#888] border border-[#2a2a2a] hover:border-[#444] hover:text-white px-3 py-1.5 rounded-[6px] transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="p-8 space-y-8">

        {/* Page header */}
        <div>
          <h1 className="text-[24px] font-semibold text-white">{o.title}</h1>
          <p className="text-[13px] text-[#555] mt-0.5">{o.subtitle}</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => navigate("/owner/budgets")}
              className="border border-[#2a2a2a] text-[#888] hover:border-[#444] hover:text-white text-[12px] px-4 py-1.5 rounded-[6px] transition-colors"
            >
              {o.manageBudgets}
            </button>
          </div>
          <div className="mt-4">
            <DateRangePicker startDate={startDate} endDate={endDate} onChange={handleDateChange} />
          </div>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={o.totalRevenue}    value={formatCurrency(summary.totalRevenue)} />
          <StatCard
            label={o.avgLaborPct}
            value={`${summary.avgLaborPct.toFixed(1)}%`}
            valueColor={laborColor(summary.avgLaborPct)}
          />
          <StatCard
            label={o.avgPrimeCostPct}
            value={`${summary.avgPrimeCostPct.toFixed(1)}%`}
            valueColor={primeColor(summary.avgPrimeCostPct)}
          />
          <StatCard
            label={o.bestPerformer}
            value={summary.bestPerformer || "—"}
            valueColor="text-[#3dbf8a]"
          />
        </div>

        {/* Needs attention banner */}
        {summary.needsAttention.length > 0 && (
          <div className="rounded-[8px] border border-[#f59e0b]/30 bg-[#f59e0b]/[0.06] px-4 py-3">
            <p className="text-[12px] font-semibold text-[#f59e0b] mb-1.5">
              {lang === "es"
                ? "Estas ubicaciones requieren tu atención:"
                : "These locations need your attention:"}
            </p>
            <div className="flex flex-wrap gap-2">
              {summary.needsAttention.map((name) => (
                <span key={name} className="text-[12px] text-[#f59e0b]/80 bg-[#f59e0b]/10 px-2 py-0.5 rounded-[4px]">
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Location cards */}
        <div>
          <p className="text-[11px] font-semibold text-[#555] uppercase tracking-[0.08em] mb-4">
            {o.locations} · {locations.length}
          </p>
          <div className="space-y-4">
            {locations.map((loc) => (
              <LocationCard
                key={loc.restaurant.id}
                loc={loc}
                catLabels={catLabels}
                laborLabels={laborLabels}
                lang={lang}
                trendLabel={trendLabel}
              />
            ))}
          </div>
        </div>

        {/* P&L Summary section */}
        <div className="border-t border-[#1a1a1a] pt-8">
          {/* Section header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-[16px] font-semibold text-white">{t.pnl.title}</h2>
              <p className="text-[13px] text-[#555] mt-0.5">{t.pnl.subtitle}</p>
            </div>
            <button
              onClick={() => navigate("/owner/pnl")}
              className="text-[12px] text-[#3dbf8a] hover:underline transition-colors shrink-0"
            >
              {t.pnl.viewFull}
            </button>
          </div>

          {/* Loading skeleton */}
          {pnlLoading && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-[#0a0a0a] rounded-[8px] px-4 py-5 border border-[#1a1a1a] h-20" />
              ))}
            </div>
          )}

          {/* Error */}
          {!pnlLoading && pnlError && (
            <p className="text-[13px] text-[#555] italic">Unable to load P&L summary.</p>
          )}

          {/* Summary cards */}
          {!pnlLoading && pnlSummary && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label={t.pnl.revenue}
                  value={formatCurrency(pnlSummary.totalRevenue)}
                />
                <StatCard
                  label={t.pnl.primeCostPct}
                  value={`${pnlSummary.primeCostPct.toFixed(1)}%`}
                  valueColor={pnlPrimeColor(pnlSummary.primeCostPct)}
                />
                <StatCard
                  label={t.pnl.grossProfit}
                  value={formatCurrency(pnlSummary.grossProfit)}
                  valueColor="text-[#3dbf8a]"
                />
                <StatCard
                  label={t.pnl.grossProfitPct}
                  value={`${pnlSummary.grossProfitPct.toFixed(1)}%`}
                  valueColor={grossColor(pnlSummary.grossProfitPct)}
                />
              </div>

              {/* Best / Worst ranking badges */}
              {(pnlSummary.bestLocation || pnlSummary.worstLocation) && (
                <div className="flex flex-wrap gap-3 mt-4">
                  {pnlSummary.bestLocation && (
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#0a0a0a] border border-[#1a1a1a]">
                      <span className="text-[15px]">🏆</span>
                      <div>
                        <p className="text-[10px] text-[#555] uppercase tracking-wider">{t.pnl.best}</p>
                        <p className="text-[13px] font-semibold text-yellow-400 truncate">{pnlSummary.bestLocation}</p>
                      </div>
                    </div>
                  )}
                  {pnlSummary.worstLocation && pnlSummary.worstLocation !== pnlSummary.bestLocation && (
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#0a0a0a] border border-[#1a1a1a]">
                      <span className="text-[15px]">⚠</span>
                      <div>
                        <p className="text-[10px] text-[#555] uppercase tracking-wider">{t.pnl.worst}</p>
                        <p className="text-[13px] font-semibold text-amber-400 truncate">{pnlSummary.worstLocation}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
