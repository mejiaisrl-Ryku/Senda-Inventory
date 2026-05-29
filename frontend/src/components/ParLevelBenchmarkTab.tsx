import React, { useState, useEffect } from "react";
import {
  locationsApi,
  ParLevelBenchmarkResponse,
  ParLevelProduct,
  ParLevelLocation,
} from "../api";
import { useToast } from "../context/ToastContext";
import { PageSpinner, Spinner } from "./shared/Spinner";

// ── Module-level cache (10-min TTL) ────────────────────────────────────────────

let _cache: { data: ParLevelBenchmarkResponse; at: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

function isCacheValid() {
  return _cache !== null && Date.now() - _cache.at < CACHE_TTL;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function accuracyColor(v: number | null): string {
  if (v === null) return "text-[#444]";
  if (v >= 95)   return "text-[#3dbf8a]";
  if (v >= 90)   return "text-[#f59e0b]";
  return "text-[#ef4444]";
}

function diffColor(d: number): string {
  if (d > 5) return "text-[#ef4444]";
  if (d > 0) return "text-[#f59e0b]";
  return "text-[#3dbf8a]";
}

// For a given category name, find the matching entry in a location's data
function findCat(loc: ParLevelLocation, category: string) {
  return loc.parLevelsByCategory.find((c) => c.category === category) ?? null;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ParLevelBenchmarkTab() {
  const toast = useToast();

  const [data,    setData]    = useState<ParLevelBenchmarkResponse | null>(
    () => isCacheValid() ? _cache!.data : null
  );
  const [loading,  setLoading]  = useState(!isCacheValid());
  const [fetchErr, setFetchErr] = useState(false);

  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  // Copy dialog
  const [copyOpen,     setCopyOpen]     = useState(false);
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const [copyTargetId, setCopyTargetId] = useState<string | null>(null);
  const [copyCat,      setCopyCat]      = useState<string | null>(null);
  const [copyLoading,  setCopyLoading]  = useState(false);
  const [copyError,    setCopyError]    = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isCacheValid()) return;
    setLoading(true);
    setFetchErr(false);
    locationsApi.getParLevelBenchmark()
      .then((d) => {
        _cache = { data: d, at: Date.now() };
        setData(d);
        // Auto-select first category
        const first = d.locations[0]?.parLevelsByCategory[0]?.category ?? null;
        setSelectedCat((prev) => prev ?? first);
      })
      .catch(() => setFetchErr(true))
      .finally(() => setLoading(false));
  }, []);

  // ── Copy handler ─────────────────────────────────────────────────────────────
  async function handleCopy() {
    if (!copySourceId || !copyTargetId) return;
    setCopyLoading(true);
    setCopyError(null);
    try {
      await locationsApi.copyParLevels(copySourceId, copyTargetId, copyCat ?? undefined);
      toast.success("Par levels copied successfully!");
      // Bust cache and reload
      _cache = null;
      setCopyOpen(false);
      setCopyTargetId(null);
      setCopyCat(selectedCat);
      setLoading(true);
      const refreshed = await locationsApi.getParLevelBenchmark();
      _cache = { data: refreshed, at: Date.now() };
      setData(refreshed);
    } catch (err: any) {
      setCopyError(err?.response?.data?.error ?? "Failed to copy par levels. Please try again.");
    } finally {
      setCopyLoading(false);
      setLoading(false);
    }
  }

  function openCopyDialog(category: string) {
    const bench = data?.benchmark[category];
    setCopySourceId(bench?.bestLocation ?? null);
    setCopyTargetId(null);
    setCopyCat(category);
    setCopyError(null);
    setCopyOpen(true);
  }

  // ── Loading / error states ────────────────────────────────────────────────────
  if (loading && !data) return <PageSpinner />;

  if (fetchErr || !data) {
    return (
      <div className="flex items-start gap-3 px-4 py-4 rounded-[8px] bg-[#1a1a1a] border border-[#ef4444]/30">
        <svg className="w-4 h-4 text-[#ef4444] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-[13px] text-[#ccc]">Unable to load par level data. Please try again.</p>
      </div>
    );
  }

  if (data.locations.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[13px] text-[#555]">No par level data available.</p>
        <p className="text-[11px] text-[#333] mt-1">Set product minimum stock levels to see comparisons.</p>
      </div>
    );
  }

  // ── Derived data ─────────────────────────────────────────────────────────────
  const allCategories = [
    ...new Set(
      data.locations.flatMap((l) => l.parLevelsByCategory.map((c) => c.category))
    ),
  ].sort();

  const currentCat = selectedCat ?? allCategories[0] ?? "";
  const bench      = data.benchmark[currentCat] ?? null;

  // All unique productIds across locations for the current category
  const allProductIds = [
    ...new Set(
      data.locations.flatMap((loc) => {
        const cat = findCat(loc, currentCat);
        return cat ? cat.products.map((p) => p.productId) : [];
      })
    ),
  ];

  // Master product list (name + unit from first location that has it)
  const productMeta: Record<string, { name: string; unit: string }> = {};
  for (const loc of data.locations) {
    const cat = findCat(loc, currentCat);
    if (!cat) continue;
    for (const p of cat.products) {
      if (!productMeta[p.productId]) productMeta[p.productId] = { name: p.name, unit: p.unit };
    }
  }
  const sortedProducts = allProductIds.sort((a, b) =>
    (productMeta[a]?.name ?? "").localeCompare(productMeta[b]?.name ?? "")
  );

  // Find a product entry per location
  function getProduct(loc: ParLevelLocation, productId: string): ParLevelProduct | null {
    return findCat(loc, currentCat)?.products.find((p) => p.productId === productId) ?? null;
  }

  // Best performer name
  const bestLoc  = bench ? data.locations.find((l) => l.id === bench.bestLocation)  : null;
  const worstLoc = bench ? data.locations.find((l) => l.id === bench.worstLocation) : null;

  return (
    <div className="space-y-6">

      {/* ── Category selector ──────────────────────────────────────────────────── */}
      {allCategories.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[12px] font-semibold text-[#444] uppercase tracking-wider shrink-0">
            Category
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {allCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`px-3 py-1.5 rounded-[6px] text-[12px] font-medium transition-colors whitespace-nowrap ${
                  cat === currentCat
                    ? "bg-[#1a1a1a] text-white"
                    : "text-[#555] hover:text-[#888]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Benchmark cards ────────────────────────────────────────────────────── */}
      {bench && (bestLoc || worstLoc) && (
        <div className="grid grid-cols-2 gap-3">
          {bestLoc && (
            <div className="rounded-[10px] border border-[#3dbf8a]/30 bg-[#3dbf8a]/[0.06] p-4">
              <p className="text-[11px] font-semibold text-[#3dbf8a] uppercase tracking-wider mb-2">
                Best · {currentCat}
              </p>
              <p className="text-[14px] font-semibold text-white truncate">{bestLoc.name}</p>
              <p className="text-[11px] text-[#3dbf8a] mt-0.5">
                {bench.bestAccuracy.toFixed(1)}% avg accuracy
              </p>
            </div>
          )}
          {worstLoc && worstLoc.id !== bestLoc?.id && (
            <div className="rounded-[10px] border border-[#ef4444]/20 bg-[#ef4444]/[0.04] p-4">
              <p className="text-[11px] font-semibold text-[#ef4444] uppercase tracking-wider mb-2">
                Needs Attention
              </p>
              <p className="text-[14px] font-semibold text-white truncate">{worstLoc.name}</p>
              <p className="text-[11px] text-[#ef4444] mt-0.5">
                {bench.worstAccuracy.toFixed(1)}% avg accuracy
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Par levels table ────────────────────────────────────────────────────── */}
      {sortedProducts.length === 0 ? (
        <p className="text-[13px] text-[#555] italic text-center py-6">
          No products with par levels in this category.
        </p>
      ) : (
        <div className="rounded-[10px] border border-[#1a1a1a] bg-[#0a0a0a] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#111]">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-[#555] uppercase tracking-wider whitespace-nowrap">
                    Product
                  </th>
                  {data.locations.map((loc) => (
                    <th key={loc.id} className="px-3 py-3 text-right text-[11px] font-semibold text-[#555] uppercase tracking-wider whitespace-nowrap">
                      {loc.name}
                      {loc.isTest && (
                        <span className="ml-1 text-[8px] font-bold px-1 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 normal-case">
                          TEST
                        </span>
                      )}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right text-[11px] font-semibold text-[#555] uppercase tracking-wider">
                    Diff
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((productId) => {
                  const meta     = productMeta[productId];
                  const entries  = data.locations.map((loc) => getProduct(loc, productId));
                  const parVals  = entries.map((e) => e?.parLevel ?? null).filter((v): v is number => v !== null);
                  const maxPar   = parVals.length > 0 ? Math.max(...parVals) : null;
                  const minPar   = parVals.length > 0 ? Math.min(...parVals) : null;
                  const diff     = maxPar !== null && minPar !== null ? maxPar - minPar : 0;

                  return (
                    <tr key={productId} className="border-b border-[#0d0d0d] last:border-0 hover:bg-[#111]/50 transition-colors">
                      <td className="px-4 py-3 text-[13px] text-white max-w-[180px] truncate">
                        {meta?.name ?? "—"}
                      </td>
                      {data.locations.map((loc) => {
                        const entry = getProduct(loc, productId);
                        return (
                          <td key={loc.id} className="px-3 py-3 text-right">
                            {entry ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-[13px] font-medium text-white font-mono">
                                  {entry.parLevel.toFixed(1)} {entry.unit}
                                </span>
                                {entry.accuracy !== null && (
                                  <span className={`text-[10px] font-semibold ${accuracyColor(entry.accuracy)}`}>
                                    {entry.accuracy.toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[#333] text-[12px]">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={`px-3 py-3 text-right text-[13px] font-semibold font-mono ${diffColor(diff)}`}>
                        {diff > 0 ? `+${diff.toFixed(1)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Category avg accuracy row ───────────────────────────────────────────── */}
      {data.locations.some((l) => findCat(l, currentCat)?.avgAccuracy !== null) && (
        <div className="flex flex-wrap gap-3">
          {data.locations.map((loc) => {
            const cat = findCat(loc, currentCat);
            if (!cat || cat.avgAccuracy === null) return null;
            return (
              <div key={loc.id} className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[#0a0a0a] border border-[#1a1a1a]">
                <span className="text-[12px] text-[#888]">{loc.name}</span>
                <span className={`text-[12px] font-semibold ${accuracyColor(cat.avgAccuracy)}`}>
                  {cat.avgAccuracy.toFixed(1)}%
                </span>
              </div>
            );
          })}
          <span className="text-[10px] text-[#333] italic self-center">avg accuracy · {currentCat}</span>
        </div>
      )}

      {/* ── Copy par levels button ──────────────────────────────────────────────── */}
      {bench?.bestLocation && data.locations.length > 1 && (
        <button
          onClick={() => openCopyDialog(currentCat)}
          className="w-full py-2.5 px-4 rounded-[8px] bg-[#3dbf8a]/10 border border-[#3dbf8a]/30 text-[13px] font-semibold text-[#3dbf8a] hover:bg-[#3dbf8a]/20 transition-colors"
        >
          Copy {currentCat} par levels from best performer
        </button>
      )}

      {/* ── Copy dialog ──────────────────────────────────────────────────────────── */}
      {copyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!copyLoading) setCopyOpen(false); }}
          />
          <div className="relative bg-[#0a0a0a] border border-[#1a1a1a] rounded-[12px] p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div>
              <h3 className="text-[16px] font-semibold text-white">Copy Par Levels</h3>
              <p className="text-[12px] text-[#555] mt-0.5">
                Copy {copyCat ?? "all"} par level standards to another location
              </p>
            </div>

            <div className="space-y-4">
              {/* From (source — read-only, pre-filled with best performer) */}
              <div>
                <label className="block text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-1.5">
                  From (best performer)
                </label>
                <div className="px-3 py-2.5 rounded-[6px] bg-[#111] border border-[#1a1a1a] text-[13px] text-[#3dbf8a] font-medium">
                  {data.locations.find((l) => l.id === copySourceId)?.name ?? "—"}
                </div>
              </div>

              {/* To (user picks) */}
              <div>
                <label className="block text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-1.5">
                  To location
                </label>
                <select
                  value={copyTargetId ?? ""}
                  onChange={(e) => { setCopyTargetId(e.target.value || null); setCopyError(null); }}
                  className="w-full px-3 py-2.5 rounded-[6px] bg-[#111] border border-[#1a1a1a] text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                >
                  <option value="">Select location…</option>
                  {data.locations
                    .filter((l) => l.id !== copySourceId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                </select>
              </div>

              {/* Category scope */}
              <div>
                <label className="block text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-1.5">
                  Category scope
                </label>
                <select
                  value={copyCat ?? ""}
                  onChange={(e) => { setCopyCat(e.target.value || null); setCopyError(null); }}
                  className="w-full px-3 py-2.5 rounded-[6px] bg-[#111] border border-[#1a1a1a] text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                >
                  <option value="">All categories</option>
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            {copyError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/20">
                <svg className="w-4 h-4 text-[#ef4444] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-[12px] text-[#ef4444]">{copyError}</p>
              </div>
            )}

            <div className="px-3 py-2.5 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a]">
              <p className="text-[11px] text-[#666] leading-relaxed">
                Minimum stock (par level) values will be copied. Existing values at the target will be overwritten.
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { if (!copyLoading) { setCopyOpen(false); setCopyError(null); } }}
                disabled={copyLoading}
                className="flex-1 h-9 rounded-[6px] border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#444] disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCopy}
                disabled={!copyTargetId || copyLoading}
                className="flex-1 h-9 rounded-[6px] bg-[#3dbf8a] text-[13px] font-semibold text-[#0a0a0a] hover:bg-[#4dcf9a] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {copyLoading && <Spinner size="sm" />}
                {copyLoading ? "Copying…" : "Copy Par Levels"}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-[#333] italic text-center">
        Par levels = product minimum stock · accuracy from most recent closed count session
      </p>
    </div>
  );
}
