import { Response, NextFunction } from "express";
import { z } from "zod";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

const ConservationTypeEnum = z.enum(["REFRIGERADO", "CONGELADO", "AMBIENTE"]);

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
  cost:                   z.number().nonnegative().optional(),
  costPerPortionEstimate: z.number().nonnegative().nullable().optional(),
});

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
    createdBy:              p.createdBy,
    createdAt:              p.createdAt,
    updatedAt:              p.updatedAt,
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
      where: { id: Number(req.params.id), restaurantId: req.user.restaurantId },
    });
    if (!preparation) return res.status(404).json({ error: "Preparation not found" });
    res.json(serialize(preparation));
  } catch (err) { next(err); }
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
        cost:                   body.cost ?? 0,
        costPerPortionEstimate: body.costPerPortionEstimate ?? null,
        createdBy:              req.user.userId,
      },
    });

    res.status(201).json(serialize(created));
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

    const updated = await prisma.preparation.update({
      where: { id: existing.id },
      data:  body,
    });

    res.json(serialize(updated));
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
