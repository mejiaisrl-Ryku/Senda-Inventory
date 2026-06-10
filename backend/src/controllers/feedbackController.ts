import { Response, NextFunction } from "express";
import { z } from "zod";
import { prismaT as prisma } from "../lib/prisma";
import { sendFeedbackEmail } from "../lib/mailer";
import { AuthRequest } from "../types";

const feedbackSchema = z.object({
  message: z.string().min(1).max(2000),
});

export async function submitFeedback(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parse = feedbackSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Message is required." });
    }
    const { message } = parse.data;

    // Fetch full user (name + restaurant) so the email has useful context.
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        name: true,
        email: true,
        role: true,
        restaurant: { select: { name: true } },
      },
    });

    if (!user) return res.status(404).json({ error: "User not found." });

    const fromName    = user.name ?? user.email;
    const restaurant  = user.restaurant?.name ?? "N/A";
    const timestamp   = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " ET";

    // Fire-and-forget so a Resend hiccup never breaks the UI.
    sendFeedbackEmail({
      fromName,
      fromEmail: user.email,
      restaurant,
      role: user.role,
      message,
      timestamp,
    }).catch((err) => console.error("[feedback] email failed:", err));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
