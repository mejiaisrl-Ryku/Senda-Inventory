/**
 * Prisma clients — three exports:
 *
 *   prisma      — raw superuser client (postgres role).
 *                 Use ONLY in: migrations helpers, seeds, health checks.
 *                 NOT for request handlers — bypasses RLS entirely.
 *
 *   prismaT     — tenant-scoped client (connects as senda_app).
 *                 Two enforcement layers:
 *                   1. WHERE-clause injection via Prisma Client Extension
 *                   2. PostgreSQL RLS policy check via SET LOCAL GUC
 *                 Use this in ALL normal request handlers.
 *
 *   prismaAdmin — bypass client (connects as senda_admin, BYPASSRLS).
 *                 Use ONLY for KYRU_MANAGER / cross-tenant platform reads.
 *                 Never expose to OWNER_SUPER_ADMIN or below.
 *
 * ─── Connection strings ───────────────────────────────────────────────────
 *   DATABASE_URL       → senda_app role (pooled, PgBouncer transaction mode)
 *   ADMIN_DATABASE_URL → senda_admin role (pooled, BYPASSRLS)
 *   DIRECT_URL         → postgres superuser (direct, migrations only)
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "async_hooks";
import * as Sentry from "@sentry/node";
import { tenantStore, isBypassRole } from "./tenantContext";

// ── Connection-pool helpers ───────────────────────────────────────────────────
//
// Each Railway replica creates one PrismaClient per role (prisma, prismaApp,
// prismaAdmin).  The pool size controls how many idle Postgres connections that
// replica holds.  Formula for a safe default:
//
//   floor(max_connections / (3 roles × expected_replicas)) − 2  (safety margin)
//
// With Railway Postgres default max_connections=100, 2 replicas, 3 roles:
//   floor(100 / (3 × 2)) − 2 = 14
//
// Override with DATABASE_POOL_SIZE env var in Railway to tune without a deploy.
//
// PgBouncer (transaction mode) must be in the DATABASE_URL for multi-replica
// deployments.  See .env.example for the correct URL format.

function poolSize(): number {
  const v = parseInt(process.env.DATABASE_POOL_SIZE ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 5; // conservative default per role
}

// Log config shared by every client constructor below — emits a "query" event
// (consumed by attachSlowQueryMonitor) plus plain console "warn"/"error".
// Pulled out as a const so its literal type (not just `LogLevel[]`) flows into
// the PrismaClient generic, which is what makes `$on("query", ...)` type-check.
const LOG_OPTIONS: [{ emit: "event"; level: "query" }, "warn", "error"] = [
  { emit: "event", level: "query" },
  "warn",
  "error",
];

type MonitoredPrismaClient = PrismaClient<{ log: typeof LOG_OPTIONS }>;

/**
 * Shared Prisma constructor options.
 * Timeout: 10 s query + 15 s transaction — prevents runaway queries from tying
 * up pool slots indefinitely.
 */
function prismaOptions(extra: ConstructorParameters<typeof PrismaClient>[0] = {}): ConstructorParameters<typeof PrismaClient>[0] {
  return {
    log: LOG_OPTIONS,
    transactionOptions: { timeout: parseInt(process.env.DB_TRANSACTION_TIMEOUT_MS ?? "15000", 10) },
    ...extra,
  };
}

function attachSlowQueryMonitor(client: MonitoredPrismaClient) {
  client.$on("query", (e: Prisma.QueryEvent) => {
    if (e.duration <= 1000) return;
    Sentry.addBreadcrumb({
      category: "db.query",
      message:  `Slow query (${e.duration}ms): ${e.query}`,
      level:    "warning",
      data:     { duration: e.duration, query: e.query },
    });
    if (e.duration > 3000) {
      Sentry.captureMessage("Slow Prisma query detected", "warning");
    }
  });
}

function createMonitoredClient(options: ConstructorParameters<typeof PrismaClient>[0]): PrismaClient {
  const client = new PrismaClient(options);
  // All callers construct via prismaOptions()/LOG_OPTIONS, so the "query" event
  // is always present at runtime even though the parameter above is typed as
  // the generic-default PrismaClient (kept untyped so callers don't have to
  // care about the log generic).
  attachSlowQueryMonitor(client as MonitoredPrismaClient);
  return client;
}

// ── Raw superuser client (hot-reload safe) ────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ?? createMonitoredClient(prismaOptions());

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

