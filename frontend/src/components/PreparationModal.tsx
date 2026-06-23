import React, { useState, useEffect, useCallback, FormEvent } from "react";
import { Preparation, ConservationType, Allergen } from "../types";
import { preparationsApi, allergensApi } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { Spinner } from "./shared/Spinner";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (prep: Preparation) => void;
  initialData?: Preparation;
  initialAllergenIds?: number[];
}

const inputClass =
  "w-full px-3 py-2 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";
const labelClass = "text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] block mb-2";

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
  const [allergenIds, setAllergenIds] = useState<number[]>([]);

  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    allergensApi.list().then(setAllergens).catch((err) => {
      console.error("PreparationModal: failed to load allergens", err);
    });
  }, [open]);

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
      setAllergenIds(initialAllergenIds ?? []);
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
      setAllergenIds([]);
    }
  }, [open, initialData, initialAllergenIds]);

  const toggleAllergen = useCallback((id: number) => {
    setAllergenIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }, []);

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
      allergenIds,
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

          <div>
            <label className={labelClass}>{t.preparations.platingNotes}</label>
            <textarea
              value={platingNotes}
              onChange={(e) => setPlatingNotes(e.target.value)}
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

          <div>
            <label className={labelClass}>{t.preparations.almacen}</label>
            <input
              type="text"
              value={almacen}
              onChange={(e) => setAlmacen(e.target.value)}
              className={inputClass}
            />
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

          <div>
            <label className={labelClass}>{t.preparations.photoUrl}</label>
            <input
              type="text"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>{t.preparations.allergens}</label>
            {allergens.length === 0 ? (
              <p className="text-[13px] text-[#555]">{t.preparations.noAllergens}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {allergens.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm text-[#888] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allergenIds.includes(a.id)}
                      onChange={() => toggleAllergen(a.id)}
                      className="rounded border-[#2a2a2a] bg-[#111] text-[#3dbf8a] focus:ring-[#3dbf8a]"
                    />
                    <span className={allergenIds.includes(a.id) ? "text-white" : ""}>
                      {lang === "es" ? a.labelES : a.labelEN}
                    </span>
                  </label>
                ))}
              </div>
            )}
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
