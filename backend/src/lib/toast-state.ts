/**
 * CSRF state store for Toast OAuth flow.
 *
 * Stores { restaurantId } keyed by a random state string with a 15-minute TTL.
 * Uses Redis when available (production); falls back to an in-process Map for
 * local dev and unit tests.
 */

import { getRedis } from "./redis";

const STATE_TTL_SECONDS = 900; // 15 minutes
const PREFIX = "toast_oauth_state:";

// In-process fallback used when Redis is unavailable.
const memStore = new Map<string, { restaurantId: string; expiresAt: number }>();

/** Persist an OAuth state token mapped to a restaurantId. */
export async function setOAuthState(state: string, restaurantId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(`${PREFIX}${state}`, restaurantId, "EX", STATE_TTL_SECONDS);
    return;
  }
  memStore.set(state, { restaurantId, expiresAt: Date.now() + STATE_TTL_SECONDS * 1000 });
}

/**
 * Validate and consume a state token. Returns the restaurantId if valid,
 * null if not found or expired. Deletes the token after a single use
 * (replay prevention).
 */
export async function consumeOAuthState(state: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    const val = await redis.getdel(`${PREFIX}${state}`);
    return val ?? null;
  }

  const entry = memStore.get(state);
  if (!entry) return null;
  memStore.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return entry.restaurantId;
}
