import { Router } from "express";
import { authenticate, requireSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  listRestaurants,
  createRestaurant,
  deleteRestaurant,
  listAllUsers,
  inviteAdmin,
  createRestaurantSchema,
  inviteAdminSchema,
} from "../controllers/superAdminController";

const router = Router();

// Every route under /api/super-admin requires a valid JWT AND SUPER_ADMIN role.
router.use(authenticate as never);
router.use(requireSuperAdmin as never);

// Restaurants
router.get("/restaurants", listRestaurants as never);
router.post("/restaurants", validate(createRestaurantSchema), createRestaurant as never);
router.delete("/restaurants/:id", deleteRestaurant as never);

// Users (cross-restaurant)
router.get("/users", listAllUsers as never);

// Invite a new admin to an existing restaurant
router.post("/invite", validate(inviteAdminSchema), inviteAdmin as never);

export default router;
