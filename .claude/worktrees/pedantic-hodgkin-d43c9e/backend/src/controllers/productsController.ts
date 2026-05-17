import { Response, NextFunction } from "express";
import { z } from "zod";
import { Unit } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Schemas ───────────────────────────────────────────────────────────────────

export const createProductSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(255, "Name must be 255 characters or less")
      .trim(),
    sku: z.string().max(100).trim().optional(),
    category: z.string().max(100).trim().optional(),
    unit: z.nativeEnum(Unit).default("PIECES"),
    costPerUnit: z.number({ invalid_type_error: "Cost must be a number" })
      .positive("Cost must be greater than 0"),
    currentStock: z.number({ invalid_type_error: "Stock must be a number" })
      .nonnegative("Stock cannot be negative")
      .default(0),
    minimumStock: z.number({ invalid_type_error: "Minimum stock must be a number" })
      .nonnegative("Minimum stock cannot be negative")
      .default(0),
  })
  .refine(
    (d) => d.minimumStock <= d.currentStock,
    { message: "Minimum stock cannot exceed current stock", path: ["minimumStock"] }
  );

// Partial update — cross-field check applied in the controller after merging
// existing values so partial patches don't falsely fail the refine.
export const updateProductSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  sku: z.string().max(100).trim().optional(),
  category: z.string().max(100).trim().optional(),
  unit: z.nativeEnum(Unit).optional(),
  costPerUnit: z.number().positive("Cost must be greater than 0").optional(),
  currentStock: z.number().nonnegative("Stock cannot be negative").optional(),
  minimumStock: z.number().nonnegative("Minimum stock cannot be negative").optional(),
});

// ── Controllers ───────────────────────────────────────────────────────────────

export async function listProducts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { category } = req.query;
    const products = await prisma.product.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(category ? { category: String(category) } : {}),
      },
      orderBy: { name: "asc" },
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
}

export async function getProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const product = await prisma.product.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });
    res.json(product);
  } catch (err) {
    next(err);
  }
}

export async function createProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const product = await prisma.product.create({
      data: { ...req.body, restaurantId: req.user.restaurantId },
    });
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
}

export async function updateProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.product.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });

    // Merge patch values with existing so the cross-field constraint makes sense.
    const merged = { ...existing, ...req.body };
    if (merged.minimumStock > merged.currentStock) {
      return res.status(422).json({
        error: "Validation failed",
        issues: { minimumStock: ["Minimum stock cannot exceed current stock"] },
      });
    }

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(product);
  } catch (err) {
    next(err);
  }
}

export async function deleteProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // requireAdmin middleware already guards this route.
    await prisma.product.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
