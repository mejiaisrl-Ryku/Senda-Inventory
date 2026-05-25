import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getLocationsOverview } from "../controllers/locationsController";

const router = Router();

router.use(authenticate as never);

router.get("/overview", getLocationsOverview as never);

export default router;
