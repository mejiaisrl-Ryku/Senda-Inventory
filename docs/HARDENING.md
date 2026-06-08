# Kyru Hardening Pass — Complete Reference

> **Audience:** Engineers joining the project, the Kyru team, or anyone operating
> the app in production.  Read this before touching security or infrastructure code.

---

## 1. Overview

Between early 2025 and mid-2026 Senda/Kyru went through a deliberate 10-prompt
hardening pass that transformed the codebase from a functional MVP into a
production-grade multi-tenant SaaS.  Every prompt had a specific, measurable goal;
together they form a layered defence that is hard to accidentally remove.

### What the pass accomplished

| Theme | Prompts | Outcome |
|-------|---------|---------|
| Safety net | 1 | Git branch protection, CI pipeline, versioned releases |
| Frontend hardening | 2 | Source maps off, secrets out of client bundle, env var split |
| Data integrity | 3 | Orphaned rows cleaned, FK constraints, composite indexes |
| App isolation | 4 | Prisma `$extends` + AsyncLocalStorage tenant injection |
| DB isolation | 5 | Postgres RLS, two-role architecture, BYPASSRLS admin role |
| API security | 6 | `requireAdmin` guards, input validation, CORS lockdown, JWT TTL |
| Availability | 7 | Redis-backed rate limiting, 4 tiers, bilingual 429 handling |
| Performance | 8 | Redis cache, 5 hot controllers, write-side invalidation |
| Scalability | 9 | Cursor pagination, safety caps, pool config, horizontal-scale guide |
| Observability | 10 | Request ID tracing, structured logs, Sentry, health probes, audit log |

### Philosophy

**Security-first foundation (Prompts 1–6):** establish correctness before
performance.  Every tenant boundary is enforced at two independent layers so a
single bug cannot leak data between clients.

**Production-readiness (Prompts 7–10):** once the foundation is solid, bolt on
the operational layer — rate limiting so the service stays up under abuse, caching
so it stays fast under load, pagination so it stays memory-safe at scale, and
observability so failures are caught before clients report them.

**Defence in depth:** no single control is the last line of defence.  A bug in the
Prisma extension is caught by RLS.  A bug in a middleware guard is caught by
input validation.  A Redis outage is caught by DB fallback.  A deployment mistake
is caught by automated CI tests.

---

## 2. Architecture Decisions

### 2.1 Tenant Isolation — two independent layers

```
Request → JWT (restaurantId / ownerAccountId)
        → Prisma $extends (WHERE-clause injection)   ← app layer
        → PostgreSQL RLS policy check                ← DB layer
```

**Why both?**  Either layer alone has failure modes:

- *App layer alone*: a developer adds a new `findMany` call without the `where:
  restaurantId` filter, or a future refactor bypasses `prismaT` and uses raw
  `prisma`.  The DB would happily return every tenant's rows.
- *RLS alone*: without the app-layer `GUC` (`SET LOCAL app.restaurant_id`), the
  policy evaluates against an empty string and silently returns zero rows —
  wrong but quiet.

With both layers, a single implementation bug leaves the other layer intact.
RLS is "fail-closed": if the GUC is not set the policy rejects the query
outright rather than returning all rows.

**Key files:**
- `backend/src/lib/prisma.ts` — `buildTenantedClient()`, `RESTAURANT_SCOPED`,
  `OWNER_SCOPED` model registries, AsyncLocalStorage GUC wrapper
- `backend/src/lib/tenantContext.ts` — sets the store from the JWT on each request
- `database/schema.prisma` (canonical) — RLS policies on every tenant table

### 2.2 Rate Limiting — Redis-backed, tiered

Four tiers, each sized for its threat model:

| Limiter | Window | Max | Rationale |
|---------|--------|-----|-----------|
| `apiLimiter` | 15 min | 300 | Generous default; a GM opening every panel is ~10 req/page load |
| `authLimiter` | 15 min | 10 | Stops credential-stuffing; `skipSuccessfulRequests: true` so normal logins don't count |
| `forgotPwLimiter` | 1 hr | 5 | Email-flood and account-enumeration protection |
| `aiLimiter` | 1 hr | 20 | Cost-control; each call hits OpenAI Vision |

