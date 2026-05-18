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

const isProd = process.env.NODE_ENV === "production";

export const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000").split(",");

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
app.use(express.json({ limit: "1mb" }));
app.use(apiLimiter);

// Health check with DB ping — used by Railway health checks and uptime monitors.
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", db: "error", timestamp: new Date().toISOString() });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/stock", stockRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/reports", reportsRouter);

app.use(errorHandler);

export default app;
