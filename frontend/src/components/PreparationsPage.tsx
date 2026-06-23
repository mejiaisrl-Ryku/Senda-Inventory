import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Preparation } from "../types";
import { preparationsApi } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner } from "./shared/Spinner";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { PreparationModal } from "./PreparationModal";
import { ProduceDialog } from "./ProduceDialog";

export function PreparationsPage() {
  const { t } = useLanguage();
  const toast = useToast();

  const [preparations, setPreparations] = useState<Preparation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPrep, setEditingPrep] = useState<Preparation | undefined>(undefined);

  const [deleteTarget, setDeleteTarget] = useState<Preparation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [produceTarget, setProduceTarget] = useState<Preparation | null>(null);
  const [producing, setProducing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await preparationsApi.list();
      setPreparations(data);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return preparations;
    return preparations.filter(
      (p) => p.name.toLowerCase().includes(term) || (p.almacen ?? "").toLowerCase().includes(term)
    );
  }, [preparations, searchTerm]);

  const handleSaved = (saved: Preparation) => {
    setPreparations((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
    });
    toast.success(editingPrep ? t.preparations.updated : t.preparations.created);
    setModalOpen(false);
    setEditingPrep(undefined);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await preparationsApi.delete(deleteTarget.id);
      setPreparations((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success(t.preparations.deleted);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleProduce = async (quantityProduced: number) => {
    if (!produceTarget) return;
    setProducing(true);
    try {
      const updated = await preparationsApi.produce(produceTarget.id, { quantityProduced });
      setPreparations((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(t.recipes.productionRecorded);
      setProduceTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setProducing(false);
    }
  };

  if (loading && preparations.length === 0) return <PageSpinner />;

  return (
    <div className="p-4 sm:p-8 space-y-5 pb-16">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{t.preparations.title}</h1>
          <p className="text-[13px] text-[#555] mt-0.5">{t.preparations.manageMiseEnPlace}</p>
        </div>
        <button
          onClick={() => { setEditingPrep(undefined); setModalOpen(true); }}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-4 bg-[#3dbf8a] hover:bg-[#35a87a] text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">{t.preparations.addNew}</span>
          <span className="sm:hidden">+</span>
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={t.preparations.searchPlaceholder}
        className="w-full max-w-md px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors"
      />

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#1a1a1a] flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-[#444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-[#555] text-[14px]">{t.preparations.noPrepFound}</p>
        </div>
      ) : (
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {[
                    { label: t.preparations.name,             right: false },
                    { label: t.preparations.conservationType, right: false },
                    { label: t.preparations.almacen,          right: false },
                    { label: t.preparations.cost,             right: true  },
                    { label: t.preparations.stock,            right: true  },
                    { label: "",                              right: false },
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
                {filtered.map((prep) => (
                  <tr key={prep.id} className="hover:bg-[#111] transition-colors group">
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{prep.name}</p>
                      {prep.description && <p className="text-[12px] text-[#666] mt-0.5">{prep.description}</p>}
                    </td>
                    <td className="px-5 py-4 text-[#888] text-[13px]">
                      {prep.conservationType ? t.preparations.conservationTypes[prep.conservationType] : "—"}
                    </td>
                    <td className="px-5 py-4 text-[#888] text-[13px]">{prep.almacen || "—"}</td>
                    <td className="px-5 py-4 text-right text-[#888] tabular-nums">${prep.cost.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right text-[#888] tabular-nums">
                      {prep.currentStock.toFixed(2)} {prep.recipeYieldUnit ?? ""}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setProduceTarget(prep)}
                          className="text-[12px] px-2.5 py-1 rounded-lg text-[#3dbf8a] hover:bg-[#3dbf8a]/10 transition-colors"
                        >
                          {t.recipes.produce}
                        </button>
                        <button
                          onClick={() => { setEditingPrep(prep); setModalOpen(true); }}
                          className="text-[12px] px-2.5 py-1 rounded-lg text-[#888] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                        >
                          {t.common.edit}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(prep)}
                          className="text-[12px] px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          {t.common.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PreparationModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingPrep(undefined); }}
        onSaved={handleSaved}
        initialData={editingPrep}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t.common.delete}
        message={t.preparations.deleteConfirm}
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ProduceDialog
        open={!!produceTarget}
        title={`${t.recipes.recordProduction} — ${produceTarget?.name ?? ""}`}
        quantityLabel={t.preparations.quantityProduced}
        unitHint={produceTarget?.recipeYieldUnit ?? undefined}
        confirmLabel={t.recipes.produce}
        cancelLabel={t.common.cancel}
        loading={producing}
        onConfirm={handleProduce}
        onCancel={() => setProduceTarget(null)}
      />
    </div>
  );
}
