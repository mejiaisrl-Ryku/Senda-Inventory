import winston from "winston";
import { getRequestId } from "../middleware/requestId";

// ── Sanitization helpers ──────────────────────────────────────────────────────

/** Masks an email address: "john.doe@example.com" → "jo***@example.com" */
export function sanitizeEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  const local  = email.slice(0, at);
  const domain = email.slice(at);          // includes "@"
  const visible = Math.min(2, local.length);
  return local.slice(0, visible) + "***" + domain;
}

/** Shows only the first 8 and last 8 characters of a token. */
export function sanitizeToken(token: string): string {
  if (token.length <= 16) return "***";
  return token.slice(0, 8) + "..." + token.slice(-8);
}

// ── Logger ────────────────────────────────────────────────────────────────────

const { combine, timestamp, json, simple, errors } = winston.format;

/**
 * Dynamic metadata appended to every log entry.
 * requestId is read from the AsyncLocalStorage context so it flows through
 * automatically without being passed explicitly to each logger call.
 */
const addRequestId = winston.format((info) => {
  info["requestId"] = getRequestId();
  return info;
});

const logger = winston.createLogger({
  level:       process.env.LOG_LEVEL ?? "info",
  defaultMeta: { service: "kyru-api" },
  format:      combine(errors({ stack: true }), addRequestId(), timestamp(), json()),
  transports: [
    new winston.transports.Console({
      format: combine(errors({ stack: true }), addRequestId(), simple()),
    }),
    new winston.transports.File({
      filename: "combined.log",
      format:   combine(errors({ stack: true }), addRequestId(), timestamp(), json()),
    }),
  ],
});

export default logger;
