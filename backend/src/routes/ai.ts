import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { aiLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validate";
import { extractInvoice, extractInvoiceSchema } from "../controllers/aiController";

const router = Router();

// All AI routes require authentication
router.use(authenticate as never);

// POST /api/ai/extract-invoice — admin-only; calls a paid external API (OpenAI).
// aiLimiter: 20/hr per IP — cost-control so a single IP can't burn the quota.
// STAFF must not be able to trigger AI inference and incur cost.
router.post(
  "/extract-invoice",
  aiLimiter,
  requireAdmin as never,
  validate(extractInvoiceSchema),
  extractInvoice as never
);

export default router;
