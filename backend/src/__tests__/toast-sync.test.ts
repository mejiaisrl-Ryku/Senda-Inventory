// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../lib/prisma", () => {
  const toastConnection = { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() };
  const toastMenuItem   = { upsert: jest.fn() };
  const toastTransaction = { upsert: jest.fn() };
  const p = { toastConnection, toastMenuItem, toastTransaction, $queryRaw: jest.fn(), $transaction: jest.fn() };
  return { prisma: p, prismaT: p, prismaAdmin: p };
});

jest.mock("../lib/toast-client", () => ({
  getTransactions: jest.fn(),
  getMenuItems:    jest.fn(),
  refreshAccessToken: jest.fn(),
}));

// Use real AES-256 encrypt/decrypt with a stable test key.
process.env.ENCRYPTION_KEY = "0".repeat(64);

import { prisma } from "../lib/prisma";
import { getTransactions, getMenuItems, refreshAccessToken } from "../lib/toast-client";
import { syncTransactionsForRestaurant } from "../services/toast-sync";
import { encrypt, decrypt } from "../lib/encryption";

const db = {
  conn: (prisma as any).toastConnection as { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock },
  menu: (prisma as any).toastMenuItem   as { upsert: jest.Mock },
  tx:   (prisma as any).toastTransaction as { upsert: jest.Mock },
};

const mockGetTx   = getTransactions    as jest.Mock;
const mockGetMenu = getMenuItems       as jest.Mock;
const mockRefresh = refreshAccessToken as jest.Mock;

const RESTAURANT_ID = "rest_001";
const LOCATION_GUID = "loc_guid_001";

// Pre-encrypt token fixtures so the sync service can decrypt them correctly.
const ENC_AT_LIVE = encrypt("at_live");
const ENC_RT_LIVE = encrypt("rt_live");
const ENC_RT_VALID = encrypt("rt_valid");

const validConnection = {
  restaurantId:    RESTAURANT_ID,
  toastLocationId: LOCATION_GUID,
  accessToken:     ENC_AT_LIVE,
  refreshToken:    ENC_RT_LIVE,
  expiresAt:       new Date(Date.now() + 3600_000),
};

beforeEach(() => jest.clearAllMocks());

