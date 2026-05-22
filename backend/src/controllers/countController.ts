import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Proxy models (not in generated Prisma client until db push + generate) ────
const sessionModel = (prisma as any).countSession as any;
const entryModel   = (prisma as any).countEntry   as any;

// ── Enums ─────────────────────────────────────────────────────────────────────
const CountDepartmentEnum = z.enum(["KITCHEN", "BAR", "FOH", "ALL"]);

// ── Schemas ───────────────────────────────────────────────────────────────────
export const createSessionSchema = z.object({
  date:       z.string().min(1, "Date is required"),
  department: CountDepartmentEnum.default("ALL"),
});

export const bulkUpsertEntriesSchema = z.object({
  entries: z.array(
    z.object({
      productId:      z.string().min(1),
      actualQuantity: z.number().nonnegative("Quantity cannot be negative"),
      notes:          z.string().optional(),
    })
  ).min(1, "At least one entry is required"),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a Prisma where-clause that maps CountDepartment → Product.department values. */
function productDeptFilter(dept: string): object {
  if (dept === "KITCHEN") return { department: { in: ["BOH", "BOTH"] as never[] } };
  if (dept === "BAR")     return { department: "BAR" as never };
  if (dept === "FOH")     return { department: { in: ["FOH", "BOTH"] as never[] } };
  return {}; // ALL — no filter
}

function num(v: unknown): number {
  return typeof v === "object" ? parseFloat(String(v)) : Number(v);
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /api/counts
 * Create a new count session and pre-populate entries from current product stock.
 */
export async function createSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const body = createSessionSchema.parse(req.body);

    // Create the session record
    const session = await sessionModel.create({
      data: {
        restaurantId: req.user.restaurantId,
        date:         new Date(body.date).toISOString(),
        department:   body.department,
        status:       "OPEN",
        createdBy:    req.user.id,
        updatedAt:    new Date(),
      },
    });

    // Auto-populate entries: one row per product matching the dept filter.
    // expectedQuantity = system's current stock; actualQuantity starts at 0.
    const products = await (prisma as any).product.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...productDeptFilter(body.department),
      },
      orderBy: { name: "asc" },
    });

    if (products.length > 0) {
      await entryModel.createMany({
        data: products.map((p: any) => ({
          sessionId:        session.id,
          productId:        p.id,
          expectedQuantity: p.currentStock,
          actualQuantity:   0,
          variance:         0,
          unitCost:         p.costPerUnit,
          varianceValue:    0,
        })),
        skipDuplicates: true,
      });
    }

    res.status(201).json({ ...session, entryCount: products.length });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/counts
 * List all count sessions for the restaurant, newest first.
 * Optional query params: ?status=OPEN|CLOSED  ?department=KITCHEN|BAR|FOH|ALL
 */
export async function listSessions(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { status, department } = req.query;

    const sessions = await sessionModel.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(status     ? { status:     String(status)     } : {}),
        ...(department ? { department: String(department) } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        _count:   { select: { entries: true } },
        entries:  { select: { varianceValue: true } },
      },
    });

    // Flatten: pull entriesCount + totalVarianceValue up, drop raw arrays
    const result = sessions.map((s: any) => {
      const { entries, _count, ...rest } = s;
      return {
        ...rest,
        entriesCount:       _count.entries,
        totalVarianceValue: round2(
          entries.reduce((sum: number, e: any) => sum + num(e.varianceValue), 0)
        ),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/counts/:id
 * Get a single session with all its entries and product details.
 */
export async function getSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await sessionModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
      include: {
        entries: {
          include: {
            product: {
              select: {
                id: true, name: true, sku: true, category: true,
                purveyor: true, department: true, unit: true, costPerUnit: true,
              },
            },
          },
          orderBy: { product: { name: "asc" } },
        },
      },
    });

    res.json(session);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/counts/:id/entries
 * Bulk-upsert actual quantities for entries in an OPEN session.
 * Computes variance and varianceValue on each upsert.
 */
export async function bulkUpsertEntries(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await sessionModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });

    if (session.status !== "OPEN") {
      return res.status(422).json({ error: "Cannot edit a closed count session." });
    }

    const { entries } = bulkUpsertEntriesSchema.parse(req.body);

    // Fetch existing entries for this session to get expectedQuantity and unitCost
    const existing: any[] = await entryModel.findMany({
      where: { sessionId: session.id },
    });
    const existingMap = new Map(existing.map((e: any) => [e.productId, e]));

    const results = await Promise.all(
      entries.map(async ({ productId, actualQuantity, notes }) => {
        const ex = existingMap.get(productId);
        const expectedQuantity = ex ? num(ex.expectedQuantity) : 0;
        const unitCost         = ex ? num(ex.unitCost)         : 0;
        const variance         = actualQuantity - expectedQuantity;
        const varianceValue    = variance * unitCost;

        return entryModel.upsert({
          where: {
            sessionId_productId: { sessionId: session.id, productId },
          },
          update: {
            actualQuantity,
            variance,
            varianceValue,
            ...(notes !== undefined ? { notes } : {}),
          },
          create: {
            sessionId:        session.id,
            productId,
            expectedQuantity,
            actualQuantity,
            variance,
            unitCost,
            varianceValue,
            notes: notes ?? null,
          },
        });
      })
    );

    // Touch updatedAt on the session
    await sessionModel.update({
      where: { id: session.id },
      data:  { updatedAt: new Date() },
    });

    res.json({ updated: results.length, entries: results });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/counts/:id/close
 * Finalize all variances and lock the session.
 * Recomputes variance for every entry using their stored actualQuantity,
 * then sets status = CLOSED.
 */
