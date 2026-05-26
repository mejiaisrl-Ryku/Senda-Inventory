import React, { useState, useEffect, useRef } from "react";
import {
  locationsApi,
  ProductVendorComparison,
  LocationVendorPrice,
} from "../api";
import { useLanguage } from "../context/LanguageContext";
import { Spinner } from "./shared/Spinner";

// ── Module-level cache (5-min TTL) ────────────────────────────────────────────

let _cache: { data: ProductVendorComparison[]; at: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

function isCacheValid() {
  return _cache !== null && Date.now() - _cache.at < CACHE_TTL;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Vendor location card ──────────────────────────────────────────────────────

function VendorLocationCard({
  loc,
  item,
}: {
  loc:  LocationVendorPrice;
  item: ProductVendorComparison;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;

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
    rank === "best"  ? <span className="text-[10px] font-bold text-[#3dbf8a]">{ml.rcBest}</span>   :
    rank === "worst" ? <span className="text-[10px] font-bold text-[#ef4444]">{ml.vpHighest}</span> :
                       <span className="text-[10px] text-[#555]">{ml.rcMid}</span>;

  if (!loc.hasPurchases) {
    return (
      <div className="rounded-[10px] border border-[#1a1a1a] bg-[#080808] p-4 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-[#111] flex items-center justify-center shrink-0">
          <span className="text-[#333] text-[11px] font-bold">{loc.locationName[0].toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[#444] truncate">{loc.locationName}</p>
          {loc.isTest && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
              TEST
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#333] italic shrink-0">{ml.vpNoRecentPurch}</p>
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
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 shrink-0">
            TEST
          </span>
        )}
        {rankLabel}
      </div>

      {/* Volume summary */}
      <div className="flex items-center justify-between text-[11px] text-[#444] px-0.5">
        <span>{fmtQty(loc.totalQty30d)} {item.canonicalUnit}{ml.vpMo}</span>
        <span>${fmt$(loc.totalQty30d * (loc.bestNormalizedCost ?? 0))}/{ml.vpMonthSpend}</span>
      </div>

      {/* Purveyor rows */}
      <div className="space-y-1.5">
        {loc.purveyors.map((p, i) => {
          const isBestAtLoc    = i === 0;
          const gapVsGlobal    = p.normalizedCost - item.minCost;
          const gapPct         = item.minCost > 0 ? (gapVsGlobal / item.minCost) * 100 : 0;
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
                  <p className="text-[9px] text-[#444] mt-0.5">
                    {p.originalCost.toFixed(3)}/{p.originalUnit}
                  </p>
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
                        +${annualLocSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}{ml.vpYrCheapest}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[10px] text-[#3dbf8a] font-semibold">{ml.vpBestPrice}</p>
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[10px] text-[#888]">
            {ml.vpSwitchSaves}{" "}
            <span className="text-[#ef4444] font-semibold">${fmt$(annualSavings / 12)}{ml.vpMo}</span>
            {" · "}
            <span className="text-[#ef4444] font-semibold">
              ${annualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}{ml.vpYr}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

// ── VendorPricingTab ──────────────────────────────────────────────────────────

export default function VendorPricingTab() {
  const { t } = useLanguage();
  const ml = t.multiLocation;

  const [data,     setData]     = useState<ProductVendorComparison[]>(() =>
    isCacheValid() ? _cache!.data : []
  );
  const [loading,    setLoading]    = useState(!isCacheValid());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected,   setSelected]   = useState<string | null>(() => {
    if (!isCacheValid()) return null;
    const first = _cache!.data.find((x) => x.purchasingLocationCount > 1) ?? _cache!.data[0];
    return first?.productName ?? null;
  });
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  function load(bustCache = false) {
    if (!bustCache && isCacheValid()) return;
    setLoading(true);
    setFetchError(null);
    locationsApi.vendorPricing()
      .then((d) => {
        _cache = { data: d, at: Date.now() };
        setData(d);
        setFetchError(null);
        const first = d.find((x) => x.purchasingLocationCount > 1) ?? d[0];
        if (first) setSelected((prev) => prev ?? first.productName);
      })
      .catch(() =>
        setFetchError("Unable to load items. Please try again.")
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
    return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  }

  if (fetchError) {
    return <ErrorBox message={fetchError} onRetry={() => load(true)} />;
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <svg className="w-8 h-8 text-[#2a2a2a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-[14px] text-[#555]">{ml.vpNoData}</p>
        <p className="text-[12px] text-[#333]">{ml.vpNoDataHint}</p>
      </div>
    );
  }

  const item        = data.find((d) => d.productName === selected);
  const multiItems  = data.filter((d) => d.purchasingLocationCount > 1);
  const singleItems = data.filter((d) => d.purchasingLocationCount === 1);
  const totalSavings = multiItems.reduce((s, d) => s + d.maxAnnualSavings, 0);
  const totalSpend   = data.reduce((s, d) => s + d.totalSpend30d, 0);

  const sortedLocs = item
    ? [...item.locations].sort((a, b) => {
        const ra = vendorRank(a.bestNormalizedCost, item.minCost, item.maxCost);
        const rb = vendorRank(b.bestNormalizedCost, item.minCost, item.maxCost);
        return ({ best: 0, mid: 1, worst: 2 }[ra]) - ({ best: 0, mid: 1, worst: 2 }[rb]);
      })
    : [];

  return (
    <div className="space-y-5">

      {/* ── Portfolio summary ──────────────────────────────────────────────── */}
      {totalSavings > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 px-4 py-3 rounded-[10px] bg-[#0a0a0a] border border-[#1a1a1a]">
          <div className="flex items-center gap-2 flex-1">
            <svg className="w-4 h-4 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">{ml.vpTotalSavings}</p>
              <p className="text-[16px] font-bold text-[#3dbf8a]">
                ${totalSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                <span className="text-[11px] font-normal text-[#3dbf8a]/70">{ml.vpYr}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">{ml.vpMonthlySpend}</p>
              <p className="text-[14px] font-bold text-white">${fmt$(totalSpend)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">{ml.vpItemsCompared}</p>
              <p className="text-[14px] font-bold text-white">{multiItems.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Item selector ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-[12px] text-[#444] uppercase tracking-wider font-semibold shrink-0">
          {ml.vpSelectLabel}
        </p>
        <div ref={dropRef} className="relative flex-1 min-w-[260px] max-w-sm">
          <button
            onClick={() => setDropOpen((v) => !v)}
            className={`w-full flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-[8px] border text-[13px] font-medium transition-colors text-left ${
              dropOpen
                ? "border-[#3dbf8a] bg-[#0d0d0d] text-white"
                : "border-[#2a2a2a] bg-[#0a0a0a] text-[#aaa] hover:border-[#3a3a3a] hover:text-white"
            }`}
          >
            <span className="flex-1 truncate">{item ? item.productName : ml.vpSelectHint}</span>
            {item && item.maxAnnualSavings > 0 && (
              <span className="shrink-0 text-[10px] font-bold text-[#3dbf8a] bg-[#3dbf8a]/10 px-1.5 py-0.5 rounded">
                ${item.maxAnnualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}{ml.vpYr}
              </span>
            )}
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${dropOpen ? "rotate-180 text-[#3dbf8a]" : "text-[#555]"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-[10px] border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl shadow-black/60 overflow-hidden max-h-64 overflow-y-auto">
              {multiItems.length > 0 && (
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#333] border-b border-[#111]">
                  {ml.vpCrossLoc}
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
                      ${d.maxAnnualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}{ml.vpYr}
                    </span>
                  )}
                </button>
              ))}

              {singleItems.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#333] border-t border-b border-[#111]">
                    {ml.vpSingleLoc}
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
                      <span className="text-[10px] text-[#333] shrink-0">
                        {d.locations.find((l) => l.hasPurchases)?.locationName}
                      </span>
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
                {fmtQty(item.totalQty30d)} {item.canonicalUnit}{ml.vpMo} {ml.vpTotalAcross}{" "}
                {item.purchasingLocationCount}{" "}
                {item.purchasingLocationCount !== 1 ? ml.vpLocations : ml.vpLocation}
                {" · "}${fmt$(item.totalSpend30d)}/{ml.vpMonthSpend}
              </p>
            </div>
            {item.purchasingLocationCount > 1 && item.priceDelta > 0 && (
              <div className="text-right shrink-0">
                <p className="text-[11px] text-[#444] uppercase tracking-wider font-semibold">{ml.vpPriceGap}</p>
                <p className="text-[15px] font-bold text-[#ef4444]">
                  ${fmt$(item.priceDelta, 3)}{" "}
                  <span className="text-[12px]">({item.priceDeltaPct.toFixed(1)}%)</span>
                </p>
              </div>
            )}
          </div>

          {/* Volume leverage banner */}
          {item.purchasingLocationCount > 1 && item.monthlySavings > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-[8px] bg-[#3dbf8a]/[0.05] border border-[#3dbf8a]/15">
              <svg className="w-4 h-4 text-[#3dbf8a] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <div>
                <p className="text-[12px] text-[#888] leading-relaxed">
                  {ml.vpYouBuy}{" "}
                  <span className="text-white font-semibold">
                    {fmtQty(item.totalQty30d)} {item.canonicalUnit}{ml.vpMonthTotalAll}
                  </span>
                  {" "}{ml.vpConsolidates}{" "}
                  <span className="text-[#3dbf8a] font-bold">${fmt$(item.monthlySavings)}{ml.vpMo}</span>
                  {" "}·{" "}
                  <span className="text-[#3dbf8a] font-bold">
                    ${item.maxAnnualSavings.toLocaleString("en-US", { maximumFractionDigits: 0 })}{ml.vpYr}
                  </span>.
                </p>
              </div>
            </div>
          )}

          {/* Unit conversion note */}
          {item.hasUnitMismatch && item.conversionNote && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[#f59e0b]/[0.05] border border-[#f59e0b]/20">
              <svg className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[11px] text-[#f59e0b]/80">{ml.vpUnitMismatch} {item.conversionNote}</p>
            </div>
          )}

          {/* Single-location notice */}
          {item.purchasingLocationCount === 1 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a]">
              <svg className="w-3.5 h-3.5 text-[#555] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[12px] text-[#555]">
                {ml.vpOnlyAt}{" "}
                <span className="text-[#888] font-semibold">
                  {item.locations.find((l) => l.hasPurchases)?.locationName}
                </span>.
                {" "}{ml.vpOnlyAtCheck}
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
        {ml.vpFootnote} {item?.canonicalUnit ?? "common unit"}
      </p>
    </div>
  );
}
