import { Response, NextFunction } from "express";
import { z } from "zod";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import { cascadeAllergensToRecipe } from "../lib/allergenCascade";
import { getAutoFactor, num, round2, ingredientCost } from "../lib/ingredientCosting";

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
  portions:          z.number().int().positive().nullable().optional(),
  batchWeight:       z.number().positive().nullable().optional(),
  preparationMethod: z.string().nullable().optional(),
  platingNotes:      z.string().nullable().optional(),
  photoUrl:          z.string().nullable().optional(),
  yieldPercent:      z.number().min(0).max(100).nullable().optional(),
  category:          z.enum(["STARTER", "MAIN", "DESSERT", "SNACK", "BEVERAGE"]).nullable().optional(),
  station:           z.enum(["GRILL", "SAUCIER", "PANTRY", "PASTRY", "BAR", "FRYER"]).nullable().optional(),
  prepIds:           z.array(z.number().int().positive()).optional(),
  allergenIds:       z.array(z.number().int().positive()).optional(),
});


/** Sum linked preparation costs (recipe_preparations.quantity × preparation cost is not
 *  tracked per-unit — preps store a single pre-calculated total cost, so each linked
 *  prep contributes its full cost once, regardless of the junction's quantity/unit,
 *  which only describe how much of the prep's yield the recipe consumes for reference. */
function preparationCost(
  recipePreparations: Array<{ preparation: { cost: unknown } }>
): number {
  return recipePreparations.reduce((sum, rp) => sum + num(rp.preparation.cost), 0);
}

/** Compute recipeCost and costPct, including linked preparation costs. */
function computeCosts(
  ingredients: Array<{
    quantity:         unknown;
    unit:             string;
    conversionFactor: unknown;
    product:          { costPerUnit: unknown; unit: string };
  }>,
  recipePreparations: Array<{ preparation: { cost: unknown } }>,
  sellingPrice: number
): { recipeCost: number; costPct: number } {
  const recipeCost = round2(ingredientCost(ingredients) + preparationCost(recipePreparations));
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
  recipePreparations: {
    include: {
      preparation: {
        select: { id: true, name: true, cost: true, recipeYieldUnit: true },
      },
    },
  },
  recipeAllergens: {
    include: {
      allergen: {
        select: { id: true, code: true, labelEN: true, labelES: true },
      },
    },
  },
};

