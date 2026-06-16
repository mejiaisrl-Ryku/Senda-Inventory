# TOAST POS Integration — Complete (June 16, 2026)

## Executive Summary

Kyru Advisory has successfully integrated Toast POS as the first third-party integration.
Restaurants can now:
1. Authenticate with Toast (OAuth 2.0)
2. Sync daily transactions (menu items + quantities sold)
3. Calculate COGS per dish (recipe costs + Toast data)
4. View cost variance (detect anomalies automatically)

**Status:** Production-ready (awaiting customer deployment)

## What's Included

### Sprint 1: OAuth Foundation (✅ Complete)
- Toast OAuth 2.0 authorization code flow
- Token storage (AES-256-GCM encrypted)
- Automatic token refresh
- Frontend: "Connect Toast" button
- 6 tests, 100% passing

### Sprint 2: Transaction Sync (✅ Complete)
- Fetch daily transactions from Toast (last 30 days)
- Auto-sync job (every 4 hours)
- Menu item mapping
- Transaction history (audit log)
- 6 tests, 100% passing

### Sprint 3: COGS Integration (✅ Complete)
- Link Toast menu items to Kyru recipes
- Calculate weighted average cost per dish
- Variance detection (normal/warning/critical)
- Cost Analysis dashboard
- 7 tests, 100% passing

**Total: 19 tests passing across all three sprints**

## Architecture

```
Frontend
├── POS Tab (Toast connection)
├── Cost Analysis Dashboard (COGS + variance)
└── Sales Page (daily entry, clean)

Backend
├── OAuth Routes (/api/toast/connect, /callback, etc.)
├── Sync Service (background job every 4h)
├── Recipe Linker (fuzzy match + manual linking)
├── COGS Service (calculate costs)
└── Toast API Client (OAuth, transactions, menu items)

Database
├── ToastConnection (encrypted tokens + metadata)
├── ToastTransaction (synced transactions)
├── ToastMenuItem (menu item ↔ recipe mapping)
└── Recipe (linked via kyruRecipeId)
```

## Key Decisions

1. **Encryption:** AES-256-GCM for tokens (never plaintext)
2. **Token refresh:** Automatic, non-blocking
3. **Sync strategy:** Background job (4h interval), manual trigger available
4. **Recipe linking:** Fuzzy match (0.7+ score auto-links) + manual override
5. **COGS calculation:** Weighted average (matches restaurant industry standards)
6. **Testing:** Real encryption, no fragile mocks (19 tests, all passing)

## Deployment Checklist

- [x] Code written + tested
- [x] All sprints committed to `feat/toast-oauth-sprint1`
- [x] Migration SQL created
- [ ] Run migration in Railway PostgreSQL
- [ ] Add env vars (TOAST_SYNC_ENABLED, ENCRYPTION_KEY, etc.)
- [ ] Deploy to Railway
- [ ] Test live (OAuth → sync → COGS)

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for exact steps.

## Test Coverage

| Sprint | Tests | Status |
|--------|-------|--------|
| 1 (OAuth) | 6 | ✅ All passing |
| 2 (Sync) | 6 | ✅ All passing |
| 3 (COGS) | 7 | ✅ All passing |
| **Total** | **19** | **✅ 100%** |

## Next Steps

1. **Deploy to production** (Railway)
2. **Test with real Toast account** (Toast partner sandbox)
3. **Customer deployment** (bring first customers online with Toast)
