import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { extractInvoice, extractInvoiceSchema } from "../controllers/aiController";

const router = Router();

// All AI routes require authentication
router.use(authenticate as never);

// POST /api/ai/extract-invoice — admin-only; calls a paid external API (OpenAI).
// STAFF must not be able to trigger AI inference and incur cost.
router.post(
  "/extract-invoice",
  requireAdmin as never,
  validate(extractInvoiceSchema),
  extractInvoice as never
);

export default router;
