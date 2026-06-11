/**
 * CORS allowlist tests.
 *
 * The app uses a two-tier CORS policy (see app.ts):
 *   • App origins (localhost:3000, app.kyruadvisory.com) — all routes,
 *     credentialed.
 *   • Marketing origins (kyruadvisory.com, www.kyruadvisory.com) — only the
 *     public lead-capture endpoint POST /api/leads.
 *
 * Preflight (OPTIONS) responses are asserted because that is what the browser
 * actually gates cross-origin POSTs on.
 */

// ── Mocks (same set observability.test.ts uses to import the real app) ───────

jest.mock("../lib/prisma", () => {
  const prisma = {
    $queryRaw:  jest.fn(),
    auditLog:   { create: jest.fn() },
    user:       { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  };
  return { prisma, prismaT: prisma, prismaAdmin: prisma };
});

jest.mock("../lib/redis", () => ({
  getRedis: jest.fn(),
}));

jest.mock("../lib/socket", () => ({
  initSocket: jest.fn(),
  getIO:      jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));

jest.mock("../lib/cacheInvalidation", () => ({
  invalidateFinancialCaches:   jest.fn(),
  invalidateLaborCaches:       jest.fn(),
  invalidateCogsCategoryCache: jest.fn(),
}));

jest.mock("../lib/cache", () => ({
  withCache:              (_k: string, _t: number, fetch: () => unknown) => fetch(),
  cacheGet:               jest.fn().mockResolvedValue(null),
  cacheSet:               jest.fn().mockResolvedValue(undefined),
  cacheInvalidate:        jest.fn().mockResolvedValue(undefined),
  cacheInvalidatePattern: jest.fn().mockResolvedValue(undefined),
  TTL_FINANCIAL: 300,
  TTL_STATIC:    1800,
}));

const passThrough = (_r: unknown, _s: unknown, next: () => void) => next();
jest.mock("../middleware/rateLimiter", () => ({
  apiLimiter:      passThrough,
  authLimiter:     passThrough,
  forgotPwLimiter: passThrough,
  leadsLimiter:    passThrough,
  aiLimiter:       passThrough,
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import request from "supertest";
import app     from "../app";

const APP_ORIGIN  = "https://app.kyruadvisory.com";
const APEX_ORIGIN = "https://kyruadvisory.com";
const WWW_ORIGIN  = "https://www.kyruadvisory.com";

const preflight = (path: string, origin: string) =>
  request(app)
    .options(path)
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type");

describe("CORS — authed routes (app tier)", () => {
  it("allows the app subdomain with credentials", async () => {
    const res = await preflight("/api/auth/login", APP_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows localhost for development", async () => {
    const res = await preflight("/api/auth/login", "http://localhost:3000");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("rejects the marketing apex on authed routes", async () => {
    const res = await preflight("/api/auth/login", APEX_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects unknown origins", async () => {
    const res = await preflight("/api/products", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("CORS — public lead capture (/api/leads)", () => {
  it("allows the apex domain", async () => {
    const res = await preflight("/api/leads", APEX_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(APEX_ORIGIN);
  });

  it("allows the www domain", async () => {
    const res = await preflight("/api/leads", WWW_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(WWW_ORIGIN);
  });

  it("allows the app subdomain too", async () => {
    const res = await preflight("/api/leads", APP_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
  });

  it("rejects unknown origins", async () => {
    const res = await preflight("/api/leads", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
