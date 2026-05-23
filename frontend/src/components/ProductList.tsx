import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Product, Department } from "../types";
import { productsApi } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { unitLabel, formatCurrency } from "../utils/stock";
import { Modal } from "./shared/Modal";
import { PageSpinner } from "./shared/Spinner";
import { EmptyState } from "./shared/EmptyState";
import { ProductForm } from "./ProductForm";
import { StockAdjustForm } from "./StockAdjustForm";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { BarcodeScanner } from "./shared/BarcodeScanner";
import { ScanInvoiceModal } from "./ScanInvoiceModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { useStockSocket } from "../hooks/useStockSocket";

// ── Helpers ───────────────────────────────────────────────────────────────────

// DEPT_TABS labels are set inside the component after getting translations
const DEPT_TAB_KEYS = ["ALL", "BOH", "FOH", "BAR"] as const;

type DeptView = "ALL" | "BOH" | "FOH" | "BAR";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(iso));
}

function fmtDateSearch(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric", timeZone: "UTC",
  }).format(new Date(iso));
}

function matchesDept(p: Product, view: DeptView): boolean {
  if (view === "ALL") return true;
  const d = p.department ?? "BOH";
  if (view === "BAR") return d === "BAR";
  if (view === "BOH") return d === "BOH" || d === "BOTH";
  if (view === "FOH") return d === "FOH" || d === "BOTH";
  return true;
}

// ── Invoice grouping ──────────────────────────────────────────────────────────

interface InvoiceGroup {
  key: string;
  purveyor: string;
  invoiceDate: string | null;
  products: Product[];
  totalValue: number;
}

function groupByInvoice(products: Product[]): InvoiceGroup[] {
  const map = new Map<string, InvoiceGroup>();
  for (const p of products) {
    const purveyor = p.purveyor?.trim() || "Unknown Purveyor";
    const dateKey  = p.invoiceDate ?? "none";
    const key      = `${purveyor}||${dateKey}`;
    if (!map.has(key)) {
      map.set(key, { key, purveyor, invoiceDate: p.invoiceDate ?? null, products: [], totalValue: 0 });
    }
    const g = map.get(key)!;
    g.products.push(p);
    g.totalValue += p.costPerUnit * p.currentStock;
  }
  // Sort: groups with a date first (most recent → oldest), then dateless groups
  return [...map.values()].sort((a, b) => {
    if (!a.invoiceDate && !b.invoiceDate) return a.purveyor.localeCompare(b.purveyor);
    if (!a.invoiceDate) return 1;
    if (!b.invoiceDate) return -1;
    return new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime();
  });
}

// ── Search matching ───────────────────────────────────────────────────────────

type MatchField = "name" | "purveyor" | "sku" | "date";

interface SearchMatch {
  groupKey: string;
  productIds: Set<string>;       // which products in the group matched
  matchFields: Set<MatchField>;  // which fields triggered the group match
}

function buildSearchMatches(groups: InvoiceGroup[], query: string): Map<string, SearchMatch> | null {
  if (!query.trim()) return null;
  const q = query.toLowerCase();
  const result = new Map<string, SearchMatch>();

  for (const g of groups) {
    const match: SearchMatch = { groupKey: g.key, productIds: new Set(), matchFields: new Set() };

    // Purveyor-level match → all products in the group are included
    if (g.purveyor.toLowerCase().includes(q)) match.matchFields.add("purveyor");
    if (fmtDateSearch(g.invoiceDate).includes(q) || (g.invoiceDate ?? "").includes(q)) match.matchFields.add("date");

    // Product-level match
    for (const p of g.products) {
      let productMatched = false;
      if (p.name.toLowerCase().includes(q)) { match.matchFields.add("name");     productMatched = true; }
      if (p.sku  && p.sku.toLowerCase().includes(q)) { match.matchFields.add("sku"); productMatched = true; }
      if (productMatched) match.productIds.add(p.id);
    }

    const groupLevelMatch = match.matchFields.has("purveyor") || match.matchFields.has("date");
    if (groupLevelMatch) {
      // Show all products in the group
      g.products.forEach((p) => match.productIds.add(p.id));
    }

    if (match.productIds.size > 0 || groupLevelMatch) {
      result.set(g.key, match);
    }
  }
  return result;
}

