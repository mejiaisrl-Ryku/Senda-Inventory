import ExcelJS from "exceljs";
import { Response, NextFunction } from "express";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

const sessionModel = (prisma as any).countSession as any;

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  brand:      "FF3DBF8A",   // kyru green
  dark:       "FF1A1A1A",
  mid:        "FF2A2A2A",
  headerBg:   "FF2D2D2D",
  white:      "FFFFFFFF",
  offWhite:   "FFF9F9F9",
  rowAlt:     "FFF3F3F3",
  red:        "FFFFE0E0",
  amber:      "FFFFF3CD",
  green:      "FFE8F8EF",
  textDark:   "FF111111",
  textMuted:  "FF666666",
  negativeText: "FFB91C1C",
  positiveText: "FFB45309",
  exactText:  "FF15803D",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === "object" ? parseFloat(String(v)) : Number(v);
}

function r2(n: number) { return Math.round(n * 100) / 100; }

function cell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  opts: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    color?: string;
    bg?: string;
    align?: ExcelJS.Alignment["horizontal"];
    numFmt?: string;
    border?: boolean;
    wrap?: boolean;
  } = {}
) {
  const c = ws.getCell(row, col);
  c.value = value;
  c.font = {
    name: "Arial",
    size: opts.size ?? 10,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: { argb: opts.color ?? C.textDark },
  };
  if (opts.bg) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.bg } };
  c.alignment = { horizontal: opts.align ?? "left", vertical: "middle", wrapText: opts.wrap };
  if (opts.numFmt) c.numFmt = opts.numFmt;
  if (opts.border) {
    const b: ExcelJS.Border = { style: "thin", color: { argb: "FFCCCCCC" } };
    c.border = { top: b, left: b, bottom: b, right: b };
  }
  return c;
}

function headerRow(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: string[],
  startCol = 1
) {
  cols.forEach((label, i) => {
    cell(ws, row, startCol + i, label, {
      bold: true, size: 9, color: C.white, bg: C.headerBg,
      align: i > 0 ? "right" : "left", border: true,
    });
  });
  ws.getRow(row).height = 20;
}

function varianceFill(value: number) {
  if (value < 0) return C.red;
  if (value > 0) return C.amber;
  return C.green;
}

function varianceTextColor(value: number) {
  if (value < 0) return C.negativeText;
  if (value > 0) return C.positiveText;
  return C.exactText;
}

// ── Sheet builders ────────────────────────────────────────────────────────────

function buildSummarySheet(wb: ExcelJS.Workbook, session: any, entries: any[]) {
  const ws = wb.addWorksheet("Variance Summary");
  ws.columns = [
    { width: 28 }, { width: 20 }, { width: 15 },
  ];

  const sessionDate = new Date(session.date).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });

  // Title
  ws.mergeCells("A1:C1");
  cell(ws, 1, 1, "Inventory Variance Report", {
    bold: true, size: 14, color: C.white, bg: C.brand, align: "center",
  });
  ws.getRow(1).height = 28;

  // Meta
  ws.mergeCells("A2:C2");
  cell(ws, 2, 1, `Date: ${sessionDate}  |  Department: ${session.department}  |  Status: ${session.status}`, {
    size: 10, color: C.textMuted, bg: C.offWhite, align: "center",
  });
  ws.getRow(2).height = 18;

  // Section: Value Summary
  ws.getRow(4).height = 18;
  headerRow(ws, 4, ["Metric", "Value", ""], 1);

  const totalExpectedValue = r2(entries.reduce((s: number, e: any) => s + num(e.expectedQuantity) * num(e.unitCost), 0));
  const totalActualValue   = r2(entries.reduce((s: number, e: any) => s + num(e.actualQuantity)   * num(e.unitCost), 0));
  const totalVarianceValue = r2(totalActualValue - totalExpectedValue);
  const variancePct        = totalExpectedValue > 0 ? r2((totalVarianceValue / totalExpectedValue) * 100) : 0;

  const summaryRows: [string, number | string, string][] = [
    ["Total Items Counted", entries.length, ""],
    ["Total Expected Value", totalExpectedValue, "#,##0.00"],
    ["Total Actual Value",   totalActualValue,   "#,##0.00"],
    ["Variance $",           totalVarianceValue, "#,##0.00"],
    ["Variance %",           variancePct / 100,  "0.00%"],
  ];

  summaryRows.forEach(([label, val, fmt], i) => {
    const r = 5 + i;
    const bg = i >= 3 ? varianceFill(totalVarianceValue) : (i % 2 === 0 ? C.white : C.rowAlt);
    cell(ws, r, 1, label, { bg, border: true });
    cell(ws, r, 2, val as ExcelJS.CellValue, {
      bg,
      border: true,
      align: "right",
      numFmt: fmt || undefined,
      bold: i >= 3,
      color: i === 3 || i === 4 ? varianceTextColor(totalVarianceValue) : C.textDark,
    });
    cell(ws, r, 3, "", { bg, border: true });
    ws.getRow(r).height = 18;
  });

  // Section: Counts breakdown
  ws.getRow(11).height = 18;
  headerRow(ws, 11, ["Count", "Items", ""], 1);
  [
    ["Over (actual > expected)", entries.filter((e: any) => num(e.variance) > 0).length],
    ["Under (actual < expected)", entries.filter((e: any) => num(e.variance) < 0).length],
    ["Exact match",              entries.filter((e: any) => num(e.variance) === 0).length],
  ].forEach(([label, val], i) => {
    const r = 12 + i;
    const bg = i % 2 === 0 ? C.white : C.rowAlt;
    cell(ws, r, 1, label as string, { bg, border: true });
    cell(ws, r, 2, val as number,   { bg, border: true, align: "right" });
    cell(ws, r, 3, "",              { bg, border: true });
    ws.getRow(r).height = 18;
  });
}

