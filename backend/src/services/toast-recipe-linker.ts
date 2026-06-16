import { prisma } from "../lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MenuItemWithCost {
  toastItemId:   string;
  toastItemName: string;
  kyruRecipeId:  string | null;
  recipeName:    string | null;
  recipeCost:    number | null;   // sum of ingredient qty × costPerUnit
  lastSyncedAt:  Date;
}

export interface COGSLineItem {
  toastItemId:   string;
  itemName:      string;
  qtySold:       number;
  revenue:       number;
  recipeCost:    number;   // cost per unit × qtySold
  costPct:       number;   // recipeCost / revenue × 100
}

export interface COGSReport {
  startDate:  string;
  endDate:    string;
  items:      COGSLineItem[];
  totalCost:  number;
  totalRev:   number;
  blendedPct: number;
}

export interface VarianceFlag {
  toastItemId: string;
  itemName:    string;
  costPct:     number;
  benchmark:   number;
  gap:         number;   // costPct − benchmark
  qtySold:     number;
  revenue:     number;
  recipeCost:  number;
}

export interface AutoLinkResult {
  linked:  number;
  skipped: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Normalise a string for fuzzy comparison (lower, trim, collapse whitespace). */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Simple character-level overlap coefficient (intersection / min length). */
function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  const setA = new Set(na.split(""));
  const setB = new Set(nb.split(""));
  let overlap = 0;
  for (const c of setA) { if (setB.has(c)) overlap++; }
  return overlap / Math.min(setA.size, setB.size);
}

/** Calculate the total ingredient cost for a recipe (sum qty × costPerUnit). */
async function recipeCostFor(recipeId: string): Promise<number> {
  const ingredients = await (prisma as any).recipeIngredient.findMany({
    where:   { recipeId },
    include: { product: { select: { costPerUnit: true } } },
  });
  return (ingredients as Array<{ quantity: number; conversionFactor: number | null; product: { costPerUnit: number } }>)
    .reduce((sum, ri) => {
      const factor = ri.conversionFactor ?? 1;
      return sum + ri.quantity * factor * ri.product.costPerUnit;
    }, 0);
}

// ── Exported functions ─────────────────────────────────────────────────────────

/** Return all menu items for a restaurant, each with their linked recipe cost. */
export async function getMenuItemsWithCost(restaurantId: string): Promise<MenuItemWithCost[]> {
  const items = await (prisma as any).toastMenuItem.findMany({
    where:   { restaurantId },
    include: {
      recipe: {
        select: {
          id:          true,
          name:        true,
          ingredients: { include: { product: { select: { costPerUnit: true } } } },
        },
      },
    },
    orderBy: { toastItemName: "asc" },
  });

  return items.map((item: any) => {
    let recipeCost: number | null = null;
    if (item.recipe) {
      recipeCost = item.recipe.ingredients.reduce((sum: number, ri: any) => {
        const factor = ri.conversionFactor ?? 1;
        return sum + ri.quantity * factor * ri.product.costPerUnit;
      }, 0);
    }
    return {
      toastItemId:   item.toastItemId,
      toastItemName: item.toastItemName,
      kyruRecipeId:  item.kyruRecipeId,
      recipeName:    item.recipe?.name ?? null,
      recipeCost,
      lastSyncedAt:  item.lastSyncedAt,
    };
  });
}

/** Link (or unlink when recipeId is null) a Toast menu item to a Kyru recipe. */
export async function linkMenuItemToRecipe(
  restaurantId: string,
  toastItemId:  string,
  recipeId:     string | null,
): Promise<void> {
  await (prisma as any).toastMenuItem.updateMany({
    where: { restaurantId, toastItemId },
    data:  { kyruRecipeId: recipeId },
  });
}

/**
 * Auto-link menu items to recipes by name similarity (threshold ≥ 0.7).
 * Only updates items that are currently unlinked.
 */
