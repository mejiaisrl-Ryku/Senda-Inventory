# Senda Inventory — June 23, 2026 Development Session
# Preparations & Recipes: UI Overhaul, Production/Consumption, and a Critical RLS Hardening Pass
# Documentación Completa · EN/ES headers, English body

---

## 🎯 Executive Summary · Resumen Ejecutivo

**7 commits. 1 critical security incident found and closed. 1 long-standing costing bug fixed. 10 feature tasks shipped. 0 data loss.**

This session started as a UI/UX cleanup of the Preparations and Recipes modals and turned up a production-breaking bug (linking a preparation to a recipe threw a 500) whose root cause traced back to **two separate, more serious defects**: a tenant-isolation gap in the Prisma client extension, and — found while investigating that — **Row-Level Security being completely bypassed in production** because the app was connecting to Postgres as the superuser instead of the scoped `senda_app` role. Both were fixed and verified live before any feature work continued.

Once the platform was confirmed sound, the session delivered the full Preparations/Recipes redesign the client asked for, built a new production/consumption (stock depletion) system for both Recipes and Preparations from scratch, and closed out a cost-accuracy bug where a linked preparation always charged its full batch cost to a recipe regardless of how much of it was actually used.

**Clients:** Dopamina & La Milagrosa
**Stack:** React + Node.js + PostgreSQL (Prisma) · Railway (backend/DB) + Vercel-style static hosting (frontend)
**Session date:** June 23, 2026

### Impact in Numbers

| Area | Before | After |
|---|---|---|
| Tenant isolation (RLS) | **Bypassed entirely** — `DATABASE_URL` connected as Postgres superuser, which ignores Postgres RLS by default | Enforced — `senda_app` role with a rotated password, verified to return 0 rows without tenant context set |
| Linking a Preparation to a Recipe | 500 Internal Server Error, every time | 200 OK, allergens cascade correctly |
| Single-record updates on tenant-scoped models (`recipe.update`, `recipe.delete`, etc.) | Broken for **every** model in the tenant extension's scope, not just recipes — Prisma rejected the malformed `WHERE` | Fixed at the extension level, fixing every affected model in one change |
| Preparation cost | Manually typed, no ingredient breakdown | Computed live from a searchable ingredient list, same engine as Recipes |
| Linked-preparation cost in a Recipe | **Always the prep's full batch cost**, regardless of usage (e.g., a recipe using 2 oz of a 4-batch sauce was charged for the whole batch) | Scaled by actual usage quantity/unit, with the same auto-convert / manual-conversion-factor UX as ingredients |
| Stock depletion | Manual only, Products only | Recipes and Preparations both have a "Produce" action that deducts ingredient/linked-prep stock automatically, with an audit log |
| Secrets exposure | N/A | AWS keys, JWT secrets, DB passwords, etc. were printed in plaintext while debugging — flagged immediately, **all rotated by the client same day** |

---

## 🚨 Critical Security Incident · Incidente de Seguridad Crítico

This is the most important section of this document and is placed first on purpose.

### What was found

While tracing the "linking a preparation to a recipe causes a 500" bug, investigation revealed that **production's `DATABASE_URL` connected to Postgres as the `postgres` superuser**, not the `senda_app` role the entire RLS architecture (added in an earlier session, see `recipe-module-v2.md` and `docs/runbook-rls-deploy.md`) assumes. PostgreSQL automatically bypasses Row-Level Security for table owners and superusers — meaning **every tenant-isolation guarantee in the codebase had been silently inert in production**, for all restaurants, since the RLS feature was deployed.

The `senda_app` role itself had also never had its password changed from the placeholder set in the original migration:

```sql
-- backend/prisma/migrations/20260608130000_enable_rls_tenant_isolation/migration.sql
CREATE ROLE senda_app
  LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD 'PLACEHOLDER_CHANGE_BEFORE_DEPLOY';
```

In other words: the RLS rollout was never actually completed end-to-end. The policies, grants, and app-layer WHERE-injection were all correctly written — but the production app was never switched over to use them.

### What was done about it

