import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

if (process.env.REACT_APP_SENTRY_DSN) {
  Sentry.init({
    dsn:         process.env.REACT_APP_SENTRY_DSN,
    environment: process.env.REACT_APP_ENV ?? process.env.NODE_ENV ?? "development",
    release:     process.env.REACT_APP_VERSION ?? undefined,
    tracesSampleRate:      parseFloat(process.env.REACT_APP_SENTRY_TRACES_RATE ?? "0.2"),
    replaysOnErrorSampleRate: 1.0,

    /**
     * PII scrubber — strip cookies and auth headers before events are sent
     * to Sentry.  Financial data never travels in the URL so breadcrumb URLs
     * are generally safe to keep.
     */
    beforeSend(event) {
      // Remove cookies from request context.
      if (event.request?.cookies) event.request.cookies = {};
      // Mask Authorization headers.
      const headers = event.request?.headers as Record<string, string> | undefined;
      if (headers?.["Authorization"]) headers["Authorization"] = "[Filtered]";
      return event;
    },
  });
}

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Register service worker in production for offline support and "Add to Home Screen".
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => console.error("Service worker registration failed:", err));
  });
}
