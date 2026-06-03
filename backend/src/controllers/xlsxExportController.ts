import { Response, NextFunction } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { StockReason } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function toUTCDay(s: string): Date { return new Date(`${s}T00:00:00.000Z`); }
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r;
}
function fmtLong(s: string): string {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}
function fmtMMDDYYYY(d: Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}/${dt.getUTCFullYear()}`;
}

// ── Category definitions ──────────────────────────────────────────────────────

const SALE_CATS = [
  { key: "BEER",          label: "Beer",          qb: "4010 · Beer Sales" },
  { key: "LIQUOR",        label: "Liquor",        qb: "4020 · Liquor Sales" },
  { key: "WINE",          label: "Wine",           qb: "4030 · Wine Sales" },
  { key: "FOOD",          label: "Food",           qb: "4040 · Food Sales" },
  { key: "NON_ALCOHOLIC", label: "Non-Alcoholic",  qb: "4050 · Non-Alcoholic Sales" },
  { key: "EVENTS",        label: "Events",         qb: "4060 · Events Revenue" },
  { key: "DELIVERY",      label: "Delivery",       qb: "4070 · Delivery Revenue" },
  { key: "BUYOUTS",       label: "Buyouts",        qb: "4080 · Buyouts" },
] as const;

const COGS_CATS = [
  { key: "BEER",          label: "Beer",          qb: "5010 · Beer Cost of Sales" },
  { key: "LIQUOR",        label: "Liquor",        qb: "5020 · Liquor Cost of Sales" },
  { key: "WINE",          label: "Wine",           qb: "5030 · Wine Cost of Sales" },
  { key: "FOOD",          label: "Food",           qb: "5040 · Food Cost of Sales" },
  { key: "NON_ALCOHOLIC", label: "Non-Alcoholic",  qb: "5050 · Non-Alcoholic Cost" },
] as const;

// ── Style constants ───────────────────────────────────────────────────────────

const FONT = "Calibri";
const MONEY = '"$"#,##0.00';
const PCT   = "0.0%";

// Row-level background fills
const FILL_DARK:  ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1F1F" } };
const FILL_TOTAL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
const FILL_GROSS: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6F0E4" } };
const FILL_NOI:   ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E8FF" } };

function cell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  opts: {
    bold?: boolean; italic?: boolean;
    color?: string; size?: number;
    numFmt?: string; fill?: ExcelJS.Fill;
    align?: ExcelJS.Alignment["horizontal"];
    indent?: number;
  } = {}
) {
  const c = ws.getCell(row, col);
  c.value = value;
  c.font  = {
    name: FONT,
    bold:   opts.bold   ?? false,
    italic: opts.italic ?? false,
    color: { argb: opts.color ?? "FF000000" },
    size:  opts.size ?? 11,
  };
  if (opts.numFmt) c.numFmt = opts.numFmt;
  if (opts.fill)   c.fill   = opts.fill;
  if (opts.align || opts.indent) {
    c.alignment = { horizontal: opts.align ?? "left", indent: opts.indent };
  }
  return c;
}

function sectionHeader(ws: ExcelJS.Worksheet, row: number, label: string, cols = 3) {
  for (let c = 1; c <= cols; c++) {
    const cell_ = ws.getCell(row, c);
    cell_.fill = FILL_DARK;
    cell_.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  }
  ws.getCell(row, 1).value = label;
  ws.getRow(row).height = 18;
}

function totalRow(
  ws: ExcelJS.Worksheet,
  row: number,
  label: string,
  amtFormula: string,
  pctFormula: string,
  fill: ExcelJS.Fill = FILL_TOTAL
) {
  const r = ws.getRow(row);
  r.height = 18;
  [1, 2, 3].forEach((c) => {
    ws.getCell(row, c).fill = fill;
  });
  cell(ws, row, 1, label,                       { bold: true, fill });
  cell(ws, row, 2, { formula: amtFormula },      { bold: true, numFmt: MONEY, fill });
  cell(ws, row, 3, { formula: pctFormula },      { bold: true, numFmt: PCT,   fill, align: "right" });
}

// ── P&L Sheet ─────────────────────────────────────────────────────────────────
// Row map (1-indexed):
//  1        title
//  2        period
//  3        generated
//  4        blank
//  5        REVENUE header
//  6–13     category rows (8 sale cats)
//  14       TOTAL REVENUE   → B14 = SUM(B6:B13)
//  15       blank
//  16       COGS header
//  17–21    cogs category rows (5)
//  22       TOTAL COGS      → B22 = SUM(B17:B21)
//  23       blank
//  24       GROSS PROFIT    → B24 = B14-B22
//  25       blank
//  26       LABOR header
//  27       FOH Labor
//  28       BOH Labor
//  29       Management
//  30       TOTAL LABOR     → B30 = SUM(B27:B29)
//  31       blank
//  32       NET OPERATING INCOME → B32 = B24-B30
//  33       blank
//  34       COGS % BY CATEGORY header
//  35–39   per-category COGS %

function buildPLSheet(
  wb: ExcelJS.Workbook,
  opts: {
    startStr: string; endStr: string;
    salesByCat: Record<string, number>;
    cogsByCat:  Record<string, number>;
    totalFoh: number; totalBoh: number; totalMgmt: number;
  }
) {
  const ws = wb.addWorksheet("P&L Summary");

  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 14;

  const { startStr, endStr, salesByCat, cogsByCat, totalFoh, totalBoh, totalMgmt } = opts;

  // ── Title block ──────────────────────────────────────────────────────────
  cell(ws, 1, 1, "PROFIT & LOSS SUMMARY", { bold: true, size: 14, color: "FF1F1F1F" });
  ws.getRow(1).height = 24;
  cell(ws, 2, 1, `Period: ${fmtLong(startStr)} – ${fmtLong(endStr)}`, { italic: true, color: "FF555555" });
  cell(ws, 3, 1, `Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    { italic: true, color: "FF888888", size: 10 });

  // column headers row 4
  ws.getRow(4).height = 6; // spacer

  // ── REVENUE section (rows 5–14) ──────────────────────────────────────────
  sectionHeader(ws, 5, "REVENUE");

  SALE_CATS.forEach(({ key, label }, i) => {
    const r = 6 + i; // rows 6–13
    cell(ws, r, 1, `  ${label}`, { color: "FF333333", indent: 1 });
    cell(ws, r, 2, salesByCat[key] ?? 0,
      { numFmt: MONEY, color: "FF0000FF" }); // blue = hardcoded input
    cell(ws, r, 3, { formula: `IFERROR(B${r}/B14,0)` },
      { numFmt: PCT, align: "right" });
  });

  totalRow(ws, 14, "TOTAL REVENUE", "SUM(B6:B13)", "1", FILL_TOTAL);
  // % of revenue for total is always 100% — hard-code as 1 (formatted as PCT)
  cell(ws, 14, 3, 1, { bold: true, numFmt: PCT, fill: FILL_TOTAL, align: "right" });

  ws.getRow(15).height = 6;

  // ── COGS section (rows 16–22) ────────────────────────────────────────────
  sectionHeader(ws, 16, "COST OF GOODS SOLD");

  COGS_CATS.forEach(({ key, label }, i) => {
    const r = 17 + i; // rows 17–21
    cell(ws, r, 1, `  ${label}`, { color: "FF333333", indent: 1 });
    cell(ws, r, 2, cogsByCat[key] ?? 0, { numFmt: MONEY, color: "FF0000FF" });
    cell(ws, r, 3, { formula: `IFERROR(B${r}/B14,0)` }, { numFmt: PCT, align: "right" });
  });

  totalRow(ws, 22, "TOTAL COGS", "SUM(B17:B21)", "IFERROR(B22/B14,0)");

  ws.getRow(23).height = 6;

  // ── Gross Profit (row 24) ─────────────────────────────────────────────────
  totalRow(ws, 24, "GROSS PROFIT", "B14-B22", "IFERROR(B24/B14,0)", FILL_GROSS);

  ws.getRow(25).height = 6;

  // ── LABOR section (rows 26–30) ────────────────────────────────────────────
  sectionHeader(ws, 26, "LABOR");

  const laborRows: [string, number][] = [
    ["  FOH Labor", totalFoh],
    ["  BOH Labor", totalBoh],
    ["  Management", totalMgmt],
  ];
  laborRows.forEach(([label, val], i) => {
    const r = 27 + i;
    cell(ws, r, 1, label, { color: "FF333333", indent: 1 });
    cell(ws, r, 2, val,   { numFmt: MONEY, color: "FF0000FF" });
    cell(ws, r, 3, { formula: `IFERROR(B${r}/B14,0)` }, { numFmt: PCT, align: "right" });
  });

  totalRow(ws, 30, "TOTAL LABOR", "SUM(B27:B29)", "IFERROR(B30/B14,0)");

  ws.getRow(31).height = 6;

  // ── Net Operating Income (row 32) ─────────────────────────────────────────
  totalRow(ws, 32, "NET OPERATING INCOME", "B24-B30", "IFERROR(B32/B14,0)", FILL_NOI);
  // Override font size for impact
  ws.getCell(32, 1).font = { name: FONT, bold: true, size: 12, color: { argb: "FF003399" } };
  ws.getCell(32, 2).font = { name: FONT, bold: true, size: 12, color: { argb: "FF003399" } };
  ws.getCell(32, 3).font = { name: FONT, bold: true, size: 12, color: { argb: "FF003399" } };

  ws.getRow(33).height = 6;

  // ── COGS % by Category (rows 34–39) ──────────────────────────────────────
  sectionHeader(ws, 34, "COGS % BY CATEGORY");

  COGS_CATS.forEach(({ label }, i) => {
    const dataRow = 17 + i;  // B17–B21 are the individual COGS values
    const r = 35 + i;
    cell(ws, r, 1, `  ${label}`, { color: "FF333333", indent: 1 });
    cell(ws, r, 2, { formula: `IFERROR(B${dataRow}/B14,0)` }, { numFmt: PCT });
    cell(ws, r, 3, "of revenue", { color: "FF888888", size: 10, italic: true });
  });

  // column header labels (above data area — add as top-of-data markers)
  cell(ws, 5, 2, "Amount",      { bold: true, align: "right", color: "FF555555" });
  cell(ws, 5, 3, "% of Rev",    { bold: true, align: "right", color: "FF555555" });

  // Freeze top rows
  ws.views = [{ state: "frozen", ySplit: 5, xSplit: 0 }];
}

