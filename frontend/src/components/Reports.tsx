import React, { useEffect, useState, useCallback } from "react";
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
import { WeeklyReport, Unit } from "../types";
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
    <div className="p-6 space-y-6">
      {/* Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
          {report && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
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
