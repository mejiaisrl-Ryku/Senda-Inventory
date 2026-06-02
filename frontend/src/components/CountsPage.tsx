import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CountDepartment, CountSession } from "../types";
import { useLanguage } from "../context/LanguageContext";
import { countsApi } from "../api";
import { ScanCountModal } from "./ScanCountModal";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner } from "./shared/Spinner";
import { Spinner } from "./shared/Spinner";
import { EmptyState } from "./shared/EmptyState";
import { Modal } from "./shared/Modal";

// ── Constants ─────────────────────────────────────────────────────────────────
// (DEPARTMENTS is now built inside NewCountModal using translations)

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-[#2a2a2a] bg-[#111] text-white text-sm " +
  "focus:outline-none focus:ring-1 focus:ring-[#3dbf8a] focus:border-[#3dbf8a] transition";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "OPEN" | "CLOSED" }) {
  return status === "OPEN" ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#3dbf8a]/15 text-[#3dbf8a]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#3dbf8a] animate-pulse" />
      Open
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#1a1a1a] text-[#555]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#444]" />
      Closed
    </span>
  );
}

// ── New Count Modal ───────────────────────────────────────────────────────────

function NewCountModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (session: CountSession) => void;
}) {
  const toast = useToast();
  const { t } = useLanguage();
  const [date, setDate]               = useState(todayLocal());
  const [department, setDepartment]   = useState<CountDepartment>("ALL");
  const [submitting, setSubmitting]   = useState(false);

  const DEPARTMENTS: { value: CountDepartment; label: string }[] = [
    { value: "ALL",     label: t.counts.allDepts },
    { value: "KITCHEN", label: t.counts.kitchen  },
    { value: "BAR",     label: t.counts.bar      },
    { value: "FOH",     label: t.counts.foh      },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const session = await countsApi.create({ date, department });
      toast.success("Count session created.");
      onCreated(session);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t.counts.newCount}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium text-[#666] mb-1">{t.common.date}</label>
          <input
            type="date" required value={date} max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#666] mb-1">{t.counts.department}</label>
          <div className="grid grid-cols-2 gap-2">
            {DEPARTMENTS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDepartment(value)}
                className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  department === value
                    ? "border-[#3dbf8a] bg-[#3dbf8a]/10 text-[#3dbf8a]"
                    : "border-[#2a2a2a] bg-[#111] text-[#666] hover:text-[#888]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#444]">
            Products from this section will be pre-loaded for counting.
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {submitting && <Spinner size="sm" />}
            {submitting ? t.common.saving : t.counts.createSession}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#555] hover:text-[#888] text-sm transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function CountsPage() {
  const navigate               = useNavigate();
  const toast                  = useToast();
  const { t }                  = useLanguage();
  const DEPARTMENTS: { value: CountDepartment; label: string }[] = [
    { value: "ALL",     label: t.counts.allDepts },
    { value: "KITCHEN", label: t.counts.kitchen  },
    { value: "BAR",     label: t.counts.bar      },
    { value: "FOH",     label: t.counts.foh      },
  ];
  const [sessions, setSessions] = useState<CountSession[]>([]);
  const [loading, setLoading]  = useState(true);
  const [newOpen, setNewOpen]  = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    countsApi.list()
      .then(setSessions)
      .catch(() => toast.error("Failed to load count sessions."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleCreated(session: CountSession) {
    setNewOpen(false);
    navigate(`/inventory/${session.id}`);
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{t.counts.title}</h1>
          <p className="text-[13px] text-[#555] mt-1">{t.counts.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setScanOpen(true)}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 border border-[#3dbf8a] text-[#3dbf8a] hover:bg-[#3dbf8a]/10 text-sm font-medium rounded-xl transition-colors"
          >
            🤖 {t.inventoryScan.capture}
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-[#3dbf8a] hover:bg-[#35a87a] text-white text-sm font-medium rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t.counts.newCount}
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <PageSpinner />
      ) : sessions.length === 0 ? (
        <EmptyState
          title={t.counts.noSessions}
          description=""
          action={
            <button
              onClick={() => setNewOpen(true)}
              className="min-h-[44px] px-4 bg-[#3dbf8a] text-white text-sm rounded-xl hover:bg-[#35a87a] transition-colors"
            >
              {t.counts.newCount}
            </button>
          }
        />
      ) : (
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {[t.counts.sessionDate, t.counts.department, t.common.status, t.counts.entries, t.counts.totalVariance, ""].map((h) => (
                    <th
                      key={h}
                      className={`text-[11px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 whitespace-nowrap ${
                        h === "Total Variance" ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111]">
                {sessions.map((s) => {
                  const variance = s.totalVarianceValue ?? 0;
                  return (
                    <tr key={s.id} className="hover:bg-[#111] transition-colors">
                      <td className="px-5 py-3.5 text-white font-medium whitespace-nowrap">
                        {formatDate(s.date)}
                      </td>
                      <td className="px-5 py-3.5 text-[#888] capitalize">
                        {DEPARTMENTS.find((d) => d.value === s.department)?.label ?? s.department}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-5 py-3.5 text-[#888] tabular-nums">
                        {s.entriesCount ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums font-semibold">
                        {s.status === "OPEN" ? (
                          <span className="text-[#444]">In progress</span>
                        ) : (
                          <span className={variance < 0 ? "text-red-400" : variance > 0 ? "text-amber-400" : "text-[#3dbf8a]"}>
                            {variance >= 0 ? "+" : ""}{formatCurrency(variance)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => navigate(`/inventory/${s.id}`)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-[#888] hover:text-white hover:bg-[#222] transition-colors whitespace-nowrap"
                        >
                          {s.status === "OPEN" ? "Open →" : "View →"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewCountModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={handleCreated} />
      <ScanCountModal open={scanOpen} onClose={() => setScanOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
