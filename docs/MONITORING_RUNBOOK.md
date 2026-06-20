# Scan Pipeline Monitoring Runbook

Covers the async invoice/inventory scan pipeline added in Sprints 1–4:
enqueue endpoints (`POST /api/ai/extract-invoice`, `POST /api/inventory/scan`)
→ `ScanJob` row in Postgres → background worker (`backend/src/worker.ts`,
deployed as its own Railway service) → Claude Vision → webhook (optional).

## Metrics endpoints

Both require a `KYRU_MANAGER` JWT — restaurant-level `ADMIN` tokens get a 403.
This is deliberate: the response aggregates token usage and cost across every
restaurant, which a single-location GM should never see.

### Scan summary

```bash
curl -H "Authorization: Bearer <kyru-manager-token>" \
  "https://app.kyruadvisory.com/api/metrics/scans?days=7"
```

```json
{
  "period": { "days": 7, "since": "...", "until": "..." },
  "summary": {
    "totalScans": 150,
    "completedScans": 145,
    "failedScans": 5,
    "successRate": "96.67%",
    "avgProcessingTimeMs": 7234
  },
  "tokens": {
    "totalInput": 450000,
    "totalOutput": 85000,
    "estimatedCostUSD": "2.65"
  },
  "byType": [{ "type": "INVOICE", "_count": 90 }, { "type": "INVENTORY", "_count": 60 }]
}
```

`estimatedCostUSD` is priced per-row using each job's actual `claudeModel`
(sonnet on the first attempt, opus on retries) — it is a rough estimate for
trend-watching, not a billing figure.

### Worker health

```bash
curl -H "Authorization: Bearer <kyru-manager-token>" \
  "https://app.kyruadvisory.com/api/metrics/worker-health"
```

```json
{
  "status": "healthy",
  "pendingJobs": 0,
  "processingJobs": 1,
  "lastCompletedAt": "2026-06-20T10:15:00Z",
  "secondsSinceLastJob": 45
}
```

`status: "down"` is a heuristic — more than 5 jobs PENDING **and** no
completion in the last 5 minutes. It does **not** detect a worker that's
alive but stuck on a single hung Claude call; for that, check Railway logs
directly (below).

## Logs

The worker uses the same winston JSON logger as the API (`backend/src/utils/logger.ts`),
not a separate ad-hoc format — every event already includes `jobId`, and
most include `type`/`retryCount`/timing. Key events to filter Railway logs by:

| Event message | Meaning |
|---|---|
| `worker: picked up job` | Job pulled off the queue, about to process |
| `worker: job completed` | Success — includes `claudeModel`, `claudeProcessingMs`, token counts |
| `worker: job attempt failed` | One attempt failed (may still retry) |
| `worker: job re-queued for retry` | Will retry with `claude-opus-4-5` |
| `worker: job permanently failed` | Exhausted `maxRetries` (default 3), `extractionError` set on the row |
| `worker: webhook delivery failed` | Job succeeded but the caller's `webhookUrl` didn't respond 2xx |

There is no cross-process HTTP request ID threaded into worker logs — the
worker has no HTTP request at all (it's enqueued from one request, processed
later by an unrelated polling loop). **Use `jobId` as the correlation key**
instead; it's present on every enqueue/poll/worker log line for a given scan.

## Sentry

Job failures (`worker: job attempt failed` and the final permanent-failure
path) are reported via `Sentry.captureException`, tagged with `jobId`,
`jobType`, and `attempt`. Until this sprint the worker process never called
`Sentry.init()` at all — it's a separate Railway service from the Express API
in `index.ts`, so it didn't inherit Sentry from there. `worker.ts` now imports
`./instrument` directly at the top, same as `index.ts` does.

## Alerts (manual — not wired to PagerDuty)

No automated alerting is configured. Suggested thresholds if you want to add
them in Sentry's dashboard or a Railway monitor later:

- **Worker down**: `GET /api/metrics/worker-health` returns `"status": "down"`.
- **High failure rate**: `failedScans / totalScans > 10%` over a 1h window from `/api/metrics/scans?days=1`.
- **Slow scans**: `avgProcessingTimeMs > 30000`.

## S3 lifecycle policy

The worker logs a warning on every startup if the S3 bucket doesn't have a
180-day expiration rule (`s3: no 180-day lifecycle expiration rule found on
bucket`) — this only checks, it cannot apply the policy itself. To set it:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket kyru-scans \
  --lifecycle-configuration '{
    "Rules": [{ "ID": "DeleteOldScans", "Status": "Enabled", "Expiration": { "Days": 180 }, "Prefix": "" }]
  }'
```

## Common issues

| Symptom | Likely cause | Where to look |
|---|---|---|
| Jobs stuck in `PENDING` forever | Worker service not running / crashed | Railway → worker service → Deployments/Logs |
| Jobs go `PROCESSING` then never resolve | Worker crashed mid-job (no timeout on the Claude call) | Railway worker logs around that `jobId`; the row stays `PROCESSING` until manually reset |
| All jobs `FAILED` after 3 retries | Claude API key invalid/exhausted, or S3 fetch failing for every job | `worker: job attempt failed` log message + Sentry |
| `403` calling `/api/metrics/*` | Caller is `ADMIN`, not `KYRU_MANAGER` | Expected — these endpoints are KYRU-internal only |
