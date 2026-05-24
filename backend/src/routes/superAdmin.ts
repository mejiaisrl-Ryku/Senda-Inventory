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
  updateRestaurantLogo,
  listAllUsers,
  inviteAdmin,
  sendUserResetEmail,
  createPartnerInvite,
  createRestaurantSchema,
  inviteAdminSchema,
  createPartnerInviteSchema,
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
router.put("/restaurants/:id/logo", updateRestaurantLogo as never);
router.delete("/restaurants/:id", deleteRestaurant as never);

// Users (cross-restaurant)
router.get("/users", listAllUsers as never);
router.post("/users/:userId/send-reset-email", sendUserResetEmail as never);

// Invite a new admin to an existing restaurant
router.post("/invite", validate(inviteAdminSchema), inviteAdmin as never);

// Partner invites — send setup email, create pending invite record (no restaurant yet)
router.post("/partner-invites", validate(createPartnerInviteSchema), createPartnerInvite as never);

export default router;
