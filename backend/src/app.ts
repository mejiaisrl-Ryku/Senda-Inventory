import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { prisma } from "./lib/prisma";
import { apiLimiter } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";
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
import onboardingRouter from "./routes/onboarding";
import locationsRouter from "./routes/locations";
import feedbackRouter from "./routes/feedback";

const isProd = process.env.NODE_ENV === "production";

const DEFAULT_ORIGINS = "http://localhost:3000,https://aapp-final-1.vercel.app,https://aapp-final-1-git-main-mejiaisrl-kyru-s-projects.vercel.app,https://www.kyruadvisory.com,https://kyruadvisory.com";
export const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(",");

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

app.use(cors({ origin: allowedOrigins, credentials: true }));
// "combined" includes :response-time ms — used by Railway's log-based alerting.
app.use(morgan(isProd ? "combined" : "dev"));
app.use(express.json({ limit: "12mb" }));

// Health check — registered before the rate limiter so Railway uptime pings are never blocked.
app.get("/health", async (_req, res) => {
  const meta = {
    timestamp: new Date().toISOString(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok", ...meta });
  } catch {
    res.status(503).json({ status: "error", db: "error", ...meta });
  }
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
app.use("/api/onboarding", onboardingRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/feedback", feedbackRouter);

app.use(errorHandler);

export default app;
