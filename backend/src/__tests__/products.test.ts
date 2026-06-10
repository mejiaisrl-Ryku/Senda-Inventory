import request from "supertest";

jest.mock("../lib/prisma", () => {
  const prisma = {
    product: {
      findMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  return { prisma, prismaT: prisma, prismaAdmin: prisma };
});

jest.mock("../lib/socket", () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));

const passThrough = (_r: unknown, _s: unknown, next: () => void) => next();
jest.mock("../middleware/rateLimiter", () => ({
  apiLimiter:      passThrough,
  authLimiter:     passThrough,
  forgotPwLimiter: passThrough,
  aiLimiter:       passThrough,
}));

import app from "../app";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";

const db = prisma as unknown as {
  product: { findMany: jest.Mock; findFirstOrThrow: jest.Mock; create: jest.Mock; delete: jest.Mock };
  $queryRaw: jest.Mock;
};

const RESTAURANT_ID = "cltest0restaurant0000000001";
const PRODUCT_ID = "cltest0product000000000001";

const staffToken = signToken({
  userId: "cltest0staff0000000000001",
  role: "STAFF",
  restaurantId: RESTAURANT_ID,
});
const adminToken = signToken({
  userId: "cltest0admin0000000000001",
  role: "ADMIN",
  restaurantId: RESTAURANT_ID,
});

const mockProduct = {
  id: PRODUCT_ID,
  name: "Olive Oil",
  sku: "OIL-001",
  category: "Pantry",
  unit: "LITERS",
  costPerUnit: 12.5,
  currentStock: 20,
  minimumStock: 5,
  restaurantId: RESTAURANT_ID,
};

beforeEach(() => {
  db.$queryRaw.mockResolvedValue([]);
});

// ── List products ─────────────────────────────────────────────────────────────

describe("GET /api/products", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(401);
  });

  it("returns 200 with the product array for an authenticated user", async () => {
    db.product.findMany.mockResolvedValue([mockProduct]);

    const res = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: "Olive Oil" });
  });
});

// ── Create product ────────────────────────────────────────────────────────────
// POST is open to all authenticated users — DELETE is admin-only.

describe("POST /api/products", () => {
  const validBody = {
    name: "Sea Salt",
    unit: "KG",
    costPerUnit: 3.5,
    currentStock: 10,
    minimumStock: 2,
  };

  it("returns 201 when a staff member creates a product", async () => {
    db.product.create.mockResolvedValue({ ...mockProduct, name: "Sea Salt", id: "cltest0product000000000002" });

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${staffToken}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Sea Salt" });
  });
});

// ── Delete product ────────────────────────────────────────────────────────────

describe("DELETE /api/products/:id", () => {
  it("returns 403 when a staff member tries to delete a product", async () => {
    const res = await request(app)
      .delete(`/api/products/${PRODUCT_ID}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });
});
