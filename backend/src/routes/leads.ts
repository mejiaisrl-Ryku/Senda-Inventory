import { Router } from "express";
import { leadsLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validate";
import { createLead, createLeadSchema } from "../controllers/leadsController";

const router = Router();

// Public — no authenticate. Rate-limited 5/hour/IP; honeypot in controller.
router.post("/", leadsLimiter, validate(createLeadSchema), createLead as never);

export default router;
