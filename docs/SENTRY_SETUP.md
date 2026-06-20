# Sentry Error Monitoring — Setup Guide

## 1. Overview

Sentry captures unhandled errors, slow database queries, and deployment releases across the Senda Inventory platform. For a multi-location restaurant system — where a silent crash in inventory tracking or COGS calculation can have real financial impact — Sentry provides the visibility needed to catch and fix issues before operators notice them.

Key capabilities enabled:

- **Error tracking** — React render crashes, Express route errors, unhandled promise rejections
- **Prisma monitoring** — slow query breadcrumbs and alerts
- **Release tracking** — every production deploy is tagged with a commit SHA so errors can be pinned to the exact version that introduced them
- **Source maps** — stack traces point to original TypeScript source lines, not compiled JS

---

## 2. Architecture

```
Frontend (React/CRA)           Backend (Node.js/Express)
─────────────────────          ─────────────────────────
sentry.ts                      instrument.ts
  └─ Sentry.init()               └─ Sentry.init()
  └─ PII scrubber                └─ PII scrubber

index.tsx                      index.ts
  └─ import "./sentry" (1st)     └─ import "dotenv/config" (1st)
  └─ <ErrorBoundary>             └─ import "./instrument" (2nd)

ErrorBoundary.tsx              app.ts
  └─ captureException()          └─ Sentry.Handlers.errorHandler()
  └─ shows Sentry event ID         (after all routes, before custom handler)

                               middleware/errorHandler.ts
                                 └─ captureException() + requestId tag

                               lib/prisma.ts
                                 └─ $on("query") slow query monitor
                                 └─ breadcrumb >1000ms
                                 └─ captureMessage >3000ms

CI/CD
─────
.github/workflows/sentry-release.yml
  └─ triggers on push to main
  └─ creates Sentry release tagged with github.sha
  └─ marks both projects as deployed to production
```

---

## 3. Files Created / Modified

### Frontend

| File | Description |
|------|-------------|
| `frontend/src/sentry.ts` | Sentry.init() with DSN, environment, release, PII scrubber |
| `frontend/src/index.tsx` | `import "./sentry"` as first line; wraps app in `<ErrorBoundary>` |
| `frontend/src/components/ErrorBoundary.tsx` | Class component; calls `captureException` + shows Sentry event ID in fallback UI |
| `frontend/.env.local` | `REACT_APP_SENTRY_DSN`, `REACT_APP_VERSION` for local dev |
| `frontend/.env.production.example` | Template for production env vars (actual values set in Vercel) |

### Backend

| File | Description |
|------|-------------|
| `backend/src/instrument.ts` | Sentry.init() with DSN, environment, release, PII scrubber |
| `backend/src/index.ts` | `import "dotenv/config"` then `import "./instrument"` — order is critical |
| `backend/src/app.ts` | `Sentry.Handlers.errorHandler(app)` registered after all routes |
| `backend/src/middleware/errorHandler.ts` | Calls `captureException` with `requestId` tag on all 5xx errors |
| `backend/src/lib/prisma.ts` | `createMonitoredClient()` attaches `$on("query")` to all three Prisma clients |
| `backend/scripts/upload-sourcemaps.ts` | Uploads compiled `dist/` source maps to Sentry after build |
| `backend/tsconfig.json` | `sourceMap: true`, `inlineSources: true` |
| `backend/package.json` | `postbuild` script runs source map upload; `@sentry/cli` in devDependencies |

### CI/CD

| File | Description |
|------|-------------|
| `.github/workflows/sentry-release.yml` | Creates Sentry release on every push to `main` |

### Vercel (environment variables — not files)

| Variable | Value |
|----------|-------|
| `REACT_APP_SENTRY_DSN` | Frontend DSN from Sentry project settings |
| `REACT_APP_VERSION` | e.g. `1.0.0` — update on each release |
| `GENERATE_SOURCEMAP` | `true` |

---

## 4. How It Works

### Frontend error flow

```
User action throws error
  → React ErrorBoundary.componentDidCatch()
  → Sentry.captureException(error, { componentStack })
  → Fallback UI rendered with Sentry event ID
  → Error appears in Sentry dashboard within ~30s
```

### Backend error flow

```
Express route throws error
  → Sentry.Handlers.errorHandler() middleware (app.ts:175)
      captures error + attaches request context
  → Custom errorHandler (middleware/errorHandler.ts)
      captureException() adds requestId tag
      returns JSON { error, requestId } to client
  → Error appears in Sentry dashboard within ~30s
```

### Prisma slow query flow

```
Prisma executes query
  → $on("query") listener fires with duration in ms

  If duration > 1000ms:
    → Sentry.addBreadcrumb({ level: "warning", category: "db.query" })
      message: "Slow query (1234ms): SELECT ..."

  If duration > 3000ms:
    → Sentry.addBreadcrumb() (same as above)
    → Sentry.captureMessage("Slow Prisma query detected", "warning")
      appears as a Warning issue in Sentry dashboard
```

### PII scrubbing (both frontend and backend)

Before any event is sent to Sentry, `beforeSend` strips:
- Request body (`req.data`) — may contain passwords or financial data
- Cookies (`req.cookies`) — session tokens
- `Authorization` header → replaced with `"[Filtered]"`

---

## 5. Accessing the Sentry Dashboard

**URL:** https://kyru-advisory.sentry.io

**Projects:**

| Project | Slug | What it monitors |
|---------|------|-----------------|
| React frontend | `javascript-react` | UI errors, ErrorBoundary catches |
| Node.js backend | `kyru-backend` | API errors, slow queries, 5xx responses |

**Where to look:**

- **Issues** — all captured errors, grouped by type. Filter by project, environment, or release.
- **Releases** — each production deploy appears here tagged with the commit SHA. Click a release to see which errors were introduced or resolved.
- **Performance** (if enabled later) — API latency, DB query times.

