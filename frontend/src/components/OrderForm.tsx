import React, { useState, FormEvent } from "react";
import { ordersApi, productsApi } from "../api";
import { Product } from "../types";
import { formatCurrency } from "../utils/stock";
import { Spinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { useLanguage } from "../context/LanguageContext";
import { CogsCategorySelect } from "./CogsCategorySelect";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPT_VALUES = ["KITCHEN", "FOH", "BAR"] as const;
type DeptValue = typeof DEPT_VALUES[number] | "";

const CATEGORIES = [
  "", "Perishable Food", "Dry Food", "Beverages",
  "Paper Goods", "Chemicals", "Office Supplies", "Miscellaneous",
];

const UNIT_VALUES = ["KG", "LB", "OZ", "G", "LITERS", "PIECES", "EA", "DOZ", "CS"];

// ── Local types ───────────────────────────────────────────────────────────────

interface LineItem {
  /** Stable React key — not sent to server */
  _key:           string;
  productName:    string;
  sku:            string;
  category:       string;
  unit:           string;
  quantity:       string;
  unitPrice:      string;
  cogsCategoryId: string;
  expanded:       boolean;
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
    _key:           newKey(),
    productName:    "",
    sku:            "",
    category:       "",
    unit:           "",
    quantity:       "",
    unitPrice:      "",
    cogsCategoryId: "",
    expanded,
  };
}

