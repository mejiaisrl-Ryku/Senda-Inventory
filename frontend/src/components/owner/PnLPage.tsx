import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ownerApi } from "../../api";
import { PnLReport, PnLLocation } from "../../types";
import { formatCurrency } from "../../utils/stock";
import { PageSpinner, Spinner } from "../shared/Spinner";
import DateRangePicker from "../shared/DateRangePicker";
import { useLanguage, LangToggle } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); }

// ── Color helpers ─────────────────────────────────────────────────────────────

function foodColor(pct: number)  { return pct > 35 ? "text-[#ef4444]" : pct > 30 ? "text-[#f59e0b]" : "text-white"; }
function laborColor(pct: number) { return pct > 45 ? "text-[#ef4444]" : pct > 35 ? "text-[#f59e0b]" : "text-white"; }
function primeColor(pct: number) { return pct > 70 ? "text-[#ef4444]" : pct > 60 ? "text-[#f59e0b]" : "text-white"; }
function grossColor(pct: number) { return pct >= 35 ? "text-[#3dbf8a]" : pct >= 20 ? "text-[#f59e0b]" : "text-[#ef4444]"; }
function revenueColor(v: number) { return v > 0 ? "text-[#3dbf8a]" : "text-white"; }

function rankColor(rank: number): string {
  if (rank === 1) return "text-yellow-400";
  if (rank === 2) return "text-gray-400";
  if (rank === 3) return "text-amber-600";
  return "text-[#555]";
}

// ── Summary card ──────────────────────────────────────────────────────────────

function PnLCard({
  label, amount, pct, pctColor, note,
}: {
  label: string; amount: number; pct?: number; pctColor?: string; note?: string;
}) {
  return (
    <div className="bg-[#0a0a0a] rounded-[8px] px-4 py-5 border border-[#1a1a1a] min-w-0">
      <p className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] truncate">{label}</p>
      <p className="mt-2 text-[20px] font-semibold text-white leading-none">{formatCurrency(amount)}</p>
      {pct !== undefined && (
        <p className={`mt-1 text-[13px] font-medium ${pctColor ?? "text-[#555]"}`}>
          {pct.toFixed(1)}%
        </p>
      )}
      {note && <p className="mt-1.5 text-[10px] text-[#555] italic">{note}</p>}
    </div>
  );
}

// ── Ranking badge ─────────────────────────────────────────────────────────────