---

## 6. Local Development

### Test frontend errors

Start the frontend (`npm start` in `frontend/`) and trigger an error manually from the browser console:

```js
// In browser DevTools console:
throw new Error("manual test");
```

The `ErrorBoundary` will catch render errors. For non-render errors, use `Sentry.captureException` directly.

Ensure `REACT_APP_SENTRY_DSN` is set in `frontend/.env.local` — without it, Sentry silently skips init.

### Test backend errors

With the backend running (`npm run dev` in `backend/`):

```bash
curl http://localhost:4000/api/any-nonexistent-route
```

Or add a temporary `throw new Error("test")` in any route handler. Check the terminal for `[sentry] initialized for environment: development` on startup to confirm init succeeded.

---

## 7. Production Deployment

On every push to `main`, three things happen in parallel:

```
git push → main
  │
  ├─► Railway detects push → builds & deploys backend
  │     postbuild: ts-node scripts/upload-sourcemaps.ts
  │       → source maps uploaded to Sentry for kyru-backend
  │
  ├─► Vercel detects push → builds & deploys frontend
  │     GENERATE_SOURCEMAP=true → source maps generated
  │     (source map upload for frontend requires separate CI step — future improvement)
  │
  └─► GitHub Actions: sentry-release.yml
        → getsentry/action-release@v1
        → creates Sentry release tagged with github.sha
        → marks javascript-react + kyru-backend as deployed to production
        → associates commits for "Resolved in version X" tracking
```

---

## 8. Release Versions

| Context | Version source | Example value |
|---------|---------------|---------------|
| Backend local | `process.env.npm_package_version` | `0.1.0` |
| Frontend local | `process.env.REACT_APP_VERSION` | `1.0.0` |
| CI/CD (production) | `${{ github.sha }}` | `190b9fa3...` |

The CI-generated SHA is the authoritative version for production. The local values only affect dev/staging events. When cutting a release, update `REACT_APP_VERSION` in Vercel and `version` in both `package.json` files to keep local and production consistent.

---

## 9. Sample Rates

Current configuration (both frontend and backend):

```ts
tracesSampleRate: 1.0  // capture 100% of transactions
```

This is appropriate for current traffic levels. At scale, reduce for production to control costs:

```ts
tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
```

See [Future Improvements](#12-future-improvements) for the full recommendation.

---

## 10. Maintenance

**On each release:**
- Bump `version` in `backend/package.json` and `frontend/package.json`
- Update `REACT_APP_VERSION` in Vercel environment variables
- The GitHub Actions workflow will automatically tag the new Sentry release with the commit SHA

**Weekly:**
- Check Sentry **Issues** for new or recurring errors
- Review any `"Slow Prisma query detected"` warnings — these indicate queries that may need indexing or optimization

**Monthly:**
- Review Sentry quota usage (Events → Stats in your org settings)
- Adjust `tracesSampleRate` if approaching quota limits

---

## 11. Troubleshooting

**Errors not appearing in Sentry**

1. Check that `SENTRY_DSN` / `REACT_APP_SENTRY_DSN` is set and non-empty in the environment
2. Verify initialization order in `backend/src/index.ts`:
   ```ts
   import "dotenv/config";   // MUST be first — loads .env
   import "./instrument";    // MUST be second — reads SENTRY_DSN
   ```
3. Confirm `Sentry.isInitialized()` returns `true` by adding a temporary log after `Sentry.init()`

**Backend errors not appearing (Express)**

Confirm middleware order in `backend/src/app.ts`:
```ts
// All routes registered here
app.use("/api/...", router);

// Then Sentry error handler
app.use(Sentry.Handlers.errorHandler());

// Then custom error handler
app.use(errorHandler);
```
If `Sentry.Handlers.errorHandler()` is before the routes, or after the custom handler, it won't capture anything.

**Source maps not uploading (backend)**

1. Check `SENTRY_AUTH_TOKEN` is set in GitHub repository secrets (Settings → Secrets and variables → Actions)
2. Verify `npm run build` succeeds — `postbuild` only runs if build exits 0
3. Check Railway build logs for `[sentry] Source maps uploaded for release:` confirmation line

**Slow query breadcrumbs not appearing**

Prisma must be configured with `emit: "event"` for the query log level. Verify `prismaOptions()` in `backend/src/lib/prisma.ts`:
```ts
log: [
  { emit: "event", level: "query" },
  "warn",
  "error",
],
```
If `"query"` is a plain string instead of an object, `$on("query", ...)` will never fire.

---

## 12. Future Improvements

**Environment-aware sample rates** *(recommended before significant traffic growth)*
```ts
tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
```
Reduces billable events in production by 90% while keeping full visibility in dev.

**Session Replay** — Records anonymized UI interactions leading up to an error. Useful for diagnosing UX issues that are hard to reproduce. Add to `frontend/src/sentry.ts`:
```ts
import { replayIntegration } from "@sentry/react";

integrations: [replayIntegration()],
replaysOnErrorSampleRate: 1.0,   // replay 100% of sessions with errors
replaysSessionSampleRate: 0.05,  // replay 5% of all sessions
```

**Performance Tracing** — Tracks API endpoint latency and DB query times as distributed traces. Add to `backend/src/instrument.ts`:
```ts
import { httpIntegration } from "@sentry/node";

integrations: [httpIntegration()],
tracesSampleRate: 0.1,
```

**Frontend source map upload in CI** — Currently backend source maps upload via `postbuild`; frontend source maps rely on Vercel's built-in handling. For explicit control, add a CI step after the Vercel deploy using `sentry-cli releases files javascript-react upload-sourcemaps ./build`.
