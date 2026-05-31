import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseDate(str: string): Date {
  return new Date(`${str}T00:00:00Z`);
}

function parseDateEnd(str: string): Date {
  return new Date(`${str}T23:59:59Z`);
}

function validateDateParams(
  qStart: unknown,
  qEnd:   unknown
): { from: Date; to: Date } | { error: string } {
  if (typeof qStart !== "string" || typeof qEnd !== "string") {
    return { error: "startDate and endDate are required (YYYY-MM-DD)" };
  }
  const from = parseDate(qStart);
  const to   = parseDateEnd(qEnd);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { error: "Invalid startDate or endDate" };
  }
  if (to < from) {
    return { error: "endDate must be >= startDate" };
  }
  return { from, to };
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

    const dateResult = validateDateParams(req.query.startDate, req.query.endDate);
    if ("error" in dateResult) return res.status(400).json({ error: dateResult.error });
    const { from, to } = dateResult;
    const startDate = req.query.startDate as string;
    const endDate   = req.query.endDate   as string;

    logger.debug("getOwnerPnl: entry", { userId: req.user.userId, ownerAccountId, startDate, endDate });

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true, address: true },
      orderBy: { name: "asc" },
    });

    if (restaurants.length === 0) {
      return res.status(404).json({ error: "No locations found for this owner account" });
    }

    // Compute P&L for every location in parallel
    const locationPnL = await Promise.all(
      restaurants.map(async (r) => {
        const pnl = await computePnL(r.id, from, to);
        return { restaurant: { id: r.id, name: r.name, address: r.address }, ...pnl };
      })
    );

    // Sort by primeCostPct ascending (best = lowest prime cost = rank 1)
    const sorted = [...locationPnL].sort((a, b) => a.primeCostPct - b.primeCostPct);
    const ranked = sorted.map((loc, i) => ({ ...loc, rank: i + 1 }));

    // Consolidated totals
    const revenue   = r2(ranked.reduce((s, l) => s + l.revenue,   0));
    const foodCost  = r2(ranked.reduce((s, l) => s + l.foodCost,  0));
    const laborCost = r2(ranked.reduce((s, l) => s + l.laborCost, 0));
    const primeCost = r2(foodCost + laborCost);
    const grossProfit = r2(revenue - primeCost);

    const consolidated = {
      revenue,
      foodCost,
      laborCost,
      primeCost,
      grossProfit,
      foodCostPct:    safePct(foodCost,    revenue),
      laborCostPct:   safePct(laborCost,   revenue),
      primeCostPct:   safePct(primeCost,   revenue),
      grossProfitPct: safePct(grossProfit, revenue),
    };

    // Ranking
    const withData = ranked.filter((l) => l.revenue > 0);
    const best         = withData.length > 0 ? withData[0].restaurant.name                        : "";
    const worst        = withData.length > 0 ? withData[withData.length - 1].restaurant.name      : "";
    const mostRevenue  = withData.length > 0
      ? withData.reduce((a, b) => b.revenue > a.revenue ? b : a).restaurant.name
      : "";

    logger.debug("getOwnerPnl: success", {
      userId:        req.user.userId,
      ownerAccountId,
      locationCount: ranked.length,
      revenue,
      durationMs:    Date.now() - start,
    });

    res.json({
      period:       { startDate, endDate },
      consolidated,
      locations:    ranked,
      ranking:      { best, worst, mostRevenue },
    });
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

    const dateResult = validateDateParams(req.query.startDate, req.query.endDate);
    if ("error" in dateResult) return res.status(400).json({ error: dateResult.error });
    const { from, to } = dateResult;
    const startDate = req.query.startDate as string;
    const endDate   = req.query.endDate   as string;

    logger.debug("getOwnerPnlSummary: entry", { userId: req.user.userId, ownerAccountId, startDate, endDate });

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true },
      orderBy: { name: "asc" },
    });

    if (restaurants.length === 0) {
      return res.status(404).json({ error: "No locations found for this owner account" });
    }

    const locationPnL = await Promise.all(
      restaurants.map(async (r) => {
        const pnl = await computePnL(r.id, from, to);
        return { name: r.name, ...pnl };
      })
    );

    const revenue     = r2(locationPnL.reduce((s, l) => s + l.revenue,   0));
    const primeCost   = r2(locationPnL.reduce((s, l) => s + l.primeCost, 0));
    const grossProfit = r2(revenue - primeCost);

    const withData    = locationPnL.filter((l) => l.revenue > 0);
    const sorted      = [...withData].sort((a, b) => a.primeCostPct - b.primeCostPct);
    const bestLocation  = sorted.length > 0 ? sorted[0].name                    : "";
    const worstLocation = sorted.length > 0 ? sorted[sorted.length - 1].name   : "";

    logger.debug("getOwnerPnlSummary: success", {
      userId: req.user.userId,
      ownerAccountId,
      revenue,
      durationMs: Date.now() - start,
    });

    res.json({
      period:         { startDate, endDate },
      totalRevenue:   revenue,
      totalPrimeCost: primeCost,
      primeCostPct:   safePct(primeCost, revenue),
      grossProfit,
      grossProfitPct: safePct(grossProfit, revenue),
      bestLocation,
      worstLocation,
      locationCount:  restaurants.length,
    });
  } catch (err) {
    logger.error("getOwnerPnlSummary: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}
