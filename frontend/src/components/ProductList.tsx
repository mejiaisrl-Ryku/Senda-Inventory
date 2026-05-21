import React, { useEffect, useState, useCallback, useRef } from "react";
import { Product, StockReason } from "../types";
import { productsApi, stockApi } from "../api";
import { getStockStatus, statusStyles, unitLabel, formatCurrency } from "../utils/stock";
import { StockBadge } from "./shared/Badge";
import { Modal } from "./shared/Modal";
import { PageSpinner } from "./shared/Spinner";
import { EmptyState } from "./shared/EmptyState";
import { ProductCard } from "./ProductCard";
import { ProductForm } from "./ProductForm";
import { StockAdjustForm } from "./StockAdjustForm";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { BarcodeScanner } from "./shared/BarcodeScanner";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { useStockSocket } from "../hooks/useStockSocket";

export function ProductList() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [scannerOpen, setScannerOpen] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Stable ref for the socket callback to avoid stale closures.
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;

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

    const label =
      relevant.length === 1
        ? `Stock updated for 1 product`
        : `Stock updated for ${relevant.length} products`;
    toast.info(label);
  });

  const load = useCallback(() => {
    setLoading(true);
    productsApi
      .list(categoryFilter || undefined)
      .then(setProducts)
      .finally(() => setLoading(false));
  }, [categoryFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))] as string[];

  const filtered = products.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  function onProductSaved(saved: Product) {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    setAddOpen(false);
    setEditTarget(null);
  }

  function onStockAdjusted() {
    setAdjustTarget(null);
    load();
  }

  // Quick +1/-1 directly from the card — optimistic local update.
  async function handleQuickAdjust(product: Product, change: number, reason: StockReason) {
    await stockApi.adjust({ productId: product.id, change, reason });
    setProducts((prev) =>
      prev.map((p) =>
        p.id === product.id ? { ...p, currentStock: Math.max(0, p.currentStock + change) } : p
      )
    );
    const sign = change > 0 ? "+" : "";
    toast.success(`${product.name} ${sign}${change} ${unitLabel[product.unit]}`);
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

  function handleBarcodeScan(code: string) {
    setScannerOpen(false);
    setSearch(code);
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-gray-900 dark:text-white">Products</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{products.length} items</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setAddOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-4 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Product
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search + barcode scan button */}
        <div className="flex-1 flex gap-2">
          <input
            type="search"
            placeholder="Search by name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-h-[44px] px-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => setScannerOpen(true)}
            title="Scan barcode / QR"
            aria-label="Scan barcode"
            className="flex items-center justify-center min-h-[44px] w-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[44px] px-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="flex rounded-xl border border-gray-300 dark:border-gray-600 overflow-hidden self-start">
          {(["grid", "table"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center justify-center min-h-[44px] px-3 text-sm transition-colors ${
                view === v
                  ? "bg-brand-500 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {v === "grid" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <PageSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No products found"
          description={search ? "Try a different search or scan again." : "Add your first product to get started."}
          action={
            !search && isAdmin && (
              <button
                onClick={() => setAddOpen(true)}
                className="min-h-[44px] px-4 bg-brand-500 text-white text-sm rounded-xl hover:bg-brand-600 transition-colors"
              >
                Add Product
              </button>
            )
          }
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onAdjust={setAdjustTarget}
              onEdit={isAdmin ? setEditTarget : undefined}
              onQuickAdjust={handleQuickAdjust}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {["Name", "SKU", "Category", "Unit", "Stock", "Min", "Cost", "Status", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((p) => {
                  const status = getStockStatus(p);
                  const s = statusStyles[status];
                  return (
                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.sku ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.category ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{unitLabel[p.unit]}</td>
                      <td className={`px-4 py-3 font-semibold ${s.badge.split(" ").slice(2).join(" ")}`}>
                        {p.currentStock}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.minimumStock}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatCurrency(p.costPerUnit)}</td>
                      <td className="px-4 py-3"><StockBadge status={status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setAdjustTarget(p)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 hover:bg-brand-100 transition-colors whitespace-nowrap"
                          >
                            Adjust
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => setDeleteTarget(p)}
                              className="text-xs px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal open={scannerOpen} onClose={() => setScannerOpen(false)} title="Scan Barcode">
        <BarcodeScanner onScan={handleBarcodeScan} onClose={() => setScannerOpen(false)} />
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Product">
        <ProductForm onSaved={onProductSaved} onCancel={() => setAddOpen(false)} />
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Product">
        {editTarget && (
          <ProductForm initial={editTarget} onSaved={onProductSaved} onCancel={() => setEditTarget(null)} />
        )}
      </Modal>

      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title="Adjust Stock">
        {adjustTarget && (
          <StockAdjustForm product={adjustTarget} onDone={onStockAdjusted} onCancel={() => setAdjustTarget(null)} />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete product"
        message={`"${deleteTarget?.name}" will be permanently deleted along with all its stock logs. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
