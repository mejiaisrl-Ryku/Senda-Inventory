/** Client-side mirror of backend/src/lib/ingredientCosting.ts — used to show a
 *  live cost preview while editing ingredient lines, before saving. */

/** Normalize product unit aliases to match recipe/preparation unit names. */
export function canonUnit(u: string): string {
  const aliases: Record<string, string> = { PIECES: "PCS", LITERS: "L" };
  return aliases[u] ?? u;
}

/** Maps a product's purchase unit to a sensible default line-item unit. */
export function toLineUnit(productUnit: string): string {
  const map: Record<string, string> = { PIECES: "PCS", LITERS: "L", CS: "OZ", DOZ: "OZ" };
  return map[productUnit] ?? productUnit;
}

/**
 * Returns "line units per 1 purchase unit" for pairs we auto-convert.
 * Returns null when the user must provide a manual conversionFactor.
 *
 * Auto-convertible:  G↔KG (1000)  OZ↔LB (16)  ML↔L (1000)  identical (1)
 */
export function getAutoFactor(lineUnit: string, purchaseUnit: string): number | null {
  const l = canonUnit(lineUnit);
  const p = canonUnit(purchaseUnit);
  if (l === p) return 1;
  const table: Record<string, Record<string, number>> = {
    G:  { KG: 1000  },
    KG: { G: 0.001  },
    OZ: { LB: 16    },
    LB: { OZ: 0.0625 },
    ML: { L: 1000   },
    L:  { ML: 0.001 },
  };
  return table[l]?.[p] ?? null;
}

/** Returns true when the user must enter a manual conversion factor. */
export function needsConversionInput(lineUnit: string, purchaseUnit: string): boolean {
  return getAutoFactor(lineUnit, purchaseUnit) === null;
}

/** Cost of one ingredient line, given its quantity/unit/conversionFactor and the product's costPerUnit. */
export function lineCost(args: {
  quantity:         string;
  unit:             string;
  productUnit:      string;
  costPerUnit:      number;
  conversionFactor: string;
}): number {
  const q = parseFloat(args.quantity);
  if (isNaN(q) || q <= 0) return 0;

  const autoFactor = getAutoFactor(args.unit, args.productUnit);
  if (autoFactor !== null) {
    return (q / autoFactor) * args.costPerUnit;
  }

  const cf = parseFloat(args.conversionFactor);
  if (isNaN(cf) || cf <= 0) return 0;
  return (q / cf) * args.costPerUnit;
}
