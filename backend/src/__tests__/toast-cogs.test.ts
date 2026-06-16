// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../lib/prisma", () => {
  const toastMenuItem   = { findMany: jest.fn(), updateMany: jest.fn() };
  const toastTransaction = { findMany: jest.fn() };
  const recipe          = { findMany: jest.fn() };
  const recipeIngredient = { findMany: jest.fn() };
  const p = { toastMenuItem, toastTransaction, recipe, recipeIngredient, $queryRaw: jest.fn() };
  return { prisma: p, prismaT: p, prismaAdmin: p };
});

import { prisma } from "../lib/prisma";
import {
  getMenuItemsWithCost,
  linkMenuItemToRecipe,
  autoLinkByName,
  calculateCOGSReport,
  getVarianceFlags,
} from "../services/toast-recipe-linker";

const db = {
  mi:  (prisma as any).toastMenuItem    as { findMany: jest.Mock; updateMany: jest.Mock },
  tx:  (prisma as any).toastTransaction as { findMany: jest.Mock },
  rec: (prisma as any).recipe           as { findMany: jest.Mock },
  ri:  (prisma as any).recipeIngredient as { findMany: jest.Mock },
};

const RESTAURANT_ID = "rest_001";

beforeEach(() => jest.clearAllMocks());

// ── Test 1 ────────────────────────────────────────────────────────────────────
describe("getMenuItemsWithCost", () => {
  it("returns items with recipe cost when recipe is linked", async () => {
    db.mi.findMany.mockResolvedValue([
      {
        toastItemId:   "t1",
        toastItemName: "Carne Asada Taco",
        kyruRecipeId:  "rec_1",
        lastSyncedAt:  new Date(),
        recipe: {
          id:   "rec_1",
          name: "Carne Asada Taco",
          ingredients: [
            { quantity: 0.1, conversionFactor: null, product: { costPerUnit: 200 } },
            { quantity: 0.05, conversionFactor: null, product: { costPerUnit: 50 } },
          ],
        },
      },
    ]);

    const result = await getMenuItemsWithCost(RESTAURANT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].recipeName).toBe("Carne Asada Taco");
    // 0.1 × 200 + 0.05 × 50 = 20 + 2.5 = 22.5
    expect(result[0].recipeCost).toBeCloseTo(22.5);
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────
describe("getMenuItemsWithCost — unlinked item", () => {
  it("returns recipeCost=null when item has no linked recipe", async () => {
    db.mi.findMany.mockResolvedValue([
      {
        toastItemId:   "t2",
        toastItemName: "Horchata",
        kyruRecipeId:  null,
        lastSyncedAt:  new Date(),
        recipe:        null,
      },
    ]);

    const result = await getMenuItemsWithCost(RESTAURANT_ID);

    expect(result[0].kyruRecipeId).toBeNull();
    expect(result[0].recipeCost).toBeNull();
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────────
describe("linkMenuItemToRecipe", () => {
  it("calls updateMany with the given recipeId", async () => {
    db.mi.updateMany.mockResolvedValue({ count: 1 });

    await linkMenuItemToRecipe(RESTAURANT_ID, "t1", "rec_42");

    expect(db.mi.updateMany).toHaveBeenCalledWith({
      where: { restaurantId: RESTAURANT_ID, toastItemId: "t1" },
      data:  { kyruRecipeId: "rec_42" },
    });
  });

  it("accepts null to unlink", async () => {
    db.mi.updateMany.mockResolvedValue({ count: 1 });

    await linkMenuItemToRecipe(RESTAURANT_ID, "t1", null);

    expect(db.mi.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { kyruRecipeId: null } })
    );
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────────
describe("autoLinkByName", () => {
  it("links item when name similarity ≥ 0.7 and skips poor matches", async () => {
    db.mi.findMany.mockResolvedValue([
      { toastItemId: "t_taco",  toastItemName: "Carne Asada Taco" },
      { toastItemId: "t_weird", toastItemName: "XYZABCDEF123" },
    ]);
    db.rec.findMany.mockResolvedValue([
      { id: "rec_taco", name: "Carne Asada Taco" },
    ]);
    db.mi.updateMany.mockResolvedValue({ count: 1 });

    const result = await autoLinkByName(RESTAURANT_ID);

    expect(result.linked).toBe(1);
    expect(result.skipped).toBe(1);
    expect(db.mi.updateMany).toHaveBeenCalledTimes(1);
    expect(db.mi.updateMany).toHaveBeenCalledWith({
      where: { restaurantId: RESTAURANT_ID, toastItemId: "t_taco" },
      data:  { kyruRecipeId: "rec_taco" },
    });
  });
});

// ── Test 5 ────────────────────────────────────────────────────────────────────
describe("calculateCOGSReport", () => {
  it("aggregates qty sold, revenue, recipe cost and cost% per item", async () => {
    db.tx.findMany.mockResolvedValue([
      {
        amount: 150,
        itemDetails: [
          { toastItemId: "t1", name: "Taco", qty: 3, unitPrice: 50 },
        ],
      },
    ]);
    db.mi.findMany.mockResolvedValue([
      {
        toastItemId: "t1",
        recipe: {
          ingredients: [
            { quantity: 0.1, conversionFactor: null, product: { costPerUnit: 200 } },
          ],
        },
      },
    ]);

    const report = await calculateCOGSReport(
      RESTAURANT_ID,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-30T23:59:59.999Z"),
    );

    expect(report.items).toHaveLength(1);
    const item = report.items[0];
    expect(item.toastItemId).toBe("t1");
    expect(item.qtySold).toBe(3);
    expect(item.revenue).toBeCloseTo(150); // 3 × 50
    expect(item.recipeCost).toBeCloseTo(60); // 3 × (0.1 × 200)
    expect(item.costPct).toBeCloseTo(40);   // 60/150 × 100
  });
});

// ── Test 6 ────────────────────────────────────────────────────────────────────
describe("getVarianceFlags", () => {
  it("returns only items exceeding the benchmark and calculates gap correctly", async () => {
    // Mock calculateCOGSReport's underlying queries
    db.tx.findMany.mockResolvedValue([
      {
        amount: 100,
        itemDetails: [
          { toastItemId: "cheap",  name: "Water",     qty: 1, unitPrice: 100 },
          { toastItemId: "pricey", name: "Wagyu Taco", qty: 1, unitPrice: 100 },
        ],
      },
    ]);
    db.mi.findMany.mockResolvedValue([
      {
        toastItemId: "cheap",
        recipe: { ingredients: [{ quantity: 0.1, conversionFactor: null, product: { costPerUnit: 50 } }] },
      },
      {
        toastItemId: "pricey",
        recipe: { ingredients: [{ quantity: 1, conversionFactor: null, product: { costPerUnit: 50 } }] },
      },
    ]);

    const flags = await getVarianceFlags(
      RESTAURANT_ID,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-30T23:59:59.999Z"),
      30,
    );

    // cheap: cost = 0.1×50 = 5 → 5% → below 30%
    // pricey: cost = 1×50 = 50 → 50% → above 30%
    expect(flags).toHaveLength(1);
    expect(flags[0].toastItemId).toBe("pricey");
    expect(flags[0].costPct).toBeCloseTo(50);
    expect(flags[0].gap).toBeCloseTo(20); // 50 − 30
  });
});
