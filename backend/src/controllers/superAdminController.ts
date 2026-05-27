import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, signRefreshToken, signInviteToken, signResetToken } from "../lib/jwt";
import { sendInviteEmail, sendPasswordResetEmail, sendPartnerInviteEmail } from "../lib/mailer";
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

export const completePartnerSetupSchema = z.object({
  token:          z.string().min(1,  "Token is required"),
  restaurantName: z.string().min(1,  "Restaurant name is required").max(255).trim(),
  password:       z.string().min(8,  "Password must be at least 8 characters"),
  logo:           z.string().optional().nullable(), // base64 data URL, max ~3.6 MB encoded
});

export const createPartnerInviteSchema = z.object({
  firstName:     z.string().min(1, "First name is required").max(100).trim(),
  lastName:      z.string().min(1, "Last name is required").max(100).trim(),
  email:         z.string().email("Invalid email address"),
  locationCount: z.number().int().min(1).max(10).default(1),
});

export const inviteAdminSchema = z.object({
  firstName:    z.string().min(1, "First name is required").max(255).trim(),
  lastName:     z.string().min(1, "Last name is required").max(255).trim(),
  email:        z.string().email("Invalid email address"),
  restaurantId: z.string().min(1, "Restaurant ID is required"),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/super-admin/partner-invites/validate/:token  (PUBLIC)
 * Returns invite metadata (firstName, lastName, email, expiresAt) if the token
 * is valid and still pending.  Returns 404 (not found) or 410 (used / expired).
 */
export async function validatePartnerInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.params;
    const invite = await prisma.partnerInvite.findUnique({ where: { token } });

    if (!invite) {
      return res.status(404).json({ code: "INVALID",   error: "Invalid invite link." });
    }
    if (invite.status === "accepted") {
      return res.status(410).json({ code: "ACCEPTED",  error: "This invite has already been used." });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ code: "EXPIRED",   error: "This invite has expired. Contact your administrator." });
    }

    res.json({
      email:     invite.email,
      firstName: invite.firstName,
      lastName:  invite.lastName,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/super-admin/partner-setup  (PUBLIC)
 * Completes partner onboarding: creates the restaurant + admin user in a
 * transaction, marks the invite as "accepted", and returns auth tokens so
 * the frontend can log the new admin in immediately.
 */
export async function completePartnerSetup(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, restaurantName, password, logo } = req.body as {
      token: string;
      restaurantName: string;
      password: string;
      logo?: string | null;
    };

    console.log(`[completePartnerSetup] Attempt with token="${token.slice(0, 8)}…"`);

    // Re-validate the invite (same checks as GET, in case of a race).
    const invite = await prisma.partnerInvite.findUnique({ where: { token } });
    if (!invite) {
      return res.status(404).json({ code: "INVALID",  error: "Invalid invite link." });
    }
    if (invite.status === "accepted") {
      return res.status(410).json({ code: "ACCEPTED", error: "This invite has already been used." });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ code: "EXPIRED",  error: "This invite has expired. Contact your administrator." });
    }

    // Guard against a race where an account was created between the GET and POST.
    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) {
      return res.status(409).json({ code: "ACCEPTED", error: "An account already exists for this email. Please sign in." });
    }

    const hashed = await bcrypt.hash(password, 12);

    // Atomic: create restaurant → create admin user → mark invite accepted.
    const user = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({
        data: {
          name:          restaurantName.trim(),
          locationCount: invite.locationCount ?? 1,
          ...(logo ? { logo } : {}),
        },
      });

      const newUser = await tx.user.create({
        data: {
          name:         `${invite.firstName} ${invite.lastName}`,
          email:        invite.email,
          password:     hashed,
          role:         "ADMIN",
          restaurantId: restaurant.id,
        },
        select: {
          id:           true,
          name:         true,
          email:        true,
          role:         true,
          restaurantId: true,
          restaurant:   { select: { name: true, logo: true } },
        },
      });

      await tx.partnerInvite.update({
        where: { token },
        data:  { status: "accepted" },
      });

      return newUser;
    });

    // Flatten restaurant relation — matches the shape returned by login/register.
    const { restaurant: rest, ...userFields } = user;
    const userResponse = {
      ...userFields,
      restaurantName: rest?.name ?? null,
      restaurantLogo: rest?.logo ?? null,
    };

    const tokenPayload = { userId: user.id, role: user.role, restaurantId: user.restaurantId! };

    console.log(`[completePartnerSetup] ✓ Partner onboarded. userId="${user.id}" restaurant="${restaurantName}"`);

    res.status(201).json({
      user:         userResponse,
      token:        signToken(tokenPayload),
      refreshToken: signRefreshToken(tokenPayload),
    });
  } catch (err) {
    console.error(`[completePartnerSetup] Failed:`, err);
    next(err);
  }
}

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
 * POST /api/super-admin/partner-invites
 * Send a setup invite email to a prospective partner (new restaurant admin).
 * Creates a PartnerInvite record with status="pending" and a 72-hour token.
 * No restaurant or user is created yet — that happens during onboarding.
 */
