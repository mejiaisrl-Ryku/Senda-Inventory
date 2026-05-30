import { Router } from "express";
import { authenticate, requireAdmin, requireOwnerSelfService } from "../middleware/auth";
import {
  getGmDashboard,
  getGmLocation,
  getOwnerDashboard,
  getOwnerLocations,
} from "../controllers/phase5Controller";

const router = Router();

// ── GM endpoints (ADMIN role) — mounted at /api/gm ────────────────────────────
export const gmRouter = Router();
gmRouter.use(authenticate as never);
gmRouter.get("/dashboard", requireAdmin as never, getGmDashboard as never);
gmRouter.get("/location",  requireAdmin as never, getGmLocation  as never);

// ── Owner endpoints (OWNER_SUPER_ADMIN role) — mounted at /api/owner ──────────
export const ownerDashRouter = Router();
ownerDashRouter.use(authenticate          as never);
ownerDashRouter.use(requireOwnerSelfService as never);
ownerDashRouter.get("/dashboard",  getOwnerDashboard  as never);
ownerDashRouter.get("/locations",  getOwnerLocations  as never);

export default router;
