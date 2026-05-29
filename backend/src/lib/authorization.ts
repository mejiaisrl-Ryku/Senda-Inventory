/**
 * Data Isolation Helpers — OwnerAccount system
 *
 * Role summary:
 *   KYRU_MANAGER      — Kyru internal; unrestricted access across all partners.
 *   OWNER_SUPER_ADMIN — Restaurant group owner; scoped to their ownerAccountId.
 *   ADMIN             — Location admin; scoped to their restaurantId.
 *   STAFF             — Staff; scoped to their restaurantId.
 *   SUPER_ADMIN       — Legacy Kyru admin (kept during migration → KYRU_MANAGER).
 */

import { JwtPayload } from "./jwt";

// ── Prisma where filters ──────────────────────────────────────────────────────

/**
 * Prisma `where` clause for Restaurant queries.
 * KYRU_MANAGER → {} (all restaurants)
 * OWNER_SUPER_ADMIN → { ownerAccountId }
 * ADMIN/STAFF → not applicable; use restaurantFilter instead
 */
export function ownerRestaurantFilter(user: JwtPayload): Record<string, unknown> | null {
  const { role, ownerAccountId } = user;
  if (role === "KYRU_MANAGER" || role === "SUPER_ADMIN") return {};
  if (role === "OWNER_SUPER_ADMIN") {
    return ownerAccountId ? { ownerAccountId } : null;
  }
  return null; // ADMIN/STAFF: not applicable for cross-location queries
}

/**
 * Prisma `where` clause for single-location queries.
 * KYRU_MANAGER / OWNER_SUPER_ADMIN → null (not applicable)
 * ADMIN / STAFF → { restaurantId }
 */
export function restaurantFilter(user: JwtPayload): Record<string, unknown> | null {
  const { role, restaurantId } = user;
  if (role === "KYRU_MANAGER" || role === "SUPER_ADMIN" || role === "OWNER_SUPER_ADMIN") {
    return null;
  }
  return restaurantId ? { restaurantId } : null;
}

// ── Access guards ─────────────────────────────────────────────────────────────

/**
 * Returns true when the authenticated user may read/write to the given restaurant.
 * @param ownedIds Optional list of restaurant IDs cached in the JWT for OWNER_SUPER_ADMIN.
 */
export function canAccessRestaurant(
  user: JwtPayload,
  restaurantId: string,
  ownedIds?: string[]
): boolean {
  const { role } = user;
  if (role === "KYRU_MANAGER" || role === "SUPER_ADMIN") return true;
  if (role === "OWNER_SUPER_ADMIN") {
    if (ownedIds) return ownedIds.includes(restaurantId);
    // Fall back to ownerAccountId check (requires a DB lookup at call site).
    return false;
  }
  return user.restaurantId === restaurantId;
}

/**
 * Returns true when the authenticated user may access the given OwnerAccount.
 */
export function canAccessOwnerAccount(
  user: JwtPayload,
  ownerAccountId: string
): boolean {
  const { role } = user;
  if (role === "KYRU_MANAGER" || role === "SUPER_ADMIN") return true;
  if (role === "OWNER_SUPER_ADMIN") return user.ownerAccountId === ownerAccountId;
  return false;
}