export async function closeSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await sessionModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
      include: { entries: true },
    });

    if (session.status !== "OPEN") {
      return res.status(422).json({ error: "Session is already closed." });
    }

    // Recompute all variances before closing (handles any entries that were
    // never explicitly updated via the bulk-upsert endpoint)
    await Promise.all(
      session.entries.map((e: any) => {
        const expected      = num(e.expectedQuantity);
        const actual        = num(e.actualQuantity);
        const unitCost      = num(e.unitCost);
        const variance      = actual - expected;
        const varianceValue = variance * unitCost;
        return entryModel.update({
          where: { id: e.id },
          data:  { variance, varianceValue },
        });
      })
    );

    const closed = await sessionModel.update({
      where: { id: session.id },
      data:  { status: "CLOSED", updatedAt: new Date() },
    });

    res.json(closed);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/counts/:id/report
 * Full variance report: entry-level detail + totals by category, by department.
 */
export async function getReport(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await sessionModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
      include: {
        entries: {
          include: {
            product: {
              select: {
                id: true, name: true, sku: true, category: true,
                purveyor: true, department: true, unit: true, costPerUnit: true,
              },
            },
          },
          orderBy: { product: { name: "asc" } },
        },
      },
    });

    const entries: any[] = session.entries;

    // ── Totals ────────────────────────────────────────────────────────────────
    let totalExpectedQty   = 0;
    let totalActualQty     = 0;
    let totalExpectedValue = 0;   // sum of (expectedQty × unitCost)
    let totalActualValue   = 0;   // sum of (actualQty   × unitCost)
    let totalVariance      = 0;
    let totalVarianceValue = 0;
    let overCount          = 0;
    let underCount         = 0;
    let exactCount         = 0;

    const byCategory: Record<string, {
      category: string;
      entryCount: number;
      expectedValue: number;
      actualValue: number;
      variance: number;
      varianceValue: number;
    }> = {};

    const byDepartment: Record<string, {
      department: string;
      entryCount: number;
      variance: number;
      varianceValue: number;
    }> = {};

    for (const e of entries) {
      const variance      = num(e.variance);
      const varianceValue = num(e.varianceValue);
      const expected      = num(e.expectedQuantity);
      const actual        = num(e.actualQuantity);
      const unitCost      = num(e.unitCost);

      totalExpectedQty   += expected;
      totalActualQty     += actual;
      totalExpectedValue += expected * unitCost;
      totalActualValue   += actual   * unitCost;
      totalVariance      += variance;
      totalVarianceValue += varianceValue;

      if      (variance > 0) overCount++;
      else if (variance < 0) underCount++;
      else                   exactCount++;

      // By category
      const cat = e.product?.category ?? "Uncategorized";
      if (!byCategory[cat]) byCategory[cat] = { category: cat, entryCount: 0, expectedValue: 0, actualValue: 0, variance: 0, varianceValue: 0 };
      byCategory[cat].entryCount++;
      byCategory[cat].expectedValue += expected * unitCost;
      byCategory[cat].actualValue   += actual   * unitCost;
      byCategory[cat].variance      += variance;
      byCategory[cat].varianceValue += varianceValue;

      // By department
      const dept = String(e.product?.department ?? "UNKNOWN");
      if (!byDepartment[dept]) byDepartment[dept] = { department: dept, entryCount: 0, variance: 0, varianceValue: 0 };
      byDepartment[dept].entryCount++;
      byDepartment[dept].variance      += variance;
      byDepartment[dept].varianceValue += varianceValue;
    }

    const variancePct = totalExpectedValue > 0
      ? round2((totalVarianceValue / totalExpectedValue) * 100)
      : 0;

    res.json({
      session: {
        id:         session.id,
        date:       session.date,
        department: session.department,
        status:     session.status,
        createdAt:  session.createdAt,
      },
      summary: {
        totalEntries:       entries.length,
        totalExpectedQty:   round2(totalExpectedQty),
        totalActualQty:     round2(totalActualQty),
        totalExpectedValue: round2(totalExpectedValue),
        totalActualValue:   round2(totalActualValue),
        totalVariance:      round2(totalVariance),
        totalVarianceValue: round2(totalVarianceValue),
        variancePct,
        overCount,
        underCount,
        exactCount,
      },
      byCategory:   Object.values(byCategory).map(r => ({
        ...r,
        expectedValue: round2(r.expectedValue),
        actualValue:   round2(r.actualValue),
        variance:      round2(r.variance),
        varianceValue: round2(r.varianceValue),
        variancePct:   r.expectedValue > 0 ? round2((r.varianceValue / r.expectedValue) * 100) : 0,
      })).sort((a, b) => a.varianceValue - b.varianceValue),
      byDepartment: Object.values(byDepartment).map(r => ({
        ...r,
        variance:      round2(r.variance),
        varianceValue: round2(r.varianceValue),
      })),
      entries: entries.map((e) => ({
        id:               e.id,
        productId:        e.productId,
        productName:      e.product?.name,
        sku:              e.product?.sku,
        category:         e.product?.category,
        purveyor:         e.product?.purveyor,
        department:       e.product?.department,
        unit:             e.product?.unit,
        expectedQuantity: round3(num(e.expectedQuantity)),
        actualQuantity:   round3(num(e.actualQuantity)),
        variance:         round3(num(e.variance)),
        unitCost:         round2(num(e.unitCost)),
        varianceValue:    round2(num(e.varianceValue)),
        notes:            e.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
