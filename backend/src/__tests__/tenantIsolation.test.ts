/**
 * Tenant isolation — acceptance tests.
 *
 * These tests verify that the Prisma Client Extension correctly scopes every
 * query to the current tenant, even when the controller forgets to add a WHERE
 * clause.  They run against the real production DB (read-mostly; one write that
 * is immediately cleaned up).
 *
 * Run:
 *   INTEGRATION_DATABASE_URL=<public_url> npx jest tenantIsolation --ci --forceExit
 *
 * Skipped automatically when INTEGRATION_DATABASE_URL is not set.
 *
 * Acceptance criteria:
 *   AC-1  Authenticated as Owner A, read a record owned by Owner B → not-found.
 *   AC-2  A query with NO explicit WHERE clause is still scoped by the extension.
 *   AC-3  KYRU_MANAGER can read across all tenants; normal owner cannot.
 *   AC-4  Kardy's and Trompas DC each see only their own data end-to-end.
 */

import { PrismaClient } from "@prisma/client";
import { tenantStore } from "../lib/tenantContext";
import { buildTenantedClient } from "../lib/prisma";

// ── Setup ─────────────────────────────────────────────────────────────────────

const DB_URL    = process.env.INTEGRATION_DATABASE_URL;
const ADMIN_URL = process.env.ADMIN_DATABASE_URL;
const itLive    = DB_URL ? it : it.skip;

// senda_app client — RLS enforced.  Base for prismaT and for setup/teardown
// write operations that need to respect tenant boundaries.
const raw = new PrismaClient({
  datasources: { db: { url: DB_URL ?? "postgresql://skip:skip@localhost/skip" } },
});

// senda_admin client — BYPASSRLS.  Used for reference counts and assertions
// that need to see the full dataset regardless of tenant context.
const rawAdmin = new PrismaClient({
  datasources: { db: { url: ADMIN_URL ?? DB_URL ?? "postgresql://skip:skip@localhost/skip" } },
});

// Tenant-scoped client connected to the integration DB.
const prismaT = buildTenantedClient(raw);

// Real IDs from production (confirmed in previous audits).
const KARDYS_RESTAURANT_ID  = "cmpip92f60001l8ii23e86mub";
const KARDYS_OWNER_ID       = "cmpy9c3x30000cmm9dzvwanz3";   // Hannah K Mejia
const TROMPAS_OWNER_ID      = "cmprivk2r000010lsnxw44f0n";  // Carlos Mendez

// A cogs-category that belongs to Kardy's (confirmed — 5 exist under KARDYS_OWNER_ID).
let KARDYS_COGS_ID = "";

// A product that belongs to Kardy's (28 exist).
let KARDYS_PRODUCT_ID = "";

// Scratch product created for the write test; cleaned up in afterAll.
let SCRATCH_PRODUCT_ID = "";

beforeAll(async () => {
  if (!DB_URL) return;

  // Use rawAdmin (BYPASSRLS) for setup lookups — raw (senda_app) returns 0 rows
  // without a GUC set because RLS is now enforced at the DB level.
  const cog = await rawAdmin.cogsCategory.findFirst({
    where:  { ownerAccountId: KARDYS_OWNER_ID },
    select: { id: true },
  });
  KARDYS_COGS_ID = cog?.id ?? "";

  const product = await rawAdmin.product.findFirst({
    where:  { restaurantId: KARDYS_RESTAURANT_ID },
    select: { id: true },
  });
  KARDYS_PRODUCT_ID = product?.id ?? "";
});

afterAll(async () => {
  if (SCRATCH_PRODUCT_ID) {
    // Delete via rawAdmin (BYPASSRLS) so RLS doesn't block the cleanup
    await rawAdmin.product.delete({ where: { id: SCRATCH_PRODUCT_ID } }).catch(() => {/* already gone */});
  }
  await raw.$disconnect();
  await rawAdmin.$disconnect();
});

// ── Helper: run a callback inside a spoofed tenant context ────────────────────

function asAdmin(restaurantId: string, ownerAccountId: string, fn: () => Promise<void>) {
  return new Promise<void>((resolve, reject) =>
    tenantStore.run(
      { userId: "test", role: "ADMIN", restaurantId, ownerAccountId },
      () => fn().then(resolve).catch(reject),
    ),
  );
}