// ── Tenant model registries ───────────────────────────────────────────────────

/**
 * Models whose rows are scoped to a single restaurant.
 * The extension injects `{ restaurantId }` and sets `app.restaurant_id` GUC.
 */
const RESTAURANT_SCOPED = new Set([
  "product",
  "order",
  "salesEntry",
  "laborEntry",
  "countSession",
  "recipe",
  "locationBudget",
  "scanJob",
  "preparation",
]);

/**
 * Models whose rows are scoped to an OwnerAccount.
 * The extension injects `{ ownerAccountId }` and sets `app.owner_account_id` GUC.
 */
const OWNER_SCOPED = new Set(["cogsCategory"]);

/**
 * Join/child tables that have no restaurantId column of their own — tenancy
 * is enforced purely by their RLS policy joining back to a scoped parent
 * (e.g. recipe_preparations -> recipes.restaurantId). These models must NOT
 * get WHERE/CREATE filter injection (there's no such column to inject), but
 * they DO need the app.restaurant_id GUC set so the RLS join check passes.
 * Without this, INSERTs on these tables fail RLS WITH CHECK and surface as a
 * 500 (e.g. linking a preparation to a recipe).
 */
const JOIN_SCOPED_GUC_ONLY = new Set([
  "recipePreparation",
  "recipeAllergen",
  "preparationAllergen",
  "recipeIngredient",
  "stockLog",
  "orderItem",
  "countEntry",
  "preparationIngredient",
  "preparationStockLog",
]);

// ── ALS flag: prevents the extension from recursing when it calls prisma.$transaction ──

/**
 * Set to `true` when the extension is already inside a GUC-setting transaction.
 * This prevents each inner call (e.g. inside a user-level prismaT.$transaction)
 * from spawning redundant nested savepoints for the RLS setup.
 */
const rlsTxActive = new AsyncLocalStorage<true>();

// ── Tenant filter builder ─────────────────────────────────────────────────────

function buildTenantFilter(
  model: string,
): Record<string, unknown> | null {
  const ctx = tenantStore.getStore();
  if (!ctx) return null;                    // outside a request — fail open for tooling

  const { role, restaurantId, ownerAccountId, ownedRestaurantIds } = ctx;

  if (isBypassRole(role)) return null;       // KYRU_MANAGER / SUPER_ADMIN

  const modelKey = model.charAt(0).toLowerCase() + model.slice(1);

  if (OWNER_SCOPED.has(modelKey)) {
    return ownerAccountId
      ? { ownerAccountId }
      : { ownerAccountId: "__NO_OWNER__" };
  }

  if (RESTAURANT_SCOPED.has(modelKey)) {
    if (role === "OWNER_SUPER_ADMIN") {
      if (ownedRestaurantIds?.length) {
        return { restaurantId: { in: ownedRestaurantIds } };
      }
      if (ownerAccountId) {
        return { restaurant: { ownerAccountId } };
      }
      return { restaurantId: "__NO_RESTAURANT__" };
    }
    // ADMIN / STAFF — single location
    return restaurantId
      ? { restaurantId }
      : { restaurantId: "__NO_RESTAURANT__" };
  }

  return null;  // unscoped model — pass through
}

// ── Operation sets ────────────────────────────────────────────────────────────

const WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow",
  "findFirst",  "findFirstOrThrow",
  "findMany",
  "update",     "updateMany",
  "delete",     "deleteMany",
  "upsert",
  "count",      "aggregate", "groupBy",
]);

// findUnique/update/delete/upsert take a *WhereUniqueInput* — Prisma requires
// a unique field (e.g. id) at the top level, not wrapped in AND. Wrapping it
// (as done below for the other WHERE_OPS) makes Prisma reject the query with
// "needs at least one of `id` arguments", which surfaced as a 500 on every
// single-record recipe update (e.g. saving a recipe after linking a prep).
// These ops get the tenant filter merged flat alongside the unique field
// instead, relying on Prisma's "extended where unique input" support.
const UNIQUE_WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow",
  "update", "delete", "upsert",
]);

const CREATE_OPS = new Set(["create", "createMany"]);

// ── Scalar filter extractor (for CREATE injection) ────────────────────────────

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

// ── RLS GUC builder ───────────────────────────────────────────────────────────

