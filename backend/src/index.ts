import "dotenv/config";

// Sentry must be initialized before any other imports when used.
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Sentry = require("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.2,
  });
  console.info("Sentry initialized");
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
