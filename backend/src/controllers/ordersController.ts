import { Response, NextFunction } from "express";
import { z } from "zod";
import { OrderStatus, StockReason } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

const orderItemSchema = z.object({
  productId: z.string().cuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Order must have at least one item"),
});

export const updateOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
});

export async function createOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { items } = req.body as z.infer<typeof createOrderSchema>;
    const restaurantId = req.user.restaurantId;

    // Verify all products belong to this restaurant.
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, restaurantId },
    });
    if (products.length !== productIds.length) {
      return res.status(400).json({ error: "One or more products not found in this restaurant" });
    }

    const totalCost = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

    const order = await prisma.order.create({
      data: {
        restaurantId,
        totalCost: Math.round(totalCost * 100) / 100,
        orderItems: {
          create: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitCost: i.unitCost,
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

    // Build all DB operations for the transaction.
    const stockLogCreates = order.orderItems.map((item) =>
      prisma.stockLog.create({
        data: {
          productId: item.productId,
          previousQuantity: item.product.currentStock,
          newQuantity: item.product.currentStock + item.quantity,
          change: item.quantity,
          reason: StockReason.RECEIVED,
          userId: req.user.userId,
          notes: `Order ${order.id} received`,
        },
      })
    );

    const productUpdates = order.orderItems.map((item) =>
      prisma.product.update({
        where: { id: item.productId },
        data: { currentStock: { increment: item.quantity } },
      })
    );

    const orderUpdate = prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.RECEIVED, deliveredAt: new Date() },
      include: { orderItems: { include: { product: true } } },
    });

    const results = await prisma.$transaction([
      ...stockLogCreates,
      ...productUpdates,
      orderUpdate,
    ]);

    // Last item in the transaction is the updated order.
    res.json(results[results.length - 1]);
  } catch (err) {
    next(err);
  }
}
