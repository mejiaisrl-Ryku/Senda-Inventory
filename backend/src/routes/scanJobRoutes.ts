import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getScanJobStatus } from "../controllers/scanJobController";

const router = Router();

router.use(authenticate as never);

// GET /api/scan-jobs/:jobId — poll for invoice/inventory scan results.
// Tenant isolation enforced by prismaT (RLS), not a manual check here —
// ADMIN and STAFF can both poll a job their own restaurant created.
router.get("/:jobId", getScanJobStatus as never);

export default router;
