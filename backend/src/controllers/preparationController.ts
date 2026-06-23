import { Response, NextFunction } from "express";
import { z } from "zod";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import { cascadeAllergensFromPrepToLinkedRecipes } from "../lib/allergenCascade";
import { ingredientCost, num, round2 } from "../lib/ingredientCosting";

const ConservationTypeEnum = z.enum(["REFRIGERADO", "CONGELADO", "AMBIENTE"]);

const ingredientSchema = z.object({
  productId:        z.string().min(1),
  quantity:         z.number().positive("Quantity must be positive"),
  unit:             z.string().min(1),
  conversionFactor: z.number().positive().nullable().optional(),
});

export const upsertPreparationSchema = z.object({
  name:                   z.string().min(1, "Name is required").max(255),
  description:            z.string().nullable().optional(),
  preparationMethod:      z.string().nullable().optional(),
  platingNotes:           z.string().nullable().optional(),
  photoUrl:               z.string().nullable().optional(),
  shelfLifeDays:          z.number().int().positive().nullable().optional(),
  storageTemp:            z.string().nullable().optional(),
  conservationType:       ConservationTypeEnum.nullable().optional(),
  almacen:                z.string().nullable().optional(),
  recipeYield:            z.number().positive().nullable().optional(),
  recipeYieldUnit:        z.string().nullable().optional(),
  costPerPortionEstimate: z.number().nonnegative().nullable().optional(),
  currentStock:           z.number().nonnegative().optional(),
  allergenIds:            z.array(z.number().int().positive()).optional(),
  ingredients:            z.array(ingredientSchema).optional(),
});

/** Standard include block for preparation queries. */
const preparationInclude = {
  preparationIngredients: {
    include: {
      product: {
        select: { id: true, name: true, unit: true, costPerUnit: true, category: true },
      },
    },
  },
};

/** Replace a preparation's ingredient list and recompute its cost from them. */
async function setPreparationIngredients(
  preparationId: number,
  ingredients: Array<{ productId: string; quantity: number; unit: string; conversionFactor?: number | null }>
) {
  await prisma.preparationIngredient.deleteMany({ where: { preparationId } });
  if (ingredients.length > 0) {
    await prisma.preparationIngredient.createMany({
      data: ingredients.map((ing) => ({
        preparationId,
        productId:        ing.productId,
        quantity:         ing.quantity,
        unit:             ing.unit,
        conversionFactor: ing.conversionFactor ?? null,
      })),
    });
  }
}

/** Replace a preparation's allergen set, validating every id exists, then
 *  cascade the new set to every recipe currently linked to this prep. */
async function setPreparationAllergens(preparationId: number, allergenIds: number[]) {
  const found = await prisma.allergen.findMany({
    where: { id: { in: allergenIds } },
    select: { id: true },
  });
  if (found.length !== allergenIds.length) {
    throw Object.assign(new Error("One or more allergens not found"), { status: 400 });
  }

  await prisma.preparationAllergen.deleteMany({ where: { preparationId } });
  if (allergenIds.length > 0) {
    await prisma.preparationAllergen.createMany({
      data: allergenIds.map((allergenId) => ({ preparationId, allergenId })),
    });
  }

  await cascadeAllergensFromPrepToLinkedRecipes(preparationId);
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/** Serialize a preparation row to the API response shape. */
function serialize(p: any) {
  return {
    id:                     p.id,
    restaurantId:           p.restaurantId,
    name:                   p.name,
    description:            p.description,
    preparationMethod:      p.preparationMethod,
    platingNotes:           p.platingNotes,
    photoUrl:               p.photoUrl,
    shelfLifeDays:          p.shelfLifeDays,
    storageTemp:            p.storageTemp,
    conservationType:       p.conservationType,
    almacen:                p.almacen,
    recipeYield:            p.recipeYield !== null ? Number(p.recipeYield) : null,
    recipeYieldUnit:        p.recipeYieldUnit,
    cost:                   round4(Number(p.cost)),
    costPerPortionEstimate: p.costPerPortionEstimate !== null ? round4(Number(p.costPerPortionEstimate)) : null,
    currentStock:           Number(p.currentStock ?? 0),
    createdBy:              p.createdBy,
    createdAt:              p.createdAt,
    updatedAt:              p.updatedAt,
    ingredients: (p.preparationIngredients ?? []).map((pi: any) => ({
      id:               pi.id,
      productId:        pi.productId,
      quantity:         num(pi.quantity),
      unit:             pi.unit,
      conversionFactor: pi.conversionFactor !== null ? Number(pi.conversionFactor) : null,
      product:          pi.product,
    })),
  };
}

/**
 * GET /api/preparations
 * List all preparations for the authenticated user's restaurant.
 */
export async function listPreparations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const preparations = await prisma.preparation.findMany({
      where:   { restaurantId: req.user.restaurantId },
      orderBy: { name: "asc" },
      include: preparationInclude,
    });
    res.json(preparations.map(serialize));
  } catch (err) { next(err); }
}