**Why Redis?**  Express `MemoryStore` is per-process.  With two Railway replicas
each replica holds its own counter; a bot can bypass the limit by spreading
requests across replicas.  Redis makes the counter shared across all instances.
Without `REDIS_URL` the app falls back to `MemoryStore` — safe for single-replica
dev, **not** for production with `≥2` replicas.

**Key files:**
- `backend/src/middleware/rateLimiter.ts` — four limiters, `makeStoreOpts()`,
  all limits env-configurable
- `backend/src/lib/redis.ts` — singleton `ioredis` client shared by limiter + cache
- `frontend/src/api/index.ts` — 429 interceptor with bilingual `retryAfter` message
- `frontend/src/components/Login.tsx` — renders EN/ES rate-limit error

### 2.3 Caching — tenant-namespaced, event-invalidated

```
Read path:  withCache(key, TTL, () => dbQuery())
Write path: void invalidateFinancialCaches(restaurantId)   // fire-and-forget
```

**Key design choices:**

| Choice | Reason |
|--------|--------|
| Tenant ID embedded in every cache key | Cross-tenant poisoning is architecturally impossible — the key is simply wrong, no prefix-check to bypass |
| Fire-and-forget `void cacheSet(...)` | Redis write never adds latency to the HTTP response |
| Short TTLs (5 min financial, 30 min static) | Safety net only — event-based invalidation is the primary path |
| `SCAN + DEL` pattern, never bare `*` | Pattern-based invalidation without blocking the event loop; guard rejects `"*"` and `"senda:*"` to prevent accidental full-cache sweeps |

**Why not longer TTLs?**  An owner staring at their P&L dashboard after entering
a sale must see the update immediately.  Financial accuracy > milliseconds of
latency.  The write-side invalidation ensures the cache is fresh; the TTL is
only a backstop for cases the invalidation path misses.

**Key files:**
- `backend/src/lib/cache.ts` — `withCache`, `cacheGet/Set/Invalidate/InvalidatePattern`
- `backend/src/lib/cacheKeys.ts` — all key builders with tenant ID embedded
- `backend/src/lib/cacheInvalidation.ts` — `invalidateFinancialCaches`,
  `invalidateLaborCaches`, `invalidateCogsCategoryCache`

---

## 3. Security Foundation (Prompts 1–6)

### Prompt 1 — Git Safety Net

- `main` and `develop` branch protection rules (no direct push, PR required,
  status checks must pass before merge)
- GitHub Actions CI: `npm ci`, `npx tsc --noEmit`, `npm test`
- Conventional-commit release process with `RELEASES` changelog in `docs/`
- Pre-commit hooks via Husky (lint + type-check)

### Prompt 2 — Frontend Secrets & Source Maps

- Production source maps disabled (`GENERATE_SOURCEMAP=false`) — no JS reverse-
  engineering of business logic
- All env vars audited: `REACT_APP_*` (public, safe to bundle) vs. secrets on
  the server only
- Hardcoded API keys and DSNs removed from committed files
- `.env.example` documents every required var with safe placeholder values

### Prompt 3 — Data Integrity

- Orphaned `restaurantId` references (users, products, stock logs pointing to
  deleted restaurants) identified and cleaned
- Foreign key constraints added in schema to prevent future orphans
- Composite indexes on tenant columns (`restaurantId + date`,
  `restaurantId + status`, `ownerAccountId + name`) for query performance

### Prompt 4 — App-Level Tenant Isolation

The Prisma `$extends` client extension injects tenant filters at the ORM level
automatically:

```typescript
// Transparent WHERE injection — developers don't forget it.
// Works for findMany, findFirst, findUnique, count, update, delete.
const prismaT = buildTenantedClient(prismaApp);
```

