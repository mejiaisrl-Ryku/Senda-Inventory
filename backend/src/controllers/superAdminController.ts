import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, signRefreshToken, signInviteToken, signResetToken } from "../lib/jwt";
import { sendInviteEmail, sendPasswordResetEmail } from "../lib/mailer";
import { AuthRequest } from "../types";

// ── Validation schemas ────────────────────────────────────────────────────────

export const superAdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createRestaurantSchema = z.object({
  name: z.string().min(1, "Restaurant name is required").max(255).trim(),
  adminName: z.string().min(1, "Admin name is required").max(255).trim(),
  adminEmail: z.string().email("Invalid email address"),
  adminPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const inviteAdminSchema = z.object({
  name: z.string().min(1, "Name is required").max(255).trim(),
  email: z.string().email("Invalid email address"),
  restaurantId: z.string().min(1, "Restaurant ID is required"),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/super-admin/login  (PUBLIC — no auth middleware)
 * Authenticates a user and rejects anyone whose role is not SUPER_ADMIN.
 * Role compared as a plain string — no dependency on the Prisma enum.
 */
export async function superAdminLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const raw = await prisma.user.findUnique({ where: { email } });

    // Constant-time compare even when the user doesn't exist.
    const passwordMatch = raw
      ? await bcrypt.compare(password, raw.password)
      : await bcrypt.compare(password, "$2b$12$placeholder.hash.that.never.matches");

    if (!raw || !passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // String comparison — independent of the Prisma-generated Role enum.
    if ((raw.role as string) !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied — super-admin account required." });
    }

    const payload = { userId: raw.id, role: raw.role as string, restaurantId: raw.restaurantId ?? "" };

    res.json({
      user: { id: raw.id, name: raw.name, email: raw.email, role: raw.role as string },
      token: signToken(payload),
      refreshToken: signRefreshToken(payload),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/super-admin/restaurants
 * List every restaurant with its owner name/email, user count, and creation date.
 */
export async function listRestaurants(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurants = await prisma.restaurant.findMany({
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        logo: true,
        createdAt: true,
        _count: { select: { users: true, products: true } },
        users: {
          where: { role: "ADMIN" },
          select: { name: true, email: true },
          take: 1,
          orderBy: { email: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const response = restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      phone: r.phone,
      logo: r.logo,
      createdAt: r.createdAt,
      userCount: r._count.users,
      productCount: r._count.products,
      owner: r.users[0] ?? null,
    }));

    res.json(response);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/super-admin/restaurants
 * Create a restaurant and its first ADMIN user in a single transaction.
 */
export async function createRestaurant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, adminName, adminEmail, adminPassword } = req.body as {
      name: string;
      adminName: string;
      adminEmail: string;
      adminPassword: string;
    };

    // Guard duplicate email before the transaction.
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists." });
    }

    const hashed = await bcrypt.hash(adminPassword, 12);

    const result = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({ data: { name } });
      const admin = await tx.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          password: hashed,
          role: "ADMIN",
          restaurantId: restaurant.id,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      return { restaurant, admin };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/super-admin/restaurants/:id
 * Hard-delete a restaurant and all of its data (cascade configured in schema).
 */
export async function deleteRestaurant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const restaurant = await prisma.restaurant.findUnique({ where: { id } });
    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found." });
    }

    await prisma.restaurant.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/super-admin/users
 * List all users across every restaurant, including their restaurant name.
 */
export async function listAllUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        restaurantId: true,
        restaurant: { select: { name: true } },
      },
      orderBy: [{ restaurant: { name: "asc" } }, { email: "asc" }],
    });

    const response = users.map(({ restaurant, ...u }) => ({
      ...u,
      restaurantName: restaurant?.name ?? null,
    }));

    res.json(response);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/super-admin/invite
 * Send a Resend invite email to a prospective ADMIN for a specific restaurant.
 * The invite link lands on /register?token=<jwt> — same flow as team invites.
 */
export async function inviteAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, email, restaurantId } = req.body as {
      name: string;
      email: string;
      restaurantId: string;
    };

    console.log(`[inviteAdmin] Invite requested: email="${email}" restaurant="${restaurantId}"`);

    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) {
      console.warn(`[inviteAdmin] Restaurant not found: ${restaurantId}`);
      return res.status(404).json({ error: "Restaurant not found." });
    }

    // Don't invite someone who already has an account in this restaurant.
    const existing = await prisma.user.findFirst({ where: { email, restaurantId } });
    if (existing) {
      console.warn(`[inviteAdmin] Duplicate invite blocked: ${email} already in restaurant ${restaurantId}`);
      return res.status(409).json({ error: "A user with that email already exists in this team." });
    }

    const token = signInviteToken({
      restaurantId,
      restaurantName: restaurant.name,
      role: "ADMIN",
      email,
    });

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const inviteUrl = `${frontendUrl}/register?token=${token}`;

    console.log(`[inviteAdmin] Calling sendInviteEmail to="${email}" restaurant="${restaurant.name}" frontendUrl="${frontendUrl}"`);

    const messageId = await sendInviteEmail({
      to: email,
      toName: name,
      restaurantName: restaurant.name,
      inviteUrl,
    });

    console.log(`[inviteAdmin] ✓ Invite email sent. Resend messageId="${messageId}" to="${email}"`);

    // Return 200 with the Resend message ID so the caller can confirm delivery.
    res.status(200).json({ ok: true, messageId });
  } catch (err) {
    console.error(`[inviteAdmin] Failed to send invite to email="${(req.body as { email?: string }).email}":`, err);
    next(err);
  }
}

