import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, signRefreshToken, verifyRefreshToken, signResetToken, verifyResetToken } from "../lib/jwt";
import { sendPasswordResetEmail } from "../lib/mailer";
import { AuthRequest } from "../types";

// Self-service registration: any new user creates their own restaurant in one step.
export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(255).trim(),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  restaurantName: z.string().min(1, "Restaurant name is required").max(255).trim(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// Select shape — includes the restaurant relation so every response carries restaurantName + restaurantLogo.
const safeUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  restaurantId: true,
  restaurant: { select: { name: true, logo: true } },
} as const;

type SafeUserResult = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  restaurantId: string | null;
  restaurant: { name: string; logo: string | null } | null;
};

/** Flatten the nested restaurant relation into top-level restaurantName + restaurantLogo fields. */
function toUserResponse(u: SafeUserResult) {
  const { restaurant, ...rest } = u;
  return {
    ...rest,
    restaurantName: restaurant?.name ?? null,
    restaurantLogo: restaurant?.logo ?? null,
  };
}

function makeTokenPair(userId: string, role: string, restaurantId: string | null) {
  const payload = { userId, role, restaurantId: restaurantId ?? "" };
  return {
    token: signToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, password, restaurantName } = req.body as {
      name: string;
      email: string;
      password: string;
      restaurantName: string;
    };
    const hashed = await bcrypt.hash(password, 12);

    // Create the restaurant and the first ADMIN user atomically.
    const user = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({ data: { name: restaurantName } });
      return tx.user.create({
        data: { name, email, password: hashed, role: "ADMIN", restaurantId: restaurant.id },
        select: safeUser,
      });
    });

    const tokens = makeTokenPair(user.id, user.role, user.restaurantId);
    res.status(201).json({ user: toUserResponse(user), ...tokens });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    // Fetch full row for bcrypt compare, then re-query with safeUser select.
    const raw = await prisma.user.findUnique({ where: { email } });
    // Use constant-time compare even when user is not found to prevent timing attacks.
    const passwordMatch = raw
      ? await bcrypt.compare(password, raw.password)
      : await bcrypt.compare(password, "$2b$12$placeholder.hash.that.never.matches");
    if (!raw || !passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    // Re-fetch with the safe select so we get the restaurant join.
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: raw.id },
      select: safeUser,
    });
    const tokens = makeTokenPair(user.id, user.role, user.restaurantId);
    res.json({ user: toUserResponse(user), ...tokens });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;
    let payload: ReturnType<typeof verifyRefreshToken>;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }
    // Re-verify the user still exists and hasn't been deleted/suspended.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: safeUser,
    });
    if (!user) return res.status(401).json({ error: "User no longer exists" });
    const tokens = makeTokenPair(user.id, user.role, user.restaurantId);
    res.json({ user: toUserResponse(user), ...tokens });
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: AuthRequest, res: Response) {
  // JWT is stateless — the client drops both tokens.
  res.json({ message: "Logged out successfully" });
}

export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.userId },
      select: safeUser,
    });
    res.json(toUserResponse(user));
  } catch (err) {
    next(err);
  }
}

// ── Password reset ────────────────────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * POST /api/auth/forgot-password
 * Always returns 204 regardless of whether the email exists (avoids email enumeration).
 */
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body as { email: string };
    const user = await prisma.user.findUnique({ where: { email } });

    // Silently succeed when user not found — don't leak account existence.
    if (user) {
      const token = signResetToken({ userId: user.id, email: user.email });
      const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
      const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

      // Fire-and-forget — don't let email errors block the response.
      sendPasswordResetEmail({
        to: user.email,
        toName: user.name ?? user.email,
        resetUrl,
      }).catch((err) => console.error("[mailer] password reset email failed:", err));
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/reset-password
 * Validates the reset token and updates the user's password.
 */
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = req.body as { token: string; password: string };

    let payload: ReturnType<typeof verifyResetToken>;
    try {
      payload = verifyResetToken(token);
    } catch {
      return res.status(400).json({ error: "Reset link is invalid or has expired." });
    }

    // Confirm user still exists.
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return res.status(400).json({ error: "User not found." });

    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
