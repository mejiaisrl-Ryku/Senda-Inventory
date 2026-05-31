import { Router } from "express";
import { authenticate, requireOwnerSelfService } from "../middleware/auth";
import { getOwnerPnl, getOwnerPnlSummary } from "../controllers/phase6Controller";

// ── Owner P&L endpoints (OWNER_SUPER_ADMIN) — mounted at /api/owner ───────────
export const ownerPnlRouter = Router();
ownerPnlRouter.use(authenticate           as never);
ownerPnlRouter.use(requireOwnerSelfService as never);
ownerPnlRouter.get("/pnl",         getOwnerPnl        as never);
ownerPnlRouter.get("/pnl/summary", getOwnerPnlSummary as never);

export default ownerPnlRouter;
