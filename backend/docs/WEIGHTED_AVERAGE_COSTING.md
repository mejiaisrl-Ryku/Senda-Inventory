# Weighted Average Costing — Feature Documentation

## Executive Summary

Kyru now automatically calculates accurate food costs (COGS) based on actual invoice prices. When a restaurant receives an invoice, the system updates the average cost of each item, enabling accurate prime cost tracking and financial reporting.

**Key benefit:** Restaurants no longer manually estimate food costs. Real costs flow from invoices to P&L reports automatically.

---

## 1. The Problem (Why This Matters)

Most restaurant managers estimate COGS or use stale prices:
- **Manual entry:** "I think chicken is $3.20/lb" — prone to error
- **Stale data:** Last month's price, doesn't reflect vendor discounts or market changes
- **No audit trail:** Where did that cost number come from?

**Result:** Prime Cost % is meaningless. Owner dashboards show garbage data.

Kyru solves this: **Actual invoice prices automatically become COGS.**

---

## 2. How It Works (Architecture)

### The Flow

```
Invoice arrives
    ↓
REST endpoint: POST /orders → PUT /orders/:id/receive
    ↓
Weighted Average Calculation:
    newCost = (existingQty × existingCost + incomingQty × incomingCost) / (existingQty + incomingQty)
    ↓
Update Product.costPerUnit
    ↓
Create StockLog with unitCost snapshot
    ↓
Stock increments, cost is locked in
    ↓
COGS reports use the snapshot
```

### Data Model

**StockLog** (the core record):
```
{
  id: UUID,
  productId: UUID,
  reason: RECEIVED | USED | WASTE | ADJUSTED,
  change: number (quantity change),
  unitCost: float (snapshot of cost at transaction time),
  timestamp: datetime,
}
```

**Product**:
```
{
  id: UUID,
  name: string,
  costPerUnit: float (current weighted average),
  currentStock: float (qty on hand),
  cogsCategory: Food | Beverage | Labor | etc,
}
```

**OrderItem** (invoice line item):
```
{
  orderId: UUID,
  productId: UUID (optional — unlinked items are skipped),
  quantity: float,
  unitCost: float (from invoice, validated > $0),
}
```

---

## 3. The Weighted Average Formula (With Examples)

### Formula
```
newCostPerUnit = (existingQty × existingCost + incomingQty × incomingCost) / (existingQty + incomingQty)
```

### Example 1: Price Increase
```
Scenario: Chicken breast, supplier raised prices

Before receipt:
  Qty: 50 lbs
  Cost: $3.20/lb
  Total value: $160.00

Invoice (received):
  Qty: 20 lbs @ $3.50/lb
  Total value: $70.00

Calculation:
  newCost = ($160 + $70) / (50 + 20)
  newCost = $230 / 70
  newCost = $3.2857/lb

After receipt:
  Qty: 70 lbs
  Cost: $3.2857/lb (blended average)
  Total value: $230.00
```

### Example 2: Bulk Discount
```
Scenario: Switching vendors for lower cost

Before:
  50 lbs @ $4.00/lb = $200

Invoice:
  50 lbs @ $2.00/lb = $100

Calculation:
  newCost = ($200 + $100) / (50 + 50)
  newCost = $300 / 100
  newCost = $3.00/lb

Result: Blended average reflects the discount without abandoning expensive inventory.
```

### Example 3: First Purchase
```
Scenario: New product, no prior inventory

Before:
  0 lbs @ $0 = $0

Invoice:
  30 lbs @ $5.00/lb = $150

Calculation:
  newCost = (0 + $150) / (0 + 30)
  newCost = $5.00/lb

Result: First cost becomes the starting cost.
```

---

## 4. Historical COGS Stability (The Snapshot Mechanism)

### Problem We Solved
Without snapshots, historical COGS shifts retroactively:

```
January COGS report:
  100 lbs used @ $3.20/lb = $320 COGS

February:
  New invoice at $4.00/lb arrives
  costPerUnit updates to $3.50 (new average)

January COGS report NOW shows:
  100 lbs used @ $3.50/lb = $350 COGS ← Changed retroactively!
```

### Solution: unitCost Snapshot
Every StockLog captures the cost at transaction time:

```
January StockLog entry:
{
  change: -100,
  reason: "USED",
  unitCost: $3.20 (snapshot at time of use)
}

February:
  New invoice arrives, costPerUnit → $3.50
  
January StockLog entry is unchanged:
  unitCost: $3.20 (still $3.20, locked in)

COGS Calculation:
  COGS = |change| × (unitCost ?? costPerUnit)
  COGS = 100 × $3.20 = $320 (immutable)
```

