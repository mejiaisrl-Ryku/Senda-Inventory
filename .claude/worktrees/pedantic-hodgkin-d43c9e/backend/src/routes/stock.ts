import { Router } from "express";
import { authenticate } from "../middleware/auth";
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

router.post("/adjust", validate(adjustSchema), adjustStock as never);
router.get("/low-items", getLowItems as never);
router.get("/report", getStockReport as never);
router.get("/logs/:productId", getStockLogs as never);

export default router;
