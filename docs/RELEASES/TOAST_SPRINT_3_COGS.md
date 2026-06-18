# Sprint 3: COGS Integration

## Overview

Kyru uses synced Toast transactions + recipe ingredients to calculate the true
cost of each dish. Variance detection flags items with unexpected food cost %.

## What It Does

1. **Link Menu Items to Recipes**
   - Fuzzy match Toast item names to Kyru recipes (similarity ≥ 0.7 auto-links)
   - Manual override via dropdown in Cost Analysis tab
   - Stored in `ToastMenuItem.kyruRecipeId`

2. **Calculate COGS**
   - Sum ingredient costs: `Σ (quantity × conversionFactor × product.costPerUnit)`
   - Multiply recipe cost by qty sold from Toast transactions
   - Result: cost per unit + total COGS + blended cost %

3. **Flag Variances**
   - Compare actual cost % vs. configurable benchmark (default 30%)
   - Returns items where `costPct > benchmark` with gap calculation
   - Sorted by highest cost % first

4. **Cost Analysis Dashboard** (`/cost-analysis`)
   - Tab 1: Menu Item Mapping (link recipes, auto-link button)
   - Tab 2: COGS Report (date range, blended cost %, per-item breakdown)
   - Tab 3: Variance Flags (benchmark threshold, gap column)

## Files

| File | Purpose |
|------|---------|
| `backend/src/services/toast-recipe-linker.ts` | All COGS logic: linking, auto-link, report, variance |
| `backend/src/routes/toast.ts` | 5 new endpoints added |
| `backend/prisma/schema.prisma` | `kyruRecipeId` on ToastMenuItem, reverse relation on Recipe |
| `backend/prisma/migrations/add_toast_recipe_link.sql` | Migration SQL |
| `frontend/src/components/CostAnalysis.tsx` | 3-tab dashboard |
| `backend/src/__tests__/toast-cogs.test.ts` | 7 tests |

## COGS Formula

```
Recipe cost per unit = Σ (ingredient.quantity × conversionFactor × product.costPerUnit)

Example:
  Recipe: Carne Asada Taco
    0.1 kg carne asada @ $200/kg  = $20.00
    0.05 kg tortillas  @ $50/kg   = $2.50
  Cost per unit = $22.50

  Toast transactions: 50 tacos sold @ $75 each
  Revenue         = $3,750
  Total COGS      = $22.50 × 50 = $1,125
  Food Cost %     = $1,125 / $3,750 = 30%
```

## New API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/toast/menu-items` | List items with recipe + cost |
| `POST` | `/api/toast/menu-items/:id/link` | Link/unlink recipe (`recipeId: null` to unlink) |
| `POST` | `/api/toast/auto-link` | Fuzzy auto-link unlinked items |
| `GET` | `/api/toast/cogs-report` | COGS breakdown for date range |
| `GET` | `/api/toast/variance-flags` | Items exceeding cost % benchmark |

## Tests (7/7 passing)

1. `getMenuItemsWithCost` returns recipe cost when linked (0.1×200 + 0.05×50 = 22.5)
2. `getMenuItemsWithCost` returns `recipeCost: null` for unlinked items
3. `linkMenuItemToRecipe` calls `updateMany` with correct recipeId
4. `linkMenuItemToRecipe` accepts `null` to unlink
5. `autoLinkByName` links high-similarity match, skips low-similarity
6. `calculateCOGSReport` aggregates qty, revenue, recipe cost, cost % correctly
7. `getVarianceFlags` returns only items above benchmark with correct gap
