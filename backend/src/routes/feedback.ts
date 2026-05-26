import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { submitFeedback } from "../controllers/feedbackController";

const router = Router();

router.post("/", authenticate as never, submitFeedback as never);

export default router;