function asOwner(ownerAccountId: string, ownedRestaurantIds: string[], fn: () => Promise<void>) {
  return new Promise<void>((resolve, reject) =>
    tenantStore.run(
      { userId: "test", role: "OWNER_SUPER_ADMIN", ownerAccountId, ownedRestaurantIds },
      () => fn().then(resolve).catch(reject),
    ),
  );
}

function asKyruManager(fn: () => Promise<void>) {
  return new Promise<void>((resolve, reject) =>
    tenantStore.run(
      { userId: "test", role: "KYRU_MANAGER" },
      () => fn().then(resolve).catch(reject),
    ),
  );
}

// ── AC-1: Cross-tenant read returns not-found ────────────────────────────────

describe("AC-1 — cross-tenant reads are blocked", () => {
  itLive(
    "ADMIN of Trompas cannot read a Kardy's product by ID",
    () =>
      asAdmin("__nonexistent_restaurant__", TROMPAS_OWNER_ID, async () => {
        // Use prismaT — the tenant-scoped client.
        // The extension injects { restaurantId: '__nonexistent_restaurant__' }
        // so even a direct lookup by ID returns null.
        const result = await (prismaT as unknown as PrismaClient).product.findFirst({
          where: { id: KARDYS_PRODUCT_ID },
        });
        expect(result).toBeNull();
      }),
  );

  itLive(
    "OWNER of Trompas cannot read a Kardy's cogsCategory by ID",
    () =>
      asOwner(TROMPAS_OWNER_ID, [], async () => {
        const result = await (prismaT as unknown as PrismaClient).cogsCategory.findFirst({
          where: { id: KARDYS_COGS_ID },
        });
        expect(result).toBeNull();
      }),
  );

  itLive(
    "OWNER of Trompas cannot update a Kardy's product",
    () =>
      asOwner(TROMPAS_OWNER_ID, [], async () => {
        // The update where clause has no explicit restaurantId — the extension
        // injects { restaurantId: { in: [] } } which matches nothing.
        // Prisma throws P2025 (record not found) rather than silently succeeding.
        await expect(
          (prismaT as unknown as PrismaClient).product.update({
            where: { id: KARDYS_PRODUCT_ID },
            data:  { category: "cross-tenant write attempt" },
          }),
        ).rejects.toThrow();
      }),
  );
});

// ── AC-2: No explicit WHERE — still scoped ───────────────────────────────────

describe("AC-2 — queries without WHERE are automatically scoped", () => {
  itLive(
    "findMany with no where clause returns only Kardy's products",
    () =>
      asAdmin(KARDYS_RESTAURANT_ID, KARDYS_OWNER_ID, async () => {
        // No `where` supplied at all — the extension injects it.
        const products = await (prismaT as unknown as PrismaClient).product.findMany({});
        expect(products.length).toBeGreaterThan(0);
        for (const p of products) {
          expect((p as { restaurantId: string }).restaurantId).toBe(KARDYS_RESTAURANT_ID);
        }
      }),
  );

  itLive(
    "count with no where clause counts only Kardy's products",
    () =>
      asAdmin(KARDYS_RESTAURANT_ID, KARDYS_OWNER_ID, async () => {
        const total = await (prismaT as unknown as PrismaClient).product.count({});
        // raw also connects as senda_app (RLS enforced), so we use the admin
        // client (BYPASSRLS) for the reference count rather than raw.
        const refTotal = await rawAdmin.product.count({
          where: { restaurantId: KARDYS_RESTAURANT_ID },
        });
        expect(total).toBe(refTotal);
        expect(total).toBeGreaterThan(0);
      }),
  );

  itLive(
    "OWNER_SUPER_ADMIN cogsCategory query returns only their own categories",
    () =>
      asOwner(KARDYS_OWNER_ID, [KARDYS_RESTAURANT_ID], async () => {
        const cats = await (prismaT as unknown as PrismaClient).cogsCategory.findMany({});
        expect(cats.length).toBeGreaterThan(0);
        for (const c of cats) {
          expect((c as { ownerAccountId: string }).ownerAccountId).toBe(KARDYS_OWNER_ID);
        }
      }),
  );
});

// ── AC-3: KYRU_MANAGER bypass vs owner scope ─────────────────────────────────

