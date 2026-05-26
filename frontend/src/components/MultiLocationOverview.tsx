import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { locationsApi, seedApi, LocationSummary, MetricTrend } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency } from "../utils/stock";
import { PageSpinner } from "./shared/Spinner";

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
        {locations.length > 0 && (
          <LocationSwitcher locations={locations} selected={selected} onSelect={handleSelect} />
        )}
      </div>

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
