import { Response, NextFunction } from "express";
import { z } from "zod";
import { prismaT as prisma } from "../lib/prisma";

// LaborEntry is not in the generated Prisma client until prisma generate runs.
// Use (prisma as any).laborEntry to work around the lag.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const laborModel = (prisma as any).laborEntry as {
  create: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown | null>;
  delete: (args: unknown) => Promise<unknown>;
};
import { AuthRequest } from "../types";
import { invalidateLaborCaches } from "../lib/cacheInvalidation";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

function toUTCDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ── Schemas ───────────────────────────────────────────────────────────────────

export const createLaborSchema = z.object({
  date: dateSchema,
  fohLabor: z.number({ invalid_type_error: "FOH Labor must be a number" }).nonnegative().default(0),
  bohLabor: z.number({ invalid_type_error: "BOH Labor must be a number" }).nonnegative().default(0),
  management: z.number({ invalid_type_error: "Management must be a number" }).nonnegative().default(0),
});

// ── POST /api/labor ───────────────────────────────────────────────────────────

export async function createLabor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { date, fohLabor, bohLabor, management } = req.body as z.infer<typeof createLaborSchema>;
    const total = fohLabor + bohLabor + management;

    const entry = await laborModel.create({
      data: {
        restaurantId: req.user.restaurantId,
        date: toUTCDay(date),
        fohLabor,
        bohLabor,
        management,
        total,
      },
    });

    // Invalidate dashboard and P&L caches for this restaurant (fire-and-forget).
    void invalidateLaborCaches(req.user.restaurantId ?? "");

    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
}

// ── GET /api/labor?startDate=&endDate= ────────────────────────────────────────

export async function listLabor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const startStr = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endStr = typeof req.query.endDate === "string" ? req.query.endDate : undefined;

    if (startStr && !dateSchema.safeParse(startStr).success) {
      return res.status(400).json({ error: "Invalid startDate — use YYYY-MM-DD" });
    }
    if (endStr && !dateSchema.safeParse(endStr).success) {
      return res.status(400).json({ error: "Invalid endDate — use YYYY-MM-DD" });
    }

    const rawTake = parseInt(String(req.query.take ?? "500"), 10);
    const take    = Math.min(Number.isFinite(rawTake) && rawTake > 0 ? rawTake : 500, 1000);
    const rawSkip = parseInt(String(req.query.skip ?? "0"),  10);
    const skip    = Number.isFinite(rawSkip) && rawSkip >= 0 ? rawSkip : 0;

    const entries = await laborModel.findMany({
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
      },
      orderBy: { date: "desc" },
      take,
      skip,
    });

    res.json(entries);
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/labor/:id ─────────────────────────────────────────────────────

export async function deleteLabor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const entry = await laborModel.findFirst({
      where: { id, restaurantId: req.user.restaurantId },
    });
    if (!entry) return res.status(404).json({ error: "Labor entry not found" });

    await laborModel.delete({ where: { id } });

    // Invalidate dashboard and P&L caches for this restaurant (fire-and-forget).
    void invalidateLaborCaches(req.user.restaurantId ?? "");

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
