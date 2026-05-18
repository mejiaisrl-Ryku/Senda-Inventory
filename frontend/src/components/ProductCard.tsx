import React, { useState } from "react";
import { Product, StockReason } from "../types";
import {
  getStockStatus,
  statusStyles,
  stockBarPercent,
  unitLabel,
  formatCurrency,
} from "../utils/stock";
import { StockBadge, Pill } from "./shared/Badge";

interface ProductCardProps {
  product: Product;
  onAdjust: (product: Product) => void;
  onEdit?: (product: Product) => void;
  onQuickAdjust?: (product: Product, change: number, reason: StockReason) => Promise<void>;
}

function MiniSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

export function ProductCard({ product, onAdjust, onEdit, onQuickAdjust }: ProductCardProps) {
  const status = getStockStatus(product);
  const styles = statusStyles[status];
  const barPct = stockBarPercent(product);
  const [quickLoading, setQuickLoading] = useState<"add" | "remove" | null>(null);

  async function handleQuick(type: "add" | "remove") {
    if (!onQuickAdjust || quickLoading) return;
    setQuickLoading(type);
    try {
      await onQuickAdjust(product, type === "add" ? 1 : -1, type === "add" ? "RECEIVED" : "USED");
    } finally {
      setQuickLoading(null);
    }
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl border ${styles.border} p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-base leading-snug truncate">
            {product.name}
          </h3>
          {product.sku && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{product.sku}</p>
          )}
        </div>
        <StockBadge status={status} />
      </div>

      {/* Category */}
      {product.category && <Pill color="blue">{product.category}</Pill>}

      {/* Stock bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>
            {product.currentStock} {unitLabel[product.unit]} current
          </span>
          <span>min {product.minimumStock}</span>
        </div>
        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${styles.bar}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>

      {/* Cost */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {formatCurrency(product.costPerUnit)} / {unitLabel[product.unit]}
        <span className="ml-2 font-medium text-gray-600 dark:text-gray-300">
          = {formatCurrency(product.currentStock * product.costPerUnit)} total
        </span>
      </p>

      {/* Quick −/Adjust/+ row — all buttons min 44px tall */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => handleQuick("remove")}
          disabled={!!quickLoading || product.currentStock <= 0}
          title="Use 1 unit (USED)"
          aria-label={`Remove 1 ${unitLabel[product.unit]}`}
          className="flex items-center justify-center min-h-[44px] w-11 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xl font-bold leading-none"
        >
          {quickLoading === "remove" ? <MiniSpinner /> : "−"}
        </button>

        <button
          onClick={() => onAdjust(product)}
          className="flex-1 flex items-center justify-center min-h-[44px] rounded-xl text-sm font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
        >
          Adjust
        </button>

        <button
          onClick={() => handleQuick("add")}
          disabled={!!quickLoading}
          title="Receive 1 unit (RECEIVED)"
          aria-label={`Add 1 ${unitLabel[product.unit]}`}
          className="flex items-center justify-center min-h-[44px] w-11 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xl font-bold leading-none"
        >
          {quickLoading === "add" ? <MiniSpinner /> : "+"}
        </button>
      </div>

      {/* Edit — full-width, admin-only */}
      {onEdit && (
        <button
          onClick={() => onEdit(product)}
          className="w-full flex items-center justify-center min-h-[44px] rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors"
        >
          Edit product
        </button>
      )}
    </div>
  );
}
