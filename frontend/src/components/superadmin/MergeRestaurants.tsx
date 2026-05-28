import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminApi } from "../../api/superAdmin";
import { useToast } from "../../context/ToastContext";
import { Spinner, PageSpinner } from "../shared/Spinner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StandaloneRestaurant {
  id:            string;
  name:          string;
  locationCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 bg-[#111] border border-[#1a1a1a] rounded-[6px] text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors";

// ── Main page ─────────────────────────────────────────────────────────────────

export function MergeRestaurants() {
  const navigate = useNavigate();
  const toast    = useToast();

  const [restaurants, setRestaurants] = useState<StandaloneRestaurant[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [merging,     setMerging]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const [parentId,  setParentId]  = useState("");
  const [childIds,  setChildIds]  = useState<string[]>([]);

  // ── Fetch standalone restaurants on mount ─────────────────────────────────

  useEffect(() => {
    superAdminApi.listStandaloneRestaurants()
      .then(setRestaurants)
      .catch(() => toast.error("Failed to load restaurants"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const parent         = restaurants.find((r) => r.id === parentId) ?? null;
  const totalAfterMerge = 1 + childIds.length;
  const exceedsLimit   = parent !== null && totalAfterMerge > parent.locationCount;
  // Note: we auto-bump locationCount server-side, so this is only informational.

  // ── Handlers ─────────────────────────────────────────────────────────────

  function toggleChild(id: string) {
    setError(null);
    if (childIds.includes(id)) {
      setChildIds((prev) => prev.filter((c) => c !== id));
    } else {
      if (childIds.length >= 3) {
        toast.error("Maximum 3 locations per merge operation");
        return;
      }
      setChildIds((prev) => [...prev, id]);
    }
  }

  async function handleMerge() {
    setError(null);

    if (!parentId) {
      setError("Please select a parent restaurant.");
      return;
    }
    if (childIds.length === 0) {
      setError("Select at least one restaurant to merge under the parent.");
      return;
    }

    setMerging(true);
    try {
      const result = await superAdminApi.mergeRestaurants({ parentId, childIds });
      toast.success(result.message);
      setParentId("");
      setChildIds([]);
      setTimeout(() => navigate("/super-admin"), 1500);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Merge failed. Please try again.";
      setError(msg);
    } finally {
      setMerging(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <PageSpinner />;

  const childOptions = restaurants.filter((r) => r.id !== parentId);

  return (
    <div className="p-6 sm:p-8 max-w-2xl space-y-6">

      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/super-admin")}
          className="flex items-center gap-1.5 text-[12px] text-[#555] hover:text-white transition-colors mb-4"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </button>
        <h1 className="text-[22px] font-semibold text-white">Merge Restaurants</h1>
        <p className="text-[13px] text-[#555] mt-0.5">
          Combine standalone restaurants into a single multi-location group.
        </p>
      </div>

      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-[12px] p-6 space-y-6">

        {/* Step 1 — Parent */}
        <div>
          <label className="block text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-2">
            1 · Parent (Group Owner)
          </label>
          <select
            value={parentId}
            onChange={(e) => { setParentId(e.target.value); setChildIds([]); setError(null); }}
            className={inputCls}
          >
            <option value="">Select parent restaurant…</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — up to {r.locationCount} locations
              </option>
            ))}
          </select>
          <p className="text-[11px] text-[#444] mt-1">
            Only standalone restaurants are shown. The parent will own the group.
          </p>
        </div>

        {/* Step 2 — Children */}
        <div>
          <label className="block text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-2">
            2 · Restaurants to merge under parent (max 3)
          </label>

          {childOptions.length === 0 ? (
            <p className="text-[13px] text-[#444] italic py-4 text-center">
              {parentId ? "No other standalone restaurants available." : "Select a parent first."}
            </p>
          ) : (
            <div className="space-y-1 max-h-[260px] overflow-y-auto rounded-[6px] border border-[#1a1a1a] bg-[#111] p-2">
              {childOptions.map((r) => {
                const checked   = childIds.includes(r.id);
                const disabled  = !checked && childIds.length >= 3;
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] cursor-pointer transition-colors ${
                      checked ? "bg-[#3dbf8a]/10" : disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-[#1a1a1a]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleChild(r.id)}
                      className="w-4 h-4 rounded accent-[#3dbf8a]"
                    />
                    <span className={`text-[13px] font-medium ${checked ? "text-white" : "text-[#888]"}`}>
                      {r.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-[#444] mt-1.5">
            Selected: {childIds.length} / 3
          </p>
        </div>

        {/* Summary */}
        {parent && childIds.length > 0 && (
          <div className={`rounded-[8px] border p-4 space-y-2 ${
            exceedsLimit
              ? "border-[#f59e0b]/30 bg-[#f59e0b]/5"
              : "border-[#3dbf8a]/20 bg-[#3dbf8a]/5"
          }`}>
            <p className="text-[11px] font-semibold text-[#555] uppercase tracking-wider">Summary</p>
            <p className="text-[13px] text-white font-medium">
              {parent.name} will have {totalAfterMerge} location{totalAfterMerge !== 1 ? "s" : ""} total
              {exceedsLimit && (
                <span className="ml-2 text-[#f59e0b] text-[11px] font-normal">
                  (limit bumped automatically)
                </span>
              )}
            </p>
            <div className="space-y-0.5 pt-1">
              <div className="flex items-center gap-2 text-[12px] text-[#aaa]">
                <span className="text-[#3dbf8a]">✓</span>
                {parent.name}
                <span className="text-[#444] text-[10px]">(parent)</span>
              </div>
              {childIds.map((id) => {
                const child = restaurants.find((r) => r.id === id);
                return child ? (
                  <div key={id} className="flex items-center gap-2 text-[12px] text-[#aaa]">
                    <span className="text-[#3dbf8a]">✓</span>
                    {child.name}
                    <span className="text-[#444] text-[10px]">(branch)</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/20">
            <svg className="w-4 h-4 text-[#ef4444] mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[12px] text-[#ef4444]">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate("/super-admin")}
            disabled={merging}
            className="h-9 px-4 rounded-[6px] border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#444] disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={!parentId || childIds.length === 0 || merging}
            className="h-9 px-5 rounded-[6px] bg-[#3dbf8a] text-[13px] font-semibold text-[#0a0a0a] hover:bg-[#4dcf9a] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {merging && <Spinner size="sm" />}
            {merging ? "Merging…" : "Confirm Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
