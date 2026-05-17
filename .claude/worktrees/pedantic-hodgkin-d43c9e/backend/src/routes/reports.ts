import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getDailyReport, getWeeklyReport, exportReport } from "../controllers/reportsController";

const router = Router();

router.use(authenticate as never);

router.get("/daily", getDailyReport as never);
router.get("/weekly", getWeeklyReport as never);
router.get("/export", exportReport as never);

export default router;
