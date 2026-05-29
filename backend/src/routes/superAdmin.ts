import { Router } from "express";
import { authenticate, requireSuperAdmin, requireKyruManager } from "../middleware/auth";
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
  validatePartnerInvite,
  completePartnerSetup,
  createRestaurantSchema,
  inviteAdminSchema,
  createPartnerInviteSchema,
  completePartnerSetupSchema,
  listPartnerLocations,
  addPartnerLocation,
  deletePartnerLocation,
  listStandaloneRestaurants,
  mergeRestaurants,
  createOwnerAccount,
  listOwnerAccounts,
  getOwnerAccount,
  assignRestaurantToOwner,
  deleteOwnerAccount,
} from "../controllers/superAdminController";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
// These routes are registered BEFORE the authenticate/requireSuperAdmin wall.

// Super-admin login
router.post("/login", validate(superAdminLoginSchema), superAdminLogin as never);

// Partner onboarding — no auth required (the invite token is the credential)
router.get("/partner-invites/validate/:token", validatePartnerInvite as never);
router.post("/partner-setup", validate(completePartnerSetupSchema), completePartnerSetup as never);

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

// Partner location management (super-admin manages branches for any partner)
router.get(   "/partners/:partnerId/locations",                listPartnerLocations as never);
router.post(  "/partners/:partnerId/locations",                addPartnerLocation   as never);
router.delete("/partners/:partnerId/locations/:locationId",    deletePartnerLocation as never);

// Merge standalone restaurants into a multi-location group
router.get(  "/standalone-restaurants", listStandaloneRestaurants as never);
router.post( "/merge-restaurants",      mergeRestaurants          as never);

// ── Owner Account Management (KYRU_MANAGER only) ─────────────────────────────
router.post(  "/owner-accounts",                                   requireKyruManager as never, createOwnerAccount      as never);
router.get(   "/owner-accounts",                                   requireKyruManager as never, listOwnerAccounts       as never);
router.get(   "/owner-accounts/:ownerAccountId",                   requireKyruManager as never, getOwnerAccount        as never);
router.post(  "/owner-accounts/:ownerAccountId/assign-restaurants", requireKyruManager as never, assignRestaurantToOwner as never);
router.delete("/owner-accounts/:ownerAccountId",                   requireKyruManager as never, deleteOwnerAccount     as never);

export default router;
