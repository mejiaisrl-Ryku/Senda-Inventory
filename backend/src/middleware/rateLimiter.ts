/**
 * Rate-limiter middleware — tiered, Redis-backed, Railway-aware.
 *
 * Architecture
 * ─────────────
 * • When REDIS_URL is set (production / staging) all counters are stored in
 *   Redis so limits are shared across every Railway instance.
 * • When REDIS_URL is absent (local dev, unit tests) the default in-memory
 *   store is used automatically — no Redis dependency at dev time.
 *
 * Tiers
 * ─────────────
 * apiLimiter         — generous default applied to every /api/* route.
 * authLimiter        — strict, applied only to login / register / refresh.
 * forgotPwLimiter    — very strict, applied to /auth/forgot-password to prevent
 *                      email-flood and account-enumeration amplification attacks.
 * aiLimiter          — cost-control limit on the paid AI invoice-extraction
 *                      endpoint; separate hourly window because AI calls are
 *                      expensive, not just abusive.
 *
 * All limits are configurable via environment variables so they can be tuned
 * in Railway without a code deploy.
 *
 * 429 responses
 * ─────────────
 * Every limiter sets `standardHeaders: true` (RateLimit-* draft-7 headers) which
 * includes a `Retry-After` header automatically.  Legacy X-RateLimit-* headers
 * are suppressed.
 */

import rateLimit, { Options as RateLimitOptions } from "express-rate-limit";
import { RedisStore }                              from "rate-limit-redis";
import { getRedis }                               from "../lib/redis";

// ── Store factory ─────────────────────────────────────────────────────────────
// Returns a `{ store }` object to spread into rateLimit() options.
// When REDIS_URL is absent the key is omitted entirely so express-rate-limit
// falls back to its built-in MemoryStore (TypeScript-clean, no `undefined`).

function makeStoreOpts(prefix: string): Pick<RateLimitOptions, "store"> | Record<string, never> {
  const client = getRedis();
  if (!client) return {}; // no store key → MemoryStore

  return {
    store: new RedisStore({
      // sendCommand is the only interface rate-limit-redis@5 needs from the client.
      // ioredis exposes it as client.call — we wrap it so the types align.
      sendCommand: (...args: string[]) => (client as any).call(...args),
      prefix: `rl:${prefix}:`,
    }),
  };
}

// ── Env-configurable limits ───────────────────────────────────────────────────

function int(envKey: string, fallback: number): number {
  const v = parseInt(process.env[envKey] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

// ── Limiters ──────────────────────────────────────────────────────────────────

/**
 * Default limit for all /api/* routes.
 * 300 requests per 15 minutes — generous enough that a GM opening every
 * dashboard panel in quick succession (~10 parallel requests per page load)
 * is nowhere near the ceiling.
 *
 * Env overrides: API_RATE_LIMIT_MAX, API_RATE_LIMIT_WINDOW_MS
 */
export const apiLimiter = rateLimit({
  windowMs: int("API_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max:      int("API_RATE_LIMIT_MAX", 300),
  standardHeaders: "draft-7", // Sends RateLimit-* + Retry-After
  legacyHeaders:   false,
  ...makeStoreOpts("api"),
  message:         {
    error: "Too many requests, please try again later.",
    errorEs: "Demasiadas solicitudes, intenta de nuevo más tarde.",
  },
  skipFailedRequests: false,
});

/**
 * Strict auth limiter — login, register, refresh.
 * 10 attempts per 15 minutes per IP is very generous for legitimate users
 * (how often do you log in 10 times in 15 minutes?) but stops credential-
 * stuffing and password-spray attacks cold.
 *
 * Env overrides: AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS
 */
export const authLimiter = rateLimit({
  windowMs: int("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max:      int("AUTH_RATE_LIMIT_MAX", 10),
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  ...makeStoreOpts("auth"),
  message:         {
    error: "Too many attempts, please try again later.",
    errorEs: "Demasiados intentos, intenta de nuevo en un momento.",
  },
  skipSuccessfulRequests: true, // Only count failed attempts toward the limit.
});

/**
 * Forgot-password limiter — very strict to prevent email-flood attacks.
 * 5 requests per hour per IP.
 *
 * Env overrides: FORGOT_PW_RATE_LIMIT_MAX, FORGOT_PW_RATE_LIMIT_WINDOW_MS
 */
export const forgotPwLimiter = rateLimit({
  windowMs: int("FORGOT_PW_RATE_LIMIT_WINDOW_MS", 60 * 60 * 1000), // 1 hour
  max:      int("FORGOT_PW_RATE_LIMIT_MAX", 5),
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  ...makeStoreOpts("forgotpw"),
  message:         {
    error: "Too many password reset requests, please try again later.",
    errorEs: "Demasiadas solicitudes de recuperación, intenta de nuevo más tarde.",
  },
});

/**
 * AI invoice-extraction limiter — cost-control.
 * As of Sprint 1 this gates the *enqueue* endpoint, not the Claude call itself
 * (the worker calls Claude, unmetered by this limiter) — raised from 20 to 100
 * per hour since enqueuing is just an S3 PUT + DB insert.
 *
 * Env overrides: AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS
 */
export const aiLimiter = rateLimit({
  windowMs: int("AI_RATE_LIMIT_WINDOW_MS", 60 * 60 * 1000), // 1 hour
  max:      int("AI_RATE_LIMIT_MAX", 100),
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  ...makeStoreOpts("ai"),
  message:         {
    error: "AI scan limit reached.  Please try again in an hour.",
    errorEs: "Límite de escaneo IA alcanzado.  Intenta de nuevo en una hora.",
  },
});

/**
 * Marketing-lead limiter — public unauthenticated endpoint, so keep it tight.
 * 5 submissions per hour per IP (a real prospect submits once).
 *
 * Env overrides: LEADS_RATE_LIMIT_MAX, LEADS_RATE_LIMIT_WINDOW_MS
 */
export const leadsLimiter = rateLimit({
  windowMs: int("LEADS_RATE_LIMIT_WINDOW_MS", 60 * 60 * 1000), // 1 hour
  max:      int("LEADS_RATE_LIMIT_MAX", 5),
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  ...makeStoreOpts("leads"),
  message:         {
    error: "Too many requests, please try again later.",
    errorEs: "Demasiadas solicitudes, intenta de nuevo más tarde.",
  },
});
