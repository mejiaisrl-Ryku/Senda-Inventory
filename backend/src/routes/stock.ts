import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  adjustStock,
  getStockLogs,
  getLowItems,
  getStockReport,
  adjustSchema,
} from "../controllers/stockController";

const router = Router();

router.use(authenticate as never);

// Stock adjustments are admin-only — STAFF must not be able to silently
// alter inventory levels or create stock log entries.
router.post("/adjust", requireAdmin as never, validate(adjustSchema), adjustStock as never);
router.get("/low-items", getLowItems as never);
router.get("/report", getStockReport as never);
router.get("/logs/:productId", getStockLogs as never);

export default router;
