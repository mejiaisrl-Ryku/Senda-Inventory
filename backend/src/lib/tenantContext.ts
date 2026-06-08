/**
 * Tenant context — AsyncLocalStorage singleton.
 *
 * Populated once per request by the `authenticate` middleware after JWT
 * verification. Every downstream Prisma call reads from here via the
 * tenant-scoped client extension.
 *
 * NEVER populate from a client-supplied header or request body — those are
 * spoofable. The context is derived exclusively from the verified JWT identity.
 */

import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  userId: string;
  role: string;
  /** Populated for ADMIN / STAFF — their single location. */
  restaurantId?: string;
  /** Populated for OWNER_SUPER_ADMIN and for ADMIN/STAFF whose restaurant
   *  has been assigned to an OwnerAccount. */
  ownerAccountId?: string;
  /** Populated for OWNER_SUPER_ADMIN — cached list of owned restaurant IDs
   *  from the JWT so we don't need a DB round-trip on every request. */
  ownedRestaurantIds?: string[];
}

export const tenantStore = new AsyncLocalStorage<TenantContext>();

/** Roles that bypass all tenant filters and can read/write across all tenants. */
export const BYPASS_ROLES = new Set(["KYRU_MANAGER", "SUPER_ADMIN"]);

/**
 * True when the current role should bypass tenant filtering entirely.
 * Only KYRU_MANAGER (Kyru internal) and the legacy SUPER_ADMIN have this
 * privilege.  Every other role is tenant-scoped.
 */
export function isBypassRole(role: string): boolean {
  return BYPASS_ROLES.has(role);
}
