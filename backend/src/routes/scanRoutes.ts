import { Router } from "express";
import multer from "multer";
import { authenticate, requireAdmin } from "../middleware/auth";
import { enqueueInventoryScan } from "../controllers/scanJobController";

// In-memory storage — no disk writes; the buffer goes straight to S3.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB hard limit at transport layer
});

const router = Router();

router.use(authenticate as never);

// POST /api/inventory/scan — ADMIN (GM) only.
// Enqueues a ScanJob instead of calling Claude inline (Sprint 1).
// A worker (Sprint 2) performs the scan; poll GET /api/scan-jobs/:jobId.
router.post(
  "/scan",
  requireAdmin as never,
  upload.single("image"),
  enqueueInventoryScan as never
);

export default router;
