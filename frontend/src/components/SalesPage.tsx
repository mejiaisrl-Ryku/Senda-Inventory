import React, { useCallback, useEffect, useRef, useState } from "react";
import { LaborEntry, SalesCategory, SalesEntry } from "../types";
import { laborApi, salesApi } from "../api";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner } from "./shared/Spinner";
import { EmptyState } from "./shared/EmptyState";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { Spinner } from "./shared/Spinner";
import { useAuth } from "../context/AuthContext";

// ── Constants ─────────────────────────────────────────────────────────────────

const SALES_CATEGORIES: SalesCategory[] = [
  "BEER", "LIQUOR", "WINE", "FOOD", "NON_ALCOHOLIC", "EVENTS", "DELIVERY",
];

const CATEGORY_META: Record<SalesCategory, { label: string; badge: string; dot: string }> = {
  BEER:          { label: "Beer",          badge: "bg-yellow-900/30 text-yellow-400", dot: "bg-yellow-400" },
  LIQUOR:        { label: "Liquor",        badge: "bg-purple-900/30 text-purple-400", dot: "bg-purple-400" },
  WINE:          { label: "Wine",          badge: "bg-red-900/30 text-red-400",       dot: "bg-red-400"    },
  FOOD:          { label: "Food",          badge: "bg-green-900/30 text-green-400",   dot: "bg-green-400"  },
  NON_ALCOHOLIC: { label: "Non-Alcoholic", badge: "bg-blue-900/30 text-blue-400",     dot: "bg-blue-400"   },
  EVENTS:        { label: "Events",        badge: "bg-pink-900/30 text-pink-400",     dot: "bg-pink-400"   },
  DELIVERY:      { label: "Delivery",      badge: "bg-orange-900/30 text-orange-400", dot: "bg-orange-400" },
};

