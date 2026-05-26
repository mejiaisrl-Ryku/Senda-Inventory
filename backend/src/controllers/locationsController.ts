import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Shared unit-conversion helper (mirrors recipeController logic) ────────────

function autoConversionFactor(recipeUnit: string, purchaseUnit: string): number | null {
  const aliases: Record<string, string> = { PIECES: "PCS", LITERS: "L" };
  const r = aliases[recipeUnit]  ?? recipeUnit;
  const p = aliases[purchaseUnit] ?? purchaseUnit;
  if (r === p) return 1;
  const table: Record<string, Record<string, number>> = {
    G:  { KG: 1000  }, KG: { G: 0.001  },
    OZ: { LB: 16    }, LB: { OZ: 0.0625 },
    ML: { L: 1000   }, L:  { ML: 0.001  },
  };
  return table[r]?.[p] ?? null;
}

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

/**
 * GET /api/locations/recipes
 *
 * Returns all recipes across all known locations (user's restaurant + TEST_
 * restaurants), grouped by recipe name.  Each group contains one entry per
 * location — those that don't offer the recipe get `hasRecipe: false`.
 *
 * Ingredient costs are sourced from the most recent invoice (last 30 days)
 * when available; otherwise falls back to the product's stored costPerUnit.
 */
export async function getLocationsRecipes(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;
    const now30 = daysAgo(30);

    const [userRestaurant, testRestaurants] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true },
      }),
      prisma.restaurant.findMany({
        where:   { name: { startsWith: "TEST_" } },
        select:  { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    if (!userRestaurant) return res.status(404).json({ error: "Restaurant not found" });

    const allRestaurants = [
      { id: userRestaurant.id, name: userRestaurant.name, isTest: false },
      ...testRestaurants.map((r) => ({
        id:     r.id,
        name:   r.name.replace(/^TEST_/, ""),
        isTest: true,
      })),
    ];

    const allIds = allRestaurants.map((r) => r.id);

    // One query for all recipes across all locations
    const allRecipes = await (prisma as any).recipe.findMany({
      where:   { restaurantId: { in: allIds } },
      orderBy: [{ name: "asc" }],
      include: {
        ingredients: {
          include: {
            product: {
              select: { id: true, name: true, unit: true, costPerUnit: true },
            },
          },
        },
      },
    });

    // Collect all unique productIds so we can batch-fetch invoice prices
    const productIdSet = new Set<string>();
    for (const recipe of allRecipes) {
      for (const ing of recipe.ingredients) {
        if (ing.product?.id) productIdSet.add(ing.product.id);
      }
    }

    // Batch-fetch the most recent order items in the last 30 days for all products
    // across all locations — one query instead of N×M queries.
    type InvoiceItem = {
      productId: string | null;
      unitCost:  number;
      unit:      string | null;
      order: {
        restaurantId: string;
        purveyor:     string | null;
        invoiceDate:  Date | null;
        createdAt:    Date;
      };
    };

    let recentItems: InvoiceItem[] = [];
    if (productIdSet.size > 0) {
      recentItems = await (prisma as any).orderItem.findMany({
        where: {
          productId: { in: [...productIdSet] },
          order: {
            restaurantId: { in: allIds },
            createdAt:    { gte: now30 },
          },
        },
        select: {
          productId: true,
          unitCost:  true,
          unit:      true,
          order: {
            select: {
              restaurantId: true,
              purveyor:     true,
              invoiceDate:  true,
              createdAt:    true,
            },
          },
        },
        orderBy: { order: { createdAt: "desc" } },
      });
    }

    // Build lookup: `${productId}:${restaurantId}` → most recent item (already sorted desc)
    const invoiceLookup = new Map<string, InvoiceItem>();
    for (const item of recentItems) {
      if (!item.productId) continue;
      const key = `${item.productId}:${item.order.restaurantId}`;
      if (!invoiceLookup.has(key)) {
        invoiceLookup.set(key, item);
      }
    }

    // Group by normalised recipe name → Map<restaurantId, recipe>
    const byName = new Map<string, Map<string, any>>();
    for (const recipe of allRecipes) {
      const key = recipe.name.toLowerCase().trim();
      if (!byName.has(key)) byName.set(key, new Map());
      byName.get(key)!.set(recipe.restaurantId, recipe);
    }

    function n(v: unknown): number {
      return typeof v === "object" ? parseFloat(String(v)) : Number(v);
    }

    const result = Array.from(byName.values())
      .map((recipeByRestaurant) => {
        const firstRecipe = recipeByRestaurant.values().next().value;

        const locations = allRestaurants.map((restaurant) => {
          const recipe = recipeByRestaurant.get(restaurant.id);
          if (!recipe) {
            return {
              restaurantId: restaurant.id,
              locationName: restaurant.name,
              isTest:       restaurant.isTest,
              hasRecipe:    false,
            };
          }

          const sp          = n(recipe.sellingPrice);
          const ingredients = recipe.ingredients.map((ing: any) => {
            const qty            = n(ing.quantity);
            const storedCost     = n(ing.product.costPerUnit);
            const productUnit    = ing.product.unit as string;
            const recipeUnit     = ing.unit as string;

            // Prefer invoice price for this product+location combo
            const invoiceKey  = `${ing.product.id}:${restaurant.id}`;
            const invoiceItem = invoiceLookup.get(invoiceKey);

            let costPerUnit   = storedCost;
            let fromInvoice   = false;
            let purveyor: string | null = null;
            let invoiceDate: string | null = null;
            let pricingSource = "catalog";

            if (invoiceItem) {
              // Use invoice unit cost (already in the invoice's purchase unit)
              costPerUnit  = n(invoiceItem.unitCost);
              fromInvoice  = true;
              purveyor     = invoiceItem.order.purveyor ?? null;
              invoiceDate  = invoiceItem.order.invoiceDate
                ? invoiceItem.order.invoiceDate.toISOString().slice(0, 10)
                : invoiceItem.order.createdAt.toISOString().slice(0, 10);
              pricingSource = "invoice";
            }

            // Convert recipe qty → purchase unit using the same factor logic
            const factor = autoConversionFactor(recipeUnit, productUnit);
            let lineTotal = 0;
            if (factor !== null) {
              lineTotal = (qty / factor) * costPerUnit;
            } else if (ing.conversionFactor) {
              lineTotal = (qty / n(ing.conversionFactor)) * costPerUnit;
            } else {
              // No conversion — treat as same unit
              lineTotal = qty * costPerUnit;
            }

            return {
              name:         ing.product.name,
              quantity:     Math.round(qty * 1000)       / 1000,
              unit:         recipeUnit,
              costPerUnit:  Math.round(costPerUnit * 1000) / 1000,
              lineTotal:    Math.round(lineTotal * 100)    / 100,
              fromInvoice,
              purveyor,
              invoiceDate,
              pricingSource,
            };
          });

          const recipeCost = Math.round(
            ingredients.reduce((s: number, i: any) => s + i.lineTotal, 0) * 100
          ) / 100;
          const costPct = sp > 0 ? Math.round((recipeCost / sp) * 1000) / 10 : 0;

          // Did any ingredient use real invoice data?
          const hasInvoiceData = ingredients.some((i: any) => i.fromInvoice);

          return {
            restaurantId: restaurant.id,
            locationName: restaurant.name,
            isTest:       restaurant.isTest,
            hasRecipe:    true,
            sellingPrice: Math.round(sp * 100) / 100,
            recipeCost,
            costPct,
            hasInvoiceData,
            ingredients,
          };
        });

        return {
          recipeName: firstRecipe.name as string,
          department: firstRecipe.department as string,
          locations,
        };
      })
      .sort((a, b) => a.recipeName.localeCompare(b.recipeName));

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/locations/vendor-pricing
 *
 * Returns all products purchased in the last 30 days across all known
 * locations, grouped by (normalized product name + unit).  For each group
 * every location gets one entry with the most-recent unit cost and the
 * 30-day purchase volume.  Annual savings opportunity is computed relative
 * to the cheapest location.
 */
export async function getLocationsPricing(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;
    const now30 = daysAgo(30);

    const [userRestaurant, testRestaurants] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true },
      }),
      prisma.restaurant.findMany({
        where:   { name: { startsWith: "TEST_" } },
        select:  { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    if (!userRestaurant) return res.status(404).json({ error: "Restaurant not found" });

    const allRestaurants = [
      { id: userRestaurant.id, name: userRestaurant.name, isTest: false },
      ...testRestaurants.map((r) => ({
        id:     r.id,
        name:   r.name.replace(/^TEST_/, ""),
        isTest: true,
      })),
    ];

    const allIds = allRestaurants.map((r) => r.id);

    // One batch query — all order items across all locations in last 30 days
    // where we have a linked product (productId not null).
    const items = await (prisma as any).orderItem.findMany({
      where: {
        productId: { not: null },
        order: {
          restaurantId: { in: allIds },
          createdAt:    { gte: now30 },
        },
      },
      select: {
        productId:   true,
        quantity:    true,
        unitCost:    true,
        unit:        true,
        productName: true,
        order: {
          select: {
            restaurantId: true,
            purveyor:     true,
            invoiceDate:  true,
            createdAt:    true,
          },
        },
      },
      orderBy: { order: { createdAt: "desc" } },
    });

    function n(v: unknown): number {
      return typeof v === "object" ? parseFloat(String(v)) : Number(v);
    }

    // Build: groupKey (name+unit) → restaurantId → { mostRecent, totalQty }
    // groupKey: normalized product name + unit
    type LocData = {
      restaurantId: string;
      unitCost:     number;
      unit:         string;
      purveyor:     string | null;
      invoiceDate:  string | null;
      totalQty30d:  number;
      entryCount:   number;
    };

    const groupMap = new Map<string, { displayName: string; unit: string; byLoc: Map<string, LocData> }>();

    for (const item of items) {
      const rawName  = (item.productName ?? "Unknown") as string;
      const rawUnit  = (item.unit ?? "") as string;
      const groupKey = `${rawName.toLowerCase().trim()}::${rawUnit.toLowerCase().trim()}`;

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          displayName: rawName,
          unit:        rawUnit,
          byLoc:       new Map(),
        });
      }

      const group   = groupMap.get(groupKey)!;
      const locId   = item.order.restaurantId as string;
      const qty     = n(item.quantity);
      const cost    = n(item.unitCost);
      const invDate = item.order.invoiceDate
        ? (item.order.invoiceDate as Date).toISOString().slice(0, 10)
        : (item.order.createdAt as Date).toISOString().slice(0, 10);

      if (!group.byLoc.has(locId)) {
        // First (most recent) entry for this location
        group.byLoc.set(locId, {
          restaurantId: locId,
          unitCost:     cost,
          unit:         rawUnit,
          purveyor:     item.order.purveyor ?? null,
          invoiceDate:  invDate,
          totalQty30d:  qty,
          entryCount:   1,
        });
      } else {
        // Accumulate quantity (items already sorted desc so first = most recent)
        const existing = group.byLoc.get(locId)!;
        existing.totalQty30d += qty;
        existing.entryCount  += 1;
      }
    }

    // Build result — only include groups where at least 2 locations have data
    // (single-location products are uninteresting for comparison)
    const restaurantById = new Map(allRestaurants.map((r) => [r.id, r]));

    const result = Array.from(groupMap.entries())
      .map(([, group]) => {
        const locationEntries = allRestaurants.map((restaurant) => {
          const locData = group.byLoc.get(restaurant.id);
          if (!locData) {
            return {
              restaurantId: restaurant.id,
              locationName: restaurant.name,
              isTest:       restaurant.isTest,
              hasPurchases: false,
            };
          }
          return {
            restaurantId: restaurant.id,
            locationName: restaurant.name,
            isTest:       restaurant.isTest,
            hasPurchases: true,
            unitCost:     Math.round(locData.unitCost * 1000)   / 1000,
            unit:         locData.unit,
            purveyor:     locData.purveyor,
            invoiceDate:  locData.invoiceDate,
            totalQty30d:  Math.round(locData.totalQty30d * 100) / 100,
          };
        });

        // Compute best/worst among locations that have purchases
        const activeEntries = locationEntries.filter((e) => e.hasPurchases);
        if (activeEntries.length < 2) return null; // skip single-location

        const costs    = activeEntries.map((e) => (e as any).unitCost as number);
        const minCost  = Math.min(...costs);
        const maxCost  = Math.max(...costs);

        // Annual savings: how much the worst-case location could save if it
        // paid the best price, based on its 30-day volume × 12.
        let maxAnnualSavings = 0;
        for (const entry of activeEntries) {
          if (!(entry as any).hasPurchases) continue;
          const e = entry as any;
          const gap = e.unitCost - minCost;
          if (gap > 0) {
            const annualQty = e.totalQty30d * 12;
            const savings   = Math.round(gap * annualQty * 100) / 100;
            if (savings > maxAnnualSavings) maxAnnualSavings = savings;
          }
        }

        return {
          productName:      group.displayName,
          unit:             group.unit,
          minCost:          Math.round(minCost * 1000) / 1000,
          maxCost:          Math.round(maxCost * 1000) / 1000,
          priceDelta:       Math.round((maxCost - minCost) * 1000) / 1000,
          maxAnnualSavings,
          locations:        locationEntries,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b as any).maxAnnualSavings - (a as any).maxAnnualSavings);

    res.json(result);
  } catch (err) {
    next(err);
  }
}
