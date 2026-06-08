/**
 * Redis cache-aside helper.
 *
 * Design principles
 * ──────────────────
 * 1. Financial accuracy beats speed.
 *    Every cached value is invalidated explicitly on the write that changes it.
 *    TTLs are a secondary safety net, not the primary invalidation mechanism.
 *
 * 2. Graceful degradation.
 *    If Redis is unreachable (REDIS_URL absent, connection error, timeout),
 *    every function falls back silently — reads return null (cache miss),
 *    writes and deletes no-op.  The DB query always runs as a fallback; we
 *    never serve stale data just because Redis is down.
 *
 * 3. Tenant isolation.
 *    The cache layer itself doesn't enforce tenant scoping — that is the
 *    responsibility of the key builders in cacheKeys.ts.  Nothing here
 *    accepts a bare string like "dashboard"; callers must pass a fully-
 *    formed tenant-namespaced key from cacheKeys.ts.
 *
 * 4. All TTLs env-configurable.
 *    Override CACHE_TTL_FINANCIAL_S, CACHE_TTL_STATIC_S etc. in Railway to
 *    tune without a code deploy.
 */

import { getRedis } from "./redis";

// ── TTL constants (all configurable via env) ──────────────────────────────────

function envInt(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Financial aggregates (dashboard, P&L, COGS-to-sales, daily report).
 * 5 minutes is a safety net; event-based invalidation handles the primary path.
 */
export const TTL_FINANCIAL = envInt("CACHE_TTL_FINANCIAL_S", 5 * 60);      // 5 min

/**
 * Near-static reference data (COGS category lists).
 * Long TTL is acceptable because writes explicitly invalidate this key.
 */
export const TTL_STATIC = envInt("CACHE_TTL_STATIC_S", 30 * 60);           // 30 min

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Read a cached value.  Returns `null` on cache miss OR on any Redis error.
 * The caller must always have a DB fallback path.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedis();
    if (!client) return null;

    const raw = await client.get(key);
    if (!raw) return null;

    return JSON.parse(raw) as T;
  } catch {
    // Parse error or Redis timeout — treat as miss, never throw.
    return null;
  }
}

/**
 * Store a value.  No-ops silently on Redis error so the caller's write path
 * is never interrupted by a caching failure.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;

    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Fire-and-forget — swallow errors.
  }
}

/**
 * Delete a single key — used for precise invalidation (e.g. one day's report).
 */
export async function cacheInvalidate(key: string): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;

    await client.del(key);
  } catch {
    // Swallow — worst case the stale value expires via TTL.
  }
}

/**
 * Delete all keys matching a glob pattern using SCAN + DEL pipeline.
 *
 * SCAN is non-blocking and iterates in batches of up to `count` keys.
 * We use a pipeline for the DEL calls to minimise round-trips.
 *
 * Never call this with `*` alone — always include the tenant prefix so we
 * only touch keys belonging to the correct tenant.
 *
 * Example:  `senda:owner:abc123:pnl:*`
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;

    // Guard: refuse bare wildcards that could sweep other tenants' data.
    if (pattern === "*" || pattern === "senda:*") {
      console.error("[cache] cacheInvalidatePattern rejected dangerously broad pattern:", pattern);
      return;
    }

    let cursor = "0";
    const SCAN_COUNT = 100;

    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH", pattern,
        "COUNT", SCAN_COUNT,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        // DEL accepts multiple keys in one command.
        await client.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // Swallow — stale keys will expire via TTL.
  }
}

// ── Cache-aside wrapper ───────────────────────────────────────────────────────

/**
 * Wraps an async DB fetch with cache-aside logic.
 *
 * Usage:
 *   const data = await withCache(
 *     keyOwnerPnl(ownerAccountId, startDate, endDate),
 *     TTL_FINANCIAL,
 *     () => computePnLFromDb(...),
 *   );
 *
 * On cache hit: returns cached value without calling `fetch`.
 * On cache miss or Redis error: calls `fetch`, stores the result, returns it.
 * If `fetch` throws, the error propagates normally (never cached).
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetch: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const fresh = await fetch();
  // Store in background — never await this so a slow Redis write doesn't add
  // latency to the response.
  void cacheSet(key, fresh, ttlSeconds);
  return fresh;
}
