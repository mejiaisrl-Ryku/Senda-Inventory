import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import {
  getDailyReport,
  getWeeklyReport,
  exportReport,
  getCogsToSales,
} from "../controllers/reportsController";

const router = Router();

router.use(authenticate as never);
router.use(requireAdmin as never);

router.get("/daily", getDailyReport as never);
router.get("/weekly", getWeeklyReport as never);
router.get("/export", exportReport as never);
router.get("/cogs-to-sales", getCogsToSales as never);

export default router;
