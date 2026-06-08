import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import {
  getLocationsOverview,
  getLocationsRecipes,
  getLocationsPricing,
  getLocationsCapacity,
  getVarianceAnalysis,
  getParLevelBenchmark,
  copyParLevels,
  getCostBreakdown,
  getLaborBreakdown,
  getWasteAnalysis,
  addBranch,
  deleteBranch,
} from "../controllers/locationsController";
import { seedTestLocations, clearTestLocations } from "../controllers/seedController";

const router = Router();

router.use(authenticate as never);

// ── Read endpoints ────────────────────────────────────────────────────────────
router.get("/overview",          getLocationsOverview  as never);
router.get("/recipes",           getLocationsRecipes   as never);
router.get("/vendor-pricing",    getLocationsPricing   as never);
router.get("/capacity",          getLocationsCapacity  as never);
router.get("/variance-analysis", getVarianceAnalysis   as never);
router.get( "/par-levels",       getParLevelBenchmark  as never);
router.post("/par-levels/copy",  copyParLevels         as never);
router.get( "/cost-breakdown",   getCostBreakdown      as never);
router.get( "/labor-breakdown",  getLaborBreakdown     as never);
router.get( "/waste-analysis",   getWasteAnalysis      as never);

// ── Location management (admin only) ─────────────────────────────────────────
router.post(  "/branch",             requireAdmin as never, addBranch    as never);
router.delete("/branch/:locationId", requireAdmin as never, deleteBranch as never);

// ── Dev / QA seed tools — NOT registered in production ───────────────────────
// These routes wipe and recreate test location data. They must never be
// reachable in production even though they require ADMIN role, because an
// admin could accidentally trigger them against live client data.
if (process.env.NODE_ENV !== "production") {
  router.post(  "/seed-test", requireAdmin as never, seedTestLocations  as never);
  router.delete("/seed-test", requireAdmin as never, clearTestLocations as never);
}

export default router;
