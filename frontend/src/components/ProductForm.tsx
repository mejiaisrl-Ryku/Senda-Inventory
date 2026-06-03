import React, { useState, FormEvent, useEffect } from "react";
import { Product, Unit, Department } from "../types";
import { productsApi } from "../api";
import { CogsCategorySelect } from "./CogsCategorySelect";
import { Spinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError, getFieldErrors } from "../utils/errorUtils";
import { useLanguage } from "../context/LanguageContext";

interface ProductFormProps {
  initial?: Product;
  onSaved: (product: Product) => void;
  onCancel: () => void;
}

const UNITS: { value: Unit; label: string }[] = [
  { value: "KG", label: "KG – Kilograms" },
  { value: "LITERS", label: "L – Liters" },
  { value: "PIECES", label: "PCS – Pieces" },
  { value: "LB", label: "LB – Pounds" },
  { value: "OZ", label: "OZ – Ounces" },
  { value: "G", label: "G – Grams" },
  { value: "EA", label: "EA – Each" },
  { value: "DOZ", label: "DOZ – Dozen" },
  { value: "CS",  label: "CS – Case"   },
];

const CATEGORIES = [
  "Perishable Food",
  "Dry Food",
  "Beverages",
  "Paper Goods",
  "Chemicals",
  "Office Supplies",
  "Miscellaneous",
] as const;

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "BOH", label: "Kitchen" },
  { value: "FOH", label: "FOH" },
  { value: "BAR", label: "BAR" },
];


type FieldErrors = Partial<Record<
  "name" | "sku" | "category" | "purveyor" | "invoiceDate" | "costPerUnit" | "currentStock" | "minimumStock",
  string
>>;