Two enforcement mechanisms per query:
1. **WHERE-clause injection** via `$extends` model callbacks
2. **PostgreSQL GUC** (`SET LOCAL app.restaurant_id = '...'`) so RLS policies
   can read the current tenant even in raw SQL

`AsyncLocalStorage` carries the tenant context through the async call chain
without prop-drilling.  Both the extension and the GUC are set once per
request in `setTenantContext()` called from the `authenticate` middleware.

> **Rule:** all request handlers must use `prismaT`, never raw `prisma`.
> Use `prismaAdmin` (BYPASSRLS role) only for KYRU_MANAGER endpoints.

### Prompt 5 — Postgres Row-Level Security

Two DB roles, each with a dedicated connection string:

| Role | Client | Purpose | Bypass RLS? |
|------|--------|---------|------------|
| `senda_app` | `prismaT` / `prismaApp` | All normal traffic | No |
| `senda_admin` | `prismaAdmin` | KYRU_MANAGER cross-tenant reads | Yes (BYPASSRLS) |
| `postgres` | `prisma` (raw) | Migrations, seeds, health checks | Yes (superuser) |

RLS policy pattern on every tenant table:

```sql
CREATE POLICY tenant_isolation ON products
  USING (restaurant_id = current_setting('app.restaurant_id', true));
```

The `true` argument makes `current_setting` return `NULL` rather than throwing
when the GUC is not set — `NULL = any_id` is `NULL` (falsy), so the row is
rejected.  Fail-closed.

See `docs/runbook-rls-deploy.md` for the full production deploy procedure.

### Prompt 6 — API Security Hardening

Eight specific fixes:

| Fix | File | Detail |
|-----|------|--------|
| `requireAdmin` on 3 mutation endpoints | `routes/stock.ts`, `routes/orders.ts`, `routes/ai.ts` | `POST /adjust`, `POST /:id/receive`, `POST /extract-invoice` |
| JWT access token TTL `7d → 15m` | `lib/jwt.ts` | Reduces stolen-token window dramatically |
| Seed-test routes guarded | `routes/locations.ts` | `NODE_ENV !== "production"` check |
| JSON body limit `12mb → 100kb` | `app.ts` | DoS vector closed |
| Stale Vercel preview URLs removed | `app.ts` | CORS only allows live origins |
| `npm audit fix` | `package.json` | Patched `tmp` path-traversal (GHSA-ph9p-34f9-6g65) |
| Input validation with Zod | All mutation routes | Schema validated before any DB call |
| Helmet security headers | `app.ts` | HSTS, CSP, X-Frame-Options in production |

---

## 4. Production Readiness (Prompts 7–10)

### Prompt 7 — Rate Limiting

- Four tiered limiters (see §2.2 above)
- All limits configurable via env vars — no deploy needed to tune
- `standardHeaders: "draft-7"` sends a combined `RateLimit` header + `Retry-After`
- Frontend handles 429 with a bilingual (`EN/ES`) user-facing message including
  the retry countdown
- 7 unit tests in `backend/src/__tests__/rateLimiter.test.ts`

### Prompt 8 — Redis Caching

Five hot read endpoints wrapped in `withCache`:

| Endpoint | Key pattern | TTL |
|----------|-------------|-----|
| GM dashboard | `senda:restaurant:{id}:gm-dashboard:{range}` | 5 min |
| Owner dashboard | `senda:owner:{id}:dashboard:{range}` | 5 min |
| Owner P&L | `senda:owner:{id}:pnl:{start}:{end}` | 5 min |
| Owner P&L summary | `senda:owner:{id}:pnl-summary:{start}:{end}` | 5 min |
| Daily report | `senda:restaurant:{id}:daily:{date}` | 5 min |
| COGS-to-sales | `senda:restaurant:{id}:cogs-to-sales:{start}:{end}` | 5 min |
| COGS categories | `senda:owner:{id}:cogs-categories` | 30 min |

