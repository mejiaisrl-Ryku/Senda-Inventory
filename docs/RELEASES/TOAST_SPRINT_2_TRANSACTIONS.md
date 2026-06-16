# Sprint 2: Transaction Sync

## Overview

Kyru automatically pulls daily transactions from Toast (sales data, menu items,
quantities) and stores them for COGS calculation.

## What It Does

1. **Background Sync Job** (every 4 hours)
   - Fetches last 30 days of transactions from Toast
   - Maps Toast menu items to Kyru products
   - Stores transaction history (audit trail)
   - Handles partial failures gracefully (per-item try/catch)

2. **Manual Sync** → `POST /api/toast/sync`
   - Triggers sync on-demand
   - Returns `{synced: X, failed: Y, errors: [...]}`

3. **View Transactions** → `GET /api/toast/transactions`
   - Lists all synced transactions with date range filter
   - Paginated (default 100, max 500)
   - Used by COGS dashboard and POS tab

## Files

| File | Purpose |
|------|---------|
| `backend/src/services/toast-sync.ts` | Sync orchestrator, token refresh, upsert logic |
| `backend/src/jobs/toast-sync-job.ts` | Background job (setInterval, 30s boot delay) |
| `backend/prisma/schema.prisma` | ToastTransaction + ToastMenuItem models |
| `backend/src/routes/toast.ts` | `/sync` and `/transactions` endpoints |
| `frontend/src/components/ToastTransactionSync.tsx` | Sync status UI + transaction table |
| `backend/src/__tests__/toast-sync.test.ts` | 6 tests |

## Data Flow

```
Toast API
    ↓
toast-client.getTransactions() + getMenuItems()
    ↓
toast-sync.syncTransactionsForRestaurant()
    ↓
Upsert with update:{} → deduplicated, immutable after first sync
    ↓
ToastTransaction rows in PostgreSQL
    ↓
Frontend: transaction history + sync status
```

## Deduplication Strategy

Transactions use `@@unique([restaurantId, toastTransactionId])` with `update: {}` (empty update block). This means:
- First sync: creates the record
- Subsequent syncs: silently no-ops on duplicates
- Records are immutable after first write (audit integrity)

## Tests (6/6 passing)

1. Sync returns `{synced:0, errors:["Not connected"]}` when no Toast connection
2. Valid connection fetches + stores 2 transactions correctly
3. Menu items upserted with correct `toastItemName`
4. Duplicate transaction IDs silently skipped (upsert called twice, no data change)
5. Expired token auto-refreshes during sync; new tokens stored encrypted
6. 2 of 4 transactions fail — `{synced:2, failed:2, errors:[...]}` returned
