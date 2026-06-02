/**
 * Calculates the new weighted average unit cost when combining existing inventory
 * with a new purchase.
 *
 * Formula: (existingQty × existingCost + incomingQty × incomingCost) / totalQty
 *
 * Edge cases:
 * - incomingQty === 0  → return existingCost unchanged (no purchase)
 * - existingQty === 0  → return incomingCost (first purchase)
 * - All costs validated upstream as > 0 via Zod schema on OrderItem
 *
 * @throws if any parameter is NaN or negative
 */
export function weightedAverageCost(
  existingQty: number,
  existingCost: number,
  incomingQty: number,
  incomingCost: number,
): number {
  if (
    isNaN(existingQty) || isNaN(existingCost) ||
    isNaN(incomingQty) || isNaN(incomingCost)
  ) {
    throw new Error("Invalid costing parameters: NaN detected");
  }
  if (existingQty < 0 || incomingQty < 0) {
    throw new Error("Invalid costing parameters: negative quantity");
  }
  if (existingCost < 0 || incomingCost < 0) {
    throw new Error("Invalid costing parameters: negative cost");
  }

  if (incomingQty === 0) return existingCost;

  const totalQty   = existingQty + incomingQty;
  const totalValue = existingQty * existingCost + incomingQty * incomingCost;

  return Math.round((totalValue / totalQty) * 10000) / 10000;
}

/**
 * Calculates the COGS contribution of a single stock depletion log entry.
 *
 * Prefers StockLog.unitCost (cost snapshot at transaction time) over the
 * product's current costPerUnit, so historical COGS remain stable after
 * subsequent cost updates.
 *
 * @param change       - StockLog.change (negative for depletions)
 * @param unitCost     - StockLog.unitCost (null on legacy records pre-migration)
 * @param fallbackCost - Product.costPerUnit (used only when unitCost is null)
 */
export function calculateCOGSFromDepletion(
  change: number,
  unitCost: number | null,
  fallbackCost: number,
): number {
  return Math.abs(change) * (unitCost ?? fallbackCost);
}
