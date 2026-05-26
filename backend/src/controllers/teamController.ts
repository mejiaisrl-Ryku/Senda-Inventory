import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, signRefreshToken, signInviteToken, verifyInviteToken, signResetToken } from "../lib/jwt";
import { sendInviteEmail, sendPasswordResetEmail } from "../lib/mailer";
import { AuthRequest } from "../types";

// ── Schemas ───────────────────────────────────────────────────────────────────

export const inviteSchema = z.object({
  name: z.string().min(1, "Name is required").max(255).trim(),
  email: z.string().email(),
  role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
});

export const createMemberSchema = z.object({
  name: z.string().min(1, "Name is required").max(255).trim(),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const registerViaInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1, "Name is required").max(255).trim(),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ── Select shape ──────────────────────────────────────────────────────────────

const memberSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;

// ── Handlers ──────────────────────────────────────────────────────────────────

/** GET /api/team — list all users in the admin's restaurant */
export async function listTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const members = await prisma.user.findMany({
      where: { restaurantId: req.user.restaurantId },
      select: memberSelect,
      orderBy: { email: "asc" },
    });
    res.json(members);
  } catch (err) {
    next(err);
  }
}

/** POST /api/team/invite — send an invite email */
export async function inviteTeamMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, email, role = "STAFF" } = req.body as { name: string; email: string; role?: "ADMIN" | "STAFF" };

    // Guard: don't invite someone already in this restaurant.
    const existing = await prisma.user.findFirst({
      where: { email, restaurantId: req.user.restaurantId },
    });
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists in this team." });
    }

    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: req.user.restaurantId },
      select: { name: true },
    });

    const token = signInviteToken({
      restaurantId: req.user.restaurantId,
      restaurantName: restaurant.name,
      role,
      email,
    });

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const inviteUrl = `${frontendUrl}/register?token=${token}`;

    console.log(`[inviteTeamMember] Calling sendInviteEmail to="${email}" restaurant="${restaurant.name}"`);

    const messageId = await sendInviteEmail({
      to: email,
      toName: name,
      restaurantName: restaurant.name,
      inviteUrl,
    });

    console.log(`[inviteTeamMember] ✓ Invite sent. Resend messageId="${messageId}" to="${email}"`);

    res.status(200).json({ ok: true, messageId });
  } catch (err) {
    console.error(`[inviteTeamMember] Failed to invite email="${(req.body as { email?: string }).email}":`, err);
    next(err);
  }
}

/** POST /api/team/create — admin directly creates a STAFF account */
export async function createTeamMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, email, password } = req.body as {
      name: string;
      email: string;
      password: string;
    };

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists." });
    }

    const hashed = await bcrypt.hash(password, 12);
    const member = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: "STAFF",
        restaurantId: req.user.restaurantId,
      },
      select: memberSelect,
    });

    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/team/:userId — remove a team member (cannot remove self) */
export async function removeTeamMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { userId } = req.params;

    if (userId === req.user.userId) {
      return res.status(400).json({ error: "You cannot remove yourself from the team." });
    }

    // Confirm the user belongs to this restaurant before deleting.
    const member = await prisma.user.findFirst({
      where: { id: userId, restaurantId: req.user.restaurantId },
    });
    if (!member) {
      return res.status(404).json({ error: "Team member not found." });
    }

    await prisma.user.delete({ where: { id: userId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/** POST /api/team/register-via-invite — PUBLIC: complete registration from an invite link */
export async function registerViaInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, name, email, password } = req.body as {
      token: string;
      name: string;
      email: string;
      password: string;
    };

    // Verify and decode the signed invite token.
    let payload;
    try {
      payload = verifyInviteToken(token);
    } catch {
      return res.status(400).json({ error: "Invite link is invalid or has expired." });
    }

    // The email in the form must match the invited email address.
    if (payload.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({
        error: `This invite was sent to ${payload.email}. Please use that email address.`,
      });
    }

    // Guard duplicate registration.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: payload.role,
        restaurantId: payload.restaurantId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        restaurantId: true,
        restaurant: { select: { name: true } },
      },
    });

    const tokens = {
      token: signToken({ userId: user.id, role: user.role, restaurantId: user.restaurantId ?? "" }),
      refreshToken: signRefreshToken({ userId: user.id, role: user.role, restaurantId: user.restaurantId ?? "" }),
    };

    const { restaurant, ...rest } = user;
    res.status(201).json({
      user: { ...rest, restaurantName: restaurant?.name ?? null },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/team/:userId/send-reset-email — admin triggers a reset email for a team member */
export async function sendTeamMemberResetEmail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { userId } = req.params;

    // Only allow resetting passwords for users in the same restaurant.
    const target = await prisma.user.findFirst({
      where: { id: userId, restaurantId: req.user.restaurantId },
    });
    if (!target) return res.status(404).json({ error: "User not found." });

    const token = signResetToken({ userId: target.id, email: target.email });
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    await sendPasswordResetEmail({
      to: target.email,
      toName: target.name ?? target.email,
      resetUrl,
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
