import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CountEntry, CountSession } from "../types";
import { countsApi } from "../api";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner } from "./shared/Spinner";
import { Spinner } from "./shared/Spinner";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { unitLabel } from "../utils/stock";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

type DeptFilter = "ALL" | "KITCHEN" | "BAR" | "FOH";

const DEPT_TABS: { value: DeptFilter; label: string }[] = [
  { value: "ALL",     label: "All"     },
  { value: "KITCHEN", label: "Kitchen" },
  { value: "BAR",     label: "Bar"     },
  { value: "FOH",     label: "FOH"     },
];

/** Maps a DeptFilter to which product.department values match. */
function matchesDept(productDept: string, filter: DeptFilter): boolean {
  if (filter === "ALL")     return true;
  if (filter === "KITCHEN") return productDept === "BOH" || productDept === "BOTH";
  if (filter === "BAR")     return productDept === "BAR";
  if (filter === "FOH")     return productDept === "FOH" || productDept === "BOTH";
  return true;
}

// ── Variance cell ─────────────────────────────────────────────────────────────

function VarianceCell({ actual, expected }: { actual: string; expected: number }) {
  const parsed = parseFloat(actual);
  if (actual.trim() === "" || isNaN(parsed)) {
    return <span className="text-[#444] text-sm">—</span>;
  }
  const v = parsed - expected;
  const formatted = v === 0 ? "0" : (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  const cls =
    v === 0 ? "text-[#3dbf8a]" :
    v > 0   ? "text-amber-400"  :
              "text-red-400";
  return <span className={`text-sm font-semibold tabular-nums ${cls}`}>{formatted}</span>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CountSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast    = useToast();

  const [session, setSession]     = useState<CountSession | null>(null);
  const [loading, setLoading]     = useState(true);
  const [deptFilter, setDeptFilter] = useState<DeptFilter>("ALL");

  // productId → string value shown in actual qty input
  const [localQty, setLocalQty]   = useState<Record<string, string>>({});
  const [dirty, setDirty]         = useState(false);
  const [saving, setSaving]       = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing]     = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const s = await countsApi.get(id);
      setSession(s);
      // Initialize local qty from saved data
      const init: Record<string, string> = {};
      for (const e of s.entries ?? []) {
        init[e.productId] = e.actualQuantity > 0 ? String(e.actualQuantity) : "";
      }
      setLocalQty(init);
    } catch (err) {
      toast.error("Failed to load count session.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ── Derived data ────────────────────────────────────────────────────────────

  const entries: CountEntry[] = session?.entries ?? [];

  /** Entries filtered by current dept tab. */
  const filtered = useMemo(() => {
    if (deptFilter === "ALL") return entries;
    return entries.filter((e) =>
      matchesDept(String(e.product?.department ?? ""), deptFilter)
    );
  }, [entries, deptFilter]);

  /** Entries grouped by product category. */
  const grouped = useMemo(() => {
    const map = new Map<string, CountEntry[]>();
    for (const e of filtered) {
      const cat = e.product?.category ?? "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(e);
    }
    return map;
  }, [filtered]);

  /** Footer stats — computed live from localQty. */
  const { itemsCounted, totalVarianceValue } = useMemo(() => {
    let counted = 0;
    let varValue = 0;
    for (const e of entries) {
      const raw = localQty[e.productId] ?? "";
      if (raw.trim() === "") continue;
      const actual = parseFloat(raw);
      if (isNaN(actual)) continue;
      counted++;
      const variance = actual - e.expectedQuantity;
      varValue += variance * e.unitCost;
    }
    return { itemsCounted: counted, totalVarianceValue: varValue };
  }, [entries, localQty]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleQtyChange(productId: string, value: string) {
    setLocalQty((prev) => ({ ...prev, [productId]: value }));
    setDirty(true);
  }

  async function handleSave() {
    if (!id) return;
    const toSend = entries
      .filter((e) => {
        const raw = localQty[e.productId] ?? "";
        return raw.trim() !== "" && !isNaN(parseFloat(raw));
      })
      .map((e) => ({
        productId:      e.productId,
        actualQuantity: parseFloat(localQty[e.productId]),
      }));

    if (toSend.length === 0) {
      toast.error("Enter at least one actual quantity before saving.");
      return;
    }

    setSaving(true);
    try {
      await countsApi.updateEntries(id, toSend);
      setDirty(false);
      toast.success(`${toSend.length} ${toSend.length === 1 ? "entry" : "entries"} saved.`);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (!id) return;
    setClosing(true);
    try {
      // Save any pending changes first
      if (dirty) {
        const toSend = entries
          .filter((e) => {
            const raw = localQty[e.productId] ?? "";
            return raw.trim() !== "" && !isNaN(parseFloat(raw));
          })
          .map((e) => ({
            productId:      e.productId,
            actualQuantity: parseFloat(localQty[e.productId]),
          }));
        if (toSend.length > 0) {
          await countsApi.updateEntries(id, toSend);
        }
      }
      const closed = await countsApi.close(id);
      setSession((prev) => prev ? { ...prev, status: closed.status } : prev);
      setCloseOpen(false);
      toast.success("Count session closed.");
      navigate("/inventory");
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setClosing(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <PageSpinner />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-8">
        <p className="text-[#555]">Session not found.</p>
      </div>
    );
  }

  const isClosed = session.status === "CLOSED";
  const deptLabel = DEPT_TABS.find((d) => d.value === session.department)?.label ?? session.department;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] lg:min-h-screen">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#1a1a1a] px-4 sm:px-8 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate("/inventory")}
          className="flex items-center gap-1.5 text-[#888] hover:text-white transition-colors text-sm flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">Inventory</span>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[15px] font-semibold text-white">
              {formatDate(session.date)} — {deptLabel}
            </h1>
            {isClosed ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1a1a1a] text-[#555] font-semibold uppercase tracking-wide">
                Closed
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#3dbf8a]/15 text-[#3dbf8a] font-semibold uppercase tracking-wide">
                Open
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#555] mt-0.5">
            {entries.length} products · {itemsCounted} counted
          </p>
        </div>
      </div>

      {/* ── Dept filter tabs ─────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-8 pt-4 pb-2 flex-shrink-0">
        <div className="flex rounded-[8px] border border-[#2a2a2a] overflow-hidden w-fit">
          {DEPT_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setDeptFilter(value)}
              className={`px-4 py-2 text-[12px] font-semibold transition-colors ${
                deptFilter === value
                  ? "bg-[#3dbf8a] text-white"
                  : "bg-[#0a0a0a] text-[#555] hover:text-[#888]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Product table ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 pb-36">
        {grouped.size === 0 ? (
          <div className="py-16 text-center text-[#444] text-sm">
            No products match this filter.
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {[...grouped.entries()].map(([category, catEntries]) => (
              <div key={category}>
                {/* Category header */}
                <div className="sticky top-[57px] z-[5] py-2 bg-black/80 backdrop-blur-sm">
                  <h2 className="text-[11px] font-semibold text-[#444] uppercase tracking-[0.1em]">
                    {category}
                    <span className="ml-2 text-[#333]">({catEntries.length})</span>
                  </h2>
                </div>

                {/* Product rows */}
                <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
                  {/* Table header — desktop */}
                  <div className="hidden sm:grid grid-cols-[1fr_auto_80px_100px_100px_80px] gap-4 px-4 py-2 border-b border-[#1a1a1a]">
                    {["Product", "Purveyor", "Unit", "Expected", "Actual", "Variance"].map((h) => (
                      <span key={h} className="text-[10px] font-medium text-[#444] uppercase tracking-wider">
                        {h}
                      </span>
                    ))}
                  </div>

                  <div className="divide-y divide-[#111]">
                    {catEntries.map((entry) => {
                      const p = entry.product;
                      const qty = localQty[entry.productId] ?? "";
                      const unit = (p?.unit as keyof typeof unitLabel) ?? "PIECES";

                      return (
                        <div
                          key={entry.id}
                          className="grid grid-cols-1 sm:grid-cols-[1fr_auto_80px_100px_100px_80px]
                                     gap-2 sm:gap-4 px-4 py-3 sm:items-center"
                        >
                          {/* Name */}
                          <div>
                            <p className="text-[13px] font-medium text-white leading-snug">{p?.name ?? "—"}</p>
                            {p?.sku && <p className="text-[11px] text-[#444] mt-0.5">{p.sku}</p>}
                            {/* Mobile: show purveyor + unit inline */}
                            <p className="sm:hidden text-[11px] text-[#555] mt-0.5">
                              {p?.purveyor ? `${p.purveyor} · ` : ""}{unitLabel[unit] ?? unit}
                            </p>
                          </div>

                          {/* Purveyor — desktop only */}
                          <span className="hidden sm:block text-[12px] text-[#555] whitespace-nowrap">
                            {p?.purveyor ?? "—"}
                          </span>

                          {/* Unit — desktop only */}
                          <span className="hidden sm:block text-[12px] text-[#555]">
                            {unitLabel[unit] ?? unit}
                          </span>

                          {/* Expected */}
                          <div className="flex sm:block items-center gap-2">
                            <span className="sm:hidden text-[11px] text-[#444] w-20 flex-shrink-0">Expected</span>
                            <span className="text-[13px] text-[#666] tabular-nums">
                              {entry.expectedQuantity}
                            </span>
                          </div>

                          {/* Actual qty input */}
                          <div className="flex sm:block items-center gap-2">
                            <span className="sm:hidden text-[11px] text-[#444] w-20 flex-shrink-0">Actual</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              disabled={isClosed}
                              value={qty}
                              onChange={(e) => handleQtyChange(entry.productId, e.target.value)}
                              className={`
                                w-full sm:w-24 min-h-[48px] sm:min-h-[36px] px-3 rounded-xl text-[15px] sm:text-[13px]
                                font-semibold text-white text-center tabular-nums
                                border transition
                                ${qty !== ""
                                  ? "border-[#3dbf8a] bg-[#3dbf8a]/5"
                                  : "border-[#2a2a2a] bg-[#111]"
                                }
                                focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]
                                disabled:opacity-40 disabled:cursor-not-allowed
                              `}
                            />
                          </div>

                          {/* Variance */}
                          <div className="flex sm:block items-center gap-2">
                            <span className="sm:hidden text-[11px] text-[#444] w-20 flex-shrink-0">Variance</span>
                            <VarianceCell actual={qty} expected={entry.expectedQuantity} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Sticky footer ────────────────────────────────────────────────────── */}
      {!isClosed && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-[220px] z-20
                        bg-[#0a0a0a] border-t border-[#1a1a1a]
                        px-4 sm:px-8 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
            {/* Stats */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="text-center">
                <p className="text-[10px] text-[#444] uppercase tracking-wider">Counted</p>
                <p className="text-[16px] font-semibold text-white tabular-nums">{itemsCounted}</p>
              </div>
              <div className="w-px h-8 bg-[#1a1a1a]" />
              <div className="text-center">
                <p className="text-[10px] text-[#444] uppercase tracking-wider">Variance $</p>
                <p className={`text-[16px] font-semibold tabular-nums ${
                  totalVarianceValue === 0 ? "text-[#3dbf8a]"
                  : totalVarianceValue > 0 ? "text-amber-400"
                  : "text-red-400"
                }`}>
                  {totalVarianceValue >= 0 ? "+" : ""}{formatCurrency(totalVarianceValue)}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2
                           min-h-[48px] px-5 bg-[#3dbf8a] hover:bg-[#35a87a]
                           disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {saving && <Spinner size="sm" />}
                {saving ? "Saving…" : dirty ? "Save Progress" : "Saved ✓"}
              </button>
              <button
                onClick={() => setCloseOpen(true)}
                disabled={saving}
                className="flex-1 sm:flex-none inline-flex items-center justify-center
                           min-h-[48px] px-5 border border-[#2a2a2a] text-[#888]
                           hover:border-[#555] hover:text-white text-sm font-semibold
                           rounded-xl transition-colors disabled:opacity-50"
              >
                Close Count
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Closed session banner */}
      {isClosed && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-[220px] z-20
                        bg-[#0a0a0a] border-t border-[#1a1a1a]
                        px-4 sm:px-8 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-[#555]">
              This session is closed · Final variance:{" "}
              <span className={`font-semibold ${totalVarianceValue < 0 ? "text-red-400" : "text-amber-400"}`}>
                {totalVarianceValue >= 0 ? "+" : ""}{formatCurrency(totalVarianceValue)}
              </span>
            </span>
            <button
              onClick={() => navigate("/inventory")}
              className="ml-auto text-[13px] text-[#3dbf8a] hover:underline"
            >
              ← All Sessions
            </button>
          </div>
        </div>
      )}

      {/* Close confirm dialog */}
      <ConfirmDialog
        open={closeOpen}
        title="Close count session"
        message="This will finalize all variances and lock the session. You won't be able to edit entries after closing."
        confirmLabel="Close Count"
        variant="danger"
        loading={closing}
        onConfirm={handleClose}
        onCancel={() => setCloseOpen(false)}
      />
    </div>
  );
}
