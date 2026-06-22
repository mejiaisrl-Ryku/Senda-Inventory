import { Response, NextFunction } from "express";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

/**
 * GET /api/allergens
 * The 14-allergen lookup table. Not restaurant-scoped — visible to every
 * authenticated user (matches the allergens_read_all / read_all RLS policy).
 */
export async function listAllergens(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const allergens = await prisma.allergen.findMany({ orderBy: { labelEN: "asc" } });
    res.json(allergens);
  } catch (err) { next(err); }
}