/** POST /api/super-admin/users/:userId/send-reset-email — super admin triggers a reset email */
export async function sendUserResetEmail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { userId } = req.params;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: "User not found." });

    console.log(`[sendUserResetEmail] Sending password reset to email="${target.email}" userId="${userId}"`);

    const token = signResetToken({ userId: target.id, email: target.email });
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    const messageId = await sendPasswordResetEmail({
      to: target.email,
      toName: target.name ?? target.email,
      resetUrl,
    });

    console.log(`[sendUserResetEmail] ✓ Reset email sent. Resend messageId="${messageId}" to="${target.email}"`);

    res.status(200).json({ ok: true, messageId });
  } catch (err) {
    console.error(`[sendUserResetEmail] Failed for userId="${req.params.userId}":`, err);
    next(err);
  }
}

/**
 * GET /api/super-admin/restaurants/:id
 * Full detail view: restaurant info + users + product summary.
 */
export async function getRestaurantDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        logo: true,
        suspended: true,
        suspendedAt: true,
        createdAt: true,
        users: {
          select: { id: true, name: true, email: true, role: true },
          orderBy: [{ role: "asc" }, { email: "asc" }],
        },
        products: {
          select: { id: true, department: true, category: true, cogsCategory: true },
        },
        _count: { select: { products: true, users: true } },
      },
    });

    if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });

    // Product summary by department
    const deptCount: Record<string, number> = {};
    const categoryCount: Record<string, number> = {};
    for (const p of restaurant.products) {
      const dept = p.department ?? "BOH";
      deptCount[dept] = (deptCount[dept] ?? 0) + 1;
      const cat = p.category ?? "Uncategorized";
      categoryCount[cat] = (categoryCount[cat] ?? 0) + 1;
    }

    const { products, _count, ...rest } = restaurant;

    res.json({
      ...rest,
      userCount: _count.users,
      productCount: _count.products,
      productSummary: { byDept: deptCount, byCategory: categoryCount },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/super-admin/restaurants/:id/suspend
 * Toggle the suspended flag on a restaurant.
 */
export async function toggleSuspendRestaurant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const restaurant = await prisma.restaurant.findUnique({ where: { id } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });

    const nowSuspended = !restaurant.suspended;
    const updated = await prisma.restaurant.update({
      where: { id },
      data: {
        suspended: nowSuspended,
        suspendedAt: nowSuspended ? new Date() : null,
      },
      select: { id: true, suspended: true, suspendedAt: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/super-admin/restaurants/:id/logo
 * Set or clear the restaurant logo (base64 data URL). Pass null to remove.
 */
export async function updateRestaurantLogo(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { logo } = req.body as { logo: string | null };

    // Validate: must be a data URL or null
    if (logo !== null && logo !== undefined) {
      if (typeof logo !== "string") {
        return res.status(400).json({ error: "logo must be a base64 data URL string or null." });
      }
      if (!logo.startsWith("data:image/")) {
        return res.status(400).json({ error: "logo must be a valid image data URL." });
      }
      // Rough size guard: base64 of 2 MB ≈ 2.73 MB of chars
      if (logo.length > 3_000_000) {
        return res.status(400).json({ error: "Logo exceeds the 2 MB limit." });
      }
    }

    const restaurant = await prisma.restaurant.findUnique({ where: { id } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });

    const updated = await prisma.restaurant.update({
      where: { id },
      data: { logo: logo ?? null },
      select: { id: true, logo: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
