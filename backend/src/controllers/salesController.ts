import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// Decoupled from Prisma client so new values work before prisma generate runs.
const SALES_CATEGORIES = ["BEER", "LIQUOR", "WINE", "FOOD", "NON_ALCOHOLIC", "EVENTS", "DELIVERY", "BUYOUTS"] as const;
type SalesCategoryLiteral = (typeof SALES_CATEGORIES)[number];

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

function toUTCDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ── Schemas ───────────────────────────────────────────────────────────────────

export const createSaleSchema = z.object({
  date: dateSchema,
  category: z.enum(SALES_CATEGORIES, { errorMap: () => ({ message: "Invalid category" }) }),
  // Accept number from JSON; Prisma will coerce to Decimal(10,2)
  amount: z
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be positive")
    .multipleOf(0.01, "Amount must have at most 2 decimal places"),
  notes: z.string().max(500).optional(),
});

// ── POST /api/sales ───────────────────────────────────────────────────────────

export async function createSale(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { date, category, amount, notes } = req.body as z.infer<typeof createSaleSchema>;

    const entry = await prisma.salesEntry.create({
      data: {
        restaurantId: req.user.restaurantId,
        date: toUTCDay(date),
        category: category as never, // cast: Prisma client lags schema until prisma generate
        amount,
        notes,
      },
    });

    // Serialize Decimal → number for JSON
    res.status(201).json({ ...entry, amount: Number(entry.amount) });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/sales/:id ─────────────────────────────────────────────────────

export async function deleteSale(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    // Verify the entry belongs to this restaurant before deleting (tenant isolation).
    const entry = await prisma.salesEntry.findFirst({
      where: { id, restaurantId: req.user.restaurantId },
    });
    if (!entry) return res.status(404).json({ error: "Sales entry not found" });

    await prisma.salesEntry.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ── GET /api/sales?startDate=&endDate=&category= ──────────────────────────────

export async function listSales(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const startStr = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endStr = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    const categoryStr = typeof req.query.category === "string" ? req.query.category : undefined;

    if (startStr && !dateSchema.safeParse(startStr).success) {
      return res.status(400).json({ error: "Invalid startDate — use YYYY-MM-DD" });
    }
    if (endStr && !dateSchema.safeParse(endStr).success) {
      return res.status(400).json({ error: "Invalid endDate — use YYYY-MM-DD" });
    }
    if (categoryStr && !(SALES_CATEGORIES as readonly string[]).includes(categoryStr)) {
      return res.status(400).json({
        error: `Invalid category. Valid values: ${SALES_CATEGORIES.join(", ")}`,
      });
    }

    const entries = await prisma.salesEntry.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(startStr || endStr
          ? {
              date: {
                ...(startStr ? { gte: toUTCDay(startStr) } : {}),
                ...(endStr ? { lte: toUTCDay(endStr) } : {}),
              },
            }
          : {}),
        ...(categoryStr ? { category: categoryStr as never } : {}),
      },
      orderBy: { date: "desc" },
    });

    // Serialize Decimal fields
    res.json(entries.map((e) => ({ ...e, amount: Number(e.amount) })));
  } catch (err) {
    next(err);
  }
}
