import React, { useState, useEffect, useCallback, useMemo, useRef, FormEvent } from "react";
import { Preparation, ConservationType, Allergen, Product } from "../types";
import { preparationsApi, allergensApi, productsApi } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { Spinner } from "./shared/Spinner";
import { AllergenMultiSelect } from "./AllergenMultiSelect";
import { formatCurrency } from "../utils/stock";
import { toLineUnit, needsConversionInput, lineCost, getAutoFactor, canonUnit } from "../utils/ingredientCost";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (prep: Preparation) => void;
  initialData?: Preparation;
  initialAllergenIds?: number[];
}

interface IngredientLine {
  key:              string;
  productId:        string;
  productName:      string;
  productUnit:      string;
  costPerUnit:      number;
  quantity:         string;
  unit:             string;
  conversionFactor: string;
}

const inputClass =
  "w-full px-3 py-2 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";
const labelClass = "text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] block mb-2";

// Mirrors RECIPE_UNITS / OZ_PRESETS in RecipesPage.tsx — same unit set and
// conversion-input parameters as the Recipes ingredient table.
const LINE_UNITS = [
  { value: "PCS", label: "PCS – Pieces"      },
  { value: "KG",  label: "KG – Kilograms"    },
  { value: "G",   label: "G – Grams"         },
  { value: "L",   label: "L – Liters"        },
  { value: "ML",  label: "ML – Milliliters"  },
  { value: "LB",  label: "LB – Pounds"       },
  { value: "OZ",  label: "OZ – Ounces"       },
  { value: "EA",  label: "EA – Each"         },
  { value: "DOZ", label: "DOZ – Dozen"       },
] as const;

const OZ_PRESETS = [
  { value: "0.25", label: "¼" },
  { value: "0.5",  label: "½" },
  { value: "0.75", label: "¾" },
  { value: "1",    label: "1" },
  { value: "1.5",  label: "1½" },
  { value: "2",    label: "2" },
] as const;