function buildCategorySheet(wb: ExcelJS.Workbook, entries: any[]) {
  const ws = wb.addWorksheet("By Category");
  ws.columns = [
    { width: 26 }, { width: 8 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 12 },
  ];

  ws.mergeCells("A1:F1");
  cell(ws, 1, 1, "Variance by Category", { bold: true, size: 12, color: C.white, bg: C.brand });
  ws.getRow(1).height = 24;

  headerRow(ws, 3, ["Category", "Items", "Expected $", "Actual $", "Variance $", "Variance %"], 1);

  // Build category aggregates
  const catMap = new Map<string, { count: number; exp: number; act: number; varV: number }>();
  for (const e of entries) {
    const cat = e.product?.category ?? "Uncategorized";
    const ex  = num(e.expectedQuantity) * num(e.unitCost);
    const ac  = num(e.actualQuantity)   * num(e.unitCost);
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, exp: 0, act: 0, varV: 0 });
    const row = catMap.get(cat)!;
    row.count++;
    row.exp  += ex;
    row.act  += ac;
    row.varV += (ac - ex);
  }

  const cats = [...catMap.entries()].sort((a, b) => a[1].varV - b[1].varV);
  cats.forEach(([cat, d], i) => {
    const r   = 4 + i;
    const bg  = i % 2 === 0 ? C.white : C.rowAlt;
    const vBg = varianceFill(d.varV);
    const vTx = varianceTextColor(d.varV);
    const pct = d.exp > 0 ? r2(d.varV / d.exp) : 0;
    cell(ws, r, 1, cat,              { bg, border: true });
    cell(ws, r, 2, d.count,          { bg, border: true, align: "right" });
    cell(ws, r, 3, r2(d.exp),        { bg, border: true, align: "right", numFmt: "#,##0.00" });
    cell(ws, r, 4, r2(d.act),        { bg, border: true, align: "right", numFmt: "#,##0.00" });
    cell(ws, r, 5, r2(d.varV),       { bg: vBg, border: true, align: "right", numFmt: "#,##0.00", color: vTx, bold: true });
    cell(ws, r, 6, pct,              { bg: vBg, border: true, align: "right", numFmt: "0.00%",    color: vTx });
    ws.getRow(r).height = 18;
  });

  // Totals row
  const tr = 4 + cats.length;
  const totExp  = r2(cats.reduce((s, [, d]) => s + d.exp, 0));
  const totAct  = r2(cats.reduce((s, [, d]) => s + d.act, 0));
  const totVarV = r2(totAct - totExp);
  const totPct  = totExp > 0 ? r2(totVarV / totExp) : 0;
  headerRow(ws, tr, ["TOTAL", String(entries.length), "", "", "", ""], 1);
  cell(ws, tr, 2, entries.length, { bold: true, color: C.white, bg: C.headerBg, border: true, align: "right" });
  cell(ws, tr, 3, totExp,   { bold: true, color: C.white, bg: C.headerBg, border: true, align: "right", numFmt: "#,##0.00" });
  cell(ws, tr, 4, totAct,   { bold: true, color: C.white, bg: C.headerBg, border: true, align: "right", numFmt: "#,##0.00" });
  cell(ws, tr, 5, totVarV,  { bold: true, color: C.white, bg: C.headerBg, border: true, align: "right", numFmt: "#,##0.00" });
  cell(ws, tr, 6, totPct,   { bold: true, color: C.white, bg: C.headerBg, border: true, align: "right", numFmt: "0.00%" });
  ws.getRow(tr).height = 20;
}

