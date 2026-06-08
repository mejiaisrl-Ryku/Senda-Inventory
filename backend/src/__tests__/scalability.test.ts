/**
 * Scalability tests — pagination correctness + query-count assertions.
 *
 * Goals:
 * 1. Verify cursor-based pagination on GET /api/stock/logs/:productId
 *    — legacy call (no params) → plain array, capped at 50
 *    — paginated call (limit + cursor) → { data, nextCursor, hasMore }
 *    — can page through all records using successive cursors
 *
 * 2. Verify cursor-based pagination on GET /api/orders
 *    — same pattern
 *
 * 3. Verify skip/take safety caps on GET /api/sales and GET /api/products
 *    — take param honoured; illegal values (negative, NaN) fallback to default
 *    — max cap is enforced regardless of requested take
 *
 * 4. Query-count smoke check on a "heavy" list endpoint to confirm O(1) query
 *    count regardless of result-set size (no N+1).
 *
 * All DB calls are mocked — no live Postgres required.
 */

// ── Mocks (must be before any imports that trigger module evaluation) ─────────

jest.mock("../lib/prisma", () => ({
  prisma: {
    product:    {
      findFirstOrThrow: jest.fn(),
      findMany:         jest.fn(),
    },
    stockLog:   { findMany: jest.fn() },
    salesEntry: { findMany: jest.fn() },
    order:      { findMany: jest.fn() },
    $queryRaw:  jest.fn(),
  },
}));

