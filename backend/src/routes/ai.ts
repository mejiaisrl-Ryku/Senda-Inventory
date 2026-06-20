import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { aiLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validate";
import { enqueueInvoiceExtraction, enqueueInvoiceSchema } from "../controllers/scanJobController";

const router = Router();

// All AI routes require authentication
router.use(authenticate as never);

// POST /api/ai/extract-invoice — admin-only; enqueues a ScanJob instead of
// calling Claude inline (Sprint 1). A worker (Sprint 2) performs the scan.
// STAFF must not be able to trigger AI inference and incur cost.
router.post(
  "/extract-invoice",
  aiLimiter,
  requireAdmin as never,
  validate(enqueueInvoiceSchema),
  enqueueInvoiceExtraction as never
);

export default router;