/**
 * Returns the GUC values to SET LOCAL for the current request context.
 * Returns null when no RLS GUC injection is needed (bypass role or no ctx).
 */
function buildRLSContext(model: string): {
  restaurantId: string;
  ownerAccountId: string;
} | null {
  const ctx = tenantStore.getStore();
  if (!ctx || isBypassRole(ctx.role)) return null;

  const modelKey = model.charAt(0).toLowerCase() + model.slice(1);

  if (
    !RESTAURANT_SCOPED.has(modelKey) &&
    !OWNER_SCOPED.has(modelKey) &&
    !JOIN_SCOPED_GUC_ONLY.has(modelKey)
  ) {
    return null;  // not a tenant model — no GUC needed
  }

  // For restaurant-scoped models, resolve a single restaurantId string for GUC.
  // OWNER_SUPER_ADMIN may own multiple restaurants; in that case we set the GUC
  // to empty string — the RLS policy won't match directly, but the WHERE-injection
  // `restaurantId IN (...)` already scopes the query correctly, and the policy
  // will pass row-by-row because each row's restaurantId IS in the owned set.
  // Actually: we use the `IN` approach in WHERE injection, so RLS must also pass.
  // Solution: for OWNER_SUPER_ADMIN, set GUC to empty and rely solely on WHERE injection
  // for the restaurant filter — but add a DB-level OWNER policy for them.
  // For simplicity: OWNER_SUPER_ADMIN operations go through prismaAdmin
  // (senda_admin has BYPASSRLS). This is safe: OWNER_SUPER_ADMIN is scoped
  // by the WHERE injection to their own restaurants; the admin DB role only
  // provides BYPASSRLS, not cross-tenant access (that is still controlled in app layer).
  //
  // This means OWNER_SUPER_ADMIN and KYRU_MANAGER BOTH use prismaAdmin for queries.
  // See note in CONTRIBUTING.md.

  const { role, restaurantId, ownerAccountId } = ctx;

  if (role === "OWNER_SUPER_ADMIN") {
    // Owner-scoped tables (cogs_categories): a single ownerAccountId GUC works.
    if (OWNER_SCOPED.has(modelKey)) {
      return { restaurantId: "", ownerAccountId: ownerAccountId ?? "" };
    }
    // Restaurant-scoped tables: OWNER_SUPER_ADMIN may own multiple restaurants,
    // so a single restaurantId GUC is insufficient.  Return null → no GUC injection.
    // The WHERE injection already scopes to ownedRestaurantIds via IN clause.
    // Controllers using prismaT for OWNER_SUPER_ADMIN restaurant queries MUST
    // use a BYPASSRLS base client (prismaAdmin) to avoid RLS blocking them.
    return null;
  }

  return {
    restaurantId:    restaurantId    ?? "",
    ownerAccountId:  ownerAccountId  ?? "",
  };
}

// ── Prisma Client Extension (WHERE injection + RLS GUC wrapping) ──────────────

/**
 * Builds a tenant-scoped Prisma client that:
 *   1. Injects restaurantId / ownerAccountId into WHERE clauses (app layer).
 *   2. Wraps each operation in a mini-transaction that SET LOCAL the Postgres
 *      GUC variables read by the RLS policies (db layer).
 *
 * OWNER_SUPER_ADMIN and KYRU_MANAGER roles use prismaAdmin (BYPASSRLS) so that
 * multi-restaurant queries are not blocked by the single-ID RLS policy.
 * The WHERE-injection layer still scopes OWNER_SUPER_ADMIN to their own
 * restaurants; BYPASSRLS is granted only at the DB level (not app level).
 */
