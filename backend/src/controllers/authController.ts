import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt";
import { AuthRequest } from "../types";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
  restaurantId: z.string().cuid(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const safeUser = { id: true, email: true, role: true, restaurantId: true } as const;

function makeTokenPair(userId: string, role: import("@prisma/client").Role, restaurantId: string) {
  const payload = { userId, role, restaurantId };
  return {
    token: signToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, role, restaurantId } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashed, role, restaurantId },
      select: safeUser,
    });
    const tokens = makeTokenPair(user.id, user.role, user.restaurantId);
    res.status(201).json({ user, ...tokens });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    // Use constant-time compare even when user is not found to prevent timing attacks.
    const passwordMatch = user
      ? await bcrypt.compare(password, user.password)
      : await bcrypt.compare(password, "$2b$12$placeholder.hash.that.never.matches");
    if (!user || !passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const tokens = makeTokenPair(user.id, user.role, user.restaurantId);
    res.json({
      user: { id: user.id, email: user.email, role: user.role, restaurantId: user.restaurantId },
      ...tokens,
    });
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
    res.json({ user, ...tokens });
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
    res.json(user);
  } catch (err) {
    next(err);
  }
}