Write-side invalidation wired into every mutation controller:
`createSale`, `deleteSale`, `createLabor`, `deleteLabor`, `receiveOrder`,
`adjustStock`, `createCogsCategory`, `updateCogsCategory`, `deleteCogsCategory`.

11 unit tests in `backend/src/__tests__/lib/cache.test.ts` — write-reflects,
tenant isolation, graceful degradation.

### Prompt 9 — Scalability

**Cursor-based pagination** (prevents unbounded `SELECT *` on growing tables):

| Endpoint | Default | Max | Backwards-compatible? |
|----------|---------|-----|-----------------------|
| `GET /stock/logs/:id` | 50 | 200 | ✅ No params → plain array |
| `GET /orders` | 50 | 100 | ✅ No params → plain array |

With cursor: `{ data, nextCursor, hasMore }` envelope.

**Skip/take safety caps** (array shape unchanged):

| Endpoint | Default | Max |
|----------|---------|-----|
| `GET /sales` | 500 | 1000 |
| `GET /labor` | 500 | 1000 |
| `GET /products` | 2000 | 2000 |
| `GET /count/sessions` | 200 | 500 |
| `GET /recipes` | 500 | 1000 |

**Connection pool formula:**

```
DATABASE_POOL_SIZE = floor(PG_MAX_CONNECTIONS / (3 roles × replicas)) − 2

Examples (Railway default max_connections=100):
  1 replica  → 31
  2 replicas → 14
  4 replicas →  6
```

**Stateless by design:** JWT auth (no server-side sessions), Redis-backed rate
limits, Redis-backed cache.  WebSocket sticky sessions not yet needed; upgrade
path in `SCALING.md`.

21 unit tests in `backend/src/__tests__/scalability.test.ts` — cursor mechanics,
cap validation, O(1) query-count guards.

### Prompt 10 — Observability

**Request ID tracing:**

```
Client request
  → X-Request-ID generated (or forwarded from client)
  → stored in AsyncLocalStorage
  → appears in every Winston log line automatically
  → returned in X-Request-ID response header
  → included in 500 error body (for support tickets)
  → tagged on Sentry event
```

**Health probes:**

| Endpoint | Purpose | Failure → |
|----------|---------|-----------|
| `GET /health` | Liveness — process alive | Railway restarts container |
| `GET /ready` | Readiness — DB + Redis reachable | Railway stops routing traffic |

`/health` intentionally does **not** check the DB — a slow DB should not cause
Railway to restart a healthy container (making things worse).

**Sentry PII scrubbing (both frontend and backend):**
- Request body stripped before `beforeSend` (may contain passwords / financial data)
- Cookies cleared
- `Authorization` header masked as `[Filtered]`

**Auth failure logging** (`logger.warn`):
```json
{ "event": "auth_failure", "reason": "wrong_password", "email": "jo***@test.com", "ip": "..." }
```

**Audit log** for irreversible operations:
- DB table `audit_logs` (append-only, never deleted)
- Wired into: `deleteRestaurant`, `deletePartnerLocation`, `hardDeleteOwnerAccount`
- Each entry: `actorId`, `actorRole`, `action`, `targetType`, `targetId`,
  `metadata` (pre-scrubbed), `requestId`, `ipAddress`, `createdAt`

16 unit tests in `backend/src/__tests__/observability.test.ts`.

---

## 5. Deploy Checklist

Run these steps in order when deploying to a fresh Railway environment or after
a major configuration change.

### Prerequisites

```
[ ] PostgreSQL plugin provisioned on Railway
[ ] Redis plugin provisioned on Railway (required for multi-replica)
[ ] DIRECT_URL pointing to postgres.railway.internal:5432 (migrations)
[ ] DATABASE_URL pointing to senda_app role (normal traffic)
[ ] ADMIN_DATABASE_URL pointing to senda_admin role (KYRU_MANAGER)
```

### Environment Variables

Set these in Railway → Service → Variables:

