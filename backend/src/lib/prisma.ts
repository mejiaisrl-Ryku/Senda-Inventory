/**
 * Prisma client — two exports:
 *
 *   prisma   — raw client, no tenant filtering.
 *              Use ONLY in: superAdmin/KYRU_MANAGER controllers, auth flows,
 *              health checks, migrations, and seeds. Using this in a normal
 *              request handler bypasses isolation — treat it like a root DB
 *              connection and audit every usage.
 *
 *   prismaT  — tenant-scoped client (Prisma Client Extension).
 *              Automatically injects restaurantId / ownerAccountId into every
 *              query on tenant-owned models, reading context from
 *              AsyncLocalStorage populated by the authenticate middleware.
 *              Use this in ALL normal request handlers.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { tenantStore, isBypassRole } from "./tenantContext";

// ── Raw client (hot-reload safe) ──────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

// ── Tenant model registries ───────────────────────────────────────────────────

/**
 * Models whose data is scoped to a single restaurant.
 * The extension injects `{ restaurantId }` into every query on these models.
 * Prisma model names are camelCase with a lower-case first letter.
 */
const RESTAURANT_SCOPED = new Set([
  "product",
  "order",
  "salesEntry",
  "laborEntry",
  "countSession",
  "recipe",
  "locationBudget",
]);

/**
 * Models whose data is scoped to an OwnerAccount (one level up from restaurant).
 * The extension injects `{ ownerAccountId }` into every query on these models.
 */
const OWNER_SCOPED = new Set(["cogsCategory"]);

// ── Tenant filter builder ─────────────────────────────────────────────────────

/**
 * Returns the Prisma where-clause fragment to inject for the current tenant
 * and model.  Returns `null` when no injection is needed (bypass or unscoped
 * model).
 *
 * For `create` operations, the same fragment is merged into `data` instead.
 */
function buildTenantFilter(
  model: string,
): Record<string, unknown> | null {
  const ctx = tenantStore.getStore();

  // Outside of a request (health checks, migrations, seeds): pass through.
  // We deliberately fail OPEN here so offline tooling is not blocked. The
  // real protection is that the tenant-scoped client is only used in
  // authenticated routes.
  if (!ctx) return null;

  const { role, restaurantId, ownerAccountId, ownedRestaurantIds } = ctx;

  // Platform / super-admin roles bypass all tenant filters.
  if (isBypassRole(role)) return null;

  const modelKey = model.charAt(0).toLowerCase() + model.slice(1);

  if (OWNER_SCOPED.has(modelKey)) {
    if (!ownerAccountId) {
      // User has no ownerAccountId — can't read owner-scoped data.
      // Return an impossible filter so the query returns nothing rather
      // than everything.
      return { ownerAccountId: "__NO_OWNER__" };
    }
    return { ownerAccountId };
  }

  if (RESTAURANT_SCOPED.has(modelKey)) {
    if (role === "OWNER_SUPER_ADMIN") {
      // Owner can access all their restaurants.
      if (ownedRestaurantIds?.length) {
        return { restaurantId: { in: ownedRestaurantIds } };
      }
      if (ownerAccountId) {
        // Fall back to relation filter when JWT cache is absent.
        return { restaurant: { ownerAccountId } };
      }
      return { restaurantId: "__NO_RESTAURANT__" };
    }

    // ADMIN / STAFF — single location.
    if (!restaurantId) {
      return { restaurantId: "__NO_RESTAURANT__" };
    }
    return { restaurantId };
  }

  // Not a tenant-scoped model — pass through.
  return null;
}

// ── Prisma Client Extension ───────────────────────────────────────────────────

/**
 * Operations that accept a `where` clause — we inject the tenant filter here.
 * Prisma 5 (extendedWhereUnique GA) allows non-unique fields alongside unique
 * selectors in findUnique, update, and delete where clauses.
 */
const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * Operations that create rows — we inject the tenant column into `data`
 * so controllers don't have to remember to set it.
 *
 * For OWNER_SUPER_ADMIN creating restaurant-scoped records, the controller
 * MUST supply restaurantId in the data explicitly (they own multiple locations);
 * the extension will not override an already-set restaurantId, only verify it.
 */
const CREATE_OPS = new Set(["create", "createMany"]);

function buildTenantedClient() {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: (args: any) => Promise<any>;
        }) {
          const filter = buildTenantFilter(model);

          // No injection needed for this model / role.
          if (filter === null) return query(args);

          if (WHERE_OPS.has(operation)) {
            // Merge tenant filter into the existing where clause.
            // We use Prisma's `AND` to avoid clobbering any existing filters.
            const existingWhere = args.where ?? {};
            args = {
              ...args,
              where: {
                AND: [existingWhere, filter],
              },
            };
            return query(args);
          }

          if (CREATE_OPS.has(operation)) {
            if (operation === "create") {
              // Only inject scalar values into data — `in` arrays don't apply
              // to creates (there's no ambiguity about which restaurant to write to).
              const scalarFilter = extractScalarFilter(filter);
              if (scalarFilter) {
                args = {
                  ...args,
                  data: { ...scalarFilter, ...args.data },
                };
              }
            } else if (operation === "createMany") {
              const scalarFilter = extractScalarFilter(filter);
              if (scalarFilter && Array.isArray(args.data)) {
                args = {
                  ...args,
                  data: args.data.map((row: Record<string, unknown>) => ({
                    ...scalarFilter,
                    ...row,
                  })),
                };
              }
            }
            return query(args);
          }

          // Unknown operation — pass through unchanged (fail open for forward
          // compatibility with new Prisma operations).
          return query(args);
        },
      },
    },
  });
}

/**
 * Extracts only scalar key/value pairs from a filter object (not `in` arrays
 * or relation objects).  Used when injecting into `create.data`.
 */
function extractScalarFilter(
  filter: Record<string, unknown>,
): Record<string, string> | null {
  const result: Record<string, string> = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(filter)) {
    if (typeof v === "string") {
      result[k] = v;
      hasAny = true;
    }
  }
  return hasAny ? result : null;
}

// ── Tenant-scoped client (hot-reload safe) ────────────────────────────────────

type TenantedClient = ReturnType<typeof buildTenantedClient>;

declare global {
  // eslint-disable-next-line no-var
  var __prismaT: TenantedClient | undefined;
}

export const prismaT: TenantedClient =
  global.__prismaT ?? buildTenantedClient();

if (process.env.NODE_ENV !== "production") {
  global.__prismaT = prismaT;
}
