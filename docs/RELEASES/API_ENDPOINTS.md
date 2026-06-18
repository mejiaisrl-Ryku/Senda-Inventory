# Toast API Endpoints

**Base path:** `/api/toast`  
**Auth:** All endpoints require a valid JWT (existing Kyru auth), except `GET /callback`.

---

## POST /connect

Initiate the Toast OAuth flow.

**Request:** `{}` (no body needed)

**Response:**
```json
{ "authUrl": "https://oauth.toasttab.com/oauth/authorize?client_id=...&state=..." }
```

**Notes:** Frontend opens this URL in a popup or redirects to it.

---

## GET /callback

OAuth callback — Toast redirects here after user authorizes. **Unauthenticated.**

**Query params:** `?code=<auth_code>&state=<csrf_state>`

**Response:** Redirect to `/dashboard?toast=connected` or `/dashboard?toast=error`

---

## POST /disconnect

Remove the Toast connection for the authenticated restaurant.

**Request:** `{}`

**Response:**
```json
{ "success": true }
```

---

## GET /status

Check connection status. Auto-refreshes access token if expired.

**Response:**
```json
{ "connected": true, "locationId": "loc_guid_001", "expiresAt": "2026-06-17T00:00:00.000Z" }
// or
{ "connected": false }
// or (refresh failed)
{ "connected": false, "reason": "token_refresh_failed" }
```

---

## POST /sync

Manually trigger a full transaction + menu item sync.

**Request:** `{}`

**Response:**
```json
{ "synced": 42, "failed": 0, "errors": [] }
```

---

## GET /transactions

List synced transactions for a date range.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `startDate` | `YYYY-MM-DD` | — | Start of range (inclusive) |
| `endDate` | `YYYY-MM-DD` | — | End of range (inclusive) |
| `take` | number | 100 | Records per page (max 500) |
| `skip` | number | 0 | Pagination offset |

**Response:**
```json
{
  "transactions": [
    {
      "id": "cuid",
      "toastTransactionId": "toast_guid",
      "transactionDate": "2026-06-15T00:00:00.000Z",
      "amount": 150.00,
      "category": "FOOD",
      "itemDetails": [{ "toastItemId": "...", "name": "Taco", "qty": 3, "unitPrice": 50 }],
      "status": "synced",
      "syncedAt": "2026-06-15T12:00:00.000Z"
    }
  ],
  "total": 284
}
```

---

## GET /menu-items

List all synced Toast menu items with their linked recipe and estimated cost.

**Response:**
```json
{
  "menuItems": [
    {
      "toastItemId": "item_guid",
      "toastItemName": "Carne Asada Taco",
      "kyruRecipeId": "rec_cuid",
      "recipeName": "Carne Asada Taco",
      "recipeCost": 22.50,
      "lastSyncedAt": "2026-06-15T12:00:00.000Z"
    }
  ]
}
```

---

## POST /menu-items/:toastItemId/link

Link (or unlink) a Toast menu item to a Kyru recipe.

**Request:**
```json
{ "recipeId": "rec_cuid" }
// or to unlink:
{ "recipeId": null }
```

**Response:**
```json
{ "success": true }
```

---

## POST /auto-link

Auto-link unlinked menu items to recipes using name similarity (threshold ≥ 0.7).

**Request:** `{}`

**Response:**
```json
{ "linked": 8, "skipped": 3 }
```

---

## GET /cogs-report

COGS breakdown for a date range. Only items with linked recipes are included.

**Query params:** `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

**Response:**
```json
{
  "startDate": "2026-06-01",
  "endDate": "2026-06-16",
  "items": [
    {
      "toastItemId": "item_guid",
      "itemName": "Carne Asada Taco",
      "qtySold": 50,
      "revenue": 3750.00,
      "recipeCost": 1125.00,
      "costPct": 30.0
    }
  ],
  "totalCost": 1125.00,
  "totalRev": 3750.00,
  "blendedPct": 30.0
}
```

---

## GET /variance-flags

Return items where food cost % exceeds the benchmark.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `startDate` | `YYYY-MM-DD` | required | |
| `endDate` | `YYYY-MM-DD` | required | |
| `benchmark` | number | 30 | Cost % threshold |

**Response:**
```json
{
  "flags": [
    {
      "toastItemId": "item_guid",
      "itemName": "Wagyu Taco",
      "costPct": 52.0,
      "benchmark": 30,
      "gap": 22.0,
      "qtySold": 10,
      "revenue": 1000.00,
      "recipeCost": 520.00
    }
  ],
  "benchmark": 30
}
```
