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
  productId: z.string().min(1),
  quantity:  z.number().positive("Quantity must be positive"),
  unit:      z.string().min(1),
});

export const upsertRecipeSchema = z.object({
  name:         z.string().min(1, "Name is required").max(255),
  department:   RecipeDeptEnum,
  sellingPrice: z.number().positive("Selling price must be positive"),
  ingredients:  z.array(ingredientSchema).min(1, "At least one ingredient is required"),
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function num(v: unknown): number {
  return typeof v === "object" ? parseFloat(String(v)) : Number(v);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Compute recipeCost and costPct from a list of hydrated ingredients. */
function computeCosts(
  ingredients: Array<{ quantity: unknown; product: { costPerUnit: unknown } }>,
  sellingPrice: number
): { recipeCost: number; costPct: number } {
  const recipeCost = round2(
    ingredients.reduce(
      (sum, ing) => sum + num(ing.quantity) * num(ing.product.costPerUnit),
      0
    )
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
      id:        ing.id,
      productId: ing.productId,
      quantity:  num(ing.quantity),
      unit:      ing.unit,
      product:   {
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
    const recipes = await recipeModel.findMany({
      where: {
        restaurantId: req.user.restaurantId,
        ...(department ? { department: String(department) } : {}),
      },
      orderBy: [{ department: "asc" }, { name: "asc" }],
      include: recipeInclude,
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

    // Create recipe first, then bulk-insert ingredients
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
        recipeId:  created.id,
        productId: ing.productId,
        quantity:  ing.quantity,
        unit:      ing.unit,
      })),
    });

    // Re-fetch with full product details for the response
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
    // Verify ownership first
    await recipeModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });

    const body = upsertRecipeSchema.parse(req.body);

    // Update core fields
    await recipeModel.update({
      where: { id: req.params.id },
      data:  {
        name:         body.name,
        department:   body.department as never,
        sellingPrice: body.sellingPrice,
      },
    });

    // Full replace: delete all existing ingredients then re-insert
    await ingredientModel.deleteMany({ where: { recipeId: req.params.id } });
    await ingredientModel.createMany({
      data: body.ingredients.map((ing) => ({
        recipeId:  req.params.id,
        productId: ing.productId,
        quantity:  ing.quantity,
        unit:      ing.unit,
      })),
    });

    // Re-fetch with full product details
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