// Field labels — computed at component level using translations
type FieldLabels = Record<MatchField, string>;

// ── Invoice detail modal ──────────────────────────────────────────────────────

function InvoiceDetailModal({
  group,
  open,
  onClose,
  onEdit,
  onDelete,
  isAdmin,
}: {
  group: InvoiceGroup | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (p: Product) => void;
  onDelete?: (p: Product) => void;
  isAdmin: boolean;
}) {
  const { t } = useLanguage();
  if (!group) return null;
  const totalQty = group.products.reduce((s, p) => s + p.currentStock, 0);

  return (
    <Modal open={open} onClose={onClose} title="">
      <div className="space-y-4 -mt-2">
        {/* Invoice header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-white leading-tight">{group.purveyor}</h2>
            <p className="text-[13px] text-[#555] mt-0.5">
              {group.invoiceDate ? fmtDate(group.invoiceDate) : t.common.noDate} ·{" "}
              {group.products.length} {t.common.products.toLowerCase()}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[11px] text-[#444] uppercase tracking-wider mb-0.5">{t.invoices.invoiceTotal}</p>
            <p className="text-[20px] font-bold text-[#3dbf8a]">{formatCurrency(group.totalValue)}</p>
          </div>
        </div>

        {/* Products table */}
        <div className="rounded-xl border border-[#1a1a1a] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a1a1a] bg-[#0d0d0d]">
                {[t.invoices.product, t.common.unit, t.common.qty, t.common.costUnit, t.common.total, t.common.category, t.common.sku].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#444] uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
                {isAdmin && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {group.products.map((p) => (
                <tr key={p.id} className="hover:bg-[#0f0f0f] transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{p.name}</td>
                  <td className="px-4 py-3 text-[#666]">{unitLabel[p.unit]}</td>
                  <td className="px-4 py-3 font-semibold text-white tabular-nums">{p.currentStock}</td>
                  <td className="px-4 py-3 text-[#666] tabular-nums">{formatCurrency(p.costPerUnit)}</td>
                  <td className="px-4 py-3 font-semibold text-[#3dbf8a] tabular-nums">{formatCurrency(p.costPerUnit * p.currentStock)}</td>
                  <td className="px-4 py-3 text-[#666]">{p.category ?? "—"}</td>
                  <td className="px-4 py-3 text-[#555] font-mono text-[11px]">{p.sku ?? "—"}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => { onEdit?.(p); onClose(); }}
                          className="text-[11px] px-2 py-1 rounded text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => { onDelete?.(p); onClose(); }}
                          className="text-[11px] px-2 py-1 rounded text-[#555] hover:text-red-400 hover:bg-red-900/20 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#1a1a1a] bg-[#0d0d0d]">
                <td colSpan={2} className="px-4 py-2.5 text-[11px] font-semibold text-[#555] uppercase tracking-wider">{t.common.total}</td>
                <td className="px-4 py-2.5 font-bold text-white tabular-nums">{totalQty}</td>
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5 font-bold text-[#3dbf8a] tabular-nums">{formatCurrency(group.totalValue)}</td>
                <td colSpan={isAdmin ? 3 : 2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// ── Purveyor accordion row ────────────────────────────────────────────────────

function PurveyorRow({
  group,
  isOpen,
  onToggle,
  onViewInvoice,
  onEdit,
  onDelete,
  onAdjust,
  isAdmin,
  matchInfo,
}: {
  group: InvoiceGroup;
  isOpen: boolean;
  onToggle: () => void;
  onViewInvoice: () => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
  onAdjust: (p: Product) => void;
  isAdmin: boolean;
  matchInfo?: SearchMatch;
}) {
  const { t } = useLanguage();
  const fieldLabels: FieldLabels = {
    name: t.invoices.productName, purveyor: t.common.purveyor, sku: t.common.sku, date: t.common.date,
  };
  const matchBadges = matchInfo ? [...matchInfo.matchFields] : [];
  const visibleProducts = matchInfo
    ? group.products.filter((p) => matchInfo.productIds.has(p.id))
    : group.products;

  return (
    <div className="border border-[#1a1a1a] rounded-xl overflow-hidden">
      {/* Accordion header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 bg-[#0a0a0a] hover:bg-[#0f0f0f] transition-colors text-left"
      >
        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-[#444] flex-shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {/* Purveyor name + match badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-white truncate">{group.purveyor}</span>
            {matchBadges.map((f) => (
              <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-[#3dbf8a]/10 text-[#3dbf8a] border border-[#3dbf8a]/20 font-medium">
                {fieldLabels[f]}
              </span>
            ))}
          </div>
          <p className="text-[12px] text-[#444] mt-0.5">
            {group.invoiceDate ? fmtDate(group.invoiceDate) : t.common.noDate}
          </p>
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-4 flex-shrink-0 text-right">
          <div>
            <p className="text-[11px] text-[#444]">{t.common.products}</p>
            <p className="text-[13px] font-semibold text-white">{group.products.length}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#444]">Value</p>
            <p className="text-[13px] font-semibold text-[#3dbf8a]">{formatCurrency(group.totalValue)}</p>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="border-t border-[#1a1a1a]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#111] bg-[#060606]">
                  {[t.invoices.product, t.common.unit, t.common.stock, t.common.category, t.common.sku, ""].map((h) => (
                    <th key={h} className="text-left px-5 py-2.5 text-[10px] font-semibold text-[#444] uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0d0d0d]">
                {visibleProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-[#0c0c0c] transition-colors group">
                    <td className="px-5 py-3 font-medium text-white">{p.name}</td>
                    <td className="px-5 py-3 text-[#555]">{unitLabel[p.unit]}</td>
                    <td className="px-5 py-3 font-semibold text-white tabular-nums">{p.currentStock}</td>
                    <td className="px-5 py-3 text-[#555]">{p.category ?? "—"}</td>
                    <td className="px-5 py-3 text-[#555] font-mono text-[11px]">{p.sku ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onAdjust(p)}
                          className="text-[11px] px-2 py-1 rounded text-[#3dbf8a] hover:bg-[#3dbf8a]/10 transition-colors"
                        >
                          {t.invoices.adjust}
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => onEdit(p)}
                              className="text-[11px] px-2 py-1 rounded text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                            >
                              {t.common.edit}
                            </button>
                            <button
                              onClick={() => onDelete(p)}
                              className="text-[11px] px-2 py-1 rounded text-[#555] hover:text-red-400 hover:bg-red-900/20 transition-colors"
                            >
                              {t.common.delete}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* View Invoice CTA */}
          <div className="px-5 py-3 border-t border-[#111] flex items-center justify-between bg-[#060606]">
            <p className="text-[12px] text-[#444]">
              {visibleProducts.length} {t.invoices.of} {group.products.length} {t.invoices.productsShown}
              {matchInfo && matchInfo.productIds.size < group.products.length ? ` (${t.invoices.filtered})` : ""}
            </p>
            <button
              onClick={onViewInvoice}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#3dbf8a]/10 hover:bg-[#3dbf8a]/20 text-[#3dbf8a] text-[12px] font-semibold border border-[#3dbf8a]/20 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {t.invoices.viewInvoice}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProductList() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { t } = useLanguage();

  const DEPT_TABS = [
    { value: "ALL",  label: t.common.all },
    { value: "BOH",  label: t.ui.kitchen },
    { value: "FOH",  label: t.ui.foh },
    { value: "BAR",  label: t.ui.bar },
  ] as const;

  const FIELD_LABELS: FieldLabels = {
    name:     t.invoices.productName,
    purveyor: t.common.purveyor,
    sku:      t.common.sku,
    date:     t.common.date,
  };

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [deptView, setDeptView] = useState<DeptView>("ALL");

  const [openGroups, setOpenGroups]     = useState<Set<string>>(new Set());
  const [invoiceModal, setInvoiceModal] = useState<InvoiceGroup | null>(null);

  // Product-level modals
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [editTarget, setEditTarget]     = useState<Product | null>(null);
  const [addOpen, setAddOpen]           = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [scannerOpen, setScannerOpen]   = useState(false);
  const [scanOpen, setScanOpen]         = useState(false);

  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;

  // Real-time stock updates
  useStockSocket((batch) => {
    const visible = new Set(productsRef.current.map((p) => p.id));
    const relevant = [...batch.values()].filter((e) => visible.has(e.productId));
    if (relevant.length === 0) return;
    setProducts((prev) =>
      prev.map((p) => {
        const update = batch.get(p.id);
        return update ? { ...p, currentStock: update.newQuantity } : p;
      })
    );
    toast.info(relevant.length === 1 ? "Stock updated for 1 product" : `Stock updated for ${relevant.length} products`);
  });

  const load = useCallback(() => {
    setLoading(true);
    productsApi.list().then(setProducts).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 1. Apply dept filter
  const deptFiltered = useMemo(
    () => products.filter((p) => matchesDept(p, deptView)),
    [products, deptView]
  );

  // 2. Build invoice groups from dept-filtered products
  const groups = useMemo(() => groupByInvoice(deptFiltered), [deptFiltered]);

  // 3. Build search matches (null = no search active)
  const searchMatches = useMemo(
    () => buildSearchMatches(groups, search),
    [groups, search]
  );

  // 4. Filter groups by search
  const visibleGroups = useMemo(() => {
    if (!searchMatches) return groups;
    return groups.filter((g) => searchMatches.has(g.key));
  }, [groups, searchMatches]);

  // Auto-expand all groups when searching
  useEffect(() => {
    if (searchMatches) {
      setOpenGroups(new Set(visibleGroups.map((g) => g.key)));
    }
  }, [searchMatches, visibleGroups]);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function onProductSaved(saved: Product) {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [saved, ...prev];
    });
    setAddOpen(false);
    setEditTarget(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await productsApi.delete(deleteTarget.id);
      setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  const matchedFieldSummary = useMemo(() => {
    if (!searchMatches || !search) return null;
    const allFields = new Set<MatchField>();
    searchMatches.forEach((m) => m.matchFields.forEach((f) => allFields.add(f)));
    const fl: FieldLabels = { name: t.invoices.productName, purveyor: t.common.purveyor, sku: t.common.sku, date: t.common.date };
    return [...allFields].map((f) => fl[f]).join(", ");
  }, [searchMatches, search]);

  return (
    <div className="p-6 sm:p-8 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{t.invoices.title}</h1>
          {!loading && (
            <p className="text-[13px] text-[#555] mt-0.5">
              {groups.length} {t.common.invoices} · {products.length} {t.common.products.toLowerCase()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScanOpen(true)}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 bg-[#3dbf8a] hover:bg-[#35a87a] text-white text-sm font-medium rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="hidden sm:inline">{t.invoices.scanInvoice}</span>
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] hover:border-[#3dbf8a] text-white text-sm font-medium rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">{t.invoices.addInvoice}</span>
          </button>
        </div>
      </div>

      {/* Controls row: dept tabs + search */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Dept filter */}
        <div className="flex rounded-[8px] border border-[#2a2a2a] overflow-hidden w-fit flex-shrink-0">
          {DEPT_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setDeptView(value)}
              className={`px-4 py-2 text-[13px] font-semibold transition-colors ${
                deptView === value
                  ? "bg-[#3dbf8a] text-white"
                  : "bg-[#0a0a0a] text-[#555] hover:text-[#888]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#444] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              placeholder={t.invoices.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#888] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => setScannerOpen(true)}
            title="Scan barcode"
            className="flex items-center justify-center h-9 w-9 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] text-[#444] hover:text-white hover:border-[#3dbf8a] transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search result hint */}
      {search && searchMatches && (
        <div className="flex items-center gap-2 text-[12px] text-[#444]">
          <span className="text-[#3dbf8a] font-medium">{visibleGroups.length}</span>
          <span>{visibleGroups.length === 1 ? t.invoices.searchHint_one : t.invoices.searchHint_many}</span>
          <span className="italic">"{search}"</span>
          {matchedFieldSummary && <span>· {t.invoices.matchedBy} {matchedFieldSummary}</span>}
        </div>
      )}
      {search && searchMatches?.size === 0 && (
        <div className="text-[12px] text-[#444]">{t.invoices.noMatch} "{search}"</div>
      )}

      {/* Grouped invoice list */}
      {loading ? (
        <PageSpinner />
      ) : groups.length === 0 ? (
        <EmptyState
          title={t.invoices.noInvoicesFound}
          description={t.invoices.noInvoicesDesc}
          action={
            <button
              onClick={() => setAddOpen(true)}
              className="h-9 px-4 bg-[#3dbf8a] text-white text-sm rounded-xl hover:bg-[#35a87a] transition-colors"
            >
              {t.invoices.addInvoice}
            </button>
          }
        />
      ) : visibleGroups.length === 0 && search ? (
        <EmptyState
          title={t.common.noResults}
          description={`${t.invoices.noMatch} "${search}".`}
          action={
            <button onClick={() => setSearch("")} className="h-9 px-4 bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] text-sm rounded-xl hover:text-white transition-colors">
              {t.common.clearSearch}
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleGroups.map((group) => (
            <PurveyorRow
              key={group.key}
              group={group}
              isOpen={openGroups.has(group.key)}
              onToggle={() => toggleGroup(group.key)}
              onViewInvoice={() => setInvoiceModal(group)}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
              onAdjust={setAdjustTarget}
              isAdmin={isAdmin}
              matchInfo={searchMatches?.get(group.key)}
            />
          ))}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}

      {/* Invoice detail */}
      <InvoiceDetailModal
        group={invoiceModal}
        open={!!invoiceModal}
        onClose={() => setInvoiceModal(null)}
        onEdit={setEditTarget}
        onDelete={setDeleteTarget}
        isAdmin={isAdmin}
      />

      {/* Scan invoice (camera) */}
      <ScanInvoiceModal open={scanOpen} onClose={() => setScanOpen(false)} onSaved={onProductSaved} />

      {/* Barcode scanner for search */}
      <Modal open={scannerOpen} onClose={() => setScannerOpen(false)} title={t.invoices.scanInvoice}>
        <BarcodeScanner onScan={(code) => { setScannerOpen(false); setSearch(code); }} onClose={() => setScannerOpen(false)} />
      </Modal>

      {/* Add invoice */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t.invoices.addInvoice}>
        <ProductForm onSaved={onProductSaved} onCancel={() => setAddOpen(false)} />
      </Modal>

      {/* Edit invoice */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t.invoices.editInvoice}>
        {editTarget && (
          <ProductForm initial={editTarget} onSaved={onProductSaved} onCancel={() => setEditTarget(null)} />
        )}
      </Modal>

      {/* Adjust stock */}
      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title={t.stock.adjustStock}>
        {adjustTarget && (
          <StockAdjustForm product={adjustTarget} onDone={() => { setAdjustTarget(null); load(); }} onCancel={() => setAdjustTarget(null)} />
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t.common.delete}
        message={`"${deleteTarget?.name}" ${t.common.delete.toLowerCase()}`}
        confirmLabel={t.common.delete}
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
