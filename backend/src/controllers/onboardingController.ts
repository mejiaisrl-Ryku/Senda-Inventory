import { Response, NextFunction } from "express";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

/**
 * GET /api/onboarding/progress
 *
 * Returns the restaurant's onboarding state in one round-trip.
 * Checks existence (not counts) for speed — we only need a boolean.
 */
export async function getProgress(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId;

    // All 5 checks + the dismissed flag, all in parallel.
    const [
      restaurant,
      firstInvoice,
      firstProduct,
      firstRecipe,
      firstParLevel,
      firstTeamMember,
    ] = await Promise.all([
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { onboardingDismissed: true },
      }),
      prisma.order.findFirst({
        where:  { restaurantId },
        select: { id: true },
      }),
      prisma.product.findFirst({
        where:  { restaurantId },
        select: { id: true },
      }),
      prisma.recipe.findFirst({
        where:  { restaurantId },
        select: { id: true },
      }),
      // Par level = any product with minimumStock > 0
      prisma.product.findFirst({
        where:  { restaurantId, minimumStock: { gt: 0 } },
        select: { id: true },
      }),
      // Team member = any user in the restaurant who isn't the current requester
      prisma.user.findFirst({
        where:  { restaurantId, NOT: { id: req.user.userId } },
        select: { id: true },
      }),
    ]);

    res.json({
      dismissed: restaurant?.onboardingDismissed ?? false,
      completed: {
        invoice:   !!firstInvoice,
        product:   !!firstProduct,
        recipe:    !!firstRecipe,
        parLevel:  !!firstParLevel,
        team:      !!firstTeamMember,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/onboarding/dismiss
 *
 * Permanently marks the onboarding checklist as dismissed for this restaurant.
 * Called after all 5 items are complete and the 3-second animation finishes.
 */
export async function dismissOnboarding(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.restaurant.update({
      where: { id: req.user.restaurantId },
      data:  { onboardingDismissed: true },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
