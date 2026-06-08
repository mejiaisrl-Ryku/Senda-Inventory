/**
 * Tenant-namespaced cache key builders.
 *
 * Every key begins with `senda:` so they can be selectively flushed or
 * monitored in Redis without touching keys from other apps.
 *
 * Tenant isolation guarantee:
 *   Keys scoped to a restaurant always contain the restaurantId segment.
 *   Keys scoped to an owner always contain the ownerAccountId segment.
 *   There is NO cross-tenant key — a lookup for tenant A can never return
 *   data stored under tenant B because the IDs are embedded in the key name.
 *
 * Pattern convention for bulk invalidation:
 *   Use `owner:{id}:*` or `restaurant:{id}:*` globs with SCAN + DEL.
 *   Never use bare `*` — that would sweep unrelated tenants.
 */

// ── Namespaced key prefix ─────────────────────────────────────────────────────

const PREFIX = "senda";

// ── Key builders ──────────────────────────────────────────────────────────────

/**
 * GM dashboard metrics for a single restaurant.
 * Parameterised by optional date range so that custom-range requests get their
 * own cache slot and don't pollute the "default last-30-days" slot.
 */
export function keyGmDashboard(
  restaurantId: string,
  startDate?: string | null,
  endDate?: string | null,
): string {
  const range = startDate && endDate ? `${startDate}:${endDate}` : "default";
  return `${PREFIX}:restaurant:${restaurantId}:gm-dashboard:${range}`;
}

/** Pattern to invalidate all GM-dashboard slots for a restaurant. */
export function patternGmDashboard(restaurantId: string): string {
  return `${PREFIX}:restaurant:${restaurantId}:gm-dashboard:*`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner dashboard — aggregates across all locations.
 */
export function keyOwnerDashboard(
  ownerAccountId: string,
  startDate?: string | null,
  endDate?: string | null,
): string {
  const range = startDate && endDate ? `${startDate}:${endDate}` : "default";
  return `${PREFIX}:owner:${ownerAccountId}:dashboard:${range}`;
}

export function patternOwnerDashboard(ownerAccountId: string): string {
  return `${PREFIX}:owner:${ownerAccountId}:dashboard:*`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner P&L report — requires explicit date range (enforced by the controller).
 */
export function keyOwnerPnl(
  ownerAccountId: string,
  startDate: string,
  endDate: string,
): string {
  return `${PREFIX}:owner:${ownerAccountId}:pnl:${startDate}:${endDate}`;
}

export function patternOwnerPnl(ownerAccountId: string): string {
  return `${PREFIX}:owner:${ownerAccountId}:pnl:*`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner P&L summary — same date-range scoping.
 */
export function keyOwnerPnlSummary(
  ownerAccountId: string,
  startDate: string,
  endDate: string,
): string {
  return `${PREFIX}:owner:${ownerAccountId}:pnl-summary:${startDate}:${endDate}`;
}

export function patternOwnerPnlSummary(ownerAccountId: string): string {
  return `${PREFIX}:owner:${ownerAccountId}:pnl-summary:*`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daily stock/inventory report — one slot per restaurant per calendar day.
 */
export function keyDailyReport(restaurantId: string, date: string): string {
  return `${PREFIX}:restaurant:${restaurantId}:daily:${date}`;
}

export function patternDailyReport(restaurantId: string): string {
  return `${PREFIX}:restaurant:${restaurantId}:daily:*`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * COGS-to-sales report — keyed by restaurant + date range.
 */
export function keyCogsToSales(
  restaurantId: string,
  startDate: string,
  endDate: string,
): string {
  return `${PREFIX}:restaurant:${restaurantId}:cogs-to-sales:${startDate}:${endDate}`;
}

export function patternCogsToSales(restaurantId: string): string {
  return `${PREFIX}:restaurant:${restaurantId}:cogs-to-sales:*`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * COGS category list — relatively static, longer TTL is safe here.
 * Invalidated immediately on any create/update/delete of a cogsCategory.
 */
export function keyCogsCategories(ownerAccountId: string): string {
  return `${PREFIX}:owner:${ownerAccountId}:cogs-categories`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience: all owner-level cache keys for a given ownerAccountId.
 * Use this in write controllers that affect owner-scoped data (P&L, dashboard).
 */
export function patternOwnerAll(ownerAccountId: string): string {
  return `${PREFIX}:owner:${ownerAccountId}:*`;
}

/**
 * Convenience: all restaurant-level cache keys for a given restaurantId.
 */
export function patternRestaurantAll(restaurantId: string): string {
  return `${PREFIX}:restaurant:${restaurantId}:*`;
}
