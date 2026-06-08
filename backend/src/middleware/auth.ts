import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import { verifyToken } from "../lib/jwt";
import { tenantStore, TenantContext } from "../lib/tenantContext";

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  try {
    req.user = verifyToken(header.slice(7));

    // Populate AsyncLocalStorage so the Prisma tenant extension can read the
    // current identity without being passed req.user explicitly.
    // Context is derived ONLY from the verified JWT — never from request body
    // or headers supplied by the client.
    const ctx: TenantContext = {
      userId:              req.user.userId,
      role:                req.user.role,
      restaurantId:        req.user.restaurantId,
      ownerAccountId:      req.user.ownerAccountId,
      ownedRestaurantIds:  req.user.ownedRestaurantIds,
    };

    // Run next() inside the ALS context so every async step downstream
    // (controller → prismaT queries) inherits the same store.
    tenantStore.run(ctx, () => next());
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user.role;
  if (role !== "SUPER_ADMIN" && role !== "KYRU_MANAGER") {
    return res.status(403).json({ error: "Super-admin access required" });
  }
  next();
}

/** Only KYRU_MANAGER (Kyru internal) or OWNER_SUPER_ADMIN may pass. */
export function requireOwnerOrKyruManager(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user.role;
  if (role !== "KYRU_MANAGER" && role !== "OWNER_SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

/** Only OWNER_SUPER_ADMIN with an ownerAccountId in their JWT may pass. */
export function requireOwnerSelfService(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user.role !== "OWNER_SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden: Owner-only endpoint" });
  }
  if (!req.user.ownerAccountId) {
    return res.status(400).json({ error: "Missing ownerAccountId in token" });
  }
  next();
}

/** Only KYRU_MANAGER may pass. */
export function requireKyruManager(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user.role !== "KYRU_MANAGER") {
    return res.status(403).json({ error: "Forbidden: Kyru Manager only" });
  }
  next();
}
