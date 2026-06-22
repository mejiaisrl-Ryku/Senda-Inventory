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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEditing ? t.preparations.edit : t.preparations.addNew}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t.preparations.name} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.description}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.preparationMethod}</label>
            <textarea
              value={preparationMethod}
              onChange={(e) => setPreparationMethod(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.platingNotes}</label>
            <textarea
              value={platingNotes}
              onChange={(e) => setPlatingNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.shelfLifeDays}</label>
              <input
                type="number"
                value={shelfLifeDays}
                onChange={(e) => setShelfLifeDays(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.storageTemp}</label>
              <input
                type="text"
                value={storageTemp}
                onChange={(e) => setStorageTemp(e.target.value)}
                placeholder="e.g., 4°C"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.conservationType}</label>
            <select
              value={conservationType}
              onChange={(e) => setConservationType(e.target.value as ConservationType | "")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
            >
              <option value="">—</option>
              <option value="REFRIGERADO">{t.preparations.conservationTypes.REFRIGERADO}</option>
              <option value="CONGELADO">{t.preparations.conservationTypes.CONGELADO}</option>
              <option value="AMBIENTE">{t.preparations.conservationTypes.AMBIENTE}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.almacen}</label>
            <input
              type="text"
              value={almacen}
              onChange={(e) => setAlmacen(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.recipeYield}</label>
              <input
                type="number"
                step="0.01"
                value={recipeYield}
                onChange={(e) => setRecipeYield(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.recipeYieldUnit}</label>
              <select
                value={recipeYieldUnit}
                onChange={(e) => setRecipeYieldUnit(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
              >
                <option value="">—</option>
                {t.preparations.yieldUnits.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.photoUrl}</label>
            <input
              type="text"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.preparations.allergens}</label>
            {allergens.length === 0 ? (
              <p className="text-sm text-gray-500">{t.preparations.noAllergens}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {allergens.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={allergenIds.includes(a.id)}
                      onChange={() => toggleAllergen(a.id)}
                      className="rounded border-gray-300 text-[#3dbf8a] focus:ring-[#3dbf8a]"
                    />
                    {lang === "es" ? a.labelES : a.labelEN}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-[#3dbf8a] text-white rounded-md hover:bg-[#35a478] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
