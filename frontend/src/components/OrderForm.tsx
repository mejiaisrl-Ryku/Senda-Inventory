import React, { useEffect, useState, FormEvent } from "react";
import { Product } from "../types";
import { productsApi, ordersApi } from "../api";
import { unitLabel, formatCurrency } from "../utils/stock";
import { Spinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";

interface LineItem {
  productId: string;
  quantity: string;
  unitCost: string;
}

interface OrderFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

type LineErrors = Partial<Record<"productId" | "quantity" | "unitCost", string>>;

export function OrderForm({ onCreated, onCancel }: OrderFormProps) {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<LineItem[]>([{ productId: "", quantity: "", unitCost: "" }]);
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([{}]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { productsApi.list().then(setProducts); }, []);

  function addLine() {
    setLines((l) => [...l, { productId: "", quantity: "", unitCost: "" }]);
    setLineErrors((e) => [...e, {}]);
  }

  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i));
    setLineErrors((e) => e.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof LineItem, value: string) {
    setLines((l) => {
      const next = [...l];
      next[i] = { ...next[i], [field]: value };
      if (field === "productId") {
        const p = products.find((x) => x.id === value);
        if (p) next[i].unitCost = String(p.costPerUnit);
      }
      return next;
    });
    setLineErrors((e) => {
      const next = [...e];
      next[i] = { ...next[i], [field]: undefined };
      return next;
    });
  }

  const total = lines.reduce((sum, l) => {
    const qty = parseFloat(l.quantity) || 0;
    const cost = parseFloat(l.unitCost) || 0;
    return sum + qty * cost;
  }, 0);

  function validateLines(): boolean {
    const errs: LineErrors[] = lines.map((l) => {
      const e: LineErrors = {};
      if (!l.productId) e.productId = "Select a product";
      const qty = parseFloat(l.quantity);
      if (!l.quantity || isNaN(qty) || qty <= 0) e.quantity = "Enter a positive quantity";
      const cost = parseFloat(l.unitCost);
      if (!l.unitCost || isNaN(cost) || cost <= 0) e.unitCost = "Enter a valid cost";
      return e;
    });
    setLineErrors(errs);
    return errs.every((e) => Object.keys(e).length === 0);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!validateLines()) return;

    const items = lines.map((l) => ({
      productId: l.productId,
      quantity: parseFloat(l.quantity),
      unitCost: parseFloat(l.unitCost),
    }));

    if (new Set(items.map((i) => i.productId)).size !== items.length) {
      setFormError("Duplicate products in order.");
      return;
    }

    setSaving(true);
    try {
      await ordersApi.create(items);
      onCreated();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const selectClass = "w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";
  const inputClass = "w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-500";

  const errBorder = "border-red-400 dark:border-red-600";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {formError}
        </p>
      )}

      {/* Line items */}
      <div className="space-y-3">
        <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 px-1">
          <span className="col-span-5">Product</span>
          <span className="col-span-3 text-right">Qty</span>
          <span className="col-span-3 text-right">Unit cost</span>
          <span className="col-span-1" />
        </div>

        {lines.map((line, i) => {
          const product = products.find((p) => p.id === line.productId);
          const errs = lineErrors[i] ?? {};
          return (
            <div key={i} className="space-y-1">
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <select
                    className={`${selectClass} ${errs.productId ? errBorder : ""}`}
                    value={line.productId}
                    onChange={(e) => updateLine(i, "productId", e.target.value)}
                  >
                    <option value="">Select…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <input
                    className={`${inputClass} ${errs.quantity ? errBorder : ""}`}
                    type="number" min="0" step="0.001"
                    placeholder={product ? unitLabel[product.unit] : "qty"}
                    value={line.quantity}
                    onChange={(e) => updateLine(i, "quantity", e.target.value)}
                  />
                </div>
                <div className="col-span-3">
                  <input
                    className={`${inputClass} ${errs.unitCost ? errBorder : ""}`}
                    type="number" min="0" step="0.01"
                    placeholder="0.00"
                    value={line.unitCost}
                    onChange={(e) => updateLine(i, "unitCost", e.target.value)}
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(i)}
                      className="text-gray-300 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              {(errs.productId || errs.quantity || errs.unitCost) && (
                <div className="grid grid-cols-12 gap-2 px-0.5">
                  <p className="col-span-5 text-xs text-red-500">{errs.productId ?? ""}</p>
                  <p className="col-span-3 text-xs text-red-500 text-right">{errs.quantity ?? ""}</p>
                  <p className="col-span-3 text-xs text-red-500 text-right">{errs.unitCost ?? ""}</p>
                  <span className="col-span-1" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={addLine}
        className="flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-600 font-medium">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add item
      </button>

      {/* Total */}
      <div className="flex justify-between items-center p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Total</span>
        <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(total)}</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
          {saving && <Spinner size="sm" />}
          Create Order
        </button>
      </div>
    </form>
  );
}
