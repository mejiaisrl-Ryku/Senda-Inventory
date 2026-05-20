import rateLimit from "express-rate-limit";

// General API limiter — applied to all /api/* routes.
// 300 requests per 15 minutes is generous enough for normal SPA usage
// (page loads fire ~5–10 requests each) while still blocking abuse.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Stricter limiter for auth endpoints to slow brute-force attempts.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later." },
});
