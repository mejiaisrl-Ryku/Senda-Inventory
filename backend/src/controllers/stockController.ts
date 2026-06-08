import { Response, NextFunction } from "express";
import { z } from "zod";
import { StockReason } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getIO } from "../lib/socket";
import { AuthRequest } from "../types";
import { invalidateFinancialCaches } from "../lib/cacheInvalidation";

// ADJUSTED is a correction that requires admin judgement.
// RECEIVED / USED / WASTE are normal operational reasons available to all roles.
const ADMIN_ONLY_REASONS: StockReason[] = ["ADJUSTED"];

export const adjustSchema = z.object({
  productId: z.string().cuid("Invalid product ID"),
  change: z.number({ invalid_type_error: "Change must be a number" })
    .refine((n) => n !== 0, "Change cannot be zero"),
  reason: z.nativeEnum(StockReason, { errorMap: () => ({ message: "Invalid reason" }) }),
  notes: z.string().max(500).optional(),
});

export async function adjustStock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { productId, change, reason, notes } = req.body as z.infer<typeof adjustSchema>;

    // Staff may not perform balance adjustments — those require admin.
    if (ADMIN_ONLY_REASONS.includes(reason) && req.user.role !== "ADMIN") {
      return res.status(403).json({
        error: "Only admins can log balance adjustments. Use a different reason.",
      });
    }

    const product = await prisma.product.findFirstOrThrow({
      where: { id: productId, restaurantId: req.user.restaurantId },
    });

    const newQuantity = product.currentStock + change;
    if (newQuantity < 0) {
      return res.status(400).json({
        error: `Adjustment would result in negative stock (${product.currentStock} + ${change} = ${newQuantity})`,
      });
    }

    const [log] = await prisma.$transaction([
      prisma.stockLog.create({
        data: {
          productId,
          previousQuantity: product.currentStock,
          newQuantity,
          change,
          reason,
          unitCost: product.costPerUnit, // snapshot at adjustment time for stable COGS history
          userId: req.user.userId,
          notes,
        },
      }),
      prisma.product.update({
        where: { id: productId },
        data: { currentStock: newQuantity },
      }),
    ]);

    const timestamp = new Date().toISOString();

    // Structured log — every stock change is observable in server logs.
    console.info(
      JSON.stringify({
        event: "stock_adjusted",
        productId,
        productName: product.name,
        previousQuantity: product.currentStock,
        newQuantity,
        change,
        reason,
        userId: req.user.userId,
        restaurantId: req.user.restaurantId,
        timestamp,
      })
    );

    // Broadcast to all connected clients in this restaurant's room.
    getIO()
      .to(`restaurant:${req.user.restaurantId}`)
      .emit("stock:updated", {
        productId,
        newQuantity,
        change,
        reason,
        timestamp,
      });

    // Stock changes affect daily report and COGS-to-sales — invalidate caches
    // (fire-and-forget).
    void invalidateFinancialCaches(req.user.restaurantId ?? "");

    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/stock/logs/:productId[?cursor=<id>&limit=<n>]
 *
 * Cursor-based pagination — always ordered timestamp DESC.
 *
 * Without cursor:  returns the first page (most recent logs).
 * With cursor:     returns the page starting AFTER the log with that id.
 *
 * Response shape:
 *   Without pagination params → StockLog[]  (backward-compatible)
 *   With cursor or limit      → { data: StockLog[], nextCursor: string|null, hasMore: boolean }
 *
 * The default page size is 50; max is 200.
 */
export async function getStockLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.product.findFirstOrThrow({
      where: { id: req.params.productId, restaurantId: req.user.restaurantId },
    });

    const { cursor, limit: limitRaw } = req.query;
    const isPaginated = cursor !== undefined || limitRaw !== undefined;
    const limit       = Math.min(Math.max(parseInt(String(limitRaw ?? "50"), 10) || 50, 1), 200);

    const logs = await prisma.stockLog.findMany({
      where:   { productId: req.params.productId },
      include: { user: { select: { id: true, email: true, role: true } } },
      orderBy: { timestamp: "desc" },
      take:    limit + 1, // fetch one extra to determine hasMore
      ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    });

    if (!isPaginated) {
      // Legacy response — return plain array (no shape change for existing clients).
      res.json(logs.slice(0, limit));
      return;
    }

    const hasMore    = logs.length > limit;
    const data       = hasMore ? logs.slice(0, limit) : logs;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    res.json({ data, nextCursor, hasMore });
  } catch (err) {
    next(err);
  }
}

export async function getLowItems(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const products = await prisma.product.findMany({
      where: { restaurantId: req.user.restaurantId },
      orderBy: { currentStock: "asc" },
    });
    res.json(products.filter((p) => p.currentStock < p.minimumStock));
  } catch (err) {
    next(err);
  }
}

export async function getStockReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const products = await prisma.product.findMany({
      where: { restaurantId: req.user.restaurantId },
    });

    const totalValue = products.reduce(
      (sum, p) => sum + p.currentStock * p.costPerUnit,
      0
    );
    const belowMinimum = products.filter((p) => p.currentStock < p.minimumStock);

    const byCategory = products.reduce<Record<string, { count: number; value: number }>>(
      (acc, p) => {
        const key = p.category ?? "Uncategorized";
        if (!acc[key]) acc[key] = { count: 0, value: 0 };
        acc[key].count += 1;
        acc[key].value += p.currentStock * p.costPerUnit;
        return acc;
      },
      {}
    );

    res.json({
      totalProducts: products.length,
      totalValue: Math.round(totalValue * 100) / 100,
      belowMinimumCount: belowMinimum.length,
      belowMinimum,
      byCategory,
    });
  } catch (err) {
    next(err);
  }
}
