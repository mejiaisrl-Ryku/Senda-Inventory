import { Router, Response, NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { encrypt, decrypt } from "../lib/encryption";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getRestaurantInfo,
} from "../lib/toast-client";
import { setOAuthState, consumeOAuthState } from "../lib/toast-state";
import { syncTransactionsForRestaurant } from "../services/toast-sync";
import { AuthRequest } from "../types";
import { getFrontendUrl } from "../lib/urls";
import logger from "../utils/logger";

const router = Router();

// ── POST /api/toast/connect ───────────────────────────────────────────────────

async function connect(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: "No restaurant associated with this account." });
    }

    const state = crypto.randomBytes(24).toString("hex");
    await setOAuthState(state, restaurantId);

    const authUrl = getAuthorizationUrl(state);
    logger.info({ event: "toast_oauth_initiated", restaurantId });
    res.json({ authUrl });
  } catch (err) {
    next(err);
  }
}

router.post("/connect", authenticate as never, connect as never);

// ── GET /api/toast/callback ───────────────────────────────────────────────────
// Public — Toast redirects here after user consent.

const callbackQuerySchema = z.object({
  code:  z.string().min(1),
  state: z.string().min(1),
});

router.get("/callback", async (req, res: Response, next: NextFunction) => {
  const frontendUrl = getFrontendUrl();
  const errorRedirect = `${frontendUrl}/dashboard?toast=error`;

  try {
    const parsed = callbackQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Missing code or state parameter." });
    }
    const { code, state } = parsed.data;

    const restaurantId = await consumeOAuthState(state);
    if (!restaurantId) {
      return res
        .status(400)
        .json({ error: "Invalid or expired OAuth state. Please try connecting again." });
    }

    let tokens;
    try {
      tokens = await exchangeCodeForToken(code);
    } catch (err) {
      logger.error({ event: "toast_token_exchange_failed", restaurantId, err });
      return res.redirect(errorRedirect);
    }

    let locationInfo;
    try {
      locationInfo = await getRestaurantInfo(tokens.accessToken);
    } catch (err) {
      logger.error({ event: "toast_restaurant_info_failed", restaurantId, err });
      return res.redirect(errorRedirect);
    }

    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    await (prisma as any).toastConnection.upsert({
      where:  { restaurantId },
      create: {
        restaurantId,
        toastLocationId: locationInfo.locationGuid,
        accessToken:     encrypt(tokens.accessToken),
        refreshToken:    encrypt(tokens.refreshToken),
        expiresAt,
      },
      update: {
        toastLocationId: locationInfo.locationGuid,
        accessToken:     encrypt(tokens.accessToken),
        refreshToken:    encrypt(tokens.refreshToken),
        expiresAt,
      },
    });

    logger.info({ event: "toast_connected", restaurantId, locationGuid: locationInfo.locationGuid });
    res.redirect(`${frontendUrl}/dashboard?toast=connected`);
  } catch (err) {
    logger.error({ event: "toast_callback_error", err });
    next(err);
  }
});

// ── POST /api/toast/disconnect ────────────────────────────────────────────────

async function disconnect(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: "No restaurant associated with this account." });
    }

    await (prisma as any).toastConnection.deleteMany({ where: { restaurantId } });

    logger.info({ event: "toast_disconnected", restaurantId });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

router.post("/disconnect", authenticate as never, disconnect as never);

// ── GET /api/toast/status ─────────────────────────────────────────────────────

async function status(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: "No restaurant associated with this account." });
    }

    const connection = await (prisma as any).toastConnection.findUnique({ where: { restaurantId } });
    if (!connection) {
      return res.json({ connected: false });
    }

    // Auto-refresh if the access token has expired.
    if (connection.expiresAt <= new Date()) {
      try {
        const plainRefresh = decrypt(connection.refreshToken as string);
        const tokens = await refreshAccessToken(plainRefresh);
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

        await (prisma as any).toastConnection.update({
          where: { restaurantId },
          data: {
            accessToken:  encrypt(tokens.accessToken),
            refreshToken: encrypt(tokens.refreshToken),
            expiresAt,
          },
        });

        logger.info({ event: "toast_token_refreshed", restaurantId });

        return res.json({
          connected:  true,
          locationId: connection.toastLocationId,
          expiresAt:  expiresAt.toISOString(),
        });
      } catch (err) {
        logger.error({ event: "toast_refresh_failed", restaurantId, err });
        return res.json({ connected: false, reason: "token_refresh_failed" });
      }
    }

    res.json({
      connected:  true,
      locationId: connection.toastLocationId,
      expiresAt:  connection.expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

router.get("/status", authenticate as never, status as never);

// ── POST /api/toast/sync ──────────────────────────────────────────────────────
// Manually trigger a transaction sync for the authenticated restaurant.

async function sync(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: "No restaurant associated with this account." });
    }

    const result = await syncTransactionsForRestaurant(restaurantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

router.post("/sync", authenticate as never, sync as never);

// ── GET /api/toast/transactions ───────────────────────────────────────────────

const txQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  take:      z.coerce.number().int().min(1).max(500).optional().default(100),
  skip:      z.coerce.number().int().min(0).optional().default(0),
});

async function transactions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ error: "No restaurant associated with this account." });
    }

    const parsed = txQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters.", issues: parsed.error.flatten().fieldErrors });
    }
    const { startDate, endDate, take, skip } = parsed.data;

    const where: Record<string, unknown> = { restaurantId };
    if (startDate || endDate) {
      where.transactionDate = {
        ...(startDate ? { gte: new Date(`${startDate}T00:00:00.000Z`) } : {}),
        ...(endDate   ? { lte: new Date(`${endDate}T23:59:59.999Z`)   } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      (prisma as any).toastTransaction.findMany({
        where,
        orderBy: { transactionDate: "desc" },
        take,
        skip,
        select: {
          id:                 true,
          toastTransactionId: true,
          transactionDate:    true,
          amount:             true,
          category:           true,
          itemDetails:        true,
          status:             true,
          syncedAt:           true,
        },
      }),
      (prisma as any).toastTransaction.count({ where }),
    ]);

    res.json({ transactions: rows, total });
  } catch (err) {
    next(err);
  }
}

router.get("/transactions", authenticate as never, transactions as never);

export default router;
