import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getLocationsOverview, getLocationsRecipes, getLocationsPricing } from "../controllers/locationsController";
import { seedTestLocations, clearTestLocations } from "../controllers/seedController";

const router = Router();

router.use(authenticate as never);

router.get("/overview",   getLocationsOverview  as never);
router.get("/recipes",        getLocationsRecipes   as never);
router.get("/vendor-pricing", getLocationsPricing   as never);
router.post("/seed-test", requireAdmin as never, seedTestLocations as never);
router.delete("/seed-test", requireAdmin as never, clearTestLocations as never);

export default router;
