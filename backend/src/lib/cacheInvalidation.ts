/**
 * Cache invalidation helpers for write controllers.
 *
 * These are called fire-and-forget (`void invalidate*(...)`) immediately after
 * the DB write commits.  They run in the background so they never add latency
 * to the HTTP response.  The worst case if Redis is down or the call throws is
 * that the next read is a cache miss — the DB always serves as the fallback.
 *
 * Design:
 * - Restaurant-level keys (daily report, COGS-to-sales, GM dashboard) are
 *   invalidated using the restaurantId available on req.user.
 * - Owner-level keys (P&L, owner dashboard) require a single extra DB lookup
 *   to resolve ownerAccountId from restaurantId.  Since this runs in the
 *   background it's not on the response critical path.
 */

import { cacheInvalidate, cacheInvalidatePattern } from "./cache";
import {
  patternDailyReport,
  patternCogsToSales,
  patternGmDashboard,
  patternOwnerDashboard,
  patternOwnerPnl,
  patternOwnerPnlSummary,
  keyCogsCategories,
} from "./cacheKeys";
import { prisma } from "./prisma";

// ── Private helper ────────────────────────────────────────────────────────────

/**
 * Resolves the ownerAccountId for a restaurant from the DB.
 * Returns null if the restaurant has no owner or the lookup fails.
 * Never throws — any error is swallowed; callers gracefully skip owner-level
 * invalidation.
 */
async function getOwnerForRestaurant(restaurantId: string): Promise<string | null> {
  try {
    const row = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { ownerAccountId: true },
    });
    return row?.ownerAccountId ?? null;
  } catch {
    return null;
  }
}

// ── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Invalidate all financial caches affected by a sales or order-receive write.
 *
 * Covers:
 *   • Daily report   (restaurantId-scoped)
 *   • COGS-to-sales  (restaurantId-scoped)
 *   • GM dashboard   (restaurantId-scoped)
 *   • Owner dashboard, P&L, P&L summary (ownerAccountId-scoped)
 *
 * Usage:
 *   void invalidateFinancialCaches(req.user.restaurantId ?? "");
 */
export async function invalidateFinancialCaches(restaurantId: string): Promise<void> {
  // Restaurant-level invalidations run in parallel.
  await Promise.allSettled([
    cacheInvalidatePattern(patternDailyReport(restaurantId)),
    cacheInvalidatePattern(patternCogsToSales(restaurantId)),
    cacheInvalidatePattern(patternGmDashboard(restaurantId)),
  ]);

  // Owner-level invalidations — requires DB lookup.
  const ownerAccountId = await getOwnerForRestaurant(restaurantId);
  if (ownerAccountId) {
    await Promise.allSettled([
      cacheInvalidatePattern(patternOwnerDashboard(ownerAccountId)),
      cacheInvalidatePattern(patternOwnerPnl(ownerAccountId)),
      cacheInvalidatePattern(patternOwnerPnlSummary(ownerAccountId)),
    ]);
  }
}

/**
 * Invalidate caches affected by a labor write.
 *
 * Labor entries don't affect COGS-to-sales or daily inventory reports, but they
 * do flow into the GM dashboard (labor cost %) and all owner-level aggregates.
 *
 * Usage:
 *   void invalidateLaborCaches(req.user.restaurantId ?? "");
 */
export async function invalidateLaborCaches(restaurantId: string): Promise<void> {
  await cacheInvalidatePattern(patternGmDashboard(restaurantId));

  const ownerAccountId = await getOwnerForRestaurant(restaurantId);
  if (ownerAccountId) {
    await Promise.allSettled([
      cacheInvalidatePattern(patternOwnerDashboard(ownerAccountId)),
      cacheInvalidatePattern(patternOwnerPnl(ownerAccountId)),
      cacheInvalidatePattern(patternOwnerPnlSummary(ownerAccountId)),
    ]);
  }
}

/**
 * Invalidate the COGS category list for an owner.
 *
 * Call this after any create / update / delete of a CogsCategory.
 *
 * Usage:
 *   void invalidateCogsCategoryCache(ownerAccountId);
 */
export async function invalidateCogsCategoryCache(ownerAccountId: string): Promise<void> {
  await cacheInvalidate(keyCogsCategories(ownerAccountId));
}
