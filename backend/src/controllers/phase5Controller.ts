import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";

// ── Date helpers ──────────────────────────────────────────────────────────────

function utcMidnight(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Alert {
  type:         "HIGH_LABOR" | "HIGH_PRIME_COST" | "SALES_DROP";
  severity:     "warning" | "critical";
  message:      string;
  messagEs:     string;
  locationName: string;
}

interface SalesEntry {
  date:     Date;
  category: string;
  amount:   { toNumber(): number } | number;
}

interface LaborEntry {
  date:       Date;
  fohLabor:   number;
  bohLabor:   number;
  management: number;
  total:      number;
}

// ── Alert generator (shared) ──────────────────────────────────────────────────

interface AlertInput {
  laborPct:      number;
  primeCostPct:  number;
  trend:         "up" | "down" | "flat";
  last7Total:    number;
  prior7Total:   number;
  locationName:  string;
}

export function generateAlerts(data: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const { laborPct, primeCostPct, trend, last7Total, prior7Total, locationName } = data;

  // ── HIGH_LABOR ──────────────────────────────────────────────────────────────
  if (laborPct > 45) {
    alerts.push({
      type:         "HIGH_LABOR",
      severity:     "critical",
      locationName,
      message:      `Labor cost is critically high at ${laborPct.toFixed(1)}%`,
      messagEs:     `El costo de labor está en nivel crítico: ${laborPct.toFixed(1)}%`,
    });
  } else if (laborPct > 35) {
    alerts.push({
      type:         "HIGH_LABOR",
      severity:     "warning",
      locationName,
      message:      "Labor cost is above 35% — review scheduling",
      messagEs:     "El costo de labor supera el 35% — revisa los horarios",
    });
  }

  // ── HIGH_PRIME_COST ─────────────────────────────────────────────────────────
  if (primeCostPct > 75) {
    alerts.push({
      type:         "HIGH_PRIME_COST",
      severity:     "critical",
      locationName,
      message:      `Prime cost is critically high at ${primeCostPct.toFixed(1)}%`,
      messagEs:     `El costo primo está en nivel crítico: ${primeCostPct.toFixed(1)}%`,
    });
  } else if (primeCostPct > 65) {
    alerts.push({
      type:         "HIGH_PRIME_COST",
      severity:     "warning",
      locationName,
      message:      "Prime cost above 65% — review food and labor spend",
      messagEs:     "El costo primo supera el 65% — revisa gastos de comida y labor",
    });
  }

  // ── SALES_DROP ──────────────────────────────────────────────────────────────
  if (trend === "down" && prior7Total > 0) {
    const dropPct = ((prior7Total - last7Total) / prior7Total) * 100;
    if (dropPct > 20) {
      alerts.push({
        type:         "SALES_DROP",
        severity:     "critical",
        locationName,
        message:      "Sales dropped more than 20% vs prior week — immediate attention needed",
        messagEs:     "Las ventas bajaron más del 20% vs la semana anterior — atención inmediata",
      });
    } else if (dropPct > 10) {
      alerts.push({
        type:         "SALES_DROP",
        severity:     "warning",
        locationName,
        message:      "Sales dropped more than 10% vs prior week",
        messagEs:     "Las ventas bajaron más del 10% vs la semana anterior",
      });
    }
  }

  return alerts;
}

// ── Core metrics computer (shared by GM and Owner endpoints) ──────────────────

async function computeLocationMetrics(restaurantId: string, locationName: string) {
  const now    = utcMidnight(0);
  const day30  = utcMidnight(30);
  const day90  = utcMidnight(90);  // extended window for dailyTotals (chart history)
  const day7   = utcMidnight(7);
  const day14  = utcMidnight(14);

  // Sales: fetch 90 days so the chart can show monthly view.
  // Labor: still 30 days — all metrics (laborPct, prime cost, alerts) stay 30-day scoped.
  const [salesRows, laborRows] = await Promise.all([
    prisma.salesEntry.findMany({
      where:   { restaurantId, date: { gte: day90, lt: now } },
      select:  { date: true, category: true, amount: true },
      orderBy: { date: "asc" },
    }) as Promise<SalesEntry[]>,
    prisma.laborEntry.findMany({
      where:   { restaurantId, date: { gte: day30, lt: now } },
      select:  { date: true, fohLabor: true, bohLabor: true, management: true, total: true },
      orderBy: { date: "asc" },
    }) as Promise<LaborEntry[]>,
  ]);

  // ── Sales aggregation ──────────────────────────────────────────────────────
  // byCategory, salesTotal, trend window: scoped to the 30-day window only.
  // dailyTotals: covers the full 90-day window for chart history.
  const byCategory: Record<string, number> = { FOOD: 0, BEER: 0, LIQUOR: 0, WINE: 0 };
  const dailyMap   = new Map<string, number>();
  let last7Total   = 0;
  let prior7Total  = 0;

  for (const e of salesRows) {
    const amt  = typeof e.amount === "number" ? e.amount : e.amount.toNumber();
    const cat  = e.category;
    const dStr = toDateStr(e.date);

    // Always add to dailyTotals (full 90-day window)
    dailyMap.set(dStr, (dailyMap.get(dStr) ?? 0) + amt);

    // Only 30-day entries count toward metrics
    if (e.date >= day30) {
      if (cat in byCategory) byCategory[cat] = (byCategory[cat] ?? 0) + amt;
      if (e.date >= day7)                        last7Total  += amt;
      if (e.date >= day14 && e.date < day7)      prior7Total += amt;
    }
  }

  const salesTotal  = Object.values(byCategory).reduce((s, v) => s + v, 0);
  const dailyTotals = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }));

  const trend: "up" | "down" | "flat" =
    prior7Total === 0            ? "flat" :
    last7Total > prior7Total * 1.01 ? "up"   :
    last7Total < prior7Total * 0.99 ? "down"  : "flat";

  // ── Labor aggregation ──────────────────────────────────────────────────────
  let fohTotal = 0, bohTotal = 0, mgmtTotal = 0, laborTotal = 0;
  for (const e of laborRows) {
    fohTotal  += Number(e.fohLabor);
    bohTotal  += Number(e.bohLabor);
    mgmtTotal += Number(e.management);
    laborTotal += Number(e.total);
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;
  const laborPct     = salesTotal > 0 ? r2((laborTotal / salesTotal) * 100) : 0;

  // Prime cost: FOOD category sales + labor (per spec — FOOD used as food-cost proxy)
  const primeCostValue = r2(byCategory.FOOD + laborTotal);
  const primeCostPct   = salesTotal > 0 ? r2((primeCostValue / salesTotal) * 100) : 0;

  const alerts = generateAlerts({ laborPct, primeCostPct, trend, last7Total, prior7Total, locationName });

  return {
    sales: {
      total:       r2(salesTotal),
      byCategory:  Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, r2(v)])),
      dailyTotals,
      trend,
      last7Total:  r2(last7Total),
      prior7Total: r2(prior7Total),
    },
    labor: {
      total:     r2(laborTotal),
      breakdown: { fohLabor: r2(fohTotal), bohLabor: r2(bohTotal), management: r2(mgmtTotal) },
      laborPct,
    },
    primeCost: { value: primeCostValue, pct: primeCostPct },
    alerts,
  };
}

