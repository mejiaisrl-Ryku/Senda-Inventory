/**
 * React Error Boundary.
 *
 * Catches unhandled errors thrown during rendering, lifecycle methods, or
 * constructor calls of any descendant component and prevents the entire app
 * from crashing.
 *
 * On error:
 *  1. Logs to Sentry (if configured) with the full error + component stack.
 *  2. Renders a friendly fallback UI instead of a blank/white screen.
 *  3. Offers a "Try again" button that resets the boundary state.
 *
 * Usage (wraps the full app in index.tsx):
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 * You can also wrap sub-trees to contain crashes to a single panel:
 *   <ErrorBoundary fallback={<p>Dashboard failed to load.</p>}>
 *     <DashboardPanel />
 *   </ErrorBoundary>
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children:  ReactNode;
  /** Optional custom fallback — defaults to the full-screen error UI. */
  fallback?: ReactNode;
}

interface State {
  hasError:  boolean;
  eventId:   string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, eventId: null };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Send to Sentry with the React component stack for precise attribution.
    const eventId = Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
    this.setState({ eventId: eventId ?? null });
  }

  handleReset = () => {
    this.setState({ hasError: false, eventId: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        role="alert"
        style={{
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          minHeight:      "100vh",
          padding:        "2rem",
          fontFamily:     "sans-serif",
          textAlign:      "center",
          background:     "#f9fafb",
          color:          "#111827",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Something went wrong
        </h1>
        <p style={{ color: "#6b7280", marginBottom: "1.5rem", maxWidth: "36rem" }}>
          An unexpected error occurred. Our team has been notified.
          {this.state.eventId && (
            <span style={{ display: "block", fontSize: "0.75rem", marginTop: "0.5rem" }}>
              Reference: {this.state.eventId}
            </span>
          )}
        </p>
        <button
          onClick={this.handleReset}
          style={{
            padding:      "0.5rem 1.5rem",
            borderRadius: "0.375rem",
            border:       "none",
            background:   "#2563eb",
            color:        "#fff",
            cursor:       "pointer",
            fontSize:     "0.875rem",
            fontWeight:   600,
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
