import { Request, Response, NextFunction } from "express";

interface PrismaError extends Error {
  code?: string;
  meta?: { target?: string[] };
}

// Sentry is initialized optionally in index.ts when SENTRY_DSN is set.
// We import lazily so the absence of the package doesn't crash startup.
function captureToSentry(err: Error) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/node");
    if (Sentry.isInitialized?.()) Sentry.captureException(err);
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
  // Structured error log — every unhandled error is observable.
  console.error(
    JSON.stringify({
      event: "api_error",
      message: err.message,
      code: err.code,
      method: req.method,
      path: req.path,
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    })
  );

  captureToSentry(err);

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

  const status = (err as unknown as { status?: number }).status ?? 500;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Internal server error"
      : (err.message ?? "Internal server error");

  res.status(status).json({ error: message });
}