// ── QuickBooks Sheet ──────────────────────────────────────────────────────────

function buildQBSheet(
  wb: ExcelJS.Workbook,
  opts: {
    startStr: string; endStr: string;
    salesByCat: Record<string, number>;
    cogsByCat:  Record<string, number>;
    totalFoh: number; totalBoh: number; totalMgmt: number;
  }
) {
  const ws = wb.addWorksheet("QuickBooks Import");

  ws.getColumn(1).width = 14;  // Date
  ws.getColumn(2).width = 36;  // Account
  ws.getColumn(3).width = 16;  // Debit
  ws.getColumn(4).width = 16;  // Credit
  ws.getColumn(5).width = 28;  // Memo

  const { startStr, endStr, salesByCat, cogsByCat, totalFoh, totalBoh, totalMgmt } = opts;
  const entryDate = fmtMMDDYYYY(toUTCDay(endStr));

  // Title
  cell(ws, 1, 1, "QUICKBOOKS JOURNAL IMPORT", { bold: true, size: 13 });
  cell(ws, 2, 1, `Period: ${fmtLong(startStr)} – ${fmtLong(endStr)}`, { italic: true, color: "FF555555" });
  cell(ws, 3, 1, "Paste this data into a QuickBooks journal entry or use File > Import.", {
    italic: true, size: 10, color: "FF888888",
  });

  // Column headers (row 5)
  const headers = ["Date", "Account", "Debit", "Credit", "Memo"];
  headers.forEach((h, i) => {
    const c = ws.getCell(5, i + 1);
    c.value = h;
    c.font  = { name: FONT, bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    c.fill  = FILL_DARK;
    c.alignment = { horizontal: i >= 2 ? "right" : "left" };
  });
  ws.getRow(5).height = 18;

  let row = 6;

  function qbRow(
    date: string,
    account: string,
    debit: ExcelJS.CellValue | null,
    credit: ExcelJS.CellValue | null,
    memo: string
  ) {
    cell(ws, row, 1, date,    { color: "FF333333" });
    cell(ws, row, 2, account, { color: "FF333333" });
    if (debit  !== null) cell(ws, row, 3, debit,  { numFmt: MONEY, align: "right", color: "FF0000FF" });
    if (credit !== null) cell(ws, row, 4, credit, { numFmt: MONEY, align: "right", color: "FF0000FF" });
    cell(ws, row, 5, memo, { color: "FF555555", italic: true, size: 10 });
    row++;
  }

  function blankRow() { row++; }
  function subHeader(label: string) {
    sectionHeader(ws, row, label, 5);
    row++;
  }

  // ── Revenue entries (credit sales accounts) ───────────────────────────────
  subHeader("REVENUE");
  // Revenue credits first
  SALE_CATS.forEach(({ qb, key }) => {
    const amt = salesByCat[key] ?? 0;
    if (amt > 0) qbRow(entryDate, qb, null, amt, "Weekly revenue entry");
  });
  // Debit cash/AR for total
  const totalSalesRow = row;
  qbRow(entryDate, "1000 · Undeposited Funds / Cash",
    { formula: `SUM(D6:D${totalSalesRow - 1})` }, null, "Net revenue offset");

  blankRow();

  // ── COGS entries (debit COGS accounts) ────────────────────────────────────
  subHeader("COST OF GOODS SOLD");
  const cogsStart = row;
  COGS_CATS.forEach(({ qb, key }) => {
    const amt = cogsByCat[key] ?? 0;
    if (amt > 0) qbRow(entryDate, qb, amt, null, "Weekly COGS entry");
  });
  const cogsEnd = row - 1;
  // Credit AP/Inventory for total COGS
  qbRow(entryDate, "2000 · Accounts Payable / Inventory",
    null, { formula: `SUM(C${cogsStart}:C${cogsEnd})` }, "Net COGS offset");

  blankRow();

  // ── Labor entries (debit labor expense accounts) ───────────────────────────
  subHeader("LABOR");
  const laborStart = row;
  if (totalFoh  > 0) qbRow(entryDate, "6010 · FOH Labor Expense",     totalFoh,  null, "Weekly labor");
  if (totalBoh  > 0) qbRow(entryDate, "6020 · BOH Labor Expense",     totalBoh,  null, "Weekly labor");
  if (totalMgmt > 0) qbRow(entryDate, "6030 · Management Expense",    totalMgmt, null, "Weekly labor");
  const laborEnd = row - 1;
  qbRow(entryDate, "2001 · Payroll Liabilities",
    null, { formula: `SUM(C${laborStart}:C${laborEnd})` }, "Net labor offset");

  blankRow();

  // Verification totals
  const verifyRow = row;
  cell(ws, verifyRow,     1, "VERIFY BALANCE", { bold: true, color: "FF333333" });
  cell(ws, verifyRow,     2, "Total Debits",   { bold: true });
  cell(ws, verifyRow,     3, { formula: `SUM(C6:C${verifyRow - 1})` }, { bold: true, numFmt: MONEY, align: "right" });
  cell(ws, verifyRow + 1, 2, "Total Credits",  { bold: true });
  cell(ws, verifyRow + 1, 4, { formula: `SUM(D6:D${verifyRow - 1})` }, { bold: true, numFmt: MONEY, align: "right" });
  cell(ws, verifyRow + 2, 2, "Difference (should be 0)", { italic: true, color: "FF555555" });
  cell(ws, verifyRow + 2, 3, { formula: `IFERROR(C${verifyRow}-D${verifyRow + 1},0)` },
    { bold: true, numFmt: MONEY, align: "right" });

  ws.views = [{ state: "frozen", ySplit: 5 }];
}

// ── Inventory Sheet ───────────────────────────────────────────────────────────

/** Canonical product category order for inventory exports. */
const PRODUCT_CATEGORIES = [
  "Perishable Food",
  "Dry Food",
  "Beverages",
  "Paper Goods",
  "Chemicals",
  "Office Supplies",
  "Miscellaneous",
] as const;

/** Dark teal fill for category group headers (distinct from column header). */
const FILL_CAT: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A4A38" } };
/** Light teal tint for every other data row. */
const ALT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F8F8" } };

function buildInventorySheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  products: Array<{
    name: string;
    category?: string | null;
    purveyor?: string | null;
    invoiceDate?: Date | null;
    unit: string;
    costPerUnit: number;
    currentStock: number;
  }>
) {
  const ws = wb.addWorksheet(sheetName);

  ws.getColumn(1).width = 14;  // Date
  ws.getColumn(2).width = 30;  // Product Name
  ws.getColumn(3).width = 24;  // Purveyor
  ws.getColumn(4).width = 10;  // Unit
  ws.getColumn(5).width = 14;  // Cost/Unit
  ws.getColumn(6).width = 12;  // Quantity
  ws.getColumn(7).width = 16;  // Total Cost

  // Title
  cell(ws, 1, 1, sheetName.toUpperCase(), { bold: true, size: 13 });
  cell(ws, 2, 1, `${products.length} item${products.length !== 1 ? "s" : ""}`,
    { italic: true, color: "FF555555", size: 10 });

  // Column headers (row 4)
  const COL_HEADERS = ["Date", "Product Name", "Purveyor", "Unit", "Cost / Unit", "Quantity", "Total Cost"];
  COL_HEADERS.forEach((h, i) => {
    const c = ws.getCell(4, i + 1);
    c.value = h;
    c.font  = { name: FONT, bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    c.fill  = FILL_DARK;
    c.alignment = { horizontal: i >= 4 ? "right" : "left" };
  });
  ws.getRow(4).height = 18;

  if (products.length === 0) {
    cell(ws, 5, 1, "No items found for this department.", { italic: true, color: "FF888888" });
    return;
  }

  // ── Group + sort ────────────────────────────────────────────────────────────
  // Bucket products into canonical categories; unknown categories → "Other"
  const grouped = new Map<string, typeof products>();
  const orderedKeys = [...PRODUCT_CATEGORIES, "Other"] as string[];

  for (const p of products) {
    const cat = (p.category && (PRODUCT_CATEGORIES as readonly string[]).includes(p.category))
      ? p.category
      : "Other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(p);
  }
  // Sort alphabetically within each group
  for (const grp of grouped.values()) {
    grp.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Render rows ─────────────────────────────────────────────────────────────
  let row = 5;
  const allStart = row; // for grand-total SUM range

  for (const cat of orderedKeys) {
    const grp = grouped.get(cat);
    if (!grp || grp.length === 0) continue;

    // Category header row ─────────────────────────────────────────────────────
    for (let c = 1; c <= 7; c++) {
      ws.getCell(row, c).fill = FILL_CAT;
      ws.getCell(row, c).font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    }
    ws.getCell(row, 1).value = cat.toUpperCase();
    ws.getCell(row, 6).value = `${grp.length} item${grp.length !== 1 ? "s" : ""}`;
    ws.getCell(row, 6).alignment = { horizontal: "right" };
    ws.getCell(row, 6).font = { name: FONT, italic: true, color: { argb: "FFAADDBB" }, size: 10 };
    ws.getRow(row).height = 16;
    row++;

    // Product rows ─────────────────────────────────────────────────────────────
    grp.forEach((p, i) => {
      const isAlt = i % 2 === 1;
      const fill  = isAlt ? ALT_FILL : undefined;

      cell(ws, row, 1, fmtMMDDYYYY(p.invoiceDate), { color: "FF555555", ...(fill ? { fill } : {}) });
      cell(ws, row, 2, p.name,            { color: "FF1F1F1F", ...(fill ? { fill } : {}) });
      cell(ws, row, 3, p.purveyor ?? "—", { color: "FF555555", ...(fill ? { fill } : {}) });
      cell(ws, row, 4, p.unit,            { color: "FF555555", ...(fill ? { fill } : {}) });
      cell(ws, row, 5, p.costPerUnit,
        { numFmt: MONEY, align: "right", color: "FF0000FF", ...(fill ? { fill } : {}) });
      cell(ws, row, 6, p.currentStock,
        { numFmt: "#,##0.##", align: "right", color: "FF0000FF", ...(fill ? { fill } : {}) });

      // Total Cost formula — SUM naturally skips text in category header rows
      const tc = ws.getCell(row, 7);
      tc.value = { formula: `E${row}*F${row}` };
      tc.numFmt = MONEY;
      tc.font   = { name: FONT, color: { argb: "FF000000" }, size: 11 };
      tc.alignment = { horizontal: "right" };
      if (fill) tc.fill = fill;

      row++;
    });
  }

  const allEnd = row - 1;

  // Grand-total row ────────────────────────────────────────────────────────────
  // SUM over the full range — category header rows have no numbers so they're
  // safely skipped by Excel's SUM function.
  [1, 2, 3, 4, 5, 6, 7].forEach((c) => {
    ws.getCell(row, c).fill = FILL_TOTAL;
    ws.getCell(row, c).font = { name: FONT, bold: true, color: { argb: "FF000000" }, size: 11 };
  });
  cell(ws, row, 1, "TOTAL", { bold: true, fill: FILL_TOTAL });
  cell(ws, row, 6, { formula: `SUM(F${allStart}:F${allEnd})` },
    { bold: true, numFmt: "#,##0.##", align: "right", fill: FILL_TOTAL });
  cell(ws, row, 7, { formula: `SUM(G${allStart}:G${allEnd})` },
    { bold: true, numFmt: MONEY, align: "right", fill: FILL_TOTAL });

  ws.views = [{ state: "frozen", ySplit: 4 }];
}

// ── Main export handler ───────────────────────────────────────────────────────

export async function exportXlsx(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const startStr = typeof req.query.start === "string" ? req.query.start : "";
    const endStr   = typeof req.query.end   === "string" ? req.query.end   : "";

    if (!dateSchema.safeParse(startStr).success || !dateSchema.safeParse(endStr).success) {
      return res.status(400).json({ error: "Provide valid start and end params (YYYY-MM-DD)" });
    }

    const startDay = toUTCDay(startStr);
    const endDayInclusive = toUTCDay(endStr);
    const endDayExclusive = addDays(endDayInclusive, 1);
    const rid = req.user.restaurantId;

    // Fetch all needed data in parallel
    const [salesEntries, laborEntries, stockLogs, products] = await Promise.all([
      prisma.salesEntry.findMany({
        where: { restaurantId: rid, date: { gte: startDay, lte: endDayInclusive } },
      }),
      (prisma as any).laborEntry.findMany({
        where: { restaurantId: rid, date: { gte: startDay, lte: endDayInclusive } },
      }) as Promise<Array<{ fohLabor: number; bohLabor: number; management: number }>>,
      prisma.stockLog.findMany({
        where: {
          timestamp: { gte: startDay, lt: endDayExclusive },
          product: { restaurantId: rid },
          reason: { in: [StockReason.USED, StockReason.WASTE] },
        },
        include: {
          product: { select: { cogsCategory: { select: { name: true } }, costPerUnit: true } },
        },
      }),
      prisma.product.findMany({
        where: { restaurantId: rid },
        orderBy: [{ department: "asc" }, { name: "asc" }],
      }),
    ]);

    // Aggregate sales by category
    const salesByCat: Record<string, number> = {};
    for (const e of salesEntries) {
      salesByCat[e.category] = (salesByCat[e.category] ?? 0) + Number(e.amount);
    }

    // Aggregate COGS by cogsCategory
    const cogsByCat: Record<string, number> = {};
    for (const log of stockLogs) {
      const cat = log.product?.cogsCategory?.name;
      if (!cat) continue;
      cogsByCat[cat] = (cogsByCat[cat] ?? 0) + Math.abs(log.change) * (log.unitCost ?? log.product?.costPerUnit ?? 0);
    }

    // Aggregate labor
    const totalFoh  = laborEntries.reduce((s, e) => s + e.fohLabor,   0);
    const totalBoh  = laborEntries.reduce((s, e) => s + e.bohLabor,   0);
    const totalMgmt = laborEntries.reduce((s, e) => s + e.management, 0);

    // Build workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "Kyru Advisory";
    wb.created = new Date();

    buildPLSheet(wb, { startStr, endStr, salesByCat, cogsByCat, totalFoh, totalBoh, totalMgmt });
    buildQBSheet(wb, { startStr, endStr, salesByCat, cogsByCat, totalFoh, totalBoh, totalMgmt });
    // Cast department to string — Prisma client hasn't regenerated after adding BAR
    const dept = (p: { department: unknown }) => p.department as string;
    buildInventorySheet(wb, "Kitchen Inventory", products.filter((p) => dept(p) === "BOH"));
    buildInventorySheet(wb, "Bar Inventory",     products.filter((p) => dept(p) === "BAR"));
    buildInventorySheet(wb, "FOH Inventory",     products.filter((p) => dept(p) === "FOH"));

    const buffer = await wb.xlsx.writeBuffer();

    res.setHeader("Content-Type",        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="kyru-report-${startStr}-to-${endStr}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
}
