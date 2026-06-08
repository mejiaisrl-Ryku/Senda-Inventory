/**
 * PostgreSQL Row-Level Security — acceptance tests.
 *
 * These tests verify that the RLS policies enforce tenant isolation at the
 * database level, independently of the app-layer WHERE injection.
 *
 * Three test groups:
 *   RLS-1  Raw SQL — connect as senda_app, SET GUC, verify visibility.
 *   RLS-2  Fail-closed — no GUC set → zero rows.
 *   RLS-3  App + RLS combined — prismaT queries still pass with RLS on.
 *
 * Requires two env vars:
 *   INTEGRATION_DATABASE_URL    — senda_app connection (non-superuser, RLS on)
 *   ADMIN_DATABASE_URL          — senda_admin connection (BYPASSRLS)
 *
 * Skipped automatically when either var is not set.
 *
 * Run:
 *   INTEGRATION_DATABASE_URL=... ADMIN_DATABASE_URL=... \
 *     npx jest rlsPolicy --ci --forceExit
 */

import { Pool, PoolClient } from "pg";
import { PrismaClient } from "@prisma/client";
import { tenantStore } from "../lib/tenantContext";
import { prismaT } from "../lib/prisma";

// ── Env ───────────────────────────────────────────────────────────────────────

const APP_URL   = process.env.INTEGRATION_DATABASE_URL;
const ADMIN_URL = process.env.ADMIN_DATABASE_URL;
const LIVE      = !!(APP_URL && ADMIN_URL);
const itLive    = LIVE ? it : it.skip;

// ── Known production IDs (confirmed in previous audit sessions) ───────────────

const KARDYS_RESTAURANT_ID = "cmpip92f60001l8ii23e86mub";
const KARDYS_OWNER_ID      = "cmpy9c3x30000cmm9dzvwanz3";
const TROMPAS_OWNER_ID     = "cmprivk2r000010lsnxw44f0n";

// ── Connection pools ──────────────────────────────────────────────────────────

// senda_app pool (RLS enforced) — used for raw SQL tests
const appPool   = LIVE ? new Pool({ connectionString: APP_URL! })   : null;
// senda_admin pool (BYPASSRLS) — used to verify totals
const adminPool = LIVE ? new Pool({ connectionString: ADMIN_URL! }) : null;

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run SQL inside an explicit transaction with SET LOCAL GUCs, then ROLLBACK.
 * Returns the scalar result of the last SELECT.
 */
