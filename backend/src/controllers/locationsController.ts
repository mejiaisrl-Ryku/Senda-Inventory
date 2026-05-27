import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ══ DATA ISOLATION — SECURITY BOUNDARY ═══════════════════════════════════════
//
// Every handler in this file follows the same two-step isolation pattern:
//
//   Step 1 — Scope: fetch the primary restaurant + any branches that belong to
//            the same partner group (WHERE groupId = req.user.restaurantId).
//            The JWT-derived restaurantId is the authoritative source of truth;
//            no client-supplied parameter can override it.
//
//   Step 2 — Filter: all downstream DB queries use `restaurantId: { in: allIds }`
//            where allIds is derived exclusively from Step 1. This guarantees
//            that no row from another partner's group can be returned, regardless
//            of query structure.
//
// Threat model:
//   ✅ Cross-partner leakage impossible — groupId scope is server-enforced.
//   ✅ JWT tampering rejected — the auth middleware validates the token before
//      this code runs and rejects forged or expired tokens (HTTP 401/403).
//   ✅ URL / query-string manipulation ignored — restaurantId always comes from
//      req.user (the verified JWT payload), never from req.query or req.params.
//   ✅ Single-location users see only their own restaurant (branches = []).
//
// ══════════════════════════════════════════════════════════════════════════════

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

    // Step 1 — Scope: primary restaurant + branches in this partner group only.
    const [userRestaurant, branches] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true, logo: true },
      }),
      prisma.restaurant.findMany({
        where:   { groupId: restaurantId }, // ← isolation: only this partner's branches
        select:  { id: true, name: true, logo: true },
        orderBy: { name: "asc" },
      }),
    ]);

    if (!userRestaurant) return res.status(404).json({ error: "Restaurant not found" });

    const allRestaurants = [
      { ...userRestaurant, isTest: false, isPrimary: true },
      ...branches.map((r) => ({
        ...r,
        isTest: true,
        isPrimary: false,
        // Strip the TEST_ prefix if present (legacy seeded names)
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
          isPrimary:    r.isPrimary,
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

    // Step 1 — Scope: primary restaurant + branches in this partner group only.
    const [userRestaurant, branches] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true },
      }),
      prisma.restaurant.findMany({
        where:   { groupId: restaurantId }, // ← isolation: only this partner's branches
        select:  { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    if (!userRestaurant) return res.status(404).json({ error: "Restaurant not found" });

    const allRestaurants = [
      { id: userRestaurant.id, name: userRestaurant.name, isTest: false },
      ...branches.map((r) => ({
        id:     r.id,
        name:   r.name.replace(/^TEST_/, ""),
        isTest: true,
      })),
    ];

    const allIds = allRestaurants.map((r) => r.id);

    // Step 2 — Filter: all queries below are scoped to allIds (this partner only).
    const allRecipes = await (prisma as any).recipe.findMany({
      where:   { restaurantId: { in: allIds } }, // ← isolation enforced
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

// ── Unit-normalization helpers ─────────────────────────────────────────────────

// Prefer larger, more human-readable units when choosing a canonical unit.
const UNIT_PRIORITY: Record<string, number> = {
  LB: 10, KG: 9, L: 9, CS: 8, DOZ: 7, LITERS: 9,
  OZ: 3,  G: 2,  ML: 1,
};

function pickCanonicalUnit(units: string[]): string {
  if (units.length === 0) return "UNIT";
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u, (counts.get(u) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];                          // most frequent first
    return (UNIT_PRIORITY[b[0]] ?? 5) - (UNIT_PRIORITY[a[0]] ?? 5); // then highest priority
  });
  return sorted[0][0];
}

// Convert a unit cost from `fromUnit` to `toUnit`.
// Returns null when no conversion path exists (incompatible dimensions).
function convertCostPerUnit(cost: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return cost;
  const factor = autoConversionFactor(fromUnit, toUnit);
  if (factor === null) return null;
  // factor = "X fromUnits per 1 toUnit", so: costPerToUnit = costPerFromUnit * factor
  return cost * factor;
}

// Convert a quantity from `fromUnit` to `toUnit`.
function convertQty(qty: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return qty;
  const factor = autoConversionFactor(fromUnit, toUnit);
  if (factor === null) return null;
  return qty / factor;
}

/**
 * GET /api/locations/vendor-pricing
 *
 * Returns all products purchased in the last 30 days across this partner's
 * locations, grouped by normalized product name.  Handles unit mismatches
 * (e.g. OZ vs LB) by converting everything to a canonical unit.  Each product
 * group exposes all purveyors per location so users can compare and identify
 * consolidation opportunities.
 */
export async function getLocationsPricing(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;
    const now30 = daysAgo(30);

    // Step 1 — Scope: primary restaurant + branches in this partner group only.
    const [userRestaurant, branches] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true },
      }),
      prisma.restaurant.findMany({
        where:   { groupId: restaurantId }, // ← isolation: only this partner's branches
        select:  { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    if (!userRestaurant) return res.status(404).json({ error: "Restaurant not found" });

    const allRestaurants = [
      { id: userRestaurant.id, name: userRestaurant.name, isTest: false },
      ...branches.map((r) => ({
        id:     r.id,
        name:   r.name.replace(/^TEST_/, ""),
        isTest: true,
      })),
    ];

    const allIds = allRestaurants.map((r) => r.id);

    // Step 2 — Filter: all queries below are scoped to allIds (this partner only).
    // One batch query — every order item in the last 30 days across all locations.
    // We use ALL items (not just productId-linked ones) so real invoice data is included.
    const items = await (prisma as any).orderItem.findMany({
      where: {
        order: {
          restaurantId: { in: allIds },
          createdAt:    { gte: now30 },
        },
      },
      select: {
        productName: true,
        quantity:    true,
        unitCost:    true,
        unit:        true,
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

    // ── Phase 1: Group raw items ───────────────────────────────────────────────
    //
    // Structure: productName(lower) → locId → purveyorKey → { mostRecentCost, unit, qty30d, date }

    type PurveyorRaw = {
      unitCost:    number;
      unit:        string;
      invoiceDate: string;
      qty30d:      number;
      isMostRecent: boolean; // price locked on first (most recent) encounter
    };

    type ProductGroup = {
      displayName: string;
      byLocByPurveyor: Map<string, Map<string, PurveyorRaw>>; // locId → purveyor → data
    };

    const groupMap = new Map<string, ProductGroup>();

    for (const item of items) {
      const rawName = ((item.productName ?? "") as string).trim();
      if (!rawName || rawName.toLowerCase() === "unknown") continue;

      const groupKey = rawName.toLowerCase();
      const rawUnit  = ((item.unit ?? "UNIT") as string).trim().toUpperCase();
      const locId    = item.order.restaurantId as string;
      const purveyor = ((item.order.purveyor ?? "Unknown vendor") as string).trim();
      const cost     = n(item.unitCost);
      const qty      = n(item.quantity);
      const invDate  = item.order.invoiceDate
        ? (item.order.invoiceDate as Date).toISOString().slice(0, 10)
        : (item.order.createdAt  as Date).toISOString().slice(0, 10);

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { displayName: rawName, byLocByPurveyor: new Map() });
      }
      const group = groupMap.get(groupKey)!;

      if (!group.byLocByPurveyor.has(locId)) {
        group.byLocByPurveyor.set(locId, new Map());
      }
      const byPurveyor = group.byLocByPurveyor.get(locId)!;

      if (!byPurveyor.has(purveyor)) {
        // First encounter = most recent price (items sorted desc)
        byPurveyor.set(purveyor, { unitCost: cost, unit: rawUnit, invoiceDate: invDate, qty30d: qty, isMostRecent: true });
      } else {
        // Accumulate 30-day volume; keep most-recent price
        byPurveyor.get(purveyor)!.qty30d += qty;
      }
    }

    // ── Phase 2: Build result entries ─────────────────────────────────────────

    const result: any[] = [];

    for (const [, group] of groupMap) {
      // Collect all units used across this product's locations/purveyors
      const allUnits: string[] = [];
      for (const byPurveyor of group.byLocByPurveyor.values()) {
        for (const pData of byPurveyor.values()) {
          allUnits.push(pData.unit);
        }
      }
      const canonicalUnit  = pickCanonicalUnit(allUnits);
      const uniqueUnits    = new Set(allUnits);
      const hasUnitMismatch = uniqueUnits.size > 1;

      // Build per-location entries
      const locationEntries = allRestaurants.map((restaurant) => {
        const byPurveyor = group.byLocByPurveyor.get(restaurant.id);
        if (!byPurveyor || byPurveyor.size === 0) {
          return {
            restaurantId: restaurant.id,
            locationName: restaurant.name,
            isTest:       restaurant.isTest,
            hasPurchases: false,
            purveyors:    [] as any[],
            bestNormalizedCost: null as number | null,
            totalQty30d:  0,
          };
        }

        const purveyorEntries: any[] = [];
        for (const [purveyorName, pData] of byPurveyor) {
          const fromUnit       = pData.unit;
          const normalizedCost = convertCostPerUnit(pData.unitCost, fromUnit, canonicalUnit) ?? pData.unitCost;
          const normalizedQty  = convertQty(pData.qty30d, fromUnit, canonicalUnit) ?? pData.qty30d;
          const isConverted    = fromUnit !== canonicalUnit && convertCostPerUnit(pData.unitCost, fromUnit, canonicalUnit) !== null;

          purveyorEntries.push({
            purveyor:       purveyorName,
            originalUnit:   fromUnit,
            originalCost:   Math.round(pData.unitCost    * 1000) / 1000,
            normalizedCost: Math.round(normalizedCost    * 1000) / 1000,
            invoiceDate:    pData.invoiceDate,
            qty30d:         Math.round(normalizedQty     * 100)  / 100,
            isConverted,
          });
        }

        // Sort cheapest first so UI can highlight best purveyor at this location
        purveyorEntries.sort((a, b) => a.normalizedCost - b.normalizedCost);

        const bestNormalizedCost = purveyorEntries[0]?.normalizedCost ?? null;
        const totalQty30d = purveyorEntries.reduce((s, p) => s + p.qty30d, 0);

        return {
          restaurantId:       restaurant.id,
          locationName:       restaurant.name,
          isTest:             restaurant.isTest,
          hasPurchases:       true,
          purveyors:          purveyorEntries,
          bestNormalizedCost: bestNormalizedCost !== null ? Math.round(bestNormalizedCost * 1000) / 1000 : null,
          totalQty30d:        Math.round(totalQty30d * 100) / 100,
        };
      });

      const activeEntries = locationEntries.filter((e) => e.hasPurchases);
      if (activeEntries.length === 0) continue;

      // Cross-location price comparison (using each location's cheapest purveyor)
      const bestCosts = activeEntries
        .map((e) => e.bestNormalizedCost)
        .filter((c): c is number => c !== null);

      const minCost     = bestCosts.length > 0 ? Math.min(...bestCosts) : 0;
      const maxCost     = bestCosts.length > 0 ? Math.max(...bestCosts) : 0;
      const priceDelta  = Math.round((maxCost - minCost) * 1000) / 1000;
      const priceDeltaPct = maxCost > 0 ? Math.round((priceDelta / maxCost) * 1000) / 10 : 0;

      // Total volume & spend (across all locations, using their best purveyor's price)
      const totalQty30d   = activeEntries.reduce((s, e) => s + e.totalQty30d, 0);
      const totalSpend30d = activeEntries.reduce((s, e) => {
        return s + (e.bestNormalizedCost ?? 0) * e.totalQty30d;
      }, 0);

      // Monthly savings: worst location's qty × price gap (if it bought at best price)
      const worstEntry    = activeEntries.find((e) => e.bestNormalizedCost === maxCost);
      const monthlySavings = (worstEntry && priceDelta > 0)
        ? Math.round(priceDelta * worstEntry.totalQty30d * 100) / 100
        : 0;
      const maxAnnualSavings = Math.round(monthlySavings * 12 * 100) / 100;

      // Conversion note for UI
      let conversionNote: string | null = null;
      if (hasUnitMismatch) {
        const foreignUnits = [...uniqueUnits].filter((u) => u !== canonicalUnit);
        conversionNote = `${foreignUnits.join(", ")} → ${canonicalUnit} (converted for comparison)`;
      }

      result.push({
        productName:           group.displayName,
        canonicalUnit,
        hasUnitMismatch,
        conversionNote,
        totalQty30d:           Math.round(totalQty30d * 100)   / 100,
        totalSpend30d:         Math.round(totalSpend30d * 100)  / 100,
        minCost:               Math.round(minCost * 1000)       / 1000,
        maxCost:               Math.round(maxCost * 1000)       / 1000,
        priceDelta,
        priceDeltaPct,
        monthlySavings,
        maxAnnualSavings,
        purchasingLocationCount: activeEntries.length,
        locations:             locationEntries,
      });
    }

    // Sort: multi-location (actionable) first by savings, then single-location by spend
    result.sort((a, b) => {
      const aMulti = a.purchasingLocationCount > 1;
      const bMulti = b.purchasingLocationCount > 1;
      if (aMulti && !bMulti) return -1;
      if (!aMulti && bMulti) return 1;
      return b.maxAnnualSavings - a.maxAnnualSavings || b.totalSpend30d - a.totalSpend30d;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── Location management handlers ──────────────────────────────────────────────

/**
 * GET /api/locations/capacity
 * Returns the partner's location limit and current usage.
 */
export async function getLocationsCapacity(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;

    const [primary, branchCount] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { locationCount: true },
      }),
      prisma.restaurant.count({ where: { groupId: restaurantId } }),
    ]);

    if (!primary) return res.status(404).json({ error: "Restaurant not found" });

    const used  = 1 + branchCount;
    const limit = primary.locationCount;

    res.json({ limit, used, canAdd: used < limit });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/locations/branch
 * Creates a new branch location under the current partner.
 * Requires ADMIN role.
 */
export async function addBranch(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;
    const { name, address, phone } = req.body as {
      name?:    string;
      address?: string;
      phone?:   string;
    };

    // ── Validate name
    const trimmedName = (name ?? "").trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      return res
        .status(400)
        .json({ error: "Location name must be between 2 and 50 characters." });
    }

    // ── Check capacity
    const [primary, branchCount] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { locationCount: true },
      }),
      prisma.restaurant.count({ where: { groupId: restaurantId } }),
    ]);

    if (!primary) return res.status(404).json({ error: "Restaurant not found" });

    if (1 + branchCount >= primary.locationCount) {
      return res.status(409).json({
        error: `Location limit reached (${primary.locationCount}). Contact support to increase your limit.`,
      });
    }

    // ── Check name uniqueness within this partner group
    const allGroupIds = [
      restaurantId,
      ...(await prisma.restaurant.findMany({
        where:  { groupId: restaurantId },
        select: { id: true },
      })).map((r) => r.id),
    ];

    const duplicate = await prisma.restaurant.findFirst({
      where: {
        id:   { in: allGroupIds },
        name: trimmedName,
      },
    });

    if (duplicate) {
      return res.status(409).json({
        error: "A location with that name already exists.",
      });
    }

    // ── Create the branch (cascade deletes already in place on Restaurant)
    const branch = await prisma.restaurant.create({
      data: {
        name:    trimmedName,
        address: address?.trim() || null,
        phone:   phone?.trim()   || null,
        groupId: restaurantId,   // isolation: branch belongs to this partner
      },
      select: { id: true, name: true, address: true, phone: true, groupId: true },
    });

    res.status(201).json(branch);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/locations/branch/:locationId
 * Deletes a branch location (and all its data via cascade).
 * Cannot delete the primary restaurant. Requires ADMIN role.
 */
export async function deleteBranch(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const restaurantId = req.user.restaurantId;
    const { locationId } = req.params;

    // ── Never allow deleting the primary restaurant
    if (locationId === restaurantId) {
      return res
        .status(400)
        .json({ error: "Cannot delete your primary location." });
    }

    // ── Verify ownership: must be a branch of this partner (isolation check)
    const location = await prisma.restaurant.findUnique({
      where:  { id: locationId },
      select: { groupId: true, name: true },
    });

    if (!location || location.groupId !== restaurantId) {
      return res
        .status(403)
        .json({ error: "Location not found or access denied." });
    }

    // ── Delete (all child rows cascade automatically)
    await prisma.restaurant.delete({ where: { id: locationId } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
