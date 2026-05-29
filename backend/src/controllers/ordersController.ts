import { Response, NextFunction } from "express";
import { z } from "zod";
import { OrderStatus, StockReason } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Schemas ───────────────────────────────────────────────────────────────────

const invoiceItemSchema = z.object({
  productName: z.string().min(1, "Product name is required"),
  sku:         z.string().optional(),
  category:    z.string().optional(),
  unit:        z.string().optional(),
  quantity:    z.number().positive(),
  unitCost:    z.number().nonnegative(),
  productId:   z.string().cuid().optional(), // optional link to product catalogue
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

    // If any items reference a productId, verify they belong to this restaurant.
    const referencedProductIds = items.flatMap((i) => (i.productId ? [i.productId] : []));
    if (referencedProductIds.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: referencedProductIds }, restaurantId },
        select: { id: true },
      });
      if (products.length !== referencedProductIds.length) {
        return res.status(400).json({ error: "One or more products not found in this restaurant" });
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
            productId:   i.productId   ?? null,
            productName: i.productName,
            sku:         i.sku         ?? null,
            category:    i.category    ?? null,
            unit:        i.unit        ?? null,
            quantity:    i.quantity,
            unitCost:    i.unitCost,
          })),
        },
      },
      include: { orderItems: { include: { product: true } } },
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
}

export async function listOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = req.query;
    const orders = await prisma.order.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(status ? { status: status as OrderStatus } : {}),
      },
      include: { orderItems: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders);
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
      include: { orderItems: { include: { product: true } } },
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
      include: { orderItems: { include: { product: true } } },
    });

    if (order.status !== "PENDING") {
      return res.status(400).json({ error: `Order is already ${order.status.toLowerCase()}` });
    }

    // Only items linked to a product catalogue entry get their stock updated.
    const linkedItems = order.orderItems.filter((item) => item.productId && item.product);

    const stockLogCreates = linkedItems.map((item) =>
      prisma.stockLog.create({
        data: {
          productId:        item.productId!,
          previousQuantity: item.product!.currentStock,
          newQuantity:      item.product!.currentStock + item.quantity,
          change:           item.quantity,
          reason:           StockReason.RECEIVED,
          userId:           req.user.userId,
          notes:            `Invoice ${order.id} received`,
        },
      })
    );

    const productUpdates = linkedItems.map((item) =>
      prisma.product.update({
        where: { id: item.productId! },
        data:  { currentStock: { increment: item.quantity } },
      })
    );

    const orderUpdate = prisma.order.update({
      where: { id: order.id },
      data:  { status: OrderStatus.RECEIVED, deliveredAt: new Date() },
      include: { orderItems: { include: { product: true } } },
    });

    const results = await prisma.$transaction([
      ...stockLogCreates,
      ...productUpdates,
      orderUpdate,
    ]);

    res.json(results[results.length - 1]);
  } catch (err) {
    next(err);
  }
}
