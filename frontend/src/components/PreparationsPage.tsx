import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Preparation } from "../types";
import { preparationsApi } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner } from "./shared/Spinner";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { PreparationModal } from "./PreparationModal";

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

  if (loading && preparations.length === 0) return <PageSpinner />;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.preparations.title}</h1>
        <p className="text-gray-600 text-sm mt-1">{t.preparations.manageMiseEnPlace}</p>
      </div>

      <div className="mb-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t.preparations.searchPlaceholder}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3dbf8a]"
        />
        <button
          onClick={() => { setEditingPrep(undefined); setModalOpen(true); }}
          className="px-4 py-2 bg-[#3dbf8a] text-white rounded-md hover:bg-[#35a478] font-medium whitespace-nowrap"
        >
          + {t.preparations.addNew}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          {t.preparations.noPrepFound}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">{t.preparations.name}</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">{t.preparations.conservationType}</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">{t.preparations.almacen}</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase">{t.preparations.cost}</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase">{t.common.edit}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((prep) => (
                <tr key={prep.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <p className="font-medium text-gray-900">{prep.name}</p>
                    {prep.description && <p className="text-xs text-gray-500 mt-1">{prep.description}</p>}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-700">
                    {prep.conservationType ? t.preparations.conservationTypes[prep.conservationType] : "—"}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-700">{prep.almacen || "—"}</td>
                  <td className="px-6 py-3 text-right text-sm font-medium text-gray-900">${prep.cost.toFixed(2)}</td>
                  <td className="px-6 py-3 text-center">
                    <button
                      onClick={() => { setEditingPrep(prep); setModalOpen(true); }}
                      className="text-[#3dbf8a] hover:text-[#35a478] font-medium text-sm mr-4"
                    >
                      {t.common.edit}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(prep)}
                      className="text-red-600 hover:text-red-700 font-medium text-sm"
                    >
                      {t.common.delete}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