function buildLineItemsSheet(wb: ExcelJS.Workbook, entries: any[]) {
  const ws = wb.addWorksheet("Line Items");
  ws.columns = [
    { width: 28 }, { width: 12 }, { width: 20 }, { width: 10 }, { width: 8 },
    { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 },
  ];

  ws.mergeCells("A1:K1");
  cell(ws, 1, 1, "Line Items — sorted by largest variance first", {
    bold: true, size: 12, color: C.white, bg: C.brand,
  });
  ws.getRow(1).height = 24;

  headerRow(ws, 3, [
    "Product", "SKU", "Category", "Dept", "Unit",
    "Expected Qty", "Actual Qty", "Variance Qty", "Unit Cost $", "Variance $", "Variance %",
  ], 1);

  // Sort: largest absolute varianceValue first (most negative = biggest loss)
  const sorted = [...entries].sort((a, b) => num(a.varianceValue) - num(b.varianceValue));

  sorted.forEach((e, i) => {
    const r      = 4 + i;
    const varV   = num(e.varianceValue);
    const expV   = num(e.expectedQuantity) * num(e.unitCost);
    const pct    = expV > 0 ? r2(varV / expV) : 0;
    const bg     = i % 2 === 0 ? C.white : C.rowAlt;
    const vBg    = varianceFill(varV);
    const vTx    = varianceTextColor(varV);
    cell(ws, r, 1,  e.product?.name ?? "—",           { bg, border: true });
    cell(ws, r, 2,  e.product?.sku  ?? "—",           { bg, border: true, color: C.textMuted });
    cell(ws, r, 3,  e.product?.category ?? "—",       { bg, border: true, color: C.textMuted });
    cell(ws, r, 4,  e.product?.department ?? "—",     { bg, border: true, color: C.textMuted });
    cell(ws, r, 5,  e.product?.unit ?? "—",           { bg, border: true, color: C.textMuted });
    cell(ws, r, 6,  num(e.expectedQuantity),          { bg, border: true, align: "right", numFmt: "#,##0.000" });
    cell(ws, r, 7,  num(e.actualQuantity),            { bg, border: true, align: "right", numFmt: "#,##0.000" });
    cell(ws, r, 8,  num(e.variance),                  { bg: vBg, border: true, align: "right", numFmt: "#,##0.000", color: vTx });
    cell(ws, r, 9,  num(e.unitCost),                  { bg, border: true, align: "right", numFmt: "#,##0.00" });
    cell(ws, r, 10, varV,                             { bg: vBg, border: true, align: "right", numFmt: "#,##0.00", bold: true, color: vTx });
    cell(ws, r, 11, pct,                              { bg: vBg, border: true, align: "right", numFmt: "0.00%",   color: vTx });
    ws.getRow(r).height = 17;
  });
}

function buildCountSheetTab(wb: ExcelJS.Workbook, session: any, entries: any[]) {
  const ws = wb.addWorksheet("Count Sheet");
  ws.columns = [
    { width: 5 }, { width: 30 }, { width: 12 }, { width: 20 }, { width: 8 },
    { width: 12 }, { width: 14 }, { width: 20 },
  ];

  const sessionDate = new Date(session.date).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });

  ws.mergeCells("A1:H1");
  cell(ws, 1, 1, `Inventory Count Sheet — ${sessionDate} — ${session.department}`, {
    bold: true, size: 12, color: C.white, bg: C.brand,
  });
  ws.getRow(1).height = 24;

  headerRow(ws, 3, ["#", "Product", "SKU", "Category", "Unit", "Expected", "Actual", "Notes"], 1);

  // Group by dept then category, sorted alphabetically
  const sorted = [...entries].sort((a, b) => {
    const catA = (a.product?.category ?? "").toLowerCase();
    const catB = (b.product?.category ?? "").toLowerCase();
    if (catA !== catB) return catA.localeCompare(catB);
    return (a.product?.name ?? "").localeCompare(b.product?.name ?? "");
  });

  sorted.forEach((e, i) => {
    const r  = 4 + i;
    const bg = i % 2 === 0 ? C.white : C.rowAlt;
    cell(ws, r, 1, i + 1,                             { bg, border: true, align: "center", color: C.textMuted });
    cell(ws, r, 2, e.product?.name ?? "—",            { bg, border: true });
    cell(ws, r, 3, e.product?.sku  ?? "—",            { bg, border: true, color: C.textMuted });
    cell(ws, r, 4, e.product?.category ?? "—",        { bg, border: true, color: C.textMuted });
    cell(ws, r, 5, e.product?.unit ?? "—",            { bg, border: true, align: "center" });
    cell(ws, r, 6, num(e.expectedQuantity),           { bg, border: true, align: "right", numFmt: "#,##0.000" });
    cell(ws, r, 7, "",                                { bg: "FFFFFFFF", border: true });   // blank for writing
    cell(ws, r, 8, "",                                { bg: "FFFFFFFF", border: true });   // blank notes
    ws.getRow(r).height = 18;
  });
}

// ── Main export handler ───────────────────────────────────────────────────────

export async function exportCountXlsx(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await sessionModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
      include: {
        entries: {
          include: {
            product: {
              select: {
                id: true, name: true, sku: true, category: true,
                purveyor: true, department: true, unit: true, costPerUnit: true,
              },
            },
          },
          orderBy: { product: { name: "asc" } },
        },
      },
    });

    const entries: any[] = session.entries;

    const wb = new ExcelJS.Workbook();
    wb.creator  = "kyru Advisory";
    wb.created  = new Date();
    wb.modified = new Date();

    buildSummarySheet(wb, session, entries);
    buildCategorySheet(wb, entries);
    buildLineItemsSheet(wb, entries);
    buildCountSheetTab(wb, session, entries);

    const dateStr = new Date(session.date).toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="count-${dateStr}-${session.department}.xlsx"`
    );
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
}