**Result:** January COGS stays at $320 forever, regardless of future price changes.

---

## 5. API Changes

### Updated Endpoint: `PUT /orders/:id/receive`

**Request:**
```json
{
  "orderId": "order-123"
}
```

**Response:**
```json
{
  "id": "order-123",
  "status": "RECEIVED",
  "orderItems": [...],
  "metadata": {
    "linkedItemsProcessed": 3,
    "skippedItems": [
      {
        "productName": "Paper Napkins",
        "quantity": 5,
        "unitCost": 12.50,
        "reason": "No product linked — cost not updated"
      }
    ]
  }
}
```

**What changed:**
- `costPerUnit` is now updated for each linked item (was: never updated)
- `StockLog.unitCost` is populated (was: always null)
- `metadata.skippedItems` indicates unlinked invoice items (was: silently skipped)

### Updated Endpoint: `POST /stock/adjust`

**Before:**
```
StockLog created with:
  reason: USED | WASTE | ADJUSTED
  change: -qty
```

**After:**
```
StockLog created with:
  reason: USED | WASTE | ADJUSTED
  change: -qty
  unitCost: $3.2000 (snapshot of Product.costPerUnit at adjustment time)
```

---

## 6. Test Coverage

### Unit Tests (13/13 passing)

**File:** `backend/src/__tests__/lib/costing.test.ts`

Tests verify:
- ✅ Standard WAC calculation (50 lbs @ $3.20 + 20 lbs @ $3.50 = $3.2857)
- ✅ First purchase (0 lbs + 20 lbs @ $3.50 = $3.50)
- ✅ Price increases and decreases
- ✅ 4-decimal rounding precision
- ✅ Error handling (NaN, negative values)
- ✅ COGS with snapshot, COGS with fallback

### Integration Test

**Test:** `wac-test.mjs` (production verification)

Verified end-to-end:
- ✅ Authentication and restaurant scope
- ✅ Product creation at initial cost
- ✅ Invoice creation with new price
- ✅ Invoice receipt triggers WAC
- ✅ costPerUnit updates correctly ($3.2857)
- ✅ Stock increments (50 → 70 lbs)
- ✅ StockLog.unitCost snapshot captured

**Result:** All 7 checks passed in production.

---

## 7. Deployment Notes

### Migration Required
```sql
ALTER TABLE "stock_logs"
  ADD COLUMN IF NOT EXISTS "unitCost" DOUBLE PRECISION;
```

**Important:** Run migration BEFORE deploying new code. New code expects this column.

### Backwards Compatibility
- Existing StockLog records have `unitCost = NULL` (before migration)
- COGS calculation falls back: `unitCost ?? costPerUnit`
- Old invoice receipts work, but don't get cost updates (pre-WAC code didn't update costPerUnit)
- No data is lost; migration just adds a nullable column

### Breaking Changes
- `OrderItem.unitCost` now validates `> 0.00` (was: `>= 0.00`)
- Zero-cost items are rejected with validation error
- `receiveOrder()` now returns `metadata.skippedItems` (new field, safe to add)

---

## 8. Consulting Pitch: Why This Matters

### For Restaurant Owners
> "Right now, you're guessing at food costs. That means your profit numbers are wrong.
>
> Kyru pulls the actual prices from your supplier invoices and calculates real COGS automatically. Your prime cost % is finally accurate. You can actually see which menu items make money."

### For Multi-Unit Operators
> "Weighted average costing means costs reflect volume discounts and vendor changes in real-time.
>
> If you negotiate bulk pricing with one vendor, every location sees the new blended cost. No manual spreadsheet updates. No stale data."

### Competitive Advantage
- Toast integrates sales data, we automate COGS
- Together: Real Prime Cost in real-time
- Most tools show Prime Cost as "Sales − Labor ÷ Sales" — we show it correctly

---

## 9. Known Limitations & Future Work

### Current Limitations
1. **Manual invoice entry** — Food costs require manual invoice input (Toast integration planned to automate this)
2. **No recipe costing** — Recipes are read-only calculators, don't auto-deplete when sold
3. **No variance tracking** — Doesn't track usage vs. expected (recipe-based COGS would enable this)

### Planned Features
1. **Toast integration** — Auto-pull sales by category → COGS flows from POS
2. **Recipe-based depletion** — Selling a dish auto-depletes ingredients at WAC
3. **Variance reports** — "Expected COGS vs. actual COGS" variance analysis
4. **Purveyor benchmarking** — Compare your costs against market rates

