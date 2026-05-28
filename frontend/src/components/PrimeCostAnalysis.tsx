import React, { useEffect, useState } from "react";
import { locationsApi, LocationVariance, VarianceAnalysisResponse, VarianceData, RawVarianceResponse } from "../api";
import { PageSpinner } from "./shared/Spinner";
import { useLanguage } from "../context/LanguageContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "primeCostPct" | "foodCostPct" | "laborCostPct" | "vsBest";
type SortDir  = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

function delta(v: number | null, decimals = 1): string {
  if (v === null || v === 0) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}

function vsBestColor(v: number | null): string {
  if (v === null)   return "text-[#555]";
  if (v === 0)      return "text-[#3dbf8a]";
  if (v <= 3)       return "text-[#f59e0b]";
  return "text-[#ef4444]";
}

function metricRating(v: number | null, key: string): "green" | "yellow" | "red" | null {
  if (v === null) return null;
  switch (key) {
    case "foodCostPct":  return v < 30 ? "green" : v <= 35 ? "yellow" : "red";
    case "laborCostPct": return v < 25 ? "green" : v <= 30 ? "yellow" : "red";
    case "primeCostPct": return v < 55 ? "green" : v <= 60 ? "yellow" : "red";
    default:             return null;
  }
}

const RATING_TEXT: Record<"green" | "yellow" | "red", string> = {
  green:  "text-[#3dbf8a]",
  yellow: "text-[#f59e0b]",
  red:    "text-[#ef4444]",
};

function sortRows(
  rows: LocationVariance[],
  key: SortKey,
  dir: SortDir
): LocationVariance[] {
  return [...rows].sort((a, b) => {
    let av: number | null;
    let bv: number | null;
    if (key === "vsBest") {
      av = a.primeCostPct.vsBest;
      bv = b.primeCostPct.vsBest;
    } else {
      av = a[key].value;
      bv = b[key].value;
    }
    // null last
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return dir === "asc" ? av - bv : bv - av;
  });
}

// ── Overview card ─────────────────────────────────────────────────────────────

function OverviewCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label:   string;
  value:   string;
  sub?:    string;
  accent?: boolean;
}) {
  return (
    <div className={`flex-1 min-w-0 rounded-[10px] border p-4 ${
      accent
        ? "border-[#3dbf8a]/30 bg-[#3dbf8a]/[0.05]"
        : "border-[#1a1a1a] bg-[#0a0a0a]"
    }`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${accent ? "text-[#3dbf8a]" : "text-[#555]"}`}>
        {label}
      </p>
      <p className="mt-2 text-[22px] font-bold text-white leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-[#555]">{sub}</p>}
    </div>
  );
}

// ── Drill-down detail card ────────────────────────────────────────────────────

function VarianceDetailCard({ loc }: { loc: LocationVariance }) {
  const primePct   = loc.primeCostPct.value;
  const vsBest     = loc.primeCostPct.vsBest;
  const foodGap    = loc.foodCostPct.vsBest  ?? 0;
  const laborGap   = loc.laborCostPct.vsBest ?? 0;
  const totalGap   = foodGap + laborGap;

  const isBaseline = vsBest === 0;

  return (
    <div className="rounded-[10px] border border-[#1a1a1a] bg-[#0a0a0a] p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-full bg-[#3dbf8a]/20 flex items-center justify-center text-[#3dbf8a] text-[13px] font-bold shrink-0">
          {loc.name[0]?.toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white truncate">{loc.name}</p>
          {loc.isTest && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
              TEST
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[11px] text-[#555] uppercase tracking-wider">Prime Cost</p>
          <p className="text-[20px] font-bold text-white leading-none">{pct(primePct)}</p>
        </div>
      </div>

      {isBaseline ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-[8px] bg-[#3dbf8a]/10 border border-[#3dbf8a]/20">
          <svg className="w-4 h-4 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-[12px] text-[#3dbf8a] font-medium">
            This location has the best prime cost — it sets the benchmark.
          </p>
        </div>
      ) : (
        <>
          {/* vs Best summary */}
          {vsBest !== null && vsBest > 0 && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a]">
              <svg className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[12px] text-[#888] leading-relaxed">
                Prime cost is{" "}
                <span className="text-[#ef4444] font-semibold">+{vsBest.toFixed(1)}%</span>
                {" "}above the best-performing location.
              </p>
            </div>
          )}

          {/* Gap breakdown bars */}
          {totalGap > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold text-[#444] uppercase tracking-wider">
                Gap breakdown vs best
              </p>

              {/* Food cost gap */}
              {foodGap > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#888]">Food Cost gap</span>
                    <span className="text-[#ef4444] font-medium">+{foodGap.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#ef4444]/70"
                      style={{ width: `${Math.min((foodGap / (totalGap || 1)) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Labor cost gap */}
              {laborGap > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#888]">Labor Cost gap</span>
                    <span className="text-[#f59e0b] font-medium">+{laborGap.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#f59e0b]/70"
                      style={{ width: `${Math.min((laborGap / (totalGap || 1)) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <p className="text-[10px] text-[#333] italic pt-1">
                Reducing these gaps to match the best location would lower prime cost by ~{totalGap.toFixed(1)}%.
              </p>
            </div>
          )}
        </>
      )}

      {/* Metric breakdown */}
      <div className="grid grid-cols-3 gap-3 pt-1">
        {(["foodCostPct", "laborCostPct", "primeCostPct"] as const).map((key) => {
          const d      = loc[key] as VarianceData;
          const rating = metricRating(d.value, key);
          const labels = { foodCostPct: "Food", laborCostPct: "Labor", primeCostPct: "Prime" };
          return (
            <div key={key} className="rounded-[8px] bg-[#111] border border-[#1a1a1a] p-3 text-center">
              <p className="text-[10px] text-[#444] uppercase tracking-wider">{labels[key]}</p>
              <p className={`mt-1 text-[15px] font-bold leading-none ${rating ? RATING_TEXT[rating] : "text-[#555]"}`}>
                {pct(d.value)}
              </p>
              {d.vsBest !== null && d.vsBest !== 0 && (
                <p className="mt-1 text-[10px] text-[#ef4444]">
                  +{d.vsBest.toFixed(1)}% vs best
                </p>
              )}
              {d.vsBest === 0 && (
                <p className="mt-1 text-[10px] text-[#3dbf8a]">✓ Best</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sort header cell ──────────────────────────────────────────────────────────

function SortTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label:   string;
  sortKey: SortKey;
  active:  boolean;
  dir:     SortDir;
  onSort:  (k: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors"
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-[#3dbf8a]" : "text-[#555] hover:text-[#888]"}`}>
        {label}
        {active ? (
          <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <span className="text-[10px] text-[#333]">↕</span>
        )}
      </span>
    </th>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PrimeCostAnalysis() {
  const { t }  = useLanguage();
  const ml     = t.multiLocation;

  const [data,     setData]     = useState<VarianceAnalysisResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(false);
  const [sortKey,  setSortKey]  = useState<SortKey>("primeCostPct");
  const [sortDir,  setSortDir]  = useState<SortDir>("asc");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    locationsApi.getVarianceAnalysis()
      .then((raw: RawVarianceResponse) => {
        // Transform backend's flat metrics + keyed variance into the
        // nested VarianceData shape the component expects.
        const transformed: VarianceAnalysisResponse = {
          benchmark: {
            primeCostPct: raw.benchmark?.prime?.best ?? null,
            foodCostPct:  raw.benchmark?.food?.best  ?? null,
            laborCostPct: raw.benchmark?.labor?.best ?? null,
          },
          locations: raw.locations.map((loc) => ({
            restaurantId: loc.id,
            name:         loc.name,
            isTest:       false,          // backend doesn't expose this field here
            isPrimary:    loc.isPrimary,
            hasData:      loc.hasData,
            primeCostPct: {
              value:  loc.variance?.prime?.value  ?? loc.metrics?.primeCostPct  ?? null,
              vsBest: loc.variance?.prime?.vsBest ?? null,
              vsAvg:  loc.variance?.prime?.vsAvg  ?? null,
            },
            foodCostPct: {
              value:  loc.variance?.food?.value  ?? loc.metrics?.foodCostPct  ?? null,
              vsBest: loc.variance?.food?.vsBest ?? null,
              vsAvg:  loc.variance?.food?.vsAvg  ?? null,
            },
            laborCostPct: {
              value:  loc.variance?.labor?.value  ?? loc.metrics?.laborCostPct  ?? null,
              vsBest: loc.variance?.labor?.vsBest ?? null,
              vsAvg:  loc.variance?.labor?.vsAvg  ?? null,
            },
          })),
        };
        setData(transformed);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSpinner />;

  if (error || !data) {
    return (
      <div className="flex items-start gap-3 px-4 py-4 rounded-[8px] bg-[#1a1a1a] border border-[#ef4444]/30">
        <svg className="w-4 h-4 text-[#ef4444] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-[13px] text-[#ccc]">Unable to load prime cost data. Please try again.</p>
      </div>
    );
  }

  const { benchmark, locations } = data;
  const locs = locations;

  // Overview card values
  const withPrime = locs.filter((l) => l.primeCostPct.value !== null);
  const bestVal   = withPrime.length > 0
    ? Math.min(...withPrime.map((l) => l.primeCostPct.value!))
    : null;
  const worstVal  = withPrime.length > 0
    ? Math.max(...withPrime.map((l) => l.primeCostPct.value!))
    : null;
  const avgVal    = withPrime.length > 0
    ? withPrime.reduce((s, l) => s + l.primeCostPct.value!, 0) / withPrime.length
    : null;

  const bestLoc  = bestVal  !== null ? withPrime.find((l) => l.primeCostPct.value === bestVal)  : null;
  const worstLoc = worstVal !== null ? withPrime.find((l) => l.primeCostPct.value === worstVal) : null;

  // Sort
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const sorted = sortRows(locs, sortKey, sortDir);

  const selectedLoc = selected ? locs.find((l) => l.restaurantId === selected) ?? null : null;

  return (
    <div className="space-y-6">

      {/* Overview cards */}
      <div className="flex flex-col sm:flex-row gap-3">
        <OverviewCard
          label={ml.bestPrimeCost}
          value={pct(bestVal)}
          sub={bestLoc?.name}
          accent
        />
        <OverviewCard
          label="Worst Prime Cost"
          value={pct(worstVal)}
          sub={worstLoc?.name}
        />
        <OverviewCard
          label="Avg Prime Cost"
          value={pct(avgVal !== null ? Math.round(avgVal * 10) / 10 : null)}
          sub={withPrime.length > 0 ? `across ${withPrime.length} location${withPrime.length !== 1 ? "s" : ""}` : undefined}
        />
      </div>

      {/* Comparison table */}
      <div className="rounded-[10px] border border-[#1a1a1a] bg-[#0a0a0a] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1a1a1a]">
          <p className="text-[12px] font-semibold text-[#555] uppercase tracking-wider">
            Location Comparison
            <span className="ml-2 text-[#333] normal-case font-normal">(click a row to see breakdown)</span>
          </p>
        </div>

        {locs.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-[#444] italic">{ml.missingData}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#111]">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-[#555] uppercase tracking-wider">
                    Location
                  </th>
                  <SortTh label="Prime %"  sortKey="primeCostPct"  active={sortKey === "primeCostPct"}  dir={sortDir} onSort={handleSort} />
                  <SortTh label="Food %"   sortKey="foodCostPct"   active={sortKey === "foodCostPct"}   dir={sortDir} onSort={handleSort} />
                  <SortTh label="Labor %"  sortKey="laborCostPct"  active={sortKey === "laborCostPct"}  dir={sortDir} onSort={handleSort} />
                  <SortTh label="vs Best"  sortKey="vsBest"        active={sortKey === "vsBest"}        dir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((loc) => {
                  const isSelected  = selected === loc.restaurantId;
                  const primeRating = metricRating(loc.primeCostPct.value, "primeCostPct");
                  const foodRating  = metricRating(loc.foodCostPct.value,  "foodCostPct");
                  const laborRating = metricRating(loc.laborCostPct.value, "laborCostPct");
                  const vb          = loc.primeCostPct.vsBest;
                  return (
                    <tr
                      key={loc.restaurantId}
                      onClick={() => setSelected(isSelected ? null : loc.restaurantId)}
                      className={`border-b border-[#0d0d0d] last:border-0 cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[#3dbf8a]/[0.06]"
                          : "hover:bg-[#111]"
                      }`}
                    >
                      {/* Location name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                            isSelected ? "bg-[#3dbf8a]/20 text-[#3dbf8a]" : "bg-[#1a1a1a] text-[#555]"
                          }`}>
                            {loc.name[0]?.toUpperCase()}
                          </span>
                          <span className={`text-[13px] font-medium truncate ${isSelected ? "text-white" : "text-[#888]"}`}>
                            {loc.name}
                          </span>
                          {loc.isTest && (
                            <span className="shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
                              TEST
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Prime % */}
                      <td className="px-4 py-3">
                        <span className={`text-[13px] font-bold ${primeRating ? RATING_TEXT[primeRating] : "text-[#555]"}`}>
                          {pct(loc.primeCostPct.value)}
                        </span>
                      </td>
                      {/* Food % */}
                      <td className="px-4 py-3">
                        <span className={`text-[13px] ${foodRating ? RATING_TEXT[foodRating] : "text-[#555]"}`}>
                          {pct(loc.foodCostPct.value)}
                        </span>
                      </td>
                      {/* Labor % */}
                      <td className="px-4 py-3">
                        <span className={`text-[13px] ${laborRating ? RATING_TEXT[laborRating] : "text-[#555]"}`}>
                          {pct(loc.laborCostPct.value)}
                        </span>
                      </td>
                      {/* vs Best */}
                      <td className="px-4 py-3">
                        <span className={`text-[13px] font-medium ${vsBestColor(vb)}`}>
                          {vb === null ? "—" : vb === 0 ? "✓ Best" : `+${vb.toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drill-down detail */}
      {selectedLoc && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#444] uppercase tracking-wider">
            Breakdown · {selectedLoc.name}
          </p>
          <VarianceDetailCard loc={selectedLoc} />
        </div>
      )}

      {/* Footnote */}
      <p className="text-[10px] text-[#333] italic text-center">
        {ml.allLocSubtitle} · percentages derived from invoices and sales entries
      </p>
    </div>
  );
}
