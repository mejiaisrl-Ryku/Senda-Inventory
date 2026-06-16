# Test Results Summary

## Overview

**19/19 tests passing** across 3 suites  
Run time: ~566ms total

```
Test Suites: 3 passed, 3 total
Tests:       19 passed, 19 total
```

---

## Sprint 1: OAuth — `toast.test.ts` (6/6)

```
✅ POST /connect returns authorization URL
✅ GET /callback with valid code stores encrypted token + redirects
✅ GET /callback with invalid state rejects (CSRF protection)
✅ GET /status returns {connected: false} when no connection
✅ GET /status returns {connected: true, expiresAt} when connected
✅ GET /status auto-refreshes expired token silently
```

**Time: ~150ms**

---

## Sprint 2: Transaction Sync — `toast-sync.test.ts` (6/6)

```
✅ Returns {synced:0, errors:["Not connected"]} when no Toast connection
✅ Fetches + stores 2 transactions, returns {synced:2, failed:0}
✅ Upserts 2 menu items with correct toastItemName
✅ Duplicate transaction IDs silently skipped (update:{} immutable)
✅ Expired token refreshes during sync; new tokens stored encrypted
✅ 2 of 4 transactions fail → {synced:2, failed:2, errors:[...]}
```

**Time: ~125ms**

**Key testing decision:** Uses real AES-256-GCM with `process.env.ENCRYPTION_KEY = "0".repeat(64)` instead of mocking `encrypt`/`decrypt`. This avoids a `jest.clearAllMocks()` pitfall where mock factory implementations get cleared between tests.

---

## Sprint 3: COGS — `toast-cogs.test.ts` (7/7)

```
✅ getMenuItemsWithCost: recipe cost calculated (0.1×200 + 0.05×50 = 22.5)
✅ getMenuItemsWithCost: returns recipeCost=null for unlinked items
✅ linkMenuItemToRecipe: calls updateMany with correct recipeId
✅ linkMenuItemToRecipe: accepts null to unlink
✅ autoLinkByName: links high-similarity match, skips low-similarity
✅ calculateCOGSReport: 3 tacos @ $50 each, cost=0.1×200×3=60, costPct=40%
✅ getVarianceFlags: returns only items above 30% benchmark with correct gap
```

**Time: ~97ms**

---

## Build Status

```
Backend:  npx tsc --noEmit → 0 errors
Frontend: npx tsc --noEmit → 0 errors
```

---

## Coverage Notes

All 3 suites mock the Prisma client and Toast API client (`toast-client.ts`). The encryption library is **not** mocked — real AES-256 round-trips are verified in Sprint 2 Test 5:

```typescript
// Verify tokens stored encrypted and round-trip correctly
expect(decrypt(updateCall.data.accessToken)).toBe("at_new");
expect(decrypt(updateCall.data.refreshToken)).toBe("rt_new");
```
