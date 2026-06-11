/**
 * POST /api/leads — public trial-request capture from the marketing landing
 * page (kyruadvisory.com/inicio).
 *
 * CLIENT CHOICE: uses the base `prisma` client deliberately.
 * The leads table has NO RLS — it is pre-auth public capture with no tenant,
 * same category as users/restaurants. prismaT would inject a tenant filter
 * that can never match (no session), and prismaAdmin (BYPASSRLS) is reserved
 * for cross-tenant admin reads. See lib/prisma.ts header.
 */
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { sendLeadNotification } from "../lib/mailer";
import logger from "../utils/logger";

export const createLeadSchema = z.object({
  name:       z.string().min(1, "Name is required").max(200).trim(),
  restaurant: z.string().min(1, "Restaurant is required").max(200).trim(),
  locations:  z.string().max(10).trim().default("1"),
  // Basic sanity: 7–20 chars of digits/+/-/spaces/parens after trimming.
  phone:      z.string().trim().regex(/^[+()\-.\s\d]{7,20}$/, "Invalid phone number"),
  language:   z.enum(["en", "es"]).default("es"),
  pageLang:   z.enum(["en", "es"]).default("es"),
  // Honeypot — humans never see this field; bots auto-fill it.
  company:    z.string().optional(),
});

export async function createLead(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, restaurant, locations, phone, language, pageLang, company } =
      req.body as z.infer<typeof createLeadSchema>;

    // Honeypot tripped — pretend success, store nothing.
    if (company) {
      logger.info({ event: "lead_honeypot", ip: req.ip });
      return res.status(204).end();
    }

    const lead = await prisma.lead.create({
      data: { name, restaurant, locations, phone, language, pageLang },
    });

    // Fire-and-forget notification — email failure must never fail the lead.
    sendLeadNotification(lead).catch((err: Error) => {
      logger.error({ event: "lead_email_failed", leadId: lead.id, error: err.message });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require("@sentry/node").captureException(err);
      } catch { /* sentry not initialized — already logged above */ }
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}
