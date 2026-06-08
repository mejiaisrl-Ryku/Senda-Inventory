import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";
import { getRequestId } from "./requestId";

interface PrismaError extends Error {
  code?: string;
  meta?: { target?: string[] };
}

// Sentry is initialized optionally in index.ts when SENTRY_DSN is set.
// We import lazily so the absence of the package doesn't crash startup.
function captureToSentry(err: Error, requestId: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/node");
    if (Sentry.isInitialized?.()) {
      Sentry.withScope((scope: { setTag: (k: string, v: string) => void; setLevel: (l: string) => void }) => {
        scope.setTag("requestId", requestId);
        scope.setLevel("error");
        Sentry.captureException(err);
      });
    }
  } catch {
    // @sentry/node not installed — skip silently.
  }
}

export function errorHandler(
  err: PrismaError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = getRequestId();
  const status    = (err as unknown as { status?: number }).status ?? 500;
  const is5xx     = status >= 500;

  // Structured error log — always log server errors; log 4xx at warn level.
  // Never include req.body (may contain passwords / financial data).
  const logData = {
    event:     "api_error",
    requestId,
    method:    req.method,
    path:      req.path,
    status,
    message:   err.message,
    code:      err.code,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  };

  if (is5xx) {
    logger.error(logData);
  } else {
    logger.warn(logData);
  }

  // Only send unhandled server errors to Sentry (not client 4xx noise).
  if (is5xx) captureToSentry(err, requestId);

  // Prisma error codes → HTTP semantics
  switch (err.code) {
    case "P2025":
      return res.status(404).json({ error: "Record not found" });
    case "P2002":
      return res.status(409).json({
        error: "A record with that value already exists",
        field: err.meta?.target?.[0],
      });
    case "P2003":
      return res.status(400).json({ error: "Referenced record does not exist" });
    case "P2014":
      return res.status(400).json({ error: "Relation violation" });
  }

  const message =
    process.env.NODE_ENV === "production" && is5xx
      ? "Internal server error"
      : (err.message ?? "Internal server error");

  res.status(status).json({ error: message, requestId });
}
