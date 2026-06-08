/**
 * Request-ID middleware.
 *
 * Assigns a unique ID to every inbound HTTP request and makes it available:
 *   • As the X-Request-ID response header (returned to the client so the frontend
 *     can include it in Sentry breadcrumbs and support tickets).
 *   • Via requestIdStore.getStore() from anywhere in the same async call chain
 *     (AsyncLocalStorage — no prop-drilling through every function signature).
 *
 * Usage in a controller / lib:
 *   import { getRequestId } from "../middleware/requestId";
 *   logger.error("something broke", { requestId: getRequestId() });
 */

import { AsyncLocalStorage } from "async_hooks";
import { Request, Response, NextFunction } from "express";

// ── Store ─────────────────────────────────────────────────────────────────────

export const requestIdStore = new AsyncLocalStorage<string>();

/** Returns the request ID for the currently executing async context, or "none". */
export function getRequestId(): string {
  return requestIdStore.getStore() ?? "none";
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Reads X-Request-ID from the incoming request (allows the client to supply
 * its own trace ID, e.g. from Sentry) or generates a new UUID v4.
 * Always echos the final ID back in the response header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  // Accept only safe alphanumeric/dash/underscore values to prevent header injection.
  const id =
    typeof incoming === "string" && /^[\w-]{1,64}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();

  res.setHeader("X-Request-ID", id);
  requestIdStore.run(id, next);
}
