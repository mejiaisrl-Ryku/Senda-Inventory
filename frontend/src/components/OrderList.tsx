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
  PENDING: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  RECEIVED: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  CANCELLED: "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
};

export function OrderList() {
  const { isAdmin } = useAuth();
  const { t } = useLanguage();

  const statusLabels: Record<OrderStatus, string> = {
    PENDING:   t.orders.pending,
    RECEIVED:  t.orders.received,
    CANCELLED: t.orders.cancelled,
  };
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    ordersApi.list(statusFilter as OrderStatus || undefined)
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleReceive(order: Order) {
    setReceiving(order.id);
    try {
      const updated = await ordersApi.receive(order.id);
      setOrders((prev) => prev.map((o) => o.id === updated.id ? updated : o));
      toast.success(`Order #${order.id.slice(-6)} marked as received — stock updated`);
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
      setOrders((prev) => prev.map((o) => o.id === updated.id ? updated : o));
      toast.warning(`Order #${cancelTarget.id.slice(-6)} cancelled`);
      setCancelTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="p-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{t.orders.title}</h1>
          <p className="text-[13px] text-[#555]">{orders.length} {t.orders.title.toLowerCase()}</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t.orders.createOrder}
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter("")}
          className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
            statusFilter === ""
              ? "bg-gray-800 dark:bg-white text-white dark:text-gray-900"
              : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          {t.common.all}
        </button>
        {(["PENDING", "RECEIVED", "CANCELLED"] as OrderStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              statusFilter === s
                ? statusStyles[s]
                : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
          >
            {statusLabels[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <PageSpinner />
      ) : orders.length === 0 ? (
        <EmptyState
          title={t.orders.noOrders}
          description={t.orders.noOrdersDesc}
          action={
            <button onClick={() => setCreateOpen(true)}
              className="px-4 py-2 bg-brand-500 text-white text-sm rounded-xl hover:bg-brand-600 transition-colors">
              {t.orders.createOrder}
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div key={order.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Order header */}
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={() => setExpanded(expanded === order.id ? null : order.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                      #{order.id.slice(-8)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyles[order.status]}`}>
                      {statusLabels[order.status]}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {order.orderItems.length} items
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {formatDate(order.createdAt)}
                    {order.deliveredAt && ` · Delivered ${formatDate(order.deliveredAt)}`}
                  </p>
                </div>
                <span className="font-semibold text-gray-900 dark:text-white text-sm">
                  {formatCurrency(order.totalCost)}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expanded === order.id ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded items */}
              {expanded === order.id && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 pb-4">
                  <div className="pt-3 space-y-1.5">
                    {order.orderItems.map((item) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-gray-700 dark:text-gray-300">
                          {item.product?.name ?? item.productId}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">
                          {item.quantity} × {formatCurrency(item.unitCost)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {order.status === "PENDING" && (
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => handleReceive(order)}
                        disabled={receiving === order.id}
                        className="flex-1 py-2 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
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
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Order" maxWidth="max-w-xl">
        <OrderForm
          onCreated={() => { setCreateOpen(false); load(); toast.success("Order created"); }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel order"
        message={`Order #${cancelTarget?.id.slice(-6)} will be marked as cancelled. This cannot be undone.`}
        confirmLabel="Cancel Order"
        variant="warning"
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
