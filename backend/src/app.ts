import * as Sentry from "@sentry/node";
import express, { Request, Response, NextFunction } from "express";
import cors, { CorsOptionsDelegate } from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { prisma } from "./lib/prisma";
import { getRedis } from "./lib/redis";
import { apiLimiter } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";
import { requestIdMiddleware } from "./middleware/requestId";
import authRouter from "./routes/auth";
import productsRouter from "./routes/products";
import stockRouter from "./routes/stock";
import ordersRouter from "./routes/orders";
import reportsRouter from "./routes/reports";
import salesRouter from "./routes/sales";
import teamRouter from "./routes/team";
import superAdminRouter from "./routes/superAdmin";
import aiRouter from "./routes/ai";
import laborRouter from "./routes/labor";
import countsRouter from "./routes/counts";
import recipesRouter from "./routes/recipes";
import preparationsRouter from "./routes/preparations";
import allergensRouter from "./routes/allergens";
import onboardingRouter from "./routes/onboarding";
import locationsRouter from "./routes/locations";
import feedbackRouter from "./routes/feedback";
import ownerRouter from "./routes/owner";
import { gmRouter, ownerDashRouter } from "./routes/phase5Routes";
import { ownerPnlRouter } from "./routes/phase6Routes";
import { ownerBudgetRouter } from "./routes/budgetRoutes";
import scanRouter from "./routes/scanRoutes";
import scanJobRouter from "./routes/scanJobRoutes";
import metricsRouter from "./routes/metricsRoutes";
import cogsRouter from "./routes/cogs";
import leadsRouter from "./routes/leads";
import toastRouter from "./routes/toast";

const isProd = process.env.NODE_ENV === "production";

// CORS is two-tier:
//   • App origins — the authenticated SPA at app.kyruadvisory.com. Credentialed
//     CORS; also used for socket.io (see index.ts). Override via ALLOWED_ORIGINS
//     env var in Railway (comma-separated) for staging / preview deployments.
//   • Marketing origins — apex + www may only reach the public lead-capture
//     endpoint (POST /api/leads); they never get credentialed responses.
const DEFAULT_ORIGINS = "http://localhost:3000,https://app.kyruadvisory.com";
export const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(",");
const MARKETING_ORIGINS = ["https://kyruadvisory.com", "https://www.kyruadvisory.com"];

const app = express();

app.use(
  helmet({
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    contentSecurityPolicy: isProd,
  })
);

if (isProd) {
  app.set("trust proxy", 1);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") return next();
    res.redirect(301, `https://${req.headers.host}${req.url}`);
  });
}

// Request ID must be first so every subsequent middleware/log has a trace ID.
app.use(requestIdMiddleware);

const corsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  if (req.path.startsWith("/api/leads")) {
    // Public lead capture — accepts the marketing site, no credentials.
    callback(null, { origin: [...MARKETING_ORIGINS, ...allowedOrigins] });
  } else {
    callback(null, { origin: allowedOrigins, credentials: true });
  }
};
app.use(cors(corsDelegate));
// "combined" includes :response-time ms — used by Railway's log-based alerting.
// :req[x-request-id] propagates the trace ID into every access-log line.
morgan.token("reqId", (req) => req.headers["x-request-id"] as string ?? "-");
app.use(morgan(isProd ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" id=:reqId' : "dev"));
// 100 KB is sufficient for all JSON API payloads.
// Image uploads use multer (separate 10 MB limit) and never hit this middleware.
// The previous 12 MB limit was a DoS vector — a malicious client could buffer
// 12 MB of JSON and exhaust server memory.
app.use(express.json({ limit: "100kb" }));

// Health / readiness — registered before the rate limiter so Railway uptime
// probes are never throttled.
const buildMeta = () => ({
  timestamp: new Date().toISOString(),
  version:   process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
});

/**
 * GET /health — liveness probe.
 * Returns 200 as long as the process is running.  Does NOT check dependencies —
 * a slow DB should not cause Railway to restart the container.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ...buildMeta() });
});

/**
 * GET /ready — readiness probe.
 * Returns 200 only when all critical dependencies (DB + optional Redis) are
 * reachable.  Railway will stop sending traffic to a replica that returns 503.
 *
 * Response shape:
 *   { status: "ok"|"degraded"|"error", db: "ok"|"error",
 *     redis: "ok"|"degraded"|"error", ... }
 */
app.get("/ready", async (_req, res) => {
  const meta = buildMeta();
  let dbStatus: "ok" | "error" = "ok";
  let redisStatus: "ok" | "degraded" = "ok";

  // DB check — required.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  // Redis check — optional (app degrades gracefully without it).
  const redis = getRedis();
  if (redis) {
    try {
      await redis.ping();
    } catch {
      redisStatus = "degraded"; // Redis down → in-memory fallback, not fatal
    }
  } else {
    redisStatus = "degraded"; // REDIS_URL not set
  }

  const httpStatus = dbStatus === "error" ? 503 : 200;
  const overallStatus = dbStatus === "error" ? "error" : redisStatus === "degraded" ? "degraded" : "ok";

  res.status(httpStatus).json({
    status: overallStatus,
    db:     dbStatus,
    redis:  redisStatus,
    ...meta,
  });
});

// Rate limiter applied only to /api — /health stays exempt.
app.use("/api", apiLimiter);

app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/stock", stockRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/sales", salesRouter);
app.use("/api/team", teamRouter);
app.use("/api/super-admin", superAdminRouter);
app.use("/api/ai", aiRouter);
app.use("/api/labor", laborRouter);
app.use("/api/counts", countsRouter);
app.use("/api/recipes", recipesRouter);
app.use("/api/preparations", preparationsRouter);
app.use("/api/allergens", allergensRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/feedback",      feedbackRouter);
app.use("/api/owner-account", ownerRouter);
app.use("/api/gm",            gmRouter);
app.use("/api/owner",         ownerDashRouter);
app.use("/api/owner",         ownerPnlRouter);
app.use("/api/owner",         ownerBudgetRouter);
app.use("/api/inventory",     scanRouter);
app.use("/api/scan-jobs",     scanJobRouter);
app.use("/api/metrics",       metricsRouter);
app.use("/api/cogs-categories", cogsRouter);
app.use("/api/leads",           leadsRouter);
app.use("/api/toast",           toastRouter);

app.use(Sentry.Handlers.errorHandler());

app.use(errorHandler);

export default app;