```bash
# Database
DATABASE_URL="postgresql://senda_app:<pw>@<host>:5432/railway"
DIRECT_URL="postgresql://postgres:<pw>@postgres.railway.internal:5432/railway"
ADMIN_DATABASE_URL="postgresql://senda_admin:<pw>@<host>:5432/railway"
DATABASE_POOL_SIZE=14          # adjust per replica count — see §4 formula
DB_TRANSACTION_TIMEOUT_MS=15000

# Redis
REDIS_URL="redis://default:<pw>@<redis-host>:6379"

# Auth
JWT_SECRET="<32+ char random string>"
JWT_REFRESH_SECRET="<different 32+ char random string>"
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# Sentry
SENTRY_DSN="https://...@sentry.io/..."
SENTRY_TRACES_SAMPLE_RATE=0.2

# Cache / rate limits (Railway defaults — tune as needed)
CACHE_TTL_FINANCIAL_S=300
CACHE_TTL_STATIC_S=1800
API_RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_MAX=10
AI_RATE_LIMIT_MAX=20

# Misc
NODE_ENV=production
LOG_LEVEL=info
ALLOWED_ORIGINS=https://www.kyruadvisory.com,https://kyruadvisory.com
PORT=4000
```

Frontend (Vercel / Railway static):
```bash
REACT_APP_API_URL=https://api.kyruadvisory.com/api
REACT_APP_ENV=production
REACT_APP_VERSION=<git-sha>        # set by CI
REACT_APP_SENTRY_DSN="https://...@sentry.io/..."
REACT_APP_SENTRY_TRACES_RATE=0.2
```

### Run the DB Migration

```bash
# 1. Create backup first (Railway UI: Backups → Create backup)
# 2. Run audit log migration against DIRECT_URL
DATABASE_URL=$DIRECT_URL npx prisma db execute \
  --file prisma/migrations/add_audit_log.sql

# 3. Run any pending Prisma migrations
DATABASE_URL=$DIRECT_URL npx prisma migrate deploy
```

### Verify Health Endpoints

```bash
BASE=https://api.kyruadvisory.com

# Liveness — must always be 200
curl $BASE/health
# → { "status": "ok", "version": "abc1234", "timestamp": "..." }

# Readiness — must be 200 with status "ok" when fully healthy
curl $BASE/ready
# → { "status": "ok", "db": "ok", "redis": "ok", ... }
# If redis is "degraded", check REDIS_URL is set correctly.
# If db is "error", check DATABASE_URL and that DB is running.
```

### Confirm Sentry is Receiving Events

```bash
# Trigger a deliberate test error (dev/staging only — never prod):
curl -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@test.com","password":"wrong"}'
# → 401 response in terminal

# In Sentry: check Issues tab for the environment.
# Each Sentry issue should show:
#   - requestId tag matching the X-Request-ID in the response header
#   - environment: "production" (or staging)
#   - release: matching RAILWAY_GIT_COMMIT_SHA
```

### Smoke Tests

```bash
TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourdomain.com","password":"yourpassword"}' \
  | jq -r '.token')

# 1. Fetch dashboard (first call → DB; second call → Redis cache)
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/gm/dashboard | jq '.status'

# 2. Adjust stock (triggers cache invalidation)
curl -s -X POST $BASE/api/stock/adjust \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"productId":"<id>","change":-1,"reason":"USED"}' | jq '.id'

# 3. Dashboard again — should reflect the stock change (not stale cache)
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/gm/dashboard | jq '.status'

# 4. Rate-limit test — hammer auth endpoint
for i in $(seq 1 12); do
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST $BASE/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"wrong@test.com","password":"wrong"}')
  echo "Attempt $i: $http_code"
done
# Expected: first 10 → 401, then → 429
```

---

## 6. Testing & Verification

Each hardening layer has dedicated tests.  Run the full suite:

```bash
cd backend && npm test -- --no-coverage
# Expected: >120 tests pass; 3 skipped (live-DB integration tests)
```