/** Serialize a recipe row to the API response shape. */
function serialize(r: any) {
  const sp = num(r.sellingPrice);
  const { recipeCost, costPct } = computeCosts(r.ingredients ?? [], r.recipePreparations ?? [], sp);
  return {
    id:           r.id,
    restaurantId: r.restaurantId,
    name:         r.name,
    department:   r.department,
    sellingPrice: round2(sp),
    portions:          r.portions ?? null,
    batchWeight:       r.batchWeight !== null && r.batchWeight !== undefined ? num(r.batchWeight) : null,
    preparationMethod: r.preparationMethod ?? null,
    platingNotes:      r.platingNotes ?? null,
    photoUrl:          r.photoUrl ?? null,
    yieldPercent:      r.yieldPercent !== null && r.yieldPercent !== undefined ? num(r.yieldPercent) : null,
    category:          r.category ?? null,
    station:           r.station ?? null,
    createdAt:    r.createdAt,
    updatedAt:    r.updatedAt,
    recipeCost,
    costPct,
    costPerPortion: r.portions ? round2(recipeCost / r.portions) : null,
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
    preparations: (r.recipePreparations ?? []).map((rp: any) => ({
      id:            rp.preparation.id,
      name:          rp.preparation.name,
      cost:          round2(num(rp.preparation.cost)),
      quantity:      rp.quantity !== null ? num(rp.quantity) : null,
      unit:          rp.unit,
    })),
    allergens: (r.recipeAllergens ?? []).map((ra: any) => ({
      id:                 ra.allergen.id,
      code:               ra.allergen.code,
      labelEN:            ra.allergen.labelEN,
      labelES:            ra.allergen.labelES,
      isPresent:          ra.isPresent,
      manuallyOverridden: ra.manuallyOverridden,
    })),
  };
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * Replace a recipe's linked preparations and allergens.
 * Validates that every prepId/allergenId referenced belongs to the
 * requesting restaurant (preps) or exists at all (allergens are a
 * global lookup table, not tenant-scoped).
 */
async function setRecipeLinks(
  recipeId: string,
  restaurantId: string,
  prepIds: number[] | undefined,
  allergenIds: number[] | undefined
) {
  if (prepIds !== undefined) {
    const owned = await prisma.preparation.findMany({
      where: { id: { in: prepIds }, restaurantId },
      select: { id: true },
    });
    if (owned.length !== prepIds.length) {
      throw Object.assign(new Error("One or more preparations not found"), { status: 400 });
    }
    await (prisma as any).recipePreparation.deleteMany({ where: { recipeId } });
    if (prepIds.length > 0) {
      await (prisma as any).recipePreparation.createMany({
        data: prepIds.map((preparationId) => ({ recipeId, preparationId })),
      });
    }
  }

  if (allergenIds !== undefined) {
    const found = await prisma.allergen.findMany({
      where: { id: { in: allergenIds } },
      select: { id: true },
    });
    if (found.length !== allergenIds.length) {
      throw Object.assign(new Error("One or more allergens not found"), { status: 400 });
    }

    // Upsert, never delete: an allergen the chef excludes must still leave a
    // row behind (isPresent=false, manuallyOverridden=true) so a later prep
    // cascade sees "already decided" and skips it instead of re-adding it.
    // Deleting the row would make it indistinguishable from "never set",
    // which is exactly what let a removed allergen silently come back.
    const onSet = new Set(allergenIds);
    const existingRows = await (prisma as any).recipeAllergen.findMany({
      where: { recipeId },
      select: { allergenId: true },
    });
    const existingIds = new Set<number>(existingRows.map((r: any) => r.allergenId));

    for (const allergenId of allergenIds) {
      await (prisma as any).recipeAllergen.upsert({
        where:  { recipeId_allergenId: { recipeId, allergenId } },
        create: { recipeId, allergenId, isPresent: true, manuallyOverridden: true },
        update: { isPresent: true, manuallyOverridden: true },
      });
    }
    for (const allergenId of existingIds) {
      if (onSet.has(allergenId)) continue;
      await (prisma as any).recipeAllergen.update({
        where: { recipeId_allergenId: { recipeId, allergenId } },
        data:  { isPresent: false, manuallyOverridden: true },
      });
    }
  }

  // Cascade allergens from every currently-linked prep. Insert-only, so this
  // is safe to run unconditionally after a full prep-link replace above —
  // it only fills in allergens the recipe doesn't already have a row for.
  if (prepIds !== undefined) {
    for (const preparationId of prepIds) {
      await cascadeAllergensToRecipe(recipeId, preparationId);
    }
  }
}

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
    if (!req.user.restaurantId) return res.status(403).json({ error: "No restaurant assigned to this user" });
    const body = upsertRecipeSchema.parse(req.body);

    const created = await recipeModel.create({
      data: {
        restaurantId:      req.user.restaurantId,
        name:              body.name,
        department:        body.department as never,
        sellingPrice:      body.sellingPrice,
        portions:          body.portions ?? null,
        batchWeight:       body.batchWeight ?? null,
        preparationMethod: body.preparationMethod ?? null,
        platingNotes:      body.platingNotes ?? null,
        photoUrl:          body.photoUrl ?? null,
        yieldPercent:      body.yieldPercent ?? null,
        category:          (body.category as never) ?? null,
        station:           (body.station as never) ?? null,
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

    await setRecipeLinks(created.id, req.user.restaurantId, body.prepIds, body.allergenIds);

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
    if (!req.user.restaurantId) return res.status(403).json({ error: "No restaurant assigned to this user" });
    await recipeModel.findFirstOrThrow({
      where: { id: req.params.id, restaurantId: req.user.restaurantId },
    });

    const body = upsertRecipeSchema.parse(req.body);

    await recipeModel.update({
      where: { id: req.params.id },
      data:  {
        name:              body.name,
        department:        body.department as never,
        sellingPrice:      body.sellingPrice,
        portions:          body.portions ?? null,
        batchWeight:       body.batchWeight ?? null,
        preparationMethod: body.preparationMethod ?? null,
        platingNotes:      body.platingNotes ?? null,
        photoUrl:          body.photoUrl ?? null,
        yieldPercent:      body.yieldPercent ?? null,
        category:          (body.category as never) ?? null,
        station:           (body.station as never) ?? null,
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

    await setRecipeLinks(req.params.id, req.user.restaurantId, body.prepIds, body.allergenIds);

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
