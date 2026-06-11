import request from "supertest";
import bcrypt from "bcryptjs";

jest.mock("../lib/prisma", () => {
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
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
  leadsLimiter:    passThrough,
  aiLimiter:       passThrough,
}));

import app from "../app";
import { prisma } from "../lib/prisma";
import { signToken, signRefreshToken, signInviteToken } from "../lib/jwt";

const db = prisma as unknown as {
  user: { create: jest.Mock; findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};

const RESTAURANT_ID = "cltest0restaurant0000000001";
const USER_ID = "cltest0user00000000000001";
const EMAIL = "chef@dopamina.com";
const PASSWORD = "Password123!";

let HASH: string;

beforeAll(async () => {
  HASH = await bcrypt.hash(PASSWORD, 10);
});

beforeEach(() => {
  db.$queryRaw.mockResolvedValue([]);
});

// ── Register ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/register", () => {
  const VALID = { name: "Chef", email: EMAIL, password: PASSWORD, restaurantName: "Dopamina" };

  it("returns 403 while self-serve signup is disabled (default)", async () => {
    const res = await request(app).post("/api/auth/register").send(VALID);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invitation/i);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("returns 201 with user and token pair when SELF_SERVE_SIGNUP_ENABLED=true", async () => {
    process.env.SELF_SERVE_SIGNUP_ENABLED = "true";
    try {
      db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          restaurant: { create: jest.fn().mockResolvedValue({ id: RESTAURANT_ID, name: "Dopamina" }) },
          user: {
            create: jest.fn().mockResolvedValue({
              id: USER_ID,
              name: "Chef",
              email: EMAIL,
              role: "ADMIN",
              restaurantId: RESTAURANT_ID,
            }),
          },
        })
      );

      const res = await request(app).post("/api/auth/register").send(VALID);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        user: { email: EMAIL, role: "ADMIN" },
        token: expect.any(String),
        refreshToken: expect.any(String),
      });
    } finally {
      delete process.env.SELF_SERVE_SIGNUP_ENABLED;
    }
  });
});

// ── Register via invite — must keep working while self-serve is off ───────────

describe("POST /api/team/register-via-invite", () => {
  const INVITE_EMAIL = "newhire@dopamina.com";

  it("registers via a valid invite token while self-serve is disabled", async () => {
    const token = signInviteToken({
      restaurantId:   RESTAURANT_ID,
      restaurantName: "Dopamina",
      role:           "STAFF",
      email:          INVITE_EMAIL,
    });
    db.user.findUnique.mockResolvedValue(null); // no duplicate account
    db.user.create.mockResolvedValue({
      id: "cltest0user00000000000002",
      name: "New Hire",
      email: INVITE_EMAIL,
      role: "STAFF",
      restaurantId: RESTAURANT_ID,
      restaurant: { name: "Dopamina", ownerAccountId: null },
    });

    const res = await request(app)
      .post("/api/team/register-via-invite")
      .send({ token, name: "New Hire", email: INVITE_EMAIL, password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      user: { email: INVITE_EMAIL, role: "STAFF", restaurantName: "Dopamina" },
      token: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it("rejects an invalid invite token", async () => {
    const res = await request(app)
      .post("/api/team/register-via-invite")
      .send({ token: "not-a-jwt", name: "X", email: INVITE_EMAIL, password: PASSWORD });

    expect(res.status).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  it("returns 200 with user and token pair on correct credentials", async () => {
    db.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: HASH,
      role: "ADMIN",
      restaurantId: RESTAURANT_ID,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { email: EMAIL, role: "ADMIN" },
      token: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it("returns 401 when the password is wrong", async () => {
    db.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: HASH,
      role: "ADMIN",
      restaurantId: RESTAURANT_ID,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: "wrongpassword!" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 401 for an email that does not exist", async () => {
    db.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: PASSWORD });

    expect(res.status).toBe(401);
  });
});

// ── /me ───────────────────────────────────────────────────────────────────────

describe("GET /api/auth/me", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with the user object for a valid token", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      role: "ADMIN",
      restaurantId: RESTAURANT_ID,
    });

    const token = signToken({ userId: USER_ID, role: "ADMIN", restaurantId: RESTAURANT_ID });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: EMAIL, role: "ADMIN" });
  });
});

// ── Refresh ───────────────────────────────────────────────────────────────────

describe("POST /api/auth/refresh", () => {
  it("returns 200 with a new token pair for a valid refresh token", async () => {
    db.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      role: "STAFF",
      restaurantId: RESTAURANT_ID,
    });

    const refreshToken = signRefreshToken({
      userId: USER_ID,
      role: "STAFF",
      restaurantId: RESTAURANT_ID,
    });

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it("returns 401 for a malformed refresh token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "not.a.valid.jwt" });

    expect(res.status).toBe(401);
  });
});
