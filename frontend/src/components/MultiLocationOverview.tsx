/**
 * MultiLocationOverview
 *
 * ⚠️  DATA ISOLATION & SECURITY MODEL
 * ────────────────────────────────────────────────────────────────────────────
 * This component is only meaningful for multi-location restaurant partners
 * (locationCount > 1). Single-location users are shown an informational
 * notice instead of location cards.
 *
 * Frontend protection (UI layer — defence in depth only):
 *   • Single-location users see: "You have 1 location. This view is
 *     designed for 2+ locations."
 *   • The location switcher only lists restaurants returned by the API,
 *     so a user can never manually select a restaurant they don't own.
 *
 * Backend protection (authoritative boundary — enforced server-side):
 *   • Every /api/locations/* endpoint derives the restaurant scope
 *     exclusively from the JWT-embedded restaurantId (req.user.restaurantId).
 *     No client-supplied query parameter can override this.
 *   • Scope query: WHERE groupId = req.user.restaurantId
 *     Returns only the primary restaurant + its branches; other partners'
 *     restaurants are structurally unreachable.
 *   • All downstream DB queries use WHERE restaurantId IN (allIds),
 *     where allIds is built from the scoped restaurants above.
 *
 * Threat model mitigations:
 *   ✅ Cross-partner data leakage — impossible; groupId filter is server-enforced.
 *   ✅ JWT tampering — auth middleware validates signature + expiry before
 *      this code runs; forged tokens receive HTTP 401.
 *   ✅ URL / query-string manipulation — restaurantId always comes from the
 *      verified JWT, never from req.query or req.params.
 *   ✅ Unauthorized navigation to /multi-location — single-location users
 *      receive an empty-or-one-location response; no cross-partner data exposed.
 * ────────────────────────────────────────────────────────────────────────────
 */
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { locationsApi, LocationCapacity, LocationSummary, MetricTrend } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { formatCurrency } from "../utils/stock";
import { PageSpinner, Spinner } from "./shared/Spinner";

// ── Lazy-loaded heavy tabs ────────────────────────────────────────────────────
// Each chunk is only downloaded when the user first clicks that tab.

const RecipeComparisonTab  = lazy(() => import("./RecipeComparisonTab"));
const VendorPricingTab     = lazy(() => import("./VendorPricingTab"));
const PrimeCostAnalysis    = lazy(() => import("./PrimeCostAnalysis"));

// ── Module-level location cache (10-min TTL) ──────────────────────────────────

let _locCache: { data: LocationSummary[]; at: number } | null = null;
const LOC_TTL = 10 * 60 * 1000;

function isLocCacheValid() {
  return _locCache !== null && Date.now() - _locCache.at < LOC_TTL;
}

// ── Types ─────────────────────────────────────────────────────────────────────

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

const RATING_BADGE_BG: Record<NonNullable<ColorRating>, string> = {
  green:  "bg-[#3EBF8A]",
  yellow: "bg-[#d97706]",
  red:    "bg-[#ef4444]",
};

// ── Location switcher dropdown ────────────────────────────────────────────────

