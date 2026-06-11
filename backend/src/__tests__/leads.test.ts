/**
 * POST /api/leads — public lead capture validation tests.
 *
 * Email became required June 2026 (landing form field). 422 comes from the
 * validate middleware (zod safeParse), so bad input never reaches Prisma.
 */

// ── Mocks (same set observability.test.ts uses to import the real app) ───────

jest.mock("../lib/prisma", () => {
  const prisma = {
    $queryRaw:  jest.fn(),
    auditLog:   { create: jest.fn() },
    user:       { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    lead:       { create: jest.fn() },
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

// NOTE: implementations are (re)applied in beforeEach — jest.config.ts sets
// resetMocks: true, which strips anything set inside the factory.
jest.mock("../lib/mailer", () => ({
  sendLeadNotification:   jest.fn(),
  sendInviteEmail:        jest.fn(),
  sendPartnerInviteEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendFeedbackEmail:      jest.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import request from "supertest";
import app     from "../app";
import { prisma } from "../lib/prisma";
import { sendLeadNotification } from "../lib/mailer";

const leadCreate = (prisma as unknown as { lead: { create: jest.Mock } }).lead.create;

const VALID = {
  name:       "Ana García",
  restaurant: "La Milagrosa",
  email:      "ana@lamilagrosa.mx",
  locations:  "2",
  phone:      "+52 555 123 4567",
  language:   "es",
  pageLang:   "es",
  company:    "",
};

beforeEach(() => {
  (sendLeadNotification as jest.Mock).mockResolvedValue("msg-id");
  leadCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "lead_1", source: "landing", createdAt: new Date(), ...data })
  );
});

describe("POST /api/leads", () => {
  it("creates the lead and notifies with the email included", async () => {
    const res = await request(app).post("/api/leads").send(VALID);

    expect(res.status).toBe(201);
    expect(leadCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "ana@lamilagrosa.mx" }),
    });
    expect(sendLeadNotification).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ana@lamilagrosa.mx" })
    );
  });

  it("returns 422 when email is missing", async () => {
    const { email: _omit, ...noEmail } = VALID;
    const res = await request(app).post("/api/leads").send(noEmail);

    expect(res.status).toBe(422);
    expect(res.body.issues).toHaveProperty("email");
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it("returns 422 when email is not a valid address", async () => {
    const res = await request(app)
      .post("/api/leads")
      .send({ ...VALID, email: "not-an-email" });

    expect(res.status).toBe(422);
    expect(res.body.issues).toHaveProperty("email");
    expect(leadCreate).not.toHaveBeenCalled();
  });
});
