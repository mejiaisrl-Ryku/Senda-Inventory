import axios from "axios";

/** Extract a human-readable message from any thrown value. */
export function getApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: string; issues?: Record<string, string[]> }
      | undefined;
    if (data?.error) return data.error;
    if (data?.issues) {
      const first = Object.entries(data.issues)[0];
      return first ? `${first[0]}: ${first[1][0]}` : "Validation failed";
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

/** Extract per-field validation errors from a Zod 422 response. */
export function getFieldErrors(err: unknown): Record<string, string> {
  if (
    axios.isAxiosError(err) &&
    err.response?.status === 422 &&
    err.response.data?.issues
  ) {
    const issues = err.response.data.issues as Record<string, string[]>;
    return Object.fromEntries(
      Object.entries(issues).map(([k, v]) => [k, v[0]])
    );
  }
  return {};
}

/** Log to console (and optionally Sentry) in the browser. */
export function logClientError(err: unknown, context?: string) {
  const message = getApiError(err);
  console.error(`[${context ?? "app"}]`, message, err);

  // Forward to Sentry if the SDK is loaded.
  const win = window as unknown as { Sentry?: { captureException: (e: unknown) => void } };
  if (win.Sentry) win.Sentry.captureException(err);
}
