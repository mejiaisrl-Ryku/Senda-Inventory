import { Response, NextFunction } from "express";
import { z } from "zod";
import { SalesCategory } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

function toUTCDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function todayISO(): string {
  return toISODate(new Date());
}

function csvEscape(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ── GET /reports/daily?date=YYYY-MM-DD ───────────────────────────────────────
export async function getDailyReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const dateStr = typeof req.query.date === "string" ? req.query.date : todayISO();
    const parsed = dateSchema.safeParse(dateStr);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const start = toUTCDay(dateStr);
    const end = addDays(start, 1);

    const [logs, products] = await Promise.all([
      prisma.stockLog.findMany({
        where: {
          timestamp: { gte: start, lt: end },
          product: { restaurantId: req.user.restaurantId },
        },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          user: { select: { id: true, email: true } },
        },
        orderBy: { timestamp: "desc" },
      }),
      prisma.product.findMany({ where: { restaurantId: req.user.restaurantId } }),
    ]);

    const sum = (reason: string) =>
      logs.filter((l) => l.reason === reason).reduce((s, l) => s + Math.abs(l.change), 0);

    const inventoryValue = products.reduce((s, p) => s + p.currentStock * p.costPerUnit, 0);
    const lowItems = products.filter((p) => p.currentStock < p.minimumStock);

    res.json({
      date: dateStr,
      received: Math.round(sum("RECEIVED") * 1000) / 1000,
      used: Math.round(sum("USED") * 1000) / 1000,
      waste: Math.round(sum("WASTE") * 1000) / 1000,
      adjusted: Math.round(sum("ADJUSTED") * 1000) / 1000,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      lowItemsCount: lowItems.length,
      lowItems,
      logs,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /reports/weekly?endDate=YYYY-MM-DD&startDate=YYYY-MM-DD ──────────────
// startDate is optional — defaults to endDate - 6 (7-day window, old behaviour)
export async function getWeeklyReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const endStr = typeof req.query.endDate === "string" ? req.query.endDate : todayISO();
    const parsed = dateSchema.safeParse(endStr);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const endDay = toUTCDay(endStr);
    const endExclusive = addDays(endDay, 1);

    // Allow explicit startDate override so the frontend can request any range
    const startStr =
      typeof req.query.startDate === "string" && dateSchema.safeParse(req.query.startDate).success
        ? req.query.startDate
        : toISODate(addDays(endDay, -6)); // default: 7-day window
    const startDay = toUTCDay(startStr);

    const [logs, products] = await Promise.all([
      prisma.stockLog.findMany({
        where: {
          timestamp: { gte: startDay, lt: endExclusive },
          product: { restaurantId: req.user.restaurantId },
        },
        include: {
          product: { select: { id: true, name: true, unit: true, costPerUnit: true } },
        },
        orderBy: { timestamp: "asc" },
      }),
      prisma.product.findMany({ where: { restaurantId: req.user.restaurantId } }),
    ]);

    // Day-by-day breakdown (dynamic length based on date range)
    const diffMs = endDay.getTime() - startDay.getTime();
    const numDays = Math.round(diffMs / 86_400_000) + 1; // inclusive
    const days = Array.from({ length: numDays }, (_, i) => {
      const day = addDays(startDay, i);
      const dayEnd = addDays(day, 1);
      const dayLogs = logs.filter((l) => l.timestamp >= day && l.timestamp < dayEnd);
      const sum = (reason: string) =>
        dayLogs.filter((l) => l.reason === reason).reduce((s, l) => s + Math.abs(l.change), 0);
      return {
        date: toISODate(day),
        received: Math.round(sum("RECEIVED") * 1000) / 1000,
        used: Math.round(sum("USED") * 1000) / 1000,
        waste: Math.round(sum("WASTE") * 1000) / 1000,
      };
    });

    // Most used products (by sum of |change| where reason = USED), top 10
    const usageMap = new Map<string, { productId: string; productName: string; totalUsed: number; unit: string }>();
    for (const log of logs) {
      if (log.reason !== "USED") continue;
      const entry = usageMap.get(log.productId) ?? {
        productId: log.productId,
        productName: log.product?.name ?? log.productId,
        totalUsed: 0,
        unit: log.product?.unit ?? "PIECES",
      };
      entry.totalUsed += Math.abs(log.change);
      usageMap.set(log.productId, entry);
    }
    const mostUsed = [...usageMap.values()]
      .sort((a, b) => b.totalUsed - a.totalUsed)
      .slice(0, 10)
      .map((e) => ({ ...e, totalUsed: Math.round(e.totalUsed * 1000) / 1000 }));

    const inventoryValue = products.reduce((s, p) => s + p.currentStock * p.costPerUnit, 0);
    const lowItems = products.filter((p) => p.currentStock < p.minimumStock);

    const totalOf = (key: "received" | "used" | "waste") =>
      Math.round(days.reduce((s, d) => s + d[key], 0) * 1000) / 1000;

    res.json({
      startDate: startStr,
      endDate: endStr,
      days,
      mostUsed,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      lowItemsCount: lowItems.length,
      totalReceived: totalOf("received"),
      totalUsed: totalOf("used"),
      totalWaste: totalOf("waste"),
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /reports/export?format=csv&start=YYYY-MM-DD&end=YYYY-MM-DD ──────────
export async function exportReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const startStr = typeof req.query.start === "string" ? req.query.start : toISODate(addDays(new Date(), -6));
    const endStr = typeof req.query.end === "string" ? req.query.end : todayISO();

    if (!dateSchema.safeParse(startStr).success) return res.status(400).json({ error: "Invalid start date" });
    if (!dateSchema.safeParse(endStr).success) return res.status(400).json({ error: "Invalid end date" });

    const start = toUTCDay(startStr);
    const end = addDays(toUTCDay(endStr), 1);

    const logs = await prisma.stockLog.findMany({
      where: {
        timestamp: { gte: start, lt: end },
        product: { restaurantId: req.user.restaurantId },
      },
      include: {
        product: { select: { name: true, sku: true, unit: true } },
        user: { select: { email: true } },
      },
      orderBy: { timestamp: "desc" },
    });

    const headers = ["Date", "Product", "SKU", "Unit", "Reason", "Change", "Previous Stock", "New Stock", "User", "Notes"];
    const rows = logs.map((l) => [
      new Date(l.timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC",
      l.product?.name ?? l.productId,
      l.product?.sku ?? "",
      l.product?.unit ?? "",
      l.reason,
      l.change,
      l.previousQuantity,
      l.newQuantity,
      l.user?.email ?? l.userId,
      l.notes ?? "",
    ]);

    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="stock-report-${startStr}-to-${endStr}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

// ── GET /reports/cogs-to-sales?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD ───────
//
// Returns COGS (from stock usage logs) vs sales revenue, grouped by week and
// category. COGS is derived from StockLog entries with reason USED or WASTE,
// multiplied by the product's costPerUnit and bucketed by product.cogsCategory.
// Products with no cogsCategory set are excluded from COGS totals.

const ALL_CATEGORIES = Object.values(SalesCategory) as SalesCategory[];

/** Return the ISO date (YYYY-MM-DD) of the Monday on or before the given date. */
function weekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sun
  const daysToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  return d.toISOString().slice(0, 10);
}

/** Generate every Monday key from the week containing startDate through endDate. */
function weeksInRange(start: Date, end: Date): string[] {
  const weeks: string[] = [];
  const cursor = new Date(start);
  // Snap cursor back to Monday
  const day = cursor.getUTCDay();
  cursor.setUTCDate(cursor.getUTCDate() - (day === 0 ? 6 : day - 1));
  while (cursor <= end) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeRatio(cogs: number, sales: number): number | null {
  return sales > 0 ? round2(cogs / sales) : null;
}

export async function getCogsToSales(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const startStr = typeof req.query.startDate === "string" ? req.query.startDate : null;
    const endStr = typeof req.query.endDate === "string" ? req.query.endDate : null;

    if (!startStr || !dateSchema.safeParse(startStr).success) {
      return res.status(400).json({ error: "startDate is required (YYYY-MM-DD)" });
    }
    if (!endStr || !dateSchema.safeParse(endStr).success) {
      return res.status(400).json({ error: "endDate is required (YYYY-MM-DD)" });
    }

    const start = toUTCDay(startStr);
    const endInclusive = toUTCDay(endStr);
    const endExclusive = addDays(endInclusive, 1); // for timestamp-based queries

    const restaurantId = req.user.restaurantId;

    // Fetch sales entries and stock usage logs in parallel
    const [salesEntries, stockLogs] = await Promise.all([
      prisma.salesEntry.findMany({
        where: {
          restaurantId,
          date: { gte: start, lte: endInclusive }, // @db.Date — inclusive lte is correct
        },
      }),
      prisma.stockLog.findMany({
        where: {
          reason: { in: ["USED", "WASTE"] },
          timestamp: { gte: start, lt: endExclusive },
          product: { restaurantId },
        },
        include: {
          product: { select: { cogsCategory: true, costPerUnit: true } },
        },
      }),
    ]);

    // ── Accumulators ──────────────────────────────────────────────────────────

    type Bucket = { sales: number; cogs: number };

    const zeroBuckets = () =>
      Object.fromEntries(ALL_CATEGORIES.map((c) => [c, { sales: 0, cogs: 0 }]));

    // dayKey (YYYY-MM-DD) → category → Bucket
    const dayMap = new Map<string, Record<string, Bucket>>();
    // weekKey (YYYY-MM-DD of Monday) → category → Bucket
    const weekMap = new Map<string, Record<string, Bucket>>();
    // category → Bucket  (period totals)
    const categoryTotals: Record<string, Bucket> = zeroBuckets();

    function getDayBucket(dk: string): Record<string, Bucket> {
      if (!dayMap.has(dk)) dayMap.set(dk, zeroBuckets());
      return dayMap.get(dk)!;
    }
    function getWeekBucket(wk: string): Record<string, Bucket> {
      if (!weekMap.has(wk)) weekMap.set(wk, zeroBuckets());
      return weekMap.get(wk)!;
    }

    // Accumulate sales — bucket by day and week
    for (const entry of salesEntries) {
      const dk = entry.date.toISOString().slice(0, 10); // @db.Date → midnight UTC
      const wk = weekStart(entry.date);
      const amount = Number(entry.amount);
      getDayBucket(dk)[entry.category].sales += amount;
      getWeekBucket(wk)[entry.category].sales += amount;
      categoryTotals[entry.category].sales += amount;
    }

    // Accumulate COGS from stock usage — bucket by day and week
    for (const log of stockLogs) {
      if (!log.product?.cogsCategory) continue; // uncategorized — skip
      const dk = log.timestamp.toISOString().slice(0, 10);
      const wk = weekStart(log.timestamp);
      const cogs = Math.abs(log.change) * (log.unitCost ?? log.product.costPerUnit);
      getDayBucket(dk)[log.product.cogsCategory].cogs += cogs;
      getWeekBucket(wk)[log.product.cogsCategory].cogs += cogs;
      categoryTotals[log.product.cogsCategory].cogs += cogs;
    }

    // ── Build response ────────────────────────────────────────────────────────

    /** Shared shape builder — same logic for day and week periods. */
    function buildPeriod(buckets: Record<string, Bucket>) {
      const totalSales = ALL_CATEGORIES.reduce((s, c) => s + buckets[c].sales, 0);
      const totalCogs = ALL_CATEGORIES.reduce((s, c) => s + buckets[c].cogs, 0);
      return {
        byCategory: Object.fromEntries(
          ALL_CATEGORIES.map((c) => [
            c,
            {
              sales: round2(buckets[c].sales),
              cogs: round2(buckets[c].cogs),
              cogsRatio: safeRatio(buckets[c].cogs, buckets[c].sales),
            },
          ])
        ),
        totals: {
          sales: round2(totalSales),
          cogs: round2(totalCogs),
          cogsRatio: safeRatio(totalCogs, totalSales),
        },
      };
    }

    // All days in range (including days with no data → zeroes)
    const allDates: string[] = [];
    {
      const cursor = new Date(start);
      while (cursor <= endInclusive) {
        allDates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    const days = allDates.map((dk) => ({
      date: dk,
      ...buildPeriod(getDayBucket(dk)),
    }));

    // All weeks in range (including weeks with no data → zeroes)
    const allWeeks = weeksInRange(start, endInclusive);
    const weeks = allWeeks.map((wk) => ({
      weekStart: wk,
      ...buildPeriod(getWeekBucket(wk)),
    }));

    const byCategory = Object.fromEntries(
      ALL_CATEGORIES.map((c) => {
        const { sales, cogs } = categoryTotals[c];
        return [
          c,
          {
            totalSales: round2(sales),
            totalCOGS: round2(cogs),
            cogsRatio: safeRatio(cogs, sales),
          },
        ];
      })
    );

    const periodSales = ALL_CATEGORIES.reduce((s, c) => s + categoryTotals[c].sales, 0);
    const periodCogs = ALL_CATEGORIES.reduce((s, c) => s + categoryTotals[c].cogs, 0);

    res.json({
      startDate: startStr,
      endDate: endStr,
      days,
      weeks,
      byCategory,
      period: {
        totalSales: round2(periodSales),
        totalCOGS: round2(periodCogs),
        cogsRatio: safeRatio(periodCogs, periodSales),
      },
    });
  } catch (err) {
    next(err);
  }
}
