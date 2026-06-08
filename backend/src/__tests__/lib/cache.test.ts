/**
 * Cache unit tests.
 *
 * Tests two critical properties:
 * 1. Write-reflects: after a write invalidation, the next read fetches fresh
 *    data from the DB (not stale cached data).
 * 2. Tenant isolation: data cached for tenant A is NEVER returned to tenant B,
 *    even when both call the same logical endpoint.
 *
 * These tests use an in-memory Redis mock so they run offline and fast.
 * The mock stores values in a plain Map and implements the subset of the
 * ioredis API surface that cache.ts actually calls: get, set, del, scan.
 */

// ── In-memory Redis mock ──────────────────────────────────────────────────────

type MockRedis = {
  store: Map<string, string>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode: string, ttl: number) => Promise<"OK">;
  del: (...keys: string[]) => Promise<number>;
  scan: (
    cursor: string,
    matchKeyword: string,
    pattern: string,
    countKeyword: string,
    count: number,
  ) => Promise<[string, string[]]>;
};

function makeMockRedis(): MockRedis {
  const store = new Map<string, string>();
  return {
    store,
    get:  async (key) => store.get(key) ?? null,
    set:  async (key, value) => { store.set(key, value); return "OK"; },
    del:  async (...keys) => {
      let n = 0;
      for (const k of keys) { if (store.delete(k)) n++; }
      return n;
    },
    scan: async (_cursor, _match, pattern, _count, _n) => {
      // Simple in-memory glob: only supports trailing `*`
      const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
      const isExact = !pattern.endsWith("*");
      const keys = [...store.keys()].filter((k) =>
        isExact ? k === pattern : k.startsWith(prefix),
      );
      return ["0", keys]; // single-page: cursor always returns 0
    },
  };
}

// ── Module setup ──────────────────────────────────────────────────────────────

let mockRedis: MockRedis;

jest.mock("../../lib/redis", () => ({
  getRedis: () => mockRedis,
}));

// Import cache functions AFTER mocking the redis module.
import {
  cacheGet,
  cacheSet,
  cacheInvalidate,
  cacheInvalidatePattern,
  withCache,
} from "../../lib/cache";
import {
  keyOwnerDashboard,
  keyCogsCategories,
  patternOwnerDashboard,
} from "../../lib/cacheKeys";

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRedis = makeMockRedis();
  // Flush the module registry so the mock redis is used fresh each test
  jest.clearAllMocks();
});

// ── 1. Basic cache-aside (withCache) ─────────────────────────────────────────

