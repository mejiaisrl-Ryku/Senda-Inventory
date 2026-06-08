import { Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";
import { withCache, TTL_STATIC } from "../lib/cache";
import { keyCogsCategories } from "../lib/cacheKeys";
import { invalidateCogsCategoryCache } from "../lib/cacheInvalidation";

// ── Schemas ───────────────────────────────────────────────────────────────────

export const createCogsCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name must be 50 characters or less").trim(),
});

export const updateCogsCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name must be 50 characters or less").trim().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Consistent error envelope used by every response in this controller. */
function err(res: Response, status: number, message: string, code: string) {
  return res.status(status).json({ error: { message, code } });
}

/**
 * Returns the ownerAccountId from the JWT, or sends a 401 and returns null.
 * Every handler calls this first — if null is returned the handler must stop.
 */
function requireOwner(req: AuthRequest, res: Response): string | null {
  const id = req.user?.ownerAccountId ?? null;
  if (!id) {
    err(res, 401, "Owner account required", "OWNER_REQUIRED");
    return null;
  }
  return id;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/cogs-categories
 * List all CogsCategory records for the authenticated owner, ordered by name.
 */
export async function listCogsCategories(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const ownerAccountId = requireOwner(req, res);
    if (!ownerAccountId) return;

    const categories = await withCache(
      keyCogsCategories(ownerAccountId),
      TTL_STATIC,
      () => prisma.cogsCategory.findMany({
        where:   { ownerAccountId },
        select:  { id: true, name: true, ownerAccountId: true, createdAt: true, updatedAt: true },
        orderBy: { name: "asc" },
      }),
    );

    res.json(categories); // 200 with empty array if none exist
  } catch (e) {
    logger.error("cogsController.list failed", {
      userId:        req.user?.userId,
      ownerAccountId: req.user?.ownerAccountId,
      error:         (e as Error).message,
    });
    next(e);
  }
}

/**
 * POST /api/cogs-categories
 * Create a new CogsCategory for the authenticated owner.
 * Name must be unique within the owner account.
 */
export async function createCogsCategory(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const ownerAccountId = requireOwner(req, res);
    if (!ownerAccountId) return;

    const { name } = req.body as z.infer<typeof createCogsCategorySchema>;

    // Explicit pre-check so the error message names the duplicate value.
    const duplicate = await prisma.cogsCategory.findUnique({
      where:  { ownerAccountId_name: { ownerAccountId, name } },
      select: { id: true },
    });
    if (duplicate) {
      return err(res, 400, "Category name already exists for this owner", "DUPLICATE_NAME");
    }

    const category = await prisma.cogsCategory.create({
      data:   { name, ownerAccountId },
      select: { id: true, name: true, ownerAccountId: true, createdAt: true, updatedAt: true },
    });

    void invalidateCogsCategoryCache(ownerAccountId);

    res.status(201).json(category);
  } catch (e) {
    // Belt-and-suspenders: catch a race-condition unique violation from Prisma
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return err(res, 400, "Category name already exists for this owner", "DUPLICATE_NAME");
    }
    logger.error("cogsController.create failed", {
      userId:        req.user?.userId,
      ownerAccountId: req.user?.ownerAccountId,
      body:          req.body,
      error:         (e as Error).message,
    });
    next(e);
  }
}

/**
 * PUT /api/cogs-categories/:id
 * Rename a CogsCategory. The category must belong to the authenticated owner.
 */
export async function updateCogsCategory(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const ownerAccountId = requireOwner(req, res);
    if (!ownerAccountId) return;

    const { id } = req.params;

    // Ownership check — findFirst returns null if id doesn't belong to this owner.
    const existing = await prisma.cogsCategory.findFirst({
      where:  { id, ownerAccountId },
      select: { id: true, name: true },
    });
    if (!existing) {
      return err(res, 404, "COGS category not found", "NOT_FOUND");
    }

    const { name } = req.body as z.infer<typeof updateCogsCategorySchema>;
    if (!name) {
      return err(res, 400, "Nothing to update", "NO_CHANGES");
    }

    // Only query for duplicates when the name is actually changing.
    if (name !== existing.name) {
      const collision = await prisma.cogsCategory.findUnique({
        where:  { ownerAccountId_name: { ownerAccountId, name } },
        select: { id: true },
      });
      if (collision) {
        return err(res, 400, "Category name already exists for this owner", "DUPLICATE_NAME");
      }
    }

    const updated = await prisma.cogsCategory.update({
      where:  { id },
      data:   { name },
      select: { id: true, name: true, ownerAccountId: true, updatedAt: true },
    });

    void invalidateCogsCategoryCache(ownerAccountId);

    res.json(updated);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return err(res, 400, "Category name already exists for this owner", "DUPLICATE_NAME");
    }
    logger.error("cogsController.update failed", {
      userId:        req.user?.userId,
      ownerAccountId: req.user?.ownerAccountId,
      categoryId:    req.params.id,
      body:          req.body,
      error:         (e as Error).message,
    });
    next(e);
  }
}

/**
 * DELETE /api/cogs-categories/:id
 * Delete a CogsCategory only if no products or order items reference it.
 * Returns 409 with reference counts if still in use.
 */
export async function deleteCogsCategory(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const ownerAccountId = requireOwner(req, res);
    if (!ownerAccountId) return;

    const { id } = req.params;

    const existing = await prisma.cogsCategory.findFirst({
      where:  { id, ownerAccountId },
      select: { id: true, name: true },
    });
    if (!existing) {
      return err(res, 404, "COGS category not found", "NOT_FOUND");
    }

    // Count all references in parallel before attempting deletion.
    const [productCount, orderItemCount] = await Promise.all([
      prisma.product.count({ where: { cogsCategoryId: id } }),
      prisma.orderItem.count({ where: { cogsCategoryId: id } }),
    ]);

    const total = productCount + orderItemCount;
    if (total > 0) {
      return res.status(409).json({
        error: {
          message:      "Category in use, cannot delete",
          code:         "CATEGORY_IN_USE",
        },
        productCount,
        orderItemCount,
      });
    }

    await prisma.cogsCategory.delete({ where: { id } });

    void invalidateCogsCategoryCache(ownerAccountId);

    res.status(204).send();
  } catch (e) {
    logger.error("cogsController.delete failed", {
      userId:        req.user?.userId,
      ownerAccountId: req.user?.ownerAccountId,
      categoryId:    req.params.id,
      error:         (e as Error).message,
    });
    next(e);
  }
}