function lineTotal(l: LineItem) {
  return (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OrderForm({ onCreated, onCancel }: OrderFormProps) {
  const toast = useToast();
  const { t } = useLanguage();
  const f = t.orderForm;

  // Department tab labels keyed by value
  const deptLabels: Record<string, string> = {
    KITCHEN: t.ui.kitchen,
    FOH:     t.ui.foh,
    BAR:     t.ui.bar,
  };

  // ── Header fields ──────────────────────────────────────────────────────────
  const [purveyor,      setPurveyor]      = useState("");
  const [invoiceDate,   setInvoiceDate]   = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [department,    setDepartment]    = useState<DeptValue>("");

  // ── Line items ─────────────────────────────────────────────────────────────
  const [lines,      setLines]      = useState<LineItem[]>([newLine(true)]);
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([{}]);
  const [formError,  setFormError]  = useState("");
  const [saving,     setSaving]     = useState(false);

  // ── Product resolution phase ────────────────────────────────────────────────
  // When one or more lines match multiple products, we pause and let the chef
  // pick which existing product they mean (or add as new).
  interface PendingResolution {
    lineIndex:   number;
    productName: string;
    matches:     Product[];
    chosenId:    string | null; // null = "create new product"
  }
  type Phase = "form" | "resolving" | "saving";

  const [phase,     setPhase]     = useState<Phase>("form");
  const [pending,   setPending]   = useState<PendingResolution[]>([]);
  // Per-line resolved productId (null = create new); mirrors lines[] indices
  const [resolved,  setResolved]  = useState<(string | null | undefined)[]>([]);
  const [statusMsg, setStatusMsg] = useState("");

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
      if (!l.productName.trim())                        e.productName = f.productRequired;
      const qty = parseFloat(l.quantity);
      if (!l.quantity || isNaN(qty) || qty <= 0)        e.quantity    = f.qtyInvalid;
      const price = parseFloat(l.unitPrice);
      if (l.unitPrice && (isNaN(price) || price < 0))   e.unitPrice   = f.priceInvalid;
      return e;
    });
    setLineErrors(errs);
    // Auto-expand rows with errors so the user can see them.
    setLines(l =>
      l.map((item, i) => Object.keys(errs[i]).length > 0 ? { ...item, expanded: true } : item)
    );
    return errs.every(e => Object.keys(e).length === 0);
  }

  // ── Submit — Phase 1: validate + search ──────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!purveyor.trim()) { setFormError(f.purveyorRequired); return; }
    if (!validate()) return;

    setSaving(true);
    setStatusMsg("Looking up products…");

    try {
      // Search each line in parallel
      const searches = await Promise.all(
        lines.map(l => productsApi.search(l.productName.trim()))
      );

      // Build per-line resolutions
      const autoResolved: (string | null)[] = [];
      const needsPicker:  PendingResolution[] = [];

      searches.forEach((result, i) => {
        if (result.hasMultipleMatches) {
          // Ambiguous — chef must pick; default to first match for now
          autoResolved.push(undefined as never); // placeholder
          needsPicker.push({
            lineIndex:   i,
            productName: lines[i].productName.trim(),
            matches:     result.matches,
            chosenId:    result.matches[0]?.id ?? null,
          });
        } else if (result.exactMatch) {
          autoResolved.push(result.exactMatch.id);   // exact match → use it
        } else {
          autoResolved.push(null);                    // no match → create new
        }
      });

      setResolved(autoResolved);
      setSaving(false);
      setStatusMsg("");

      if (needsPicker.length > 0) {
        // Pause for chef to resolve ambiguous lines
        setPending(needsPicker);
        setPhase("resolving");
      } else {
        // All auto-resolved → create + receive immediately
        await createAndReceive(autoResolved);
      }
    } catch (err) {
      toast.error(getApiError(err));
      setSaving(false);
      setStatusMsg("");
    }
  }

  // ── Submit — Phase 2: after picker confirmation ────────────────────────────

  async function handleConfirmResolutions() {
    // Merge picker choices back into resolved array
    const finalResolved = [...resolved];
    for (const p of pending) {
      finalResolved[p.lineIndex] = p.chosenId; // null = create new
    }
    setPending([]);
    setPhase("saving");
    await createAndReceive(finalResolved);
  }

  // ── Core create + receive ──────────────────────────────────────────────────

  async function createAndReceive(perLine: (string | null | undefined)[]) {
    setSaving(true);
    setStatusMsg("Creating invoice…");
    try {
      // For each "create new" line, create the product first
      const withIds = await Promise.all(
        lines.map(async (l, i) => {
          let productId: string | undefined = perLine[i] ?? undefined;
          if (productId === null || productId === undefined) {
            setStatusMsg(`Creating "${l.productName.trim()}"…`);
            const newProd = await productsApi.create({
              name:          l.productName.trim(),
              sku:           l.sku.trim() || undefined,
              unit:          (l.unit || undefined) as never,
              costPerUnit:   Math.max(parseFloat(l.unitPrice) || 0.01, 0.01),
              currentStock:  0,        // receiveOrder will set stock via StockLog
              minimumStock:  0,
              cogsCategoryId: l.cogsCategoryId || undefined,
            });
            productId = newProd.id;
          }
          return { l, productId };
        })
      );

      setStatusMsg("Creating order…");
      const order = await ordersApi.create({
        purveyor:      purveyor.trim(),
        invoiceDate:   invoiceDate    || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        department:    department     || undefined,
        items: withIds.map(({ l, productId }) => ({
          productId,
          productName:     l.productName.trim(),
          sku:             l.sku.trim()     || undefined,
          category:        l.category       || undefined,
          unit:            l.unit           || undefined,
          quantity:        parseFloat(l.quantity),
          unitCost:        parseFloat(l.unitPrice) || 0,
          cogsCategoryId:  l.cogsCategoryId || undefined,
        })),
      });

      setStatusMsg("Receiving order…");
      await ordersApi.receive(order.id);

      toast.success("Invoice created and received. Stock updated.");
      onCreated();
    } catch (err) {
      toast.error(getApiError(err));
      setPhase("form");
    } finally {
      setSaving(false);
      setStatusMsg("");
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

  // ── Resolution step (multi-match picker) ────────────────────────────────────
  if (phase === "resolving" && pending.length > 0) {
    const allPicked = pending.every(p => p.chosenId !== undefined);
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-[14px] font-semibold text-white mb-0.5">Match Products</h3>
          <p className="text-[11px] text-[#555]">
            Multiple products matched some names. Select which one you ordered, or add as new.
          </p>
        </div>

        <div className="space-y-4">
          {pending.map((p, pi) => (
            <div key={p.lineIndex} className="space-y-1.5">
              <p className="text-[11px] font-semibold text-[#888] uppercase tracking-wide">
                "{p.productName}"
              </p>
              <div className="space-y-1">
                {p.matches.map(prod => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => setPending(prev =>
                      prev.map((x, xi) => xi === pi ? { ...x, chosenId: prod.id } : x)
                    )}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] border transition-colors ${
                      p.chosenId === prod.id
                        ? "bg-[#3dbf8a]/10 border-[#3dbf8a] text-white"
                        : "bg-[#111] border-[#1a1a1a] text-[#888] hover:text-white hover:border-[#2a2a2a]"
                    }`}
                  >
                    {prod.name}
                    {prod.sku && (
                      <span className="ml-2 text-[10px] text-[#444]">SKU: {prod.sku}</span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPending(prev =>
                    prev.map((x, xi) => xi === pi ? { ...x, chosenId: null } : x)
                  )}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[12px] border border-dashed transition-colors ${
                    p.chosenId === null
                      ? "border-[#3dbf8a] text-[#3dbf8a]"
                      : "border-[#2a2a2a] text-[#555] hover:text-[#3dbf8a] hover:border-[#3dbf8a]"
                  }`}
                >
                  + Add "{p.productName}" as new product
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => { setPending([]); setPhase("form"); }}
            className="flex-1 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={!allPicked || saving}
            onClick={handleConfirmResolutions}
            className="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {saving && <Spinner size="sm" />}
            Confirm &amp; Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>

      {formError && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {formError}
        </p>
      )}

      {/* ── Invoice Header ──────────────────────────────────────────────────── */}
      <div className="space-y-3">

        {/* Purveyor — first, required */}
        <div>
          <label className={labelCls}>
            {f.purveyorLabel} <span className="text-red-500">*</span>
          </label>
          <input
            value={purveyor}
            onChange={e => setPurveyor(e.target.value)}
            placeholder={f.purveyorHint}
            className={inputCls}
          />
        </div>

        {/* Date + Invoice # */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{f.invoiceDate}</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{f.invoiceNumber}</label>
            <input
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              placeholder="INV-001"
              className={inputCls}
            />
          </div>
        </div>

        {/* Department tabs */}
        <div>
          <label className={labelCls}>{f.department}</label>
          <div className="flex gap-2">
            {DEPT_VALUES.map(val => {
              const active = department === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setDepartment(active ? "" : val)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    active
                      ? "bg-brand-500 border-brand-500 text-white"
                      : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400"
                  }`}
                >
                  {deptLabels[val]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* ── Line Items ──────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {f.lineItems}
        </p>

        {lines.map((line, i) => {
          const errs   = lineErrors[i] ?? {};
          const lineTot = lineTotal(line);
          const hasErr  = Object.keys(errs).length > 0;

          return (
            <div
              key={line._key}
              className={`rounded-xl border overflow-hidden transition-colors ${
                hasErr
                  ? "border-red-400 dark:border-red-600"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              {/* ── Collapsed row header ──────────────────────────────────── */}
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
                    <span className="text-gray-400 dark:text-gray-500 italic">{f.newItem}</span>
                  )}
                </span>

                {lineTot > 0 && (
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300 shrink-0">
                    {formatCurrency(lineTot)}
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

              {/* ── Expanded detail ───────────────────────────────────────── */}
              {line.expanded && (
                <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3">
                  {/* Product name */}
                  <div>
                    <label className={labelCls}>
                      {f.productName} <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={line.productName}
                      onChange={e => updateLine(i, "productName", e.target.value)}
                      placeholder={f.productHint}
                      className={`${inputCls} ${errs.productName ? errBorder : ""}`}
                    />
                    {errs.productName && (
                      <p className="mt-0.5 text-xs text-red-500">{errs.productName}</p>
                    )}
                  </div>

                  {/* SKU + Category */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>{t.common.sku}</label>
                      <input
                        value={line.sku}
                        onChange={e => updateLine(i, "sku", e.target.value)}
                        placeholder="SKU-001"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t.common.category}</label>
                      <select
                        value={line.category}
                        onChange={e => updateLine(i, "category", e.target.value)}
                        className={inputCls}
                      >
                        {CATEGORIES.map(c => (
                          <option key={c} value={c}>
                            {c ? (t.categories[c] ?? c) : "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Unit + Quantity + Unit Price */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>{t.common.unit}</label>
                      <select
                        value={line.unit}
                        onChange={e => updateLine(i, "unit", e.target.value)}
                        className={inputCls}
                      >
                        <option value="">—</option>
                        {UNIT_VALUES.map(u => (
                          <option key={u} value={u}>
                            {(t.units as Record<string, string>)[u] ?? u}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>
                        {t.common.qty} <span className="text-red-500">*</span>
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
                      <label className={labelCls}>{t.common.costUnit}</label>
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

                  {/* COGS Category — label rendered inside CogsCategorySelect */}
                  <CogsCategorySelect
                    value={line.cogsCategoryId}
                    onChange={id => updateLine(i, "cogsCategoryId", id ?? "")}
                    label={f.cogsCategory}
                    className={inputCls}
                  />
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
          {f.addItem}
        </button>
      </div>

      {/* ── Footer: running total ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-300">{lines.length}</span>{" "}
          {lines.length === 1 ? t.common.product : t.common.products}
        </span>
        <div className="text-right">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">{t.common.total}</p>
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
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {saving && <Spinner size="sm" />}
          {saving && statusMsg ? statusMsg : f.saveInvoice}
        </button>
      </div>
    </form>
  );
}
