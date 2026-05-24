import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getProgress, dismissOnboarding } from "../controllers/onboardingController";

const router = Router();

router.use(authenticate as never);

router.get("/progress",  getProgress       as never);
router.post("/dismiss",  dismissOnboarding as never);

export default router;
