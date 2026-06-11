/**
 * Base URL for links embedded in outbound email (invites, password resets,
 * partner setup).  These links land on app routes (/register, /reset-password,
 * /partner-setup), so FRONTEND_URL must point at the authenticated app —
 * https://app.kyruadvisory.com — not the marketing site at the apex domain.
 *
 * Read at call time (not module load) so tests can override the env var.
 */
export function getFrontendUrl(): string {
  return (
    process.env.FRONTEND_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://app.kyruadvisory.com"
      : "http://localhost:3000")
  );
}
