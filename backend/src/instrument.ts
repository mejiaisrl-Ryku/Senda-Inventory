import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  release: process.env.npm_package_version || "dev",
  tracesSampleRate: 1.0,
  integrations: [],

  // Strip sensitive fields before events reach Sentry cloud.
  beforeSend(event) {
    const req = event.request as Record<string, unknown> | undefined;
    if (req) {
      delete req["data"];    // parsed request body (may contain passwords / financial data)
      delete req["cookies"]; // session cookies
      const headers = req["headers"] as Record<string, unknown> | undefined;
      if (headers?.["authorization"]) headers["authorization"] = "[Filtered]";
    }
    return event;
  },
});

console.info("[sentry] initialized for environment:", process.env.NODE_ENV ?? "development");
