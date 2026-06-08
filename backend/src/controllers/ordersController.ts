import { Response, NextFunction } from "express";
import { z } from "zod";
import { OrderStatus, StockReason } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { weightedAverageCost } from "../lib/costing";
import { AuthRequest } from "../types";
import { invalidateFinancialCaches } from "../lib/cacheInvalidation";

// ── Schemas ───────────────────────────────────────────────────────────────────

const invoiceItemSchema = z.object({
  productName:    z.string().min(1, "Product name is required"),
  sku:            z.string().optional(),
  category:       z.string().optional(),
  unit:           z.string().optional(),
  quantity:       z.number().positive(),
  unitCost:       z.number().nonnegative("Unit cost cannot be negative"),
  productId:      z.string().cuid().optional(),        // optional link to product catalogue
  cogsCategoryId: z.string().cuid().optional().nullable(), // optional COGS bucket
});

export const createOrderSchema = z.object({
  purveyor:      z.string().optional(),
  invoiceDate:   z.string().optional(), // ISO date string, e.g. "2025-05-24"
  invoiceNumber: z.string().optional(),
  department:    z.string().optional(), // "KITCHEN" | "FOH" | "BAR" | undefined (all)
  items:         z.array(invoiceItemSchema).min(1, "Invoice must have at least one item"),
});

export const updateOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function createOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { purveyor, invoiceDate, invoiceNumber, department, items } =
      req.body as z.infer<typeof createOrderSchema>;
    const restaurantId = req.user.restaurantId ?? "";

    // Verify referenced products belong to this restaurant.
    const referencedProductIds = items.flatMap((i) => (i.productId ? [i.productId] : []));
    if (referencedProductIds.length > 0) {
      const found = await prisma.product.findMany({
        where: { id: { in: referencedProductIds }, restaurantId },
        select: { id: true },
      });
      if (found.length !== referencedProductIds.length) {
        return res.status(400).json({ error: "One or more products not found in this restaurant" });
      }
    }

    // Validate each unique cogsCategoryId: must exist and belong to the owner of this restaurant.
    const uniqueCogsCategoryIds = [
      ...new Set(items.flatMap((i) => (i.cogsCategoryId ? [i.cogsCategoryId] : []))),
    ];
    if (uniqueCogsCategoryIds.length > 0) {
      // One query fetches all valid IDs: category exists AND its ownerAccount has this restaurant.
      const validCategories = await prisma.cogsCategory.findMany({
        where: {
          id:           { in: uniqueCogsCategoryIds },
          ownerAccount: { restaurants: { some: { id: restaurantId } } },
        },
        select: { id: true },
      });
      const validIdSet = new Set(validCategories.map((c) => c.id));

      for (const categoryId of uniqueCogsCategoryIds) {
        if (!validIdSet.has(categoryId)) {
          // The ID was not found at all, or it belongs to a different owner.
          return res.status(400).json({
            error: "COGS category not found or not owned by your account",
          });
        }
      }
    }

    const totalCost = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

    const order = await prisma.order.create({
      data: {
        restaurantId,
        totalCost:     Math.round(totalCost * 100) / 100,
        purveyor:      purveyor     ?? null,
        invoiceDate:   invoiceDate  ? new Date(invoiceDate) : null,
        invoiceNumber: invoiceNumber ?? null,
        department:    department   ?? null,
        orderItems: {
          create: items.map((i) => ({
            productId:      i.productId      ?? null,
            productName:    i.productName,
            sku:            i.sku            ?? null,
            category:       i.category       ?? null,
            unit:           i.unit           ?? null,
            quantity:       i.quantity,
            unitCost:       i.unitCost,
            cogsCategoryId: i.cogsCategoryId ?? null,
          })),
        },
      },
      include: { orderItems: { include: { product: true, cogsCategory: true } } },
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/orders[?status=&cursor=<id>&limit=<n>]
 *
 * Cursor-based pagination — ordered createdAt DESC.
 *
 * Without pagination params → Order[]  (backward-compatible array)
 * With cursor or limit      → { data: Order[], nextCursor: string|null, hasMore: boolean }
 *
 * Default page size: 50, max: 100.
 */
export async function listOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, cursor, limit: limitRaw } = req.query;
    const isPaginated = cursor !== undefined || limitRaw !== undefined;
    const limit       = Math.min(Math.max(parseInt(String(limitRaw ?? "50"), 10) || 50, 1), 100);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(status ? { status: status as OrderStatus } : {}),
      },
      include: { orderItems: { include: { product: true, cogsCategory: true } } },
      orderBy: { createdAt: "desc" },
      take:    limit + 1,
      ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    });

    if (!isPaginated) {
      res.json(orders.slice(0, limit));
      return;
    }

    const hasMore    = orders.length > limit;
    const data       = hasMore ? orders.slice(0, limit) : orders;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    res.json({ data, nextCursor, hasMore });
  } catch (err) {
    next(err);
  }
}

export async function updateOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.order.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: req.body,
      include: { orderItems: { include: { product: true, cogsCategory: true } } },
    });
    res.json(order);
  } catch (err) {
    next(err);
  }
}

export async function receiveOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const order = await prisma.order.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
      include: { orderItems: { include: { product: true, cogsCategory: true } } },
    });

    if (order.status !== "PENDING") {
      return res.status(400).json({ error: `Order is already ${order.status.toLowerCase()}` });
    }

    const linkedItems   = order.orderItems.filter((item) => item.productId && item.product);
    const unlinkedItems = order.orderItems.filter((item) => !item.productId);

    const updated = await prisma.$transaction(async (tx) => {
      for (const item of linkedItems) {
        const product = item.product!;

        // Snapshot existing cost, then compute new weighted average — both use
        // pre-receipt stock so we read product state captured before this loop.
        const newCostPerUnit = weightedAverageCost(
          product.currentStock,
          product.costPerUnit,
          item.quantity,
          item.unitCost,
        );

        await tx.stockLog.create({
          data: {
            productId:        item.productId!,
            previousQuantity: product.currentStock,
            newQuantity:      product.currentStock + item.quantity,
            change:           item.quantity,
            reason:           StockReason.RECEIVED,
            unitCost:         product.costPerUnit, // snapshot BEFORE cost update
            userId:           req.user.userId,
            notes:            `Invoice ${order.invoiceNumber ?? order.id} received`,
          },
        });

        await tx.product.update({
          where: { id: item.productId! },
          data:  { costPerUnit: newCostPerUnit, currentStock: { increment: item.quantity } },
        });
      }

      return tx.order.update({
        where:   { id: order.id },
        data:    { status: OrderStatus.RECEIVED, deliveredAt: new Date() },
        include: { orderItems: { include: { product: true, cogsCategory: true } } },
      });
    });

    // Receiving an order updates stock and COGS — invalidate all financial caches
    // for this restaurant (fire-and-forget).
    void invalidateFinancialCaches(req.user.restaurantId ?? "");

    res.json({
      ...updated,
      metadata: {
        linkedItemsProcessed: linkedItems.length,
        skippedItems: unlinkedItems.map((item) => ({
          productName: item.productName,
          quantity:    item.quantity,
          unitCost:    item.unitCost,
          reason:      "No product linked — cost not updated",
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}
