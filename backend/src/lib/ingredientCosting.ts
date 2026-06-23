/**
 * Shared ingredient-cost math used by both recipes and preparations: each
 * has its own list of {product, quantity, unit, conversionFactor} rows, and
 * the cost formula (unit auto-conversion or stored conversionFactor) is
 * identical for both.
 */

/** Normalize unit aliases so G/KG/OZ/LB/ML/L comparisons work regardless of
 *  whether the source is a Product unit (PIECES, LITERS) or a recipe unit (PCS, L). */
function canonUnit(u: string): string {
  const aliases: Record<string, string> = { PIECES: "PCS", LITERS: "L" };
  return aliases[u] ?? u;
}

/**
 * Returns "recipe units per 1 purchase unit" for pairs we can auto-convert.
 * Returns null when the caller must supply a manual conversionFactor.
 *
 * Auto-convertible pairs:
 *   G  ↔ KG    : 1000 G / KG
 *   OZ ↔ LB    : 16 OZ / LB
 *   ML ↔ L     : 1000 ML / L
 *   identical  : 1
 */
export function getAutoFactor(recipeUnit: string, purchaseUnit: string): number | null {
  const r = canonUnit(recipeUnit);
  const p = canonUnit(purchaseUnit);
  if (r === p) return 1;
  const table: Record<string, Record<string, number>> = {
    G:  { KG: 1000 },
    KG: { G: 0.001 },
    OZ: { LB: 16   },
    LB: { OZ: 0.0625 },
    ML: { L: 1000  },
    L:  { ML: 0.001 },
  };
  return table[r]?.[p] ?? null;
}

export function num(v: unknown): number {
  return typeof v === "object" ? parseFloat(String(v)) : Number(v);
}

export function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Sum ingredient costs (raw products only). */
export function ingredientCost(
  ingredients: Array<{
    quantity:         unknown;
    unit:             string;
    conversionFactor: unknown;
    product:          { costPerUnit: unknown; unit: string };
  }>
): number {
  return ingredients.reduce((sum, ing) => {
    const q    = num(ing.quantity);
    const cost = num(ing.product.costPerUnit);

    const autoFactor = getAutoFactor(ing.unit, ing.product.unit);
    if (autoFactor !== null) {
      // Same system: cost = (q / factor) × costPerUnit
      return sum + (q / autoFactor) * cost;
    }

    // Cross-system: use the stored conversionFactor
    const cf = ing.conversionFactor ? num(ing.conversionFactor) : 0;
    if (cf <= 0) return sum; // incomplete — exclude from total
    return sum + (q / cf) * cost;
  }, 0);
}
