import { Response, NextFunction } from "express";
import { z } from "zod";
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

// ── GET /reports/weekly?endDate=YYYY-MM-DD ───────────────────────────────────
export async function getWeeklyReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const endStr = typeof req.query.endDate === "string" ? req.query.endDate : todayISO();
    const parsed = dateSchema.safeParse(endStr);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const endDay = toUTCDay(endStr);
    const endExclusive = addDays(endDay, 1);
    const startDay = addDays(endDay, -6); // 7-day window inclusive
    const startStr = toISODate(startDay);

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

    // Day-by-day breakdown
    const days = Array.from({ length: 7 }, (_, i) => {
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
