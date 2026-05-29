import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

/**
 * GET /api/owner-account/me
 * Current owner's account summary.
 * Auth: OWNER_SUPER_ADMIN (enforced by requireOwnerSelfService middleware).
 */
export async function getOwnerMe(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { ownerAccountId } = req.user;
    if (!ownerAccountId) {
      return res.status(400).json({ error: "Not an owner account" });
    }

    const account = await prisma.ownerAccount.findUnique({
      where:   { id: ownerAccountId },
      include: { _count: { select: { restaurants: true } } },
    });

    if (!account) return res.status(404).json({ error: "Owner account not found" });

    res.json({
      ownerAccountId:  account.id,
      name:            account.name,
      email:           account.email,
      restaurantCount: account._count.restaurants,
      createdAt:       account.createdAt,
    });
  } catch (err) {
    console.error("[getOwnerMe] Error:", err);
    next(err);
  }
}

/**
 * GET /api/owner-account/restaurants
 * All restaurants owned by the authenticated owner.
 * Auth: OWNER_SUPER_ADMIN (enforced by requireOwnerSelfService middleware).
 */
export async function getOwnerRestaurants(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { ownerAccountId } = req.user;
    if (!ownerAccountId) {
      return res.status(400).json({ error: "Not an owner account" });
    }

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true, phone: true, locationCount: true, suspended: true },
      orderBy: { name: "asc" },
    });

    res.json(restaurants);
  } catch (err) {
    console.error("[getOwnerRestaurants] Error:", err);
    next(err);
  }
}