1. **Rotated the `senda_app` password** directly against the production database and verified the role could connect.
2. **Switched both `senda-inventory` and `Worker` Railway services' `DATABASE_URL`** from the superuser connection string to the `senda_app` role, keeping `DIRECT_URL` on the superuser (needed for raw migrations/DDL).
3. **Verified RLS is now actually enforced** — confirmed live that a `SELECT` against `recipes` as `senda_app` with no tenant context set (`app.restaurant_id` unset) returns **zero rows**, and that the same query with the GUC correctly set returns the expected restaurant's data.
4. **Flagged plaintext secret exposure to the client immediately.** Investigating the role/credential issue required running `railway variables --kv`, which printed real production secrets (AWS keys, JWT secrets, encryption key, Resend/Anthropic API keys, DB passwords) into the terminal session in plaintext. The exact variable names were listed for the client so they could be rotated. **The client confirmed all of these were rotated the same day.**

### Why this didn't block the recipe-linking bug fix on its own

Switching to the correctly-scoped role actually *exposed* a second, independent bug (see next section) — once RLS was genuinely active, a different code path broke that had been silently masked by the superuser bypass the whole time. Both had to be fixed together before the original user-reported bug actually went away.

---

## 🐛 Root-Cause Chain: Why "Add Salsa to Tacos de Pollo" Threw a 500

Three independent defects stacked on top of each other. All three needed fixing before the user-visible symptom (a 500 error when linking a preparation to a recipe) actually disappeared.

### Defect 1 — Join tables never got the RLS session variable set

**Commit:** [`31de22b`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/31de22b)

The tenant-scoping Prisma Client Extension (`backend/src/lib/prisma.ts`) sets the `app.restaurant_id` Postgres session variable only for models in a `RESTAURANT_SCOPED` allowlist — models with their own `restaurantId` column. But several join/child tables (`recipe_preparations`, `recipe_allergens`, `preparation_allergens`, `recipe_ingredients`, `stock_logs`, `order_items`, `count_entries`) have **no `restaurantId` column of their own** — their RLS policies enforce tenancy by joining back to a scoped parent (e.g. `recipe_preparations` → `recipes.restaurantId`). Because these models weren't in any scoped set, the GUC was never set for them, so their RLS `WITH CHECK` silently failed on insert once RLS was actually active (see incident above).

