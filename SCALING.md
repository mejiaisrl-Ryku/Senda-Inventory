# Horizontal Scaling Guide

How to run multiple Railway instances of the backend without state conflicts.

---

## Architecture overview

```
Internet → Railway load balancer
               ├── backend replica 1  ─┐
               ├── backend replica 2  ─┼──► PostgreSQL (Railway)
               └── backend replica N  ─┘        │
                                        Redis ◄──┘
                                    (rate limits + cache)
```

The application is **fully stateless**.  Any replica can serve any request:

| State type | Storage | Notes |
|------------|---------|-------|
| Primary data | PostgreSQL | Single source of truth |
| JWT session | Signed token in client | No server-side session store needed |
| Rate-limit counters | Redis (ioredis) | Shared across all replicas |
| Financial cache | Redis (ioredis) | Shared; event-invalidated on writes |
| WebSocket rooms | Socket.IO (in-memory) | See note below |

---

## Prerequisites before scaling to >1 replica

### 1. Redis (required)

Set `REDIS_URL` in Railway.  Without it:
- Each replica maintains its own in-memory rate-limit counters → limits can be
  bypassed by requests spread across replicas
- Cache is DB-only (safe, just slower)

Railway service → Variables → Add:
```
REDIS_URL=redis://default:<password>@<redis-host>:6379
```

### 2. Connection pooling (required at ≥3 replicas)

Railway Postgres default `max_connections = 100`.

Without PgBouncer, each replica opens `DATABASE_POOL_SIZE × 3 roles` connections.

**Formula:**
```
DATABASE_POOL_SIZE = floor(max_connections / (3 × replica_count)) - 2
```

| Replicas | DATABASE_POOL_SIZE |
|----------|-------------------|
| 1        | 31                |
| 2        | 14                |
| 4        | 6                 |
| 6        | 3 (add PgBouncer) |

Set in Railway Variables:
```
DATABASE_POOL_SIZE=14   # for 2 replicas
```

### 3. PgBouncer in transaction mode (recommended at ≥4 replicas)

Add a PgBouncer service (Railway has a template).

Update DATABASE_URL to point to the PgBouncer host and add `?pgbouncer=true`:
```
DATABASE_URL=postgresql://senda_app:<pw>@<pgbouncer-host>:5432/railway?pgbouncer=true
```

Keep DIRECT_URL pointing to the actual Postgres host (used only for migrations):
```
DIRECT_URL=postgresql://postgres:<pw>@postgres.railway.internal:5432/railway
```

The `?pgbouncer=true` flag tells Prisma to skip prepared-statement caching, which
is incompatible with PgBouncer transaction mode.

### 4. WebSocket sticky sessions (if using real-time stock updates)

Socket.IO currently uses the default in-memory adapter.  With >1 replica, a
`stock:updated` event emitted on replica A won't reach clients connected to
replica B.

**Upgrade path when needed:**
1. `npm install @socket.io/redis-adapter`
2. In `backend/src/lib/socket.ts`, wire up the Redis adapter:
   ```typescript
   import { createAdapter } from "@socket.io/redis-adapter";
   import { getRedis } from "./redis";
   // After io = new Server(...):
   const pub = getRedis();
   const sub = pub?.duplicate();
   if (pub && sub) io.adapter(createAdapter(pub, sub));
   ```
This is a ~10-line change.  Until then, keep WebSocket deployments to 1 replica
(scale the HTTP API replicas, keep a single WebSocket replica behind a separate
Railway service).

---

## Railway deployment checklist

```
[ ] REDIS_URL set in Railway Variables
[ ] DATABASE_POOL_SIZE calculated and set
[ ] DIRECT_URL set (required for migrations; already in .env.example)
[ ] If ≥4 replicas: DATABASE_URL updated to PgBouncer host with ?pgbouncer=true
[ ] NODE_ENV=production set
[ ] JWT_SECRET and JWT_REFRESH_SECRET are 32+ char random strings
[ ] At scale: Socket.IO Redis adapter installed (see above)
```

---

## Verifying statelessness

Run the following smoke-test against a 2-replica deployment:

```bash
# Hit replica 1 — get auth token
TOKEN=$(curl -s -X POST https://api.senda.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"...", "password":"..."}' | jq -r '.token')

# Hit replica 2 — token must work (JWT is verified without shared session store)
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.senda.app/api/stock/report
# → should return 200, not 401
```

Rate-limit test (verify counters are shared):
```bash
# Hammer login 11 times quickly — should get 429 on the 11th
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://api.senda.app/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"wrong@test.com","password":"wrong"}'
done
# Expected: 10x 401, then 2x 429
```

---

## Pagination reference

All list endpoints now support safe pagination to prevent unbounded queries.

### Cursor-based (stock logs, orders)

```
GET /api/stock/logs/:productId?limit=50
→ StockLog[]  (legacy — first 50, no pagination envelope)

GET /api/stock/logs/:productId?limit=50&cursor=<id>
→ { data: StockLog[], nextCursor: string|null, hasMore: boolean }
```

### Skip/take (sales, labor, products, count sessions, recipes)

```
GET /api/sales?startDate=2025-01-01&endDate=2025-01-31&take=100&skip=0
→ SalesEntry[]  (same shape as before, now capped at max 1000)
```

Default and maximum limits:

| Endpoint          | Default take | Max take |
|-------------------|-------------|---------|
| `/stock/logs/:id` | 50          | 200     |
| `/orders`         | 50          | 100     |
| `/sales`          | 500         | 1000    |
| `/labor`          | 500         | 1000    |
| `/products`       | 2000        | 2000    |
| `/count/sessions` | 200         | 500     |
| `/recipes`        | 500         | 1000    |