export async function createPartnerInvite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { firstName, lastName, email, locationCount = 1 } = req.body as {
      firstName: string;
      lastName: string;
      email: string;
      locationCount?: number;
    };

    console.log(`[createPartnerInvite] Invite requested for email="${email}" name="${firstName} ${lastName}"`);

    // Reject if there's already a live pending invite for this address.
    const existing = await prisma.partnerInvite.findUnique({ where: { email } });
    if (existing && existing.status === "pending" && existing.expiresAt > new Date()) {
      console.warn(`[createPartnerInvite] Live pending invite already exists for ${email}`);
      return res.status(409).json({
        error: "A pending invite already exists for this email address. Resend or delete it first.",
      });
    }

    // Also reject if a full user account already exists.
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "A user account already exists for this email address." });
    }

    // Generate a cryptographically-secure 64-char hex token.
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    // Upsert so a previously expired invite for the same email gets replaced.
    const invite = await prisma.partnerInvite.upsert({
      where:  { email },
      create: { email, firstName, lastName, token, status: "pending", expiresAt, locationCount },
      update: { firstName, lastName, token, status: "pending", expiresAt, locationCount },
    });

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const setupUrl = `${frontendUrl}/partner-setup?token=${token}`;

    console.log(`[createPartnerInvite] Sending invite email to="${email}" setupUrl="${setupUrl}"`);

    const messageId = await sendPartnerInviteEmail({ to: email, firstName, setupUrl });

    console.log(`[createPartnerInvite] ✓ Invite sent. inviteId="${invite.id}" Resend messageId="${messageId}" to="${email}"`);

    res.status(201).json({
      id: invite.id,
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
      expiresAt: invite.expiresAt,
      messageId,
    });
  } catch (err) {
    console.error(`[createPartnerInvite] Failed for email="${(req.body as { email?: string }).email}":`, err);
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
    const { firstName, lastName, email, restaurantId } = req.body as {
      firstName: string;
      lastName: string;
      email: string;
      restaurantId: string;
    };
    const name = `${firstName} ${lastName}`.trim();

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
        locationCount: true,
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
      locationCount: restaurant.locationCount,
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

// ── Partner location management ───────────────────────────────────────────────

const LOC_NAME_MIN = 2;
const LOC_NAME_MAX = 50;

/**
 * GET /api/super-admin/partners/:partnerId/locations
 * Returns all locations in the partner's group (primary + branches).
 */
export async function listPartnerLocations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { partnerId } = req.params;

    const primary = await prisma.restaurant.findUnique({
      where: { id: partnerId },
      select: { id: true, locationCount: true },
    });
    if (!primary) return res.status(404).json({ error: "Partner not found." });

    const locations = await prisma.restaurant.findMany({
      where: { OR: [{ id: partnerId }, { groupId: partnerId }] },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        groupId: true,
        _count: { select: { users: true, products: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        phone: l.phone,
        groupId: l.groupId,
        userCount: l._count.users,
        productCount: l._count.products,
        isPrimary: l.id === partnerId,
      })),
      totalLocations: locations.length,
      maxLocations: primary.locationCount,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/super-admin/partners/:partnerId/locations
 * Create a new branch for this partner (respects locationCount cap).
 */
export async function addPartnerLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { partnerId } = req.params;
    const { name, address, phone } = req.body as { name: string; address?: string; phone?: string };

    const trimmed = (name ?? "").trim();
    if (trimmed.length < LOC_NAME_MIN || trimmed.length > LOC_NAME_MAX) {
      return res.status(400).json({ error: `Name must be ${LOC_NAME_MIN}–${LOC_NAME_MAX} characters.` });
    }

    const primary = await prisma.restaurant.findUnique({
      where: { id: partnerId },
      select: { id: true, locationCount: true },
    });
    if (!primary) return res.status(404).json({ error: "Partner not found." });

    const currentCount = await prisma.restaurant.count({
      where: { OR: [{ id: partnerId }, { groupId: partnerId }] },
    });
    if (currentCount >= primary.locationCount) {
      return res.status(409).json({ error: `Location limit of ${primary.locationCount} reached.` });
    }

    // Name uniqueness within group
    const duplicate = await prisma.restaurant.findFirst({
      where: {
        OR: [{ id: partnerId }, { groupId: partnerId }],
        name: { equals: trimmed, mode: "insensitive" },
      },
    });
    if (duplicate) {
      return res.status(409).json({ error: "A location with that name already exists." });
    }

    const location = await prisma.restaurant.create({
      data: {
        name: trimmed,
        address: address?.trim() || null,
        phone:   phone?.trim()   || null,
        groupId: partnerId,
        locationCount: 1,
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        groupId: true,
        _count: { select: { users: true, products: true } },
      },
    });

    res.status(201).json({
      id: location.id,
      name: location.name,
      address: location.address,
      phone: location.phone,
      groupId: location.groupId,
      userCount: location._count.users,
      productCount: location._count.products,
      isPrimary: false,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/super-admin/partners/:partnerId/locations/:locationId
 * Delete a branch location. Cannot delete the primary, or any location
 * that still has users.
 */
export async function deletePartnerLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { partnerId, locationId } = req.params;

    if (locationId === partnerId) {
      return res.status(400).json({ error: "Cannot delete the primary location." });
    }

    const location = await prisma.restaurant.findUnique({
      where: { id: locationId },
      select: { id: true, groupId: true, _count: { select: { users: true } } },
    });
    if (!location) return res.status(404).json({ error: "Location not found." });
    if (location.groupId !== partnerId) {
      return res.status(403).json({ error: "Location does not belong to this partner." });
    }
    if (location._count.users > 0) {
      return res.status(423).json({
        error: `This location has ${location._count.users} user(s). Remove users first before deleting.`,
      });
    }

    await prisma.restaurant.delete({ where: { id: locationId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
