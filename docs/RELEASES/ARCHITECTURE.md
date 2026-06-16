# System Architecture

## Component Diagram

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND                        │
├─────────────────────────────────────────────────┤
│ • POS Tab (/pos)                                │
│   └── ToastConnectButton + ToastTransactionSync │
│ • Cost Analysis (/cost-analysis)                │
│   └── Menu Mapping | COGS Report | Variance     │
│ • Sales Page (/sales) — daily entry only        │
└──────────────────┬──────────────────────────────┘
                   │ REST (JWT auth)
┌──────────────────▼──────────────────────────────┐
│              BACKEND — Express                   │
├─────────────────────────────────────────────────┤
│ routes/toast.ts                                 │
│   POST /connect       GET /callback             │
│   POST /disconnect    GET /status               │
│   POST /sync          GET /transactions         │
│   GET  /menu-items    POST /menu-items/:id/link │
│   POST /auto-link     GET /cogs-report          │
│   GET  /variance-flags                          │
├─────────────────────────────────────────────────┤
│ lib/toast-client.ts    → Toast REST API calls   │
│ lib/encryption.ts      → AES-256-GCM            │
│ lib/toast-state.ts     → CSRF state (Redis/mem) │
│ services/toast-sync.ts → Sync orchestrator      │
│ services/toast-recipe-linker.ts → COGS engine   │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│           BACKGROUND JOB                         │
├─────────────────────────────────────────────────┤
│ jobs/toast-sync-job.ts                          │
│ • setInterval (TOAST_SYNC_INTERVAL_MS, def 4h)  │
│ • 30s boot delay                                │
│ • Gated by TOAST_SYNC_ENABLED=true              │
│ • Calls syncAllRestaurantsWithToast()            │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│          DATABASE — PostgreSQL (Railway)          │
├─────────────────────────────────────────────────┤
│ toast_connections      encrypted tokens          │
│ toast_transactions     synced sales data         │
│ toast_menu_items       item ↔ recipe mapping     │
│ recipes                costed recipes            │
│ recipe_ingredients     ingredient costs          │
│ products               costPerUnit source        │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│          TOAST API (External)                    │
├─────────────────────────────────────────────────┤
│ oauth.toasttab.com     Authorization server      │
│ api.toasttab.com       Transactions, menu items  │
└─────────────────────────────────────────────────┘
```

## Data Models

### ToastConnection
```
id              cuid (PK)
restaurantId    FK → Restaurant (unique)
toastLocationId string
accessToken     string  ← AES-256-GCM encrypted
refreshToken    string  ← AES-256-GCM encrypted
expiresAt       DateTime
createdAt, updatedAt
```

### ToastTransaction
```
id                  cuid (PK)
restaurantId        FK → Restaurant
toastTransactionId  string  ← unique per restaurant
transactionDate     DateTime
amount              Float
category            string
itemDetails         Json  ← [{toastItemId, name, qty, unitPrice}]
rawData             Json  ← original Toast payload (audit)
status              string  "synced" | "failed"
syncedAt            DateTime
createdAt, updatedAt

@@unique([restaurantId, toastTransactionId])
```

### ToastMenuItem
```
id              cuid (PK)
restaurantId    FK → Restaurant
toastItemId     string  ← unique per restaurant
toastItemName   string
kyruProductId   FK → Product (optional, for ingredient-level mapping)
kyruRecipeId    FK → Recipe  (optional, for COGS calculation)
lastSyncedAt    DateTime
createdAt, updatedAt

@@unique([restaurantId, toastItemId])
```

## Encryption

Token format: `iv:authTag:ciphertext` (all hex-encoded)

```
ENCRYPTION_KEY (env) = 32 bytes = 64 hex chars
Algorithm: AES-256-GCM
IV: 16 random bytes per encryption
Auth tag: 16 bytes (GCM integrity check)
```

Tokens are decrypted only in-memory for API calls. Never logged, never returned in responses.

## Security Model

| Concern | Mitigation |
|---------|-----------|
| Token theft (DB breach) | AES-256-GCM encryption at rest |
| CSRF during OAuth | State parameter, 15-min TTL, single-use |
| Cross-tenant data | All queries scoped to `restaurantId` |
| Expired tokens | Auto-refresh on `/status` and during sync |
| Rate limiting | Existing `apiLimiter` middleware on all `/api/*` routes |

## Key Design Decisions

**No cron library** — `setInterval` + `setTimeout` for the sync job avoids adding a dependency. Equivalent for our use case (one process per Railway service).

**`update: {}` on transaction upsert** — Makes `ToastTransaction` records immutable after first sync. Duplicate syncs are silent no-ops, preserving audit integrity.

**Real encryption in tests** — Tests set `process.env.ENCRYPTION_KEY = "0".repeat(64)` and use the real `encrypt`/`decrypt` functions. Avoids fragile mock implementations that `jest.clearAllMocks()` breaks.

**`(prisma as any).toastConnection`** — Used in routes/services because the Prisma client was generated before the migration runs in production. Removed once `prisma generate` is run post-migration.
