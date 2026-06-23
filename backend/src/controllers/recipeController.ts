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

const recipePreparationSchema = z.object({
  preparationId:    z.number().int().positive(),
  quantity:         z.number().positive("Quantity must be positive"),
  unit:             z.string().min(1),
  conversionFactor: z.number().positive().nullable().optional(),
});

export const produceRecipeSchema = z.object({
  quantity: z.number().positive("Quantity must be positive"),
  notes:    z.string().max(500).optional(),
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
  preparations:      z.array(recipePreparationSchema).optional(),
  allergenIds:       z.array(z.number().int().positive()).optional(),
});


/**
 * Cost contributed by one linked preparation, scaled by how much of it the
 * recipe actually uses (recipe_preparations.quantity/unit), exactly like an
 * ingredient line: the preparation's cost-per-yield-unit stands in for a
 * product's costPerUnit, and its recipeYieldUnit stands in for the
 * product's unit, so the same auto-convert / manual-conversionFactor
 * formula (ingredientCost) applies unchanged.
 *
 * Legacy rows with no quantity/unit set (created before this junction
 * carried usage data) fall back to contributing the prep's full cost, since
 * there's no usage amount to scale by.
 */
function preparationUsageCost(rp: {
  quantity:         unknown;
  unit:             string | null;
  conversionFactor: unknown;
  preparation: { cost: unknown; recipeYield: unknown; recipeYieldUnit: string | null; costPerPortionEstimate: unknown };
}): number {
  if (rp.quantity === null || rp.unit === null) return num(rp.preparation.cost);

  const yieldAmount = rp.preparation.recipeYield !== null ? num(rp.preparation.recipeYield) : null;
  const costPerYieldUnit =
    rp.preparation.costPerPortionEstimate !== null
      ? num(rp.preparation.costPerPortionEstimate)
      : yieldAmount && yieldAmount > 0
        ? num(rp.preparation.cost) / yieldAmount
        : num(rp.preparation.cost);
  const yieldUnit = rp.preparation.recipeYieldUnit ?? rp.unit;

  return ingredientCost([
    {
      quantity:         rp.quantity,
      unit:             rp.unit,
      conversionFactor: rp.conversionFactor,
      product:          { costPerUnit: costPerYieldUnit, unit: yieldUnit },
    },
  ]);
}

/** Sum linked preparation costs, each scaled by its recipe usage quantity. */
function preparationCost(
  recipePreparations: Array<{
    quantity:         unknown;
    unit:             string | null;
    conversionFactor: unknown;
    preparation: { cost: unknown; recipeYield: unknown; recipeYieldUnit: string | null; costPerPortionEstimate: unknown };
  }>
): number {
  return recipePreparations.reduce((sum, rp) => sum + preparationUsageCost(rp), 0);
}