---

## 10. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Restaurant receives invoice from supplier                        │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │ POST /orders (create order)  │
        │ with OrderItems:             │
        │  - productId                 │
        │  - quantity                  │
        │  - unitCost (from invoice)   │
        └──────────────┬───────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │ POST /orders/:id/receive     │
        └──────────────┬───────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ↓                           ↓
   ┌──────────────────┐    ┌────────────────────────┐
   │ For each linked  │    │ For unlinked items:    │
   │ OrderItem:       │    │ (no productId)         │
   │                  │    │ Collect in             │
   │ 1. Calculate WAC │    │ metadata.skippedItems  │
   │ 2. Update        │    │ (user must link later) │
   │    Product.cost  │    │                        │
   │ 3. Snapshot      │    └────────────────────────┘
   │    unitCost      │
   │ 4. Increment     │
   │    currentStock  │
   └──────────────────┘
         │
         ↓
   ┌──────────────────────────────────────┐
   │ StockLog created:                    │
   │  reason: RECEIVED                    │
   │  change: +20 (qty received)          │
   │  unitCost: $3.20 (snapshot)          │
   └──────────────────────────────────────┘
         │
         ↓
   ┌──────────────────────────────────────┐
   │ Reports & P&L calculations:          │
   │ COGS = |change| × unitCost snapshot  │
   │ (historical COGS immutable)          │
   └──────────────────────────────────────┘
         │
         ↓
   ┌──────────────────────────────────────┐
   │ Owner Dashboard shows accurate:      │
   │  • COGS %                            │
   │  • Prime Cost %                      │
   │  • Profitability per menu item       │
   └──────────────────────────────────────┘
```

---

## 11. Code References

| File | Change | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | Added `unitCost Float?` to StockLog | Store snapshot |
| `src/lib/costing.ts` | New module | Weighted average formula + COGS calc |
| `src/controllers/ordersController.ts` | Updated `receiveOrder()` | Apply WAC on receipt |
| `src/controllers/stockController.ts` | Updated `adjustStock()` | Snapshot cost on depletion |
| `src/controllers/reportsController.ts` | Updated COGS calc | Use snapshot, not current cost |
| `src/controllers/xlsxExportController.ts` | Updated COGS export | Same snapshot logic |
| `src/__tests__/lib/costing.test.ts` | New test suite | 13 test cases |

---

## 12. FAQ

**Q: What if an item has no productId?**  
A: It's unlinked. Stock is received, but cost isn't updated. Returned in `metadata.skippedItems` so the user can link or manually adjust later.

**Q: What if unitCost = $0?**  
A: Rejected by validation. Must be > $0.

**Q: Can I edit costPerUnit manually?**  
A: Yes. But next invoice receipt will recalculate WAC and override it. WAC is the source of truth.

**Q: What about inventory written off as waste?**  
A: `adjustStock()` with reason=WASTE creates a StockLog with unitCost snapshot. COGS includes it.

**Q: How does this work for multi-location?**  
A: Each location's products have separate costs. WAC is per-location by design (scoped by restaurantId).

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| costPerUnit not updating on invoice receipt | Old code running (pre-deploy) | Redeploy or check Railway logs |
| "Unit cost must be greater than $0" error | Attempting to create OrderItem with unitCost=0 | Enter a real cost (even $0.01 if comped) |
| StockLog.unitCost is NULL for recent entries | Migration not run | Run: `ALTER TABLE stock_logs ADD COLUMN unitCost DOUBLE PRECISION;` |
| COGS report shows wrong numbers | Using current costPerUnit instead of snapshot | Check reportsController uses `unitCost ?? fallback` |

---

## 14. Next Steps

### Phase 1 (Complete) ✅
- [x] Schema: Add StockLog.unitCost
- [x] Utility: weightedAverageCost function
- [x] receiveOrder(): Apply WAC
- [x] Snapshot: unitCost on all transaction logs
- [x] Reports: Use snapshot for immutable COGS
- [x] Testing: 13/13 passing, production verified

### Phase 2 (Planned)
- [ ] Toast integration: Auto-pull sales by category
- [ ] Recipe costing: Auto-deplete ingredients when recipe sold
- [ ] Variance reports: Expected vs. actual COGS

### Phase 3 (Planned)
- [ ] Multi-vendor costing: Track cost per vendor per product
- [ ] Margin analysis: Show profit by dish, by vendor
- [ ] Purveyor benchmarking: Compare your costs to market rates

---

**Document version:** 1.0  
**Last updated:** June 2, 2026  
**Status:** Production-ready
