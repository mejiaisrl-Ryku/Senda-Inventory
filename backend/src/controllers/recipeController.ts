import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

// ── Proxy models (Prisma client not yet regenerated) ──────────────────────────
const recipeModel      = (prisma as any).recipe           as any;
const ingredientModel  = (prisma as any).recipeIngredient as any;

// ── Schemas ───────────────────────────────────────────────────────────────────
const RecipeDeptEnum = z.enum(["KITCHEN", "BAR"]);

const ingredientSchema = z.object({
  productId:        z.string().min(1),
  quantity:         z.number().positive("Quantity must be positive"),
  unit:             z.string().min(1),
  conversionFactor: z.number().positive().nullable().optional(),
});

export const upsertRecipeSchema = z.object({
  name:         z.string().min(1, "Name is required").max(255),
  department:   RecipeDeptEnum,
  sellingPrice: z.number().positive("Selling price must be positive"),
  ingredients:  z.array(ingredientSchema).min(1, "At least one ingredient is required"),
});

// ── Unit conversion helpers ───────────────────────────────────────────────────

/**
 * Normalize unit aliases so G/KG/OZ/LB/ML/L comparisons work regardless of
 * whether the source is a Product unit (PIECES, LITERS) or a recipe unit (PCS, L).
 */
function canonUnit(u: string): string {
  const aliases: Record<string, string> = { PIECES: "PCS", LITERS: "L" };
  return aliases[u] ?? u;
}

/**
 * Returns "recipe units per 1 purchase unit" for pairs we can auto-convert.
 * Returns null when the user must supply a manual conversionFactor.
 *
 * Auto-convertible pairs:
 *   G  ↔ KG    : 1000 G / KG
 *   OZ ↔ LB    : 16 OZ / LB
 *   ML ↔ L     : 1000 ML / L
 *   identical  : 1
 */
export function getAutoFactor(recipeUnit: string, purchaseUnit: string): number | null {
  const r = canonUnit(recipeUnit);
  const p = canonUnit(purchaseUnit);
  if (r === p) return 1;
  const table: Record<string, Record<string, number>> = {
    G:  { KG: 1000 },
    KG: { G: 0.001 },
    OZ: { LB: 16   },
    LB: { OZ: 0.0625 },
    ML: { L: 1000  },
    L:  { ML: 0.001 },
  };
  return table[r]?.[p] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function num(v: unknown): number {
  return typeof v === "object" ? parseFloat(String(v)) : Number(v);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Compute recipeCost and costPct from a list of hydrated ingredients. */
function computeCosts(
  ingredients: Array<{
    quantity:         unknown;
    unit:             string;
    conversionFactor: unknown;
    product:          { costPerUnit: unknown; unit: string };
  }>,
  sellingPrice: number
): { recipeCost: number; costPct: number } {
  const recipeCost = round2(
    ingredients.reduce((sum, ing) => {
      const q    = num(ing.quantity);
      const cost = num(ing.product.costPerUnit);

      const autoFactor = getAutoFactor(ing.unit, ing.product.unit);
      if (autoFactor !== null) {
        // Same system: cost = (q / factor) × costPerUnit
        return sum + (q / autoFactor) * cost;
      }

      // Cross-system: use the stored conversionFactor
      const cf = ing.conversionFactor ? num(ing.conversionFactor) : 0;
      if (cf <= 0) return sum; // incomplete — exclude from total
      return sum + (q / cf) * cost;
    }, 0)
  );
  const costPct = sellingPrice > 0 ? round2((recipeCost / sellingPrice) * 100) : 0;
  return { recipeCost, costPct };
}

/** Standard include block for recipe queries. */
const recipeInclude = {
  ingredients: {
    include: {
      product: {
        select: {
          id: true, name: true, unit: true, costPerUnit: true, category: true,
        },
      },
    },
  },
};

/** Serialize a recipe row to the API response shape. */
function serialize(r: any) {
  const sp = num(r.sellingPrice);
  const { recipeCost, costPct } = computeCosts(r.ingredients ?? [], sp);
  return {
    id:           r.id,
    restaurantId: r.restaurantId,
    name:         r.name,
    department:   r.department,
    sellingPrice: round2(sp),
    createdAt:    r.createdAt,
    updatedAt:    r.updatedAt,
    recipeCost,
    costPct,
    ingredients:  (r.ingredients ?? []).map((ing: any) => ({
      id:               ing.id,
      productId:        ing.productId,
      quantity:         num(ing.quantity),
      unit:             ing.unit,
      conversionFactor: ing.conversionFactor ?? null,
      product: {
        id:          ing.product.id,
        name:        ing.product.name,
        unit:        ing.product.unit,
        costPerUnit: round2(num(ing.product.costPerUnit)),
        category:    ing.product.category,
      },
    })),
  };
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /api/recipes
 * List all recipes for the restaurant, optionally filtered by department.
 */
export async function listRecipes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { department } = req.query;
    const rawTake = parseInt(String(req.query.take ?? "500"), 10);
    const take    = Math.min(Number.isFinite(rawTake) && rawTake > 0 ? rawTake : 500, 1000);
    const rawSkip = parseInt(String(req.query.skip ?? "0"), 10);
    const skip    = Number.isFinite(rawSkip) && rawSkip >= 0 ? rawSkip : 0;

    const recipes = await recipeModel.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(department ? { department: String(department) } : {}),
      },
      orderBy: [{ department: "asc" }, { name: "asc" }],
      include: recipeInclude,
      take,
      skip,
    });
    res.json(recipes.map(serialize));
  } catch (err) { next(err); }
}

/**
 * GET /api/recipes/:id
 * Get a single recipe with full ingredient list.
 */
