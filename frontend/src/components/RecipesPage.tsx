import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Product, Recipe, RecipeDepartment, RecipeIngredient } from "../types";
import { productsApi, recipesApi } from "../api";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner, Spinner } from "./shared/Spinner";
import { ConfirmDialog } from "./shared/ConfirmDialog";

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

// ── Ingredient row in the modal ───────────────────────────────────────────────

interface IngredientLine {
  key:       string; // stable local key for React
  productId: string;
  productName: string;
  productUnit: string;
  costPerUnit: number;
  quantity:  string; // string so input can be empty / partial
  unit:      string;
}

function ingCost(ing: IngredientLine): number {
  const q = parseFloat(ing.quantity);
  return isNaN(q) ? 0 : q * ing.costPerUnit;
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
      ingredients:  (recipe.ingredients ?? []).map((ing) => ({
        key:         ing.id,
        productId:   ing.productId,
        productName: ing.product?.name ?? "Unknown",
        productUnit: ing.product?.unit ?? ing.unit,
        costPerUnit: ing.product?.costPerUnit ?? 0,
        quantity:    String(ing.quantity),
        unit:        ing.unit,
      })),
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
    setForm((f) => ({
      ...f,
      ingredients: [
        ...f.ingredients,
        {
          key:         `${p.id}-${Date.now()}`,
          productId:   p.id,
          productName: p.name,
          productUnit: p.unit,
          costPerUnit: p.costPerUnit,
          quantity:    "1",
          unit:        p.unit,
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

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Recipe name is required."); return; }
    const sp = parseFloat(form.sellingPrice);
    if (!form.sellingPrice || isNaN(sp) || sp <= 0) { toast.error("Selling price must be greater than 0."); return; }
    if (form.ingredients.length === 0) { toast.error("Add at least one ingredient."); return; }

    const badQty = form.ingredients.find((i) => isNaN(parseFloat(i.quantity)) || parseFloat(i.quantity) <= 0);
    if (badQty) { toast.error(`Invalid quantity for "${badQty.productName}".`); return; }

    setSaving(true);
    try {
      const payload = {
        name:         form.name.trim(),
        department:   form.department,
        sellingPrice: sp,
        ingredients:  form.ingredients.map((i) => ({
          productId: i.productId,
          quantity:  parseFloat(i.quantity),
          unit:      i.unit,
        })),
      };

      let saved: Recipe;
      if (editTarget) {
        saved = await recipesApi.update(editTarget.id, payload);
        setRecipes((prev) => prev.map((r) => r.id === saved.id ? saved : r));
        toast.success("Recipe updated.");
      } else {
        saved = await recipesApi.create(payload);
        setRecipes((prev) => [saved, ...prev]);
        toast.success("Recipe created.");
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
          <h1 className="text-[22px] font-semibold text-white">Recipes</h1>
          <p className="text-[13px] text-[#555] mt-0.5">Recipe costing and margin analysis</p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-4 bg-[#3dbf8a] hover:bg-[#35a87a] text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Add Recipe</span>
          <span className="sm:hidden">Add</span>
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
            {d === "KITCHEN" ? "Kitchen" : "Bar"}
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
          <p className="text-[#555] text-[14px]">No {tab === "KITCHEN" ? "Kitchen" : "Bar"} recipes yet.</p>
          <button
            onClick={openAdd}
            className="mt-4 text-[#3dbf8a] text-[13px] hover:underline"
          >
            + Add your first recipe
          </button>
        </div>
      ) : (
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {[
                    { label: "Recipe",       right: false },
                    { label: "Ingredients",  right: false },
                    { label: "Selling Price",right: true  },
                    { label: "Recipe Cost",  right: true  },
                    { label: "Cost %",       right: true  },
                    { label: "",             right: false },
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
                        {ingCount} ingredient{ingCount !== 1 ? "s" : ""}
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
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteTarget(r)}
                            className="text-[12px] px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            Delete
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

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a] flex-shrink-0">
              <h2 className="text-[16px] font-semibold text-white">
                {editTarget ? "Edit Recipe" : "New Recipe"}
              </h2>
              <button
                onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">

              {/* Recipe name + dept + selling price */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Name */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                    Recipe Name
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Caesar Salad"
                    className="w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                  />
                </div>

                {/* Department */}
                <div>
                  <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                    Department
                  </label>
                  <div className="flex rounded-[8px] border border-[#2a2a2a] overflow-hidden">
                    {(["KITCHEN", "BAR"] as RecipeDepartment[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, department: d }))}
                        className={`flex-1 py-2.5 text-[13px] font-semibold transition-colors ${
                          form.department === d ? "bg-[#3dbf8a] text-white" : "bg-transparent text-[#555] hover:text-[#888]"
                        }`}
                      >
                        {d === "KITCHEN" ? "Kitchen" : "Bar"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selling price */}
                <div>
                  <label className="block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5">
                    Selling Price
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-[#555] text-sm">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.sellingPrice}
                      onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))}
                      placeholder="0.00"
                      className="w-full pl-7 pr-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Ingredients section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em]">
                    Ingredients
                  </label>
                  <span className="text-[11px] text-[#444]">{form.ingredients.length} added</span>
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
                      placeholder="Search products to add as ingredients…"
                      className="w-full pl-8 pr-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                    />
                  </div>

                  {/* Dropdown */}
                  {searchOpen && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#111] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addIngredient(p)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-[#1a1a1a] transition-colors"
                        >
                          <div>
                            <span className="text-white font-medium">{p.name}</span>
                            {p.category && (
                              <span className="ml-2 text-[11px] text-[#444]">{p.category}</span>
                            )}
                          </div>
                          <span className="text-[12px] text-[#555] ml-4 flex-shrink-0">
                            {formatCurrency(p.costPerUnit)} / {p.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchOpen && ingSearch.trim() && searchResults.length === 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#111] border border-[#2a2a2a] rounded-xl shadow-xl px-4 py-3 text-[13px] text-[#444]">
                      No products found matching "{ingSearch}"
                    </div>
                  )}
                </div>

                {/* Ingredient list */}
                {form.ingredients.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_90px_80px_32px] gap-2 px-1">
                      <span className="text-[10px] text-[#444] uppercase tracking-wider">Product</span>
                      <span className="text-[10px] text-[#444] uppercase tracking-wider text-right">Qty</span>
                      <span className="text-[10px] text-[#444] uppercase tracking-wider text-right">Cost</span>
                      <span />
                    </div>
                    {form.ingredients.map((ing) => (
                      <div
                        key={ing.key}
                        className="grid grid-cols-[1fr_90px_80px_32px] gap-2 items-center bg-[#111] border border-[#1a1a1a] rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] text-white font-medium truncate">{ing.productName}</p>
                          <p className="text-[11px] text-[#444]">{formatCurrency(ing.costPerUnit)} / {ing.productUnit}</p>
                        </div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ing.quantity}
                          onChange={(e) => updateIngQty(ing.key, e.target.value)}
                          className="w-full text-right px-2 py-1 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a] text-white text-sm focus:outline-none focus:border-[#3dbf8a] transition-colors"
                        />
                        <span className="text-right text-[13px] text-[#888] tabular-nums">
                          {formatCurrency(ingCost(ing))}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeIngredient(ing.key)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-[#444] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cost summary */}
              {form.ingredients.length > 0 && (
                <div className="bg-[#111] border border-[#1a1a1a] rounded-xl px-5 py-4 grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-[10px] text-[#444] uppercase tracking-wider mb-1">Recipe Cost</p>
                    <p className="text-[18px] font-semibold text-white tabular-nums">{formatCurrency(recipeCost)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-[#444] uppercase tracking-wider mb-1">Selling Price</p>
                    <p className="text-[18px] font-semibold text-white tabular-nums">
                      {parseFloat(form.sellingPrice) > 0 ? formatCurrency(parseFloat(form.sellingPrice)) : "—"}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-[#444] uppercase tracking-wider mb-1">Cost %</p>
                    <p className={`text-[18px] font-bold tabular-nums ${costPctColor(costPct)}`}>
                      {parseFloat(form.sellingPrice) > 0 ? `${costPct.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </div>
              )}

            </div>

            {/* Modal footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-[#1a1a1a] flex-shrink-0">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#3a3a3a] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {saving && <Spinner size="sm" />}
                {saving ? "Saving…" : editTarget ? "Save Changes" : "Create Recipe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete recipe"
        message={`"${deleteTarget?.name}" and all its ingredients will be permanently deleted.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