function RankingBadge({ emoji, label, name, color }: { emoji: string; label: string; name: string; color: string }) {
  if (!name) return null;
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#0a0a0a] border border-[#1a1a1a]`}>
      <span className="text-[16px]">{emoji}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-[#555] uppercase tracking-wider">{label}</p>
        <p className={`text-[13px] font-semibold truncate ${color}`}>{name}</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PnLPage() {
  const { t } = useLanguage();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const pl = t.pnl;

  const [ownerName,  setOwnerName]  = useState<string>("");
  const [data,       setData]       = useState<PnLReport | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(false);
  const [startDate,  setStartDate]  = useState(() => daysAgoISO(30));
  const [endDate,    setEndDate]    = useState(() => toISO(new Date()));
  const [exporting,  setExporting]  = useState(false);

  // Fetch owner name once on mount
  useEffect(() => {
    ownerApi.getDashboard().then((d) => setOwnerName(d.ownerAccount.name)).catch(() => {});
  }, []);

  function fetchPnL(start: string, end: string) {
    setLoading(true);
    setError(false);
    ownerApi.getPnL(start, end)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchPnL(startDate, endDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleExport() {
    setExporting(true);
    try {
      await ownerApi.exportPnL(startDate, endDate);
    } catch (err) {
      console.error("[PnLPage] export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  function handleDateChange(s: string, e: string) {
    setStartDate(s);
    setEndDate(e);
    fetchPnL(s, e);
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Top bar */}
      <header className="border-b border-[#1a1a1a] bg-[#0a0a0a] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/owner/dashboard")}
            className="text-[12px] text-[#555] hover:text-white transition-colors"
          >
            ← Back to Overview
          </button>
          {ownerName && (
            <>
              <span className="text-[#333]">·</span>
              <p className="text-[13px] text-[#444] truncate">{ownerName}</p>
            </>
          )}
        </div>
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
        {/* Page header + date picker */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-semibold text-white">{pl.title}</h1>
              <p className="text-[13px] text-[#555] mt-0.5">{pl.subtitle}</p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || loading}
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[6px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-[12px] font-medium transition-colors"
            >
              {exporting ? (
                <Spinner size="sm" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
              {exporting ? "…" : pl.export}
            </button>
          </div>
          <div className="mt-4">
            <DateRangePicker startDate={startDate} endDate={endDate} onChange={handleDateChange} />
          </div>
        </div>

        {loading && <PageSpinner />}

        {!loading && error && (
          <div className="px-4 py-3 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a] text-[13px] text-[#555]">
            Unable to load P&L data. Please try again.
          </div>
        )}

        {!loading && data && (
          <>
            {/* Consolidated summary cards */}
            <div>
              <p className="text-[11px] font-semibold text-[#555] uppercase tracking-[0.08em] mb-4">
                {pl.consolidated}
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <PnLCard label={pl.revenue}     amount={data.consolidated.revenue}    pct={undefined} pctColor={undefined} />
                <PnLCard label={pl.foodCost}    amount={data.consolidated.foodCost}   pct={data.consolidated.foodCostPct}    pctColor={foodColor(data.consolidated.foodCostPct)}   note={data.consolidated.foodCost === 0 ? pl.foodCostNote : undefined} />
                <PnLCard label={pl.laborCost}   amount={data.consolidated.laborCost}  pct={data.consolidated.laborCostPct}   pctColor={laborColor(data.consolidated.laborCostPct)} />
                <PnLCard label={pl.primeCost}   amount={data.consolidated.primeCost}  pct={data.consolidated.primeCostPct}   pctColor={primeColor(data.consolidated.primeCostPct)} />
                <div className="bg-[#0a0a0a] rounded-[8px] px-4 py-5 border border-[#1a1a1a] min-w-0">
                  <p className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] truncate">{pl.grossProfit}</p>
                  <p className={`mt-2 text-[20px] font-semibold leading-none ${revenueColor(data.consolidated.grossProfit)}`}>
                    {formatCurrency(data.consolidated.grossProfit)}
                  </p>
                  <p className={`mt-1 text-[13px] font-medium ${grossColor(data.consolidated.grossProfitPct)}`}>
                    {data.consolidated.grossProfitPct.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>

            {/* Ranking banner */}
            {(data.ranking.best || data.ranking.worst || data.ranking.mostRevenue) && (
              <div>
                <p className="text-[11px] font-semibold text-[#555] uppercase tracking-[0.08em] mb-3">{pl.ranking}</p>
                <div className="flex flex-wrap gap-3">
                  <RankingBadge emoji="🏆" label={pl.best}        name={data.ranking.best}        color="text-[#3dbf8a]" />
                  <RankingBadge emoji="⚠"  label={pl.worst}       name={data.ranking.worst}       color="text-[#f59e0b]" />
                  <RankingBadge emoji="💰" label={pl.mostRevenue} name={data.ranking.mostRevenue} color="text-blue-400"  />
                </div>
              </div>
            )}

            {/* Detailed table */}
            {data.locations.length === 0 ? (
              <p className="text-[13px] text-[#555] italic">{pl.noData}</p>
            ) : (
              <div className="rounded-[10px] border border-[#1a1a1a] bg-[#0a0a0a] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#111]">
                        {[pl.rank, pl.location, pl.revenue, pl.foodCost, pl.foodCostPct, pl.laborCost, pl.laborCostPct, pl.primeCost, pl.primeCostPct, pl.grossProfit, pl.grossProfitPct].map((h) => (
                          <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold text-[#555] uppercase tracking-wider whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.locations.map((loc) => (
                        <LocationRow key={loc.restaurant.id} loc={loc} />
                      ))}
                      {/* Consolidated totals row */}
                      <ConsolidatedRow c={data.consolidated} pl={pl} count={data.locations.length} />
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Table row components ──────────────────────────────────────────────────────

function LocationRow({ loc }: { loc: PnLLocation }) {
  return (
    <tr className="border-b border-[#0d0d0d] last:border-0 hover:bg-[#111]/60 transition-colors">
      <td className="px-3 py-3 font-bold" >
        <span className={rankColor(loc.rank)}>#{loc.rank}</span>
      </td>
      <td className="px-3 py-3 font-medium text-white whitespace-nowrap max-w-[160px] truncate">
        {loc.restaurant.name}
      </td>
      <td className="px-3 py-3 text-white font-mono">{formatCurrency(loc.revenue)}</td>
      <td className="px-3 py-3 font-mono">{formatCurrency(loc.foodCost)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${foodColor(loc.foodCostPct)}`}>{loc.foodCostPct.toFixed(1)}%</td>
      <td className="px-3 py-3 font-mono">{formatCurrency(loc.laborCost)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${laborColor(loc.laborCostPct)}`}>{loc.laborCostPct.toFixed(1)}%</td>
      <td className="px-3 py-3 font-mono">{formatCurrency(loc.primeCost)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${primeColor(loc.primeCostPct)}`}>{loc.primeCostPct.toFixed(1)}%</td>
      <td className={`px-3 py-3 font-mono ${revenueColor(loc.grossProfit)}`}>{formatCurrency(loc.grossProfit)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${grossColor(loc.grossProfitPct)}`}>{loc.grossProfitPct.toFixed(1)}%</td>
    </tr>
  );
}

function ConsolidatedRow({
  c,
  pl,
  count,
}: {
  c: PnLReport["consolidated"];
  pl: { consolidated: string; foodCostPct: string; laborCostPct: string; primeCostPct: string; grossProfitPct: string };
  count: number;
}) {
  if (count < 2) return null;
  return (
    <tr className="border-t border-[#2a2a2a] bg-[#111]">
      <td className="px-3 py-3 text-[#555]">—</td>
      <td className="px-3 py-3 text-white font-semibold">{pl.consolidated}</td>
      <td className="px-3 py-3 text-white font-semibold font-mono">{formatCurrency(c.revenue)}</td>
      <td className="px-3 py-3 text-white font-semibold font-mono">{formatCurrency(c.foodCost)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${foodColor(c.foodCostPct)}`}>{c.foodCostPct.toFixed(1)}%</td>
      <td className="px-3 py-3 text-white font-semibold font-mono">{formatCurrency(c.laborCost)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${laborColor(c.laborCostPct)}`}>{c.laborCostPct.toFixed(1)}%</td>
      <td className="px-3 py-3 text-white font-semibold font-mono">{formatCurrency(c.primeCost)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${primeColor(c.primeCostPct)}`}>{c.primeCostPct.toFixed(1)}%</td>
      <td className={`px-3 py-3 font-semibold font-mono ${revenueColor(c.grossProfit)}`}>{formatCurrency(c.grossProfit)}</td>
      <td className={`px-3 py-3 font-semibold font-mono ${grossColor(c.grossProfitPct)}`}>{c.grossProfitPct.toFixed(1)}%</td>
    </tr>
  );
}
