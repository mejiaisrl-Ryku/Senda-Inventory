# Runbook — RLS Migration Deploy

Production deploy checklist for `feat/postgres-rls`.
Run steps in order. Every step that touches the live DB is marked ⚠️.

---

## Step 0 — Generate and store passwords

Before doing anything else, generate strong passwords and keep them in your
shell session. You will need them in Step 1 (SQL), Step 2 (Railway vars), and
Step 6 (tests).

```bash
export POSTGRES_PASSWORD="BdhMeJnIvyzobHKpmQbVKiaRnICcfrdE"  # existing postgres superuser pw
export APP_DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)
export ADMIN_DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)

echo "APP_DB_PASSWORD   = $APP_DB_PASSWORD"
echo "ADMIN_DB_PASSWORD = $ADMIN_DB_PASSWORD"
# ↑ Copy these to a password manager NOW — you need them for Railway vars in Step 2.
```

---

## Step 1 — Take a manual backup ⚠️

In Railway dashboard → Postgres → Backups → **Create Backup**.
Label it `pre-rls-YYYY-MM-DD`.

Wait for the backup to show "Completed" before continuing.

---

## Step 2 — Create senda_app and senda_admin users ⚠️

### How to execute this SQL

You need to run the SQL block below **as the postgres superuser** using the
public connection (not the Railway-internal hostname — that only works from
inside the Railway network).

**Option A — Node.js (recommended; no psql needed)**

```bash
cd /path/to/senda-inventory/backend
node -e "
const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://postgres:' + process.env.POSTGRES_PASSWORD +
    '@ballast.proxy.rlwy.net:58121/railway'
});
(async () => {
  await c.connect();
  const appPw   = process.env.APP_DB_PASSWORD;
  const adminPw = process.env.ADMIN_DB_PASSWORD;
  await c.query(\`
    DO \\\$\\\$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senda_app') THEN
        CREATE ROLE senda_app
          LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
          PASSWORD '\${appPw}';
      ELSE
        ALTER ROLE senda_app PASSWORD '\${appPw}';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senda_admin') THEN
        CREATE ROLE senda_admin
          LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
          PASSWORD '\${adminPw}';
      ELSE
        ALTER ROLE senda_admin PASSWORD '\${adminPw}';
      END IF;
    END \\\$\\\$;
  \`);
  const r = await c.query(
    'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN (\\'senda_app\\', \\'senda_admin\\') ORDER BY rolname'
  );
  console.log('Roles created/updated:', r.rows);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected output:
```
Roles created/updated: [
  { rolname: 'senda_admin', rolsuper: false, rolbypassrls: true },
  { rolname: 'senda_app',   rolsuper: false, rolbypassrls: false }
]
```

**Option B — psql (if installed)**

```bash
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  -h ballast.proxy.rlwy.net -p 58121 \
  -U postgres -d railway \
  -c "CREATE ROLE senda_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$APP_DB_PASSWORD';" \
  -c "CREATE ROLE senda_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD '$ADMIN_DB_PASSWORD';"
```

---

## Step 3 — Update Railway environment variables

> ⚠️ **CRITICAL — Read before touching Railway vars:**
>
> Railway can auto-redeploy the app when environment variables change.
> If the app redeploys **before the migration runs in Step 4**, it will use
> `DATABASE_URL = senda_app` but RLS will not yet be enabled — any query
> that hits a tenant table will see **zero rows** (fail-closed) until the
> migration runs.
>
> **Disable auto-deploy in Railway settings first:**
> Railway dashboard → senda-inventory → Settings → Deploy → "Auto-deploy on
> variable change" → **OFF**.
> Re-enable it after Step 5 (post-migration deploy).

In Railway dashboard → senda-inventory backend service → Variables, set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://senda_app:<APP_DB_PASSWORD>@ballast.proxy.rlwy.net:58121/railway` |
| `DIRECT_URL` | `postgresql://postgres:<POSTGRES_PASSWORD>@postgres.railway.internal:5432/railway` |
| `ADMIN_DATABASE_URL` | `postgresql://senda_admin:<ADMIN_DB_PASSWORD>@ballast.proxy.rlwy.net:58121/railway` |

Replace `<APP_DB_PASSWORD>`, `<POSTGRES_PASSWORD>`, and `<ADMIN_DB_PASSWORD>` with
the values from Step 0.

Do **not** deploy the app yet.

---

## Step 4 — Run the migration ⚠️

The migration enables RLS and creates policies. It must run as the postgres
superuser (the only role with permission to create other roles and enable RLS).

```bash
cd backend

# Use the postgres superuser URL for both DATABASE_URL and DIRECT_URL so
# prisma migrate deploy connects directly (bypasses pgBouncer) and runs
# as superuser.
DIRECT_URL="postgresql://postgres:${POSTGRES_PASSWORD}@ballast.proxy.rlwy.net:58121/railway" \
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@ballast.proxy.rlwy.net:58121/railway" \
  npx prisma migrate deploy
```

