import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Product, Recipe, RecipeDepartment, RecipeIngredient } from "../types";
import { productsApi, recipesApi } from "../api";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner, Spinner } from "./shared/Spinner";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { useLanguage } from "../context/LanguageContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

/** Color-code cost % thresholds: <30 green, 30-35 amber, >35 red */
function costPctColor(pct: number): string {
  if (pct < 30) return "text-[#3dbf8a]";
  if (pct <= 35) return "text-amber-400";
  return "text-red-400";
}
function costPctBg(pct: number): string {
  if (pct < 30) return "bg-[#3dbf8a]/10";
  if (pct <= 35) return "bg-amber-400/10";
  return "bg-red-400/10";
}

// ── OZ quick-select presets (bar measurements) ────────────────────────────────

const OZ_PRESETS = [
  { value: "0.25", label: "¼" },
  { value: "0.5",  label: "½" },
  { value: "0.75", label: "¾" },
  { value: "1",    label: "1" },
  { value: "1.5",  label: "1½" },
  { value: "2",    label: "2" },
] as const;

// ── Recipe-specific unit options ──────────────────────────────────────────────

const RECIPE_UNITS = [
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

// Map product Unit values → nearest RECIPE_UNITS value
function toRecipeUnit(productUnit: string): string {
  const map: Record<string, string> = { PIECES: "PCS", LITERS: "L", CS: "OZ", DOZ: "OZ" };
  return map[productUnit] ?? productUnit;
}

// ── Unit conversion helpers ───────────────────────────────────────────────────

/** Normalize product unit aliases to match recipe unit names. */
function canonUnit(u: string): string {
  const aliases: Record<string, string> = { PIECES: "PCS", LITERS: "L" };
  return aliases[u] ?? u;
}

/**
 * Returns "recipe units per 1 purchase unit" for pairs we auto-convert.
 * Returns null when the user must provide a manual conversionFactor.
 *
 * Auto-convertible:  G↔KG (1000)  OZ↔LB (16)  ML↔L (1000)  identical (1)
 */
function getAutoFactor(recipeUnit: string, purchaseUnit: string): number | null {
  const r = canonUnit(recipeUnit);
  const p = canonUnit(purchaseUnit);
  if (r === p) return 1;
  const table: Record<string, Record<string, number>> = {
    G:  { KG: 1000  },
    KG: { G: 0.001  },
    OZ: { LB: 16    },
    LB: { OZ: 0.0625 },
    ML: { L: 1000   },
    L:  { ML: 0.001 },
  };
  return table[r]?.[p] ?? null;
}

/** Returns true when the user must enter a manual conversion factor. */
function needsConversionInput(recipeUnit: string, purchaseUnit: string): boolean {
  return getAutoFactor(recipeUnit, purchaseUnit) === null;
}

/** Human-readable label for a unit (uppercase display). */
function unitLabel(u: string): string { return canonUnit(u); }

// ── Beverage case helpers ─────────────────────────────────────────────────────

/** True when this ingredient should use the beverage split-input UI. */
function isBeverageCase(ing: { category: string; productUnit: string; unit: string }): boolean {
  const pu = canonUnit(ing.productUnit);
  return ing.category === "Beverages" && (pu === "DOZ" || pu === "CS") && ing.unit === "OZ";
}

/**
 * Compute the effective conversionFactor (total oz per purchase unit) from the
 * two beverage split fields.  Returns 0 if either field is invalid.
 */
function beverageConvFactor(ozPerUnit: string, unitsPerCase: string): number {
  const oz  = parseFloat(ozPerUnit);
  const cnt = parseFloat(unitsPerCase);
  return isNaN(oz) || oz <= 0 || isNaN(cnt) || cnt <= 0 ? 0 : oz * cnt;
}

/**
 * Try to decompose a stored conversionFactor back into (ozPerUnit, unitsPerCase).
 * Prefers 12 oz, then 16 oz.  Falls back to ("", "") so the user re-enters.
 */
function decomposeBeverageFactor(cf: number): { ozPerUnit: string; unitsPerCase: string } {
  for (const oz of [12, 16, 8]) {
    if (cf > 0 && Number.isInteger(cf / oz)) {
      return { ozPerUnit: String(oz), unitsPerCase: String(cf / oz) };
    }
  }
  return { ozPerUnit: "", unitsPerCase: "" };
}

// ── Ingredient row in the modal ───────────────────────────────────────────────

interface IngredientLine {
  key:              string;  // stable local key for React
  productId:        string;
  productName:      string;
  productUnit:      string;
  category:         string;  // product category — drives beverage split-input UI
  costPerUnit:      number;
  quantity:         string;  // string so input can be empty / partial
  unit:             string;
  conversionFactor: string;  // "" when auto-convertible, otherwise user-entered number
  // Beverage split fields (DOZ/CS + OZ recipe unit + Beverages category)
  ozPerUnit:        string;  // oz per individual can/bottle  (e.g. "12" or "16")
  unitsPerCase:     string;  // cans/bottles per DOZ or CS   (e.g. "12" or "24")
}

function ingCost(ing: IngredientLine): number {
  const q = parseFloat(ing.quantity);
  if (isNaN(q) || q <= 0) return 0;

  // Beverage split-input path
  if (isBeverageCase(ing)) {
    const cf = beverageConvFactor(ing.ozPerUnit, ing.unitsPerCase);
    if (cf <= 0) return 0;
    return (q / cf) * ing.costPerUnit;
  }

  const autoFactor = getAutoFactor(ing.unit, ing.productUnit);
  if (autoFactor !== null) {
    return (q / autoFactor) * ing.costPerUnit;
  }

  // Generic manual conversion
  const cf = parseFloat(ing.conversionFactor);
  if (isNaN(cf) || cf <= 0) return 0;
  return (q / cf) * ing.costPerUnit;
}

// ── Blank ingredient form state ───────────────────────────────────────────────

function blankForm() {
  return {
    name:         "",
    department:   "KITCHEN" as RecipeDepartment,
    sellingPrice: "",
    ingredients:  [] as IngredientLine[],
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecipesPage() {
  const toast = useToast();
  const { t } = useLanguage();

  const [recipes,  setRecipes]  = useState<Recipe[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<RecipeDepartment>("KITCHEN");

  // Modal state
  const [modalOpen,   setModalOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<Recipe | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [deleteTarget,setDeleteTarget]= useState<Recipe | null>(null);
  const [deleting,    setDeleting]    = useState(false);

  // Form fields
  const [form, setForm] = useState(blankForm());

  // Ingredient search
  const [ingSearch,    setIngSearch]    = useState("");
  const [searchOpen,   setSearchOpen]   = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // ── Load data ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        recipesApi.list(),
        productsApi.list(),
      ]);
      setRecipes(r);
      setProducts(p);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Close ingredient search dropdown on outside click ──────────────────────

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // ── Filtered lists ────────────────────────────────────────────────────────

  const tabRecipes = useMemo(
    () => recipes.filter((r) => r.department === tab),
    [recipes, tab]
  );

  const searchResults = useMemo(() => {
    if (!ingSearch.trim()) return [];
    const q = ingSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          (p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)) &&
          !form.ingredients.some((i) => i.productId === p.id) // exclude already-added
      )
      .slice(0, 8);
  }, [ingSearch, products, form.ingredients]);

  // ── Computed totals ───────────────────────────────────────────────────────

  const recipeCost = useMemo(
    () => form.ingredients.reduce((s, i) => s + ingCost(i), 0),
    [form.ingredients]
  );
  const costPct = useMemo(() => {
    const sp = parseFloat(form.sellingPrice);
    return sp > 0 ? (recipeCost / sp) * 100 : 0;
  }, [recipeCost, form.sellingPrice]);

  // ── Modal helpers ─────────────────────────────────────────────────────────

  function openAdd() {
    setEditTarget(null);
    setForm({ ...blankForm(), department: tab });
    setIngSearch("");
    setModalOpen(true);
  }

  function openEdit(recipe: Recipe) {
    setEditTarget(recipe);
    setForm({
      name:         recipe.name,
      department:   recipe.department,
      sellingPrice: String(recipe.sellingPrice),
      ingredients:  (recipe.ingredients ?? []).map((ing) => {
        const productUnit = ing.product?.unit ?? ing.unit;
        const category    = ing.product?.category ?? "";
        const cf          = ing.conversionFactor;
        const isBev       = category === "Beverages" &&
                            (canonUnit(productUnit) === "DOZ" || canonUnit(productUnit) === "CS") &&
                            ing.unit === "OZ";
        const { ozPerUnit, unitsPerCase } = isBev && cf != null
          ? decomposeBeverageFactor(cf)
          : { ozPerUnit: "", unitsPerCase: "" };
        return {
          key:              ing.id,
          productId:        ing.productId,
          productName:      ing.product?.name ?? "Unknown",
          productUnit,
          category,
          costPerUnit:      ing.product?.costPerUnit ?? 0,
          quantity:         String(ing.quantity),
          unit:             ing.unit,
          conversionFactor: !isBev && cf != null ? String(cf) : "",
          ozPerUnit,
          unitsPerCase,
        };
      }),
    });
    setIngSearch("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    setForm(blankForm());
    setIngSearch("");
    setSearchOpen(false);
  }

  function addIngredient(p: Product) {
    const recipeUnit = toRecipeUnit(p.unit);
    // Default beverage split fields when adding a DOZ/CS Beverages product
    const isBev = p.category === "Beverages" && (canonUnit(p.unit) === "DOZ" || canonUnit(p.unit) === "CS");
    const defaultUnitsPerCase = canonUnit(p.unit) === "CS" ? "24" : "12";
    setForm((f) => ({
      ...f,
      ingredients: [
        ...f.ingredients,
        {
          key:              `${p.id}-${Date.now()}`,
          productId:        p.id,
          productName:      p.name,
          productUnit:      p.unit,
          category:         p.category ?? "",
          costPerUnit:      p.costPerUnit,
          quantity:         "1",
          unit:             recipeUnit,
          conversionFactor: "",
          ozPerUnit:        isBev ? "12" : "",
          unitsPerCase:     isBev ? defaultUnitsPerCase : "",
        },
      ],
    }));
    setIngSearch("");
    setSearchOpen(false);
  }

  function removeIngredient(key: string) {
    setForm((f) => ({ ...f, ingredients: f.ingredients.filter((i) => i.key !== key) }));
  }

  function updateIngQty(key: string, quantity: string) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((i) => i.key === key ? { ...i, quantity } : i),
    }));
  }

  function updateIngUnit(key: string, unit: string) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((i) =>
        i.key === key
          ? {
              ...i,
              unit,
              // Reset conversion factor when switching to a unit that doesn't need one
              conversionFactor: needsConversionInput(unit, i.productUnit) ? i.conversionFactor : "",
            }
          : i
      ),
    }));
  }

  function updateIngConvFactor(key: string, conversionFactor: string) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((i) => i.key === key ? { ...i, conversionFactor } : i),
    }));
  }

  function updateIngOzPerUnit(key: string, ozPerUnit: string) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((i) => i.key === key ? { ...i, ozPerUnit } : i),
    }));
  }

  function updateIngUnitsPerCase(key: string, unitsPerCase: string) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((i) => i.key === key ? { ...i, unitsPerCase } : i),
    }));
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) { toast.error(t.recipes.recipeName + " is required."); return; }
    const sp = parseFloat(form.sellingPrice);
    if (!form.sellingPrice || isNaN(sp) || sp <= 0) { toast.error(t.recipes.sellingPrice + " must be > 0."); return; }
    if (form.ingredients.length === 0) { toast.error(t.recipes.addIngredient + "."); return; }

    const badQty = form.ingredients.find((i) => isNaN(parseFloat(i.quantity)) || parseFloat(i.quantity) <= 0);
    if (badQty) { toast.error(`Invalid quantity for "${badQty.productName}".`); return; }

    // Validate conversion inputs for cross-system ingredients
    for (const i of form.ingredients) {
      if (!needsConversionInput(i.unit, i.productUnit)) continue;
      if (isBeverageCase(i)) {
        const oz  = parseFloat(i.ozPerUnit);
        const cnt = parseFloat(i.unitsPerCase);
        if (isNaN(oz) || oz <= 0) {
          toast.error(`Enter oz per can/bottle for "${i.productName}".`); return;
        }
        if (isNaN(cnt) || cnt <= 0) {
          toast.error(`Enter cans per ${unitLabel(i.productUnit)} for "${i.productName}".`); return;
        }
      } else {
        if (isNaN(parseFloat(i.conversionFactor)) || parseFloat(i.conversionFactor) <= 0) {
          toast.error(
            `Enter how many ${unitLabel(i.unit)} per ${unitLabel(i.productUnit)} for "${i.productName}".`
          );
          return;
        }
      }
    }

    setSaving(true);
    try {
      const payload = {
        name:         form.name.trim(),
        department:   form.department,
        sellingPrice: sp,
        ingredients:  form.ingredients.map((i) => {
          let conversionFactor: number | null = null;
          if (needsConversionInput(i.unit, i.productUnit)) {
            conversionFactor = isBeverageCase(i)
              ? beverageConvFactor(i.ozPerUnit, i.unitsPerCase)
              : parseFloat(i.conversionFactor);
          }
          return {
            productId: i.productId,
            quantity:  parseFloat(i.quantity),
            unit:      i.unit,
            conversionFactor,
          };
        }),
      };

      let saved: Recipe;
      if (editTarget) {
        saved = await recipesApi.update(editTarget.id, payload);
        setRecipes((prev) => prev.map((r) => r.id === saved.id ? saved : r));
        toast.success(t.recipes.editRecipe + " ✓");
      } else {
        saved = await recipesApi.create(payload);
        setRecipes((prev) => [saved, ...prev]);
        toast.success(t.recipes.newRecipe + " ✓");
      }
      closeModal();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await recipesApi.delete(deleteTarget.id);
      setRecipes((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      toast.success(`"${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-8 space-y-5 pb-16">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{t.recipes.title}</h1>
          <p className="text-[13px] text-[#555] mt-0.5">{t.recipes.subtitle}</p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-4 bg-[#3dbf8a] hover:bg-[#35a87a] text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">{t.recipes.newRecipe}</span>
          <span className="sm:hidden">+</span>
        </button>
      </div>

      {/* Kitchen / Bar tabs */}
      <div className="flex rounded-[8px] border border-[#2a2a2a] overflow-hidden w-fit">
        {(["KITCHEN", "BAR"] as RecipeDepartment[]).map((d) => (
          <button
            key={d}
            onClick={() => setTab(d)}
            className={`px-6 py-2 text-[13px] font-semibold transition-colors ${
              tab === d ? "bg-[#3dbf8a] text-white" : "bg-[#0a0a0a] text-[#555] hover:text-[#888]"
            }`}
          >
            {d === "KITCHEN" ? t.recipes.kitchen : t.recipes.bar}
          </button>
        ))}
      </div>

      {/* Recipe table */}
      {loading ? (
        <PageSpinner />
      ) : tabRecipes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#1a1a1a] flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-[#444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="text-[#555] text-[14px]">{tab === "KITCHEN" ? t.recipes.kitchen : t.recipes.bar} — {t.recipes.noRecipes}</p>
          <button
            onClick={openAdd}
            className="mt-4 text-[#3dbf8a] text-[13px] hover:underline"
          >
            + {t.recipes.newRecipe}
          </button>
        </div>
      ) : (
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {[
                    { label: t.recipes.title,        right: false },
                    { label: t.recipes.ingredients,  right: false },
                    { label: t.recipes.sellingPrice, right: true  },
                    { label: t.recipes.recipeCost,   right: true  },
                    { label: t.recipes.costPct,      right: true  },
                    { label: "",                     right: false },
                  ].map(({ label, right }, i) => (
                    <th
                      key={i}
                      className={`text-[10px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 whitespace-nowrap ${right ? "text-right" : "text-left"}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111]">
                {tabRecipes.map((r) => {
                  const pct  = r.costPct  ?? 0;
                  const cost = r.recipeCost ?? 0;
                  const ingCount = r.ingredients?.length ?? 0;
                  return (
                    <tr key={r.id} className="hover:bg-[#111] transition-colors group">
                      <td className="px-5 py-4 font-medium text-white">{r.name}</td>
                      <td className="px-5 py-4 text-[#666] text-[12px]">
                        {ingCount} {t.recipes.ingredients.toLowerCase()}
                      </td>
                      <td className="px-5 py-4 text-right text-[#888] tabular-nums">
                        {formatCurrency(r.sellingPrice)}
                      </td>
                      <td className="px-5 py-4 text-right text-[#888] tabular-nums">
                        {formatCurrency(cost)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className={`inline-block px-2.5 py-1 rounded-lg text-[12px] font-bold tabular-nums ${costPctColor(pct)} ${costPctBg(pct)}`}>
                          {pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(r)}
                            className="text-[12px] px-2.5 py-1 rounded-lg text-[#888] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                          >
                            {t.common.edit}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(r)}
                            className="text-[12px] px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            {t.common.delete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />

          <div className="relative w-full max-w-2xl bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

            {/* Modal header — name · dept · save all on one row */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-[#1a1a1a] flex-shrink-0 flex-wrap">
              {/* Recipe name */}
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t.recipes.recipeName + "…"}
                className="flex-1 min-w-[140px] px-3 py-2 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
              />

              {/* Dept toggle */}
              <div className="flex rounded-[8px] border border-[#2a2a2a] overflow-hidden flex-shrink-0">
                {(["KITCHEN", "BAR"] as RecipeDepartment[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, department: d }))}
                    className={`px-4 py-2 text-[12px] font-semibold transition-colors ${
                      form.department === d ? "bg-[#3dbf8a] text-white" : "bg-transparent text-[#555] hover:text-[#888]"
                    }`}
                  >
                    {d === "KITCHEN" ? t.recipes.kitchen : t.recipes.bar}
                  </button>
                ))}
              </div>

              {/* Save button */}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors flex-shrink-0"
              >
                {saving && <Spinner size="sm" />}
                {saving ? t.common.saving : editTarget ? t.common.save : t.recipes.newRecipe}
              </button>

              {/* Close */}
              <button
                onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Selling price — compact single row */}
              <div className="flex items-center gap-3">
                <label className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] whitespace-nowrap flex-shrink-0">
                  {t.recipes.sellingPrice}
                </label>
                <div className="relative w-40">
                  <span className="absolute inset-y-0 left-3 flex items-center text-[#555] text-sm">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.sellingPrice}
                    onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))}
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                  />
                </div>
              </div>

              {/* Ingredients section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em]">
                    {t.recipes.ingredients}
                  </label>
                  <span className="text-[11px] text-[#444]">{form.ingredients.length} {t.recipes.ingredients.toLowerCase()}</span>
                </div>

                {/* Ingredient search */}
                <div className="relative" ref={searchRef}>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      value={ingSearch}
                      onChange={(e) => { setIngSearch(e.target.value); setSearchOpen(true); }}
                      onFocus={() => setSearchOpen(true)}
                      placeholder={t.recipes.selectProduct + "…"}
                      className="w-full pl-8 pr-8 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                    />
                    {ingSearch && (
                      <button
                        type="button"
                        onClick={() => { setIngSearch(""); setSearchOpen(false); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#888] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Results dropdown */}
                  {searchOpen && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#111] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addIngredient(p)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-[#1a1a1a] transition-colors border-b border-[#1a1a1a] last:border-0"
                        >
                          <div className="min-w-0">
                            <span className="text-white font-medium">{p.name}</span>
                            {p.category && (
                              <span className="ml-2 text-[11px] text-[#444]">{p.category}</span>
                            )}
                          </div>
                          <span className="text-[12px] text-[#555] ml-4 flex-shrink-0 tabular-nums">
                            {formatCurrency(p.costPerUnit)} / {p.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* No results hint */}
                  {searchOpen && ingSearch.trim().length >= 2 && searchResults.length === 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#111] border border-[#2a2a2a] rounded-xl shadow-xl px-4 py-3">
                      <p className="text-[13px] text-[#444]">No products found for "<span className="text-[#666]">{ingSearch}</span>"</p>
                      <p className="text-[11px] text-[#333] mt-1">Make sure the product exists in your Invoices list.</p>
                    </div>
                  )}
                </div>

                {/* Ingredient list */}
                {form.ingredients.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_68px_100px_72px_28px] gap-1.5 px-1">
                      <span className="text-[10px] text-[#444] uppercase tracking-wider">{t.productForm.nameLabel}</span>
                      <span className="text-[10px] text-[#444] uppercase tracking-wider text-right">{t.recipes.quantityLabel}</span>
                      <span className="text-[10px] text-[#444] uppercase tracking-wider">{t.recipes.unitLabel}</span>
                      <span className="text-[10px] text-[#444] uppercase tracking-wider text-right">{t.productForm.costUnitLabel}</span>
                      <span />
                    </div>
                    {form.ingredients.map((ing) => {
                      const needsConv = needsConversionInput(ing.unit, ing.productUnit);
                      const autoFactor = getAutoFactor(ing.unit, ing.productUnit);
                      const cost = ingCost(ing);
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
                            {/* Product info */}
                            <div className="min-w-0">
                              <p className="text-[13px] text-white font-medium truncate">{ing.productName}</p>
                              <p className="text-[11px] text-[#444]">
                                {formatCurrency(ing.costPerUnit)}/{unitLabel(ing.productUnit)}
                                {autoFactor !== null && autoFactor !== 1 && (
                                  <span className="ml-1 text-[#3dbf8a]/60">
                                    · auto {autoFactor > 1 ? `÷${autoFactor}` : `×${1/autoFactor}`}
                                  </span>
                                )}
                              </p>
                            </div>

                            {/* Quantity */}
                            <input
                              type="text"
                              inputMode="decimal"
                              value={ing.quantity}
                              onChange={(e) => updateIngQty(ing.key, e.target.value)}
                              className="w-full text-right px-2 py-1.5 rounded-[6px] bg-[#0a0a0a] border border-[#2a2a2a] text-white text-sm focus:outline-none focus:border-[#3dbf8a] transition-colors"
                            />

                            {/* Unit dropdown */}
                            <select
                              value={ing.unit}
                              onChange={(e) => updateIngUnit(ing.key, e.target.value)}
                              className="w-full px-2 py-1.5 rounded-[6px] bg-[#0a0a0a] border border-[#2a2a2a] text-white text-[12px] focus:outline-none focus:border-[#3dbf8a] transition-colors appearance-none cursor-pointer"
                            >
                              {RECIPE_UNITS.map(({ value, label }) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>

                            {/* Computed cost */}
                            <span className={`text-right text-[12px] tabular-nums leading-tight ${
                              needsConv && cost === 0 ? "text-[#444]" : "text-[#888]"
                            }`}>
                              {needsConv && cost === 0 ? "—" : formatCurrency(cost)}
                            </span>

                            {/* Remove */}
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
                                    onClick={() => updateIngQty(ing.key, value)}
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

                          {/* Beverage split inputs — DOZ/CS + OZ + Beverages category */}
                          {needsConv && isBeverageCase(ing) && (
                            <div className="space-y-2 pt-1.5 border-t border-[#1d1d1d]">
                              {/* Row 1: oz per can/bottle */}
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-[#555] whitespace-nowrap w-36 flex-shrink-0">
                                  {t.recipes.ozPerUnit}
                                </span>
                                {/* Quick-select: 12 and 16 */}
                                {[12, 16].map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    onClick={() => updateIngOzPerUnit(ing.key, String(v))}
                                    className={`px-2.5 py-1 rounded-[6px] text-[12px] font-medium tabular-nums transition-colors flex-shrink-0 ${
                                      parseFloat(ing.ozPerUnit) === v
                                        ? "bg-[#3dbf8a] text-white"
                                        : "bg-[#0a0a0a] border border-[#2a2a2a] text-[#666] hover:text-white hover:border-[#444]"
                                    }`}
                                  >
                                    {v}
                                  </button>
                                ))}
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={ing.ozPerUnit}
                                  onChange={(e) => updateIngOzPerUnit(ing.key, e.target.value)}
                                  placeholder="oz"
                                  className="w-16 text-right px-2 py-1 rounded-[6px] bg-[#0a0a0a] border border-amber-500/30 text-amber-300 text-[12px] placeholder-[#444] focus:outline-none focus:border-amber-400 transition-colors"
                                />
                                <span className="text-[11px] text-[#444]">oz / unit</span>
                              </div>
                              {/* Row 2: units per case/dozen */}
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-[#555] whitespace-nowrap w-36 flex-shrink-0">
                                  {t.recipes.unitsPerCase} {unitLabel(ing.productUnit)}?
                                </span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={ing.unitsPerCase}
                                  onChange={(e) => updateIngUnitsPerCase(ing.key, e.target.value)}
                                  placeholder="12"
                                  className="w-16 text-right px-2 py-1 rounded-[6px] bg-[#0a0a0a] border border-amber-500/30 text-amber-300 text-[12px] placeholder-[#444] focus:outline-none focus:border-amber-400 transition-colors"
                                />
                                <span className="text-[11px] text-[#444]">cans / {unitLabel(ing.productUnit)}</span>
                                {/* Live total + cost */}
                                {beverageConvFactor(ing.ozPerUnit, ing.unitsPerCase) > 0 && (
                                  <span className="ml-auto text-[11px] text-[#555] tabular-nums whitespace-nowrap">
                                    {beverageConvFactor(ing.ozPerUnit, ing.unitsPerCase)} oz/{unitLabel(ing.productUnit)}
                                    {cost > 0 && (
                                      <span className="ml-2 text-[#3dbf8a]/70">= {formatCurrency(cost)}</span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Generic conversion factor row — all other cross-system pairs */}
                          {needsConv && !isBeverageCase(ing) && (
                            <div className="flex items-center gap-2 pt-1.5 border-t border-[#1d1d1d]">
                              <svg className="w-3 h-3 text-amber-500/60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                              </svg>
                              <span className="text-[11px] text-[#555] whitespace-nowrap">
                                How many <span className="text-amber-400/80 font-medium">{unitLabel(ing.unit)}</span> per{" "}
                                <span className="text-[#888] font-medium">{unitLabel(ing.productUnit)}</span>?
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={ing.conversionFactor}
                                onChange={(e) => updateIngConvFactor(ing.key, e.target.value)}
                                placeholder="e.g. 450"
                                className="w-24 text-right px-2 py-1 rounded-[6px] bg-[#0a0a0a] border border-amber-500/30 text-amber-300 text-[12px] placeholder-[#444] focus:outline-none focus:border-amber-400 transition-colors"
                              />
                              <span className="text-[11px] text-[#444] whitespace-nowrap">
                                {unitLabel(ing.unit)}/{unitLabel(ing.productUnit)}
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

              {/* Cost summary */}
              {form.ingredients.length > 0 && (
                <div className="bg-[#111] border border-[#1a1a1a] rounded-xl px-5 py-4 grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-[10px] text-[#444] uppercase tracking-wider mb-1">{t.recipes.recipeCost}</p>
                    <p className="text-[18px] font-semibold text-white tabular-nums">{formatCurrency(recipeCost)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-[#444] uppercase tracking-wider mb-1">{t.recipes.sellingPrice}</p>
                    <p className="text-[18px] font-semibold text-white tabular-nums">
                      {parseFloat(form.sellingPrice) > 0 ? formatCurrency(parseFloat(form.sellingPrice)) : "—"}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-[#444] uppercase tracking-wider mb-1">{t.recipes.costPct}</p>
                    <p className={`text-[18px] font-bold tabular-nums ${costPctColor(costPct)}`}>
                      {parseFloat(form.sellingPrice) > 0 ? `${costPct.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </div>
              )}

            </div>

            {/* Modal footer — cancel only; save is in the header row */}
            <div className="flex px-5 py-3 border-t border-[#1a1a1a] flex-shrink-0">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="px-4 py-2 rounded-[8px] border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#3a3a3a] disabled:opacity-50 transition-colors"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t.recipes.deleteRecipe}
        message={`"${deleteTarget?.name}" — ${t.recipes.deleteConfirm}`}
        confirmLabel={t.common.delete}
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
