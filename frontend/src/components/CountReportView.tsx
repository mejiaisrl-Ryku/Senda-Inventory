import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CountReport } from "../types";
import { countsApi } from "../api";
import { useToast } from "../context/ToastContext";
import { getApiError } from "../utils/errorUtils";
import { PageSpinner } from "./shared/Spinner";
import { Spinner } from "./shared/Spinner";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

function formatCurrency(n: number, showSign = false): string {
  const s = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Math.abs(n));
  if (!showSign) return n < 0 ? `-${s}` : s;
  return n < 0 ? `-${s}` : n > 0 ? `+${s}` : s;
}

/** Maps raw DB enum → human-readable department label. */
function deptLabel(raw: string | undefined): string {
  if (raw === "BOH"  || raw === "KITCHEN") return "Kitchen";
  if (raw === "BOTH")                      return "Kitchen & FOH";
  if (raw === "FOH")                       return "FOH";
  if (raw === "BAR")                       return "Bar";
  return raw ?? "—";
}

function varianceColor(v: number): string {
  if (v < 0) return "text-red-400";
  if (v > 0) return "text-[#3dbf8a]";
  return "text-[#555]";
}

function varianceBg(v: number): string {
  if (v < 0) return "bg-red-900/20";
  if (v > 0) return "bg-[#3dbf8a]/10";
  return "bg-[#1a1a1a]";
}

// ── Print sheet generator ─────────────────────────────────────────────────────

type PrintDept = "ALL" | "KITCHEN" | "BAR" | "FOH";

function entryMatchesDept(dept: string | undefined, filter: PrintDept): boolean {
  if (filter === "ALL")     return true;
  if (filter === "KITCHEN") return dept === "BOH" || dept === "BOTH";
  if (filter === "BAR")     return dept === "BAR";
  if (filter === "FOH")     return dept === "FOH" || dept === "BOTH";
  return true;
}