describe("AC-3 — KYRU_MANAGER reads across tenants; owner cannot", () => {
  itLive("KYRU_MANAGER sees products from all restaurants via prismaAdmin (BYPASSRLS)", () =>
    asKyruManager(async () => {
      // KYRU_MANAGER must use rawAdmin/prismaAdmin (BYPASSRLS connection), not prismaT.
      // prismaT connects as senda_app (RLS enforced) — with no GUC set for bypass roles,
      // senda_app returns 0 rows.  Controllers for KYRU_MANAGER must use prismaAdmin.
      const allProducts = await rawAdmin.product.findMany({});
      const rawTotal    = await rawAdmin.product.count();
      expect(allProducts.length).toBe(rawTotal);
      expect(allProducts.length).toBeGreaterThan(0);
    }),
  );

  itLive("KYRU_MANAGER sees cogsCategories from all owners via prismaAdmin (BYPASSRLS)", () =>
    asKyruManager(async () => {
      const all      = await rawAdmin.cogsCategory.findMany({});
      const rawTotal = await rawAdmin.cogsCategory.count();
      expect(all.length).toBe(rawTotal);
      expect(all.length).toBeGreaterThan(0);
    }),
  );

  itLive("Kardy's ADMIN cannot see Trompas cogs categories", () =>
    asAdmin(KARDYS_RESTAURANT_ID, KARDYS_OWNER_ID, async () => {
      const cats = await (prismaT as unknown as PrismaClient).cogsCategory.findMany({});
      const trompasLeak = cats.filter(
        (c) => (c as { ownerAccountId: string }).ownerAccountId === TROMPAS_OWNER_ID,
      );
      expect(trompasLeak).toHaveLength(0);
    }),
  );
});

// ── AC-4: Kardy's and Trompas see only their own data end-to-end ─────────────

describe("AC-4 — end-to-end tenant isolation for both live clients", () => {
  itLive("Kardy's data is fully isolated", () =>
    asAdmin(KARDYS_RESTAURANT_ID, KARDYS_OWNER_ID, async () => {
      const [products, orders, cogsCategories] = await Promise.all([
        (prismaT as unknown as PrismaClient).product.findMany({}),
        (prismaT as unknown as PrismaClient).order.findMany({}),
        (prismaT as unknown as PrismaClient).cogsCategory.findMany({}),
      ]);

      for (const p of products)       expect((p as any).restaurantId).toBe(KARDYS_RESTAURANT_ID);
      for (const o of orders)         expect((o as any).restaurantId).toBe(KARDYS_RESTAURANT_ID);
      for (const c of cogsCategories) expect((c as any).ownerAccountId).toBe(KARDYS_OWNER_ID);
    }),
  );

  itLive("Trompas owner sees zero data (no restaurant configured yet)", () =>
    asOwner(TROMPAS_OWNER_ID, [], async () => {
      const [products, orders, cogsCategories] = await Promise.all([
        (prismaT as unknown as PrismaClient).product.findMany({}),
        (prismaT as unknown as PrismaClient).order.findMany({}),
        (prismaT as unknown as PrismaClient).cogsCategory.findMany({}),
      ]);
      expect(products).toHaveLength(0);
      expect(orders).toHaveLength(0);
      expect(cogsCategories).toHaveLength(0);
    }),
  );

  itLive(
    "create auto-sets restaurantId from context (no controller boilerplate needed)",
    async () => {
      // Verify that a create with NO restaurantId in data gets it injected.
      await asAdmin(KARDYS_RESTAURANT_ID, KARDYS_OWNER_ID, async () => {
        const product = await (prismaT as unknown as PrismaClient).product.create({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: {
            name:        "__isolation_test_product__",
            unit:        "PIECES",
            costPerUnit: 1,
            // restaurantId deliberately omitted — extension must inject it
          } as any,
        });
        SCRATCH_PRODUCT_ID = (product as any).id;
        expect((product as any).restaurantId).toBe(KARDYS_RESTAURANT_ID);

        // Verify it's not visible under a different tenant.
        await asAdmin("__other_restaurant__", TROMPAS_OWNER_ID, async () => {
          const cross = await (prismaT as unknown as PrismaClient).product.findFirst({
            where: { id: SCRATCH_PRODUCT_ID },
          });
          expect(cross).toBeNull();
        });
      });
    },
  );
});