export function buildTenantedClient(baseClient: PrismaClient) {
  return baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model:     string;
          operation: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args:  any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: (args: any) => Promise<any>;
        }) {
          // ── Step 1: Build and inject WHERE filters ──────────────────────────
          const filter = buildTenantFilter(model);

          if (WHERE_OPS.has(operation) && filter !== null) {
            const existingWhere = args.where ?? {};
            args = {
              ...args,
              where: UNIQUE_WHERE_OPS.has(operation)
                ? { ...existingWhere, ...filter }
                : { AND: [existingWhere, filter] },
            };
          }

          if (CREATE_OPS.has(operation) && filter !== null) {
            const scalarFilter = extractScalarFilter(filter);
            if (scalarFilter) {
              if (operation === "create") {
                args = { ...args, data: { ...scalarFilter, ...args.data } };
              } else if (operation === "createMany" && Array.isArray(args.data)) {
                args = {
                  ...args,
                  data: args.data.map((row: Record<string, unknown>) => ({
                    ...scalarFilter, ...row,
                  })),
                };
              }
            }
          }

          // ── Step 2: RLS GUC wrapping ────────────────────────────────────────
          //
          // We need SET LOCAL app.restaurant_id / app.owner_account_id to be
          // in effect when the query hits Postgres so the RLS policies pass.
          // SET LOCAL only works inside a transaction, so we wrap the query
          // in prisma.$transaction (raw client, not tenanted) to guarantee
          // same-connection execution.
          //
          // If rlsTxActive is already set, we are inside a GUC transaction
          // (either the outer call already set it, or a user-level
          // prismaT.$transaction is wrapping us).  In that case just run the
          // query — the GUC is already set on the current connection.

          const rlsCtx = buildRLSContext(model);

          // No RLS wrapping needed for this model/role.
          if (rlsCtx === null) return query(args);

          // Already inside an RLS transaction — run the query directly.
          if (rlsTxActive.getStore()) return query(args);

          // Wrap in a transaction so SET LOCAL takes effect.
          return new Promise((resolve, reject) => {
            rlsTxActive.run(true, () => {
              // Use the RAW prisma client for the transaction so the tx object
              // is not extended — prevents recursive extension calls.
              // The WHERE filters were already injected into `args` above, so
              // calling tx[model][op](args) gives double-layer protection.
              const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
              const { restaurantId, ownerAccountId } = rlsCtx;

              // Use baseClient (not module-level prisma) so tests can inject
              // a client connected to the correct database URL.
              baseClient.$transaction(async (tx) => {
                // set_config(name, value, is_local=true) ≡ SET LOCAL
                // Using the function form because it's available inside
                // interactive transactions and works with pgBouncer tx mode.
                await tx.$executeRaw`
                  SELECT
                    set_config('app.restaurant_id',   ${restaurantId},   true),
                    set_config('app.owner_account_id', ${ownerAccountId}, true)
                `;
                // Execute the already-WHERE-injected query on the tx connection.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (tx as any)[modelKey][operation](args);
              }).then(resolve).catch(reject);
            });
          });
        },
      },
    },
  });
}

// ── senda_app client (normal traffic) ────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prismaApp: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __prismaT: ReturnType<typeof buildTenantedClient> | undefined;
}

/**
 * Base client connecting as senda_app (non-superuser, RLS enforced).
 * DATABASE_URL must be the senda_app connection string in production.
 */
const prismaApp: PrismaClient =
  global.__prismaApp ?? createMonitoredClient(prismaOptions());

if (process.env.NODE_ENV !== "production") {
  global.__prismaApp = prismaApp;
}

/**
 * Tenant-scoped Prisma client.
 * Use in all normal request handlers.
 */
export const prismaT: ReturnType<typeof buildTenantedClient> =
  global.__prismaT ?? buildTenantedClient(prismaApp);

if (process.env.NODE_ENV !== "production") {
  global.__prismaT = prismaT;
}

// ── senda_admin client (BYPASSRLS — KYRU_MANAGER / OWNER_SUPER_ADMIN) ────────
//
// ADMIN_DATABASE_URL must connect as the senda_admin role.
// If not set (local dev without a separate admin user), falls back to the raw
// prisma client (postgres superuser, which also bypasses RLS).
//
// Usage:
//   import { prismaAdmin } from "../lib/prisma";
//   // inside a KYRU_MANAGER-only controller:
//   const allTenants = await prismaAdmin.restaurant.findMany();
//
// The WHERE-injection extension is NOT applied to prismaAdmin — controllers
// that use it are responsible for their own filtering.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prismaAdmin: PrismaClient | undefined;
}

export const prismaAdmin: PrismaClient =
  global.__prismaAdmin ??
  (process.env.ADMIN_DATABASE_URL
    ? createMonitoredClient(prismaOptions({ datasources: { db: { url: process.env.ADMIN_DATABASE_URL } } }))
    : prisma);  // fallback: postgres superuser (also BYPASSRLS)

if (process.env.NODE_ENV !== "production") {
  global.__prismaAdmin = prismaAdmin;
}
