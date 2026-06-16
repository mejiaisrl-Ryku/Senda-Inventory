import request from "supertest";

// ── Mock: Prisma ──────────────────────────────────────────────────────────────
jest.mock("../lib/prisma", () => {
  const toastConnection = {
    findUnique: jest.fn(),
    upsert:     jest.fn(),
    update:     jest.fn(),
    deleteMany: jest.fn(),
  };
  const prisma = { toastConnection, $queryRaw: jest.fn(), $transaction: jest.fn() };
  return { prisma, prismaT: prisma, prismaAdmin: prisma };
});

// ── Mock: Toast OAuth state store ─────────────────────────────────────────────
jest.mock("../lib/toast-state", () => ({
  setOAuthState:    jest.fn(),
  consumeOAuthState: jest.fn(),
}));

// ── Mock: Toast API client ────────────────────────────────────────────────────
jest.mock("../lib/toast-client", () => ({
  getAuthorizationUrl:  jest.fn(),
  exchangeCodeForToken: jest.fn(),
  refreshAccessToken:   jest.fn(),
  getRestaurantInfo:    jest.fn(),
}));

// ── Mock: rate limiters (pass-through) ────────────────────────────────────────
const passThrough = (_r: unknown, _s: unknown, next: () => void) => next();
jest.mock("../middleware/rateLimiter", () => ({
  apiLimiter:      passThrough,
  authLimiter:     passThrough,
  forgotPwLimiter: passThrough,
  leadsLimiter:    passThrough,
  aiLimiter:       passThrough,
}));

// ── Mock: socket (not needed for toast) ──────────────────────────────────────
jest.mock("../lib/socket", () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));

// Set a stable encryption key before importing anything that uses it.
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.FRONTEND_URL   = "http://localhost:3000";

import app from "../app";
import { prisma } from "../lib/prisma";
import { setOAuthState, consumeOAuthState } from "../lib/toast-state";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getRestaurantInfo,
} from "../lib/toast-client";
import { signToken } from "../lib/jwt";
import { encrypt } from "../lib/encryption";

// Typed mock helpers.
const db = prisma.toastConnection as unknown as {
  findUnique: jest.Mock;
  upsert:     jest.Mock;
  update:     jest.Mock;
  deleteMany: jest.Mock;
};
const mockSetState      = setOAuthState      as jest.Mock;
const mockConsumeState  = consumeOAuthState  as jest.Mock;
const mockGetAuthUrl    = getAuthorizationUrl as jest.Mock;
const mockExchange      = exchangeCodeForToken as jest.Mock;
const mockRefresh       = refreshAccessToken   as jest.Mock;
const mockGetRestaurant = getRestaurantInfo    as jest.Mock;

const RESTAURANT_ID = "rest_test_001";
const USER_ID       = "user_test_001";

function adminToken() {
  return signToken({ userId: USER_ID, role: "ADMIN", restaurantId: RESTAURANT_ID });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Test 1 ────────────────────────────────────────────────────────────────────
describe("POST /api/toast/connect", () => {
  it("returns authUrl containing client_id, redirect_uri and state", async () => {
    const fakeUrl =
      "https://www.toasttab.com/authentication/oauth/authorize" +
      "?response_type=code&client_id=test_client&redirect_uri=https%3A%2F%2Fapp.kyruadvisory.com%2Fapi%2Ftoast%2Fcallback&state=abc123";

    mockSetState.mockResolvedValue(undefined);
    mockGetAuthUrl.mockReturnValue(fakeUrl);

    const res = await request(app)
      .post("/api/toast/connect")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("authUrl");
    expect(res.body.authUrl).toContain("client_id");
    expect(res.body.authUrl).toContain("redirect_uri");
    expect(res.body.authUrl).toContain("state");

    expect(mockSetState).toHaveBeenCalledWith(
      expect.any(String), // random state
      RESTAURANT_ID
    );
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────
describe("GET /api/toast/callback", () => {
  it("exchanges code, stores encrypted connection, and redirects to /dashboard?toast=connected", async () => {
    mockConsumeState.mockResolvedValue(RESTAURANT_ID);
    mockExchange.mockResolvedValue({
      accessToken:  "at_live",
      refreshToken: "rt_live",
      expiresIn:    3600,
    });
    mockGetRestaurant.mockResolvedValue({
      locationGuid:   "loc_guid_001",
      restaurantName: "Test Bistro",
    });
    db.upsert.mockResolvedValue({});

    const res = await request(app)
      .get("/api/toast/callback")
      .query({ code: "auth_code_123", state: "valid_state" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("toast=connected");

    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { restaurantId: RESTAURANT_ID },
        create: expect.objectContaining({
          restaurantId:    RESTAURANT_ID,
          toastLocationId: "loc_guid_001",
          // Tokens must NOT be plaintext.
          accessToken:  expect.not.stringContaining("at_live"),
          refreshToken: expect.not.stringContaining("rt_live"),
        }),
      })
    );
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────────
describe("GET /api/toast/callback — invalid state", () => {
  it("returns 400 and does NOT store tokens", async () => {
    mockConsumeState.mockResolvedValue(null); // state not found / expired

    const res = await request(app)
      .get("/api/toast/callback")
      .query({ code: "any_code", state: "tampered_state" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(db.upsert).not.toHaveBeenCalled();
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────────
describe("GET /api/toast/status — not connected", () => {
  it("returns { connected: false } when no connection exists", async () => {
    db.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/toast/status")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });
});

// ── Test 5 ────────────────────────────────────────────────────────────────────
describe("GET /api/toast/status — connected, token valid", () => {
  it("returns connected:true with locationId and expiresAt without calling refresh", async () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    db.findUnique.mockResolvedValue({
      restaurantId:    RESTAURANT_ID,
      toastLocationId: "loc_guid_001",
      accessToken:     encrypt("at_live"),
      refreshToken:    encrypt("rt_live"),
      expiresAt,
    });

    const res = await request(app)
      .get("/api/toast/status")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.locationId).toBe("loc_guid_001");
    expect(res.body.expiresAt).toBeDefined();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// ── Test 6 ────────────────────────────────────────────────────────────────────
describe("GET /api/toast/status — token expired", () => {
  it("calls refreshAccessToken, updates DB, and returns connected:true", async () => {
    const expiredAt = new Date(Date.now() - 60 * 1000); // 1 minute ago
    db.findUnique.mockResolvedValue({
      restaurantId:    RESTAURANT_ID,
      toastLocationId: "loc_guid_001",
      accessToken:     encrypt("at_old"),
      refreshToken:    encrypt("rt_old"),
      expiresAt:       expiredAt,
    });

    mockRefresh.mockResolvedValue({
      accessToken:  "at_new",
      refreshToken: "rt_new",
      expiresIn:    3600,
    });
    db.update.mockResolvedValue({});

    const res = await request(app)
      .get("/api/toast/status")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.expiresAt).toBeDefined();

    expect(mockRefresh).toHaveBeenCalledWith("rt_old");

    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: RESTAURANT_ID },
        data: expect.objectContaining({
          accessToken:  expect.not.stringContaining("at_new"),
          refreshToken: expect.not.stringContaining("rt_new"),
        }),
      })
    );
  });
});
