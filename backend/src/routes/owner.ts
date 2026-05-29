import { Router } from "express";
import { authenticate, requireOwnerSelfService } from "../middleware/auth";
import { getOwnerMe, getOwnerRestaurants } from "../controllers/ownerController";

const router = Router();

router.use(authenticate as never);
router.use(requireOwnerSelfService as never);

router.get("/me",          getOwnerMe          as never);
router.get("/restaurants", getOwnerRestaurants as never);

export default router;