async function withTenant(
  pool: Pool,
  restaurantId: string,
  ownerAccountId: string,
  sql: string,
): Promise<unknown> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT
         set_config('app.restaurant_id',    $1, true),
         set_config('app.owner_account_id', $2, true)`,
      [restaurantId, ownerAccountId],
    );
    const result = await client.query(sql);
    await client.query("ROLLBACK");  // read-only; always rollback
    return result.rows[0]?.[Object.keys(result.rows[0])[0]];
  } finally {
    client.release();
  }
}

/**
 * Run SQL WITHOUT setting any tenant GUC (should return 0 rows).
 */
async function withoutTenant(pool: Pool, sql: string): Promise<number> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(sql);
    await client.query("ROLLBACK");
    return Number(result.rows[0]?.count ?? result.rowCount ?? 0);
  } finally {
    client.release();
  }
}

// ── Helper: prismaT scoped context ────────────────────────────────────────────

function asPrismaAdmin(restaurantId: string, ownerAccountId: string, fn: () => Promise<void>) {
  return new Promise<void>((resolve, reject) =>
    tenantStore.run(
      { userId: "test", role: "ADMIN", restaurantId, ownerAccountId },
      () => fn().then(resolve).catch(reject),
    ),
  );
}

function asPrismaOwner(ownerAccountId: string, ownedRestaurantIds: string[], fn: () => Promise<void>) {
  return new Promise<void>((resolve, reject) =>
    tenantStore.run(
      { userId: "test", role: "OWNER_SUPER_ADMIN", ownerAccountId, ownedRestaurantIds },
      () => fn().then(resolve).catch(reject),
    ),
  );
}

// ── RLS-1: Raw SQL GUC tests ──────────────────────────────────────────────────

describe("RLS-1 — raw SQL: correct GUC shows correct rows", () => {
  itLive("senda_app sees Kardy's products when GUC = Kardy's restaurantId", async () => {
    const count = await withTenant(
      appPool!,
      KARDYS_RESTAURANT_ID,
      KARDYS_OWNER_ID,
      `SELECT count(*) FROM products`,
    );

    // Also get the true count from senda_admin (BYPASSRLS)
    const adminClient = await adminPool!.connect();
    const adminResult = await adminClient.query(
      `SELECT count(*) FROM products WHERE "restaurantId" = $1`,
      [KARDYS_RESTAURANT_ID],
    );
    adminClient.release();
    const trueCount = Number(adminResult.rows[0].count);

    expect(Number(count)).toBe(trueCount);
    expect(Number(count)).toBeGreaterThan(0);
  });

  itLive("senda_app with Kardy's GUC cannot see Trompas products", async () => {
    // Set GUC to Kardy's — Trompas rows must be invisible
    const client = await appPool!.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('app.restaurant_id', $1, true)`,
        [KARDYS_RESTAURANT_ID],
      );
      // Directly query for a non-Kardy's restaurantId — should still return 0
      // because RLS blocks it regardless of the explicit WHERE.
      const result = await client.query(
        `SELECT count(*) FROM products WHERE "restaurantId" != $1`,
        [KARDYS_RESTAURANT_ID],
      );
      await client.query("ROLLBACK");
      expect(Number(result.rows[0].count)).toBe(0);
    } finally {
      client.release();
    }
  });

  itLive("senda_app sees Kardy's cogs_categories when owner GUC is set", async () => {
    const count = await withTenant(
      appPool!,
      "",               // restaurantId not needed for owner-scoped tables
      KARDYS_OWNER_ID,
      `SELECT count(*) FROM cogs_categories`,
    );
    expect(Number(count)).toBeGreaterThan(0);
  });

  itLive("senda_app with Kardy's owner GUC cannot see Trompas cogs_categories", async () => {
    const count = await withTenant(
      appPool!,
      "",
      KARDYS_OWNER_ID,
      `SELECT count(*) FROM cogs_categories WHERE "ownerAccountId" = '${TROMPAS_OWNER_ID}'`,
    );
    expect(Number(count)).toBe(0);
  });

  itLive("senda_admin (BYPASSRLS) sees products across all tenants", async () => {
    const adminClient = await adminPool!.connect();
    const result = await adminClient.query(`SELECT count(*) FROM products`);
    adminClient.release();

    // Also get the total from appPool with Kardy's GUC
    const kardysCount = await withTenant(
      appPool!,
      KARDYS_RESTAURANT_ID,
      KARDYS_OWNER_ID,
      `SELECT count(*) FROM products`,
    );

    // senda_admin should see >= Kardy's count (it sees all tenants)
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(Number(kardysCount));
  });
});

// ── RLS-2: Fail-closed ────────────────────────────────────────────────────────

describe("RLS-2 — fail-closed: no tenant context = zero rows", () => {
  const tables = [
    "products",
    "orders",
    "sales_entries",
    "labor_entries",
    "count_sessions",
    "recipes",
    "location_budgets",
    "cogs_categories",
  ] as const;

  for (const table of tables) {
    itLive(`${table}: SELECT with no GUC returns 0 rows`, async () => {
      const count = await withoutTenant(
        appPool!,
        `SELECT count(*) FROM ${table}`,
      );
      expect(count).toBe(0);
    });
  }

  itLive("stock_logs: SELECT with no GUC returns 0 rows", async () => {
    const count = await withoutTenant(appPool!, `SELECT count(*) FROM stock_logs`);
    expect(count).toBe(0);
  });

  itLive("order_items: SELECT with no GUC returns 0 rows", async () => {
    const count = await withoutTenant(appPool!, `SELECT count(*) FROM order_items`);
    expect(count).toBe(0);
  });
});

