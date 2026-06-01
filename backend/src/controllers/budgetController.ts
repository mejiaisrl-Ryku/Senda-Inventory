import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";

// ── Shared helpers (mirrored from phase6Controller) ───────────────────────────

const r2 = (v: number) => Math.round(v * 100) / 100;

function safePct(num: number, den: number): number {
  return den > 0 ? r2((num / den) * 100) : 0;
}

async function computePnL(restaurantId: string, from: Date, to: Date) {
  const [salesRows, laborRows, orderRows] = await Promise.all([
    prisma.salesEntry.findMany({
      where:  { restaurantId, date: { gte: from, lte: to } },
      select: { amount: true },
    }),
    prisma.laborEntry.findMany({
      where:  { restaurantId, date: { gte: from, lte: to } },
      select: { total: true },
    }),
    prisma.order.findMany({
      where: {
        restaurantId,
        status: "RECEIVED",
        OR: [
          { deliveredAt: { not: null, gte: from, lte: to } },
          { deliveredAt: null, createdAt: { gte: from, lte: to } },
        ],
      },
      select: { totalCost: true },
    }),
  ]);

  const revenue   = r2(salesRows.reduce((s, e) => s + parseFloat(String(e.amount)), 0));
  const foodCost  = r2(orderRows.reduce((s, o) => s + o.totalCost, 0));
  const laborCost = r2(laborRows.reduce((s, e) => s + Number(e.total), 0));
  const primeCost = r2(foodCost + laborCost);

  return {
    revenue,
    foodCost,
    laborCost,
    primeCost,
    grossProfit:    r2(revenue - primeCost),
    laborPct:       safePct(laborCost, revenue),
    primeCostPct:   safePct(primeCost, revenue),
  };
}

// ── Period helpers ────────────────────────────────────────────────────────────

function periodRange(year: number, month: number | null): { from: Date; to: Date } {
  if (month !== null) {
    // Full calendar month (UTC)
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to   = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // last day of month
    return { from, to };
  }
  // Full year
  return {
    from: new Date(Date.UTC(year, 0, 1)),
    to:   new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
  };
}

// ── ENDPOINT 1: GET /api/owner/budgets ────────────────────────────────────────

export async function getOwnerBudgets(req: AuthRequest, res: Response, next: NextFunction) {
  const start = Date.now();
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";

    const yearStr  = req.query.year  as string | undefined;
    const monthStr = req.query.month as string | undefined;

    if (!yearStr || isNaN(Number(yearStr))) {
      return res.status(400).json({ error: "year query param is required (number)" });
    }

    const year  = parseInt(yearStr, 10);
    const month = monthStr !== undefined && monthStr !== "" ? parseInt(monthStr, 10) : null;

    if (month !== null && (month < 1 || month > 12)) {
      return res.status(400).json({ error: "month must be 1–12" });
    }

    logger.debug("getOwnerBudgets: entry", { userId: req.user.userId, ownerAccountId, year, month });

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const budgets = await prisma.locationBudget.findMany({
      where: {
        ownerAccountId,
        year,
        month: month ?? null,
      },
    });

    const budgetMap = new Map(budgets.map((b) => [b.restaurantId, b]));
    const { from, to } = periodRange(year, month);

    const result = await Promise.all(
      restaurants.map(async (r) => {
        const budget = budgetMap.get(r.id) ?? null;
        let actual: {
          revenue: number; laborPct: number; primeCostPct: number;
          revenueVariance: number; laborPctVariance: number; primeCostVariance: number;
        } | null = null;

        const pnl = await computePnL(r.id, from, to);
        if (pnl.revenue > 0 || pnl.laborCost > 0) {
          actual = {
            revenue:            pnl.revenue,
            laborPct:           pnl.laborPct,
            primeCostPct:       pnl.primeCostPct,
            revenueVariance:    budget ? r2(pnl.revenue - budget.revenueTarget)       : 0,
            laborPctVariance:   budget ? r2(pnl.laborPct - budget.laborPctTarget)     : 0,
            primeCostVariance:  budget ? r2(pnl.primeCostPct - budget.primeCostTarget) : 0,
          };
        }

        return {
          restaurantId:    r.id,
          restaurantName:  r.name,
          revenueTarget:   budget?.revenueTarget   ?? null,
          laborPctTarget:  budget?.laborPctTarget   ?? null,
          primeCostTarget: budget?.primeCostTarget  ?? null,
          budgetId:        budget?.id               ?? null,
          actual,
        };
      })
    );

    logger.debug("getOwnerBudgets: success", {
      userId: req.user.userId, ownerAccountId, year, month,
      locationCount: restaurants.length, durationMs: Date.now() - start,
    });

    res.json({ year, month, budgets: result });
  } catch (err) {
    logger.error("getOwnerBudgets: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}

// ── ENDPOINT 2: POST /api/owner/budgets ───────────────────────────────────────

export async function upsertOwnerBudget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";

    const { restaurantId, year, month, revenueTarget, laborPctTarget, primeCostTarget } = req.body as {
      restaurantId:    string;
      year:            number;
      month?:          number | null;
      revenueTarget:   number;
      laborPctTarget:  number;
      primeCostTarget: number;
    };

    if (!restaurantId || !year || revenueTarget == null || laborPctTarget == null || primeCostTarget == null) {
      return res.status(400).json({ error: "restaurantId, year, revenueTarget, laborPctTarget, primeCostTarget are required" });
    }

    logger.warn("upsertOwnerBudget: entry", { userId: req.user.userId, ownerAccountId, restaurantId, year, month: month ?? null });

    // Verify the restaurant belongs to this owner
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { ownerAccountId: true },
    });

    if (!restaurant || restaurant.ownerAccountId !== ownerAccountId) {
      return res.status(403).json({ error: "Restaurant does not belong to your account" });
    }

    const monthVal = month ?? null;

    // Use findFirst + create/update to avoid Prisma nullable-unique-field type issues
    const existing = await prisma.locationBudget.findFirst({
      where: { restaurantId, year, month: monthVal },
    });

    const budget = existing
      ? await prisma.locationBudget.update({
          where: { id: existing.id },
          data:  { revenueTarget, laborPctTarget, primeCostTarget, ownerAccountId },
        })
      : await prisma.locationBudget.create({
          data: { restaurantId, ownerAccountId, year, month: monthVal, revenueTarget, laborPctTarget, primeCostTarget },
        });

    logger.warn("upsertOwnerBudget: success", { userId: req.user.userId, budgetId: budget.id, restaurantId, year, month: monthVal });

    res.json(budget);
  } catch (err) {
    logger.error("upsertOwnerBudget: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}

// ── ENDPOINT 3: DELETE /api/owner/budgets/:budgetId ───────────────────────────

export async function deleteOwnerBudget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ownerAccountId = req.user.ownerAccountId ?? "";
    const { budgetId }   = req.params;

    logger.warn("deleteOwnerBudget: entry", { userId: req.user.userId, ownerAccountId, budgetId });

    const budget = await prisma.locationBudget.findUnique({
      where:  { id: budgetId },
      select: { id: true, ownerAccountId: true },
    });

    if (!budget) return res.status(404).json({ error: "Budget not found" });
    if (budget.ownerAccountId !== ownerAccountId) return res.status(403).json({ error: "Not your budget" });

    await prisma.locationBudget.delete({ where: { id: budgetId } });

    logger.warn("deleteOwnerBudget: success", { userId: req.user.userId, budgetId });

    res.json({ deleted: true });
  } catch (err) {
    logger.error("deleteOwnerBudget: error", { userId: req.user.userId, message: (err as Error).message });
    next(err);
  }
}