### Tenant Isolation

**Unit/integration:**
- `backend/src/__tests__/tenantIsolation.test.ts` — mocked RLS policy assertions
- `backend/src/__tests__/tenantIntegrity.test.ts` — FK and orphan-free checks
- `backend/src/__tests__/rlsPolicy.test.ts` — RLS policy unit tests

**Manual (staging):**
```bash
# Log in as a Kardy's admin
KARDY_TOKEN=$(...)
# Log in as a Trompas DC admin
TROMPAS_TOKEN=$(...)

# Kardy's should see ZERO Trompas products
curl -H "Authorization: Bearer $KARDY_TOKEN" $BASE/api/products
# → all items have restaurantId matching Kardy's

# Attempting to read Trompas stock log directly
TROMPAS_LOG_ID="<a known Trompas log id>"
curl -H "Authorization: Bearer $KARDY_TOKEN" \
  $BASE/api/stock/logs/<trompas-product-id>
# → 404 (product not found in Kardy's restaurant)
```

### Rate Limiting

```bash
# 10 wrong-password attempts → 11th returns 429
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "Attempt $i: %{http_code}\n" \
    -X POST $BASE/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done
```

Check Railway logs for `"event":"auth_failure"` entries — one per failed attempt.

### Caching

```bash
# First dashboard call — cache miss, hits DB
time curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/gm/dashboard > /dev/null

# Second call — cache hit, much faster
time curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/gm/dashboard > /dev/null

# Write — triggers invalidation
curl -X POST $BASE/api/sales -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-08","category":"BEER","amount":150}'

# Third call — cache miss again (invalidated by write), DB hit
time curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/gm/dashboard > /dev/null
```

### Scalability / Pagination

```bash
# Paginated stock logs
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/stock/logs/<productId>?limit=10"
# → { data: [...10 items], nextCursor: "...", hasMore: true }

# Next page
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/stock/logs/<productId>?limit=10&cursor=<nextCursor>"
```

Unit tests in `scalability.test.ts` assert O(1) DB call count for 200-row
result sets — guards against future N+1 regressions.

### Observability

```bash
# Trigger error and capture request ID from response header
REQUEST_ID=$(curl -s -D - $BASE/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"bad@test.com","password":"wrong"}' \
  | grep -i x-request-id | awk '{print $2}' | tr -d '\r')

echo "Request ID: $REQUEST_ID"

# Search Railway logs for that request ID — should appear in logger.warn output
# In Sentry: search Issues → filter by tag requestId=$REQUEST_ID
```

---

## 7. Known Limitations & Future Work

These items were deliberately deferred.  Each has a tracking comment (`// TODO`)
in the relevant file.

### M3 — Refresh Token Rotation (medium risk)

**File:** `backend/src/lib/jwt.ts`

Currently refresh tokens are long-lived (30 days) and irrevocable.  A stolen
refresh token remains valid until expiry.

**Risk in practice:** low — access tokens expire in 15 minutes (down from 7 days),
so the attacker must also steal the access token to do anything useful.

**Fix when ready:**
1. Add a `refresh_tokens` table (`id`, `userId`, `tokenHash`, `expiresAt`,
   `revokedAt`)
2. On each `/auth/refresh` call, verify the hash exists and `revokedAt IS NULL`,
   then issue a new pair and mark the old refresh token as revoked
3. On logout, mark the token revoked immediately

### L1 — Recipe/Count Mutations Not Admin-Guarded

**Files:** `routes/recipes.ts`, `routes/counts.ts`

`POST /recipes`, `PUT /recipes/:id`, `DELETE /recipes/:id` and count-session
mutations are accessible to any authenticated user (ADMIN or STAFF).  This is
a **business decision** — kitchen staff need to create/update count sessions and
recipes during their shift.

Tenant isolation is still fully enforced: staff can only modify their own
restaurant's data.