export async function getRecipe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const recipe = await recipeModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
      include: recipeInclude,
    });
    res.json(serialize(recipe));
  } catch (err) { next(err); }
}

/**
 * POST /api/recipes
 * Create a new recipe with ingredients.
 */
export async function createRecipe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = upsertRecipeSchema.parse(req.body);

    const created = await recipeModel.create({
      data: {
        restaurantId: req.user.restaurantId,
        name:         body.name,
        department:   body.department as never,
        sellingPrice: body.sellingPrice,
      },
    });

    await ingredientModel.createMany({
      data: body.ingredients.map((ing) => ({
        recipeId:         created.id,
        productId:        ing.productId,
        quantity:         ing.quantity,
        unit:             ing.unit,
        conversionFactor: ing.conversionFactor ?? null,
      })),
    });

    const recipe = await recipeModel.findFirst({
      where:   { id: created.id },
      include: recipeInclude,
    });

    res.status(201).json(serialize(recipe));
  } catch (err) { next(err); }
}

/**
 * PUT /api/recipes/:id
 * Update a recipe and replace its ingredients.
 */
export async function updateRecipe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await recipeModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });

    const body = upsertRecipeSchema.parse(req.body);

    await recipeModel.update({
      where: { id: req.params.id },
      data:  {
        name:         body.name,
        department:   body.department as never,
        sellingPrice: body.sellingPrice,
      },
    });

    // Full replace
    await ingredientModel.deleteMany({ where: { recipeId: req.params.id } });
    await ingredientModel.createMany({
      data: body.ingredients.map((ing) => ({
        recipeId:         req.params.id,
        productId:        ing.productId,
        quantity:         ing.quantity,
        unit:             ing.unit,
        conversionFactor: ing.conversionFactor ?? null,
      })),
    });

    const recipe = await recipeModel.findFirst({
      where:   { id: req.params.id },
      include: recipeInclude,
    });

    res.json(serialize(recipe));
  } catch (err) { next(err); }
}

/**
 * DELETE /api/recipes/:id
 * Delete a recipe (cascade deletes its ingredients).
 */
export async function deleteRecipe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await recipeModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });
    await recipeModel.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
}

/**
 * POST /api/recipes/copy
 * Copy a recipe from one location to another within the same group.
 * Both source and target must be owned by the authenticated user's group.
 */
export async function copyRecipe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { sourceRecipeId, sourceRestaurantId, targetRestaurantId } = req.body;
    const userRestaurantId = req.user.restaurantId;

    // ── Validation ─────────────────────────────────────────────────────────────
    if (!sourceRecipeId || !sourceRestaurantId || !targetRestaurantId) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (sourceRestaurantId === targetRestaurantId) {
      return res.status(400).json({ error: "Source and target must be different" });
    }

    // ── Authorization: both restaurants must belong to the user's group ─────────
    const [sourceRestaurant, targetRestaurant] = await Promise.all([
      prisma.restaurant.findUnique({ where: { id: sourceRestaurantId }, select: { id: true, ownerAccountId: true } }),
      prisma.restaurant.findUnique({ where: { id: targetRestaurantId }, select: { id: true, ownerAccountId: true } }),
    ]);

    if (!sourceRestaurant) return res.status(404).json({ error: "Source restaurant not found" });
    if (!targetRestaurant) return res.status(404).json({ error: "Target restaurant not found" });

    const ownsSource = sourceRestaurantId === userRestaurantId || (req.user.ownerAccountId && sourceRestaurant.ownerAccountId === req.user.ownerAccountId);
    const ownsTarget = targetRestaurantId === userRestaurantId || (req.user.ownerAccountId && targetRestaurant.ownerAccountId === req.user.ownerAccountId);

    if (!ownsSource) return res.status(403).json({ error: "You don't own the source restaurant" });
    if (!ownsTarget) return res.status(403).json({ error: "You don't own the target restaurant" });

    // ── Fetch source recipe ─────────────────────────────────────────────────────
    const sourceRecipe = await recipeModel.findFirst({
      where: { id: sourceRecipeId, restaurantId: sourceRestaurantId },
      include: recipeInclude,
    });

    if (!sourceRecipe) return res.status(404).json({ error: "Recipe not found" });

    // ── Duplicate check ─────────────────────────────────────────────────────────
    const existing = await recipeModel.findFirst({
      where: { restaurantId: targetRestaurantId, name: sourceRecipe.name },
    });

    if (existing) {
      return res.status(409).json({
        error: `Recipe "${sourceRecipe.name}" already exists in target location`,
      });
    }

    // ── Create copy ─────────────────────────────────────────────────────────────
    const newRecipe = await recipeModel.create({
      data: {
        name:         sourceRecipe.name,
        department:   sourceRecipe.department,
        sellingPrice: sourceRecipe.sellingPrice,
        restaurantId: targetRestaurantId,
        ingredients: {
          create: sourceRecipe.ingredients.map((ing: any) => ({
            productId:        ing.productId,
            quantity:         ing.quantity,
            unit:             ing.unit,
            conversionFactor: ing.conversionFactor ?? null,
          })),
        },
      },
      include: recipeInclude,
    });

    console.log(
      `[copyRecipe] User ${req.user.userId} copied "${sourceRecipe.name}" from ${sourceRestaurantId} to ${targetRestaurantId}`
    );

    res.status(201).json({
      success: true,
      message: `Recipe "${sourceRecipe.name}" copied successfully`,
      recipe:  serialize(newRecipe),
    });
  } catch (err) {
    console.error("[copyRecipe] Error:", err);
    next(err);
  }
}
