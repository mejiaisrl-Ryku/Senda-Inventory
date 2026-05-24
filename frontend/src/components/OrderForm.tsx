import React, { useState, FormEvent } from "react";
import { ordersApi } from "../api";
import { formatCurrency } from "../utils/stock";
import { Spinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  { value: "",         label: "Todos" },
  { value: "KITCHEN",  label: "Kitchen" },
  { value: "FOH",      label: "FOH" },
  { value: "BAR",      label: "Bar" },
];

const CATEGORIES = [
  "", "Beer", "Liquor", "Wine", "Food", "Non Alcoholic", "Other",
];

const UNITS = ["KG", "LB", "OZ", "G", "LITERS", "PIECES", "EA", "DOZ", "CS"];

// ── Local types ───────────────────────────────────────────────────────────────

interface LineItem {
  /** Stable React key — not sent to server */
  _key: string;
  productName: string;
  sku:         string;
  category:    string;
  unit:        string;
  quantity:    string;
  unitPrice:   string;
  expanded:    boolean;
}

interface LineErrors {
  productName?: string;
  quantity?:    string;
  unitPrice?:   string;
}

export interface OrderFormProps {
  onCreated: () => void;
  onCancel:  () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function newKey() { return `line-${++_seq}`; }

function newLine(expanded = true): LineItem {
  return {
    _key: newKey(),
    productName: "",
    sku:         "",
    category:    "",
    unit:        "",
    quantity:    "",
    unitPrice:   "",
    expanded,
  };
}

function lineTotal(l: LineItem) {
  return (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OrderForm({ onCreated, onCancel }: OrderFormProps) {
  const toast = useToast();

  // ── Header fields ──────────────────────────────────────────────────────────
  const [purveyor,      setPurveyor]      = useState("");
  const [invoiceDate,   setInvoiceDate]   = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [department,    setDepartment]    = useState("");

  // ── Line items ─────────────────────────────────────────────────────────────
  const [lines,      setLines]      = useState<LineItem[]>([newLine(true)]);
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([{}]);
  const [formError,  setFormError]  = useState("");
  const [saving,     setSaving]     = useState(false);

  // ── Total ──────────────────────────────────────────────────────────────────
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  // ── Line helpers ───────────────────────────────────────────────────────────

  function addLine() {
    setLines(l => [...l, newLine(true)]);
    setLineErrors(e => [...e, {}]);
  }

  function removeLine(i: number) {
    if (lines.length <= 1) return;
    setLines(l => l.filter((_, idx) => idx !== i));
    setLineErrors(e => e.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof Omit<LineItem, "_key" | "expanded">, value: string) {
    setLines(l => {
      const next = [...l];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
    setLineErrors(e => {
      const next = [...e];
      next[i] = { ...next[i], [field]: undefined };
      return next;
    });
  }

  function toggleExpanded(i: number) {
    setLines(l => {
      const next = [...l];
      next[i] = { ...next[i], expanded: !next[i].expanded };
      return next;
    });
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: LineErrors[] = lines.map(l => {
      const e: LineErrors = {};
      if (!l.productName.trim())                          e.productName = "Product name is required";
      const qty = parseFloat(l.quantity);
      if (!l.quantity || isNaN(qty) || qty <= 0)          e.quantity    = "Enter a valid quantity";
      const price = parseFloat(l.unitPrice);
      if (l.unitPrice && (isNaN(price) || price < 0))     e.unitPrice   = "Enter a valid price";
      return e;
    });
    setLineErrors(errs);
    // Auto-expand rows that have errors so the user can see them.
    setLines(l =>
      l.map((item, i) => Object.keys(errs[i]).length > 0 ? { ...item, expanded: true } : item)
    );
    return errs.every(e => Object.keys(e).length === 0);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!purveyor.trim()) { setFormError("Purveyor name is required."); return; }
    if (!validate()) return;

    setSaving(true);
    try {
      await ordersApi.create({
        purveyor:      purveyor.trim(),
        invoiceDate:   invoiceDate   || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        department:    department    || undefined,
        items: lines.map(l => ({
          productName: l.productName.trim(),
          sku:         l.sku.trim()      || undefined,
          category:    l.category        || undefined,
          unit:        l.unit            || undefined,
          quantity:    parseFloat(l.quantity),
          unitCost:    parseFloat(l.unitPrice) || 0,
        })),
      });
      onCreated();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 " +
    "bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";
  const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";
  const errBorder = "border-red-400 dark:border-red-600";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>

      {formError && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {formError}
        </p>
      )}

      {/* ── Invoice Header ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <label className={labelCls}>
            Purveyor Name <span className="text-red-500">*</span>
          </label>
          <input
            value={purveyor}
            onChange={e => setPurveyor(e.target.value)}
            placeholder="e.g. US Foods, Sysco, Local Farm…"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Invoice Date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Invoice #</label>
            <input
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              placeholder="INV-001"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Department</label>
          <select
            value={department}
            onChange={e => setDepartment(e.target.value)}
            className={inputCls}
          >
            {DEPARTMENTS.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* ── Line Items ──────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Line Items
        </p>

        {lines.map((line, i) => {
          const errs  = lineErrors[i] ?? {};
          const total = lineTotal(line);
          const hasErr = Object.keys(errs).length > 0;

          return (
            <div
              key={line._key}
              className={`rounded-xl border overflow-hidden transition-colors ${
                hasErr
                  ? "border-red-400 dark:border-red-600"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              {/* ── Collapsed row header ────────────────────────────────────── */}
              <div
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={() => toggleExpanded(i)}
              >
                <svg
                  className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${line.expanded ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>

                <span className="flex-1 min-w-0 text-sm text-gray-900 dark:text-white truncate">
                  {line.productName || (
                    <span className="text-gray-400 dark:text-gray-500 italic">New item</span>
                  )}
                </span>

                {total > 0 && (
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300 shrink-0">
                    {formatCurrency(total)}
                  </span>
                )}

                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove item"
                    onClick={e => { e.stopPropagation(); removeLine(i); }}
                    className="shrink-0 ml-1 text-gray-300 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* ── Expanded detail ─────────────────────────────────────────── */}
              {line.expanded && (
                <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3">
                  {/* Product name */}
                  <div>
                    <label className={labelCls}>
                      Product Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={line.productName}
                      onChange={e => updateLine(i, "productName", e.target.value)}
                      placeholder="e.g. Roma Tomatoes, Chicken Breast…"
                      className={`${inputCls} ${errs.productName ? errBorder : ""}`}
                    />
                    {errs.productName && (
                      <p className="mt-0.5 text-xs text-red-500">{errs.productName}</p>
                    )}
                  </div>

                  {/* SKU + Category */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>SKU</label>
                      <input
                        value={line.sku}
                        onChange={e => updateLine(i, "sku", e.target.value)}
                        placeholder="SKU-001"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Category</label>
                      <select
                        value={line.category}
                        onChange={e => updateLine(i, "category", e.target.value)}
                        className={inputCls}
                      >
                        {CATEGORIES.map(c => (
                          <option key={c} value={c}>{c || "Select…"}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Unit + Quantity + Unit Price */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>Unit</label>
                      <select
                        value={line.unit}
                        onChange={e => updateLine(i, "unit", e.target.value)}
                        className={inputCls}
                      >
                        <option value="">—</option>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>
                        Qty <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number" min="0" step="0.001"
                        value={line.quantity}
                        onChange={e => updateLine(i, "quantity", e.target.value)}
                        placeholder="0"
                        className={`${inputCls} ${errs.quantity ? errBorder : ""}`}
                      />
                      {errs.quantity && (
                        <p className="mt-0.5 text-xs text-red-500">{errs.quantity}</p>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Unit Price</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={line.unitPrice}
                        onChange={e => updateLine(i, "unitPrice", e.target.value)}
                        placeholder="0.00"
                        className={`${inputCls} ${errs.unitPrice ? errBorder : ""}`}
                      />
                      {errs.unitPrice && (
                        <p className="mt-0.5 text-xs text-red-500">{errs.unitPrice}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add Item */}
        <button
          type="button"
          onClick={addLine}
          className="flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-600 font-medium py-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Item
        </button>
      </div>

      {/* ── Footer: running total ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-300">{lines.length}</span>{" "}
          {lines.length === 1 ? "item" : "items"}
        </span>
        <div className="text-right">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Total</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(total)}</p>
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {saving && <Spinner size="sm" />}
          Save Invoice
        </button>
      </div>
    </form>
  );
}
