import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { extractInvoice, extractInvoiceSchema } from "../controllers/aiController";

const router = Router();

// All AI routes require authentication
router.use(authenticate as never);

// POST /api/ai/extract-invoice
router.post(
  "/extract-invoice",
  validate(extractInvoiceSchema),
  extractInvoice as never
);

export default router;
