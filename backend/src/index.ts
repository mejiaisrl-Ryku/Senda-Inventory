import "dotenv/config";

// Sentry must be initialized before any other imports when used.
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Sentry = require("@sentry/node");
  Sentry.init({
    dsn:              process.env.SENTRY_DSN,
    environment:      process.env.NODE_ENV ?? "development",
    release:          process.env.RAILWAY_GIT_COMMIT_SHA ?? undefined,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.2"),

    /**
     * PII scrubber — runs before every event is sent to Sentry.
     * Strips known-sensitive fields from request data so no passwords,
     * tokens, or financial records reach the Sentry cloud.
     */
    beforeSend(event: Record<string, unknown>) {
      // Scrub request body entirely — may contain passwords or financial data.
      const req = event["request"] as Record<string, unknown> | undefined;
      if (req) {
        delete req["data"];   // parsed request body
        delete req["cookies"]; // session cookies
        // Mask Authorization header value.
        const headers = req["headers"] as Record<string, unknown> | undefined;
        if (headers?.["authorization"]) {
          headers["authorization"] = "[Filtered]";
        }
      }
      return event;
    },
  });
  // eslint-disable-next-line no-console
  console.info("[sentry] initialized for environment:", process.env.NODE_ENV ?? "development");
}

import { createServer } from "http";
import app, { allowedOrigins } from "./app";
import { initSocket } from "./lib/socket";

const httpServer = createServer(app);
const PORT = process.env.PORT ?? 4000;

initSocket(httpServer, allowedOrigins);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} [${process.env.NODE_ENV ?? "development"}]`);
});
