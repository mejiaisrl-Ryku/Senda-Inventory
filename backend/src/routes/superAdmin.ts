import { Router } from "express";
import { authenticate, requireSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  superAdminLogin,
  superAdminLoginSchema,
  listRestaurants,
  createRestaurant,
  deleteRestaurant,
  getRestaurantDetail,
  toggleSuspendRestaurant,
  listAllUsers,
  inviteAdmin,
  sendUserResetEmail,
  createRestaurantSchema,
  inviteAdminSchema,
} from "../controllers/superAdminController";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
// Login must be registered BEFORE the authenticate/requireSuperAdmin wall.
router.post("/login", validate(superAdminLoginSchema), superAdminLogin as never);

// ── Protected — valid JWT + SUPER_ADMIN role required ────────────────────────
router.use(authenticate as never);
router.use(requireSuperAdmin as never);

// Restaurants
router.get("/restaurants", listRestaurants as never);
router.post("/restaurants", validate(createRestaurantSchema), createRestaurant as never);
router.get("/restaurants/:id", getRestaurantDetail as never);
router.patch("/restaurants/:id/suspend", toggleSuspendRestaurant as never);
router.delete("/restaurants/:id", deleteRestaurant as never);

// Users (cross-restaurant)
router.get("/users", listAllUsers as never);
router.post("/users/:userId/send-reset-email", sendUserResetEmail as never);

// Invite a new admin to an existing restaurant
router.post("/invite", validate(inviteAdminSchema), inviteAdmin as never);

export default router;