// ── ENDPOINT 1: GET /api/gm/dashboard ─────────────────────────────────────────

export async function getGmDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  const start = Date.now();
  try {
    const restaurantId = req.user.restaurantId ?? "";

    logger.debug("getGmDashboard: entry", { userId: req.user.userId, restaurantId });

    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { id: true, name: true, address: true },
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

    const metrics = await computeLocationMetrics(restaurantId, restaurant.name);

    logger.debug("getGmDashboard: success", {
      userId:       req.user.userId,
      restaurantId,
      salesTotal:   metrics.sales.total,
      alertCount:   metrics.alerts.length,
      durationMs:   Date.now() - start,
    });

    res.json({
      restaurant: { id: restaurant.id, name: restaurant.name, address: restaurant.address },
      period:     "last_30_days",
      sales:      metrics.sales,
      labor:      metrics.labor,
      primeCost:  metrics.primeCost,
      alerts:     metrics.alerts,
    });
  } catch (err) {
    logger.error("getGmDashboard: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}

// ── ENDPOINT 2: GET /api/gm/location ─────────────────────────────────────────

export async function getGmLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId ?? "";

    logger.debug("getGmLocation: entry", { userId: req.user.userId, restaurantId });

    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: {
        id: true, name: true, address: true, phone: true,
        locationCount: true, suspended: true, createdAt: true,
      },
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

    logger.debug("getGmLocation: success", { userId: req.user.userId, restaurantId });

    res.json(restaurant);
  } catch (err) {
    logger.error("getGmLocation: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}

// ── ENDPOINT 3: GET /api/owner/dashboard ─────────────────────────────────────

export async function getOwnerDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  const start = Date.now();
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";

    logger.debug("getOwnerDashboard: entry", { userId: req.user.userId, ownerAccountId });

    const ownerAccount = await prisma.ownerAccount.findUnique({
      where:  { id: ownerAccountId },
      select: { id: true, name: true },
    });
    if (!ownerAccount) return res.status(404).json({ error: "Owner account not found" });

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true, address: true },
      orderBy: { name: "asc" },
    });

    // Compute metrics for every location in parallel
    const locationMetrics = await Promise.all(
      restaurants.map(async (r) => {
        const m = await computeLocationMetrics(r.id, r.name);
        return { restaurant: { id: r.id, name: r.name, address: r.address }, ...m };
      })
    );

    // ── Summary ──────────────────────────────────────────────────────────────
    const totalRevenue = locationMetrics.reduce((s, l) => s + l.sales.total, 0);

    const withData = locationMetrics.filter((l) => l.sales.total > 0);
    const avgLaborPct      = withData.length > 0
      ? withData.reduce((s, l) => s + l.labor.laborPct, 0)    / withData.length : 0;
    const avgPrimeCostPct  = withData.length > 0
      ? withData.reduce((s, l) => s + l.primeCost.pct, 0)     / withData.length : 0;

    const bestPerformer = withData.length > 0
      ? withData.reduce((best, l) => l.primeCost.pct < best.primeCost.pct ? l : best).restaurant.name
      : "";

    const needsAttention = locationMetrics
      .filter((l) => l.alerts.some((a) => a.severity === "critical"))
      .map((l) => l.restaurant.name);

    const r2 = (v: number) => Math.round(v * 100) / 100;

    logger.debug("getOwnerDashboard: success", {
      userId:        req.user.userId,
      ownerAccountId,
      locationCount: restaurants.length,
      totalRevenue:  r2(totalRevenue),
      alertCount:    locationMetrics.flatMap((l) => l.alerts).length,
      durationMs:    Date.now() - start,
    });

    res.json({
      ownerAccount: { id: ownerAccount.id, name: ownerAccount.name },
      period:       "last_30_days",
      locations:    locationMetrics.map(({ restaurant, sales, labor, primeCost, alerts }) => ({
        restaurant,
        sales:     { total: sales.total, byCategory: sales.byCategory, trend: sales.trend },
        labor:     { total: labor.total, laborPct:   labor.laborPct },
        primeCost,
        alerts,
      })),
      summary: {
        totalRevenue:     r2(totalRevenue),
        avgLaborPct:      r2(avgLaborPct),
        avgPrimeCostPct:  r2(avgPrimeCostPct),
        bestPerformer,
        needsAttention,
      },
    });
  } catch (err) {
    logger.error("getOwnerDashboard: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}

// ── ENDPOINT 4: GET /api/owner/locations ─────────────────────────────────────

export async function getOwnerLocations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";

    logger.debug("getOwnerLocations: entry", { userId: req.user.userId, ownerAccountId });

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true, address: true, phone: true, locationCount: true, suspended: true },
      orderBy: { name: "asc" },
    });

    logger.debug("getOwnerLocations: success", {
      userId:        req.user.userId,
      ownerAccountId,
      count:         restaurants.length,
    });

    res.json(restaurants);
  } catch (err) {
    logger.error("getOwnerLocations: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}
