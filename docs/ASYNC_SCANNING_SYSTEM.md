# Async Scanning System Documentation

**Built:** June 2026
**Status:** Deployed to Railway (backend + worker) and Vercel (frontend)
**Target capacity:** 1,000+ scans/week without blocking the WebApp

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [API Endpoints](#api-endpoints)
4. [Database Model](#database-model)
5. [Worker Process](#worker-process)
6. [How to Use](#how-to-use)
7. [Monitoring & Cost Tracking](#monitoring--cost-tracking)
8. [Troubleshooting](#troubleshooting)
9. [Deployment Checklist](#deployment-checklist)
10. [Known Gaps](#known-gaps)

---

## Overview

**Before:** `POST /api/ai/extract-invoice` and `POST /api/inventory/scan` called
Claude Vision synchronously inside the Express request handler — the client's
HTTP connection stayed open for the full 3–8s Claude round-trip.

**After:** Both endpoints upload the image to S3, create a `ScanJob` row, and
return `202` immediately. A separate worker process picks up `PENDING` jobs,
calls Claude, and writes the result back to the row. The frontend polls
`GET /api/scan-jobs/:jobId` until it sees `COMPLETED` or `FAILED`.

### What was built, by sprint

| Sprint | What | Key files |
|---|---|---|
| 1 | `ScanJob` table + RLS, enqueue endpoints, S3 upload, polling endpoint | [scanJobController.ts](../backend/src/controllers/scanJobController.ts), [ai.ts](../backend/src/routes/ai.ts), [scanRoutes.ts](../backend/src/routes/scanRoutes.ts), [scanJobRoutes.ts](../backend/src/routes/scanJobRoutes.ts), [s3Service.ts](../backend/src/services/s3Service.ts) |
| 2 | Background worker, Claude Vision calls, webhook delivery, retry/model-escalation | [worker.ts](../backend/src/worker.ts), [Procfile](../backend/Procfile) |
| 3 | Frontend polling hook, scanning-overlay UI, extracted-data display | [useScanJobPolling.ts](../frontend/src/hooks/useScanJobPolling.ts), [ScanInvoiceModal.tsx](../frontend/src/components/ScanInvoiceModal.tsx), [ScanCountModal.tsx](../frontend/src/components/ScanCountModal.tsx) |
| 4 | Sentry in the worker process, metrics endpoints, S3 lifecycle check, runbook | [metricsController.ts](../backend/src/controllers/metricsController.ts), [metricsRoutes.ts](../backend/src/routes/metricsRoutes.ts), [worker.ts](../backend/src/worker.ts), [MONITORING_RUNBOOK.md](MONITORING_RUNBOOK.md) |

---

## Architecture

### Data flow

```
User uploads image (camera capture or file picker)
    ↓
Frontend: POST /api/ai/extract-invoice  (JSON: imageBase64 + mimeType)
       or POST /api/inventory/scan      (multipart: field name "image")
    ↓
Backend: enqueueInvoiceExtraction() / enqueueInventoryScan()
    ├─ Upload image buffer to S3            → s3://kyru-scans/{invoice|inventory}/{restaurantId}/{jobId}.{ext}
    ├─ Create ScanJob row (status=PENDING)
    └─ Respond 202 { jobId, status, statusUrl }
    ↓
Frontend: useScanJobPolling — GET /api/scan-jobs/:jobId every 2s, 60s timeout
    ├─ PENDING/PROCESSING → spinner overlay, Cancel button available
    ├─ COMPLETED          → extractedData fed into the existing form/match UI
    └─ FAILED / timeout   → error message
    ↓
Worker (backend/src/worker.ts — its own Railway service, separate process from the web API):
    ├─ Poll scan_jobs every 5s (WORKER_POLL_INTERVAL_MS) for oldest PENDING row
    ├─ Mark PROCESSING
    ├─ Fetch image back out of S3
    ├─ Call Claude: claude-sonnet-4-5 on attempt 1, claude-opus-4-5 on retries
    ├─ Parse JSON; for INVOICE jobs resolve suggestedCogsCategory → real CogsCategory
    │  row via the restaurant's ownerAccountId; for INVENTORY jobs the product
    │  catalog was already sent to Claude as part of the prompt so matching
    │  happens in the same call
    ├─ Mark COMPLETED + store extractedData/tokens/timing, or retry/FAILED
    └─ POST to webhookUrl if one was supplied; log + Sentry.captureException on error
```

### Why two backend processes

The worker is **not** a background job inside the same Express process — it's
a second Railway service running `npm run worker` (`node dist/worker.js`),
deployed from the same repo/build but with its own start command. This means:

- It has no per-request `AsyncLocalStorage` tenant context, so it uses
  `prismaAdmin` (RLS-bypass client), not `prismaT`. `prismaT` would fail
  *closed* here (the Postgres RLS GUC never gets set outside a request), not
  just unfiltered — see the comment block at the top of `worker.ts`.
- It never ran `Sentry.init()` until Sprint 4 — it doesn't inherit Sentry
  config from `index.ts`, since that file is never loaded. `worker.ts` now
  imports `./instrument` directly.
- **Deploying it is a manual Railway dashboard step, not just a git push.**
  `backend/railway.toml` sets an explicit `startCommand` for the existing
  web service; Railway does not auto-detect the `Procfile`'s `worker:` line
  the way Heroku would. A second Railway service must be created, pointed at
  this repo, with Start Command `npm run worker`.

### Components

| Component | Role |
|---|---|
| Express API (`backend/src/index.ts` → `app.ts`) | Enqueue endpoints, polling endpoint, metrics endpoints |
| Worker (`backend/src/worker.ts`) | Polls for jobs, calls Claude, writes results, sends webhooks |
| Postgres (`scan_jobs` table) | Job queue + result storage, RLS-scoped by `restaurantId` |
| S3 | Raw image storage, intended 180-day expiration (see [Known Gaps](#known-gaps)) |
| Sentry | Error capture for both the API and the worker |

Redis (used elsewhere for rate-limit counters) and Toast POS integration are
unrelated to this system and not part of the scan pipeline.

---

## API Endpoints

### `POST /api/ai/extract-invoice`

Admin-only (`requireAdmin`), JSON body, rate-limited (`AI_RATE_LIMIT_MAX`, default 100/hr).

```bash
curl -X POST https://app.kyruadvisory.com/api/ai/extract-invoice \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "imageBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "mimeType": "image/png"
  }'
```

`webhookUrl` is an optional third field in the body.

**Response — `202 Accepted`:**

```json
{
  "jobId": "f3b1c9a0-...",
  "status": "PENDING",
  "statusUrl": "/api/scan-jobs/f3b1c9a0-..."
}
```

### `POST /api/inventory/scan`

Admin-only, **multipart/form-data**, file field name is `image` (not `file`).

```bash
curl -X POST https://app.kyruadvisory.com/api/inventory/scan \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/path/to/inventory.jpg"
```

Same `202` shape as above.

### `GET /api/scan-jobs/:jobId`

Any authenticated user (`authenticate` only — no `requireAdmin`), scoped to
the caller's own restaurant via `prismaT`'s RLS extension. A token from a
different restaurant gets `404`, not `403` — the row isn't filtered into view
at all.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://app.kyruadvisory.com/api/scan-jobs/f3b1c9a0-...
```

**While pending/processing:**

```json
{
  "id": "f3b1c9a0-...",
  "type": "INVOICE",
  "status": "PROCESSING",
  "createdAt": "2026-06-20T10:15:00.000Z",
  "startedAt": "2026-06-20T10:15:02.000Z",
  "completedAt": null,
  "extractedData": null,
  "error": null,
  "retryCount": 0,
  "webhookDelivered": null
}
```

**Completed — invoice job** (`extractedData` matches the original synchronous
`aiController.extractInvoice` shape exactly, restored in Sprint 3 after a
worker-prompt mismatch was caught and fixed):

```json
{
  "id": "f3b1c9a0-...",
  "type": "INVOICE",
  "status": "COMPLETED",
  "extractedData": {
    "name": "Tomatoes",
    "purveyor": "Fresh Farms Co",
    "invoiceDate": "2026-06-19",
    "unit": "LB",
    "quantity": 25,
    "costPerUnit": 0.85,
    "sku": "TOMATOBOX",
    "category": "Perishable Food",
    "department": "BOH",
    "cogsCategory": { "id": "cat_123", "name": "FOOD" }
  },
  "error": null,
  "retryCount": 0,
  "webhookDelivered": null
}
```

**Completed — inventory job** (`extractedData` is `{ items, rawText }`, matching
`scanApi.scanInventory`'s pre-Sprint-1 response shape — `ScanCountModal` reads
`result.items` directly):

```json
{
  "extractedData": {
    "items": [
      {
        "extractedName": "Tomatoes",
        "matchedProductId": "prod_456",
        "matchedProductName": "Tomatoes (Roma)",
        "quantity": 12,
        "unit": "LB",
        "confidence": "high",
        "suggestedCogsCategory": "FOOD"
      }
    ],
    "rawText": "..."
  }
}
```

**Failed:**

```json
{
  "status": "FAILED",
  "extractedData": null,
  "error": "JSON parse failed on Claude response: ...",
  "retryCount": 3
}
```

### `GET /api/metrics/scans?days=7`

**`KYRU_MANAGER` only** — not `requireAdmin`. This aggregates token usage and
estimated cost across *every* restaurant; a single-location GM must not see
other tenants' usage. (The original Sprint 4 prompt drafted this as
`requireAdmin` — that was a real authorization bug, fixed before merging.)

```bash
curl -H "Authorization: Bearer $KYRU_MANAGER_TOKEN" \
  "https://app.kyruadvisory.com/api/metrics/scans?days=7"
```

```json
{
  "period": { "days": 7, "since": "2026-06-13T...", "until": "2026-06-20T..." },
  "summary": {
    "totalScans": 1245,
    "completedScans": 1204,
    "failedScans": 41,
    "successRate": "96.71%",
    "avgProcessingTimeMs": 6847
  },
  "tokens": {
    "totalInput": 18450000,
    "totalOutput": 3200000,
    "estimatedCostUSD": "72.45"
  },
  "byType": [
    { "type": "INVOICE", "_count": 800 },
    { "type": "INVENTORY", "_count": 445 }
  ]
}
```

`estimatedCostUSD` is priced per-row by each job's actual `claudeModel` (sonnet
vs. opus-on-retry), not a flat rate — see `COST_PER_MILLION_TOKENS` in
`metricsController.ts`. It's a trend estimate, not a billing figure.

### `GET /api/metrics/worker-health`

Also `KYRU_MANAGER` only.

```bash
curl -H "Authorization: Bearer $KYRU_MANAGER_TOKEN" \
  https://app.kyruadvisory.com/api/metrics/worker-health
```

```json
{
  "status": "healthy",
  "pendingJobs": 0,
  "processingJobs": 1,
  "lastCompletedAt": "2026-06-20T10:15:45.000Z",
  "secondsSinceLastJob": 15
}
```

`status` is `"down"` only when `pendingJobs > 5` **and** no job has completed
in the last 5 minutes — a heuristic, not a real heartbeat. A worker that's up
but hung on one Claude call won't be caught by this.

---

## Database Model

This is the actual Prisma model (`backend/prisma/schema.prisma`) — not a
hypothetical SQL sketch. A few things worth calling out explicitly because a
generic version of this doc would get them wrong:

- `id` is a `cuid()` string default, not a `UUID`/`gen_random_uuid()`. In
  practice every row's `id` is set explicitly by the controller
  (`crypto.randomUUID()`) before insert, so the DB default never fires.
- There is **no `partnerId` or `Partner` table** anywhere in this schema —
  tenancy is `restaurantId` → `Restaurant` → (optionally) `OwnerAccount`,
  consistent with every other table in the app.
- `webhookDelivered` is a nullable `DateTime` (the timestamp delivery
  succeeded), not a `boolean`.

```prisma
model ScanJob {
  id           String        @id @default(cuid())
  type         ScanJobType   // INVOICE | INVENTORY
  status       ScanJobStatus @default(PENDING) // PENDING | PROCESSING | COMPLETED | FAILED

  restaurantId String
  restaurant   Restaurant    @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  imageS3Url     String
  imageMimeType  String
  imageSizeBytes Int

  claudeModel        String   @default("claude-sonnet-4-5")
  inputTokens        Int?
  outputTokens       Int?
  claudeProcessingMs Int?

  extractedData   Json?
  extractionError String?

  retryCount  Int       @default(0)
  maxRetries  Int       @default(3)
  lastRetryAt DateTime?

  webhookUrl       String?
  webhookDelivered DateTime?
  webhookError     String?

  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  completedAt DateTime?

  @@index([status])
  @@index([restaurantId])
  @@index([restaurantId, status])
  @@index([type])
  @@index([createdAt])
  @@map("scan_jobs")
}
```

RLS (Postgres-level, `20260620120000_add_scan_job_table/migration.sql`):

```sql
ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_jobs FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON scan_jobs
  AS PERMISSIVE FOR ALL
  USING     ("restaurantId" = current_setting('app.restaurant_id', true))
  WITH CHECK ("restaurantId" = current_setting('app.restaurant_id', true));
```

This is enforced the same way as every other restaurant-scoped table —
`scanJob` is registered in `RESTAURANT_SCOPED` in `backend/src/lib/prisma.ts`,
so `prismaT` auto-injects the WHERE filter and sets the GUC. The worker uses
`prismaAdmin` instead (see [Architecture](#architecture)).

---

## Worker Process

### Startup

1. `import "./instrument"` initializes Sentry (must happen before any other import touches the network).
2. Log `worker: started`.
3. `s3Service.verifyLifecyclePolicy()` — logs a warning if the bucket's 180-day expiration rule is missing; does not block startup.
4. Enter the main poll loop.

### Main loop (every `WORKER_POLL_INTERVAL_MS`, default 5000ms)

1. `SELECT` the oldest `PENDING` row (`prismaAdmin.scanJob.findFirst`, `orderBy createdAt asc`).
2. If none, sleep and retry.
3. Otherwise, `processJob()`:
   - Mark `PROCESSING`.
   - Fetch the image from S3.
   - For `INVENTORY` jobs only: fetch the restaurant's product catalog (`prisma.product.findMany`) and include it in the prompt, so Claude can return `matchedProductId`.
   - Call Claude: `claude-sonnet-4-5` if `retryCount === 0`, else `claude-opus-4-5`.
   - Parse the JSON response.
   - For `INVOICE` jobs: resolve `suggestedCogsCategory` to a real `CogsCategory` row via the restaurant's `ownerAccountId`.
   - Mark `COMPLETED` with `extractedData`/`inputTokens`/`outputTokens`/`claudeProcessingMs`, or retry (`PENDING`, `retryCount + 1`) up to `maxRetries` (default 3), or mark `FAILED`.
   - POST to `webhookUrl` if present (10s timeout via `AbortController`); record `webhookDelivered`/`webhookError`.
4. On any uncaught error: log + `Sentry.captureException`, sleep, continue — the loop never crashes the process on a single bad job.

### Graceful shutdown

`SIGTERM`/`SIGINT` → log, `prisma.$disconnect()`, `process.exit(0)`. A fatal unhandled rejection flushes Sentry (`Sentry.flush(2000)`) before exiting, so a crash doesn't also silently drop its own error report.

### Required environment variables (worker, in addition to what the web API needs)

```bash
DATABASE_URL=...           # senda_admin or equivalent — worker uses prismaAdmin
ANTHROPIC_API_KEY=sk-...
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=kyru-scans
SENTRY_DSN=...
WORKER_POLL_INTERVAL_MS=5000   # optional, defaults to 5000
```

### Deployment (Railway) — manual step required

`npm run worker` runs `node dist/worker.js`. There is **no automated dual-dyno
deploy from this repo** — `backend/Procfile` exists for documentation/portability,
but `backend/railway.toml` sets an explicit `startCommand` for the existing web
service, so Railway will not pick up the `worker:` line from the Procfile on
its own. **You must create a second Railway service** pointed at this same
repo, with Start Command `npm run worker`, sharing the same env vars as the
web service. This has not been verified as actually running in production —
confirm in the Railway dashboard that a worker service exists and is healthy
before relying on this system end-to-end.

---

## How to Use

### From the existing frontend components

Don't call the enqueue/poll endpoints directly in new code — use the existing
hook, which already wires in auth headers via the shared axios instance:

```typescript
import { useScanJobPolling } from "../hooks/useScanJobPolling";
import { api } from "../api";

const invoiceScan = useScanJobPolling<AIExtractResponse>({ timeoutMs: 60000 });

async function extract(base64: string) {
  const { data: enqueued } = await api.post<{ jobId: string }>("/ai/extract-invoice", {
    imageBase64: base64,
    mimeType: "image/jpeg",
  });

  const job = await invoiceScan.startPolling(enqueued.jobId);

  if (!job || job.status === "FAILED") {
    // job.error or invoiceScan.error has the message
    return;
  }
  // job.extractedData is already shaped like AIExtractResponse
}
```

See [ScanInvoiceModal.tsx](../frontend/src/components/ScanInvoiceModal.tsx) and
[ScanCountModal.tsx](../frontend/src/components/ScanCountModal.tsx) for the
real integrations, including the Cancel button (`invoiceScan.cancelPolling()`)
and the existing spinner overlay UI (no separate spinner component was added —
both modals already had one).

### From an external client (webhook)

Pass `webhookUrl` in the enqueue request body. The worker POSTs:

```json
{ "id": "...", "type": "INVOICE", "status": "completed", "extractedData": {...}, "error": null }
```

or on failure:

```json
{ "id": "...", "type": "INVOICE", "status": "failed", "extractedData": null, "error": "..." }
```

There is no signature/HMAC verification on this webhook — treat the receiving
endpoint as needing its own auth if it's not a trusted internal service.

---

## Monitoring & Cost Tracking

See [MONITORING_RUNBOOK.md](MONITORING_RUNBOOK.md) for the full guide. Quick reference:

```bash
# Last 7 days summary (KYRU_MANAGER token required)
curl -H "Authorization: Bearer $KYRU_TOKEN" "https://app.kyruadvisory.com/api/metrics/scans?days=7"

# Worker health
curl -H "Authorization: Bearer $KYRU_TOKEN" "https://app.kyruadvisory.com/api/metrics/worker-health"
```

Approximate pricing used for the cost estimate (`metricsController.ts`):

| Model | Input ($/1M tokens) | Output ($/1M tokens) |
|---|---|---|
| claude-sonnet-4-5 | $3 | $15 |
| claude-opus-4-5 | $15 | $75 |

Sentry captures every job failure, tagged `jobId`/`jobType`/`attempt` — there
is no `process: worker` tag (that's not a real field this system sets); filter
by the `jobId` tag or by the log message instead.

---

## Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| Jobs stuck `PENDING` forever | Worker service not actually running (see deployment note above) | Railway dashboard — does a worker service exist and show healthy? |
| Jobs go `PROCESSING` then never resolve | Worker crashed mid-job — there's no per-job timeout, so a hung Claude call holds the row in `PROCESSING` indefinitely | Worker logs around that `jobId`; may need to manually reset the row to `PENDING` |
| All jobs `FAILED` after 3 retries | `ANTHROPIC_API_KEY` invalid, or S3 fetch failing for every job | `worker: job attempt failed` log line + Sentry |
| `403` on `/api/metrics/*` | Caller's token role is `ADMIN`, not `KYRU_MANAGER` | Expected — these endpoints are intentionally KYRU-internal only |
| `404` on `/api/scan-jobs/:jobId` for a job you just created | Polling with a token from a different restaurant, or a typo'd jobId — RLS makes a cross-tenant row invisible, not forbidden | Confirm the JWT's `restaurantId` matches the job's |
| Invoice extraction returns unrelated fields | Would indicate the worker's prompt has drifted from `aiController`'s original schema again (this happened once, see [Known Gaps](#known-gaps)) | Compare `INVOICE_SYSTEM_PROMPT` in `worker.ts` against `ScanInvoiceModal.tsx`'s expected `AIExtractResponse` shape |

---

## Deployment Checklist

Before pushing:

- [ ] `cd backend && npx tsc --noEmit` passes
- [ ] `cd backend && npm run build` succeeds
- [ ] `cd frontend && npx tsc --noEmit` passes
- [ ] `cd frontend && CI=true npm run build` succeeds (many platforms, including Vercel, set `CI=true` automatically — a plain `npm run build` passing is not sufficient)

After pushing:

- [ ] Railway web service redeploys and is healthy
- [ ] **Confirm a Railway worker service exists and is healthy** — this is not automatic, see [Worker Process → Deployment](#deployment-railway--manual-step-required)
- [ ] Vercel frontend redeploys
- [ ] Manual smoke test: enqueue a real invoice scan from the UI, confirm it transitions to `COMPLETED` with populated fields, not just that polling stops

Ongoing:

- [ ] Periodically check `/api/metrics/scans` and `/api/metrics/worker-health` (no automated alerting is wired up — see [MONITORING_RUNBOOK.md](MONITORING_RUNBOOK.md))
- [ ] Confirm the S3 bucket's 180-day lifecycle rule is actually applied in the AWS Console — the worker only logs a warning if it's missing, it never creates the rule

---

## Known Gaps

Being explicit about what this system does *not* have, rather than implying completeness:

- **No automated tests.** No Jest suite exists for the scan job controllers, the worker, or the polling hook. All verification so far has been `tsc`/build checks plus manual reasoning about schema consistency — not a substitute for actually running a scan end-to-end in a deployed environment.
- **No per-job processing timeout.** A worker that hangs mid-Claude-call leaves the row in `PROCESSING` forever; nothing times it out or requeues it.
- **No webhook signing.** Any URL can be supplied as `webhookUrl`; there's no SSRF guard or allowlist.
- **Worker deployment is a manual, unverified step.** As of this writing, whether a second Railway service running `npm run worker` actually exists and is healthy in production has not been confirmed from this environment — see the deployment checklist above.
- **The worker's extraction schema was wrong once already** (Sprint 2 shipped a generic invoice/lineItems schema that didn't match the actual `ScanInvoiceModal`/`ScanCountModal` UI; caught and fixed in Sprint 3 before merging). If the worker's prompts are ever edited again, diff them against the frontend's expected shape, not just against "does it return valid JSON."
