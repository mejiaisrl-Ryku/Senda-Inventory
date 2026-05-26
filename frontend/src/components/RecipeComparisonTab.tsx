import React, { useState, useEffect, useRef } from "react";
import {
  locationsApi,
  RecipeComparison,
  LocationRecipeEntry,
} from "../api";
import { useLanguage } from "../context/LanguageContext";
import { Spinner } from "./shared/Spinner";

// ── Module-level cache (5-min TTL) ────────────────────────────────────────────

let _cache: { data: RecipeComparison[]; at: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

function isCacheValid() {
  return _cache !== null && Date.now() - _cache.at < CACHE_TTL;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function recipeRank(
  entry: { costPct?: number; restaurantId: string },
  sorted: { restaurantId: string }[]
): "best" | "worst" | "mid" {
  if (sorted.length <= 1) return "best";
  if (entry.restaurantId === sorted[0].restaurantId) return "best";
  if (entry.restaurantId === sorted[sorted.length - 1].restaurantId) return "worst";
  return "mid";
}

// ── Error box ─────────────────────────────────────────────────────────────────

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[#ef4444]/[0.06] border border-[#ef4444]/20">
      <svg className="w-4 h-4 text-[#ef4444] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <p className="text-[13px] text-[#ccc] flex-1">{message}</p>
      <button
        onClick={onRetry}
        className="shrink-0 px-3 py-1 text-[11px] font-semibold text-[#ef4444] border border-[#ef4444]/30 rounded-[5px] hover:bg-[#ef4444]/10 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

// ── Recipe location card ──────────────────────────────────────────────────────

function RecipeLocationCard({
  entry,
  rank,
  bestCost,
}: {
  entry:    LocationRecipeEntry;
  rank:     "best" | "worst" | "mid";
  bestCost: number | null;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;

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
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
            TEST
          </span>
        )}
        <p className="text-[12px] text-[#333] mt-1 italic">{ml.rcNotOffered}</p>
      </div>
    );
  }

  const rankBadge =
    rank === "best"  ? <span className="text-[10px] font-bold text-[#3dbf8a]">{ml.rcBest}</span>  :
    rank === "worst" ? <span className="text-[10px] font-bold text-[#ef4444]">{ml.rcHigh}</span> :
                       <span className="text-[10px] text-[#555]">{ml.rcMid}</span>;

  const costColor =
    rank === "best"  ? "text-[#3dbf8a]" :
    rank === "worst" ? "text-[#ef4444]"  :
                       "text-white";

  const dollarGap =
    bestCost !== null && entry.recipeCost !== undefined && rank !== "best"
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
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 shrink-0">
            TEST
          </span>
        )}
        {rankBadge}
      </div>

      {/* Cost summary */}
      <div className="space-y-2">
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-[#555] uppercase tracking-wider">{ml.rcCost}</span>
          <div className="flex items-baseline gap-1.5">
            {dollarGap !== null && dollarGap > 0 && (
              <span className="text-[10px] text-[#ef4444]">+${dollarGap.toFixed(2)}</span>
            )}
            <span className="text-[15px] font-bold text-white">${entry.recipeCost!.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-[#555] uppercase tracking-wider">{ml.rcCostPct}</span>
          <span className={`text-[15px] font-bold ${costColor}`}>{entry.costPct!.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] text-[#555] uppercase tracking-wider">{ml.rcSellPrice}</span>
          <span className="text-[13px] text-[#777]">${entry.sellingPrice!.toFixed(2)}</span>
        </div>
        {entry.hasInvoiceData && (
          <div className="flex items-center gap-1 pt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3dbf8a] shrink-0" />
            <span className="text-[10px] text-[#3dbf8a]/70">{ml.rcFromInvoice}</span>
          </div>
        )}
      </div>

      {/* Ingredients */}
      <div className="border-t border-[#111] pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#333] mb-2">
          {ml.rcIngredients}
        </p>
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
                    <span className="px-1 rounded bg-[#3dbf8a]/10 text-[#3dbf8a] text-[9px] font-semibold">
                      INV
                    </span>
                  )}
                </span>
                <span className="text-[#555]">= ${ing.lineTotal.toFixed(2)}</span>
              </div>
              {ing.fromInvoice && ing.purveyor && (
                <p className="text-[9px] text-[#333] mt-0.5">
                  {ing.purveyor}{ing.invoiceDate ? ` · ${ing.invoiceDate}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── RecipeComparisonTab ───────────────────────────────────────────────────────

export default function RecipeComparisonTab() {
  const { t } = useLanguage();
  const ml = t.multiLocation;

  // Seed state from cache if available
  const [comparisons, setComparisons] = useState<RecipeComparison[]>(() =>
    isCacheValid() ? _cache!.data : []
  );
  const [loading,    setLoading]    = useState(!isCacheValid());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected,   setSelected]   = useState<string | null>(() =>
    isCacheValid() && _cache!.data.length > 0 ? _cache!.data[0].recipeName : null
  );
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  function load(bustCache = false) {
    if (!bustCache && isCacheValid()) return; // served from cache already in useState
    setLoading(true);
    setFetchError(null);
    locationsApi.recipes()
      .then((data) => {
        _cache = { data, at: Date.now() };
        setComparisons(data);
        setFetchError(null);
        if (data.length > 0) setSelected((prev) => prev ?? data[0].recipeName);
      })
      .catch(() =>
        setFetchError("Unable to load recipes. Please try again.")
      )
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

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

  if (fetchError) {
    return <ErrorBox message={fetchError} onRetry={() => load(true)} />;
  }

  if (comparisons.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <svg className="w-8 h-8 text-[#2a2a2a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <p className="text-[14px] text-[#555]">{ml.rcEmpty}</p>
        <p className="text-[12px] text-[#333]">{ml.rcEmptyHint}</p>
      </div>
    );
  }

  const comparison = comparisons.find((c) => c.recipeName === selected);
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
        <p className="text-[12px] text-[#444] uppercase tracking-wider font-semibold shrink-0">
          {ml.rcSelectLabel}
        </p>
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
                  {comparisons.find((c) => c.recipeName === selected)?.department === "BAR" ? "🍹" : "🍳"}
                </span>
                <span className="flex-1 truncate">{selected}</span>
              </>
            ) : (
              <span className="flex-1 truncate text-[#555]">{ml.rcSelectHint}</span>
            )}
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${dropOpen ? "rotate-180 text-[#3dbf8a]" : "text-[#555]"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
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
                  <span className="text-[10px] text-[#333] uppercase font-semibold shrink-0">
                    {c.department}
                  </span>
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
            {(() => {
              const prices = comparison.locations.filter((l) => l.hasRecipe).map((l) => l.sellingPrice);
              const allSame = prices.length > 0 && prices.every((p) => p === prices[0]);
              return allSame ? (
                <span className="text-[13px] text-[#555]">
                  {ml.rcSellPrefix}{" "}
                  <span className="text-white font-semibold">${prices[0]!.toFixed(2)}</span>
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[12px] text-[#888]">
                <span className="text-[#3dbf8a] font-semibold">{sorted[0].locationName}</span>
                {" "}{ml.rcMakes}{" "}
                <span className="text-white font-semibold">${bestCost.toFixed(2)}</span>
                {" "}—{" "}
                <span className="text-[#3dbf8a] font-semibold">
                  ${(worstCost - bestCost).toFixed(2)} {ml.rcCheaper}{" "}
                  ({((worstCost - bestCost) / worstCost * 100).toFixed(1)}%)
                </span>
                {" "}{ml.rcCheaperThan}{" "}
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
