/**
 * Shared Redis singleton.
 *
 * Imported by both src/middleware/rateLimiter.ts and src/lib/cache.ts so a
 * single connection pool services both concerns.
 *
 * Behaviour when REDIS_URL is absent (local dev / unit tests):
 *   getRedis() returns null.  Every caller must handle null gracefully so
 *   the app starts and all tests pass without a Redis connection.
 */

import Redis from "ioredis";

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;

  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL, {
      // Never block the event loop if Redis is temporarily unreachable.
      enableOfflineQueue:   false,
      maxRetriesPerRequest: 1,
      connectTimeout:       3_000,
      lazyConnect:          false,
    });

    _redis.on("error", (err: Error) => {
      // Log but never crash — cache misses are safe; a cold DB query is the
      // fallback.  Do not re-throw here.
      console.error("[redis] connection error:", err.message);
    });
  }

  return _redis;
}

/** Disconnect and reset the singleton — used in tests only. */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => { /* ignore quit errors */ });
    _redis = null;
  }
}