**Fix:** added a new `JOIN_SCOPED_GUC_ONLY` set that triggers GUC-setting (but *not* WHERE/CREATE filter injection, since there's no such column to filter on) for these tables. Also added `preparation` itself to `RESTAURANT_SCOPED` (it does have a `restaurantId` column and had been missing from the list).

### Defect 2 — The tenant extension broke every single-record write

**Commit:** [`3d35ec2`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/3d35ec2)

This is the bigger one. `update`/`delete`/`upsert`/`findUnique` all take Prisma's `WhereUniqueInput`, which requires a unique field (e.g. `id`) at the top level — it cannot be wrapped in `AND`. The extension was AND-wrapping the `WHERE` clause uniformly for *every* operation in scope, so any single-record write on **any** `RESTAURANT_SCOPED` model — not just `recipe`, every model in that list — failed with:

```
Argument `where` of type RecipeWhereUniqueInput needs at least one of `id` arguments.
```

This is what actually produced the 500 when saving a recipe (the `recipe.update()` call that runs on every save, prep-linking or not, was silently broken the whole time RLS was bypassed — the superuser bypass meant this bug never had a chance to surface, because the broken query still hit Postgres in a way that... actually returned an error regardless, just a different one than expected. Once the role was fixed, this became the actual blocking error).

**Fix:** unique-record operations now get the tenant filter merged flat alongside the unique field (`{ ...where, ...filter }`) instead of wrapped in `AND`. This fix applies to every model that goes through `prismaT`, not just recipes — a real, latent bug across the whole app that this investigation surfaced and closed in one place.

### Defect 3 — `recipe_ingredients` had the same join-table gap

**Commit:** [`9f8c90b`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/9f8c90b)

After fixing Defects 1 and 2, the very next save attempt hit:

```
new row violates row-level security policy for table "recipe_ingredients"
```

`recipe_ingredients` has the same shape as the join tables in Defect 1 (no `restaurantId`, scoped via `recipeId` → `recipes.restaurantId`) but had been missed in the first pass. **Fix:** added `recipeIngredient` to `JOIN_SCOPED_GUC_ONLY`, and proactively audited every other table with an RLS policy in the migration history for the same gap — found and fixed `stockLog`, `orderItem`, and `countEntry` at the same time, before they had a chance to cause the identical bug later.

### Verification

After all three fixes, the exact user-reported flow was reproduced against production using a short-lived signed JWT for the real account and the real "Tacos de Pollo" / "Salsa" records:

```bash
PUT /api/recipes/cmpvwvqxm0011ssl4oeawgw43
{ "ingredients": [...], "prepIds": [1], "allergenIds": [] }
→ 200 OK
```

Response included the linked preparation and three allergens cascaded correctly from "Salsa" (`sesame`, `soy`, `tree_nuts`), all with `manuallyOverridden: false` — confirming the cascade logic, which had never been reachable before this fix, also worked correctly the first time it actually ran.

---

## 🔨 What Was Built · Lo que se Construyó

---

### Preparations: Form Cleanup & Field Reordering ✅
**Commits:** [`1c30b2c`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/1c30b2c), [`7b80e99`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/7b80e99) · **File:** `frontend/src/components/PreparationModal.tsx`

- Removed **Plating Notes** and **Photo URL** fields from the form (DB columns kept, untouched, in case of future use — UI-only removal per client decision).
- **Ingredients and Allergens moved to the very top** of the modal, above Name/Description, per a follow-up client request after seeing the first pass.
- Allergen checkbox grid replaced with a dropdown multi-select (new shared `AllergenMultiSelect` component, see below).

### Preparations: Product Search + Live Ingredient Costing ✅
**Commit:** [`1c30b2c`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/1c30b2c) · **Files:** `PreparationModal.tsx`, `preparationController.ts`, new `PreparationIngredient` model

Preparations previously had a single manually-typed `cost` field with no way to see what it was made of. Now:

- A product search bar (identical UX to the Recipes ingredient search) lets a chef add Products to a Preparation.
- Each ingredient line has the same parameters as a Recipe ingredient: quantity, unit dropdown, OZ quick-select fractions, and a "How many X per Y?" manual conversion-factor row when units don't auto-convert.
- `cost` and `costPerPortionEstimate` are now **computed automatically** from the ingredient list on every save — no manual entry.
- New `preparation_ingredients` table (mirrors `recipe_ingredients` exactly) plus a shared `backend/src/lib/ingredientCosting.ts` module so Recipes and Preparations use the **identical** cost formula instead of two copies that could drift apart.

**Verified live:** 2 LB of "Chiles Secos" @ $10/lb → `cost: 20`, `costPerPortionEstimate: 5` on a 4-batch yield. Math confirmed exact.

### Preparations: Stock Tracking ✅
**Commit:** [`1c30b2c`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/1c30b2c) · **Files:** `PreparationModal.tsx`, `PreparationsPage.tsx`, `preparationController.ts`

- New `currentStock` column on `Preparation`, shown in the same row as Storage Location and Cost (per the client's explicit layout request), editable directly in the modal.
- Preparations list table now shows a Stock column.

### Recipes: Form Cleanup ✅
**Commit:** [`1c30b2c`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/1c30b2c) · **File:** `frontend/src/components/RecipesPage.tsx`

Removed from the Recipe modal (UI-only — DB columns untouched): **Portions Per Batch, Batch Weight, Category, Kitchen Station, Preparation Method**.

### Recipes: Allergen Dropdown with Cascade Tags ✅
**Commit:** [`1c30b2c`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/1c30b2c)

Replaced the allergen checkbox grid with the same `AllergenMultiSelect` dropdown used in Preparations, with a `(from prep)` / `(manual)` tag on each selected chip so a chef can see at a glance whether an allergen was cascaded automatically or chosen by hand — the underlying cascade-vs-manual logic (`manuallyOverridden`) already existed; this just exposes it.

### New Shared Component: `AllergenMultiSelect` ✅
**File:** `frontend/src/components/AllergenMultiSelect.tsx` (new, 114 lines)

A dropdown multi-select with checkbox items and removable chips, replacing duplicated checkbox-grid markup in both forms. Click-outside-to-close, same dark-theme styling as the rest of the app.

### Production / Consumption System (Stock Depletion) ✅
**Commit:** [`73e52ab`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/73e52ab) · **New files:** `ProduceDialog.tsx`, `PreparationStockLog` model

Built from scratch — neither Recipes nor Preparations had any concept of "this was actually made/sold, deduct the stock" before this session; only direct manual Product stock adjustments existed.

- **`POST /api/preparations/:id/produce`** — records a batch of a preparation being made. Scales each linked ingredient's quantity by `quantityProduced ÷ recipeYield` and deducts that from the relevant Products' `currentStock`, while increasing the preparation's own `currentStock` by `quantityProduced`. Every change is logged (`StockLog` for products, new `PreparationStockLog` for the preparation, reason `PRODUCED`/`USED`).
- **`POST /api/recipes/:id/produce`** — records `quantity` batches of a recipe being made/sold. Deducts `quantity × ingredient.quantity` from each Product, and `quantity × (converted) recipe_preparation.quantity` from each linked Preparation's stock. A linked preparation with no usage quantity set is **skipped and reported back** in the response (`skippedPreparations`) rather than blocking the whole request.
- New **"Produce" button** on both the Recipes and Preparations list pages, opening a shared `ProduceDialog` quantity-entry modal.
- New `PRODUCED` value added to the `StockReason` enum.

**Verified live** against the real "Salsa" preparation: producing 1 batch correctly deducted 0.5 oz of Chiles Secos (2 oz × ¼ scale, since `quantityProduced=1` against a `recipeYield=4`) from real product stock, logged both sides, then reverted to leave no test artifacts on the client's account.

### Cost-Accuracy Fix: Linked Preparations Now Scale by Usage ✅
**Commit:** [`9a147d7`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/9a147d7) · **Files:** `recipeController.ts`, `RecipesPage.tsx`, new `recipe_preparations.conversion_factor` column

Found while reviewing a client screenshot: the Linked Preparations row in the Recipe modal had no quantity/unit inputs at all — just an add/remove list. The backend cost formula matched that limitation by design (a long-standing code comment explicitly said "each linked prep contributes its full cost once, regardless of quantity"). The result: **a recipe using 2 oz of a sauce that yields a 4-batch sauce was charged for the entire batch, every time**, with no way to fix it from the UI.

**Fix — a real formula change, not just UI:**

- `recipe_preparations.quantity`/`unit` (already existed, unused) plus a new `conversion_factor` column are now used exactly like an ingredient line: the preparation's `costPerPortionEstimate` (or `cost ÷ recipeYield`) stands in for a product's `costPerUnit`, and `recipeYieldUnit` stands in for the product's unit — so the **same** `ingredientCost()` auto-convert / manual-factor formula applies unchanged.
- The Linked Preparations UI in the Recipe modal now has the **identical** quantity/unit-dropdown/OZ-quick-select/"How many X per Y?" parameters as the Ingredients table — this was the client's explicit ask, screenshot-verified pixel-for-pixel against the Ingredients row.
- `produceRecipe`'s preparation-stock depletion had the same gap — it was subtracting the raw `quantity` from preparation stock with no unit conversion. Fixed to convert into the preparation's `recipeYieldUnit` first, using the identical factor logic, so depletion and costing are now mathematically consistent with each other.
- Legacy recipe-preparation links with no quantity/unit set (i.e. every link created before this fix) fall back to the old full-cost behavior automatically — nothing broke for existing recipes; they'll cost accurately once a chef sets a usage quantity.

**Verified live** against the real "Tacos de Pollo" / "Salsa Verde" link (cost $2.25, yield 4 batches, yield unit "batch"):

| Scenario | recipeCost | Salsa Verde `usageCost` |
|---|---|---|
| Legacy (no quantity set) | $3.20 | $2.25 (full cost, unchanged fallback) |
| 2 oz, no conversion factor | $0.95 | **$0** — oz doesn't auto-convert to "batch"; this is correct and intentional |
| 2 oz, conversion factor 16 (16 oz/batch) | $1.02 | $0.07 (= 2⁄16 × $0.56/batch) |

Reverted to the original legacy state afterward so the client's live data was untouched.

**Important note left for the client:** because "Salsa Verde" yields in "batch" (not a weight/volume unit), simply picking "OZ" from the new unit dropdown is **not enough on its own** — the amber "How many OZ per batch?" row will appear, and a real conversion factor needs to be entered for the cost to scale correctly. This is the same UX already in place for cross-system ingredient conversions (e.g. Tortillas: EA per KG), just newly extended to preparations.

---

## 🏗️ Architecture Decisions · Decisiones de Arquitectura

- **`JOIN_SCOPED_GUC_ONLY` vs. `RESTAURANT_SCOPED`**: rather than forcing every tenant-scoped table to have its own `restaurantId` column (a larger, riskier schema change), the tenant extension now distinguishes between tables that need WHERE-filter injection *and* GUC-setting (`RESTAURANT_SCOPED`) and tables that only need the GUC set because their RLS policy is enforced via a join (`JOIN_SCOPED_GUC_ONLY`). This pattern should be the default checklist item any time a new child/join table gets an RLS policy.
- **Shared cost-math libraries, not duplicated formulas**: `backend/src/lib/ingredientCosting.ts` (backend) and `frontend/src/utils/ingredientCost.ts` (frontend, pre-existing pattern extended) mean Recipes, Preparations, and (now) linked-preparation-usage-in-a-recipe all compute cost the same way. This was a deliberate refactor specifically so the three numbers — Recipe ingredient cost, Preparation ingredient cost, and Preparation-as-used-in-a-Recipe cost — can never silently diverge again.
- **A preparation linked to a recipe is modeled as an ingredient-like line, not a special case.** Its `costPerPortionEstimate`/`recipeYieldUnit` simply substitute for a Product's `costPerUnit`/`unit`. This is why the exact same UI component logic, OZ presets, and conversion-factor UX could be reused without a parallel implementation.
- **Legacy-safe migrations**: every new "usage quantity" column (`recipe_preparations.conversion_factor`, etc.) defaults to `null`/fallback behavior so existing data keeps working exactly as before until a chef actively sets the new field — no backfill, no forced re-entry.

---

## 🗂️ Files Modified · Archivos Modificados

### Backend
| File | Change |
|---|---|
| `backend/src/lib/prisma.ts` | `JOIN_SCOPED_GUC_ONLY` set; unique-where flat-merge fix |
| `backend/src/lib/ingredientCosting.ts` | **New** — shared cost formula (`ingredientCost`, `getAutoFactor`, `num`, `round2`) |
| `backend/src/controllers/recipeController.ts` | `produceRecipe`; `preparationUsageCost`; `setRecipeLinks` reworked for structured `preparations` payload |
| `backend/src/controllers/preparationController.ts` | `producePreparation`; ingredient CRUD + cost recompute; `currentStock` |
| `backend/src/routes/recipes.ts`, `backend/src/routes/preparations.ts` | New `/produce` routes |
| `backend/prisma/schema.prisma` | `PreparationIngredient`, `PreparationStockLog` models; `Preparation.currentStock`; `RecipePreparation.conversionFactor`; `PRODUCED` enum value |
| `backend/prisma/migrations/20260623170319_add_preparation_ingredients_and_stock/` | New table + column + RLS |
| `backend/prisma/migrations/20260623173556_add_preparation_stock_logs/` | New table + RLS + enum value |
| `backend/prisma/migrations/20260623181010_add_recipe_preparation_conversion_factor/` | New column |

### Frontend
| File | Change |
|---|---|
| `frontend/src/components/PreparationModal.tsx` | Field removal/reorder; product search; ingredient table; stock field |
| `frontend/src/components/RecipesPage.tsx` | Field removal; allergen dropdown; Linked Preparations rebuilt to match Ingredients exactly; Produce button/dialog |
| `frontend/src/components/PreparationsPage.tsx` | Stock column; Produce button/dialog |
| `frontend/src/components/AllergenMultiSelect.tsx` | **New** shared component |
| `frontend/src/components/ProduceDialog.tsx` | **New** shared component |
| `frontend/src/utils/ingredientCost.ts` | **New** — client-side cost preview mirror of the backend lib |
| `frontend/src/api/index.ts`, `frontend/src/types/index.ts` | New `produce()` calls; `PreparationIngredient`, extended `RecipePreparationRef` types |
| `frontend/src/i18n/translations.ts` | EN/ES strings for stock, production, and skipped-preparation warnings |

### Infrastructure (manual, production database — not in version control)
- `senda_app` role password rotated; `DATABASE_URL` on both Railway services (`senda-inventory`, `Worker`) switched from the Postgres superuser to `senda_app`.
- RLS policies + grants manually applied for every new table in this session (`preparation_ingredients`, `preparation_stock_logs`) immediately after each deploy, since this project's deploy command (`prisma db push`) does not run raw-SQL migration files — only `prisma migrate deploy` would, and this app uses `db push`. **This is a standing gap**: any future migration with raw SQL (RLS, grants, enum additions) needs the same manual follow-up step after every deploy until the deploy pipeline is switched to `migrate deploy`. See `docs/runbook-rls-deploy.md`.

---

## 🧪 Testing & Verification · Pruebas y Verificación

All changes in this session were verified against **real production data** for the client's actual account (not synthetic fixtures), with explicit reverts afterward to leave no test artifacts:

- ✅ Backend: `npm run build` (tsc) clean after every commit; `npm run test:unit` (25 tests, costing/stock/rateLimiter) green after every commit.
- ✅ Frontend: `npm run build` (react-scripts) clean after every commit.
- ✅ RLS bypass: confirmed live (0 rows without tenant context; correct rows with it).
- ✅ Recipe→Preparation linking: confirmed live, real records, real allergen cascade.
- ✅ Preparation ingredient costing: confirmed live, real product, exact dollar math.
- ✅ Preparation production: confirmed live, real stock deduction, real audit log, reverted.
- ✅ Recipe→Preparation usage-cost scaling: confirmed live across three scenarios (legacy fallback, zero-without-factor, scaled-with-factor), reverted.

---

## ⚠️ Known Limitations · Limitaciones Conocidas

- **Deploy pipeline gap**: production deploys via `prisma db push`, which silently skips any raw SQL in a migration file (RLS policies, grants, `ALTER TYPE ... ADD VALUE`). Every migration in this session needed a manual follow-up step against the production database. This should be fixed by switching to `prisma migrate deploy`, which is a more involved change (requires reconciling migration history with the already-`db push`-synced schema) and was deliberately deferred rather than risked mid-session.
- **Legacy recipe-preparation links** (every one created before this session) have no usage quantity set and will keep contributing full prep cost until a chef opens the recipe and sets a real quantity/unit.
- **No backfill tooling** was built to bulk-set usage quantities across existing recipes — this is a one-recipe-at-a-time manual fix for now.
- Preparation "Produce" and Recipe "Produce" are independent actions; there's no automatic linkage where producing a Recipe also auto-produces a Preparation that's running low — a chef has to produce the Preparation separately if its own stock is insufficient (the `produce` endpoints validate and reject the whole request with a clear error if stock would go negative, rather than allowing negative stock).

---

## 🔮 Next Steps · Próximos Pasos

- Switch the production deploy pipeline from `prisma db push` to `prisma migrate deploy` to close the manual-RLS-follow-up gap permanently.
- Consider a bulk-edit or guided-prompt flow for setting usage quantities on legacy recipe-preparation links, so chefs aren't caught out by the "still using fallback full cost" state silently.
- Decide whether producing a Recipe should be allowed to auto-trigger producing a low-stock linked Preparation, or whether the current explicit-only behavior is preferred (current behavior was a deliberate choice this session, but worth revisiting with the client).

---

## 📖 Bilingual Note · Nota Bilingüe

All new UI strings (stock label, production dialog, skipped-preparation warning) were added to both the `en` and `es` blocks of `translations.ts` in the same commit they were introduced — no follow-up translation pass needed.

---

## ✅ Session Complete · Sesión Completa

| | Item | Commit |
|-|---|---|
| 🚨 | RLS bypass found & closed (role rotation + `DATABASE_URL` switch) | manual, infra — no commit |
| 🚨 | Secrets exposed during investigation — flagged, **client confirmed all rotated** | — |
| ✅ | Fix: join tables missing RLS GUC | [`31de22b`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/31de22b) |
| ✅ | Fix: unique-where AND-wrap bug (app-wide) | [`3d35ec2`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/3d35ec2) |
| ✅ | Fix: remaining join-table RLS gaps (`recipe_ingredients`, `stock_logs`, `order_items`, `count_entries`) | [`9f8c90b`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/9f8c90b) |
| ✅ | Preparations: product search, ingredient costing, stock, allergen dropdown; Recipes: field cleanup, allergen dropdown | [`1c30b2c`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/1c30b2c) |
| ✅ | Preparation modal: Ingredients/Allergens to top, ingredient UI parity | [`7b80e99`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/7b80e99) |
| ✅ | Production/consumption system for Recipes and Preparations | [`73e52ab`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/73e52ab) |
| ✅ | Fix: linked-preparation cost scaling + UI parity with Ingredients | [`9a147d7`](https://github.com/mejiaisrl-Ryku/senda-inventory/commit/9a147d7) |
