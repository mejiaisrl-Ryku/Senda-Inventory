# Runbook — RLS Migration Deploy

Production deploy checklist for `feat/postgres-rls`.
Run steps in order.  Every step that touches the live DB is marked ⚠️.

---

## Pre-flight

```bash
# 1. Confirm you have the Railway postgres superuser URL
railway run --service "Postgres" env | grep DATABASE_URL
# → ballast.proxy.rlwy.net:58121 public URL or postgres.railway.internal internal

# 2. Take a manual backup in Railway dashboard → Postgres → Backups → Create Backup
#    Label it "pre-rls-YYYY-MM-DD"
```

---

## Step 1 — Create senda_app and senda_admin users ⚠️

Run this as the postgres superuser (use DIRECT_URL, not the pooler):

```sql
-- Generate strong passwords first:
--   openssl rand -hex 32   →  APP_DB_PASSWORD
--   openssl rand -hex 32   →  ADMIN_DB_PASSWORD

-- Replace <APP_DB_PASSWORD> and <ADMIN_DB_PASSWORD> below.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senda_app') THEN
    CREATE ROLE senda_app
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      PASSWORD '<APP_DB_PASSWORD>';
  ELSE
    ALTER ROLE senda_app PASSWORD '<APP_DB_PASSWORD>';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senda_admin') THEN
    CREATE ROLE senda_admin
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
      PASSWORD '<ADMIN_DB_PASSWORD>';
  ELSE
    ALTER ROLE senda_admin PASSWORD '<ADMIN_DB_PASSWORD>';
  END IF;
END $$;
```

---

## Step 2 — Update Railway environment variables

In Railway dashboard → senda-inventory backend service → Variables:

| Variable | New value |
|---|---|
| `DATABASE_URL` | `postgresql://senda_app:<APP_DB_PASSWORD>@ballast.proxy.rlwy.net:58121/railway` |
| `DIRECT_URL` | `postgresql://postgres:<postgres_password>@postgres.railway.internal:5432/railway` |
| `ADMIN_DATABASE_URL` | `postgresql://senda_admin:<ADMIN_DB_PASSWORD>@ballast.proxy.rlwy.net:58121/railway` |

> ⚠️  Do NOT deploy the app yet — the migration must run first.

---

## Step 3 — Run the migration ⚠️

The migration must run as the postgres superuser (DIRECT_URL) because it
creates roles and enables RLS.

```bash
cd backend
DIRECT_URL="postgresql://postgres:<pw>@ballast.proxy.rlwy.net:58121/railway" \
DATABASE_URL="$DIRECT_URL" \
  npx prisma migrate deploy
```

Confirm the last migration applied is `20260608130000_enable_rls_tenant_isolation`.

---

## Step 4 — Smoke-test before switching app traffic

```bash
# Connect as senda_app (no GUC set) → should return 0 rows
PGPASSWORD=<APP_DB_PASSWORD> psql \
  "postgresql://senda_app@ballast.proxy.rlwy.net:58121/railway" \
  -c "SELECT count(*) FROM products;"
# Expected: 0

# Connect as senda_app, set GUC → should return Kardy's products only
PGPASSWORD=<APP_DB_PASSWORD> psql \
  "postgresql://senda_app@ballast.proxy.rlwy.net:58121/railway" <<'SQL'
BEGIN;
SELECT set_config('app.restaurant_id', 'cmpip92f60001l8ii23e86mub', true);
SELECT count(*) FROM products;
COMMIT;
SQL
# Expected: 28 (Kardy's product count)

# Connect as senda_admin (BYPASSRLS) → should return ALL rows
PGPASSWORD=<ADMIN_DB_PASSWORD> psql \
  "postgresql://senda_admin@ballast.proxy.rlwy.net:58121/railway" \
  -c "SELECT count(*) FROM products;"
# Expected: total across all tenants
```

---

## Step 5 — Deploy the application

```bash
git push origin feat/postgres-rls
# Open PR → merge to develop → deploy
```

Confirm in Railway logs that the app starts without errors.

---

## Step 6 — Post-deploy verification

```bash
# Run integration tests against production
cd backend
INTEGRATION_DATABASE_URL="postgresql://senda_app:<pw>@ballast.proxy.rlwy.net:58121/railway" \
  npx jest tenantIsolation tenantIntegrity --ci --forceExit
```

All tests should pass.

---

## Rollback

If anything goes wrong, run the following as the postgres superuser:

```sql
DO $$ DECLARE t text; BEGIN
  FOR t IN VALUES
    ('products'),('orders'),('sales_entries'),('labor_entries'),
    ('count_sessions'),('recipes'),('location_budgets'),('cogs_categories'),
    ('stock_logs'),('count_entries'),('order_items'),('recipe_ingredients')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP ROLE IF EXISTS senda_app;
DROP ROLE IF EXISTS senda_admin;
```

Then revert `DATABASE_URL` in Railway back to the postgres connection string,
remove `DIRECT_URL` and `ADMIN_DATABASE_URL`, and redeploy the previous
`feat/app-tenant-isolation` build.