// ── Test 1 ────────────────────────────────────────────────────────────────────
describe("syncTransactionsForRestaurant — not connected", () => {
  it("returns {synced:0, failed:0, errors:['Not connected']} when no connection exists", async () => {
    db.conn.findUnique.mockResolvedValue(null);

    const result = await syncTransactionsForRestaurant(RESTAURANT_ID);

    expect(result).toEqual({ synced: 0, failed: 0, errors: ["Not connected"] });
    expect(mockGetTx).not.toHaveBeenCalled();
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────
describe("syncTransactionsForRestaurant — valid connection", () => {
  it("fetches transactions from Toast, stores them, returns {synced:2, failed:0}", async () => {
    db.conn.findUnique.mockResolvedValue(validConnection);
    mockGetMenu.mockResolvedValue([]);
    mockGetTx.mockResolvedValue([
      { id: "toast_tx_1", date: new Date().toISOString(), amount: 150, category: "FOOD",     items: [], raw: {} },
      { id: "toast_tx_2", date: new Date().toISOString(), amount: 80,  category: "DELIVERY", items: [], raw: {} },
    ]);
    db.tx.upsert.mockResolvedValue({});

    const result = await syncTransactionsForRestaurant(RESTAURANT_ID);

    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(db.tx.upsert).toHaveBeenCalledTimes(2);
    expect(db.tx.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId_toastTransactionId: { restaurantId: RESTAURANT_ID, toastTransactionId: "toast_tx_1" } },
      })
    );
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────────
describe("Menu item sync", () => {
  it("upserts Toast menu items into ToastMenuItem", async () => {
    db.conn.findUnique.mockResolvedValue(validConnection);
    mockGetMenu.mockResolvedValue([
      { id: "item_guid_1", name: "Carne Asada Taco", price: 3.50, category: "FOOD" },
      { id: "item_guid_2", name: "Horchata",         price: 2.00, category: "BEVERAGE" },
    ]);
    mockGetTx.mockResolvedValue([]);
    db.menu.upsert.mockResolvedValue({});

    await syncTransactionsForRestaurant(RESTAURANT_ID);

    expect(db.menu.upsert).toHaveBeenCalledTimes(2);
    expect(db.menu.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { restaurantId_toastItemId: { restaurantId: RESTAURANT_ID, toastItemId: "item_guid_1" } },
        create: expect.objectContaining({ toastItemName: "Carne Asada Taco" }),
        update: expect.objectContaining({ toastItemName: "Carne Asada Taco" }),
      })
    );
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────────
describe("Transaction deduplication", () => {
  it("calls upsert (not create) so duplicate transactions are silently skipped", async () => {
    db.conn.findUnique.mockResolvedValue(validConnection);
    mockGetMenu.mockResolvedValue([]);
    const tx = { id: "toast_tx_dup", date: new Date().toISOString(), amount: 100, category: "FOOD", items: [], raw: {} };
    mockGetTx.mockResolvedValue([tx]);

    // First sync.
    db.tx.upsert.mockResolvedValue({});
    await syncTransactionsForRestaurant(RESTAURANT_ID);

    // Second sync — same transaction.
    db.tx.upsert.mockResolvedValue({});
    await syncTransactionsForRestaurant(RESTAURANT_ID);

    // upsert called twice total (once per sync call), but update:{} means no data change.
    expect(db.tx.upsert).toHaveBeenCalledTimes(2);
    expect(db.tx.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }) // immutable: empty update block
    );
  });
});

// ── Test 5 ────────────────────────────────────────────────────────────────────
describe("Token refresh during sync", () => {
  it("refreshes an expired token, stores new tokens, and completes sync", async () => {
    const expiredConnection = {
      ...validConnection,
      accessToken:  encrypt("at_expired"),
      refreshToken: ENC_RT_VALID,
      expiresAt:    new Date(Date.now() - 60_000),
    };
    db.conn.findUnique.mockResolvedValue(expiredConnection);
    mockRefresh.mockResolvedValue({ accessToken: "at_new", refreshToken: "rt_new", expiresIn: 3600 });
    db.conn.update.mockResolvedValue({});
    mockGetMenu.mockResolvedValue([]);
    mockGetTx.mockResolvedValue([
      { id: "toast_tx_after_refresh", date: new Date().toISOString(), amount: 200, category: "FOOD", items: [], raw: {} },
    ]);
    db.tx.upsert.mockResolvedValue({});

    const result = await syncTransactionsForRestaurant(RESTAURANT_ID);

    expect(mockRefresh).toHaveBeenCalledWith("rt_valid");
    expect(db.conn.update).toHaveBeenCalledTimes(1);

    // Tokens must be stored encrypted — decrypt stored value to verify round-trip.
    const updateCall = db.conn.update.mock.calls[0][0];
    expect(decrypt(updateCall.data.accessToken)).toBe("at_new");
    expect(decrypt(updateCall.data.refreshToken)).toBe("rt_new");

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });
});

// ── Test 6 ────────────────────────────────────────────────────────────────────
describe("Partial sync failure", () => {
  it("continues after individual transaction errors and reports counts correctly", async () => {
    db.conn.findUnique.mockResolvedValue(validConnection);
    mockGetMenu.mockResolvedValue([]);
    mockGetTx.mockResolvedValue([
      { id: "toast_ok_1",   date: new Date().toISOString(), amount: 100, category: "FOOD", items: [], raw: {} },
      { id: "toast_ok_2",   date: new Date().toISOString(), amount: 200, category: "FOOD", items: [], raw: {} },
      { id: "toast_fail_1", date: new Date().toISOString(), amount: 50,  category: "FOOD", items: [], raw: {} },
      { id: "toast_fail_2", date: new Date().toISOString(), amount: 75,  category: "FOOD", items: [], raw: {} },
    ]);

    db.tx.upsert
      .mockResolvedValueOnce({})               // ok_1 succeeds
      .mockResolvedValueOnce({})               // ok_2 succeeds
      .mockRejectedValueOnce(new Error("DB constraint on fail_1")) // fail_1
      .mockRejectedValueOnce(new Error("DB constraint on fail_2")); // fail_2

    const result = await syncTransactionsForRestaurant(RESTAURANT_ID);

    expect(result.synced).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("toast_fail_1");
  });
});