**Change if needed:** add `requireAdmin` to recipe/count mutations and update the
frontend to restrict those actions to admin users.

### L5 — CSP Not Customised

**File:** `backend/src/app.ts`

`helmet()` is enabled in production with the default Content Security Policy.
The default is intentionally strict — it may block inline scripts or third-party
embeds if those are ever added to the frontend.

**Action if needed:** add a `contentSecurityPolicy` config object to the `helmet()`
call that allows specific origins (Sentry CDN, analytics, etc.).

### WebSocket Redis Adapter (if scaling WebSockets)

Currently Socket.IO uses the default in-memory adapter.  With `>1` Railway
replica, real-time stock updates (`stock:updated` events) are only delivered to
clients connected to the **same** replica that processed the write.

**Upgrade path (~10 lines):**

```typescript
// backend/src/lib/socket.ts
import { createAdapter } from "@socket.io/redis-adapter";
import { getRedis } from "./redis";

// After `const io = new Server(...)`:
const pub = getRedis();
const sub = pub?.duplicate();
if (pub && sub) io.adapter(createAdapter(pub, sub));
```

Install: `npm install @socket.io/redis-adapter`

Until this is done: scale HTTP API replicas freely; keep Socket.IO on a single
replica (or use Railway's sticky-session option for the WS service).

### Audit Log Gaps

`logAudit` is currently wired into hard-delete operations.  Future additions
when needed:

- `user.role_change` — when an admin changes another user's role
- `kyru_manager.cross_tenant_read` — when KYRU_MANAGER queries another tenant's data
- `owner_account.archive` — already has `logger.warn` but not an AuditLog DB row
- `partner.onboard` — partner setup (token already logged, not in DB)

---

## 8. Monitoring & Alerting Rules

### Sentry

| Alert | Threshold | Action |
|-------|-----------|--------|
| Error rate spike | >5 errors/min in `production` env | Page on-call, check recent deploy |
| New issue volume | >20 new issues in 1 hour | Check for dependency breach or data migration error |
| Auth failure burst | Sentry filter: `event.tags.event = auth_failure` | Brute-force in progress — temporary IP block |

### Railway Log Drain Searches

Configure Railway log alerts or pipe to Datadog/Logtail and set these searches:

```
# Brute-force detection
"auth_failure" AND "reason":"wrong_password"  → alert if >20/min from same IP

# Tenant isolation breach attempt (should never fire in normal operation)
"RLS policy"                                  → alert on any occurrence

# Audit trail — irreversible operations
"event":"audit"                               → notify security Slack channel

# Audit write failure (needs investigation)
"audit_write_failed"                          → alert immediately

# 503s from readiness probe
GET /ready HTTP/1.1" 503                      → DB or Redis down, escalate
```

### DB Connection Pool

Monitor the ratio of active connections to `DATABASE_POOL_SIZE`.  Alert at 80%:

```sql
-- Run against DIRECT_URL:
SELECT count(*) AS active,
       (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
FROM pg_stat_activity
WHERE state != 'idle';
```

If `active / max_conn > 0.8`:
1. Scale down replicas temporarily
2. Reduce `DATABASE_POOL_SIZE` per replica
3. Consider enabling PgBouncer in transaction mode (see `SCALING.md`)

### Health Probe Integration

Configure your external uptime monitor (Better Uptime, UptimeRobot, etc.) to
poll `GET /ready` every 60 seconds:

- **Expected:** `200 { "status": "ok" }` or `200 { "status": "degraded" }` (Redis optional)
- **Alert on:** `503` (DB down) or no response within 10 seconds (process dead)
- **Secondary:** poll `GET /health` as the liveness check with a 30-second interval

Set up a Slack or email alert when:
- `GET /ready` returns `503` for more than 2 consecutive checks
- `GET /health` returns anything other than `200` for more than 1 check

---

*Last updated: June 2026 — reflects the completed 10-prompt hardening pass.*
*Next planned work: refresh-token rotation (M3), WebSocket Redis adapter.*