function generatePrintHtml(report: CountReport, deptFilter: PrintDept = "ALL"): string {
  const sessionDate = formatDate(report.session.date);
  const deptTitle   = deptFilter === "ALL" ? deptLabel(report.session.department) : deptLabel(deptFilter);

  // Filter entries by dept then group by category
  const filtered = deptFilter === "ALL"
    ? report.entries
    : report.entries.filter((e) => entryMatchesDept(e.department, deptFilter));

  const byCat = new Map<string, typeof report.entries>();
  for (const e of filtered) {
    const cat = e.category ?? "Uncategorized";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(e);
  }
  const sortedCats = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let counter = 0;
  const tableRows = sortedCats.map(([cat, items]: [string, typeof report.entries]) => {
    const rows = items
      .sort((a, b) => (a.productName ?? "").localeCompare(b.productName ?? ""))
      .map((e) => {
        counter++;
        return `
          <tr>
            <td class="num">${counter}</td>
            <td class="name"><strong>${e.productName ?? "—"}</strong>${e.sku ? `<br><span class="sku">${e.sku}</span>` : ""}</td>
            <td class="unit">${e.unit ?? "—"}</td>
            <td class="qty">${e.expectedQuantity}</td>
            <td class="blank"></td>
            <td class="blank"></td>
          </tr>`;
      })
      .join("");

    return `
      <tr class="cat-header">
        <td colspan="6">${cat}</td>
      </tr>
      ${rows}`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Count Sheet — ${sessionDate}${deptFilter !== "ALL" ? ` (${deptTitle})` : ""}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; background: #fff; }

  .page-header { padding: 12px 16px; border-bottom: 2px solid #3dbf8a; margin-bottom: 16px; }
  .page-header h1 { font-size: 18px; font-weight: 700; color: #111; }
  .page-header p  { font-size: 11px; color: #555; margin-top: 4px; }

  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; vertical-align: middle; }
  th { background: #2d2d2d; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }

  tr:nth-child(even) { background: #f7f7f7; }

  .cat-header td {
    background: #eeeeee; font-weight: 700; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.06em; color: #444;
    padding: 6px 8px;
  }

  .num  { width: 32px; text-align: center; color: #888; }
  .name { width: auto; }
  .sku  { font-size: 9px; color: #888; }
  .unit { width: 60px; text-align: center; }
  .qty  { width: 80px; text-align: right; }
  .blank { width: 90px; }

  .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 10px; color: #888; }

  @media print {
    @page { size: letter portrait; margin: 0.6in 0.5in; }
    body { font-size: 10px; }
    .page-header { page-break-after: avoid; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="page-header">
    <h1>Inventory Count Sheet</h1>
    <p>Date: ${sessionDate} &nbsp;|&nbsp; Department: ${deptTitle} &nbsp;|&nbsp; Printed: ${new Date().toLocaleDateString()}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th class="name">Product</th>
        <th class="unit">Unit</th>
        <th class="qty">Expected</th>
        <th class="blank">Actual Count</th>
        <th class="blank">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="footer">
    ${counter} items &nbsp;·&nbsp; Counted by: __________________________ &nbsp;·&nbsp; Verified by: __________________________
  </div>

  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: "red" | "green" | "neutral";
}) {
  const valColor =
    accent === "red"   ? "text-red-400"   :
    accent === "green" ? "text-[#3dbf8a]" :
    "text-white";

  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl px-5 py-4">
      <p className="text-[10px] font-medium text-[#444] uppercase tracking-[0.1em] mb-1">{label}</p>
      <p className={`text-[22px] font-semibold tabular-nums leading-none ${valColor}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#555] mt-1">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CountReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const toast     = useToast();

  const [report, setReport]       = useState<CountReport | null>(null);
  const [loading, setLoading]     = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printDeptOpen, setPrintDeptOpen] = useState(false);
  const printDeptRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await countsApi.report(id);
      setReport(r);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  // Close "Print by Dept" dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (printDeptRef.current && !printDeptRef.current.contains(e.target as Node)) {
        setPrintDeptOpen(false);
      }
    }
    if (printDeptOpen) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [printDeptOpen]);

  // Entries sorted by largest absolute variance first (most negative = biggest loss)
  const sortedEntries = useMemo(() => {
    if (!report) return [];
    return [...report.entries].sort((a, b) => a.varianceValue - b.varianceValue);
  }, [report]);

  function handlePrintSheet(deptFilter: PrintDept = "ALL") {
    if (!report) return;
    const html = generatePrintHtml(report, deptFilter);
    const win  = window.open("", "_blank");
    if (!win) { toast.error("Pop-up blocked — allow pop-ups and try again."); return; }
    win.document.write(html);
    win.document.close();
    setPrintDeptOpen(false);
  }

  async function handleExport() {
    if (!id) return;
    setExporting(true);
    try {
      await countsApi.exportXlsx(id);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <PageSpinner />
      </div>
    );
  }

  if (!report) {
    return <div className="p-8 text-[#555]">Report not found.</div>;
  }

  const { summary, byCategory } = report;
  const varAccent =
    summary.totalVarianceValue < 0 ? "red" :
    summary.totalVarianceValue > 0 ? "green" :
    "neutral";

  const varPct = summary.variancePct;

  return (
    <div className="p-4 sm:p-8 space-y-6 pb-16">

      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            onClick={() => navigate(`/inventory/${id}`)}
            className="flex items-center gap-1.5 text-[#888] hover:text-white text-sm transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Count Session</span>
          </button>
          <span className="text-[#333]">/</span>
          <div>
            <h1 className="text-[18px] font-semibold text-white leading-tight">
              Variance Report
            </h1>
            <p className="text-[12px] text-[#555] mt-0.5">
              {formatDate(report.session.date)} · {report.session.department}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">

          {/* Print Count Sheet (full) + Print by Dept dropdown */}
          <div className="flex rounded-xl border border-[#2a2a2a] overflow-visible relative" ref={printDeptRef}>
            {/* Main print button */}
            <button
              onClick={() => handlePrintSheet("ALL")}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 text-[#888] hover:text-white
                         text-sm font-medium transition-colors border-r border-[#2a2a2a]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Count Sheet
            </button>
            {/* Dropdown chevron */}
            <button
              onClick={() => setPrintDeptOpen((o) => !o)}
              className="inline-flex items-center justify-center min-h-[40px] px-2.5 text-[#888] hover:text-white transition-colors"
              aria-label="Print by department"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* Dept dropdown */}
            {printDeptOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 min-w-[160px] bg-[#111] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden">
                {([
                  { value: "KITCHEN" as PrintDept, label: "Print Kitchen" },
                  { value: "BAR"     as PrintDept, label: "Print Bar"     },
                  { value: "FOH"     as PrintDept, label: "Print FOH"     },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => handlePrintSheet(value)}
                    className="w-full text-left px-4 py-2.5 text-sm text-[#aaa] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-4 bg-[#3dbf8a] hover:bg-[#35a87a]
                       disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {exporting ? <Spinner size="sm" /> : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SummaryCard
          label="Items Counted"
          value={String(summary.totalEntries)}
          sub={`${summary.overCount} over · ${summary.underCount} under · ${summary.exactCount} exact`}
        />
        <SummaryCard
          label="Expected Value"
          value={formatCurrency(summary.totalExpectedValue)}
          accent="neutral"
        />
        <SummaryCard
          label="Actual Value"
          value={formatCurrency(summary.totalActualValue)}
          accent="neutral"
        />
        <SummaryCard
          label="Variance $"
          value={formatCurrency(summary.totalVarianceValue, true)}
          accent={varAccent}
        />
        <SummaryCard
          label="Variance %"
          value={`${varPct >= 0 ? "+" : ""}${varPct.toFixed(2)}%`}
          accent={varAccent}
        />
      </div>

      {/* ── By Category table ────────────────────────────────────────────────── */}
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a]">
          <h2 className="text-[13px] font-semibold text-[#888] uppercase tracking-[0.08em]">
            By Category
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {["Category", "Items", "Expected $", "Actual $", "Variance $", "Variance %"].map((h, i) => (
                  <th key={h} className={`text-[10px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 ${i > 0 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {byCategory.map((row) => (
                <tr key={row.category} className="hover:bg-[#111] transition-colors">
                  <td className="px-5 py-3 text-white font-medium">{row.category}</td>
                  <td className="px-5 py-3 text-right text-[#888] tabular-nums">{row.entryCount}</td>
                  <td className="px-5 py-3 text-right text-[#888] tabular-nums">{formatCurrency(row.expectedValue)}</td>
                  <td className="px-5 py-3 text-right text-[#888] tabular-nums">{formatCurrency(row.actualValue)}</td>
                  <td className={`px-5 py-3 text-right font-semibold tabular-nums ${varianceColor(row.varianceValue)}`}>
                    {formatCurrency(row.varianceValue, true)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${varianceColor(row.varianceValue)} ${varianceBg(row.varianceValue)}`}>
                      {row.variancePct >= 0 ? "+" : ""}{row.variancePct.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals */}
            <tfoot>
              <tr className="border-t border-[#2a2a2a] bg-[#111]">
                <td className="px-5 py-3 text-[11px] font-semibold text-[#888] uppercase tracking-wider">Total</td>
                <td className="px-5 py-3 text-right text-[#888] tabular-nums font-semibold">{summary.totalEntries}</td>
                <td className="px-5 py-3 text-right text-[#888] tabular-nums font-semibold">{formatCurrency(summary.totalExpectedValue)}</td>
                <td className="px-5 py-3 text-right text-[#888] tabular-nums font-semibold">{formatCurrency(summary.totalActualValue)}</td>
                <td className={`px-5 py-3 text-right font-bold tabular-nums ${varianceColor(summary.totalVarianceValue)}`}>
                  {formatCurrency(summary.totalVarianceValue, true)}
                </td>
                <td className="px-5 py-3 text-right">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${varianceColor(summary.totalVarianceValue)} ${varianceBg(summary.totalVarianceValue)}`}>
                    {varPct >= 0 ? "+" : ""}{varPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Line items ───────────────────────────────────────────────────────── */}
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[#888] uppercase tracking-[0.08em]">
            Line Items
          </h2>
          <span className="text-[11px] text-[#444]">sorted by largest variance</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {[
                  { label: "Product",      right: false },
                  { label: "Category",     right: false },
                  { label: "Dept",         right: false },
                  { label: "Unit",         right: false },
                  { label: "Expected Qty", right: true  },
                  { label: "Actual Qty",   right: true  },
                  { label: "Variance Qty", right: true  },
                  { label: "Unit Cost",    right: true  },
                  { label: "Variance $",   right: true  },
                ].map(({ label, right }) => (
                  <th key={label} className={`text-[10px] font-medium text-[#555] uppercase tracking-wider px-4 py-3 whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {sortedEntries.map((e) => {
                const varV = e.varianceValue;
                return (
                  <tr key={e.id} className="hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3 font-medium text-white whitespace-nowrap max-w-[200px] truncate">
                      {e.productName ?? "—"}
                      {e.sku && <span className="block text-[10px] text-[#444] font-normal">{e.sku}</span>}
                    </td>
                    <td className="px-4 py-3 text-[#666] whitespace-nowrap">{e.category ?? "—"}</td>
                    <td className="px-4 py-3 text-[#666]">{deptLabel(e.department)}</td>
                    <td className="px-4 py-3 text-[#666]">{e.unit ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-[#888] tabular-nums">{e.expectedQuantity}</td>
                    <td className="px-4 py-3 text-right text-[#888] tabular-nums">{e.actualQuantity}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${varianceColor(e.variance)}`}>
                      {e.variance > 0 ? "+" : ""}{e.variance}
                    </td>
                    <td className="px-4 py-3 text-right text-[#666] tabular-nums">
                      {formatCurrency(e.unitCost)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-[12px] font-bold tabular-nums ${varianceColor(varV)} ${varianceBg(varV)}`}>
                        {formatCurrency(varV, true)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