jest.mock("../lib/socket", () => ({
  initSocket: jest.fn(),
  getIO:      jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));

jest.mock("../lib/cacheInvalidation", () => ({
  invalidateFinancialCaches:  jest.fn(),
  invalidateLaborCaches:      jest.fn(),
  invalidateCogsCategoryCache: jest.fn(),
}));

const passThrough = (_r: unknown, _s: unknown, next: () => void) => next();
jest.mock("../middleware/rateLimiter", () => ({
  apiLimiter:      passThrough,
  authLimiter:     passThrough,
  forgotPwLimiter: passThrough,
  aiLimiter:       passThrough,
}));

// Suppress cache reads/writes in these tests — everything is a miss (returns null).
jest.mock("../lib/cache", () => ({
  withCache:              (_key: string, _ttl: number, fetch: () => Promise<unknown>) => fetch(),
  cacheGet:               jest.fn().mockResolvedValue(null),
  cacheSet:               jest.fn().mockResolvedValue(undefined),
  cacheInvalidate:        jest.fn().mockResolvedValue(undefined),
  cacheInvalidatePattern: jest.fn().mockResolvedValue(undefined),
  TTL_FINANCIAL:          300,
  TTL_STATIC:             1800,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";

// ── Typed mock accessors ──────────────────────────────────────────────────────

const db = prisma as unknown as {
  product:    { findFirstOrThrow: jest.Mock; findMany: jest.Mock };
  stockLog:   { findMany: jest.Mock };
  salesEntry: { findMany: jest.Mock };
  order:      { findMany: jest.Mock };
  $queryRaw:  jest.Mock;
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESTAURANT_ID = "cltest0restaurant0000000001";
const PRODUCT_ID    = "cltest0product000000000001";

const adminToken = signToken({
  userId:       "cltest0admin0000000000001",
  role:         "ADMIN",
  restaurantId: RESTAURANT_ID,
});

function makeLog(id: string, seq: number) {
  return {
    id,
    productId:        PRODUCT_ID,
    previousQuantity: seq,
    newQuantity:      seq + 1,
    change:           1,
    reason:           "RECEIVED",
    userId:           "u1",
    notes:            null,
    unitCost:         1,
    timestamp:        new Date(Date.now() - seq * 1000).toISOString(),
    user:             { id: "u1", email: "admin@test.com", role: "ADMIN" },
  };
}

function makeOrder(id: string, seq: number) {
  return {
    id,
    restaurantId: RESTAURANT_ID,
    status:       "PENDING",
    totalCost:    100 * seq,
    createdAt:    new Date(Date.now() - seq * 1000).toISOString(),
    orderItems:   [],
  };
}

function makeSale(id: string, seq: number) {
  return {
    id,
    restaurantId: RESTAURANT_ID,
    date:         new Date(Date.now() - seq * 86400000).toISOString(),
    category:     "BEER",
    amount:       Object.assign(100 * seq, { toNumber: () => 100 * seq }), // Prisma Decimal mock
    notes:        null,
  };
}

function makeProduct(id: string, name: string) {
  return {
    id,
    restaurantId: RESTAURANT_ID,
    name,
    currentStock: 10,
    minimumStock: 2,
    category:     "BEER",
    cogsCategory: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Stock log pagination
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/stock/logs/:productId — cursor-based pagination", () => {
  const LOGS = Array.from({ length: 5 }, (_, i) =>
    makeLog(`log-${String(i + 1).padStart(3, "0")}`, i),
  );

  beforeEach(() => {
    db.product.findFirstOrThrow.mockResolvedValue({ id: PRODUCT_ID, restaurantId: RESTAURANT_ID });
  });

  it("legacy: no params → returns plain array capped at 50", async () => {
    db.stockLog.findMany.mockResolvedValue(LOGS.slice(0, 5));

    const res = await request(app)
      .get(`/api/stock/logs/${PRODUCT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(5);

    // Verify take was applied (take = limit+1 = 51 for default limit=50)
    const [call] = db.stockLog.findMany.mock.calls;
    expect(call[0].take).toBe(51); // limit(50) + 1
  });

  it("paginated: limit only → first page, no cursor in query", async () => {
    // Return limit+1 items to signal hasMore=true
    const page1Items = LOGS.slice(0, 3).concat([makeLog("log-extra", 99)]);
    db.stockLog.findMany.mockResolvedValue(page1Items);

    const res = await request(app)
      .get(`/api/stock/logs/${PRODUCT_ID}?limit=3`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.nextCursor).toBe("log-003"); // last item of page
    expect(res.body.data[0].id).toBe("log-001");
  });

  it("paginated: cursor advances to next page", async () => {
    db.stockLog.findMany.mockResolvedValue([LOGS[3], LOGS[4]]);

    const res = await request(app)
      .get(`/api/stock/logs/${PRODUCT_ID}?limit=3&cursor=log-003`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull();

    // Confirm Prisma cursor + skip:1 was used
    const [call] = db.stockLog.findMany.mock.calls;
    expect(call[0].cursor).toEqual({ id: "log-003" });
    expect(call[0].skip).toBe(1);
  });

  it("paginated: limit is clamped to max 200", async () => {
    db.stockLog.findMany.mockResolvedValue([]);

    await request(app)
      .get(`/api/stock/logs/${PRODUCT_ID}?limit=9999`)
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.stockLog.findMany.mock.calls;
    expect(call[0].take).toBe(201); // max(200) + 1
  });

  it("last page: hasMore false, nextCursor null", async () => {
    // Return exactly limit items (no extra) → hasMore false
    const exactPage = LOGS.slice(0, 3);
    db.stockLog.findMany.mockResolvedValue(exactPage);

    const res = await request(app)
      .get(`/api/stock/logs/${PRODUCT_ID}?limit=3`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.data).toHaveLength(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Order pagination
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/orders — cursor-based pagination", () => {
  const ORDERS = Array.from({ length: 4 }, (_, i) =>
    makeOrder(`order-${String(i + 1).padStart(3, "0")}`, i),
  );

  it("legacy: no params → plain Order[] array", async () => {
    db.order.findMany.mockResolvedValue(ORDERS.slice(0, 4));

    const res = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(4);
  });

  it("paginated: returns envelope with nextCursor when hasMore", async () => {
    const page = ORDERS.slice(0, 2).concat([makeOrder("order-extra", 99)]);
    db.order.findMany.mockResolvedValue(page);

    const res = await request(app)
      .get("/api/orders?limit=2")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body.hasMore).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.nextCursor).toBe("order-002");
  });

  it("paginated: limit clamped to max 100", async () => {
    db.order.findMany.mockResolvedValue([]);

    await request(app)
      .get("/api/orders?limit=500")
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.order.findMany.mock.calls;
    expect(call[0].take).toBe(101); // max(100) + 1
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Sales skip/take safety cap
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/sales — skip/take cap", () => {
  beforeEach(() => {
    db.salesEntry.findMany.mockResolvedValue([]);
  });

  it("default take is 500 when no take param supplied", async () => {
    await request(app)
      .get("/api/sales")
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.salesEntry.findMany.mock.calls;
    expect(call[0].take).toBe(500);
    expect(call[0].skip).toBe(0);
  });

  it("honours take param up to max 1000", async () => {
    await request(app)
      .get("/api/sales?take=200&skip=100")
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.salesEntry.findMany.mock.calls;
    expect(call[0].take).toBe(200);
    expect(call[0].skip).toBe(100);
  });

  it("clamps take to 1000 even if caller requests more", async () => {
    await request(app)
      .get("/api/sales?take=9999")
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.salesEntry.findMany.mock.calls;
    expect(call[0].take).toBe(1000);
  });

  it("ignores invalid take (NaN) and falls back to default 500", async () => {
    await request(app)
      .get("/api/sales?take=banana")
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.salesEntry.findMany.mock.calls;
    expect(call[0].take).toBe(500);
  });

  it("ignores negative skip and falls back to 0", async () => {
    await request(app)
      .get("/api/sales?skip=-99")
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.salesEntry.findMany.mock.calls;
    expect(call[0].skip).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Product list safety cap
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/products — safety cap", () => {
  it("default take is 2000", async () => {
    db.product.findMany.mockResolvedValue([]);

    await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${adminToken}`);

    const [call] = db.product.findMany.mock.calls;
    expect(call[0].take).toBe(2000);
    expect(call[0].skip).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Query-count smoke check — O(1) DB calls for list endpoints
// ═════════════════════════════════════════════════════════════════════════════

describe("Query-count smoke check — no N+1", () => {
  /**
   * Each endpoint should make exactly 1 findMany call regardless of result size.
   * If a future change accidentally adds a per-row query, this will catch it.
   */

  it("GET /api/stock/logs/:id makes exactly 2 DB calls (findFirstOrThrow + findMany)", async () => {
    db.product.findFirstOrThrow.mockResolvedValue({ id: PRODUCT_ID, restaurantId: RESTAURANT_ID });
    // Return 50 logs to simulate a non-trivial result set
    db.stockLog.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => makeLog(`log-${i}`, i)),
    );

    const res = await request(app)
      .get(`/api/stock/logs/${PRODUCT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(db.product.findFirstOrThrow).toHaveBeenCalledTimes(1);
    expect(db.stockLog.findMany).toHaveBeenCalledTimes(1);
  });

  it("GET /api/orders makes exactly 1 DB call (findMany) with nested includes", async () => {
    const orders = Array.from({ length: 50 }, (_, i) => makeOrder(`order-${i}`, i));
    db.order.findMany.mockResolvedValue(orders);

    const res = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(db.order.findMany).toHaveBeenCalledTimes(1);
  });

  it("GET /api/sales makes exactly 1 DB call for 100 matching rows", async () => {
    const sales = Array.from({ length: 100 }, (_, i) => makeSale(`sale-${i}`, i));
    db.salesEntry.findMany.mockResolvedValue(sales);

    const res = await request(app)
      .get("/api/sales?startDate=2025-01-01&endDate=2025-12-31")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(db.salesEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it("GET /api/products makes exactly 1 DB call for 200 products", async () => {
    const products = Array.from({ length: 200 }, (_, i) =>
      makeProduct(`prod-${i}`, `Product ${i}`),
    );
    db.product.findMany.mockResolvedValue(products);

    const res = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(200);
    expect(db.product.findMany).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Backward-compatibility guard
// ═════════════════════════════════════════════════════════════════════════════

describe("Backward-compatibility — existing clients unaffected", () => {
  it("stock logs without pagination params returns plain array (not an envelope)", async () => {
    db.product.findFirstOrThrow.mockResolvedValue({ id: PRODUCT_ID, restaurantId: RESTAURANT_ID });
    db.stockLog.findMany.mockResolvedValue([makeLog("log-001", 0)]);

    const res = await request(app)
      .get(`/api/stock/logs/${PRODUCT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Must NOT have { data, nextCursor, hasMore } shape
    expect(res.body[0]).not.toHaveProperty("nextCursor");
    expect(res.body).not.toHaveProperty("hasMore");
  });

  it("orders without pagination params returns plain array", async () => {
    db.order.findMany.mockResolvedValue([makeOrder("order-001", 0)]);

    const res = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).not.toHaveProperty("hasMore");
  });

  it("sales list still returns array with decimal amounts as numbers", async () => {
    db.salesEntry.findMany.mockResolvedValue([makeSale("sale-001", 1)]);

    const res = await request(app)
      .get("/api/sales")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(typeof res.body[0].amount).toBe("number");
  });
});
