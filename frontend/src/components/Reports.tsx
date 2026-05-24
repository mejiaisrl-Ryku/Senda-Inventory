import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useLanguage } from "../context/LanguageContext";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { WeeklyReport, Unit, SalesCategory, CogsReport, CogsBucket, CogsPeriodTotals, CogsPeriodSummary } from "../types";
import { reportsApi } from "../api";
import { formatCurrency, unitLabel } from "../utils/stock";
import { PageSpinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

// ── Period helpers ────────────────────────────────────────────────────────────

type Period = "day" | "week" | "month" | "year";

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return toISO(new Date());
}

/** Compute [startDate, endDate] for the period that contains the anchor date. */
function getPeriodRange(period: Period, anchor: string): [string, string] {
  const d = new Date(`${anchor}T00:00:00Z`);
  switch (period) {
    case "day":
      return [anchor, anchor];
    case "week": {
      const dow = d.getUTCDay(); // 0 = Sun
      const toMon = dow === 0 ? 6 : dow - 1;
      const mon = new Date(d);
      mon.setUTCDate(d.getUTCDate() - toMon);
      const sun = new Date(mon);
      sun.setUTCDate(mon.getUTCDate() + 6);
      return [toISO(mon), toISO(sun)];
    }
    case "month": {
      const y = d.getUTCFullYear(), m = d.getUTCMonth();
      return [
        toISO(new Date(Date.UTC(y, m, 1))),
        toISO(new Date(Date.UTC(y, m + 1, 0))),
      ];
    }
    case "year": {
      const y = d.getUTCFullYear();
      return [`${y}-01-01`, `${y}-12-31`];
    }
  }
}

/** Move anchor by one period in the given direction. */
function movePeriod(anchor: string, period: Period, dir: -1 | 1): string {
  const d = new Date(`${anchor}T00:00:00Z`);
  switch (period) {
    case "day":   d.setUTCDate(d.getUTCDate() + dir); break;
    case "week":  d.setUTCDate(d.getUTCDate() + 7 * dir); break;
    case "month": d.setUTCMonth(d.getUTCMonth() + dir); break;
    case "year":  d.setUTCFullYear(d.getUTCFullYear() + dir); break;
  }
  return toISO(d);
}

/** Human-readable label for a period range. */
function periodLabel(period: Period, start: string, end: string): string {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

  switch (period) {
    case "day":
      return fmt(start, { month: "long", day: "numeric", year: "numeric" });
    case "week": {
      const s = fmt(start, { month: "short", day: "numeric" });
      const e = fmt(end,   { month: "short", day: "numeric" });
      return `${s} – ${e}`;
    }
    case "month":
      return fmt(start, { month: "long", year: "numeric" });
    case "year":
      return start.slice(0, 4);
  }
}

