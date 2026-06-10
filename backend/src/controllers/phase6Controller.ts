import { Response, NextFunction } from "express";
import ExcelJS from "exceljs";
import { prismaAdmin as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";
import { withCache, TTL_FINANCIAL } from "../lib/cache";
import { keyOwnerPnl, keyOwnerPnlSummary } from "../lib/cacheKeys";

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseDate(str: string): Date {
  return new Date(`${str}T00:00:00Z`);
}

function parseDateEnd(str: string): Date {
  return new Date(`${str}T23:59:59Z`);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDateParams(
  qStart: unknown,
  qEnd:   unknown
): { from: Date; to: Date; startStr: string; endStr: string } | { error: string } {
  if (typeof qStart !== "string" || typeof qEnd !== "string") {
    return { error: "startDate and endDate are required (YYYY-MM-DD)" };
  }

  const startStr = qStart.trim();
  const endStr   = qEnd.trim();

  if (!ISO_DATE_RE.test(startStr) || !ISO_DATE_RE.test(endStr)) {
    return { error: `startDate and endDate must be YYYY-MM-DD (received: "${startStr}", "${endStr}")` };
  }

  const from = parseDate(startStr);
  const to   = parseDateEnd(endStr);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { error: `Could not parse dates (received: "${startStr}", "${endStr}")` };
  }
  if (to < from) {
    return { error: "endDate must be >= startDate" };
  }
  return { from, to, startStr, endStr };
}

// ── P&L calculation per restaurant ───────────────────────────────────────────

const r2 = (v: number) => Math.round(v * 100) / 100;

function safePct(numerator: number, denominator: number): number {
  return denominator > 0 ? r2((numerator / denominator) * 100) : 0;
}

async function computePnL(restaurantId: string, from: Date, to: Date) {
  const [salesRows, laborRows, orderRows] = await Promise.all([
    // Revenue: all SalesEntry in range
    prisma.salesEntry.findMany({
      where:  { restaurantId, date: { gte: from, lte: to } },
      select: { amount: true },
    }),
    // Labor cost: LaborEntry in range
    prisma.laborEntry.findMany({
      where:  { restaurantId, date: { gte: from, lte: to } },
      select: { total: true },
    }),
    // Food cost: RECEIVED orders — filter by deliveredAt if set, else createdAt
    prisma.order.findMany({
      where: {
        restaurantId,
        status: "RECEIVED",
        OR: [
          { deliveredAt: { not: null, gte: from, lte: to } },
          { deliveredAt: null,     createdAt: { gte: from, lte: to } },
        ],
      },
      select: { totalCost: true },
    }),
  ]);

  const revenue   = r2(salesRows.reduce((s, e) => s + parseFloat(String(e.amount)), 0));
  const foodCost  = r2(orderRows.reduce((s, o) => s + o.totalCost, 0));
  const laborCost = r2(laborRows.reduce((s, e) => s + Number(e.total), 0));
  const primeCost = r2(foodCost + laborCost);
  const grossProfit = r2(revenue - primeCost);

  return {
    revenue,
    foodCost,
    laborCost,
    primeCost,
    grossProfit,
    foodCostPct:   safePct(foodCost,   revenue),
    laborCostPct:  safePct(laborCost,  revenue),
    primeCostPct:  safePct(primeCost,  revenue),
    grossProfitPct: safePct(grossProfit, revenue),
  };
}

// ── ENDPOINT 1: GET /api/owner/pnl ───────────────────────────────────────────

export async function getOwnerPnl(req: AuthRequest, res: Response, next: NextFunction) {
  const start = Date.now();
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";

    console.log("[getOwnerPnl] raw req.query:", JSON.stringify(req.query));
    const dateResult = validateDateParams(req.query.startDate, req.query.endDate);
    if ("error" in dateResult) return res.status(400).json({ error: dateResult.error });
    const { from, to, startStr: startDate, endStr: endDate } = dateResult;

    logger.debug("getOwnerPnl: entry", { userId: req.user.userId, ownerAccountId, startDate, endDate });

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true, address: true },
      orderBy: { name: "asc" },
    });

    if (restaurants.length === 0) {
      return res.status(404).json({ error: "No locations found for this owner account" });
    }

    const cacheKey = keyOwnerPnl(ownerAccountId, startDate, endDate);
    const payload  = await withCache(cacheKey, TTL_FINANCIAL, async () => {
      // Compute P&L for every location in parallel
      const locationPnL = await Promise.all(
        restaurants.map(async (r) => {
          const pnl = await computePnL(r.id, from, to);
          return { restaurant: { id: r.id, name: r.name, address: r.address }, ...pnl };
        })
      );

      const sorted = [...locationPnL].sort((a, b) => a.primeCostPct - b.primeCostPct);
      const ranked = sorted.map((loc, i) => ({ ...loc, rank: i + 1 }));

      const revenue     = r2(ranked.reduce((s, l) => s + l.revenue,   0));
      const foodCost    = r2(ranked.reduce((s, l) => s + l.foodCost,  0));
      const laborCost   = r2(ranked.reduce((s, l) => s + l.laborCost, 0));
      const primeCost   = r2(foodCost + laborCost);
      const grossProfit = r2(revenue - primeCost);

      const consolidated = {
        revenue, foodCost, laborCost, primeCost, grossProfit,
        foodCostPct:    safePct(foodCost,    revenue),
        laborCostPct:   safePct(laborCost,   revenue),
        primeCostPct:   safePct(primeCost,   revenue),
        grossProfitPct: safePct(grossProfit, revenue),
      };

      const withData     = ranked.filter((l) => l.revenue > 0);
      const best         = withData.length > 0 ? withData[0].restaurant.name                   : "";
      const worst        = withData.length > 0 ? withData[withData.length - 1].restaurant.name : "";
      const mostRevenue  = withData.length > 0
        ? withData.reduce((a, b) => b.revenue > a.revenue ? b : a).restaurant.name : "";

      return { period: { startDate, endDate }, consolidated, locations: ranked, ranking: { best, worst, mostRevenue } };
    });

    logger.debug("getOwnerPnl: success", {
      userId: req.user.userId, ownerAccountId,
      locationCount: restaurants.length,
      durationMs:    Date.now() - start,
    });

    res.json(payload);
  } catch (err) {
    logger.error("getOwnerPnl: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}

// ── ENDPOINT 2: GET /api/owner/pnl/summary ───────────────────────────────────

export async function getOwnerPnlSummary(req: AuthRequest, res: Response, next: NextFunction) {
  const start = Date.now();
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";

    console.log("[getOwnerPnlSummary] raw req.query:", JSON.stringify(req.query));
    const dateResult = validateDateParams(req.query.startDate, req.query.endDate);
    if ("error" in dateResult) return res.status(400).json({ error: dateResult.error });
    const { from, to, startStr: startDate, endStr: endDate } = dateResult;

    logger.debug("getOwnerPnlSummary: entry", { userId: req.user.userId, ownerAccountId, startDate, endDate });

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true },
      orderBy: { name: "asc" },
    });

    if (restaurants.length === 0) {
      return res.status(404).json({ error: "No locations found for this owner account" });
    }

    const cacheKey = keyOwnerPnlSummary(ownerAccountId, startDate, endDate);
    const payload  = await withCache(cacheKey, TTL_FINANCIAL, async () => {
      const locationPnL = await Promise.all(
        restaurants.map(async (r) => {
          const pnl = await computePnL(r.id, from, to);
          return { name: r.name, ...pnl };
        })
      );

      const revenue     = r2(locationPnL.reduce((s, l) => s + l.revenue,   0));
      const primeCost   = r2(locationPnL.reduce((s, l) => s + l.primeCost, 0));
      const grossProfit = r2(revenue - primeCost);

      const withData      = locationPnL.filter((l) => l.revenue > 0);
      const sorted        = [...withData].sort((a, b) => a.primeCostPct - b.primeCostPct);
      const bestLocation  = sorted.length > 0 ? sorted[0].name                  : "";
      const worstLocation = sorted.length > 0 ? sorted[sorted.length - 1].name  : "";

      return {
        period:         { startDate, endDate },
        totalRevenue:   revenue,
        totalPrimeCost: primeCost,
        primeCostPct:   safePct(primeCost, revenue),
        grossProfit,
        grossProfitPct: safePct(grossProfit, revenue),
        bestLocation,
        worstLocation,
        locationCount:  restaurants.length,
      };
    });

    logger.debug("getOwnerPnlSummary: success", {
      userId: req.user.userId, ownerAccountId,
      durationMs: Date.now() - start,
    });

    res.json(payload);
  } catch (err) {
    logger.error("getOwnerPnlSummary: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}

// ── ENDPOINT 3: GET /api/owner/pnl/export ────────────────────────────────────

// ── xlsx formatting helpers ───────────────────────────────────────────────────

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function fmtDateDisplay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function argb(hex: string): { argb: string } {
  const clean = hex.replace("#", "");
  return { argb: clean.length === 8 ? clean : `FF${clean}` };
}

function solidFill(hex: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: argb(hex) };
}

function thinBorder(hex = "E5E7EB"): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: "thin", color: argb(hex) };
  return { top: side, bottom: side, left: side, right: side };
}

