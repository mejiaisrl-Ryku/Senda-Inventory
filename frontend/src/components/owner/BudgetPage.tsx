import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ownerApi } from "../../api";
import { BudgetResponse, LocationBudget } from "../../types";
import { formatCurrency } from "../../utils/stock";
import { PageSpinner, Spinner } from "../shared/Spinner";
import { useLanguage, LangToggle } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MonthKey =
  | "january" | "february" | "march" | "april" | "may" | "june"
  | "july" | "august" | "september" | "october" | "november" | "december";

const MONTH_KEYS: MonthKey[] = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];

const YEARS = [2024, 2025, 2026, 2027];

function varColor(v: number, lowerIsBetter: boolean): string {
  if (lowerIsBetter) return v <= 0 ? "text-[#3dbf8a]" : "text-[#ef4444]";
  return v >= 0 ? "text-[#3dbf8a]" : "text-[#ef4444]";
}

function fmtVar(v: number, isCurrency: boolean): string {
  const sign = v >= 0 ? "+" : "";
  return isCurrency
    ? `${sign}${formatCurrency(v)}`
    : `${sign}${v.toFixed(1)}%`;
}

// ── Location budget card ──────────────────────────────────────────────────────

function LocationCard({
  loc,
  year,
  month,
  onSaved,
}: {
  loc:     LocationBudget;
  year:    number;
  month:   number | null;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const b = t.budget;

  const [revenue,   setRevenue]   = useState(loc.revenueTarget?.toString()   ?? "");
  const [laborPct,  setLaborPct]  = useState(loc.laborPctTarget?.toString()  ?? "");
  const [primePct,  setPrimePct]  = useState(loc.primeCostTarget?.toString() ?? "");
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [savedOk,   setSavedOk]   = useState(false);

  // Sync when parent data refreshes
  useEffect(() => {
    setRevenue(loc.revenueTarget?.toString()   ?? "");
    setLaborPct(loc.laborPctTarget?.toString() ?? "");
    setPrimePct(loc.primeCostTarget?.toString() ?? "");
  }, [loc.revenueTarget, loc.laborPctTarget, loc.primeCostTarget]);

  async function handleSave() {
    const rev  = parseFloat(revenue);
    const lp   = parseFloat(laborPct);
    const pp   = parseFloat(primePct);
    if (isNaN(rev) || isNaN(lp) || isNaN(pp)) return;
    setSaving(true);
    try {
      const body: Parameters<typeof ownerApi.upsertBudget>[0] = {
        restaurantId:    loc.restaurantId,
        year,
        revenueTarget:   rev,
        laborPctTarget:  lp,
        primeCostTarget: pp,
      };
      if (month != null) body.month = month;
      await ownerApi.upsertBudget(body);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      onSaved();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!loc.budgetId) return;
    setDeleting(true);
    try {
      await ownerApi.deleteBudget(loc.budgetId);
      onSaved();
    } catch { /* ignore */ }
    finally { setDeleting(false); }
  }

  const hasBudget = loc.budgetId != null;
  const act       = loc.actual;

  const inputCls = "w-full bg-[#111] border border-[#2a2a2a] rounded-[6px] px-2.5 py-1.5 text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors";

  return (
    <div className="bg-[#0a0a0a] rounded-[10px] border border-[#1a1a1a] overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-[#111] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-white truncate">{loc.restaurantName}</p>
        </div>
        {hasBudget ? (
          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#3dbf8a]/10 text-[#3dbf8a] border border-[#3dbf8a]/20">
            ✓ Target set
          </span>
        ) : (
          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1a1a1a] text-[#555] border border-[#2a2a2a]">
            {b.noTarget}
          </span>
        )}
      </div>

      {/* Metrics grid */}
      <div className="px-5 py-4 space-y-3">
        {/* Column labels */}
        <div className="grid grid-cols-3 gap-3 text-[10px] font-semibold text-[#555] uppercase tracking-wider">
          <span>{/* metric name */}</span>
          <span>{b.actual}</span>
          <span>{b.variance}</span>
        </div>

        {/* Revenue row */}
        <div className="grid grid-cols-3 gap-3 items-center">
          <div>
            <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">{b.revenueTarget}</p>
            <input
              type="number"
              min="0"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              placeholder="0"
              className={inputCls}
            />
          </div>
          <div>
            <p className="text-[13px] text-[#888]">
              {act ? formatCurrency(act.revenue) : "—"}
            </p>
          </div>
          <div>
            {act && loc.revenueTarget != null ? (
              <p className={`text-[13px] font-medium ${varColor(act.revenueVariance, false)}`}>
                {fmtVar(act.revenueVariance, true)}
              </p>
            ) : <p className="text-[#444] text-[13px]">—</p>}
          </div>
        </div>

        {/* Labor % row */}
        <div className="grid grid-cols-3 gap-3 items-center">
          <div>
            <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">{b.laborTarget}</p>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={laborPct}
                onChange={(e) => setLaborPct(e.target.value)}
                placeholder="35.0"
                className={inputCls + " pr-6"}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555] text-[11px]">%</span>
            </div>
          </div>
          <div>
            <p className="text-[13px] text-[#888]">
              {act ? `${act.laborPct.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div>
            {act && loc.laborPctTarget != null ? (
              <p className={`text-[13px] font-medium ${varColor(act.laborPctVariance, true)}`}>
                {fmtVar(act.laborPctVariance, false)}
              </p>
            ) : <p className="text-[#444] text-[13px]">—</p>}
          </div>
        </div>

        {/* Prime Cost % row */}
        <div className="grid grid-cols-3 gap-3 items-center">
          <div>
            <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">{b.primeCostTarget}</p>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={primePct}
                onChange={(e) => setPrimePct(e.target.value)}
                placeholder="62.0"
                className={inputCls + " pr-6"}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555] text-[11px]">%</span>
            </div>
          </div>
          <div>
            <p className="text-[13px] text-[#888]">
              {act ? `${act.primeCostPct.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div>
            {act && loc.primeCostTarget != null ? (
              <p className={`text-[13px] font-medium ${varColor(act.primeCostVariance, true)}`}>
                {fmtVar(act.primeCostVariance, false)}
              </p>
            ) : <p className="text-[#444] text-[13px]">—</p>}
          </div>
        </div>
      </div>

      {/* Card footer */}
      <div className="px-5 py-3 border-t border-[#111] flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-1.5 text-[12px] font-semibold px-4 py-1.5 rounded-[6px] transition-colors ${
            hasBudget
              ? "border border-[#3dbf8a] text-[#3dbf8a] hover:bg-[#3dbf8a]/10"
              : "bg-[#3dbf8a] text-white hover:bg-[#35a87a]"
          } disabled:opacity-60`}
        >
          {saving && <Spinner size="sm" />}
          {saving ? b.saving : hasBudget ? b.updateTarget : b.setTarget}
        </button>

        {savedOk && (
          <span className="text-[11px] text-[#3dbf8a]">{b.saved} ✓</span>
        )}

        {hasBudget && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="ml-auto text-[11px] text-red-400 hover:text-red-300 transition-colors disabled:opacity-60"
          >
            {deleting ? <Spinner size="sm" /> : b.deleteTarget}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BudgetPage() {
  const { t } = useLanguage();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const b = t.budget;

  const now = new Date();
  const [ownerName,  setOwnerName]  = useState<string>("");
  const [viewMode,   setViewMode]   = useState<"monthly" | "annual">("monthly");
  const [year,       setYear]       = useState(now.getFullYear());
  const [month,      setMonth]      = useState(now.getMonth() + 1); // 1-based
  const [data,       setData]       = useState<BudgetResponse | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(false);

  useEffect(() => {
    ownerApi.getDashboard().then((d) => setOwnerName(d.ownerAccount.name)).catch(() => {});
  }, []);

  const fetchBudgets = useCallback(() => {
    setLoading(true);
    setError(false);
    const m = viewMode === "monthly" ? month : undefined;
    ownerApi.getBudgets(year, m)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month, viewMode]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const monthLabels: string[] = MONTH_KEYS.map((k) => b[k]);

  return (
    <div className="min-h-screen bg-black">
      {/* Top bar */}
      <header className="border-b border-[#1a1a1a] bg-[#0a0a0a] px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/owner/dashboard")}
            className="text-[12px] text-[#555] hover:text-white transition-colors"
          >
            ← Back to Overview
          </button>
          {ownerName && (
            <>
              <span className="text-[#333]">·</span>
              <p className="text-[13px] text-[#444] truncate">{ownerName}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <LangToggle />
          <button
            onClick={handleLogout}
            className="text-[12px] text-[#888] border border-[#2a2a2a] hover:border-[#444] hover:text-white px-3 py-1.5 rounded-[6px] transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="p-8 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-[24px] font-semibold text-white">{b.title}</h1>
          <p className="text-[13px] text-[#555] mt-0.5">{b.subtitle}</p>
        </div>

        {/* Period selector */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Monthly / Annual toggle */}
          <div className="flex gap-1">
            {(["monthly", "annual"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`text-[12px] px-3 py-1.5 rounded-[6px] transition-colors ${
                  viewMode === mode
                    ? "bg-[#3dbf8a] text-white"
                    : "border border-[#2a2a2a] text-[#555] hover:text-white"
                }`}
              >
                {mode === "monthly" ? b.monthly : b.annual}
              </button>
            ))}
          </div>

          {/* Year */}
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-[#555] uppercase tracking-wider">{b.year}</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-[6px] px-2.5 py-1.5 text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
            >
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Month (only for monthly) */}
          {viewMode === "monthly" && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-[#555] uppercase tracking-wider">{b.month}</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-[6px] px-2.5 py-1.5 text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
              >
                {monthLabels.map((label, i) => (
                  <option key={i + 1} value={i + 1}>{label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Content */}
        {loading && <PageSpinner />}

        {!loading && error && (
          <div className="px-4 py-3 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a] text-[13px] text-[#555]">
            Unable to load budget data. Please try again.
          </div>
        )}

        {!loading && data && (
          <div className="space-y-4">
            {data.budgets.map((loc) => (
              <LocationCard
                key={loc.restaurantId}
                loc={loc}
                year={year}
                month={viewMode === "monthly" ? month : null}
                onSaved={fetchBudgets}
              />
            ))}
            {data.budgets.length === 0 && (
              <p className="text-[13px] text-[#555] italic">No locations found.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
