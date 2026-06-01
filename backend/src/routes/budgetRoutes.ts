import { Router } from "express";
import { authenticate, requireOwnerSelfService } from "../middleware/auth";
import { getOwnerBudgets, upsertOwnerBudget, deleteOwnerBudget } from "../controllers/budgetController";

// ── Owner Budget endpoints (OWNER_SUPER_ADMIN) — mounted at /api/owner ────────
export const ownerBudgetRouter = Router();
ownerBudgetRouter.use(authenticate            as never);
ownerBudgetRouter.use(requireOwnerSelfService  as never);
ownerBudgetRouter.get(    "/budgets",           getOwnerBudgets   as never);
ownerBudgetRouter.post(   "/budgets",           upsertOwnerBudget as never);
ownerBudgetRouter.delete( "/budgets/:budgetId", deleteOwnerBudget as never);

export default ownerBudgetRouter;