/**
 * GET /api/preparations/:id
 */
export async function getPreparation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const preparation = await prisma.preparation.findFirst({
      where:   { id: Number(req.params.id), restaurantId: req.user.restaurantId },
      include: preparationInclude,
    });
    if (!preparation) return res.status(404).json({ error: "Preparation not found" });
    res.json(serialize(preparation));
  } catch (err) { next(err); }
}

/** Recompute a preparation's cost (and costPerPortionEstimate, when recipeYield
 *  is set and the caller didn't supply an explicit override) from its current
 *  ingredient list, then persist it. */
async function recomputeCost(preparationId: number, costPerPortionOverride?: number | null) {
  const prep = await prisma.preparation.findUniqueOrThrow({
    where:   { id: preparationId },
    include: preparationInclude,
  });
  const cost = round2(ingredientCost(prep.preparationIngredients as any));
  const recipeYield = prep.recipeYield !== null ? num(prep.recipeYield) : null;
  const costPerPortionEstimate =
    costPerPortionOverride !== undefined
      ? costPerPortionOverride
      : recipeYield && recipeYield > 0 ? round2(cost / recipeYield) : null;

  return prisma.preparation.update({
    where:   { id: preparationId },
    data:    { cost, costPerPortionEstimate },
    include: preparationInclude,
  });
}

/**
 * POST /api/preparations
 */
export async function createPreparation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user.restaurantId) return res.status(403).json({ error: "No restaurant assigned to this user" });
    const body = upsertPreparationSchema.parse(req.body);

    const created = await prisma.preparation.create({
      data: {
        restaurantId:           req.user.restaurantId,
        name:                   body.name,
        description:            body.description ?? null,
        preparationMethod:      body.preparationMethod ?? null,
        platingNotes:           body.platingNotes ?? null,
        photoUrl:               body.photoUrl ?? null,
        shelfLifeDays:          body.shelfLifeDays ?? null,
        storageTemp:            body.storageTemp ?? null,
        conservationType:       body.conservationType ?? null,
        almacen:                body.almacen ?? null,
        recipeYield:            body.recipeYield ?? null,
        recipeYieldUnit:        body.recipeYieldUnit ?? null,
        currentStock:           body.currentStock ?? 0,
        createdBy:              req.user.userId,
      },
    });

    if (body.allergenIds !== undefined) {
      await setPreparationAllergens(created.id, body.allergenIds);
    }
    if (body.ingredients !== undefined) {
      await setPreparationIngredients(created.id, body.ingredients);
    }
    const final = await recomputeCost(created.id, body.costPerPortionEstimate);

    res.status(201).json(serialize(final));
  } catch (err) { next(err); }
}

/**
 * PATCH /api/preparations/:id
 */
export async function updatePreparation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.preparation.findFirst({
      where: { id: Number(req.params.id), restaurantId: req.user.restaurantId },
    });
    if (!existing) return res.status(404).json({ error: "Preparation not found" });

    const body = upsertPreparationSchema.partial().parse(req.body);
    const { allergenIds, ingredients, costPerPortionEstimate, ...scalarFields } = body;

    await prisma.preparation.update({
      where: { id: existing.id },
      data:  scalarFields,
    });

    if (allergenIds !== undefined) {
      await setPreparationAllergens(existing.id, allergenIds);
    }
    if (ingredients !== undefined) {
      await setPreparationIngredients(existing.id, ingredients);
    }
    const final = await recomputeCost(existing.id, costPerPortionEstimate);

    res.json(serialize(final));
  } catch (err) { next(err); }
}

/**
 * DELETE /api/preparations/:id
 */
export async function deletePreparation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.preparation.findFirst({
      where: { id: Number(req.params.id), restaurantId: req.user.restaurantId },
    });
    if (!existing) return res.status(404).json({ error: "Preparation not found" });

    await prisma.preparation.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) { next(err); }
}
