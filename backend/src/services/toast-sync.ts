import { prisma } from "../lib/prisma";
import { decrypt, encrypt } from "../lib/encryption";
import { refreshAccessToken, getTransactions, getMenuItems } from "../lib/toast-client";
import logger from "../utils/logger";

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

// ── Token management ──────────────────────────────────────────────────────────

async function getValidAccessToken(restaurantId: string): Promise<string> {
  const conn = await (prisma as any).toastConnection.findUnique({ where: { restaurantId } });
  if (!conn) throw new Error("No Toast connection found");

  if (conn.expiresAt > new Date()) {
    return decrypt(conn.accessToken as string);
  }

  // Expired — refresh.
  const tokens = await refreshAccessToken(decrypt(conn.refreshToken as string));
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

  await (prisma as any).toastConnection.update({
    where: { restaurantId },
    data: {
      accessToken:  encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt,
    },
  });

  logger.info({ event: "toast_token_refreshed_in_sync", restaurantId });
  return tokens.accessToken;
}

// ── Menu item sync ────────────────────────────────────────────────────────────

async function syncMenuItems(
  restaurantId: string,
  accessToken:  string,
  locationGuid: string
): Promise<void> {
  const items = await getMenuItems(accessToken, locationGuid);
  const now = new Date();

  for (const item of items) {
    if (!item.id) continue;
    await (prisma as any).toastMenuItem.upsert({
      where:  { restaurantId_toastItemId: { restaurantId, toastItemId: item.id } },
      create: { restaurantId, toastItemId: item.id, toastItemName: item.name, lastSyncedAt: now },
      update: { toastItemName: item.name, lastSyncedAt: now },
    });
  }

  logger.info({ event: "toast_menu_synced", restaurantId, count: items.length });
}

// ── Transaction sync ──────────────────────────────────────────────────────────

async function syncTransactions(
  restaurantId: string,
  accessToken:  string,
  locationGuid: string,
  lookbackDays: number
): Promise<{ synced: number; failed: number; errors: string[] }> {
  const endDate   = new Date();
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const transactions = await getTransactions(accessToken, locationGuid, startDate, endDate);

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const tx of transactions) {
    try {
      await (prisma as any).toastTransaction.upsert({
        where: {
          restaurantId_toastTransactionId: {
            restaurantId,
            toastTransactionId: tx.id,
          },
        },
        create: {
          restaurantId,
          toastTransactionId: tx.id,
          transactionDate:    new Date(tx.date),
          amount:             tx.amount,
          category:           tx.category,
          itemDetails:        tx.items as any,
          rawData:            tx.raw   as any,
          status:             "synced",
        },
        update: {}, // immutable — skip update if already present
      });
      synced++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`tx ${tx.id}: ${msg}`);
      logger.warn({ event: "toast_transaction_sync_failed", restaurantId, txId: tx.id, error: msg });
    }
  }

  return { synced, failed, errors };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Sync Toast menu items + transactions for a single restaurant. */
export async function syncTransactionsForRestaurant(restaurantId: string): Promise<SyncResult> {
  const conn = await (prisma as any).toastConnection.findUnique({ where: { restaurantId } });
  if (!conn) {
    return { synced: 0, failed: 0, errors: ["Not connected"] };
  }

  const lookbackDays = parseInt(process.env.TOAST_SYNC_LOOKBACK_DAYS ?? "30", 10);

  try {
    const accessToken = await getValidAccessToken(restaurantId);
    const locationGuid = conn.toastLocationId as string;

    // Sync menu first so item mappings exist when transactions arrive.
    await syncMenuItems(restaurantId, accessToken, locationGuid).catch((err) => {
      logger.warn({ event: "toast_menu_sync_failed", restaurantId, error: (err as Error).message });
    });

    const result = await syncTransactions(restaurantId, accessToken, locationGuid, lookbackDays);

    logger.info({ event: "toast_sync_complete", restaurantId, ...result });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ event: "toast_sync_error", restaurantId, error: msg });
    return { synced: 0, failed: 1, errors: [msg] };
  }
}

/** Sync all restaurants that have an active Toast connection. */
export async function syncAllRestaurantsWithToast(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> {
  const connections = await (prisma as any).toastConnection.findMany({
    select: { restaurantId: true },
  });

  let succeeded = 0;
  let failed = 0;

  for (const { restaurantId } of connections) {
    const result = await syncTransactionsForRestaurant(restaurantId as string);
    if (result.errors.length === 0 || result.synced > 0) {
      succeeded++;
    } else {
      failed++;
    }
  }

  logger.info({ event: "toast_all_sync_complete", total: connections.length, succeeded, failed });
  return { total: connections.length, succeeded, failed };
}