describe("withCache", () => {
  it("calls fetch on cache miss and stores the result", async () => {
    const key   = keyOwnerDashboard("owner-1", "2025-01-01", "2025-01-31");
    const value = { revenue: 1000, cogs: 400 };
    const fetch = jest.fn().mockResolvedValue(value);

    const result = await withCache(key, 300, fetch);

    expect(result).toEqual(value);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Value should now be in the store (background set is awaited indirectly
    // by the time our assertion runs because jest flushes microtasks).
    await new Promise((r) => setTimeout(r, 0)); // flush microtasks
    expect(mockRedis.store.has(key)).toBe(true);
  });

  it("returns cached value without calling fetch on cache hit", async () => {
    const key   = keyOwnerDashboard("owner-1", "2025-01-01", "2025-01-31");
    const value = { revenue: 1000, cogs: 400 };
    await cacheSet(key, value, 300);

    const fetch = jest.fn().mockResolvedValue({ revenue: 9999 });
    const result = await withCache(key, 300, fetch);

    expect(result).toEqual(value); // cached value returned
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates fetch errors and does not cache them", async () => {
    const key   = keyOwnerDashboard("owner-err", "2025-01-01", "2025-01-31");
    const fetch = jest.fn().mockRejectedValue(new Error("DB down"));

    await expect(withCache(key, 300, fetch)).rejects.toThrow("DB down");
    expect(mockRedis.store.has(key)).toBe(false);
  });
});

// ── 2. Write-reflects: invalidation clears stale data ────────────────────────

describe("write-reflects (invalidation)", () => {
  it("cacheInvalidate: next read after invalidation fetches fresh data", async () => {
    const key  = keyCogsCategories("owner-A");
    const stale = [{ id: "1", name: "Beer" }];
    const fresh = [{ id: "1", name: "Beer" }, { id: "2", name: "Wine" }];

    // Seed with stale data
    await cacheSet(key, stale, 300);
    expect(await cacheGet(key)).toEqual(stale);

    // Simulate a write that creates a new category → invalidate
    await cacheInvalidate(key);

    // Next read is a miss — DB fetch returns fresh data
    const fetch = jest.fn().mockResolvedValue(fresh);
    const result = await withCache(key, 300, fetch);

    expect(result).toEqual(fresh);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cacheInvalidatePattern: invalidates all date-range slots for an owner", async () => {
    const ownerAccountId = "owner-A";
    const key1 = keyOwnerDashboard(ownerAccountId, "2025-01-01", "2025-01-31");
    const key2 = keyOwnerDashboard(ownerAccountId, "2025-02-01", "2025-02-28");
    const other = keyOwnerDashboard("owner-B", "2025-01-01", "2025-01-31");

    await cacheSet(key1,  { revenue: 1000 }, 300);
    await cacheSet(key2,  { revenue: 2000 }, 300);
    await cacheSet(other, { revenue: 9999 }, 300);

    // Invalidate all dashboard slots for owner-A
    await cacheInvalidatePattern(patternOwnerDashboard(ownerAccountId));

    // Owner-A's slots are gone
    expect(await cacheGet(key1)).toBeNull();
    expect(await cacheGet(key2)).toBeNull();

    // Owner-B's slot is untouched
    expect(await cacheGet(other)).toEqual({ revenue: 9999 });
  });
});

// ── 3. Tenant isolation ───────────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("different ownerAccountIds never share cache keys", async () => {
    const keyA = keyOwnerDashboard("owner-A", "2025-01-01", "2025-01-31");
    const keyB = keyOwnerDashboard("owner-B", "2025-01-01", "2025-01-31");

    expect(keyA).not.toEqual(keyB);
  });

  it("data stored for tenant A is not returned when fetching for tenant B", async () => {
    const keyA = keyOwnerDashboard("owner-A");
    const keyB = keyOwnerDashboard("owner-B");

    await cacheSet(keyA, { revenue: 1111 }, 300);

    // Fetching for tenant B should be a miss — DB fetch runs
    const freshB = { revenue: 2222 };
    const fetchB = jest.fn().mockResolvedValue(freshB);
    const result = await withCache(keyB, 300, fetchB);

    expect(result).toEqual(freshB);
    expect(fetchB).toHaveBeenCalledTimes(1);

    // Tenant A's data is still intact and not mutated
    expect(await cacheGet(keyA)).toEqual({ revenue: 1111 });
  });

  it("invalidating tenant A's cache does not affect tenant B's cache", async () => {
    const keyA = keyCogsCategories("owner-A");
    const keyB = keyCogsCategories("owner-B");

    await cacheSet(keyA, [{ id: "1" }], 300);
    await cacheSet(keyB, [{ id: "2" }], 300);

    await cacheInvalidate(keyA); // owner-A write

    expect(await cacheGet(keyA)).toBeNull();          // A's cache cleared
    expect(await cacheGet(keyB)).toEqual([{ id: "2" }]); // B untouched
  });

  it("rejects dangerously broad patterns that could sweep all tenants", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await cacheSet("senda:owner:X:data", "x", 300);
    await cacheInvalidatePattern("*"); // should be a no-op

    expect(mockRedis.store.has("senda:owner:X:data")).toBe(true); // not deleted
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("cacheInvalidatePattern rejected"),
      "*",
    );

    consoleSpy.mockRestore();
  });
});

// ── 4. Graceful degradation (Redis absent) ───────────────────────────────────

describe("graceful degradation when Redis is absent", () => {
  it("cacheGet returns null when Redis is unavailable", async () => {
    mockRedis = null as unknown as MockRedis; // simulate no REDIS_URL

    const result = await cacheGet("some:key");
    expect(result).toBeNull();
  });

  it("withCache falls back to DB when Redis is unavailable", async () => {
    mockRedis = null as unknown as MockRedis;

    const fresh = { revenue: 42 };
    const fetch = jest.fn().mockResolvedValue(fresh);
    const result = await withCache("some:key", 300, fetch);

    expect(result).toEqual(fresh);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
