import React, { useEffect, useState, useCallback, useMemo } from "react";
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

// ── helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function formatChartLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function prevWeekEnd(endDate: string): string {
  const d = new Date(`${endDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// ── sub-components ────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  accent = "text-brand-500",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
    </div>
  );
}

// ── COGS Report helpers ───────────────────────────────────────────────────────

const COGS_CATEGORIES: SalesCategory[] = [
  "BEER", "LIQUOR", "WINE", "FOOD", "NON_ALCOHOLIC",
];

const CATEGORY_LABELS: Record<SalesCategory, string> = {
  BEER: "Beer",
  LIQUOR: "Liquor",
  WINE: "Wine",
  FOOD: "Food",
  NON_ALCOHOLIC: "Non-Alcoholic",
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
      m.byCategory[c].cogs += d.byCategory[c]?.cogs ?? 0;
    }
    m.totals.sales += d.totals.sales;
    m.totals.cogs += d.totals.cogs;
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

/** COGS% colour — green < 25%, yellow 25–35%, red > 35% */
function ratioBadge(ratio: number | null): string {
  if (ratio === null) return "text-gray-400 dark:text-gray-500";
  if (ratio < 0.25) return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
  if (ratio <= 0.35) return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
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
  const [startDate, setStartDate] = useState(firstOfMonthISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [tab, setTab] = useState<CogsTab>("weekly");
  const [data, setData] = useState<CogsReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    reportsApi
      .cogsToSales(startDate, endDate)
      .then(setData)
      .catch((err) => toast.error(getApiError(err)))
      .finally(() => setLoading(false));
  }, [startDate, endDate, toast]);

  useEffect(() => { load(); }, [load]);

  /** Derive the row list for the active tab */
  const periods = useMemo<DisplayPeriod[]>(() => {
    if (!data) return [];
    if (tab === "daily")
      return data.days
        .filter((d) => d.totals.sales > 0 || d.totals.cogs > 0) // skip empty days
        .map((d) => ({ key: d.date, label: fmtDay(d.date), byCategory: d.byCategory, totals: d.totals }));
    if (tab === "weekly")
      return data.weeks.map((w) => ({
        key: w.weekStart, label: fmtWeek(w.weekStart), byCategory: w.byCategory, totals: w.totals,
      }));
    return aggregateToMonths(data.days);
  }, [data, tab]);

  const tabs: { id: CogsTab; label: string }[] = [
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "monthly", label: "Monthly" },
  ];

  const inputCls =
    "px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="space-y-4">
      {/* Section header + date pickers */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">COGS Report</h2>
          <p className="text-[13px] text-[#555]">
            Cost of Goods Sold vs. sales revenue by category
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => e.target.value && setStartDate(e.target.value)}
            className={inputCls}
          />
          <span className="text-gray-400 dark:text-gray-500 text-sm">–</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={todayISO()}
            onChange={(e) => e.target.value && setEndDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 gap-1">
        {tabs.map((t) => (
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
                {periods.map((period) => (
                  <React.Fragment key={period.key}>
                    {/* Period header row */}
                    <tr className="bg-gray-50 dark:bg-gray-700/40 border-t border-gray-100 dark:border-gray-700">
                      <td
                        colSpan={2}
                        className="px-5 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide"
                      >
                        {period.label}
                      </td>
                      <td className="px-5 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                        {fmtMXN(period.totals.sales)}
                      </td>
                      <td className="px-5 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                        {fmtMXN(period.totals.cogs)}
                      </td>
                      <td className="px-5 py-2 text-right">
                        {period.totals.cogsRatio !== null && (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${ratioBadge(period.totals.cogsRatio)}`}>
                            {fmtRatio(period.totals.cogsRatio)}
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Category rows */}
                    {COGS_CATEGORIES.map((cat) => {
                      const b = period.byCategory[cat] ?? { sales: 0, cogs: 0, cogsRatio: null };
                      return (
                        <tr
                          key={cat}
                          className="border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors"
                        >
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

      {/* Summary card */}
      {data && !loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Total Sales
            </p>
            <p className="mt-1 text-2xl font-bold text-brand-500 tabular-nums">
              {fmtMXN((data.period as CogsPeriodSummary).totalSales)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              {startDate} – {endDate}
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Total COGS
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
              {fmtMXN((data.period as CogsPeriodSummary).totalCOGS)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              from stock usage × cost/unit
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Overall COGS %
            </p>
            {data.period.cogsRatio !== null ? (
              <>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${
                  data.period.cogsRatio < 0.25
                    ? "text-green-600 dark:text-green-400"
                    : data.period.cogsRatio <= 0.35
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {fmtRatio(data.period.cogsRatio)}
                </p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  {data.period.cogsRatio < 0.25
                    ? "✓ Under target"
                    : data.period.cogsRatio <= 0.35
                    ? "⚠ Near threshold"
                    : "✗ Over target"}
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

// ── main component ────────────────────────────────────────────────────────────

export function Reports() {
  const toast = useToast();
  const [endDate, setEndDate] = useState(todayISO());
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(
    (end: string) => {
      setLoading(true);
      reportsApi
        .weekly(end)
        .then(setReport)
        .catch((err) => toast.error(getApiError(err)))
        .finally(() => setLoading(false));
    },
    [toast]
  );

  useEffect(() => {
    load(endDate);
  }, [endDate, load]);

  async function handleExport() {
    if (!report) return;
    setExporting(true);
    try {
      await reportsApi.exportCsv(report.startDate, report.endDate);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setExporting(false);
    }
  }

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
            borderColor: "#22c55e",
            backgroundColor: "rgba(34,197,94,0.08)",
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: "Used",
            data: report.days.map((d) => d.used),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.08)",
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: "Waste",
            data: report.days.map((d) => d.waste),
            borderColor: "#ef4444",
            backgroundColor: "rgba(239,68,68,0.05)",
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5,
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

  return (
    <div className="p-6 space-y-4">
      {/* Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-white">Reports</h1>
          {report && (
            <p className="text-[13px] text-[#555] mt-1">
              {formatChartLabel(report.startDate)} – {formatChartLabel(report.endDate)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setEndDate(todayISO())}
            className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            This Week
          </button>
          <button
            onClick={() => setEndDate(prevWeekEnd(endDate))}
            className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            ← Prev
          </button>
          <input
            type="date"
            value={endDate}
            max={todayISO()}
            onChange={(e) => e.target.value && setEndDate(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={handleExport}
            disabled={exporting || !report}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {loading ? (
        <PageSpinner />
      ) : report ? (
        <>
          {/* Summary cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              label="Inventory Value"
              value={formatCurrency(report.inventoryValue)}
              sub="current at cost"
              accent="text-green-600 dark:text-green-400"
            />
            <SummaryCard
              label="Items Low"
              value={report.lowItemsCount}
              sub="below minimum"
              accent={report.lowItemsCount > 0 ? "text-red-500" : "text-green-600 dark:text-green-400"}
            />
            <SummaryCard
              label="Total Waste"
              value={report.totalWaste}
              sub="units this period"
              accent={report.totalWaste > 0 ? "text-yellow-500" : "text-gray-400 dark:text-gray-500"}
            />
            <SummaryCard
              label="Total Received"
              value={report.totalReceived}
              sub="units this period"
              accent="text-brand-500"
            />
          </div>

          {/* Trend chart ────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
              7-Day Stock Activity
            </h2>
            <div className="h-56 sm:h-72">
              {chartData && <Line data={chartData} options={chartOptions} />}
            </div>
          </div>

          {/* Daily breakdown ────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Daily Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    {["Date", "Received", "Used", "Waste"].map((h) => (
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
                      <td className="px-5 py-3 font-medium text-green-600 dark:text-green-400">
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

          {/* COGS Report ────────────────────────────────────────────── */}
          <CogsReportSection />

          {/* Most used products ─────────────────────────────────────── */}
          {report.mostUsed.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Most Used Products
                </h2>
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
                          <td className="px-5 py-3 text-gray-400 dark:text-gray-500 font-mono text-xs">
                            {idx + 1}
                          </td>
                          <td className="px-5 py-3">
                            <p className="font-medium text-gray-900 dark:text-white">{item.productName}</p>
                            <div className="mt-1.5 h-1 bg-gray-100 dark:bg-gray-700 rounded-full w-36 overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                          <td className="px-5 py-3 font-semibold text-blue-600 dark:text-blue-400">
                            {item.totalUsed}
                          </td>
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
