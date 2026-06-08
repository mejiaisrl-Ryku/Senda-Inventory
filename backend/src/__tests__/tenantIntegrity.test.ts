/**
 * Tenant data-integrity assertions.
 *
 * These tests run against a real database and are READ-ONLY (no writes, no mocks).
 * They fail when the tenancy invariants documented in the schema are violated:
 *
 *   1. Every Restaurant must have a valid ownerAccountId.
 *   2. Every OWNER_SUPER_ADMIN user's ownerAccountId must resolve to a real OwnerAccount.
 *   3. Every LocationBudget's ownerAccountId must resolve to a real OwnerAccount.
 *   4. No legacy SUPER_ADMIN users may exist (all migrated to KYRU_MANAGER).
 *
 * Run against prod:
 *   INTEGRATION_DATABASE_URL=<public_railway_url> npx jest tenantIntegrity --ci --forceExit
 *
 * Skipped in unit CI: jest.setup.ts sets DATABASE_URL to a local test value.
 * Use INTEGRATION_DATABASE_URL (separate var) to bypass that.
 */

import { PrismaClient } from "@prisma/client";

const DB_URL = process.env.INTEGRATION_DATABASE_URL;
const itLive = DB_URL ? it : it.skip;

const prisma = new PrismaClient({
  datasources: { db: { url: DB_URL ?? "postgresql://skip:skip@localhost:5432/skip" } },
});

afterAll(async () => { await prisma.$disconnect(); });

describe("Tenant integrity", () => {
  itLive("no restaurant has a null ownerAccountId", async () => {
    const orphans = await prisma.restaurant.findMany({
      where:  { ownerAccountId: null },
      select: { id: true, name: true },
    });
    expect(orphans).toEqual([]);
  });

  itLive("every restaurant's ownerAccountId resolves to a real OwnerAccount", async () => {
    const restaurants = await prisma.restaurant.findMany({
      where:  { ownerAccountId: { not: null } },
      select: { id: true, name: true, ownerAccountId: true },
    });
    for (const r of restaurants) {
      const owner = await prisma.ownerAccount.findUnique({
        where:  { id: r.ownerAccountId! },
        select: { id: true },
      });
      expect(owner).not.toBeNull();
    }
  });

  itLive("every OWNER_SUPER_ADMIN user has a non-null ownerAccountId", async () => {
    const dangling = await prisma.user.findMany({
      where:  { role: "OWNER_SUPER_ADMIN", ownerAccountId: null },
      select: { email: true },
    });
    expect(dangling).toEqual([]);
  });

  itLive("every OWNER_SUPER_ADMIN user's ownerAccountId resolves to a real OwnerAccount", async () => {
    const ownerUsers = await prisma.user.findMany({
      where:  { role: "OWNER_SUPER_ADMIN", ownerAccountId: { not: null } },
      select: { email: true, ownerAccountId: true },
    });
    for (const u of ownerUsers) {
      const acct = await prisma.ownerAccount.findUnique({
        where:  { id: u.ownerAccountId! },
        select: { id: true },
      });
      expect(acct).not.toBeNull();
    }
  });

  itLive("no LocationBudget has a dangling ownerAccountId", async () => {
    const budgets = await prisma.locationBudget.findMany({
      select: { id: true, ownerAccountId: true },
    });
    for (const b of budgets) {
      const acct = await prisma.ownerAccount.findUnique({
        where:  { id: b.ownerAccountId },
        select: { id: true },
      });
      expect(acct).not.toBeNull();
    }
  });

  itLive("no legacy SUPER_ADMIN users remain (all migrated to KYRU_MANAGER)", async () => {
    const legacy = await prisma.user.findMany({
      where:  { role: "SUPER_ADMIN" },
      select: { email: true },
    });
    expect(legacy).toEqual([]);
  });
});