function LocationSwitcher({
  locations,
  selected,
  onSelect,
}: {
  locations: LocationSummary[];
  selected:  string;
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
  const hasValue = value !== null && value !== undefined;
  const rating   = rateMetric(metricKey, value);

  return (
    <div className={`flex items-start justify-between gap-3 py-3 border-b border-[#111] last:border-0 transition-colors rounded-md ${
      highlighted ? "bg-[#3dbf8a]/[0.07] -mx-2 px-2" : ""
    }`}>
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold uppercase tracking-wider truncate ${highlighted ? "text-[#3dbf8a]" : "text-[#555]"}`}>
          {label}
        </p>
        {hasValue ? (
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
          {rating && isCurrency && (
            <span className={`w-2 h-2 rounded-full shrink-0 ${RATING_DOT[rating]}`} />
          )}
          <TrendArrow trend={trend} />
        </div>
      )}
    </div>
  );
}

// ── Skeleton card (shown while location data loads) ───────────────────────────

function SkeletonCard() {
  return (
    <div className="flex-1 min-w-0 bg-[#0a0a0a] border border-[#1a1a1a] rounded-[10px] p-5 space-y-3 animate-pulse">
      <div className="flex items-center gap-3 pb-3 border-b border-[#1a1a1a]">
        <div className="w-8 h-8 rounded-full bg-[#1a1a1a]" />
        <div className="h-3.5 bg-[#1a1a1a] rounded w-2/3" />
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex justify-between py-2 border-b border-[#0d0d0d]">
          <div className="h-2.5 bg-[#111] rounded w-1/3" />
          <div className="h-5 bg-[#111] rounded w-1/4" />
        </div>
      ))}
    </div>
  );
}

// ── Location card ─────────────────────────────────────────────────────────────

function LocationCard({
  loc,
  highlightedMetric,
  onDeleteClick,
}: {
  loc:              LocationSummary;
  highlightedMetric: HighlightMetric;
  onDeleteClick?:   () => void;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // When invoices exist (hasData) but revenue = 0, percentages can't be computed.
  // Show a targeted hint instead of the generic "set up invoices" message.
  const pctHint = loc.hasData ? ml.noDataHintNeedsSales : ml.noDataHint;

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="flex-1 min-w-0 bg-[#0a0a0a] border border-[#1a1a1a] rounded-[10px] p-5 space-y-1">
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
        {/* Three-dot menu — only on non-primary branches */}
        {!loc.isPrimary && onDeleteClick && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-6 h-6 flex items-center justify-center rounded-md text-[#444] hover:text-[#888] hover:bg-[#1a1a1a] transition-colors"
              aria-label="Location options"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="10" cy="4"  r="1.5" />
                <circle cx="10" cy="10" r="1.5" />
                <circle cx="10" cy="16" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl shadow-black/60 z-50 overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); onDeleteClick(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-[#ef4444] hover:bg-[#1a1a1a] transition-colors"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {ml.deleteLocation}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <MetricRow label={ml.foodCostPct}    value={loc.metrics.foodCostPct}          trend={loc.trends.foodCostPct}          noData={ml.noData} noDataHint={pctHint}        highlighted={highlightedMetric === "foodCostPct"}  metricKey="foodCostPct" />
        <MetricRow label={ml.laborCostPct}   value={loc.metrics.laborCostPct}         trend={loc.trends.laborCostPct}         noData={ml.noData} noDataHint={pctHint}        highlighted={highlightedMetric === "laborCostPct"} metricKey="laborCostPct" />
        <MetricRow label={ml.primeCostPct}   value={loc.metrics.primeCostPct}         trend={loc.trends.primeCostPct}         noData={ml.noData} noDataHint={pctHint}        highlighted={highlightedMetric === "primeCostPct"} metricKey="primeCostPct" />
        <MetricRow label={ml.invAccuracyPct} value={loc.metrics.inventoryAccuracyPct} trend={loc.trends.inventoryAccuracyPct} noData={ml.noData} noDataHint={ml.noDataHint}  metricKey="inventoryAccuracyPct" />
        <MetricRow label={ml.revenue30d}     value={loc.hasData ? loc.metrics.revenue30d : null} trend={loc.trends.revenue30d} isCurrency noData={ml.noData} noDataHint={ml.noDataHint} />
      </div>
    </div>
  );
}

// ── Benchmark section ─────────────────────────────────────────────────────────

interface BenchmarkDef {
  metricKey: HighlightMetric & string;
  labelKey:  "lowestFoodCost" | "lowestLaborCost" | "bestPrimeCost";
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

  const withData  = locations.filter((l) => l.metrics[def.metricKey as keyof LocationSummary["metrics"]] !== null) as LocationSummary[];
  const allHaveData = withData.length === locations.length && locations.length > 0;
  const sorted    = [...withData].sort(
    (a, b) =>
      (a.metrics[def.metricKey as keyof LocationSummary["metrics"]] as number) -
      (b.metrics[def.metricKey as keyof LocationSummary["metrics"]] as number)
  );

  const best    = sorted[0];
  const worst   = sorted[sorted.length - 1];
  const others  = sorted.slice(1);

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
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-[15px] font-bold leading-none ${isActive ? "text-[#3dbf8a]" : "text-[#555]"}`}>↓</span>
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${isActive ? "text-[#3dbf8a]" : "text-[#555]"}`}>
          {ml[def.labelKey]}
        </p>
        <span className={`ml-auto text-[10px] italic ${isActive ? "text-[#3dbf8a]/70" : "text-[#333]"}`}>
          {ml.lowerIsBetter}
        </span>
      </div>

      {withData.length === 0 && (
        <p className="text-[12px] text-[#444] italic">{ml.missingData}</p>
      )}

      {best && (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[#3dbf8a] font-semibold text-[14px] truncate">{best.name}</span>
            <span className="text-[#555] text-[12px] shrink-0">{ml.at}</span>
            <span className="text-white font-bold text-[18px] shrink-0">{bestVal?.toFixed(1)}%</span>
          </div>

          {gap !== null && gap > 0 && worst && (
            <p className="text-[12px] text-[#888]">
              <span className="text-[#3dbf8a] font-semibold">{gap.toFixed(1)}%</span>
              {" "}{ml.betterThan}{" "}
              <span className="text-[#666]">{worst.name}</span>
              {" "}
              <span className="text-[#444]">({worstVal?.toFixed(1)}%)</span>
            </p>
          )}

          {!allHaveData && locations.length > withData.length && (
            <p className="text-[11px] text-[#444] italic mt-1">{ml.missingData}</p>
          )}

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

      {isActive && (
        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#3dbf8a]" />
      )}
    </button>
  );
}

// ── Add Location Modal ────────────────────────────────────────────────────────

function AddLocationModal({
  onClose,
  onSubmit,
  adding,
  error,
}: {
  onClose:  () => void;
  onSubmit: (name: string, phone: string, gmName: string, gmEmail: string) => void;
  adding:   boolean;
  error:    string | null;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;
  const [name,    setName]    = useState("");
  const [phone,   setPhone]   = useState("");
  const [gmName,  setGmName]  = useState("");
  const [gmEmail, setGmEmail] = useState("");

  const inputCls = "w-full bg-[#111] border border-[#222] rounded-[8px] px-3 py-2 text-[13px] text-white placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";
  const labelCls = "block text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-1.5";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !gmName.trim() || !gmEmail.trim()) return;
    onSubmit(name.trim(), phone.trim(), gmName.trim(), gmEmail.trim());
  }

  const canSubmit = name.trim() && gmName.trim() && gmEmail.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[#0a0a0a] border border-[#1a1a1a] rounded-[14px] p-6 shadow-2xl">
        <h2 className="text-[16px] font-semibold text-white mb-5">{ml.addLocationTitle}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Location Name */}
          <div>
            <label className={labelCls}>
              {ml.locationNameLabel} <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={ml.locationNamePh}
              maxLength={50}
              required
              className={inputCls}
            />
          </div>
          {/* Phone (optional) */}
          <div>
            <label className={labelCls}>{ml.locationPhoneLabel}</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={ml.locationPhonePh}
              maxLength={30}
              className={inputCls}
            />
          </div>
          {/* Divider */}
          <div className="border-t border-[#1a1a1a] pt-1">
            <p className="text-[10px] text-[#444] uppercase tracking-wider mb-3">Manager / Admin</p>
          </div>
          {/* GM Name */}
          <div>
            <label className={labelCls}>
              {ml.gmNameLabel} <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              value={gmName}
              onChange={(e) => setGmName(e.target.value)}
              placeholder={ml.gmNamePh}
              maxLength={100}
              required
              className={inputCls}
            />
          </div>
          {/* GM Email */}
          <div>
            <label className={labelCls}>
              {ml.gmEmailLabel} <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="email"
              value={gmEmail}
              onChange={(e) => setGmEmail(e.target.value)}
              placeholder={ml.gmEmailPh}
              maxLength={254}
              required
              className={inputCls}
            />
          </div>
          {/* Error */}
          {error && (
            <p className="text-[12px] text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-[6px] px-3 py-2">
              {error}
            </p>
          )}
          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-9 rounded-[8px] border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#444] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={adding || !canSubmit}
              className="flex-1 h-9 rounded-[8px] bg-[#3dbf8a] text-[13px] font-semibold text-[#0a0a0a] hover:bg-[#4dcf9a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {adding ? ml.creating : ml.createLocation}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Confirm Delete Modal ───────────────────────────────────────────────────────

function ConfirmDeleteModal({
  location,
  onClose,
  onConfirm,
  deleting,
}: {
  location: LocationSummary;
  onClose:  () => void;
  onConfirm: () => void;
  deleting:  boolean;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[#0a0a0a] border border-[#1a1a1a] rounded-[14px] p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-[#ef4444]/10 flex items-center justify-center shrink-0">
            <svg className="w-4.5 h-4.5 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-white">{ml.deleteLocationTitle}</h2>
            <p className="text-[12px] text-[#ef4444] font-medium mt-0.5">{location.name}</p>
          </div>
        </div>
        <p className="text-[13px] text-[#888] leading-relaxed mb-5">{ml.deleteLocationBody}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="flex-1 h-9 rounded-[8px] border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#444] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 h-9 rounded-[8px] bg-[#ef4444] text-[13px] font-semibold text-white hover:bg-[#ff5555] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? "Deleting…" : ml.deleteConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Suspense fallback for lazy tabs ───────────────────────────────────────────

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner size="lg" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 3;

export function MultiLocationOverview() {
  const { t }       = useLanguage();
  const navigate    = useNavigate();

  const ml          = t.multiLocation;

  const [locations,         setLocations]         = useState<LocationSummary[]>(() =>
    isLocCacheValid() ? _locCache!.data : []
  );
  const [loading,           setLoading]           = useState(!isLocCacheValid());
  const [refreshing,        setRefreshing]        = useState(false);
  const [fetchError,        setFetchError]        = useState(false);
  const [showAll,           setShowAll]           = useState(false);
  const [selected,          setSelected]          = useState<string>(readStoredLocation);
  const [highlightedMetric, setHighlightedMetric] = useState<HighlightMetric>(null);
  const [activeTab,         setActiveTab]         = useState<"overview" | "recipes" | "vendor" | "prime-cost">("overview");

  // ── Location management state ─────────────────────────────────────────────
  const [capacity,    setCapacity]    = useState<LocationCapacity | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding,      setAdding]      = useState(false);
  const [addError,    setAddError]    = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocationSummary | null>(null);
  const [deleting,    setDeleting]    = useState(false);
  const [toastMsg,    setToastMsg]    = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  function fetchLocations(bust = false) {
    if (!bust && isLocCacheValid()) return; // already seeded from cache in useState
    const isSilent = !loading; // if already have data, refresh silently
    if (isSilent) setRefreshing(true); else setLoading(true);
    setFetchError(false);
    Promise.all([locationsApi.overview(), locationsApi.capacity()])
      .then(([data, cap]) => {
        _locCache = { data, at: Date.now() };
        setLocations(data);
        setCapacity(cap);
        setFetchError(false);
      })
      .catch((err) => {
        const status = (err as any)?.response?.status;
        if (status !== 401 && status !== 403) setFetchError(true);
      })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  async function handleAddLocation(name: string, phone: string, gmName: string, gmEmail: string) {
    setAdding(true);
    setAddError(null);
    try {
      await locationsApi.addBranch({
        name,
        phone:   phone   || undefined,
        gmName,
        gmEmail,
      });
      setShowAddModal(false);
      _locCache = null;
      fetchLocations(true);
      showToast(`"${name}" ${ml.locationAdded}`);
    } catch (err: any) {
      const msg = err?.response?.data?.error;
      setAddError(msg ?? "Failed to create location.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteLocation() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await locationsApi.deleteBranch(deleteTarget.restaurantId);
      const name = deleteTarget.name;
      setDeleteTarget(null);
      _locCache = null;
      fetchLocations(true);
      showToast(`"${name}" ${ml.locationDeleted}`);
    } catch (err: any) {
      console.error("Delete location failed:", err);
    } finally {
      setDeleting(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchLocations(); }, []);

  function handleSelect(id: string) {
    writeStoredLocation(id);
    setSelected(id);
    // Note: we do NOT navigate to "/" here. For primary multi-location users, navigating to
    // "/" would immediately redirect back to "/multi-location" (causing a loop). The switcher
    // is used purely to highlight a specific location card in this view.
  }

  function toggleHighlight(metric: HighlightMetric & string) {
    setHighlightedMetric((prev) => (prev === metric ? null : metric));
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
                onClick={() => fetchLocations(true)}
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
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {/* Capacity counter */}
            {capacity && (
              <span className="text-[11px] text-[#444] whitespace-nowrap">
                {capacity.used} {ml.locationAtLimit} {capacity.limit} {ml.locationSlots}
              </span>
            )}
            {/* Add Location button */}
            {capacity?.canAdd && (
              <button
                onClick={() => { setShowAddModal(true); setAddError(null); }}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#3dbf8a]/40 bg-[#3dbf8a]/10 text-[12px] font-medium text-[#3dbf8a] hover:bg-[#3dbf8a]/20 hover:border-[#3dbf8a]/60 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {ml.addLocation}
              </button>
            )}
            {/* At-limit badge */}
            {capacity && !capacity.canAdd && (
              <span className="inline-flex items-center h-9 px-3 rounded-lg border border-[#2a2a2a] text-[11px] text-[#555] italic whitespace-nowrap">
                {ml.locationLimitReached}
              </span>
            )}
            {/* Manual refresh button */}
            <button
              onClick={() => fetchLocations(true)}
              disabled={refreshing}
              title="Refresh location data"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] text-[11px] text-[#555] hover:text-[#3dbf8a] hover:border-[#3dbf8a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <LocationSwitcher locations={locations} selected={selected} onSelect={handleSelect} />
          </div>
        )}
        {(activeTab === "recipes" || activeTab === "vendor" || activeTab === "prime-cost") && (
          <span className="text-[11px] text-[#333] italic">{ml.allLocSubtitle}</span>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-[8px] p-1 w-fit flex-wrap">
        {(["overview", "recipes", "vendor", "prime-cost"] as const).map((tab) => {
          const label =
            tab === "overview"    ? ml.tabOverview   :
            tab === "recipes"     ? ml.tabRecipes     :
            tab === "vendor"      ? ml.tabVendor      :
                                    ml.tabPrimeCost;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-[6px] text-[12px] font-medium transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "bg-[#1a1a1a] text-white shadow-sm"
                  : "text-[#555] hover:text-[#888]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Recipe Comparison tab (lazy) ───────────────────────────────────── */}
      {activeTab === "recipes" && (
        <Suspense fallback={<TabFallback />}>
          <RecipeComparisonTab />
        </Suspense>
      )}

      {/* ── Vendor Pricing tab (lazy) ──────────────────────────────────────── */}
      {activeTab === "vendor" && (
        <Suspense fallback={<TabFallback />}>
          <VendorPricingTab />
        </Suspense>
      )}

      {/* ── Prime Cost Analysis tab (lazy) ─────────────────────────────────── */}
      {activeTab === "prime-cost" && (
        <Suspense fallback={<TabFallback />}>
          <PrimeCostAnalysis />
        </Suspense>
      )}

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

      {/* Location cards — show skeletons while a silent refresh is in progress */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch">
        {refreshing
          ? Array.from({ length: Math.max(visible.length, 1) }).map((_, i) => (
              <SkeletonCard key={i} />
            ))
          : visible.map((loc) => (
              <LocationCard
                key={loc.restaurantId}
                loc={loc}
                highlightedMetric={highlightedMetric}
                onDeleteClick={!loc.isPrimary ? () => setDeleteTarget(loc) : undefined}
              />
            ))
        }
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

      {/* ── Add Location Modal ─────────────────────────────────────────────── */}
      {showAddModal && (
        <AddLocationModal
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddLocation}
          adding={adding}
          error={addError}
        />
      )}

      {/* ── Confirm Delete Modal ───────────────────────────────────────────── */}
      {deleteTarget && (
        <ConfirmDeleteModal
          location={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteLocation}
          deleting={deleting}
        />
      )}

      {/* ── Toast notification ─────────────────────────────────────────────── */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] shadow-xl shadow-black/60 text-[13px] text-white">
            <svg className="w-3.5 h-3.5 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            {toastMsg}
          </div>
        </div>
      )}

    </div>
  );
}