export async function autoLinkByName(restaurantId: string): Promise<AutoLinkResult> {
  const [menuItems, recipes] = await Promise.all([
    (prisma as any).toastMenuItem.findMany({
      where:  { restaurantId, kyruRecipeId: null },
      select: { toastItemId: true, toastItemName: true },
    }),
    (prisma as any).recipe.findMany({
      where:  { restaurantId },
      select: { id: true, name: true },
    }),
  ]);

  let linked = 0;
  let skipped = 0;

  for (const item of menuItems as Array<{ toastItemId: string; toastItemName: string }>) {
    let bestScore = 0;
    let bestRecipeId: string | null = null;

    for (const recipe of recipes as Array<{ id: string; name: string }>) {
      const score = similarity(item.toastItemName, recipe.name);
      if (score > bestScore) {
        bestScore = score;
        bestRecipeId = recipe.id;
      }
    }

    if (bestScore >= 0.7 && bestRecipeId) {
      await (prisma as any).toastMenuItem.updateMany({
        where: { restaurantId, toastItemId: item.toastItemId },
        data:  { kyruRecipeId: bestRecipeId },
      });
      linked++;
    } else {
      skipped++;
    }
  }

  return { linked, skipped };
}

/**
 * Calculate a COGS report for a date range.
 * For each sold Toast item that has a linked recipe, compute recipeCost × qtySold.
 */
export async function calculateCOGSReport(
  restaurantId: string,
  startDate:    Date,
  endDate:      Date,
): Promise<COGSReport> {
  const txs = await (prisma as any).toastTransaction.findMany({
    where: {
      restaurantId,
      transactionDate: { gte: startDate, lte: endDate },
    },
    select: { itemDetails: true, amount: true },
  });

  // Aggregate qty and revenue by toastItemId.
  const aggr: Record<string, { name: string; qtySold: number; revenue: number }> = {};
  for (const tx of txs as Array<{ itemDetails: any; amount: number }>) {
    const items = Array.isArray(tx.itemDetails) ? tx.itemDetails : [];
    for (const it of items as Array<{ toastItemId: string; name: string; qty: number; unitPrice: number }>) {
      if (!aggr[it.toastItemId]) {
        aggr[it.toastItemId] = { name: it.name, qtySold: 0, revenue: 0 };
      }
      aggr[it.toastItemId].qtySold += it.qty ?? 0;
      aggr[it.toastItemId].revenue += (it.qty ?? 0) * (it.unitPrice ?? 0);
    }
  }

  // Fetch all linked menu items for this restaurant in one query.
  const menuItems = await (prisma as any).toastMenuItem.findMany({
    where:   { restaurantId, kyruRecipeId: { not: null } },
    include: {
      recipe: {
        include: { ingredients: { include: { product: { select: { costPerUnit: true } } } } },
      },
    },
  });

  const costByToastItemId: Record<string, number> = {};
  for (const mi of menuItems as any[]) {
    if (!mi.recipe) continue;
    const cost = mi.recipe.ingredients.reduce((sum: number, ri: any) => {
      return sum + ri.quantity * (ri.conversionFactor ?? 1) * ri.product.costPerUnit;
    }, 0);
    costByToastItemId[mi.toastItemId] = cost;
  }

  const items: COGSLineItem[] = [];
  let totalCost = 0;
  let totalRev  = 0;

  for (const [toastItemId, { name, qtySold, revenue }] of Object.entries(aggr)) {
    const unitCost  = costByToastItemId[toastItemId] ?? 0;
    const recipeCost = unitCost * qtySold;
    const costPct    = revenue > 0 ? (recipeCost / revenue) * 100 : 0;

    if (unitCost > 0) {
      items.push({ toastItemId, itemName: name, qtySold, revenue, recipeCost, costPct });
      totalCost += recipeCost;
      totalRev  += revenue;
    }
  }

  items.sort((a, b) => b.costPct - a.costPct);

  return {
    startDate:  startDate.toISOString().split("T")[0],
    endDate:    endDate.toISOString().split("T")[0],
    items,
    totalCost,
    totalRev,
    blendedPct: totalRev > 0 ? (totalCost / totalRev) * 100 : 0,
  };
}

/**
 * Return menu items whose cost% exceeds the benchmark threshold.
 * Default benchmark: 30% (industry standard for food cost).
 */
export async function getVarianceFlags(
  restaurantId: string,
  startDate:    Date,
  endDate:      Date,
  benchmark    = 30,
): Promise<VarianceFlag[]> {
  const report = await calculateCOGSReport(restaurantId, startDate, endDate);
  return report.items
    .filter((i) => i.costPct > benchmark)
    .map((i) => ({
      toastItemId: i.toastItemId,
      itemName:    i.itemName,
      costPct:     i.costPct,
      benchmark,
      gap:         i.costPct - benchmark,
      qtySold:     i.qtySold,
      revenue:     i.revenue,
      recipeCost:  i.recipeCost,
    }));
}
