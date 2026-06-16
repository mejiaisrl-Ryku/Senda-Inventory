# Deployment Guide

## Prerequisites

- Branch `feat/toast-oauth-sprint1` merged into `develop` / `main`
- All 19 tests passing locally
- Access to Railway dashboard and PostgreSQL console

---

## Step 1 — Run Database Migrations

In the Railway PostgreSQL console (or via `psql`), run each migration file in order:

```sql
-- 1. Toast connection table
-- Contents of: backend/prisma/migrations/add_toast_connection.sql

-- 2. Transaction + menu item tables
-- Contents of: backend/prisma/migrations/add_toast_transaction_models.sql

-- 3. Recipe link column
-- Contents of: backend/prisma/migrations/add_toast_recipe_link.sql
```

Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('toast_connections', 'toast_transactions', 'toast_menu_items')
ORDER BY table_name, column_name;
```

---

## Step 2 — Add Environment Variables

In the Railway backend service → **Variables** tab, add:

| Variable | Value | Notes |
|----------|-------|-------|
| `TOAST_CLIENT_ID` | `<from Toast partner dashboard>` | |
| `TOAST_CLIENT_SECRET` | `<from Toast partner dashboard>` | |
| `TOAST_REDIRECT_URI` | `https://api.kyruadvisory.com/api/toast/callback` | Must match Toast app config |
| `TOAST_API_BASE_URL` | `https://api.toasttab.com` | Or sandbox URL for testing |
| `ENCRYPTION_KEY` | *(see below)* | 64 hex chars (32 bytes) |
| `TOAST_SYNC_ENABLED` | `true` | Enables background sync job |
| `TOAST_SYNC_INTERVAL_MS` | `14400000` | 4 hours (default) |

**Generate ENCRYPTION_KEY:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ Store the key securely. Losing it means all stored tokens must be re-authorized.

---

## Step 3 — Deploy

Railway auto-deploys on push to `main`. Watch the **Deployments** tab.

Once deployed, check logs for the sync job:
```
[toast_sync_job] toast_sync_job_scheduled intervalMs=14400000
```
(First sync runs 30 seconds after boot.)

---

## Step 4 — Smoke Test

1. Log in to the app → **POS** tab
2. Click **Connect Toast** → authorize with a Toast account
3. Confirm redirect back with `?toast=connected`
4. Click **Sync Now** → should return `{synced: N, failed: 0}`
5. Navigate to **Cost Analysis** → Menu Item Mapping tab
6. Click **Auto-link by Name** → recipes should link
7. Run a COGS Report for the past 30 days

---

## Rollback

No destructive schema changes were made (additive only). To roll back:

```bash
git revert <commit_hash>
git push origin main
```

Railway redeploys automatically. Existing data is preserved.

To remove the migration columns (only if needed):
```sql
ALTER TABLE toast_menu_items DROP COLUMN IF EXISTS kyru_recipe_id;
DROP TABLE IF EXISTS toast_transactions;
DROP TABLE IF EXISTS toast_menu_items;
DROP TABLE IF EXISTS toast_connections;
```
