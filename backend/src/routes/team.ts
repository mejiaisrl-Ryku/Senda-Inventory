import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  listTeam,
  inviteTeamMember,
  createTeamMember,
  removeTeamMember,
  registerViaInvite,
  sendTeamMemberResetEmail,
  inviteSchema,
  createMemberSchema,
  registerViaInviteSchema,
} from "../controllers/teamController";

const router = Router();

// Public — no auth required (invite link flow)
router.post(
  "/register-via-invite",
  validate(registerViaInviteSchema),
  registerViaInvite as never
);

// All remaining routes require ADMIN
router.use(authenticate as never);
router.use(requireAdmin as never);

router.get("/", listTeam as never);
router.post("/invite", validate(inviteSchema), inviteTeamMember as never);
router.post("/create", validate(createMemberSchema), createTeamMember as never);
router.post("/:userId/send-reset-email", sendTeamMemberResetEmail as never);
router.delete("/:userId", removeTeamMember as never);

export default router;
