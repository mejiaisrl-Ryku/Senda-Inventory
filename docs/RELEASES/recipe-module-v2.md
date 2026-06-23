# Recipe Module v2: Preparations & Allergen Tracking

## Overview

Adds a prep layer (mise en place, stocks, sauces) that recipes can link to,
plus allergen tracking with cascade-from-prep and manual-override semantics.
Recipe cost now folds in linked prep costs; recipes also gained portions,
category, kitchen station, plating notes, and a non-destructive scaling
preview in the form.

## What It Does

1. **Preparations** (`/preparations`)
   - CRUD for reusable preps: name, description, prep method, plating notes,
     photo URL, shelf life, storage temp/location, conservation type, yield,
     cost, cost-per-portion estimate
   - Restaurant-scoped via RLS (`current_setting('app.restaurant_id')`)

2. **Recipe ↔ Prep linking**
   - Recipes accept `prepIds` on create/update via `recipe_preparations`
   - `recipeCost` = Σ ingredient costs + Σ linked prep costs (each linked prep
     contributes its full pre-calculated cost once)
   - `costPerPortion` = `recipeCost / portions` when portions is set

3. **Allergens** (14 seeded, EN/ES labels, global lookup table)
   - Preps can carry their own allergens (`preparation_allergens`)
   - Linking a prep to a recipe cascades the prep's allergens onto the
     recipe (`recipe_allergens`) — insert-only, never overwrites an existing
     row
   - Explicit `allergenIds` sent via the API are upserted as
     `manuallyOverridden: true`; allergens excluded from that list get
     `isPresent: false, manuallyOverridden: true` (a row is kept, not
     deleted) — this is what lets a later cascade recognize "already
     decided" and skip re-adding a removed allergen
   - The frontend only sends `allergenIds` when the chef actually touches
     the checkboxes, so untouched cascade-only allergens aren't silently
     flipped to "manual" by unrelated recipe edits

4. **Recipe form additions** (`RecipesPage.tsx`)
   - Portions, batch weight, category (Starter/Main/Dessert/Snack/Beverage),
     kitchen station (Grill/Saucier/Pantry/Pastry/Bar/Fryer), preparation
     method, plating notes, photo URL (plain text field — no file upload)
   - Linked-prep search/add/remove
   - Allergen checklist with cascaded-vs-manual tags
   - Client-only scaling preview (×0.5–×5); never part of the save payload

## Files

| File | Purpose |
|------|---------|
| `backend/prisma/migrations/20260622112445_add_preparations_and_allergens/migration.sql` | `preparations`, `recipe_preparations`, `allergens`, `recipe_allergens` tables, 3 enums, 8 new `recipes` columns, RLS, seed data |
| `backend/prisma/migrations/20260622160326_add_preparation_allergens/migration.sql` | `preparation_allergens` table + RLS |
| `backend/prisma/schema.prisma` | New models: `Preparation`, `RecipePreparation`, `Allergen`, `RecipeAllergen`, `PreparationAllergen`; new `Recipe` fields/enums |
| `backend/src/controllers/preparationController.ts` | Preparation CRUD |
| `backend/src/controllers/allergenController.ts` | `GET /api/allergens` (lookup list) |
| `backend/src/controllers/recipeController.ts` | Cost cascade, allergen upsert/cascade, prep linking |
| `backend/src/lib/allergenCascade.ts` | Insert-only cascade helper, shared by prep and recipe controllers |
| `backend/src/routes/preparations.ts`, `backend/src/routes/allergens.ts` | Route registration |
| `frontend/src/components/PreparationsPage.tsx`, `PreparationModal.tsx` | Preparations CRUD UI |
| `frontend/src/components/RecipesPage.tsx` | Recipe form additions (preps, allergens, category/station, scaling) |
| `frontend/src/api/index.ts`, `frontend/src/types/index.ts` | `preparationsApi`, `allergensApi`, extended `Recipe`/`RecipeUpsertRequest` types |
| `frontend/src/i18n/translations.ts` | EN/ES strings for preparations + recipe additions |

## Known Limitations

- **Photo is a URL text field, not a file upload.** The existing S3 service
  only does server-side buffer upload and stores non-browser-renderable
  `s3://` URLs; building real upload+serving was deferred as a separate
  decision (public-bucket vs. signed-GET proxy).
- **Scaling preview is non-destructive by design** — there's no "apply
  scaled quantities" save action yet.
- **No `preparation_category`-style structured allergen editing UI on the
  Preparations page beyond a flat checklist** — fine for 14 allergens, would
  need grouping if the list grows much larger.
- Removing an allergen via the recipe form leaves an `isPresent: false` row
  rather than deleting it (intentional — see cascade note above), so the
  `recipe_allergens` table will accumulate "off" rows over a recipe's
  lifetime rather than staying minimal.

## Incidents Found & Fixed During Rollout

- An RLS policy bug in the original migration referenced
  `recipes.restaurant_id` (snake_case), but that column is actually
  camelCase `restaurantId` (no `@map` on that field). This silently broke
  RLS enablement for all 5 new tables in production — verified and fixed
  directly against the database, then corrected in the migration file.
- `backend/railway.toml` ran plain `npm install`, which skips
  `devDependencies` under Railway's production `NODE_ENV` — this dropped
  `typescript` and broke every build (`tsc: not found`, exit 127),
  silently blocking this release from deploying for several hours. Fixed
  to `npm install --include=dev`.
- `DATABASE_URL`/`DIRECT_URL` were briefly pointed at an empty `senda_prod`
  database (a path mismatch introduced during an unrelated credential
  rotation), causing all logins/password resets to fail with "user not
  found" against real accounts. Reverted to the `railway` database, which
  holds all real data and was already correctly migrated.

## Next Steps

- Decide on real photo upload (public bucket vs. signed-GET proxy) if
  needed
- "Apply" action for the scaling preview, if chefs want to save scaled
  recipes directly
- Structured UAT with a real client (Kardy's Lunch Spot) once convenient
