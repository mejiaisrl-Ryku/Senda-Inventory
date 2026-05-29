import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import { verifyToken } from "../lib/jwt";

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
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