Confirm the last line of output is:
```
Migration 20260608130000_enable_rls_tenant_isolation marked as applied.
```

Verify RLS is active:

```bash
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString:
  'postgresql://postgres:' + process.env.POSTGRES_PASSWORD +
  '@ballast.proxy.rlwy.net:58121/railway' });
c.connect().then(() => c.query(\`
  SELECT relname AS table, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
  FROM pg_class
  WHERE relname IN ('products','orders','cogs_categories','sales_entries','stock_logs')
  ORDER BY relname
\`)).then(r => { console.log(r.rows); c.end(); }).catch(e => { console.error(e.message); c.end(); });
"
```

All five rows should show `rls_enabled: true, rls_forced: true`.

---

## Step 5 — Smoke-test before switching app traffic

### 5a — Fail-closed test (no GUC → 0 rows as senda_app)

```bash
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString:
  'postgresql://senda_app:' + process.env.APP_DB_PASSWORD +
  '@ballast.proxy.rlwy.net:58121/railway' });
(async () => {
  await c.connect();
  await c.query('BEGIN');
  const r = await c.query('SELECT count(*) FROM products');
  await c.query('ROLLBACK');
  const n = Number(r.rows[0].count);
  console.log('products (no GUC):', n, n === 0 ? '✓ PASS' : '✗ FAIL');
  await c.end();
})();
"
```

Expected: `products (no GUC): 0 ✓ PASS`

### 5b — Tenant GUC test (Kardy's restaurantId → 28 products)

```bash
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString:
  'postgresql://senda_app:' + process.env.APP_DB_PASSWORD +
  '@ballast.proxy.rlwy.net:58121/railway' });
(async () => {
  await c.connect();
  await c.query('BEGIN');
  await c.query('SELECT set_config(\$1, \$2, true)',
    ['app.restaurant_id', 'cmpip92f60001l8ii23e86mub']);
  const r = await c.query('SELECT count(*) FROM products');
  await c.query('ROLLBACK');
  console.log('Kardys products (with GUC):', r.rows[0].count, '← expected 28');
  await c.end();
})();
"
```

### 5c — BYPASSRLS test (senda_admin sees all rows without GUC)

```bash
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString:
  'postgresql://senda_admin:' + process.env.ADMIN_DB_PASSWORD +
  '@ballast.proxy.rlwy.net:58121/railway' });
(async () => {
  await c.connect();
  const user = await c.query('SELECT current_user');
  const count = await c.query('SELECT count(*) FROM products');
  console.log('connected as:', user.rows[0].current_user, '← expected senda_admin');
  console.log('total products (BYPASSRLS):', count.rows[0].count, '← expected >= 28');
  await c.end();
})();
"
```

---

## Step 6 — Deploy the application

Re-enable auto-deploy if you disabled it in Step 3, then trigger a deploy:

```bash
git push origin feat/postgres-rls
# Open PR → merge to develop → Railway auto-deploys
# OR: railway up --service senda-inventory
```

Confirm in Railway logs:
- App starts without errors
- `GET /health` returns `{ "status": "ok", "db": "ok" }`

---

## Step 7 — Post-deploy verification

Run all three integration test suites against production:

```bash
cd backend

INTEGRATION_DATABASE_URL="postgresql://senda_app:${APP_DB_PASSWORD}@ballast.proxy.rlwy.net:58121/railway" \
ADMIN_DATABASE_URL="postgresql://senda_admin:${ADMIN_DB_PASSWORD}@ballast.proxy.rlwy.net:58121/railway" \
  npx jest tenantIsolation tenantIntegrity rlsPolicy --ci --forceExit
```

Expected: **37 tests passing, 0 failing.**
- `tenantIntegrity` — 6 tests: FK integrity, no orphans
- `tenantIsolation` — 16 tests: app-layer WHERE injection
- `rlsPolicy` — 15 tests: RLS-1 (raw SQL with GUC), RLS-2 (fail-closed), RLS-3 (prismaT + RLS combined)

---

## Rollback

If anything goes wrong after Step 4, run the following as the postgres superuser.

### 1. Disable RLS policies and remove roles

```sql
-- Drop all policies and disable RLS on every tenant table
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

-- Transfer any objects owned by the new roles back to postgres,
-- then drop them. Without REASSIGN/DROP OWNED, DROP ROLE will fail.
REASSIGN OWNED BY senda_app TO postgres;
DROP OWNED BY senda_app;
DROP ROLE IF EXISTS senda_app;

REASSIGN OWNED BY senda_admin TO postgres;
DROP OWNED BY senda_admin;
DROP ROLE IF EXISTS senda_admin;
```

### 2. Revert Railway environment variables

In Railway dashboard → senda-inventory → Variables:
- Set `DATABASE_URL` back to `postgresql://postgres:<POSTGRES_PASSWORD>@ballast.proxy.rlwy.net:58121/railway`
- Delete `DIRECT_URL`
- Delete `ADMIN_DATABASE_URL`

### 3. Redeploy

Trigger a Railway redeploy from the previous working commit (the tip of
`feat/app-tenant-isolation`).
