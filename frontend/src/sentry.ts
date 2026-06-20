import * as Sentry from "@sentry/react";

// Reject placeholder DSNs (e.g. "your-dsn-here") to avoid Sentry console errors.
const dsn = process.env.REACT_APP_SENTRY_DSN;
const validDsn = /^https?:\/\/[^@]+@[^/]+\/\d+$/.test(dsn ?? "");

if (dsn && validDsn) {
  Sentry.init({
    dsn,
    environment: process.env.REACT_APP_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.REACT_APP_VERSION ?? undefined,
    tracesSampleRate: 1.0,
    integrations: [],

    // Strip cookies and mask auth headers before events are sent to Sentry.
    beforeSend(event) {
      if (event.request?.cookies) event.request.cookies = {};
      const headers = event.request?.headers as Record<string, string> | undefined;
      if (headers?.["Authorization"]) headers["Authorization"] = "[Filtered]";
      return event;
    },
  });
}
