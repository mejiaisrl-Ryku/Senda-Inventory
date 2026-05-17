import React, { useEffect, useState } from "react";
import { Product } from "../types";
import { stockApi } from "../api";
import { getStockStatus, statusStyles, unitLabel } from "../utils/stock";
import { StockBadge } from "./shared/Badge";
import { Modal } from "./shared/Modal";
import { StockAdjustForm } from "./StockAdjustForm";
import { PageSpinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";

interface LowStockAlertsProps {
  compact?: boolean;
}

export function LowStockAlerts({ compact = false }: LowStockAlertsProps) {
  const toast = useToast();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);

  function load() {
    setLoading(true);
    stockApi.lowItems()
      .then(setItems)
      .catch((err) => toast.error(getApiError(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const displayed = compact ? items.slice(0, 5) : items;

  if (loading) return <PageSpinner />;

  const critical = items.filter((p) => getStockStatus(p) === "critical");
  const low = items.filter((p) => getStockStatus(p) === "low");

  return (
    <div className={compact ? "" : "p-6 space-y-5"}>
      {!compact && (
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Low Stock Alerts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {critical.length} critical · {low.length} low
          </p>
        </div>
      )}

      {compact && items.length > 0 && (
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Low Stock Alerts
          <span className="ml-auto text-xs font-normal text-gray-400">{items.length} items</span>
        </h2>
      )}

      {displayed.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-700 dark:text-green-400 font-medium">All items are adequately stocked</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((product) => {
            const status = getStockStatus(product);
            const s = statusStyles[status];
            const unit = unitLabel[product.unit];
            const pct = product.minimumStock > 0
              ? Math.round((product.currentStock / product.minimumStock) * 100)
              : 0;

            return (
              <div
                key={product.id}
                className={`flex items-center gap-3 p-3 rounded-xl border ${s.border} bg-white dark:bg-gray-800`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {product.name}
                    </span>
                    <StockBadge status={status} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {product.currentStock} {unit} / {product.minimumStock} {unit} min
                    {product.minimumStock > 0 && ` · ${pct}%`}
                  </p>
                </div>
                <button
                  onClick={() => setAdjustTarget(product)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 hover:bg-brand-100 transition-colors"
                >
                  Add Stock
                </button>
              </div>
            );
          })}

          {compact && items.length > 5 && (
            <p className="text-xs text-center text-gray-400 pt-1">
              +{items.length - 5} more items below minimum
            </p>
          )}
        </div>
      )}

      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title="Add Stock">
        {adjustTarget && (
          <StockAdjustForm
            product={adjustTarget}
            onDone={() => { setAdjustTarget(null); load(); }}
            onCancel={() => setAdjustTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
}
