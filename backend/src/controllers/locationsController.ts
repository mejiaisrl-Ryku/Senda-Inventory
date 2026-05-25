import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function safePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// ── Per-restaurant metric computation ────────────────────────────────────────

async function fetchRestaurantMetrics(
  restaurantId: string,
  now30: Date,
  now60: Date
) {
  const [
    sales30,    sales_prior,
    labor30,    labor_prior,
    orders30,   orders_prior,
    latestCount,
  ] = await Promise.all([
    prisma.salesEntry.aggregate({
      where: { restaurantId, date: { gte: now30 } },
      _sum:  { amount: true },
    }),
    prisma.salesEntry.aggregate({
      where: { restaurantId, date: { gte: now60, lt: now30 } },
      _sum:  { amount: true },
    }),

    prisma.laborEntry.aggregate({
      where: { restaurantId, date: { gte: now30 } },
      _sum:  { total: true },
    }),
    prisma.laborEntry.aggregate({
      where: { restaurantId, date: { gte: now60, lt: now30 } },
      _sum:  { total: true },
    }),

    prisma.order.aggregate({
      where: { restaurantId, createdAt: { gte: now30 } },
      _sum:  { totalCost: true },
    }),
    prisma.order.aggregate({
      where: { restaurantId, createdAt: { gte: now60, lt: now30 } },
      _sum:  { totalCost: true },
    }),

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

  const revenue    = Number(sales30._sum.amount      ?? 0);
  const revPrior   = Number(sales_prior._sum.amount  ?? 0);
  const labor      = Number(labor30._sum.total        ?? 0);
  const laborPrior = Number(labor_prior._sum.total    ?? 0);
  const cogs       = Number(orders30._sum.totalCost   ?? 0);
  const cogsPrior  = Number(orders_prior._sum.totalCost ?? 0);

  const foodCostPct  = safePct(cogs,         revenue);
  const laborCostPct = safePct(labor,         revenue);
  const primeCostPct = safePct(cogs + labor,  revenue);
  const foodPrior    = safePct(cogsPrior,             revPrior);
  const laborPrior2  = safePct(laborPrior,            revPrior);
  const primePrior   = safePct(cogsPrior + laborPrior, revPrior);

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

  return {
    hasData,
    metrics: {
      foodCostPct,
      laborCostPct,
      primeCostPct,
      inventoryAccuracyPct,
      revenue30d: Math.round(revenue * 100) / 100,
    },
    trends: {
      foodCostPct:          trend(foodCostPct,  foodPrior),
      laborCostPct:         trend(laborCostPct, laborPrior2),
      primeCostPct:         trend(primeCostPct, primePrior),
      inventoryAccuracyPct: null as Trend,
      revenue30d:           trend(revenue, revPrior),
    },
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/locations/overview
 *
 * Returns an array of LocationSummary objects for the logged-in restaurant plus
 * any TEST_ restaurants (used for demo / QA).
 */
export async function getLocationsOverview(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;
    const now30 = daysAgo(30);
    const now60 = daysAgo(60);

    // Fetch the user's real restaurant and any TEST_ locations in parallel
    const [userRestaurant, testRestaurants] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true, logo: true },
      }),
      prisma.restaurant.findMany({
        where:  { name: { startsWith: "TEST_" } },
        select: { id: true, name: true, logo: true },
        orderBy: { name: "asc" },
      }),
    ]);

    if (!userRestaurant) return res.status(404).json({ error: "Restaurant not found" });

    const allRestaurants = [
      { ...userRestaurant, isTest: false },
      ...testRestaurants.map((r) => ({
        ...r,
        isTest: true,
        // Strip the prefix for display
        name: r.name.replace(/^TEST_/, ""),
      })),
    ];

    const results = await Promise.all(
      allRestaurants.map(async (r) => {
        const { metrics, trends, hasData } = await fetchRestaurantMetrics(
          r.id,
          now30,
          now60
        );
        return {
          restaurantId: r.id,
          name:         r.name,
          logo:         r.logo,
          isTest:       r.isTest,
          hasData,
          metrics,
          trends,
        };
      })
    );

    res.json(results);
  } catch (err) {
    next(err);
  }
}
