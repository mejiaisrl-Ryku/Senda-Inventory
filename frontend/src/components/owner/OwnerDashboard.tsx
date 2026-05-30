import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ownerApi } from "../../api";
import { OwnerDashboard as OwnerDashboardData, OwnerLocationData, GMAlert } from "../../types";
import { formatCurrency } from "../../utils/stock";
import { PageSpinner } from "../shared/Spinner";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";

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
  FOOD:   "#3dbf8a",
  BEER:   "#f59e0b",
  LIQUOR: "#8b5cf6",
  WINE:   "#ef4444",
};

function LocationCard({
  loc,
  catLabels,
  lang,
  trendLabel,
}: {
  loc:        OwnerLocationData;
  catLabels:  Record<string, string>;
  lang:       string;
  trendLabel: (t: "up" | "down" | "flat") => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const arrow = trendArrow(loc.sales.trend);
  const hasAlerts = loc.alerts.length > 0;

  return (
    <div className="bg-[#0a0a0a] rounded-[10px] border border-[#1a1a1a] overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-[#111]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-white truncate">{loc.restaurant.name}</p>
            {loc.restaurant.address && (
              <p className="text-[11px] text-[#444] mt-0.5 truncate">{loc.restaurant.address}</p>
            )}
          </div>
          {/* Alert count badge */}
          <span
            className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
              hasAlerts ? "bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20"
                        : "bg-[#3dbf8a]/10 text-[#3dbf8a] border border-[#3dbf8a]/20"
            }`}
          >
            {hasAlerts ? `${loc.alerts.length}` : "✓"}
          </span>
        </div>
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

      {/* Category bars */}
      <div className="px-5 py-3 space-y-1.5 border-b border-[#111]">
        {(Object.entries(loc.sales.byCategory) as [string, number][]).map(([cat, amt]) => (
          <BarRow
            key={cat}
            label={catLabels[cat] ?? cat}
            amount={amt}
            total={loc.sales.total}
            color={CAT_COLORS[cat] ?? "#555"}
          />
        ))}
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

  const [data,    setData]    = useState<OwnerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    ownerApi.getDashboard()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

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
    FOOD:   p.food,
    BEER:   p.beer,
    LIQUOR: p.liquor,
    WINE:   p.wine,
  };

  function trendLabel(trend: "up" | "down" | "flat") {
    if (trend === "up")   return p.trendUp;
    if (trend === "down") return p.trendDown;
    return p.trendFlat;
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Top bar */}
      <header className="border-b border-[#1a1a1a] bg-[#0a0a0a] px-6 py-4 flex items-center justify-between">
        <p className="text-[13px] text-white font-medium truncate">{ownerAccount.name}</p>
        <button
          onClick={handleLogout}
          className="text-[12px] text-[#333] hover:text-[#666] transition-colors"
        >
          Sign out
        </button>
      </header>

      <div className="p-8 space-y-8">

        {/* Page header */}
        <div>
          <h1 className="text-[24px] font-semibold text-white">{o.title}</h1>
          <p className="text-[13px] text-[#555] mt-0.5">{o.subtitle}</p>
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
                lang={lang}
                trendLabel={trendLabel}
              />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
