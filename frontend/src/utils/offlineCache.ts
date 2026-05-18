const PREFIX = "senda_cache_";
const TTL = 24 * 60 * 60 * 1000; // 24 hours

interface Entry {
  data: unknown;
  ts: number;
}

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, ts }: Entry = JSON.parse(raw);
    if (Date.now() - ts > TTL) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, data: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() } satisfies Entry));
  } catch {
    // Storage full — purge expired entries, then retry once.
    purgeExpired();
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() } satisfies Entry));
    } catch {}
  }
}

// Called on logout so stale data from one user can't leak to another.
export function cachePurge(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

function purgeExpired(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => {
      try {
        const { ts } = JSON.parse(localStorage.getItem(k) ?? "{}") as Partial<Entry>;
        if (!ts || Date.now() - ts > TTL) localStorage.removeItem(k);
      } catch {
        localStorage.removeItem(k);
      }
    });
}