const LABOR_FIELDS = [
  { key: "fohLabor",   label: "FOH Labor"   },
  { key: "bohLabor",   label: "BOH Labor"   },
  { key: "management", label: "Management"  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

function formatMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

type SalesAmountMap = Record<SalesCategory, string>;
type LaborAmountMap = Record<"fohLabor" | "bohLabor" | "management", string>;

const emptySales = (): SalesAmountMap =>
  Object.fromEntries(SALES_CATEGORIES.map((c) => [c, ""])) as SalesAmountMap;

const emptyLabor = (): LaborAmountMap => ({ fohLabor: "", bohLabor: "", management: "" });

// ── Shared input styles ───────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-[#2a2a2a] bg-[#111] text-white text-sm " +
  "focus:outline-none focus:ring-1 focus:ring-[#3dbf8a] focus:border-[#3dbf8a] transition placeholder-[#444]";

// ── Component ─────────────────────────────────────────────────────────────────

export function SalesPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<"sales" | "labor">("sales");

  // Shared date-range filter (both tabs)
  const [filterStart, setFilterStart] = useState(firstOfMonth());
  const [filterEnd, setFilterEnd]     = useState(todayLocal());

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold text-white">Sales</h1>
        <p className="text-[13px] text-[#555] mt-1">Record daily sales and labor costs</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded-[8px] border border-[#2a2a2a] overflow-hidden w-fit">
        {(["sales", "labor"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-2 text-[13px] font-semibold capitalize transition-colors ${
              activeTab === tab
                ? "bg-[#3dbf8a] text-white"
                : "bg-[#0a0a0a] text-[#555] hover:text-[#888]"
            }`}
          >
            {tab === "sales" ? "Sales" : "Labor"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "sales" ? (
        <SalesTab
          isAdmin={isAdmin}
          toast={toast}
          filterStart={filterStart}
          filterEnd={filterEnd}
          setFilterStart={setFilterStart}
          setFilterEnd={setFilterEnd}
        />
      ) : (
        <LaborTab
          isAdmin={isAdmin}
          toast={toast}
          filterStart={filterStart}
          filterEnd={filterEnd}
          setFilterStart={setFilterStart}
          setFilterEnd={setFilterEnd}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Sales Tab
// ══════════════════════════════════════════════════════════════════════════════

function SalesTab({
  isAdmin,
  toast,
  filterStart,
  filterEnd,
  setFilterStart,
  setFilterEnd,
}: {
  isAdmin: boolean;
  toast: ReturnType<typeof useToast>;
  filterStart: string;
  filterEnd: string;
  setFilterStart: (v: string) => void;
  setFilterEnd: (v: string) => void;
}) {
  const [date, setDate]           = useState(todayLocal());
  const [amounts, setAmounts]     = useState<SalesAmountMap>(emptySales);
  const [submitting, setSubmitting] = useState(false);
  const [entries, setEntries]     = useState<SalesEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SalesEntry | null>(null);
  const [deleting, setDeleting]   = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const loadEntries = useCallback(() => {
    salesApi.list({ startDate: filterStart, endDate: filterEnd })
      .then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }, [filterStart, filterEnd]);

  useEffect(() => { setLoading(true); loadEntries(); }, [loadEntries]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const toCreate = SALES_CATEGORIES.flatMap((cat) => {
      const raw = amounts[cat].trim();
      if (!raw) return [];
      const parsed = parseFloat(raw);
      if (isNaN(parsed) || parsed <= 0) return [];
      return [{ date, category: cat, amount: Math.round(parsed * 100) / 100 }];
    });
    if (!toCreate.length) { toast.error("Enter at least one category amount."); return; }

    setSubmitting(true);
    try {
      await Promise.all(toCreate.map((p) => salesApi.create(p)));
      toast.success(toCreate.length === 1 ? "Sales entry saved." : `${toCreate.length} entries saved.`);
      setAmounts(emptySales());
      loadEntries();
      firstRef.current?.focus();
    } catch (err) { toast.error(getApiError(err)); }
    finally { setSubmitting(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await salesApi.delete(deleteTarget.id);
      setEntries((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      toast.success("Entry deleted.");
      setDeleteTarget(null);
    } catch (err) { toast.error(getApiError(err)); }
    finally { setDeleting(false); }
  }

  const totalByCategory = SALES_CATEGORIES.reduce<Record<SalesCategory, number>>(
    (acc, cat) => { acc[cat] = entries.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0); return acc; },
    {} as Record<SalesCategory, number>
  );
  const grandTotal = entries.reduce((s, e) => s + e.amount, 0);

  return (
    <>
      {/* Entry form */}
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-5">
        <h2 className="text-[13px] font-semibold text-[#888] mb-4 uppercase tracking-[0.08em]">New Entry</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-w-xs">
            <label className="block text-[11px] font-medium text-[#666] mb-1">Date</label>
            <input type="date" required value={date} max={todayLocal()}
              onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {SALES_CATEGORIES.map((cat, i) => {
              const meta = CATEGORY_META[cat];
              return (
                <div key={cat}>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#666] mb-1">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                    {meta.label}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#444] text-sm pointer-events-none">$</span>
                    <input
                      ref={i === 0 ? firstRef : undefined}
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={amounts[cat]}
                      onChange={(e) => setAmounts((prev) => ({ ...prev, [cat]: e.target.value }))}
                      className={inputCls + " pl-7"}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors">
              {submitting && <Spinner size="sm" />}
              {submitting ? "Saving…" : "Save Sales"}
            </button>
            <button type="button" onClick={() => setAmounts(emptySales())}
              className="text-sm text-[#555] hover:text-[#888] transition-colors">
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* Entries table */}
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl">
        {/* Header + filter */}
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="text-[13px] font-semibold text-[#888] uppercase tracking-[0.08em]">Entries</h2>
            {!loading && (
              <p className="text-[12px] text-[#444] mt-0.5">
                {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
                <span className="text-[#3dbf8a] font-medium">{formatMXN(grandTotal)} total</span>
              </p>
            )}
          </div>
          <DateRangeFilter
            start={filterStart} end={filterEnd}
            onStartChange={setFilterStart} onEndChange={setFilterEnd}
          />
        </div>

        {/* Category totals bar */}
        {!loading && entries.length > 0 && (
          <div className="px-5 py-3 border-b border-[#1a1a1a] flex flex-wrap gap-2">
            {SALES_CATEGORIES.filter((c) => totalByCategory[c] > 0).map((cat) => (
              <div key={cat} className="flex items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${CATEGORY_META[cat].badge}`}>
                  {CATEGORY_META[cat].label}
                </span>
                <span className="text-[12px] font-semibold text-white">{formatMXN(totalByCategory[cat])}</span>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-12"><PageSpinner /></div>
        ) : entries.length === 0 ? (
          <EmptyState title="No sales entries" description="Add your first entry using the form above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Date", "Category", "Amount", ""].map((h) => (
                    <th key={h} className={`text-[11px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 ${h === "Amount" ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111]">
                {entries.map((entry) => {
                  const meta = CATEGORY_META[entry.category];
                  return (
                    <tr key={entry.id} className="hover:bg-[#111] transition-colors">
                      <td className="px-5 py-3.5 text-[#888] whitespace-nowrap">{formatDate(entry.date)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${meta.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-white tabular-nums">{formatMXN(entry.amount)}</td>
                      <td className="px-5 py-3.5 text-right">
                        {isAdmin && (
                          <button onClick={() => setDeleteTarget(entry)}
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-[#444] hover:text-red-400 hover:bg-red-900/20 transition-colors">
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

      <ConfirmDialog
        open={!!deleteTarget} variant="danger" title="Delete entry"
        message={deleteTarget ? `Remove the ${CATEGORY_META[deleteTarget.category].label} entry of ${formatMXN(deleteTarget.amount)} on ${formatDate(deleteTarget.date)}?` : ""}
        confirmLabel="Delete" loading={deleting}
        onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Labor Tab
// ══════════════════════════════════════════════════════════════════════════════

function LaborTab({
  isAdmin,
  toast,
  filterStart,
  filterEnd,
  setFilterStart,
  setFilterEnd,
}: {
  isAdmin: boolean;
  toast: ReturnType<typeof useToast>;
  filterStart: string;
  filterEnd: string;
  setFilterStart: (v: string) => void;
  setFilterEnd: (v: string) => void;
}) {
  const [date, setDate]             = useState(todayLocal());
  const [amounts, setAmounts]       = useState<LaborAmountMap>(emptyLabor);
  const [submitting, setSubmitting] = useState(false);
  const [entries, setEntries]       = useState<LaborEntry[]>([]);
  const [salesTotal, setSalesTotal] = useState<number | null>(null);
  const [loading, setLoading]       = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<LaborEntry | null>(null);
  const [deleting, setDeleting]     = useState(false);

  // Auto-calculated total from form inputs
  const formTotal =
    (parseFloat(amounts.fohLabor) || 0) +
    (parseFloat(amounts.bohLabor) || 0) +
    (parseFloat(amounts.management) || 0);

  const loadEntries = useCallback(() => {
    Promise.all([
      laborApi.list({ startDate: filterStart, endDate: filterEnd }),
      salesApi.list({ startDate: filterStart, endDate: filterEnd }),
    ])
      .then(([labor, sales]) => {
        setEntries(labor);
        setSalesTotal(sales.reduce((s, e) => s + e.amount, 0));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterStart, filterEnd]);

  useEffect(() => { setLoading(true); loadEntries(); }, [loadEntries]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fohLabor   = parseFloat(amounts.fohLabor)   || 0;
    const bohLabor   = parseFloat(amounts.bohLabor)   || 0;
    const management = parseFloat(amounts.management) || 0;
    if (fohLabor + bohLabor + management === 0) {
      toast.error("Enter at least one labor amount."); return;
    }
    setSubmitting(true);
    try {
      await laborApi.create({ date, fohLabor, bohLabor, management });
      toast.success("Labor entry saved.");
      setAmounts(emptyLabor());
      loadEntries();
    } catch (err) { toast.error(getApiError(err)); }
    finally { setSubmitting(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await laborApi.delete(deleteTarget.id);
      setEntries((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      toast.success("Entry deleted.");
      setDeleteTarget(null);
    } catch (err) { toast.error(getApiError(err)); }
    finally { setDeleting(false); }
  }

  const totalLabor = entries.reduce((s, e) => s + e.total, 0);
  const laborPct   = salesTotal && salesTotal > 0 ? (totalLabor / salesTotal) * 100 : null;

  return (
    <>
      {/* Entry form */}
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-5">
        <h2 className="text-[13px] font-semibold text-[#888] mb-4 uppercase tracking-[0.08em]">New Labor Entry</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-w-xs">
            <label className="block text-[11px] font-medium text-[#666] mb-1">Date</label>
            <input type="date" required value={date} max={todayLocal()}
              onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LABOR_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="block text-[11px] font-medium text-[#666] mb-1">{label}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#444] text-sm pointer-events-none">$</span>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={amounts[key]}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [key]: e.target.value }))}
                    className={inputCls + " pl-7"}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Auto-calculated total */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#111] border border-[#2a2a2a] rounded-xl w-fit">
            <span className="text-[12px] text-[#555]">Total</span>
            <span className="text-[18px] font-semibold text-white tabular-nums">{formatMXN(formTotal)}</span>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors">
              {submitting && <Spinner size="sm" />}
              {submitting ? "Saving…" : "Save Labor"}
            </button>
            <button type="button" onClick={() => setAmounts(emptyLabor())}
              className="text-sm text-[#555] hover:text-[#888] transition-colors">
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* Labor cost % summary */}
      {!loading && (totalLabor > 0 || salesTotal !== null) && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total Labor" value={formatMXN(totalLabor)} />
          <StatCard label="Total Sales" value={salesTotal !== null ? formatMXN(salesTotal) : "—"} />
          <StatCard
            label="Labor Cost %"
            value={laborPct !== null ? `${laborPct.toFixed(1)}%` : "—"}
            accent={laborPct !== null ? (laborPct > 35 ? "red" : laborPct > 28 ? "amber" : "green") : undefined}
          />
        </div>
      )}

      {/* Entries table */}
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="text-[13px] font-semibold text-[#888] uppercase tracking-[0.08em]">Labor Entries</h2>
            {!loading && (
              <p className="text-[12px] text-[#444] mt-0.5">
                {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
                <span className="text-[#3dbf8a] font-medium">{formatMXN(totalLabor)} total</span>
              </p>
            )}
          </div>
          <DateRangeFilter
            start={filterStart} end={filterEnd}
            onStartChange={setFilterStart} onEndChange={setFilterEnd}
          />
        </div>

        {loading ? (
          <div className="py-12"><PageSpinner /></div>
        ) : entries.length === 0 ? (
          <EmptyState title="No labor entries" description="Add your first entry using the form above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["Date", "FOH Labor", "BOH Labor", "Management", "Total", ""].map((h) => (
                    <th key={h} className={`text-[11px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 ${h && h !== "Date" ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111]">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#111] transition-colors">
                    <td className="px-5 py-3.5 text-[#888] whitespace-nowrap">{formatDate(entry.date)}</td>
                    <td className="px-5 py-3.5 text-right text-[#888] tabular-nums">{formatMXN(entry.fohLabor)}</td>
                    <td className="px-5 py-3.5 text-right text-[#888] tabular-nums">{formatMXN(entry.bohLabor)}</td>
                    <td className="px-5 py-3.5 text-right text-[#888] tabular-nums">{formatMXN(entry.management)}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-white tabular-nums">{formatMXN(entry.total)}</td>
                    <td className="px-5 py-3.5 text-right">
                      {isAdmin && (
                        <button onClick={() => setDeleteTarget(entry)}
                          className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-[#444] hover:text-red-400 hover:bg-red-900/20 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget} variant="danger" title="Delete labor entry"
        message={deleteTarget ? `Remove the labor entry of ${formatMXN(deleteTarget.total)} on ${formatDate(deleteTarget.date)}?` : ""}
        confirmLabel="Delete" loading={deleting}
        onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function DateRangeFilter({
  start, end, onStartChange, onEndChange,
}: {
  start: string; end: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}) {
  const filterCls =
    "px-2 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#111] text-[#888] text-xs " +
    "focus:outline-none focus:ring-1 focus:ring-[#3dbf8a]";
  return (
    <div className="flex items-center gap-2 text-xs text-[#555] flex-wrap">
      <input type="date" value={start} max={end}
        onChange={(e) => onStartChange(e.target.value)} className={filterCls} />
      <span>–</span>
      <input type="date" value={end} min={start} max={todayLocal()}
        onChange={(e) => onEndChange(e.target.value)} className={filterCls} />
    </div>
  );
}

function StatCard({
  label, value, accent,
}: {
  label: string; value: string; accent?: "green" | "amber" | "red";
}) {
  const valueColor =
    accent === "green" ? "text-[#3dbf8a]" :
    accent === "amber" ? "text-amber-400" :
    accent === "red"   ? "text-red-400"   :
    "text-white";

  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl px-6 py-5">
      <p className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1">{label}</p>
      <p className={`text-[24px] font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
