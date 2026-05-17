import React, { useState, FormEvent } from "react";
import { Product, StockReason } from "../types";
import { stockApi } from "../api";
import { unitLabel } from "../utils/stock";
import { Spinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { getApiError } from "../utils/errorUtils";

type Mode = "add" | "remove" | "adjust";

const modeConfig: Record<Mode, { label: string; reason: StockReason; sign: 1 | -1; color: string; adminOnly: boolean }> = {
  add: {
    label: "Add Stock",
    reason: "RECEIVED",
    sign: 1,
    color: "bg-green-500 hover:bg-green-600 text-white",
    adminOnly: false,
  },
  remove: {
    label: "Remove Stock",
    reason: "USED",
    sign: -1,
    color: "bg-red-500 hover:bg-red-600 text-white",
    adminOnly: false,
  },
  adjust: {
    label: "Adjust Stock",
    reason: "ADJUSTED",
    sign: 1,
    color: "bg-yellow-500 hover:bg-yellow-600 text-white",
    adminOnly: true,
  },
};

const removeReasons: { value: StockReason; label: string }[] = [
  { value: "USED", label: "Used in production" },
  { value: "WASTE", label: "Waste / spoilage" },
];

interface StockAdjustFormProps {
  product: Product;
  onDone: () => void;
  onCancel: () => void;
}

export function StockAdjustForm({ product, onDone, onCancel }: StockAdjustFormProps) {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [mode, setMode] = useState<Mode>("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<StockReason>("RECEIVED");
  const [notes, setNotes] = useState("");
  const [quantityError, setQuantityError] = useState("");
  const [saving, setSaving] = useState(false);

  const unit = unitLabel[product.unit];
  const preview = parseFloat(quantity) || 0;
  const newStock =
    mode === "adjust"
      ? preview
      : product.currentStock + (mode === "add" ? preview : -preview);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setQuantityError("");
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setQuantityError("Enter a positive quantity");
      return;
    }

    let change: number;
    if (mode === "adjust") {
      change = qty - product.currentStock;
      if (change === 0) {
        setQuantityError("New quantity is the same as current stock");
        return;
      }
    } else {
      change = modeConfig[mode].sign * qty;
    }

    setSaving(true);
    try {
      await stockApi.adjust({ productId: product.id, change, reason, notes: notes || undefined });
      toast.success(`Stock updated: ${product.name} → ${Math.max(0, newStock).toFixed(2)} ${unit}`);
      onDone();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  }

  function handleModeChange(m: Mode) {
    setMode(m);
    setQuantity("");
    setQuantityError("");
    if (m === "add") setReason("RECEIVED");
    if (m === "remove") setReason("USED");
    if (m === "adjust") setReason("ADJUSTED");
  }

  const inputClass = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent";
  const inputErrorClass = "w-full px-3 py-2 rounded-lg border border-red-400 dark:border-red-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Product info */}
      <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700">
        <p className="font-semibold text-gray-900 dark:text-white text-sm">{product.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Current stock:{" "}
          <span className="font-medium text-gray-700 dark:text-gray-200">
            {product.currentStock} {unit}
          </span>
          <span className="mx-2">·</span>
          Minimum: {product.minimumStock} {unit}
        </p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-2">
        {(["add", "remove", "adjust"] as Mode[]).map((m) => {
          const cfg = modeConfig[m];
          const disabled = cfg.adminOnly && !isAdmin;
          return (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              disabled={disabled}
              title={disabled ? "Requires admin role" : undefined}
              className={`py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === m
                  ? cfg.color
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>
      {modeConfig[mode].adminOnly && !isAdmin && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          Balance adjustments are restricted to admins.
        </p>
      )}

      {/* Quantity */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {mode === "adjust" ? `New quantity (${unit})` : `Quantity (${unit})`}
        </label>
        <input
          className={quantityError ? inputErrorClass : inputClass}
          type="number"
          min="0.001"
          step="0.001"
          required
          value={quantity}
          onChange={(e) => { setQuantity(e.target.value); setQuantityError(""); }}
          placeholder={mode === "adjust" ? String(product.currentStock) : "0"}
        />
        {quantityError && (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">{quantityError}</p>
        )}
      </div>

      {/* Reason — only for remove mode */}
      {mode === "remove" && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason</label>
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as StockReason)}>
            {removeReasons.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Notes <span className="text-gray-400">(optional)</span>
        </label>
        <input
          className={inputClass}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Batch #, supplier, etc."
          maxLength={500}
        />
      </div>

      {/* Preview */}
      {quantity && !quantityError && (
        <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 text-sm">
          <span className="text-gray-500 dark:text-gray-400">New stock will be: </span>
          <span
            className={`font-bold ${
              newStock < 0
                ? "text-red-500"
                : newStock < product.minimumStock
                ? "text-yellow-500"
                : "text-green-600 dark:text-green-400"
            }`}
          >
            {Math.max(0, newStock).toFixed(3)} {unit}
          </span>
          {newStock < 0 && (
            <p className="text-xs text-red-500 mt-0.5">This would result in negative stock.</p>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${modeConfig[mode].color} disabled:opacity-60`}
        >
          {saving && <Spinner size="sm" />}
          {saving ? "Saving…" : modeConfig[mode].label}
        </button>
      </div>
    </form>
  );
}