/** Return ARGB color for Food Cost % */
function foodPctColor(pct: number): string {
  return pct > 35 ? "dc2626" : pct > 30 ? "d97706" : "1a1a1a";
}
/** Return ARGB color for Labor Cost % */
function laborPctColor(pct: number): string {
  return pct > 45 ? "dc2626" : pct > 35 ? "d97706" : "1a1a1a";
}
/** Return ARGB color for Prime Cost % */
function primePctColor(pct: number): string {
  return pct > 70 ? "dc2626" : pct > 60 ? "d97706" : "1a1a1a";
}
/** Return ARGB color for Gross Profit % */
function grossPctColor(pct: number): string {
  return pct >= 35 ? "16a34a" : pct >= 20 ? "d97706" : "dc2626";
}

interface SheetPnL {
  revenue: number; foodCost: number; laborCost: number; primeCost: number;
  grossProfit: number; foodCostPct: number; laborCostPct: number;
  primeCostPct: number; grossProfitPct: number;
}

/** Populate a sheet with professional P&L formatting. */
function fillSheet(
  sheet:        ExcelJS.Worksheet,
  ownerName:    string,
  startDate:    string,
  endDate:      string,
  pnl:          SheetPnL,
  options: {
    locationName?: string;  // per-location sheets
    rankLine?:     string;  // e.g. "#1 of 3"
    ranking?:      { best: string; worst: string; mostRevenue: string };
    tabColor?:     string;  // 6-char hex
  } = {}
) {
  const { locationName, rankLine, ranking, tabColor } = options;

  // ── Sheet properties ────────────────────────────────────────────────────────
  if (tabColor) sheet.properties.tabColor = argb(tabColor);

  sheet.columns = [
    { key: "a", width: 28 },
    { key: "b", width: 22 },
    { key: "c", width: 14 },
  ];

  sheet.pageSetup = {
    orientation:  "landscape",
    fitToPage:    true,
    fitToWidth:   1,
    fitToHeight:  0,
  };

  // ── Header section (rows 1–4) ───────────────────────────────────────────────

  // Row 1: Owner name
  const r1 = sheet.addRow([ownerName, "", ""]);
  r1.getCell(1).font      = { bold: true, size: 16, color: argb("1a1a1a") };
  r1.getCell(1).alignment = { vertical: "middle" };
  sheet.mergeCells(`A${r1.number}:C${r1.number}`);

  // Row 2: Report title or location name
  const row2Label = locationName ? `Location: ${locationName}` : "P&L Report";
  const r2 = sheet.addRow([row2Label, "", ""]);
  r2.getCell(1).font = { bold: true, size: 12, color: argb("555555") };
  sheet.mergeCells(`A${r2.number}:C${r2.number}`);

  // Row 3: Rank (location) or Period (consolidated)
  if (locationName && rankLine) {
    const r3 = sheet.addRow([`Rank: ${rankLine}`, "", ""]);
    r3.getCell(1).font = { size: 11, color: argb("777777") };
    sheet.mergeCells(`A${r3.number}:C${r3.number}`);

    // Row 4: Period
    const r4 = sheet.addRow([`Period: ${fmtDateDisplay(startDate)} – ${fmtDateDisplay(endDate)}`, "", ""]);
    r4.getCell(1).font = { size: 11, color: argb("777777") };
    sheet.mergeCells(`A${r4.number}:C${r4.number}`);
  } else {
    // Row 3: Period
    const r3 = sheet.addRow([`Period: ${fmtDateDisplay(startDate)} – ${fmtDateDisplay(endDate)}`, "", ""]);
    r3.getCell(1).font = { size: 11, color: argb("777777") };
    sheet.mergeCells(`A${r3.number}:C${r3.number}`);

    // Row 4: blank separator
    sheet.addRow(["", "", ""]);
  }

  // ── Row 5: Column header ────────────────────────────────────────────────────
  const headerRow = sheet.addRow(["Metric", "Value", "%"]);
  headerRow.eachCell((cell) => {
    cell.font      = { bold: true, size: 11, color: argb("FFFFFF") };
    cell.fill      = solidFill("2d6a4f");
    cell.border    = { bottom: { style: "medium", color: argb("1a1a1a") } };
    cell.alignment = { vertical: "middle" };
  });

  // Freeze rows 1–5
  sheet.views = [{ state: "frozen", ySplit: 5, xSplit: 0, topLeftCell: "A6", activeCell: "A6" }];

  // ── Data rows (rows 6+) ─────────────────────────────────────────────────────

  let dataIdx = 0;  // alternating background counter

  function dataRow(
    metric:   string,
    value:    string,
    pctStr:   string,
    opts: {
      bold?:      boolean;
      size?:      number;
      fontHex?:   string;
      pctHex?:    string;
      italic?:    boolean;
      noBg?:      boolean;
    } = {}
  ) {
    const row = sheet.addRow([metric, value, pctStr]);
    const bg  = opts.noBg
      ? undefined
      : (dataIdx % 2 === 0 ? "FFFFFF" : "F9FAFB");

    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (bg) cell.fill = solidFill(bg);
      cell.border = thinBorder();
      cell.font   = {
        size:   opts.size   ?? 11,
        bold:   opts.bold   ?? false,
        italic: opts.italic ?? false,
        color:  argb(col === 3 && opts.pctHex ? opts.pctHex : (opts.fontHex ?? "1a1a1a")),
      };
    });

    dataIdx++;
    return row;
  }

  // Revenue
  dataRow("Revenue", fmtUSD(pnl.revenue), "—", { bold: true, size: 12 });

  // Food Cost
  dataRow("Food Cost", fmtUSD(pnl.foodCost), `${pnl.foodCostPct.toFixed(1)}%`,
    { pctHex: foodPctColor(pnl.foodCostPct) });

  // Labor Cost
  dataRow("Labor Cost", fmtUSD(pnl.laborCost), `${pnl.laborCostPct.toFixed(1)}%`,
    { pctHex: laborPctColor(pnl.laborCostPct) });

  // Prime Cost
  dataRow("Prime Cost", fmtUSD(pnl.primeCost), `${pnl.primeCostPct.toFixed(1)}%`,
    { bold: true, pctHex: primePctColor(pnl.primeCostPct) });

  // Blank separator (no bg, no border)
  sheet.addRow(["", "", ""]);

  // Gross Profit
  const gpHex  = pnl.grossProfit >= 0 ? "16a34a" : "dc2626";
  const gpPHex = grossPctColor(pnl.grossProfitPct);
  dataRow("Gross Profit", fmtUSD(pnl.grossProfit), `${pnl.grossProfitPct.toFixed(1)}%`,
    { bold: true, size: 12, fontHex: gpHex, pctHex: gpPHex });

  // Ranking section (consolidated only)
  if (ranking) {
    sheet.addRow(["", "", ""]);

    const rankLabel = sheet.addRow(["Profitability Ranking", "", ""]);
    rankLabel.getCell(1).font  = { bold: true, italic: true, size: 11, color: argb("555555") };
    rankLabel.getCell(1).fill  = solidFill("FFFFFF");

    dataRow("Best Performer",    ranking.best,        "—");
    dataRow("Needs Improvement", ranking.worst,       "—");
    dataRow("Most Revenue",      ranking.mostRevenue, "—");
  }
}

