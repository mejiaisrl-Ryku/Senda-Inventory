import { Response, NextFunction } from "express";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// ── Seed config ───────────────────────────────────────────────────────────────

const PRODUCT_TEMPLATES = [
  { name: "Beef Tenderloin",        unit: "LB"     as const, costPerUnit: 48.00, category: "Perishable Food" },
  { name: "Chicken Breast",         unit: "LB"     as const, costPerUnit:  8.20, category: "Perishable Food" },
  { name: "Pork Shoulder",          unit: "LB"     as const, costPerUnit: 18.50, category: "Perishable Food" },
  { name: "Atlantic Salmon",        unit: "LB"     as const, costPerUnit: 36.00, category: "Perishable Food" },
  { name: "Roma Tomatoes",          unit: "KG"     as const, costPerUnit: 28.00, category: "Perishable Food" },
  { name: "Mixed Lettuce",          unit: "CS"     as const, costPerUnit: 42.00, category: "Perishable Food" },
  { name: "Heavy Cream",            unit: "LITERS" as const, costPerUnit: 12.00, category: "Dry Food"        },
  { name: "Grade A Eggs",           unit: "DOZ"    as const, costPerUnit:  6.50, category: "Dry Food"        },
  { name: "All-Purpose Flour",      unit: "KG"     as const, costPerUnit:  2.20, category: "Dry Food"        },
  { name: "Extra Virgin Olive Oil", unit: "LITERS" as const, costPerUnit: 18.00, category: "Dry Food"        },
];

interface LocationConfig {
  name:          string;                     // includes TEST_ prefix
  sales:         number[];                   // 6 entries summing to target revenue
  orders:        number[];                   // 6 entries summing to target COGS
  labor:         { foh: number; boh: number; mgmt: number }; // per-entry (×4)
  countActuals:  Record<number, number>;     // productIndex→actualQty (expected = 20 each)
}

const LOCATIONS: LocationConfig[] = [
  {
    // Revenue $95 000 | Food 28.0% GREEN | Labor 22.0% GREEN | Prime 50.0% GREEN | Inv 96% GREEN
    name:  "TEST_Kardy's Downtown",
    sales: [16000, 15500, 16200, 15800, 16500, 15000],           // = $95 000
    orders:[4200,   7400,  3200,  2900,  4600,  4300],           // = $26 600
    labor: { foh: 2200, boh: 2100, mgmt: 925 },                  // ×4 = $20 900
    countActuals: { 9: 12 },                                      // prod 9 actual=12 → var=8 → acc=96%
  },
  {
    // Revenue $82 000 | Food 35.4% RED | Labor 27.0% YELLOW | Prime 62.4% RED | Inv 78% YELLOW
    name:  "TEST_Kardy's Uptown",
    sales: [13500, 14000, 13800, 13700, 13500, 13500],           // = $82 000
    orders:[5200,   8500,  3800,  3100,  4500,  3900],           // = $29 000
    labor: { foh: 2300, boh: 2300, mgmt: 935 },                  // ×4 = $22 140
    countActuals: { 7: 5, 8: 5, 9: 6 },                          // var 15+15+14=44 → acc=78%
  },
  {
    // Revenue $110 000 | Food 31.0% YELLOW | Labor 26.0% YELLOW | Prime 57.0% YELLOW | Inv 88% GREEN
    name:  "TEST_Kardy's Airport",
    sales: [18500, 18000, 18700, 18300, 18500, 18000],           // = $110 000
    orders:[5800,   9500,  4200,  3900,  6200,  4500],           // = $34 100
    labor: { foh: 3000, boh: 3000, mgmt: 1150 },                 // ×4 = $28 600
    countActuals: { 8: 8, 9: 8 },                                 // var 12+12=24 → acc=88%
  },
];