/** Chart label per day */
function formatChartLabel(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

// ── Period selector component ─────────────────────────────────────────────────

function PeriodSelector({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  const { t } = useLanguage();
  const options: { id: Period; label: string }[] = [
    { id: "day",   label: t.reports.day   },
    { id: "week",  label: t.reports.week  },
    { id: "month", label: t.reports.month },
    { id: "year",  label: t.reports.year  },
  ];
  return (
    <div className="flex rounded-xl overflow-hidden border border-[#2a2a2a] bg-[#0a0a0a]">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            period === opt.id
              ? "bg-[#1a1a1a] text-white"
              : "text-[#555] hover:text-[#888]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Navigation bar (shared) ───────────────────────────────────────────────────

function PeriodNav({
  period,
  anchor,
  label,
  onPrev,
  onNext,
  onToday,
  canGoNext,
}: {
  period: Period;
  anchor: string;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  canGoNext: boolean;
}) {
  const todayLabel: Record<Period, string> = {
    day: "Today", week: "This Week", month: "This Month", year: "This Year",
  };
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPrev}
        className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[#2a2a2a] text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
        aria-label="Previous period"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <span className="text-sm font-medium text-white min-w-[140px] text-center tabular-nums">
        {label}
      </span>

      <button
        onClick={onNext}
        disabled={!canGoNext}
        className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[#2a2a2a] text-[#555] hover:text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Next period"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <button
        onClick={onToday}
        className="px-3 py-1.5 text-xs rounded-lg border border-[#2a2a2a] text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
      >
        {todayLabel[period]}
      </button>
    </div>
  );
}

// ── SummaryCard ───────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, accent = "text-brand-500",
}: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
    </div>
  );
}

// ── COGS helpers ──────────────────────────────────────────────────────────────

const COGS_CATEGORIES: SalesCategory[] = [
  "BEER", "LIQUOR", "WINE", "FOOD", "NON_ALCOHOLIC",
];

const CATEGORY_LABELS: Record<SalesCategory, string> = {
  BEER: "Beer", LIQUOR: "Liquor", WINE: "Wine", FOOD: "Food",
  NON_ALCOHOLIC: "Non-Alcoholic", EVENTS: "Events", DELIVERY: "Delivery", BUYOUTS: "Buyouts",
};

type CogsTab = "daily" | "weekly" | "monthly";

interface DisplayPeriod {
  key: string;
  label: string;
  byCategory: Record<string, CogsBucket>;
  totals: CogsPeriodTotals;
}

function fmtDay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function fmtWeek(weekStartStr: string): string {
  const s = new Date(`${weekStartStr}T00:00:00Z`);
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(s)} – ${fmt(e)}`;
}

function fmtMonth(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

function aggregateToMonths(days: CogsReport["days"]): DisplayPeriod[] {
  const map = new Map<string, { byCategory: Record<string, CogsBucket>; totals: CogsPeriodTotals }>();
  for (const d of days) {
    const mk = d.date.slice(0, 7);
    if (!map.has(mk)) {
      map.set(mk, {
        byCategory: Object.fromEntries(
          COGS_CATEGORIES.map((c) => [c, { sales: 0, cogs: 0, cogsRatio: null }])
        ),
        totals: { sales: 0, cogs: 0, cogsRatio: null },
      });
    }
    const m = map.get(mk)!;
    for (const c of COGS_CATEGORIES) {
      m.byCategory[c].sales += d.byCategory[c]?.sales ?? 0;
      m.byCategory[c].cogs  += d.byCategory[c]?.cogs  ?? 0;
    }
    m.totals.sales += d.totals.sales;
    m.totals.cogs  += d.totals.cogs;
  }
  return [...map.entries()].sort().map(([mk, data]) => {
    for (const c of COGS_CATEGORIES) {
      const b = data.byCategory[c];
      b.cogsRatio = b.sales > 0 ? Math.round((b.cogs / b.sales) * 1000) / 1000 : null;
    }
    const t = data.totals;
    t.cogsRatio = t.sales > 0 ? Math.round((t.cogs / t.sales) * 1000) / 1000 : null;
    return { key: mk, label: fmtMonth(mk), byCategory: data.byCategory, totals: t };
  });
}

function ratioBadge(ratio: number | null): string {
  if (ratio === null) return "text-gray-400 dark:text-gray-500";
  if (ratio < 0.25)   return "bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400";
  if (ratio <= 0.35)  return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
  return "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400";
}

function fmtRatio(ratio: number | null): string {
  return ratio === null ? "—" : `${(ratio * 100).toFixed(1)}%`;
}

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

// ── CogsReportSection ─────────────────────────────────────────────────────────

function CogsReportSection() {
  const toast = useToast();
  const [period, setPeriod]   = useState<Period>("week");
  const [anchor, setAnchor]   = useState(todayISO);
  const [tab, setTab]         = useState<CogsTab>("weekly");
  const [data, setData]       = useState<CogsReport | null>(null);
  const [loading, setLoading] = useState(true);

  const [startDate, endDate] = useMemo(() => getPeriodRange(period, anchor), [period, anchor]);
  const label = useMemo(() => periodLabel(period, startDate, endDate), [period, startDate, endDate]);

  // When period changes, snap tab to a sensible default
  useEffect(() => {
    if (period === "day")   setTab("daily");
    else if (period === "week") setTab("daily");
    else if (period === "month") setTab("weekly");
    else setTab("monthly");
  }, [period]);

  const load = useCallback(() => {
    setLoading(true);
    reportsApi
      .cogsToSales(startDate, endDate)
      .then(setData)
      .catch((err) => toast.error(getApiError(err)))
      .finally(() => setLoading(false));
  }, [startDate, endDate, toast]);

  useEffect(() => { load(); }, [load]);

  const periods = useMemo<DisplayPeriod[]>(() => {
    if (!data) return [];
    if (tab === "daily")
      return data.days
        .filter((d) => d.totals.sales > 0 || d.totals.cogs > 0)
        .map((d) => ({ key: d.date, label: fmtDay(d.date), byCategory: d.byCategory, totals: d.totals }));
    if (tab === "weekly")
      return data.weeks.map((w) => ({
        key: w.weekStart, label: fmtWeek(w.weekStart), byCategory: w.byCategory, totals: w.totals,
      }));
    return aggregateToMonths(data.days);
  }, [data, tab]);

  const availableTabs = useMemo<{ id: CogsTab; label: string }[]>(() => {
    if (period === "day") return [{ id: "daily", label: "Daily" }];
    if (period === "week") return [{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }];
    return [
      { id: "daily",   label: "Daily"   },
      { id: "weekly",  label: "Weekly"  },
      { id: "monthly", label: "Monthly" },
    ];
  }, [period]);

  const canGoNext = endDate < todayISO();

  return (
    <div className="space-y-4">
      {/* Section header + controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">COGS Report</h2>
          <p className="text-[13px] text-[#555]">Cost of Goods Sold vs. sales revenue by category</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodNav
            period={period}
            anchor={anchor}
            label={label}
            onPrev={() => setAnchor((a) => movePeriod(a, period, -1))}
            onNext={() => setAnchor((a) => movePeriod(a, period,  1))}
            onToday={() => setAnchor(todayISO())}
            canGoNext={canGoNext}
          />
          <PeriodSelector period={period} onChange={(p) => { setPeriod(p); setAnchor(todayISO()); }} />
        </div>
      </div>

      {/* Grouping tabs */}
      {availableTabs.length > 1 && (
        <div className="flex border-b border-gray-200 dark:border-gray-700 gap-1">
          {availableTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-brand-500 text-brand-600 dark:text-brand-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="inline-block w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data || periods.length === 0 ? (
          <div className="py-14 text-center">
            <svg className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-[13px] text-[#555]">
              No data for this period. Add sales entries and tag products with a COGS category.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {["Period", "Category", "Sales", "COGS", "COGS %"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${
                        i >= 2 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <React.Fragment key={p.key}>
                    <tr className="bg-gray-50 dark:bg-gray-700/40 border-t border-gray-100 dark:border-gray-700">
                      <td colSpan={2} className="px-5 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                        {p.label}
                      </td>
                      <td className="px-5 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                        {fmtMXN(p.totals.sales)}
                      </td>
                      <td className="px-5 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                        {fmtMXN(p.totals.cogs)}
                      </td>
                      <td className="px-5 py-2 text-right">
                        {p.totals.cogsRatio !== null && (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${ratioBadge(p.totals.cogsRatio)}`}>
                            {fmtRatio(p.totals.cogsRatio)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {COGS_CATEGORIES.map((cat) => {
                      const b = p.byCategory[cat] ?? { sales: 0, cogs: 0, cogsRatio: null };
                      return (
                        <tr key={cat} className="border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors">
                          <td className="px-5 py-2.5 text-gray-300 dark:text-gray-600 text-xs">—</td>
                          <td className="px-5 py-2.5 text-gray-600 dark:text-gray-300 font-medium">
                            {CATEGORY_LABELS[cat]}
                          </td>
                          <td className="px-5 py-2.5 text-right text-gray-700 dark:text-gray-200 tabular-nums">
                            {b.sales > 0 ? fmtMXN(b.sales) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-5 py-2.5 text-right text-gray-700 dark:text-gray-200 tabular-nums">
                            {b.cogs > 0 ? fmtMXN(b.cogs) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            {b.cogsRatio !== null ? (
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${ratioBadge(b.cogsRatio)}`}>
                                {fmtRatio(b.cogsRatio)}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary cards */}
      {data && !loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Sales</p>
            <p className="mt-1 text-2xl font-bold text-brand-500 tabular-nums">
              {fmtMXN((data.period as CogsPeriodSummary).totalSales)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{label}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total COGS</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
              {fmtMXN((data.period as CogsPeriodSummary).totalCOGS)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">from stock usage × cost/unit</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Overall COGS %</p>
            {data.period.cogsRatio !== null ? (
              <>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${
                  data.period.cogsRatio < 0.25
                    ? "text-brand-500 dark:text-brand-400"
                    : data.period.cogsRatio <= 0.35
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {fmtRatio(data.period.cogsRatio)}
                </p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  {data.period.cogsRatio < 0.25 ? "✓ Under target" : data.period.cogsRatio <= 0.35 ? "⚠ Near threshold" : "✗ Over target"}
                </p>
              </>
            ) : (
              <p className="mt-1 text-2xl font-bold text-gray-400 dark:text-gray-500">—</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Reports component ────────────────────────────────────────────────────

export function Reports() {
  const toast = useToast();
  const { t } = useLanguage();

  const [period, setPeriod]   = useState<Period>("week");
  const [anchor, setAnchor]   = useState(todayISO());
  const [report, setReport]   = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [startDate, endDate] = useMemo(() => getPeriodRange(period, anchor), [period, anchor]);
  const label = useMemo(() => periodLabel(period, startDate, endDate), [period, startDate, endDate]);

  const load = useCallback(() => {
    setLoading(true);
    reportsApi
      .weekly(startDate, endDate)
      .then(setReport)
      .catch((err) => toast.error(getApiError(err)))
      .finally(() => setLoading(false));
  }, [startDate, endDate, toast]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    if (!report) return;
    setExporting(true);
    try {
      await reportsApi.exportXlsx(startDate, endDate);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setExporting(false);
    }
  }

  const canGoNext = endDate < todayISO();

  const isDark = document.documentElement.classList.contains("dark");
  const muted = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "rgba(55,65,81,0.6)" : "rgba(243,244,246,1)";

  const chartData = report
    ? {
        labels: report.days.map((d) => formatChartLabel(d.date)),
        datasets: [
          {
            label: "Received",
            data: report.days.map((d) => d.received),
            borderColor: "#3EBF8A",
            backgroundColor: "rgba(62,191,138,0.08)",
            fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5,
          },
          {
            label: "Used",
            data: report.days.map((d) => d.used),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.08)",
            fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5,
          },
          {
            label: "Waste",
            data: report.days.map((d) => d.waste),
            borderColor: "#ef4444",
            backgroundColor: "rgba(239,68,68,0.05)",
            fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5,
          },
        ],
      }
    : null;

  const chartOptions: import("chart.js").ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top" as const,
        labels: { color: muted, boxWidth: 12, padding: 16, font: { size: 12 } },
      },
      tooltip: { bodyFont: { size: 12 }, titleFont: { size: 12 } },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: muted, font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: { color: muted, font: { size: 11 } },
      },
    },
  };

  // Chart title reflects the period
  const chartTitle: Record<Period, string> = {
    day:   "Daily Stock Activity",
    week:  "7-Day Stock Activity",
    month: "Monthly Stock Activity",
    year:  "Yearly Stock Activity",
  };

  return (
    <div className="p-8 space-y-4">
      {/* Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{t.reports.title}</h1>
          <p className="text-[13px] text-[#555] mt-1">{label}</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Period Prev/Next nav */}
          <PeriodNav
            period={period}
            anchor={anchor}
            label={label}
            onPrev={() => setAnchor((a) => movePeriod(a, period, -1))}
            onNext={() => setAnchor((a) => movePeriod(a, period,  1))}
            onToday={() => setAnchor(todayISO())}
            canGoNext={canGoNext}
          />

          {/* Period selector pills */}
          <PeriodSelector period={period} onChange={(p) => { setPeriod(p); setAnchor(todayISO()); }} />

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={exporting || !report}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? t.common.loading : t.reports.exportXlsx}
          </button>
        </div>
      </div>

      {loading ? (
        <PageSpinner />
      ) : report ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              label={t.reports.invValue}
              value={formatCurrency(report.inventoryValue)}
              sub="current at cost"
              accent="text-brand-500 dark:text-brand-400"
            />
            <SummaryCard
              label={t.reports.lowItems}
              value={report.lowItemsCount}
              sub="below minimum"
              accent={report.lowItemsCount > 0 ? "text-red-500" : "text-brand-500 dark:text-brand-400"}
            />
            <SummaryCard
              label={t.reports.totalWaste}
              value={report.totalWaste}
              sub="units this period"
              accent={report.totalWaste > 0 ? "text-yellow-500" : "text-gray-400 dark:text-gray-500"}
            />
            <SummaryCard
              label={t.reports.totalReceived}
              value={report.totalReceived}
              sub="units this period"
              accent="text-brand-500"
            />
          </div>

          {/* Trend chart */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
              {chartTitle[period]}
            </h2>
            <div className="h-56 sm:h-72">
              {chartData && <Line data={chartData} options={chartOptions} />}
            </div>
          </div>

          {/* Daily breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    {[t.common.date, t.reports.received, t.reports.used, t.reports.waste].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {report.days.map((day) => (
                    <tr key={day.date} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-700 dark:text-gray-300">
                        {formatChartLabel(day.date)}
                      </td>
                      <td className="px-5 py-3 font-medium text-brand-500 dark:text-brand-400">
                        {day.received > 0 ? day.received : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-5 py-3 font-medium text-blue-600 dark:text-blue-400">
                        {day.used > 0 ? day.used : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-5 py-3 font-medium text-red-500 dark:text-red-400">
                        {day.waste > 0 ? day.waste : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* COGS Report */}
          <CogsReportSection />

          {/* Most used products */}
          {report.mostUsed.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Most Used Products</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                      {["#", "Product", "Total Used", "Unit"].map((h) => (
                        <th key={h} className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                    {report.mostUsed.map((item, idx) => {
                      const maxUsed = report.mostUsed[0].totalUsed;
                      const pct = maxUsed > 0 ? (item.totalUsed / maxUsed) * 100 : 0;
                      return (
                        <tr key={item.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                          <td className="px-5 py-3 text-gray-400 dark:text-gray-500 font-mono text-xs">{idx + 1}</td>
                          <td className="px-5 py-3">
                            <p className="font-medium text-gray-900 dark:text-white">{item.productName}</p>
                            <div className="mt-1.5 h-1 bg-gray-100 dark:bg-gray-700 rounded-full w-36 overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                          <td className="px-5 py-3 font-semibold text-blue-600 dark:text-blue-400">{item.totalUsed}</td>
                          <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                            {unitLabel[item.unit as Unit] ?? item.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">No stock activity in this period.</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
