import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns midnight UTC N days ago. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

type Trend = "up" | "down" | "flat" | null;

function trend(current: number | null, prior: number | null): Trend {
  if (current === null || prior === null) return null;
  const delta = current - prior;
  if (Math.abs(delta) < 0.5) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Percentage rounded to 1 decimal. Returns null when denominator is 0. */
function safePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/locations/overview
 *
 * Returns an array of LocationSummary objects — one per restaurant that the
 * logged-in user has access to.  Today that is always exactly one (the user's
 * own restaurant).  When a partner/organisation model is added to the schema
 * this endpoint can be extended to return all partner locations.
 *
 * Each summary includes 30-day metrics and trend directions vs the prior 30 days.
 */
export async function getLocationsOverview(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;

    const now30  = daysAgo(30);  // window: [now30, now)
    const now60  = daysAgo(60);  // prior window: [now60, now30)

    const [
      restaurant,
      sales30,    sales_prior,
      labor30,    labor_prior,
      orders30,   orders_prior,
      latestCount,
    ] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true, logo: true },
      }),

      // Revenue — current 30 days
      prisma.salesEntry.aggregate({
        where: { restaurantId, date: { gte: now30 } },
        _sum:  { amount: true },
      }),
      // Revenue — prior 30 days
      prisma.salesEntry.aggregate({
        where: { restaurantId, date: { gte: now60, lt: now30 } },
        _sum:  { amount: true },
      }),

      // Labor — current 30 days
      prisma.laborEntry.aggregate({
        where: { restaurantId, date: { gte: now30 } },
        _sum:  { total: true },
      }),
      // Labor — prior 30 days
      prisma.laborEntry.aggregate({
        where: { restaurantId, date: { gte: now60, lt: now30 } },
        _sum:  { total: true },
      }),

      // COGS via purchase orders — current 30 days
      prisma.order.aggregate({
        where: { restaurantId, createdAt: { gte: now30 } },
        _sum:  { totalCost: true },
      }),
      // COGS — prior 30 days
      prisma.order.aggregate({
        where: { restaurantId, createdAt: { gte: now60, lt: now30 } },
        _sum:  { totalCost: true },
      }),

      // Most recent closed count session (for inventory accuracy)
      prisma.countSession.findFirst({
        where:   { restaurantId, status: "CLOSED" },
        orderBy: { date: "desc" },
        include: {
          entries: {
            select: { expectedQuantity: true, actualQuantity: true },
          },
        },
      }),
    ]);

    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

    // ── Compute current-period values ────────────────────────────────────────
    const revenue   = Number(sales30._sum.amount   ?? 0);
    const revPrior  = Number(sales_prior._sum.amount ?? 0);
    const labor     = Number(labor30._sum.total     ?? 0);
    const laborPrior= Number(labor_prior._sum.total  ?? 0);
    const cogs      = Number(orders30._sum.totalCost  ?? 0);
    const cogsPrior = Number(orders_prior._sum.totalCost ?? 0);

    const foodCostPct   = safePct(cogs,           revenue);
    const laborCostPct  = safePct(labor,           revenue);
    const primeCostPct  = safePct(cogs + labor,    revenue);
    const foodPrior     = safePct(cogsPrior,             revPrior);
    const laborPrior2   = safePct(laborPrior,            revPrior);
    const primePrior    = safePct(cogsPrior + laborPrior, revPrior);

    // ── Inventory accuracy ───────────────────────────────────────────────────
    let inventoryAccuracyPct: number | null = null;
    if (latestCount && latestCount.entries.length > 0) {
      const totalExpected = latestCount.entries.reduce(
        (s, e) => s + Number(e.expectedQuantity), 0
      );
      const totalVariance = latestCount.entries.reduce(
        (s, e) => s + Math.abs(Number(e.actualQuantity) - Number(e.expectedQuantity)), 0
      );
      inventoryAccuracyPct =
        totalExpected > 0
          ? Math.round(((totalExpected - totalVariance) / totalExpected) * 1000) / 10
          : null;
    }

    const hasData = revenue > 0 || cogs > 0 || labor > 0;

    res.json([
      {
        restaurantId: restaurant.id,
        name:         restaurant.name,
        logo:         restaurant.logo,
        metrics: {
          foodCostPct,
          laborCostPct,
          primeCostPct,
          inventoryAccuracyPct,
          revenue30d: Math.round(revenue * 100) / 100,
        },
        trends: {
          // For cost %: "up" = costs rose (worse); "down" = costs fell (better).
          // Color coding intentionally deferred to Prompt 2.
          foodCostPct:          trend(foodCostPct,  foodPrior),
          laborCostPct:         trend(laborCostPct, laborPrior2),
          primeCostPct:         trend(primeCostPct, primePrior),
          inventoryAccuracyPct: null as Trend, // requires 2 closed sessions
          revenue30d:           trend(revenue, revPrior),
        },
        hasData,
      },
    ]);
  } catch (err) {
    next(err);
  }
}
