import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// Use z.enum for Department and Unit so the schemas compile regardless of
// whether prisma generate has been run yet (the Prisma client enum may lag behind
// schema.prisma until after db push + generate).
const DepartmentEnum = z.enum(["BOH", "FOH", "BAR", "BOTH"]);
const UnitEnum       = z.enum(["KG", "LITERS", "PIECES", "LB", "OZ", "G", "EA", "DOZ", "CS"]);

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
    purveyor: z.string().max(255).trim().optional(),
    invoiceDate: z.string().optional().nullable(),   // ISO date string "YYYY-MM-DD"
    department: DepartmentEnum.default("BOH"),
    unit: UnitEnum.default("PIECES"),
    costPerUnit: z.number({ invalid_type_error: "Cost must be a number" })
      .positive("Cost must be greater than 0"),
    currentStock: z.number({ invalid_type_error: "Stock must be a number" })
      .nonnegative("Stock cannot be negative")
      .default(0),
    minimumStock: z.number({ invalid_type_error: "Minimum stock must be a number" })
      .nonnegative("Minimum stock cannot be negative")
      .default(0),
    cogsCategoryId: z.string().cuid().optional().nullable(),
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
  purveyor: z.string().max(255).trim().optional(),
  invoiceDate: z.string().optional().nullable(),
  department: DepartmentEnum.optional(),
  unit: UnitEnum.optional(),
  costPerUnit:    z.number().positive("Cost must be greater than 0").optional(),
  currentStock:   z.number().nonnegative("Stock cannot be negative").optional(),
  minimumStock:   z.number().nonnegative("Minimum stock cannot be negative").optional(),
  cogsCategoryId: z.string().cuid().optional().nullable(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates that a cogsCategoryId belongs to the owner of the given restaurant.
 * Returns an error response and resolves to false if invalid; true if valid or absent.
 */
async function validateCogsCategoryOwnership(
  res: Response,
  cogsCategoryId: string | null | undefined,
  restaurantId: string,
): Promise<boolean> {
  if (!cogsCategoryId) return true;
  const category = await prisma.cogsCategory.findFirst({
    where: {
      id: cogsCategoryId,
      ownerAccount: { restaurants: { some: { id: restaurantId } } },
    },
    select: { id: true },
  });
  if (!category) {
    res.status(400).json({ error: "COGS category not found or not owned by your account" });
    return false;
  }
  return true;
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /products/search?name=<term>
 * Case-insensitive substring match, scoped to the caller's restaurant.
 * Returns { matches[], exactMatch, hasMultipleMatches, hasNoMatch }
 */
export async function searchProducts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const raw = req.query.name;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({ error: "Query param 'name' is required" });
    }
    const products = await prisma.product.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        name: { contains: raw.trim(), mode: "insensitive" },
      },
      include: { cogsCategory: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
      take: 10,
    });
    res.json({
      matches:            products,
      exactMatch:         products.length === 1 ? products[0] : null,
      hasMultipleMatches: products.length > 1,
      hasNoMatch:         products.length === 0,
    });
  } catch (err) {
    next(err);
  }
}

export async function listProducts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { category } = req.query;
    // Safety cap: typical restaurant has <500 products. Cap at 2000 to allow
    // full catalogue loads while blocking pathological queries.
    const rawTake = parseInt(String(req.query.take ?? "2000"), 10);
    const take    = Math.min(Number.isFinite(rawTake) && rawTake > 0 ? rawTake : 2000, 2000);
    const rawSkip = parseInt(String(req.query.skip ?? "0"), 10);
    const skip    = Number.isFinite(rawSkip) && rawSkip >= 0 ? rawSkip : 0;

    const products = await prisma.product.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(category ? { category: String(category) } : {}),
      },
      include: { cogsCategory: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
      take,
      skip,
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
}

export async function getProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const product = await prisma.product.findFirst({
      where:   { id: req.params.id, restaurantId: req.user.restaurantId },
      include: { cogsCategory: { select: { id: true, name: true } } },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    next(err);
  }
}

export async function createProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { department, invoiceDate, cogsCategoryId, ...rest } = req.body;
    const restaurantId = req.user.restaurantId!;

    if (!await validateCogsCategoryOwnership(res, cogsCategoryId, restaurantId)) return;

    const product = await prisma.product.create({
      data: {
        ...rest,
        restaurantId,
        invoiceDate:    invoiceDate    ? new Date(invoiceDate).toISOString() : undefined,
        cogsCategoryId: cogsCategoryId ?? null,
        ...(department !== undefined ? { department: department as never } : {}),
      },
      include: { cogsCategory: { select: { id: true, name: true } } },
    });
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
}

export async function updateProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId!;
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, restaurantId },
    });
    if (!existing) return res.status(404).json({ error: "Product not found" });

    // Merge patch values with existing so the cross-field constraint makes sense.
    const merged = { ...existing, ...req.body };
    if (merged.minimumStock > merged.currentStock) {
      return res.status(422).json({
        error: "Validation failed",
        issues: { minimumStock: ["Minimum stock cannot exceed current stock"] },
      });
    }

    const { department, invoiceDate, cogsCategoryId, ...restBody } = req.body;

    if (!await validateCogsCategoryOwnership(res, cogsCategoryId, restaurantId)) return;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...restBody,
        invoiceDate:    invoiceDate !== undefined
          ? (invoiceDate ? new Date(invoiceDate).toISOString() : null)
          : undefined,
        // undefined = don't touch; null = explicitly clear; string = set new value
        ...(cogsCategoryId !== undefined ? { cogsCategoryId: cogsCategoryId ?? null } : {}),
        ...(department !== undefined ? { department: department as never } : {}),
      },
      include: { cogsCategory: { select: { id: true, name: true } } },
    });
    res.json(product);
  } catch (err) {
    next(err);
  }
}

export async function deleteProduct(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // requireAdmin middleware already guards this route.
    const existing = await prisma.product.findFirst({
      where:  { id: req.params.id, restaurantId: req.user.restaurantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Product not found" });
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
