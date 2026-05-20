import React, { useCallback, useEffect, useRef, useState } from "react";
import { SalesCategory, SalesEntry } from "../types";
import { salesApi } from "../api";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner } from "./shared/Spinner";
import { EmptyState } from "./shared/EmptyState";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { Spinner } from "./shared/Spinner";
import { useAuth } from "../context/AuthContext";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: SalesCategory[] = ["BEER", "LIQUOR", "WINE", "FOOD", "NON_ALCOHOLIC"];

const CATEGORY_META: Record<
  SalesCategory,
  { label: string; badge: string; dot: string }
> = {
  BEER: {
    label: "Beer",
    badge: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
    dot: "bg-yellow-400",
  },
  LIQUOR: {
    label: "Liquor",
    badge: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
    dot: "bg-purple-400",
  },
  WINE: {
    label: "Wine",
    badge: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
    dot: "bg-red-400",
  },
  FOOD: {
    label: "Food",
    badge: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    dot: "bg-green-400",
  },
  NON_ALCOHOLIC: {
    label: "Non-Alcoholic",
    badge: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
    dot: "bg-blue-400",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Local-timezone today as YYYY-MM-DD */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** First day of current month as YYYY-MM-DD */
function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Format a @db.Date ISO string (midnight UTC) as a readable date */
function formatSaleDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

type AmountMap = Record<SalesCategory, string>;

const emptyAmounts = (): AmountMap =>
  Object.fromEntries(CATEGORIES.map((c) => [c, ""])) as AmountMap;

// ── Component ─────────────────────────────────────────────────────────────────

export function SalesPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();

  // Form state
  const [date, setDate] = useState(todayLocal());
  const [amounts, setAmounts] = useState<AmountMap>(emptyAmounts);
  const [submitting, setSubmitting] = useState(false);

  // Table state
  const [entries, setEntries] = useState<SalesEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStart, setFilterStart] = useState(firstOfMonth());
  const [filterEnd, setFilterEnd] = useState(todayLocal());
  const [deleteTarget, setDeleteTarget] = useState<SalesEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const firstAmountRef = useRef<HTMLInputElement>(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadEntries = useCallback(() => {
    salesApi
      .list({ startDate: filterStart, endDate: filterEnd })
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterStart, filterEnd]);

  useEffect(() => {
    setLoading(true);
    loadEntries();
  }, [loadEntries]);

  // ── Form submit ─────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const toCreate = CATEGORIES.flatMap((cat) => {
      const raw = amounts[cat].trim();
      if (!raw) return [];
      const parsed = parseFloat(raw);
      if (isNaN(parsed) || parsed <= 0) return [];
      return [{ date, category: cat, amount: Math.round(parsed * 100) / 100 }];
    });

    if (!toCreate.length) {
      toast.error("Enter at least one category amount.");
      return;
    }

    setSubmitting(true);
    try {
      await Promise.all(toCreate.map((payload) => salesApi.create(payload)));
      toast.success(
        toCreate.length === 1
          ? "Sales entry saved."
          : `${toCreate.length} sales entries saved.`
      );
      setAmounts(emptyAmounts());
      // Keep same date for quick multi-entry workflows
      loadEntries();
      firstAmountRef.current?.focus();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await salesApi.delete(deleteTarget.id);
      setEntries((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      toast.success("Entry deleted.");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  // ── Totals ──────────────────────────────────────────────────────────────────

  const totalByCategory = CATEGORIES.reduce<Record<SalesCategory, number>>(
    (acc, cat) => {
      acc[cat] = entries
        .filter((e) => e.category === cat)
        .reduce((s, e) => s + e.amount, 0);
      return acc;
    },
    {} as Record<SalesCategory, number>
  );

  const grandTotal = entries.reduce((s, e) => s + e.amount, 0);

  // ── Shared class strings ────────────────────────────────────────────────────

  const inputCls =
    "w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sales</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Record daily sales by category
        </p>
      </div>

      {/* ── Entry form ────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          New Entry
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Date */}
          <div className="max-w-xs">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Date
            </label>
            <input
              type="date"
              required
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Category amounts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CATEGORIES.map((cat, i) => {
              const meta = CATEGORY_META[cat];
              return (
                <div key={cat}>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                    {meta.label}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm pointer-events-none select-none">
                      $
                    </span>
                    <input
                      ref={i === 0 ? firstAmountRef : undefined}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={amounts[cat]}
                      onChange={(e) =>
                        setAmounts((prev) => ({ ...prev, [cat]: e.target.value }))
                      }
                      className={inputCls + " pl-7"}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {submitting && <Spinner size="sm" />}
              {submitting ? "Saving…" : "Save Sales"}
            </button>
            <button
              type="button"
              onClick={() => setAmounts(emptyAmounts())}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* ── Recent entries ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
        {/* Table header with filter */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Entries
            </h2>
            {!loading && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
                <span className="text-brand-500 font-medium">
                  {formatAmount(grandTotal)} total
                </span>
              </p>
            )}
          </div>

          {/* Date range filter */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
            <input
              type="date"
              value={filterStart}
              max={filterEnd}
              onChange={(e) => setFilterStart(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <span>–</span>
            <input
              type="date"
              value={filterEnd}
              min={filterStart}
              max={todayLocal()}
              onChange={(e) => setFilterEnd(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Category totals bar */}
        {!loading && entries.length > 0 && (
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-3">
            {CATEGORIES.filter((c) => totalByCategory[c] > 0).map((cat) => (
              <div key={cat} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_META[cat].badge}`}
                >
                  {CATEGORY_META[cat].label}
                </span>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {formatAmount(totalByCategory[cat])}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="py-12">
            <PageSpinner />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
            title="No sales entries"
            description="Add your first entry using the form above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Date
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Category
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Amount
                  </th>
                  <th className="px-5 py-3 w-12" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {entries.map((entry) => {
                  const meta = CATEGORY_META[entry.category];
                  return (
                    <tr
                      key={entry.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                    >
                      <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {formatSaleDate(entry.date)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-gray-900 dark:text-white whitespace-nowrap tabular-nums">
                        {formatAmount(entry.amount)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {isAdmin && (
                          <button
                            onClick={() => setDeleteTarget(entry)}
                            title="Delete entry"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title="Delete entry"
        message={
          deleteTarget
            ? `Remove the ${CATEGORY_META[deleteTarget.category].label} entry of ${formatAmount(deleteTarget.amount)} on ${formatSaleDate(deleteTarget.date)}?`
            : ""
        }
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
