import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  locationsApi, seedApi,
  LocationSummary, MetricTrend,
  RecipeComparison, ProductVendorComparison,
} from "../api";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency } from "../utils/stock";
import { PageSpinner, Spinner } from "./shared/Spinner";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Which cost-% metric is currently highlighted across all location cards. */
type HighlightMetric = "foodCostPct" | "laborCostPct" | "primeCostPct" | null;

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = "kyru-selected-location";

function readStoredLocation(): string {
  try { return localStorage.getItem(LS_KEY) ?? "all"; } catch { return "all"; }
}
function writeStoredLocation(id: string) {
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
}

// ── Color rating ─────────────────────────────────────────────────────────────

type ColorRating = "green" | "yellow" | "red" | null;

function rateMetric(key: string | undefined, value: number | null): ColorRating {
  if (!key || value === null) return null;
  switch (key) {
    case "foodCostPct":          return value < 30 ? "green" : value <= 35 ? "yellow" : "red";
    case "laborCostPct":         return value < 25 ? "green" : value <= 30 ? "yellow" : "red";
    case "primeCostPct":         return value < 55 ? "green" : value <= 60 ? "yellow" : "red";
    case "inventoryAccuracyPct": return value >= 85 ? "green" : value >= 70 ? "yellow" : "red";
    default:                     return null;
  }
}

const RATING_DOT: Record<NonNullable<ColorRating>, string> = {
  green:  "bg-[#22c55e]",
  yellow: "bg-[#f59e0b]",
  red:    "bg-[#ef4444]",
};

// Solid badge backgrounds — used to wrap the metric value itself
const RATING_BADGE_BG: Record<NonNullable<ColorRating>, string> = {
  green:  "bg-[#3EBF8A]",   // teal green  — matches brand palette
  yellow: "bg-[#d97706]",   // amber-600   — dark enough for white text contrast
  red:    "bg-[#ef4444]",   // red-500
};

// ── Location switcher dropdown ────────────────────────────────────────────────

function LocationSwitcher({
  locations,
  selected,
  onSelect,
}: {
  locations: LocationSummary[];
  selected:  string; // restaurantId or "all"
  onSelect:  (id: string) => void;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedLoc = locations.find((l) => l.restaurantId === selected);
  const label       = selectedLoc ? selectedLoc.name : ml.allLocations;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg border text-[13px] font-medium transition-colors ${
          open
            ? "border-[#3dbf8a] bg-[#0f0f0f] text-white"
            : "border-[#2a2a2a] bg-[#0a0a0a] text-[#aaa] hover:text-white hover:border-[#3a3a3a]"
        }`}
      >
        {selectedLoc ? (
          selectedLoc.logo ? (
            <img src={selectedLoc.logo} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-4 h-4 rounded-full bg-[#3dbf8a]/20 flex items-center justify-center text-[#3dbf8a] text-[9px] font-bold shrink-0">
              {selectedLoc.name[0]?.toUpperCase()}
            </span>
          )
        ) : (
          <svg className="w-4 h-4 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        <span className={selectedLoc ? "font-semibold text-white" : ""}>{label}</span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${open ? "rotate-180 text-[#3dbf8a]" : "text-[#555]"}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div role="listbox" className="absolute right-0 mt-1.5 w-56 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl shadow-black/60 z-50 overflow-hidden">
          {/* "All Locations" */}
          <button
            role="option" aria-selected={selected === "all"}
            onClick={() => { onSelect("all"); setOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[#111] ${
              selected === "all" ? "text-[#3dbf8a] font-semibold bg-[#3dbf8a]/5" : "text-[#888]"
            }`}
          >
            <svg className={`w-4 h-4 shrink-0 ${selected === "all" ? "text-[#3dbf8a]" : "text-[#444]"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1 truncate">{ml.allLocations}</span>
            {selected === "all" && (
              <svg className="w-3.5 h-3.5 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {locations.length > 0 && <div className="border-t border-[#111]" />}

          {locations.map((loc) => {
            const isActive = selected === loc.restaurantId;
            return (
              <button
                key={loc.restaurantId} role="option" aria-selected={isActive}
                onClick={() => { onSelect(loc.restaurantId); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[#111] ${
                  isActive ? "text-[#3dbf8a] font-semibold bg-[#3dbf8a]/5" : "text-[#888]"
                }`}
              >
                {loc.logo ? (
                  <img src={loc.logo} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                ) : (
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    isActive ? "bg-[#3dbf8a]/20 text-[#3dbf8a]" : "bg-[#1a1a1a] text-[#555]"
                  }`}>
                    {loc.name[0]?.toUpperCase()}
                  </span>
                )}
                <span className="flex-1 truncate">{loc.name}</span>
                {isActive && (
                  <svg className="w-3.5 h-3.5 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Trend arrow ───────────────────────────────────────────────────────────────

function TrendArrow({ trend }: { trend: MetricTrend }) {
  if (!trend || trend === "flat") return <span className="text-[#555] text-[13px]">→</span>;
  if (trend === "up")             return <span className="text-[#aaa] text-[13px]">↑</span>;
  return                                 <span className="text-[#aaa] text-[13px]">↓</span>;
}

// ── Single metric row ─────────────────────────────────────────────────────────

function MetricRow({
  label,
  value,
  trend,
  isCurrency = false,
  noData,
  noDataHint,
  highlighted = false,
  metricKey,
}: {
  label:        string;
  value:        number | null;
  trend:        MetricTrend;
  isCurrency?:  boolean;
  noData:       string;
  noDataHint:   string;
  highlighted?: boolean;
  metricKey?:   string;
}) {
  const hasValue   = value !== null && value !== undefined;
  const rating     = rateMetric(metricKey, value);

  return (
    <div className={`flex items-start justify-between gap-3 py-3 border-b border-[#111] last:border-0 transition-colors rounded-md ${
      highlighted ? "bg-[#3dbf8a]/[0.07] -mx-2 px-2" : ""
    }`}>
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold uppercase tracking-wider truncate ${highlighted ? "text-[#3dbf8a]" : "text-[#555]"}`}>
          {label}
        </p>
        {hasValue ? (
          // Rated percentage metrics get a solid colored badge; currency rows stay plain
          rating && !isCurrency ? (
            <span className={`mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] text-[14px] font-bold text-white leading-none ${RATING_BADGE_BG[rating]}`}>
              {value!.toFixed(1)}%
              <span className="opacity-60 text-[9px]">●</span>
            </span>
          ) : (
            <p className="mt-0.5 text-[18px] font-bold text-white leading-none">
              {isCurrency ? formatCurrency(value!) : `${value!.toFixed(1)}%`}
            </p>
          )
        ) : (
          <>
            <p className="mt-0.5 text-[18px] font-bold text-[#333] leading-none">{noData}</p>
            <p className="mt-1 text-[10px] text-[#444] italic">{noDataHint}</p>
          </>
        )}
      </div>
      {hasValue && (
        <div className="shrink-0 mt-1 flex items-center gap-1.5">
          {/* Dot is now inside the badge for rated metrics; keep it here only for
              currency rows that don't use the badge */}
          {rating && isCurrency && (
            <span className={`w-2 h-2 rounded-full shrink-0 ${RATING_DOT[rating]}`} />
          )}
          <TrendArrow trend={trend} />
        </div>
      )}
    </div>
  );
}