export async function exportOwnerPnl(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";

    console.log("[exportOwnerPnl] raw req.query:", JSON.stringify(req.query));
    const dateResult = validateDateParams(req.query.startDate, req.query.endDate);
    if ("error" in dateResult) return res.status(400).json({ error: dateResult.error });
    const { from, to, startStr: startDate, endStr: endDate } = dateResult;

    logger.debug("exportOwnerPnl: entry", { userId: req.user.userId, ownerAccountId, startDate, endDate });

    const [ownerAccount, restaurants] = await Promise.all([
      prisma.ownerAccount.findUnique({ where: { id: ownerAccountId }, select: { name: true } }),
      prisma.restaurant.findMany({
        where:   { ownerAccountId },
        select:  { id: true, name: true, address: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const ownerName = ownerAccount?.name ?? "Kyru";

    if (restaurants.length === 0) {
      return res.status(404).json({ error: "No locations found" });
    }

    const locationPnL = await Promise.all(
      restaurants.map(async (r) => {
        const pnl = await computePnL(r.id, from, to);
        return { restaurant: r, ...pnl };
      })
    );

    // Sort by primeCostPct ascending for ranking
    const sorted = [...locationPnL].sort((a, b) => a.primeCostPct - b.primeCostPct);

    // Consolidated
    const revenue     = r2(locationPnL.reduce((s, l) => s + l.revenue,   0));
    const foodCost    = r2(locationPnL.reduce((s, l) => s + l.foodCost,  0));
    const laborCost   = r2(locationPnL.reduce((s, l) => s + l.laborCost, 0));
    const primeCost   = r2(foodCost + laborCost);
    const grossProfit = r2(revenue - primeCost);

    const consolidated = {
      revenue, foodCost, laborCost, primeCost, grossProfit,
      foodCostPct:    safePct(foodCost,    revenue),
      laborCostPct:   safePct(laborCost,   revenue),
      primeCostPct:   safePct(primeCost,   revenue),
      grossProfitPct: safePct(grossProfit, revenue),
    };

    const withData   = sorted.filter((l) => l.revenue > 0);
    const best        = withData.length > 0 ? withData[0].restaurant.name                   : "—";
    const worst       = withData.length > 0 ? withData[withData.length - 1].restaurant.name : "—";
    const mostRevenue = withData.length > 0
      ? withData.reduce((a, b) => b.revenue > a.revenue ? b : a).restaurant.name
      : "—";

    // ── Build workbook ────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = "Kyru";
    wb.modified = new Date();

    // Sheet 1: Consolidated
    const consolidatedSheet = wb.addWorksheet("Consolidated");
    fillSheet(consolidatedSheet, ownerName, startDate, endDate, consolidated, {
      ranking:  { best, worst, mostRevenue },
      tabColor: "16a34a",
    });

    // Sheets 2+: one per location
    sorted.forEach((loc, idx) => {
      const sheetName = loc.restaurant.name.slice(0, 31); // Excel tab name limit
      const sheet = wb.addWorksheet(sheetName);
      fillSheet(sheet, ownerName, startDate, endDate, {
        revenue:        loc.revenue,
        foodCost:       loc.foodCost,
        laborCost:      loc.laborCost,
        primeCost:      loc.primeCost,
        grossProfit:    loc.grossProfit,
        foodCostPct:    loc.foodCostPct,
        laborCostPct:   loc.laborCostPct,
        primeCostPct:   loc.primeCostPct,
        grossProfitPct: loc.grossProfitPct,
      }, {
        locationName: loc.restaurant.name,
        rankLine:     `#${idx + 1} of ${sorted.length}`,
        tabColor:     "2563eb",
      });
    });

    // ── Stream to response ────────────────────────────────────────────────────
    const filename = `pnl-${startDate}-to-${endDate}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();

    logger.debug("exportOwnerPnl: success", {
      userId: req.user.userId, ownerAccountId, startDate, endDate,
      locationCount: restaurants.length,
    });
  } catch (err) {
    logger.error("exportOwnerPnl: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}
