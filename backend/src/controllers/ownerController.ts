import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";

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

    logger.debug("getOwnerMe: entry", {
      userId:         req.user.userId,
      ownerAccountId,
    });

    if (!ownerAccountId) {
      return res.status(400).json({ error: "Not an owner account" });
    }

    const account = await prisma.ownerAccount.findUnique({
      where:   { id: ownerAccountId },
      include: { _count: { select: { restaurants: true } } },
    });

    if (!account) return res.status(404).json({ error: "Owner account not found" });

    logger.debug("getOwnerMe: success", {
      ownerAccountId,
      restaurantCount: account._count.restaurants,
    });

    res.json({
      ownerAccountId:  account.id,
      name:            account.name,
      email:           account.email,
      restaurantCount: account._count.restaurants,
      createdAt:       account.createdAt,
    });
  } catch (err) {
    logger.error("getOwnerMe: error", {
      userId:  req.user.userId,
      message: (err as Error).message,
    });
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

    logger.debug("getOwnerRestaurants: entry", {
      userId:         req.user.userId,
      ownerAccountId,
    });

    if (!ownerAccountId) {
      return res.status(400).json({ error: "Not an owner account" });
    }

    const restaurants = await prisma.restaurant.findMany({
      where:   { ownerAccountId },
      select:  { id: true, name: true, phone: true, locationCount: true, suspended: true },
      orderBy: { name: "asc" },
    });

    logger.debug("getOwnerRestaurants: success", {
      ownerAccountId,
      restaurantCount: restaurants.length,
    });

    res.json(restaurants);
  } catch (err) {
    logger.error("getOwnerRestaurants: error", {
      userId:  req.user.userId,
      message: (err as Error).message,
    });
    next(err);
  }
}
