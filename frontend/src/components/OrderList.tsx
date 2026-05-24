import React, { useEffect, useState, useCallback } from "react";
import { Order, OrderStatus } from "../types";
import { useLanguage } from "../context/LanguageContext";
import { ordersApi } from "../api";
import { formatCurrency, formatDate } from "../utils/stock";
import { Modal } from "./shared/Modal";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { PageSpinner } from "./shared/Spinner";
import { EmptyState } from "./shared/EmptyState";
import { OrderForm } from "./OrderForm";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { useAuth } from "../context/AuthContext";

const statusStyles: Record<OrderStatus, string> = {
  PENDING:   "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  RECEIVED:  "bg-brand-100  dark:bg-brand-900/30  text-brand-700  dark:text-brand-400",
  CANCELLED: "bg-gray-100   dark:bg-gray-700       text-gray-500   dark:text-gray-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Best display name for a line item — prefer productName, fall back to catalogue product name. */
function itemDisplayName(item: Order["orderItems"][number]): string {
  return item.productName?.trim() || item.product?.name || "—";
}

/** Short department label for the badge. */
const DEPT_LABELS: Record<string, string> = {
  KITCHEN: "Kitchen",
  FOH:     "FOH",
  BAR:     "Bar",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function OrderList() {
  const { isAdmin } = useAuth();
  const { t } = useLanguage();

  const statusLabels: Record<OrderStatus, string> = {
    PENDING:   t.orders.pending,
    RECEIVED:  t.orders.received,
    CANCELLED: t.orders.cancelled,
  };

  const [orders,       setOrders]       = useState<Order[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [createOpen,   setCreateOpen]   = useState(false);
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [receiving,    setReceiving]    = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelling,   setCancelling]   = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    ordersApi
      .list(statusFilter as OrderStatus || undefined)
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleReceive(order: Order) {
    setReceiving(order.id);
    try {
      const updated = await ordersApi.receive(order.id);
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
      toast.success(`Invoice from ${order.purveyor ?? "purveyor"} marked as received`);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setReceiving(null);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const updated = await ordersApi.update(cancelTarget.id, { status: "CANCELLED" });
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
      toast.warning(`Invoice cancelled`);
      setCancelTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCancelling(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 space-y-4">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-white">Invoices</h1>
          <p className="text-[13px] text-[#555]">{orders.length} invoice{orders.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Invoice
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {(["", "PENDING", "RECEIVED", "CANCELLED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              statusFilter === s
                ? s === ""
                  ? "bg-gray-800 dark:bg-white text-white dark:text-gray-900"
                  : statusStyles[s as OrderStatus]
                : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
          >
            {s === "" ? t.common.all : statusLabels[s as OrderStatus]}
          </button>
        ))}
      </div>

      {loading ? (
        <PageSpinner />
      ) : orders.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Add your first purchase invoice to start tracking orders."
          action={
            <button
              onClick={() => setCreateOpen(true)}
              className="px-4 py-2 bg-brand-500 text-white text-sm rounded-xl hover:bg-brand-600 transition-colors"
            >
              Add Invoice
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const isExpanded = expanded === order.id;
            const itemCount  = order.orderItems.length;
            const dept       = order.department ? DEPT_LABELS[order.department] : null;

            return (
              <div
                key={order.id}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {/* ── Invoice card header ──────────────────────────────────── */}
                <div
                  className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : order.id)}
                >
                  {/* Left: meta */}
                  <div className="flex-1 min-w-0">
                    {/* Purveyor name (title) */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {order.purveyor || <span className="text-gray-400 italic">Unknown purveyor</span>}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusStyles[order.status]}`}>
                        {statusLabels[order.status]}
                      </span>
                      {dept && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 shrink-0">
                          {dept}
                        </span>
                      )}
                    </div>

                    {/* Date · Invoice# · item count */}
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {order.invoiceDate
                          ? formatDate(order.invoiceDate)
                          : formatDate(order.createdAt)}
                      </span>
                      {order.invoiceNumber && (
                        <>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                            {order.invoiceNumber}
                          </span>
                        </>
                      )}
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {itemCount} {itemCount === 1 ? "item" : "items"}
                      </span>
                    </div>
                  </div>

                  {/* Right: total + chevron */}
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">
                      {formatCurrency(order.totalCost)}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* ── Expanded line items ──────────────────────────────────── */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-4 pb-4">
                    <div className="pt-3 space-y-1">
                      {/* Column headers */}
                      <div className="grid grid-cols-12 gap-2 text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide pb-1">
                        <span className="col-span-5">Product</span>
                        <span className="col-span-2">SKU</span>
                        <span className="col-span-1">Unit</span>
                        <span className="col-span-2 text-right">Qty</span>
                        <span className="col-span-2 text-right">Total</span>
                      </div>

                      {order.orderItems.map((item) => {
                        const itemTot = item.quantity * item.unitCost;
                        return (
                          <div
                            key={item.id}
                            className="grid grid-cols-12 gap-2 text-sm py-1 border-b border-gray-50 dark:border-gray-700/50 last:border-0"
                          >
                            <div className="col-span-5">
                              <p className="text-gray-800 dark:text-gray-200 font-medium truncate">
                                {itemDisplayName(item)}
                              </p>
                              {item.category && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">{item.category}</p>
                              )}
                            </div>
                            <span className="col-span-2 text-xs text-gray-400 dark:text-gray-500 font-mono self-center truncate">
                              {item.sku || "—"}
                            </span>
                            <span className="col-span-1 text-xs text-gray-400 dark:text-gray-500 self-center">
                              {item.unit || "—"}
                            </span>
                            <span className="col-span-2 text-right text-gray-600 dark:text-gray-300 self-center">
                              {item.quantity}
                            </span>
                            <span className="col-span-2 text-right font-medium text-gray-800 dark:text-gray-200 self-center">
                              {formatCurrency(itemTot)}
                            </span>
                          </div>
                        );
                      })}

                      {/* Sub-total row */}
                      <div className="grid grid-cols-12 gap-2 pt-2">
                        <span className="col-span-10 text-xs text-right text-gray-400 dark:text-gray-500 font-medium">
                          Invoice Total
                        </span>
                        <span className="col-span-2 text-right font-bold text-gray-900 dark:text-white text-sm">
                          {formatCurrency(order.totalCost)}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons for pending invoices */}
                    {order.status === "PENDING" && (
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() => handleReceive(order)}
                          disabled={receiving === order.id}
                          className="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                        >
                          {receiving === order.id ? "Receiving…" : "Mark as Received"}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => setCancelTarget(order)}
                            className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create invoice modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Invoice"
        maxWidth="max-w-xl"
      >
        <OrderForm
          onCreated={() => {
            setCreateOpen(false);
            load();
            toast.success("Invoice saved");
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel invoice"
        message="This invoice will be marked as cancelled. This cannot be undone."
        confirmLabel="Cancel Invoice"
        variant="warning"
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
