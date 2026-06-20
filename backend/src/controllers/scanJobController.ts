import { Response, NextFunction } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prismaT as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import { s3Service } from "../services/s3Service";
import logger from "../utils/logger";

export const enqueueInvoiceSchema = z.object({
  imageBase64: z.string().min(1, "Image data is required"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg"),
  webhookUrl: z.string().url().optional(),
});

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * POST /api/ai/extract-invoice
 * Enqueues a ScanJob and returns immediately — Claude is no longer called inline.
 * A worker process (Sprint 2) picks up PENDING jobs, scans, and fills extractedData.
 */
export async function enqueueInvoiceExtraction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { imageBase64, mimeType, webhookUrl } = req.body as z.infer<typeof enqueueInvoiceSchema>;
    const restaurantId = req.user.restaurantId ?? "";

    const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "Image too large — maximum 10 MB" });
    }

    const jobId = crypto.randomUUID();
    const imageS3Url = await s3Service.uploadImage(imageBuffer, mimeType, "invoice", restaurantId, jobId);

    const job = await prisma.scanJob.create({
      data: {
        id: jobId,
        type: "INVOICE",
        status: "PENDING",
        restaurantId,
        imageS3Url,
        imageMimeType: mimeType,
        imageSizeBytes: imageBuffer.byteLength,
        webhookUrl: webhookUrl ?? null,
      },
    });

    logger.info("enqueueInvoiceExtraction: job created", { jobId: job.id, restaurantId });

    res.status(202).json({
      jobId: job.id,
      status: job.status,
      statusUrl: `/api/scan-jobs/${job.id}`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/inventory/scan
 * Enqueues a ScanJob from a multipart image upload — see enqueueInvoiceExtraction.
 */
export async function enqueueInventoryScan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "Image file is required" });
    }
    if (file.buffer.byteLength > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "Image too large — maximum 10 MB" });
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return res.status(400).json({ error: "Unsupported image type — use JPEG, PNG, WebP, or GIF" });
    }

    const webhookUrl = typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl : undefined;
    const restaurantId = req.user.restaurantId ?? "";

    const jobId = crypto.randomUUID();
    const imageS3Url = await s3Service.uploadImage(file.buffer, file.mimetype, "inventory", restaurantId, jobId);

    const job = await prisma.scanJob.create({
      data: {
        id: jobId,
        type: "INVENTORY",
        status: "PENDING",
        restaurantId,
        imageS3Url,
        imageMimeType: file.mimetype,
        imageSizeBytes: file.buffer.byteLength,
        webhookUrl: webhookUrl ?? null,
      },
    });

    logger.info("enqueueInventoryScan: job created", { jobId: job.id, restaurantId });

    res.status(202).json({
      jobId: job.id,
      status: job.status,
      statusUrl: `/api/scan-jobs/${job.id}`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/scan-jobs/:jobId
 * Tenant isolation comes from prismaT's RLS extension (restaurantId WHERE-injection
 * + Postgres RLS GUC) — no manual filtering needed here.
 */
export async function getScanJobStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { jobId } = req.params;

    const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      extractedData: job.extractedData,
      error: job.extractionError,
      retryCount: job.retryCount,
      webhookDelivered: job.webhookDelivered,
    });
  } catch (err) {
    next(err);
  }
}
