import { Router } from "express";
import { authenticate, requireKyruManager } from "../middleware/auth";
import { getScanMetrics, getWorkerHealth } from "../controllers/metricsController";

const router = Router();

router.use(authenticate as never);

// KYRU_MANAGER only — these endpoints aggregate cost/token usage across every
// restaurant. A restaurant-level ADMIN must never see other tenants' data,
// so this is intentionally NOT requireAdmin.
router.use(requireKyruManager as never);

router.get("/scans", getScanMetrics as never);
router.get("/worker-health", getWorkerHealth as never);

export default router;