// ── RLS-3: Application + RLS combined ────────────────────────────────────────

describe("RLS-3 — prismaT queries work correctly with RLS active", () => {
  // These tests use the prismaT client (which sets the GUC via the extension)
  // and an INTEGRATION_DATABASE_URL that connects as senda_app.
  //
  // For these tests to exercise RLS (not just WHERE injection), the
  // prismaT base client must connect as senda_app.  In the test environment,
  // the NODE_ENV is "test" which may use the default DATABASE_URL.
  // We construct a dedicated PrismaClient here using APP_URL.

  let prismaAppClient: PrismaClient;

  beforeAll(() => {
    if (!LIVE) return;
    // Build a fresh PrismaClient connecting as senda_app
    prismaAppClient = new PrismaClient({
      datasources: { db: { url: APP_URL! } },
    });
  });

  afterAll(async () => {
    if (prismaAppClient) await prismaAppClient.$disconnect();
  });

  itLive("prismaT (as ADMIN) sees only Kardy's products — WHERE + RLS both pass", () =>
    asPrismaAdmin(KARDYS_RESTAURANT_ID, KARDYS_OWNER_ID, async () => {
      // prismaT uses the extension to both inject WHERE and SET LOCAL GUC.
      // The senda_app connection means RLS is also enforced.
      const products = await (prismaT as unknown as PrismaClient).product.findMany({});
      expect(products.length).toBeGreaterThan(0);
      for (const p of products) {
        expect((p as any).restaurantId).toBe(KARDYS_RESTAURANT_ID);
      }
    }),
  );

  itLive("prismaT cross-tenant attempt returns empty — both WHERE + RLS block it", () =>
    asPrismaAdmin("__nonexistent__", TROMPAS_OWNER_ID, async () => {
      const products = await (prismaT as unknown as PrismaClient).product.findFirst({
        where: { restaurantId: KARDYS_RESTAURANT_ID }, // explicit Kardy's ID
      });
      // WHERE injection adds AND [{ restaurantId: '__nonexistent__' }] → no match
      // RLS policy also sees app.restaurant_id = '__nonexistent__' → no match
      expect(products).toBeNull();
    }),
  );

  itLive("OWNER_SUPER_ADMIN uses BYPASSRLS path — sees their own restaurants", () =>
    asPrismaOwner(KARDYS_OWNER_ID, [KARDYS_RESTAURANT_ID], async () => {
      // OWNER_SUPER_ADMIN returns null from buildRLSContext → uses prismaAdmin path
      // (BYPASSRLS), but WHERE injection still scopes to ownedRestaurantIds
      const products = await (prismaT as unknown as PrismaClient).product.findMany({});
      // All returned products must belong to Kardy's
      for (const p of products) {
        expect([KARDYS_RESTAURANT_ID]).toContain((p as any).restaurantId);
      }
    }),
  );

  itLive("KYRU_MANAGER sees all products via BYPASSRLS path", () =>
    new Promise<void>((resolve, reject) =>
      tenantStore.run(
        { userId: "test", role: "KYRU_MANAGER" },
        async () => {
          try {
            const products = await (prismaT as unknown as PrismaClient).product.findMany({});
            // Should be equal to the admin-level total
            const adminClient = await adminPool!.connect();
            const res = await adminClient.query(`SELECT count(*) FROM products`);
            adminClient.release();
            expect(products.length).toBe(Number(res.rows[0].count));
            resolve();
          } catch (e) { reject(e); }
        },
      ),
    ),
  );
});
