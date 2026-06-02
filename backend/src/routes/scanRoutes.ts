import { Router } from "express";
import multer from "multer";
import { authenticate, requireAdmin } from "../middleware/auth";
import { scanInventory } from "../controllers/scanController";

// In-memory storage — no disk writes
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB hard limit at transport layer
});

const router = Router();

router.use(authenticate as never);

// POST /api/inventory/scan — ADMIN (GM) only
router.post(
  "/scan",
  requireAdmin as never,
  upload.single("image"),
  scanInventory as never
);

export default router;