export function PreparationModal({ open, onClose, onSaved, initialData, initialAllergenIds }: Props) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const isEditing = !!initialData;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preparationMethod, setPreparationMethod] = useState("");
  const [platingNotes, setPlatingNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [shelfLifeDays, setShelfLifeDays] = useState("");
  const [storageTemp, setStorageTemp] = useState("");
  const [conservationType, setConservationType] = useState<ConservationType | "">("");
  const [almacen, setAlmacen] = useState("");
  const [recipeYield, setRecipeYield] = useState("");
  const [recipeYieldUnit, setRecipeYieldUnit] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [allergenIds, setAllergenIds] = useState<number[]>([]);
  const [ingredients, setIngredients] = useState<IngredientLine[]>([]);

  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);

  const [ingSearch, setIngSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    allergensApi.list().then(setAllergens).catch((err) => {
      console.error("PreparationModal: failed to load allergens", err);
    });
    productsApi.list().then(setProducts).catch((err) => {
      console.error("PreparationModal: failed to load products", err);
    });
  }, [open]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setName(initialData.name);
      setDescription(initialData.description ?? "");
      setPreparationMethod(initialData.preparationMethod ?? "");
      setPlatingNotes(initialData.platingNotes ?? "");
      setPhotoUrl(initialData.photoUrl ?? "");
      setShelfLifeDays(initialData.shelfLifeDays?.toString() ?? "");
      setStorageTemp(initialData.storageTemp ?? "");
      setConservationType(initialData.conservationType ?? "");
      setAlmacen(initialData.almacen ?? "");
      setRecipeYield(initialData.recipeYield?.toString() ?? "");
      setRecipeYieldUnit(initialData.recipeYieldUnit ?? "");
      setCurrentStock(initialData.currentStock?.toString() ?? "0");
      setAllergenIds(initialAllergenIds ?? []);
      setIngredients(
        (initialData.ingredients ?? []).map((ing) => ({
          key:              ing.id,
          productId:        ing.productId,
          productName:      ing.product?.name ?? "Unknown",
          productUnit:      ing.product?.unit ?? ing.unit,
          costPerUnit:      ing.product?.costPerUnit ?? 0,
          quantity:         String(ing.quantity),
          unit:             ing.unit,
          conversionFactor: ing.conversionFactor != null ? String(ing.conversionFactor) : "",
        }))
      );
    } else {
      setName("");
      setDescription("");
      setPreparationMethod("");
      setPlatingNotes("");
      setPhotoUrl("");
      setShelfLifeDays("");
      setStorageTemp("");
      setConservationType("");
      setAlmacen("");
      setRecipeYield("");
      setRecipeYieldUnit("");
      setCurrentStock("0");
      setAllergenIds([]);
      setIngredients([]);
    }
    setIngSearch("");
    setSearchOpen(false);
  }, [open, initialData, initialAllergenIds]);

  const toggleAllergen = useCallback((id: number) => {
    setAllergenIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }, []);

  const searchResults = useMemo(() => {
    if (!ingSearch.trim()) return [];
    const q = ingSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          (p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)) &&
          !ingredients.some((i) => i.productId === p.id)
      )
      .slice(0, 8);
  }, [ingSearch, products, ingredients]);

  function addIngredient(p: Product) {
    setIngredients((prev) => [
      ...prev,
      {
        key:              `${p.id}-${Date.now()}`,
        productId:        p.id,
        productName:      p.name,
        productUnit:      p.unit,
        costPerUnit:      p.costPerUnit,
        quantity:         "1",
        unit:             toLineUnit(p.unit),
        conversionFactor: "",
      },
    ]);
    setIngSearch("");
    setSearchOpen(false);
  }

  function removeIngredient(key: string) {
    setIngredients((prev) => prev.filter((i) => i.key !== key));
  }

  function updateIngredient(key: string, patch: Partial<IngredientLine>) {
    setIngredients((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  const totalCost = useMemo(
    () => ingredients.reduce((sum, ing) => sum + lineCost(ing), 0),
    [ingredients]
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t.common.required);
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      preparationMethod: preparationMethod.trim() || null,
      platingNotes: platingNotes.trim() || null,
      photoUrl: photoUrl.trim() || null,
      shelfLifeDays: shelfLifeDays ? parseInt(shelfLifeDays, 10) : null,
      storageTemp: storageTemp.trim() || null,
      conservationType: conservationType || null,
      almacen: almacen.trim() || null,
      recipeYield: recipeYield ? parseFloat(recipeYield) : null,
      recipeYieldUnit: recipeYieldUnit || null,
      currentStock: currentStock ? parseFloat(currentStock) : 0,
      allergenIds,
      ingredients: ingredients
        .filter((ing) => parseFloat(ing.quantity) > 0)
        .map((ing) => ({
          productId: ing.productId,
          quantity: parseFloat(ing.quantity),
          unit: ing.unit,
          conversionFactor: ing.conversionFactor ? parseFloat(ing.conversionFactor) : null,
        })),
    };

    setSaving(true);
    try {
      const saved = isEditing
        ? await preparationsApi.update(initialData!.id, payload)
        : await preparationsApi.create(payload);
      onSaved(saved);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-[#1a1a1a] flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-white">
            {isEditing ? t.preparations.edit : t.preparations.addNew}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Ingredients — search products and build the cost breakdown */}
          <div>
            <label className={labelClass}>{t.recipes.ingredients}</label>
            <div ref={searchRef} className="relative">
              <input
                type="text"
                value={ingSearch}
                onChange={(e) => { setIngSearch(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder={t.recipes.addIngredient}
                className={inputClass}
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-[#161616] border border-[#2a2a2a] rounded-[8px] shadow-lg py-1">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addIngredient(p)}
                      className="w-full text-left px-3 py-2 hover:bg-[#1f1f1f] transition-colors"
                    >
                      <p className="text-sm text-white">{p.name}</p>
                      <p className="text-[11px] text-[#555]">{p.category} · {formatCurrency(p.costPerUnit)}/{p.unit}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {ingredients.length > 0 && (
              <div className="mt-3 space-y-2">
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_68px_100px_72px_28px] gap-1.5 px-1">
                  <span className="text-[10px] text-[#444] uppercase tracking-wider">{t.productForm.nameLabel}</span>
                  <span className="text-[10px] text-[#444] uppercase tracking-wider text-right">{t.recipes.quantityLabel}</span>
                  <span className="text-[10px] text-[#444] uppercase tracking-wider">{t.recipes.unitLabel}</span>
                  <span className="text-[10px] text-[#444] uppercase tracking-wider text-right">{t.productForm.costUnitLabel}</span>
                  <span />
                </div>
                {ingredients.map((ing) => {
                  const needsConv = needsConversionInput(ing.unit, ing.productUnit);
                  const autoFactor = getAutoFactor(ing.unit, ing.productUnit);
                  const cost = lineCost(ing);
                  return (
                    <div
                      key={ing.key}
                      className={`bg-[#111] border rounded-lg px-3 py-2 space-y-2 ${
                        needsConv && (!ing.conversionFactor || parseFloat(ing.conversionFactor) <= 0)
                          ? "border-amber-600/30"
                          : "border-[#1a1a1a]"
                      }`}
                    >
                      {/* Main row */}
                      <div className="grid grid-cols-[1fr_68px_100px_72px_28px] gap-1.5 items-center">
                        <div className="min-w-0">
                          <p className="text-[13px] text-white font-medium truncate">{ing.productName}</p>
                          <p className="text-[11px] text-[#444]">
                            {formatCurrency(ing.costPerUnit)}/{canonUnit(ing.productUnit)}
                            {autoFactor !== null && autoFactor !== 1 && (
                              <span className="ml-1 text-[#3dbf8a]/60">
                                · auto {autoFactor > 1 ? `÷${autoFactor}` : `×${1 / autoFactor}`}
                              </span>
                            )}
                          </p>
                        </div>

                        <input
                          type="text"
                          inputMode="decimal"
                          value={ing.quantity}
                          onChange={(e) => updateIngredient(ing.key, { quantity: e.target.value })}
                          className="w-full text-right px-2 py-1.5 rounded-[6px] bg-[#0a0a0a] border border-[#2a2a2a] text-white text-sm focus:outline-none focus:border-[#3dbf8a] transition-colors"
                        />

                        <select
                          value={ing.unit}
                          onChange={(e) => updateIngredient(ing.key, { unit: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-[6px] bg-[#0a0a0a] border border-[#2a2a2a] text-white text-[12px] focus:outline-none focus:border-[#3dbf8a] transition-colors appearance-none cursor-pointer"
                        >
                          {LINE_UNITS.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>

                        <span className={`text-right text-[12px] tabular-nums leading-tight ${
                          needsConv && cost === 0 ? "text-[#444]" : "text-[#888]"
                        }`}>
                          {needsConv && cost === 0 ? "—" : formatCurrency(cost)}
                        </span>

                        <button
                          type="button"
                          onClick={() => removeIngredient(ing.key)}
                          className="w-6 h-6 flex items-center justify-center rounded-md text-[#444] hover:text-red-400 hover:bg-red-400/10 transition-colors mx-auto"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {/* OZ quick-select — shown when unit is OZ */}
                      {ing.unit === "OZ" && (
                        <div className="flex items-center gap-1.5 pt-1.5 border-t border-[#1d1d1d]">
                          <span className="text-[10px] text-[#444] uppercase tracking-wider mr-0.5 flex-shrink-0">oz</span>
                          {OZ_PRESETS.map(({ value, label }) => {
                            const isActive = parseFloat(ing.quantity) === parseFloat(value);
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => updateIngredient(ing.key, { quantity: value })}
                                className={`px-2.5 py-1 rounded-[6px] text-[12px] font-medium tabular-nums transition-colors flex-shrink-0 ${
                                  isActive
                                    ? "bg-[#3dbf8a] text-white"
                                    : "bg-[#0a0a0a] border border-[#2a2a2a] text-[#666] hover:text-white hover:border-[#444]"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Generic conversion factor row — cross-system pairs */}
                      {needsConv && (
                        <div className="flex items-center gap-2 pt-1.5 border-t border-[#1d1d1d]">
                          <svg className="w-3 h-3 text-amber-500/60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          <span className="text-[11px] text-[#555] whitespace-nowrap">
                            How many <span className="text-amber-400/80 font-medium">{canonUnit(ing.unit)}</span> per{" "}
                            <span className="text-[#888] font-medium">{canonUnit(ing.productUnit)}</span>?
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={ing.conversionFactor}
                            onChange={(e) => updateIngredient(ing.key, { conversionFactor: e.target.value })}
                            placeholder="e.g. 450"
                            className="w-24 text-right px-2 py-1 rounded-[6px] bg-[#0a0a0a] border border-amber-500/30 text-amber-300 text-[12px] placeholder-[#444] focus:outline-none focus:border-amber-400 transition-colors"
                          />
                          <span className="text-[11px] text-[#444] whitespace-nowrap">
                            {canonUnit(ing.unit)}/{canonUnit(ing.productUnit)}
                          </span>
                          {ing.conversionFactor && parseFloat(ing.conversionFactor) > 0 && (
                            <span className="ml-auto text-[11px] text-[#3dbf8a]/70 tabular-nums whitespace-nowrap">
                              = {formatCurrency(cost)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <AllergenMultiSelect
            allergens={allergens}
            selectedIds={allergenIds}
            onToggle={toggleAllergen}
            lang={lang}
            label={t.preparations.allergens}
            placeholder={t.preparations.noAllergens}
          />

          <div>
            <label className={labelClass}>
              {t.preparations.name} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>{t.preparations.description}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>{t.preparations.preparationMethod}</label>
            <textarea
              value={preparationMethod}
              onChange={(e) => setPreparationMethod(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t.preparations.shelfLifeDays}</label>
              <input
                type="number"
                value={shelfLifeDays}
                onChange={(e) => setShelfLifeDays(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.preparations.storageTemp}</label>
              <input
                type="text"
                value={storageTemp}
                onChange={(e) => setStorageTemp(e.target.value)}
                placeholder="e.g., 4°C"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>{t.preparations.conservationType}</label>
            <select
              value={conservationType}
              onChange={(e) => setConservationType(e.target.value as ConservationType | "")}
              className={inputClass}
            >
              <option value="">—</option>
              <option value="REFRIGERADO">{t.preparations.conservationTypes.REFRIGERADO}</option>
              <option value="CONGELADO">{t.preparations.conservationTypes.CONGELADO}</option>
              <option value="AMBIENTE">{t.preparations.conservationTypes.AMBIENTE}</option>
            </select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>{t.preparations.almacen}</label>
              <input
                type="text"
                value={almacen}
                onChange={(e) => setAlmacen(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.preparations.cost}</label>
              <div className={`${inputClass} flex items-center text-[#3dbf8a] font-semibold`}>
                {formatCurrency(totalCost)}
              </div>
            </div>
            <div>
              <label className={labelClass}>{t.preparations.stock}</label>
              <input
                type="number"
                step="0.01"
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t.preparations.recipeYield}</label>
              <input
                type="number"
                step="0.01"
                value={recipeYield}
                onChange={(e) => setRecipeYield(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.preparations.recipeYieldUnit}</label>
              <select
                value={recipeYieldUnit}
                onChange={(e) => setRecipeYieldUnit(e.target.value)}
                className={inputClass}
              >
                <option value="">—</option>
                {t.preparations.yieldUnits.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t border-[#1a1a1a]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-[8px] border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#3a3a3a] disabled:opacity-50 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors"
            >
              {saving && <Spinner size="sm" />}
              {saving ? t.common.saving : t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