// ── Location card ─────────────────────────────────────────────────────────────

function LocationCard({
  loc,
  highlightedMetric,
}: {
  loc:              LocationSummary;
  highlightedMetric: HighlightMetric;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;

  return (
    <div className="flex-1 min-w-0 bg-[#0a0a0a] border border-[#1a1a1a] rounded-[10px] p-5 space-y-1">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-[#1a1a1a]">
        {loc.logo ? (
          <img src={loc.logo} alt={loc.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[#3dbf8a]/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[#3dbf8a] text-[13px] font-bold">{loc.name[0]?.toUpperCase() ?? "?"}</span>
          </div>
        )}
        <p className="text-[14px] font-semibold text-white truncate flex-1">{loc.name}</p>
        {loc.isTest && (
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
            TEST
          </span>
        )}
      </div>

      {/* Metrics */}
      <div>
        <MetricRow label={ml.foodCostPct}    value={loc.metrics.foodCostPct}          trend={loc.trends.foodCostPct}          noData={ml.noData} noDataHint={ml.noDataHint} highlighted={highlightedMetric === "foodCostPct"}  metricKey="foodCostPct" />
        <MetricRow label={ml.laborCostPct}   value={loc.metrics.laborCostPct}         trend={loc.trends.laborCostPct}         noData={ml.noData} noDataHint={ml.noDataHint} highlighted={highlightedMetric === "laborCostPct"} metricKey="laborCostPct" />
        <MetricRow label={ml.primeCostPct}   value={loc.metrics.primeCostPct}         trend={loc.trends.primeCostPct}         noData={ml.noData} noDataHint={ml.noDataHint} highlighted={highlightedMetric === "primeCostPct"} metricKey="primeCostPct" />
        <MetricRow label={ml.invAccuracyPct} value={loc.metrics.inventoryAccuracyPct} trend={loc.trends.inventoryAccuracyPct} noData={ml.noData} noDataHint={ml.noDataHint} metricKey="inventoryAccuracyPct" />
        <MetricRow label={ml.revenue30d}     value={loc.metrics.revenue30d > 0 ? loc.metrics.revenue30d : null} trend={loc.trends.revenue30d} isCurrency noData={ml.noData} noDataHint={ml.noDataHint} />
      </div>
    </div>
  );
}

// ── Benchmark section ─────────────────────────────────────────────────────────

interface BenchmarkDef {
  metricKey:       HighlightMetric & string; // "foodCostPct" | "laborCostPct" | "primeCostPct"
  labelKey:        "lowestFoodCost" | "lowestLaborCost" | "bestPrimeCost";
}

const BENCHMARKS: BenchmarkDef[] = [
  { metricKey: "foodCostPct",  labelKey: "lowestFoodCost"  },
  { metricKey: "laborCostPct", labelKey: "lowestLaborCost" },
  { metricKey: "primeCostPct", labelKey: "bestPrimeCost"   },
];

function BenchmarkCard({
  def,
  locations,
  isActive,
  onToggle,
}: {
  def:       BenchmarkDef;
  locations: LocationSummary[];
  isActive:  boolean;
  onToggle:  () => void;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;

  // Locations that have a value for this metric
  const withData = locations.filter((l) => l.metrics[def.metricKey as keyof LocationSummary["metrics"]] !== null) as LocationSummary[];
  const allHaveData = withData.length === locations.length && locations.length > 0;

  // Sort ascending — lowest first (lower is better for all 3 cost metrics)
  const sorted = [...withData].sort(
    (a, b) =>
      (a.metrics[def.metricKey as keyof LocationSummary["metrics"]] as number) -
      (b.metrics[def.metricKey as keyof LocationSummary["metrics"]] as number)
  );

  const best  = sorted[0];
  const worst = sorted[sorted.length - 1];
  const others = sorted.slice(1); // everyone except best, for the comparison list

  const bestVal  = best  ? (best.metrics[def.metricKey  as keyof LocationSummary["metrics"]] as number) : null;
  const worstVal = worst ? (worst.metrics[def.metricKey as keyof LocationSummary["metrics"]] as number) : null;
  const gap      = bestVal !== null && worstVal !== null && best?.restaurantId !== worst?.restaurantId
    ? Math.round((worstVal - bestVal) * 10) / 10
    : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex-1 min-w-0 text-left rounded-[10px] border p-4 transition-all ${
        isActive
          ? "border-[#3dbf8a] bg-[#3dbf8a]/[0.06] shadow-[0_0_0_1px_#3dbf8a22]"
          : "border-[#1a1a1a] bg-[#0a0a0a] hover:border-[#2a2a2a] hover:bg-[#0d0d0d]"
      }`}
    >
      {/* Card header: icon + label */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-[15px] font-bold leading-none ${isActive ? "text-[#3dbf8a]" : "text-[#555]"}`}>↓</span>
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${isActive ? "text-[#3dbf8a]" : "text-[#555]"}`}>
          {ml[def.labelKey]}
        </p>
        <span className={`ml-auto text-[10px] italic ${isActive ? "text-[#3dbf8a]/70" : "text-[#333]"}`}>
          {ml.lowerIsBetter}
        </span>
      </div>

      {/* No data at all */}
      {withData.length === 0 && (
        <p className="text-[12px] text-[#444] italic">{ml.missingData}</p>
      )}

      {/* Best performer */}
      {best && (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[#3dbf8a] font-semibold text-[14px] truncate">{best.name}</span>
            <span className="text-[#555] text-[12px] shrink-0">{ml.at}</span>
            <span className="text-white font-bold text-[18px] shrink-0">{bestVal?.toFixed(1)}%</span>
          </div>

          {/* Gap callout */}
          {gap !== null && gap > 0 && worst && (
            <p className="text-[12px] text-[#888]">
              <span className="text-[#3dbf8a] font-semibold">{gap.toFixed(1)}%</span>
              {" "}{ml.betterThan}{" "}
              <span className="text-[#666]">{worst.name}</span>
              {" "}
              <span className="text-[#444]">({worstVal?.toFixed(1)}%)</span>
            </p>
          )}

          {/* Missing data note */}
          {!allHaveData && locations.length > withData.length && (
            <p className="text-[11px] text-[#444] italic mt-1">{ml.missingData}</p>
          )}

          {/* Other locations mini-list */}
          {others.length > 0 && (
            <div className="pt-2 mt-1 border-t border-[#111] flex flex-wrap gap-x-3 gap-y-1">
              {others.map((loc) => {
                const v = loc.metrics[def.metricKey as keyof LocationSummary["metrics"]] as number;
                return (
                  <span key={loc.restaurantId} className="text-[11px] text-[#555]">
                    {loc.name}: <span className="text-[#777]">{v.toFixed(1)}%</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Active pulse dot */}
      {isActive && (
        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#3dbf8a]" />
      )}
    </button>
  );
}

// ── Recipe Comparison ─────────────────────────────────────────────────────────

/** Rank a location entry relative to its siblings for this recipe. */
function recipeRank(entry: { costPct?: number; restaurantId: string }, sorted: { restaurantId: string }[]): "best" | "worst" | "mid" {
  if (sorted.length <= 1) return "best";
  if (entry.restaurantId === sorted[0].restaurantId) return "best";
  if (entry.restaurantId === sorted[sorted.length - 1].restaurantId) return "worst";
  return "mid";
}

function RecipeLocationCard({ entry, rank, bestCost }: {
  entry:    import("../api").LocationRecipeEntry;
  rank:     "best" | "worst" | "mid";
  bestCost: number | null;
}) {
  const borderCls =
    rank === "best"  ? "border-[#3dbf8a]/50" :
    rank === "worst" ? "border-[#ef4444]/30"  :
                       "border-[#1a1a1a]";

  const bgCls =
    rank === "best"  ? "bg-[#3dbf8a]/[0.05]" :
    rank === "worst" ? "bg-[#ef4444]/[0.04]"  :
                       "bg-[#0a0a0a]";

  if (!entry.hasRecipe) {
    return (
      <div className="flex-1 min-w-[220px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-[10px] p-5 flex flex-col items-center justify-center gap-2 min-h-[220px]">
        <div className="w-7 h-7 rounded-full bg-[#1a1a1a] flex items-center justify-center">
          <span className="text-[#333] text-[12px] font-bold">{entry.locationName[0].toUpperCase()}</span>
        </div>
        <p className="text-[13px] font-semibold text-white">{entry.locationName}</p>
        {entry.isTest && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">TEST</span>
        )}
        <p className="text-[12px] text-[#333] mt-1 italic">Recipe not offered</p>
      </div>
    );
  }

  const rankBadge =
    rank === "best"  ? <span className="text-[10px] font-bold text-[#3dbf8a]">✓ Best</span>  :
    rank === "worst" ? <span className="text-[10px] font-bold text-[#ef4444]">↑ High</span> :
                       <span className="text-[10px] text-[#555]">• Mid</span>;

  const costColor =
    rank === "best"  ? "text-[#3dbf8a]" :
    rank === "worst" ? "text-[#ef4444]"  :
                       "text-white";

  const dollarGap = (bestCost !== null && entry.recipeCost !== undefined && rank !== "best")
    ? Math.round((entry.recipeCost - bestCost) * 100) / 100
    : null;

  return (
    <div className={`flex-1 min-w-[220px] ${bgCls} border ${borderCls} rounded-[10px] p-5 space-y-4`}>
      {/* Card header */}
      <div className="flex items-center gap-2 pb-3 border-b border-[#111]">
        <div className="w-6 h-6 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center flex-shrink-0">
          <span className="text-white text-[10px] font-bold">{entry.locationName[0].toUpperCase()}</span>
        </div>
        <p className="text-[13px] font-semibold text-white flex-1 truncate">{entry.locationName}</p>
        {entry.isTest && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 shrink-0">TEST</span>
        )}
        {rankBadge}
      </div>

      {/* Cost summary */}
      <div className="space-y-2">
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-[#555] uppercase tracking-wider">Recipe Cost</span>
          <div className="flex items-baseline gap-1.5">
            {dollarGap !== null && dollarGap > 0 && (
              <span className="text-[10px] text-[#ef4444]">+${dollarGap.toFixed(2)}</span>
            )}
            <span className="text-[15px] font-bold text-white">${entry.recipeCost!.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-[#555] uppercase tracking-wider">Cost %</span>
          <span className={`text-[15px] font-bold ${costColor}`}>{entry.costPct!.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-[#555] uppercase tracking-wider">Selling Price</span>
          <span className="text-[13px] text-[#777]">${entry.sellingPrice!.toFixed(2)}</span>
        </div>
        {entry.hasInvoiceData && (
          <div className="flex items-center gap-1 pt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3dbf8a] shrink-0" />
            <span className="text-[10px] text-[#3dbf8a]/70">Priced from recent invoices</span>
          </div>
        )}
      </div>

      {/* Ingredients */}
      <div className="border-t border-[#111] pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#333] mb-2">Ingredients</p>
        <div className="space-y-2">
          {entry.ingredients!.map((ing, i) => (
            <div key={i}>
              <div className="flex justify-between text-[12px]">
                <span className="text-[#aaa] truncate pr-2">{ing.name}</span>
                <span className="text-[#666] shrink-0">{ing.quantity} {ing.unit}</span>
              </div>
              <div className="flex justify-between text-[10px] text-[#444]">
                <span className="flex items-center gap-1">
                  @ ${ing.costPerUnit.toFixed(3)}/{ing.unit}
                  {ing.fromInvoice && (
                    <span className="px-1 rounded bg-[#3dbf8a]/10 text-[#3dbf8a] text-[9px] font-semibold">INV</span>
                  )}
                </span>
                <span className="text-[#555]">= ${ing.lineTotal.toFixed(2)}</span>
              </div>
              {ing.fromInvoice && ing.purveyor && (
                <p className="text-[9px] text-[#333] mt-0.5">{ing.purveyor}{ing.invoiceDate ? ` · ${ing.invoiceDate}` : ""}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecipeComparisonTab() {
  const [comparisons, setComparisons] = useState<RecipeComparison[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState<string | null>(null);
  const [dropOpen,    setDropOpen]    = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    locationsApi.recipes()
      .then((data) => {
        setComparisons(data);
        if (data.length > 0) setSelected(data[0].recipeName);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (comparisons.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <svg className="w-8 h-8 text-[#2a2a2a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <p className="text-[14px] text-[#555]">No recipes found across locations.</p>
        <p className="text-[12px] text-[#333]">Add recipes to your locations to compare costs here.</p>
      </div>
    );
  }

  const comparison = comparisons.find((c) => c.recipeName === selected);

  // For the selected recipe, sort the entries that have the recipe by recipeCost
  const sorted = comparison
    ? [...comparison.locations]
        .filter((l) => l.hasRecipe)
        .sort((a, b) => (a.recipeCost ?? 0) - (b.recipeCost ?? 0))
    : [];

  const bestCost  = sorted.length > 0 ? (sorted[0].recipeCost ?? null) : null;
  const worstCost = sorted.length > 1 ? (sorted[sorted.length - 1].recipeCost ?? null) : null;

  return (
    <div className="space-y-6">
      {/* Recipe selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-[12px] text-[#444] uppercase tracking-wider font-semibold shrink-0">Select recipe:</p>
        <div ref={dropRef} className="relative flex-1 min-w-[240px] max-w-sm">
          <button
            onClick={() => setDropOpen((v) => !v)}
            className={`w-full flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-[8px] border text-[13px] font-medium transition-colors text-left ${
              dropOpen
                ? "border-[#3dbf8a] bg-[#0d0d0d] text-white"
                : "border-[#2a2a2a] bg-[#0a0a0a] text-[#aaa] hover:border-[#3a3a3a] hover:text-white"
            }`}
          >
            {selected ? (
              <>
                <span className="text-[12px]">
                  {comparisons.find(c => c.recipeName === selected)?.department === "BAR" ? "🍹" : "🍳"}
                </span>
                <span className="flex-1 truncate">{selected}</span>
              </>
            ) : (
              <span className="flex-1 truncate text-[#555]">Choose a recipe…</span>
            )}
            <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${dropOpen ? "rotate-180 text-[#3dbf8a]" : "text-[#555]"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-[10px] border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl shadow-black/60 overflow-hidden max-h-60 overflow-y-auto">
              {comparisons.map((c) => (
                <button
                  key={c.recipeName}
                  onClick={() => { setSelected(c.recipeName); setDropOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] hover:bg-[#111] transition-colors ${
                    selected === c.recipeName ? "text-[#3dbf8a] bg-[#3dbf8a]/5" : "text-[#888]"
                  }`}
                >
                  <span className="text-[12px]">{c.department === "BAR" ? "🍹" : "🍳"}</span>
                  <span className="flex-1 truncate">{c.recipeName}</span>
                  <span className="text-[10px] text-[#333] uppercase font-semibold shrink-0">{c.department}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Comparison cards */}
      {comparison && (
        <div className="space-y-4">
          {/* Recipe header */}
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[18px] font-bold text-white tracking-wide">{comparison.recipeName}</h2>
            <span className="px-2 py-0.5 rounded-[4px] bg-[#1a1a1a] border border-[#2a2a2a] text-[10px] font-semibold uppercase tracking-wider text-[#555]">
              {comparison.department}
            </span>
            {/* Show common selling price if all locations agree */}
            {(() => {
              const prices = comparison.locations.filter((l) => l.hasRecipe).map((l) => l.sellingPrice);
              const allSame = prices.length > 0 && prices.every((p) => p === prices[0]);
              return allSame ? (
                <span className="text-[13px] text-[#555]">
                  Selling price: <span className="text-white font-semibold">${prices[0]!.toFixed(2)}</span>
                </span>
              ) : null;
            })()}
          </div>

          {/* Cards row */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch flex-wrap">
            {comparison.locations.map((entry) => (
              <RecipeLocationCard
                key={entry.restaurantId}
                entry={entry}
                rank={entry.hasRecipe ? recipeRank(entry, sorted) : "mid"}
                bestCost={bestCost}
              />
            ))}
          </div>

          {/* Gap callout */}
          {sorted.length >= 2 && bestCost !== null && worstCost !== null && worstCost > bestCost && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#3dbf8a]/5 border border-[#3dbf8a]/10">
              <svg className="w-3.5 h-3.5 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[12px] text-[#888]">
                <span className="text-[#3dbf8a] font-semibold">{sorted[0].locationName}</span>
                {" "}makes this recipe for{" "}
                <span className="text-white font-semibold">${bestCost.toFixed(2)}</span>
                {" "}—{" "}
                <span className="text-[#3dbf8a] font-semibold">
                  ${(worstCost - bestCost).toFixed(2)} cheaper ({((worstCost - bestCost) / worstCost * 100).toFixed(1)}%)
                </span>
                {" "}than{" "}
                <span className="text-[#aaa]">{sorted[sorted.length - 1].locationName}</span>
                {" "}(${worstCost.toFixed(2)}).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Vendor Pricing Tab ────────────────────────────────────────────────────────

/** Determines whether a location is best/mid/worst vs the global min/max cost. */
function vendorRank(
  bestNormalizedCost: number | null,
  minCost: number,
  maxCost: number
): "best" | "worst" | "mid" {
  if (bestNormalizedCost === null) return "mid";
  if (bestNormalizedCost <= minCost + 0.001) return "best";
  if (bestNormalizedCost >= maxCost - 0.001) return "worst";
  return "mid";
}

function fmt$(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtQty(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Single location card inside the vendor detail view. */
function VendorLocationCard({
  loc,
  item,
}: {
  loc:  import("../api").LocationVendorPrice;
  item: ProductVendorComparison;
}) {
  const rank = vendorRank(loc.bestNormalizedCost, item.minCost, item.maxCost);

  const borderCls =
    rank === "best"  ? "border-[#3dbf8a]/50" :
    rank === "worst" ? "border-[#ef4444]/40"  :
                       "border-[#2a2a2a]";
  const bgCls =
    rank === "best"  ? "bg-[#3dbf8a]/[0.04]" :
    rank === "worst" ? "bg-[#ef4444]/[0.04]"  :
                       "bg-[#0a0a0a]";
  const rankLabel =
    rank === "best"  ? <span className="text-[10px] font-bold text-[#3dbf8a]">✓ Best</span>  :
    rank === "worst" ? <span className="text-[10px] font-bold text-[#ef4444]">↑ Highest</span> :
                       <span className="text-[10px] text-[#555]">• Mid</span>;

  if (!loc.hasPurchases) {
    return (
      <div className="rounded-[10px] border border-[#1a1a1a] bg-[#080808] p-4 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-[#111] flex items-center justify-center shrink-0">
          <span className="text-[#333] text-[11px] font-bold">{loc.locationName[0].toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[#444] truncate">{loc.locationName}</p>
          {loc.isTest && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">TEST</span>}
        </div>
        <p className="text-[11px] text-[#333] italic shrink-0">No recent purchases</p>
      </div>
    );
  }

  const annualSavings =
    rank !== "best" && loc.bestNormalizedCost !== null
      ? Math.round((loc.bestNormalizedCost - item.minCost) * loc.totalQty30d * 12 * 100) / 100
      : 0;

  return (
    <div className={`rounded-[10px] border ${borderCls} ${bgCls} p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center shrink-0">
          <span className="text-white text-[10px] font-bold">{loc.locationName[0].toUpperCase()}</span>
        </div>
        <p className="text-[13px] font-semibold text-white flex-1 truncate">{loc.locationName}</p>
        {loc.isTest && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 shrink-0">TEST</span>
        )}
        {rankLabel}
      </div>

      {/* Volume summary */}
      <div className="flex items-center justify-between text-[11px] text-[#444] px-0.5">
        <span>{fmtQty(loc.totalQty30d)} {item.canonicalUnit}/month</span>
        <span>${fmt$(loc.totalQty30d * (loc.bestNormalizedCost ?? 0))}/month spend</span>
      </div>

      {/* Purveyor rows */}
      <div className="space-y-1.5">
        {loc.purveyors.map((p, i) => {
          const isBestAtLoc = i === 0;
          const gapVsGlobal = p.normalizedCost - item.minCost;
          const gapPct      = item.minCost > 0 ? (gapVsGlobal / item.minCost) * 100 : 0;
          const annualLocSavings = !isBestAtLoc
            ? Math.round((p.normalizedCost - loc.purveyors[0].normalizedCost) * p.qty30d * 12 * 100) / 100
            : 0;

          return (
            <div
              key={p.purveyor}
              className={`flex items-start gap-2.5 px-3 py-2 rounded-[6px] ${
                isBestAtLoc && rank === "best" ? "bg-[#3dbf8a]/[0.06]" : "bg-[#0d0d0d]"
              }`}
            >
              {/* Cost badge */}
              <div className="shrink-0 min-w-[70px]">
                <p className={`text-[14px] font-bold leading-none ${
                  isBestAtLoc && rank === "best"  ? "text-[#3dbf8a]" :
                  !isBestAtLoc && rank === "worst" ? "text-[#ef4444]"  :
                  isBestAtLoc                      ? "text-[#f59e0b]"  :
                                                     "text-[#888]"
                }`}>
                  ${fmt$(p.normalizedCost)}/{item.canonicalUnit}
                </p>
                {p.isConverted && (
                  <p className="text-[9px] text-[#444] mt-0.5">{p.originalCost.toFixed(3)}/{p.originalUnit}</p>
                )}
              </div>

              {/* Vendor info */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[#aaa] truncate font-medium">{p.purveyor}</p>
                <p className="text-[10px] text-[#444]">{p.invoiceDate ?? "No date"}</p>
              </div>

              {/* Gap vs global best */}
              <div className="shrink-0 text-right">
                {gapVsGlobal > 0.001 ? (
                  <>
                    <p className="text-[11px] text-[#ef4444] font-semibold">
                      +${fmt$(gapVsGlobal, 3)} (+{gapPct.toFixed(1)}%)
                    </p>
                    {annualLocSavings > 0 && (
                      <p className="text-[9px] text-[#555]">
                        +${annualLocSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr vs cheapest here
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[10px] text-[#3dbf8a] font-semibold">Best price</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Savings opportunity vs global best */}
      {annualSavings > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[5px] bg-[#ef4444]/[0.05] border border-[#ef4444]/10">
          <svg className="w-3 h-3 text-[#ef4444] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[10px] text-[#888]">
            Switching to best vendor saves{" "}
            <span className="text-[#ef4444] font-semibold">${fmt$(annualSavings / 12)}/month</span>
            {" · "}
            <span className="text-[#ef4444] font-semibold">${annualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}/year</span>
          </p>
        </div>
      )}
    </div>
  );
}

function VendorPricingTab() {
  const [data,     setData]     = useState<ProductVendorComparison[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    locationsApi.vendorPricing()
      .then((d) => {
        setData(d);
        // Default to first multi-location item or first item
        const first = d.find((x) => x.purchasingLocationCount > 1) ?? d[0];
        if (first) setSelected(first.productName);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <svg className="w-8 h-8 text-[#2a2a2a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-[14px] text-[#555]">No invoice data found.</p>
        <p className="text-[12px] text-[#333]">Import invoices with product names to see vendor price comparison.</p>
      </div>
    );
  }

  const item = data.find((d) => d.productName === selected);

  // Portfolio summary (multi-location items only)
  const multiItems     = data.filter((d) => d.purchasingLocationCount > 1);
  const singleItems    = data.filter((d) => d.purchasingLocationCount === 1);
  const totalSavings   = multiItems.reduce((s, d) => s + d.maxAnnualSavings, 0);
  const totalSpend     = data.reduce((s, d) => s + d.totalSpend30d, 0);

  // Sort locations within the selected item: best → mid → worst
  const sortedLocs = item
    ? [...item.locations].sort((a, b) => {
        const ra = vendorRank(a.bestNormalizedCost, item.minCost, item.maxCost);
        const rb = vendorRank(b.bestNormalizedCost, item.minCost, item.maxCost);
        const order = { best: 0, mid: 1, worst: 2 };
        return order[ra] - order[rb];
      })
    : [];

  return (
    <div className="space-y-5">

      {/* ── Portfolio summary ──────────────────────────────────────────────── */}
      {totalSavings > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 px-4 py-3 rounded-[10px] bg-[#0a0a0a] border border-[#1a1a1a]">
          <div className="flex items-center gap-2 flex-1">
            <svg className="w-4 h-4 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">Total Savings Opportunity</p>
              <p className="text-[16px] font-bold text-[#3dbf8a]">
                ${totalSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}<span className="text-[11px] font-normal text-[#3dbf8a]/70">/year</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">Monthly Spend (all items)</p>
              <p className="text-[14px] font-bold text-white">${fmt$(totalSpend)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">Items compared</p>
              <p className="text-[14px] font-bold text-white">{multiItems.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Item selector ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-[12px] text-[#444] uppercase tracking-wider font-semibold shrink-0">Select item:</p>
        <div ref={dropRef} className="relative flex-1 min-w-[260px] max-w-sm">
          <button
            onClick={() => setDropOpen((v) => !v)}
            className={`w-full flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-[8px] border text-[13px] font-medium transition-colors text-left ${
              dropOpen
                ? "border-[#3dbf8a] bg-[#0d0d0d] text-white"
                : "border-[#2a2a2a] bg-[#0a0a0a] text-[#aaa] hover:border-[#3a3a3a] hover:text-white"
            }`}
          >
            <span className="flex-1 truncate">{item ? item.productName : "Choose an item…"}</span>
            {item && item.maxAnnualSavings > 0 && (
              <span className="shrink-0 text-[10px] font-bold text-[#3dbf8a] bg-[#3dbf8a]/10 px-1.5 py-0.5 rounded">
                ${item.maxAnnualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr
              </span>
            )}
            <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${dropOpen ? "rotate-180 text-[#3dbf8a]" : "text-[#555]"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-[10px] border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl shadow-black/60 overflow-hidden max-h-64 overflow-y-auto">
              {/* Multi-location items */}
              {multiItems.length > 0 && (
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#333] border-b border-[#111]">
                  Cross-location · sorted by savings
                </div>
              )}
              {multiItems.map((d) => (
                <button
                  key={d.productName}
                  onClick={() => { setSelected(d.productName); setDropOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-[#111] transition-colors ${
                    selected === d.productName ? "text-[#3dbf8a] bg-[#3dbf8a]/5" : "text-[#888]"
                  }`}
                >
                  <span className="flex-1 truncate">{d.productName}</span>
                  <span className="text-[10px] text-[#444] shrink-0">{fmtQty(d.totalQty30d)} {d.canonicalUnit}/mo</span>
                  {d.maxAnnualSavings > 0 && (
                    <span className="text-[10px] font-bold text-[#3dbf8a] shrink-0">
                      ${d.maxAnnualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr
                    </span>
                  )}
                </button>
              ))}

              {/* Single-location items */}
              {singleItems.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#333] border-t border-b border-[#111]">
                    Single location
                  </div>
                  {singleItems.map((d) => (
                    <button
                      key={d.productName}
                      onClick={() => { setSelected(d.productName); setDropOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-[#111] transition-colors ${
                        selected === d.productName ? "text-[#3dbf8a] bg-[#3dbf8a]/5" : "text-[#555]"
                      }`}
                    >
                      <span className="flex-1 truncate">{d.productName}</span>
                      <span className="text-[10px] text-[#333] shrink-0">{d.locations.find(l => l.hasPurchases)?.locationName}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Selected item detail ───────────────────────────────────────────── */}
      {item && (
        <div className="space-y-4">

          {/* Item header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-[18px] font-bold text-white">{item.productName}</h3>
              <p className="text-[12px] text-[#555] mt-0.5">
                {fmtQty(item.totalQty30d)} {item.canonicalUnit}/month total across {item.purchasingLocationCount} location{item.purchasingLocationCount !== 1 ? "s" : ""}
                {" · "}${fmt$(item.totalSpend30d)}/month spend
              </p>
            </div>
            {item.purchasingLocationCount > 1 && item.priceDelta > 0 && (
              <div className="text-right shrink-0">
                <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">Price gap</p>
                <p className="text-[15px] font-bold text-[#ef4444]">
                  ${fmt$(item.priceDelta, 3)} <span className="text-[12px]">({item.priceDeltaPct.toFixed(1)}%)</span>
                </p>
              </div>
            )}
          </div>

          {/* Volume leverage banner — multi-location only */}
          {item.purchasingLocationCount > 1 && item.monthlySavings > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-[8px] bg-[#3dbf8a]/[0.05] border border-[#3dbf8a]/15">
              <svg className="w-4 h-4 text-[#3dbf8a] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <div>
                <p className="text-[12px] text-[#888] leading-relaxed">
                  You buy <span className="text-white font-semibold">{fmtQty(item.totalQty30d)} {item.canonicalUnit}/month</span> total across all locations.
                  {" "}Consolidating to the cheapest vendor price saves{" "}
                  <span className="text-[#3dbf8a] font-bold">${fmt$(item.monthlySavings)}/month</span>
                  {" "}·{" "}
                  <span className="text-[#3dbf8a] font-bold">${item.maxAnnualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}/year</span>.
                </p>
              </div>
            </div>
          )}

          {/* Unit conversion note */}
          {item.hasUnitMismatch && item.conversionNote && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[#f59e0b]/[0.05] border border-[#f59e0b]/20">
              <svg className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[11px] text-[#f59e0b]/80">Unit mismatch detected — {item.conversionNote}</p>
            </div>
          )}

          {/* Single-location notice */}
          {item.purchasingLocationCount === 1 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a]">
              <svg className="w-3.5 h-3.5 text-[#555] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[12px] text-[#555]">
                Only purchased at <span className="text-[#888] font-semibold">{item.locations.find(l => l.hasPurchases)?.locationName}</span>.
                {" "}Check whether other locations buy this item under a different name.
              </p>
            </div>
          )}

          {/* Location cards */}
          <div className="flex flex-col gap-3">
            {sortedLocs.map((loc) => (
              <VendorLocationCard key={loc.restaurantId} loc={loc} item={item} />
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-[#2a2a2a] italic text-center pt-2">
        Last 30 days · Savings = monthly volume × price gap × 12 · Prices normalized to {item?.canonicalUnit ?? "common unit"}
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 3;

export function MultiLocationOverview() {
  const { t }      = useLanguage();
  const navigate   = useNavigate();
  const { isAdmin } = useAuth();
  const ml         = t.multiLocation;

  const [locations,         setLocations]         = useState<LocationSummary[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [fetchError,        setFetchError]        = useState(false);
  const [showAll,           setShowAll]           = useState(false);
  const [selected,          setSelected]          = useState<string>(readStoredLocation);
  const [highlightedMetric, setHighlightedMetric] = useState<HighlightMetric>(null);
  const [seeding,           setSeeding]           = useState(false);
  const [activeTab,         setActiveTab]         = useState<"overview" | "recipes" | "vendor">("overview");

  useEffect(() => {
    locationsApi.overview()
      .then((data) => { setLocations(data); setFetchError(false); })
      .catch((err) => {
        // 401 / 403: the axios interceptor already redirects to /login automatically —
        // all requests go through the shared `api` instance which injects
        // `Authorization: Bearer <token>` and retries with a refreshed token on 401.
        // For any other error (network down, 5xx, etc.) show a recoverable error state.
        const status = (err as any)?.response?.status;
        if (status !== 401 && status !== 403) setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(id: string) {
    writeStoredLocation(id);
    setSelected(id);
    if (id !== "all") navigate("/");
  }

  function toggleHighlight(metric: HighlightMetric & string) {
    setHighlightedMetric((prev) => (prev === metric ? null : metric));
  }

  async function handleSeed() {
    setSeeding(true);
    try {
      await seedApi.seedTestLocations();
      const fresh = await locationsApi.overview();
      setLocations(fresh);
    } catch { /* ignore */ } finally { setSeeding(false); }
  }

  async function handleClear() {
    setSeeding(true);
    try {
      await seedApi.clearTestLocations();
      const fresh = await locationsApi.overview();
      setLocations(fresh);
    } catch { /* ignore */ } finally { setSeeding(false); }
  }

  if (loading) return <PageSpinner />;

  if (fetchError) {
    return (
      <div className="p-6 sm:p-8 space-y-4">
        <h1 className="text-[22px] font-semibold text-white">{ml.title}</h1>
        <div className="flex items-start gap-3 px-4 py-4 rounded-[8px] bg-[#1a1a1a] border border-[#ef4444]/30">
          <svg className="w-4 h-4 text-[#ef4444] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="space-y-1">
            <p className="text-[13px] text-[#ccc]">Unable to load location data.</p>
            <p className="text-[11px] text-[#555]">
              Check your connection, then{" "}
              <button
                onClick={() => { setFetchError(false); setLoading(true);
                  locationsApi.overview().then(setLocations).catch(() => setFetchError(true)).finally(() => setLoading(false)); }}
                className="text-[#3dbf8a] hover:underline"
              >
                try again
              </button>
              {" "}or{" "}
              <button onClick={() => navigate("/login")} className="text-[#3dbf8a] hover:underline">
                log in again
              </button>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  const visible  = showAll ? locations : locations.slice(0, MAX_VISIBLE);
  const overflow = locations.length - MAX_VISIBLE;
  const isSingle = locations.length === 1;

  // Show benchmark section only when there's more than 1 location with any data,
  // or always show (with missing-data notes) so the section isn't surprising.
  const showBenchmarks = locations.length >= 1;

  return (
    <div className="p-6 sm:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{ml.title}</h1>
          <p className="text-[13px] text-[#555] mt-0.5">{ml.subtitle}</p>
        </div>
        {activeTab === "overview" && locations.length > 0 && (
          <LocationSwitcher locations={locations} selected={selected} onSelect={handleSelect} />
        )}
        {(activeTab === "recipes" || activeTab === "vendor") && (
          <span className="text-[11px] text-[#333] italic">All locations · last 30 days</span>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-[8px] p-1 w-fit">
        {(["overview", "recipes", "vendor"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-[6px] text-[12px] font-medium transition-colors whitespace-nowrap ${
              activeTab === tab
                ? "bg-[#1a1a1a] text-white shadow-sm"
                : "text-[#555] hover:text-[#888]"
            }`}
          >
            {tab === "overview" ? "Overview" : tab === "recipes" ? "Recipe Comparison" : "Vendor Pricing"}
          </button>
        ))}
      </div>

      {/* ── Recipe Comparison tab ──────────────────────────────────────────── */}
      {activeTab === "recipes" && <RecipeComparisonTab />}

      {/* ── Vendor Pricing tab ────────────────────────────────────────────── */}
      {activeTab === "vendor" && <VendorPricingTab />}

      {/* ── Overview tab ───────────────────────────────────────────────────── */}
      {activeTab === "overview" && <>

      {/* Single-location notice */}
      {isSingle && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a]">
          <svg className="w-4 h-4 text-[#3dbf8a] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[13px] text-[#888]">{ml.singleLocation}</p>
        </div>
      )}

      {/* Location cards */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch">
        {visible.map((loc) => (
          <LocationCard key={loc.restaurantId} loc={loc} highlightedMetric={highlightedMetric} />
        ))}
      </div>

      {/* "+X more" */}
      {!showAll && overflow > 0 && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] text-[13px] text-[#888] hover:text-white hover:border-[#3dbf8a] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            +{overflow} {ml.moreLocations}
          </button>
        </div>
      )}

      {/* ── Best Performers ──────────────────────────────────────────────────── */}
      {showBenchmarks && (
        <div className="space-y-3 pt-2">
          <p className="text-[11px] font-semibold text-[#444] uppercase tracking-[0.12em]">
            {ml.bestPerformers}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 relative">
            {BENCHMARKS.map((def) => (
              <BenchmarkCard
                key={def.metricKey}
                def={def}
                locations={locations}
                isActive={highlightedMetric === def.metricKey}
                onToggle={() => toggleHighlight(def.metricKey)}
              />
            ))}
          </div>
          {highlightedMetric && (
            <p className="text-center text-[11px] text-[#444] italic">
              ↑ metric highlighted in location cards above · click again to clear
            </p>
          )}
        </div>
      )}

      </> /* end overview tab */}

      {/* Admin-only seed / clear buttons */}
      {isAdmin && (
        <div className="pt-4 mt-2 border-t border-[#111] flex items-center justify-between gap-4 flex-wrap">
          <p className="text-[10px] text-[#2a2a2a] uppercase tracking-wider font-semibold">
            Dev tools — admin only
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-3 py-1.5 text-[11px] text-[#555] border border-[#222] rounded-md hover:text-[#3dbf8a] hover:border-[#3dbf8a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {seeding ? "Working…" : "Seed test data"}
            </button>
            <button
              onClick={handleClear}
              disabled={seeding}
              className="px-3 py-1.5 text-[11px] text-[#555] border border-[#222] rounded-md hover:text-[#ef4444] hover:border-[#ef4444] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {seeding ? "Working…" : "Clear test data"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