// Day-offset buckets — all fall inside the current 30-day window
const SALES_OFFSETS  = [28, 23, 18, 13, 8, 3];
const ORDER_OFFSETS  = [27, 22, 17, 12, 7, 2];
const LABOR_OFFSETS  = [28, 21, 14, 7];

// ── Seed one location ─────────────────────────────────────────────────────────

async function seedOne(cfg: LocationConfig, ownerAccountId: string | null) {
  const restaurant = await prisma.restaurant.create({
    data: { name: cfg.name, ownerAccountId },
  });

  // Products
  const products = await Promise.all(
    PRODUCT_TEMPLATES.map((p) =>
      prisma.product.create({
        data: {
          name:         p.name,
          unit:         p.unit,
          costPerUnit:  p.costPerUnit,
          category:     p.category,
          currentStock: 20,
          restaurantId: restaurant.id,
        },
      })
    )
  );

  // Sales entries  (category FOOD satisfies the SalesCategory enum)
  await Promise.all(
    cfg.sales.map((amount, i) =>
      prisma.salesEntry.create({
        data: {
          restaurantId: restaurant.id,
          date:         daysAgo(SALES_OFFSETS[i]),
          category:     "FOOD",
          amount,
        },
      })
    )
  );

  // Orders with a single free-form line item each
  await Promise.all(
    cfg.orders.map((totalCost, i) =>
      prisma.order.create({
        data: {
          restaurantId: restaurant.id,
          status:       "RECEIVED",
          totalCost,
          purveyor:     "Test Purveyor",
          createdAt:    daysAgo(ORDER_OFFSETS[i]),
          orderItems: {
            create: [
              {
                productName: "Miscellaneous Food Items",
                quantity:    1,
                unitCost:    totalCost,
                category:    "Perishable Food",
              },
            ],
          },
        },
      })
    )
  );

  // Labor entries
  await Promise.all(
    LABOR_OFFSETS.map((offset) =>
      prisma.laborEntry.create({
        data: {
          restaurantId: restaurant.id,
          date:         daysAgo(offset),
          fohLabor:     cfg.labor.foh,
          bohLabor:     cfg.labor.boh,
          management:   cfg.labor.mgmt,
          total:        cfg.labor.foh + cfg.labor.boh + cfg.labor.mgmt,
        },
      })
    )
  );

  // Closed count session — 10 products, expectedQty=20 each
  const session = await prisma.countSession.create({
    data: {
      restaurantId: restaurant.id,
      date:         daysAgo(5),
      department:   "ALL",
      status:       "CLOSED",
      createdBy:    "seed",
    },
  });

  await Promise.all(
    products.map((product, i) => {
      const actualQty   = cfg.countActuals[i] ?? 20;
      const variance    = actualQty - 20;
      return prisma.countEntry.create({
        data: {
          sessionId:        session.id,
          productId:        product.id,
          expectedQuantity: 20,
          actualQuantity:   actualQty,
          variance,
          unitCost:         product.costPerUnit,
          varianceValue:    variance * product.costPerUnit,
        },
      });
    })
  );
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function seedTestLocations(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const ownerAccountId = req.user.ownerAccountId ?? null;

    // Idempotent: wipe any existing test locations for this partner
    if (ownerAccountId) {
      await prisma.restaurant.deleteMany({ where: { ownerAccountId, name: { startsWith: "TEST_" } } });
    }

    await Promise.all(LOCATIONS.map((cfg) => seedOne(cfg, ownerAccountId)));

    res.json({
      ok:     true,
      seeded: LOCATIONS.map((l) => l.name.replace("TEST_", "")),
    });
  } catch (err) {
    next(err);
  }
}

export async function clearTestLocations(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const ownerAccountId = req.user.ownerAccountId ?? null;

    const deleted = ownerAccountId
      ? await prisma.restaurant.deleteMany({ where: { ownerAccountId, name: { startsWith: "TEST_" } } })
      : { count: 0 };

    res.json({ ok: true, deleted: deleted.count });
  } catch (err) {
    next(err);
  }
}