/** Compute recipeCost and costPct, including linked preparation costs. */
function computeCosts(
  ingredients: Array<{
    quantity:         unknown;
    unit:             string;
    conversionFactor: unknown;
    product:          { costPerUnit: unknown; unit: string };
  }>,
  recipePreparations: Array<{
    quantity:         unknown;
    unit:             string | null;
    conversionFactor: unknown;
    preparation: { cost: unknown; recipeYield: unknown; recipeYieldUnit: string | null; costPerPortionEstimate: unknown };
  }>,
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
        select: {
          id: true, name: true, cost: true, recipeYield: true,
          recipeYieldUnit: true, costPerPortionEstimate: true,
        },
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
      id:               rp.preparation.id,
      name:             rp.preparation.name,
      cost:             round2(num(rp.preparation.cost)),
      quantity:         rp.quantity !== null ? num(rp.quantity) : null,
      unit:             rp.unit,
      conversionFactor: rp.conversionFactor ?? null,
      recipeYieldUnit:  rp.preparation.recipeYieldUnit,
      costPerUnit:      round2(
        rp.preparation.costPerPortionEstimate !== null
          ? num(rp.preparation.costPerPortionEstimate)
          : rp.preparation.recipeYield
            ? num(rp.preparation.cost) / num(rp.preparation.recipeYield)
            : num(rp.preparation.cost)
      ),
      usageCost: round2(preparationUsageCost(rp)),
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
  preparations: Array<{ preparationId: number; quantity: number; unit: string; conversionFactor?: number | null }> | undefined,
  allergenIds: number[] | undefined
) {
  if (preparations !== undefined) {
    const prepIds = preparations.map((p) => p.preparationId);
    const owned = await prisma.preparation.findMany({
      where: { id: { in: prepIds }, restaurantId },
      select: { id: true },
    });
    if (owned.length !== prepIds.length) {
      throw Object.assign(new Error("One or more preparations not found"), { status: 400 });
    }
    await (prisma as any).recipePreparation.deleteMany({ where: { recipeId } });
    if (preparations.length > 0) {
      await (prisma as any).recipePreparation.createMany({
        data: preparations.map((p) => ({
          recipeId,
          preparationId:    p.preparationId,
          quantity:         p.quantity,
          unit:             p.unit,
          conversionFactor: p.conversionFactor ?? null,
        })),
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
  if (preparations !== undefined) {
    for (const { preparationId } of preparations) {
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

    await setRecipeLinks(created.id, req.user.restaurantId, body.preparations, body.allergenIds);

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

    await setRecipeLinks(req.params.id, req.user.restaurantId, body.preparations, body.allergenIds);

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

/**
 * POST /api/recipes/:id/produce
 *
 * Records that `quantity` batches of this recipe were made/sold: deducts
 * quantity × each ingredient's quantity from Product stock, and quantity ×
 * each linked preparation's junction quantity from that preparation's own
 * stock. A linked preparation with no junction quantity set is skipped (no
 * way to know how much of it one recipe batch consumes) and reported back
 * as a warning rather than blocking the whole request.
 */
export async function produceRecipe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { quantity, notes } = produceRecipeSchema.parse(req.body);

    const recipe = await prisma.recipe.findFirst({
      where:   { id: req.params.id, restaurantId: req.user.restaurantId },
      include: {
        ingredients: { include: { product: true } },
        recipePreparations: { include: { preparation: true } },
      },
    });
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });

    // ── Ingredient (Product) consumption ──────────────────────────────────
    const consumptionByProduct = new Map<string, number>();
    for (const ing of recipe.ingredients) {
      const consumed = num(ing.quantity) * quantity;
      consumptionByProduct.set(
        ing.productId,
        (consumptionByProduct.get(ing.productId) ?? 0) + consumed
      );
    }

    const insufficientProducts: string[] = [];
    for (const [productId, consumed] of consumptionByProduct) {
      const product = recipe.ingredients.find((i) => i.productId === productId)!.product;
      if (product.currentStock - consumed < 0) insufficientProducts.push(product.name);
    }

    // ── Linked preparation consumption ─────────────────────────────────────
    // rp.quantity/unit is whatever unit the recipe uses the prep in (e.g.
    // "2 OZ" of a prep whose own stock/yield is tracked in "batch") — convert
    // into the preparation's recipeYieldUnit before touching its stock, using
    // the same auto-convert / manual-conversionFactor rule as costing.
    const skippedPreps: string[] = [];
    const consumptionByPrep = new Map<number, number>();
    for (const rp of recipe.recipePreparations) {
      if (rp.quantity === null || rp.unit === null) {
        skippedPreps.push(rp.preparation.name);
        continue;
      }
      const yieldUnit = rp.preparation.recipeYieldUnit ?? rp.unit;
      const autoFactor = getAutoFactor(rp.unit, yieldUnit);
      const cf = rp.conversionFactor !== null ? num(rp.conversionFactor) : 0;
      const perBatchInYieldUnits = autoFactor !== null ? num(rp.quantity) / autoFactor : cf > 0 ? num(rp.quantity) / cf : null;
      if (perBatchInYieldUnits === null) {
        skippedPreps.push(rp.preparation.name);
        continue;
      }
      const consumed = perBatchInYieldUnits * quantity;
      consumptionByPrep.set(rp.preparationId, (consumptionByPrep.get(rp.preparationId) ?? 0) + consumed);
    }

    const insufficientPreps: string[] = [];
    for (const [prepId, consumed] of consumptionByPrep) {
      const prep = recipe.recipePreparations.find((rp) => rp.preparationId === prepId)!.preparation;
      if (prep.currentStock - consumed < 0) insufficientPreps.push(prep.name);
    }

    if (insufficientProducts.length > 0 || insufficientPreps.length > 0) {
      return res.status(400).json({
        error: `Not enough stock to produce this batch: ${[...insufficientProducts, ...insufficientPreps].join(", ")}`,
      });
    }

    const ops: any[] = [];
    for (const [productId, consumed] of consumptionByProduct) {
      const product = recipe.ingredients.find((i) => i.productId === productId)!.product;
      const newQuantity = product.currentStock - consumed;
      ops.push(
        prisma.stockLog.create({
          data: {
            productId,
            previousQuantity: product.currentStock,
            newQuantity,
            change: -consumed,
            reason: "USED",
            unitCost: product.costPerUnit,
            userId: req.user.userId,
            notes: notes ?? `Used to produce ${recipe.name}`,
          },
        }),
        prisma.product.update({ where: { id: productId }, data: { currentStock: newQuantity } })
      );
    }
    for (const [prepId, consumed] of consumptionByPrep) {
      const prep = recipe.recipePreparations.find((rp) => rp.preparationId === prepId)!.preparation;
      const newQuantity = prep.currentStock - consumed;
      ops.push(
        prisma.preparationStockLog.create({
          data: {
            preparationId:    prepId,
            previousQuantity: prep.currentStock,
            newQuantity,
            change:           -consumed,
            reason:           "USED",
            userId:           req.user.userId,
            notes:            notes ?? `Used to produce ${recipe.name}`,
          },
        }),
        prisma.preparation.update({ where: { id: prepId }, data: { currentStock: newQuantity } })
      );
    }

    if (ops.length > 0) await prisma.$transaction(ops);

    const updated = await prisma.recipe.findFirstOrThrow({
      where:   { id: recipe.id },
      include: recipeInclude,
    });
    res.json({ ...serialize(updated), skippedPreparations: skippedPreps });
  } catch (err) { next(err); }
}
