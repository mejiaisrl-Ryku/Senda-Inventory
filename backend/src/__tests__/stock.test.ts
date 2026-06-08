import request from "supertest";

jest.mock("../lib/prisma", () => ({
  prisma: {
    product: { findFirstOrThrow: jest.fn(), update: jest.fn() },
    stockLog: { create: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));

jest.mock("../lib/socket", () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  apiLimiter: (_r: unknown, _s: unknown, next: () => void) => next(),
  authLimiter: (_r: unknown, _s: unknown, next: () => void) => next(),
}));

import app from "../app";
import { prisma } from "../lib/prisma";
import { getIO } from "../lib/socket";
import { signToken } from "../lib/jwt";

const db = prisma as unknown as {
  product: { findFirstOrThrow: jest.Mock; update: jest.Mock };
  stockLog: { create: jest.Mock };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

const RESTAURANT_ID = "cltest0restaurant0000000001";
const PRODUCT_ID = "cltest0product000000000001";
const USER_ID_STAFF = "cltest0staff0000000000001";
const USER_ID_ADMIN = "cltest0admin0000000000001";

const staffToken = signToken({ userId: USER_ID_STAFF, role: "STAFF", restaurantId: RESTAURANT_ID });
const adminToken = signToken({ userId: USER_ID_ADMIN, role: "ADMIN", restaurantId: RESTAURANT_ID });

const mockProduct = {
  id: PRODUCT_ID,
  name: "Tomatoes",
  currentStock: 10,
  minimumStock: 2,
  restaurantId: RESTAURANT_ID,
};

const mockLog = {
  id: "cltest0log000000000000001",
  productId: PRODUCT_ID,
  previousQuantity: 10,
  newQuantity: 5,
  change: -5,
  reason: "USED",
  userId: USER_ID_STAFF,
  notes: null,
  timestamp: new Date().toISOString(),
};

beforeEach(() => {
  db.$queryRaw.mockResolvedValue([]);
  (getIO as jest.Mock).mockReturnValue({ to: jest.fn(() => ({ emit: jest.fn() })) });
  db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  db.stockLog.create.mockResolvedValue(mockLog);
  db.product.update.mockResolvedValue({ ...mockProduct, currentStock: 5 });
});

// ── Adjust stock ──────────────────────────────────────────────────────────────

describe("POST /api/stock/adjust", () => {
  it("returns 201 when admin adjusts stock with an allowed reason (USED)", async () => {
    db.product.findFirstOrThrow.mockResolvedValue(mockProduct);

    const res = await request(app)
      .post("/api/stock/adjust")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: PRODUCT_ID, change: -5, reason: "USED" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ change: -5, reason: "USED" });
  });

  it("returns 403 when staff attempts to adjust stock (admin-only endpoint)", async () => {
    const res = await request(app)
      .post("/api/stock/adjust")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ productId: PRODUCT_ID, change: -5, reason: "USED" });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 when staff attempts an ADJUSTED (admin-only) reason", async () => {
    const res = await request(app)
      .post("/api/stock/adjust")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ productId: PRODUCT_ID, change: 5, reason: "ADJUSTED" });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 201 when an admin uses the ADJUSTED reason", async () => {
    db.product.findFirstOrThrow.mockResolvedValue(mockProduct);
    db.stockLog.create.mockResolvedValue({ ...mockLog, reason: "ADJUSTED", change: 5, newQuantity: 15 });

    const res = await request(app)
      .post("/api/stock/adjust")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: PRODUCT_ID, change: 5, reason: "ADJUSTED" });

    expect(res.status).toBe(201);
  });

  it("returns 400 when the adjustment would result in negative stock", async () => {
    db.product.findFirstOrThrow.mockResolvedValue(mockProduct); // currentStock: 10

    // Must use adminToken — STAFF is now blocked by requireAdmin before the
    // negative-stock guard in the controller can run.
    const res = await request(app)
      .post("/api/stock/adjust")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: PRODUCT_ID, change: -50, reason: "USED" }); // 10 - 50 = -40

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/negative/i);
  });
});