export function ProductForm({ initial, onSaved, onCancel }: ProductFormProps) {
  const toast = useToast();
  const { t } = useLanguage();
  const [name, setName] = useState(initial?.name ?? "");
  const [purveyor, setPurveyor] = useState(initial?.purveyor ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ? initial.invoiceDate.slice(0, 10) : "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [cogsCategoryId, setCogsCategoryId] = useState<string>(initial?.cogsCategoryId ?? "");
  const [department, setDepartment] = useState<Department>(initial?.department ?? "BOH");
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? "PIECES");
  const [costPerUnit, setCostPerUnit] = useState(String(initial?.costPerUnit ?? ""));
  const [currentStock, setCurrentStock] = useState(String(initial?.currentStock ?? 0));
  const [minimumStock, setMinimumStock] = useState(String(initial?.minimumStock ?? 0));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setPurveyor(initial.purveyor ?? "");
      setInvoiceDate(initial.invoiceDate ? initial.invoiceDate.slice(0, 10) : "");
      setSku(initial.sku ?? "");
      setCategory(initial.category ?? "");
      setCogsCategoryId(initial.cogsCategoryId ?? "");
      setDepartment(initial.department ?? "BOH");
      setUnit(initial.unit);
      setCostPerUnit(String(initial.costPerUnit));
      setCurrentStock(String(initial.currentStock));
      setMinimumStock(String(initial.minimumStock));
      setFieldErrors({});
    }
  }, [initial]);

  function validateLocal(): FieldErrors {
    const errs: FieldErrors = {};
    if (!name.trim()) errs.name = t.productForm.nameRequired;
    else if (name.length > 255) errs.name = t.productForm.nameTooLong;
    const cost = parseFloat(costPerUnit);
    if (!costPerUnit || isNaN(cost) || cost <= 0) errs.costPerUnit = t.productForm.costInvalid;
    const stock = parseFloat(currentStock);
    if (isNaN(stock) || stock < 0) errs.currentStock = t.productForm.stockNegative;
    const minStock = parseFloat(minimumStock);
    if (isNaN(minStock) || minStock < 0) errs.minimumStock = t.productForm.minStockNegative;
    if (!isNaN(minStock) && !isNaN(stock) && minStock > stock) {
      errs.minimumStock = t.productForm.minExceedsCurrent;
    }
    return errs;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const localErrs = validateLocal();
    if (Object.keys(localErrs).length > 0) {
      setFieldErrors(localErrs);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    const payload = {
      name: name.trim(),
      purveyor: purveyor.trim() || undefined,
      invoiceDate: invoiceDate || undefined,
      sku: sku.trim() || undefined,
      category: category || undefined,
      cogsCategoryId: cogsCategoryId || undefined,
      department,
      unit,
      costPerUnit: parseFloat(costPerUnit),
      currentStock: parseFloat(currentStock),
      minimumStock: parseFloat(minimumStock),
    };
    try {
      const saved = initial
        ? await productsApi.update(initial.id, payload)
        : await productsApi.create(payload);
      toast.success(initial ? t.productForm.editProduct : t.productForm.addProduct);
      onSaved(saved);
    } catch (err) {
      const serverFields = getFieldErrors(err);
      if (Object.keys(serverFields).length > 0) {
        setFieldErrors(serverFields as FieldErrors);
      } else {
        toast.error(getApiError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  const base = "w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-colors";
  const fieldClass = (err?: string) =>
    `${base} ${err ? "border-red-400 dark:border-red-600" : "border-gray-300 dark:border-gray-600"}`;

  function FieldError({ msg }: { msg?: string }) {
    if (!msg) return null;
    return <p className="mt-1 text-xs text-red-500 dark:text-red-400">{msg}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        {/* Name */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {t.productForm.nameLabel} <span className="text-red-500">*</span>
          </label>
          <input
            className={fieldClass(fieldErrors.name)}
            value={name}
            onChange={(e) => { setName(e.target.value); setFieldErrors((f) => ({ ...f, name: undefined })); }}
            placeholder={t.productForm.namePlaceholder}
            maxLength={255}
          />
          <FieldError msg={fieldErrors.name} />
        </div>

        {/* Purveyor */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.productForm.purveyorLabel}</label>
          <input
            className={fieldClass()}
            value={purveyor}
            onChange={(e) => setPurveyor(e.target.value)}
            placeholder={t.productForm.purveyorPlaceholder}
            maxLength={255}
          />
        </div>

        {/* Invoice Date */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.productForm.invoiceDateLabel}</label>
          <input
            type="date"
            className={fieldClass()}
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>

        {/* Department toggle */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            {t.productForm.departmentLabel} <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-1.5">
            {DEPARTMENTS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDepartment(value)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  department === value
                    ? "bg-[#3dbf8a] border-[#3dbf8a] text-white"
                    : "bg-transparent border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-[#3dbf8a] hover:text-[#3dbf8a]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* SKU */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.productForm.skuLabel}</label>
          <input className={fieldClass(fieldErrors.sku)} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="PROD-001" />
          <FieldError msg={fieldErrors.sku} />
        </div>

        {/* Category dropdown */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.productForm.categoryLabel}</label>
          <select
            className={fieldClass()}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{t.productForm.categoryPlaceholder}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{t.categories[c] ?? c}</option>
            ))}
          </select>
        </div>

        {/* COGS Category */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {t.productForm.cogsCategory}
          </label>
          <CogsCategorySelect
            value={cogsCategoryId}
            onChange={id => setCogsCategoryId(id ?? "")}
            className={fieldClass()}
          />
        </div>

        {/* Unit */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {t.productForm.unitLabel} <span className="text-red-500">*</span>
          </label>
          <select className={fieldClass()} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        {/* Cost / unit */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {t.productForm.costUnitLabel} <span className="text-red-500">*</span>
          </label>
          <input
            className={`${fieldClass(fieldErrors.costPerUnit)} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            type="text"
            inputMode="decimal"
            value={costPerUnit}
            onChange={(e) => { setCostPerUnit(e.target.value); setFieldErrors((f) => ({ ...f, costPerUnit: undefined })); }}
            placeholder="0.00"
          />
          <FieldError msg={fieldErrors.costPerUnit} />
        </div>

        {/* Current stock */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.productForm.currentStockLabel}</label>
          <input
            className={fieldClass(fieldErrors.currentStock)}
            type="number" min="0" step="0.001"
            value={currentStock}
            onChange={(e) => { setCurrentStock(e.target.value); setFieldErrors((f) => ({ ...f, currentStock: undefined, minimumStock: undefined })); }}
          />
          <FieldError msg={fieldErrors.currentStock} />
        </div>

        {/* Minimum stock */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.productForm.minimumStockLabel}</label>
          <input
            className={fieldClass(fieldErrors.minimumStock)}
            type="number" min="0" step="0.001"
            value={minimumStock}
            onChange={(e) => { setMinimumStock(e.target.value); setFieldErrors((f) => ({ ...f, minimumStock: undefined })); }}
          />
          <FieldError msg={fieldErrors.minimumStock} />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} disabled={saving}
          className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors">
          {t.common.cancel}
        </button>
        <button type="submit" disabled={saving}
          className="flex-1 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
          {saving && <Spinner size="sm" />}
          {initial ? t.common.save : t.productForm.addProduct}
        </button>
      </div>
    </form>
  );
}
