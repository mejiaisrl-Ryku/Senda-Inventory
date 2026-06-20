/**
 * Background worker — polls ScanJob for PENDING rows and runs them through
 * Claude Vision, replacing the old synchronous in-request scan calls (Sprint 1).
 *
 * Runs as its own Railway service/process, separate from the Express API
 * (see railway.toml comment at bottom of this file for the deploy note).
 *
 * Uses prismaAdmin (BYPASSRLS), not prismaT: this process has no per-request
 * AsyncLocalStorage tenant context, and prismaT fails CLOSED at the Postgres
 * RLS layer without one (current_setting('app.restaurant_id') is NULL, so the
 * "tenant_isolation" policy matches zero rows). The worker is internal
 * infrastructure that must service every restaurant's jobs by id — never
 * exposed to a client request — so the bypass is intentional and scoped to
 * this file only.
 */

import "dotenv/config";
import { Anthropic } from "@anthropic-ai/sdk";
import { ScanJob, ScanJobType } from "@prisma/client";
import { prismaAdmin as prisma } from "./lib/prisma";
import { s3Service } from "./services/s3Service";
import logger from "./utils/logger";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const WEBHOOK_TIMEOUT_MS = 10_000;

const INVOICE_SYSTEM_PROMPT = `You are an expert invoice processor. Extract the following from the invoice image:
- invoiceNumber (string, e.g. "INV-12345")
- invoiceDate (ISO 8601 date string, e.g. "2024-06-20")
- vendorName (string, e.g. "Sysco")
- vendorAddress (string, optional)
- lineItems (array of objects, each with: description, quantity, unitCost, total)
- subtotal (number)
- tax (number)
- total (number)
- notes (string, optional)

Respond ONLY with valid JSON, no markdown fences. If a field cannot be extracted, use null.`;

const INVENTORY_SYSTEM_PROMPT = `You are an expert inventory counter. Analyze the inventory count image and extract:
- items (array of objects, each with: productName, quantity, unit, notes)
- totalItemsCount (number)
- comments (string, optional)

Respond ONLY with valid JSON, no markdown fences. If fields cannot be extracted, use null.`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelForAttempt(retryCount: number): string {
  // First attempt: sonnet (cheap). Retries: opus (more accurate on the
  // images sonnet already failed/misread).
  return retryCount === 0 ? "claude-sonnet-4-5" : "claude-opus-4-5";
}

async function sendWebhook(job: ScanJob, payload: Record<string, unknown>): Promise<void> {
  if (!job.webhookUrl) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const response = await fetch(job.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw new Error(`Webhook responded with ${response.status}`);
    }

    await prisma.scanJob.update({
      where: { id: job.id },
      data: { webhookDelivered: new Date(), webhookError: null },
    });
    logger.info("worker: webhook delivered", { jobId: job.id, webhookUrl: job.webhookUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("worker: webhook delivery failed", { jobId: job.id, message });
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { webhookError: message },
    });
  }
}

async function processJob(job: ScanJob): Promise<void> {
  const startedAt = Date.now();

  await prisma.scanJob.update({
    where: { id: job.id },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  try {
    logger.debug("worker: fetching image from S3", { jobId: job.id, imageS3Url: job.imageS3Url });
    const imageBuffer = await s3Service.fetchImage(job.imageS3Url);

    const imageBase64 = imageBuffer.toString("base64");
    const claudeModel = modelForAttempt(job.retryCount);
    const systemPrompt = job.type === "INVOICE" ? INVOICE_SYSTEM_PROMPT : INVENTORY_SYSTEM_PROMPT;
    const userPrompt = job.type === "INVOICE"
      ? "Extract invoice details from this image."
      : "Extract inventory count details from this image.";

    const claudeStart = Date.now();
    const response = await client.messages.create({
      model: claudeModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: job.imageMimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });
    const claudeProcessingMs = Date.now() - claudeStart;

    const textBlock = response.content.find((b) => b.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const clean = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let extractedData: unknown;
    try {
      extractedData = JSON.parse(clean);
    } catch {
      throw new Error(`JSON parse failed on Claude response: ${clean.slice(0, 200)}`);
    }

    const completed = await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        extractedData: extractedData as object,
        extractionError: null,
        claudeModel,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        claudeProcessingMs,
      },
    });

    logger.info("worker: job completed", {
      jobId: job.id,
      type: job.type,
      claudeModel,
      claudeProcessingMs,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalMs: Date.now() - startedAt,
    });

    await sendWebhook(completed, {
      id: completed.id,
      type: completed.type,
      status: "completed",
      extractedData,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("worker: job attempt failed", {
      jobId: job.id,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      message,
      totalMs: Date.now() - startedAt,
    });

    if (job.retryCount < job.maxRetries) {
      await prisma.scanJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          retryCount: job.retryCount + 1,
          lastRetryAt: new Date(),
          extractionError: message,
        },
      });
      logger.info("worker: job re-queued for retry", { jobId: job.id, nextAttempt: job.retryCount + 2 });
      return;
    }

    const failed = await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "FAILED", completedAt: new Date(), extractionError: message },
    });
    logger.warn("worker: job permanently failed", { jobId: job.id });

    await sendWebhook(failed, {
      id: failed.id,
      type: failed.type,
      status: "failed",
      extractedData: null,
      error: message,
    });
  }
}

async function pollOnce(): Promise<boolean> {
  const job = await prisma.scanJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) return false;

  logger.info("worker: picked up job", {
    jobId: job.id,
    type: job.type as ScanJobType,
    attempt: job.retryCount + 1,
  });

  await processJob(job);
  return true;
}

async function mainLoop(): Promise<void> {
  logger.info("worker: started", { pollIntervalMs: POLL_INTERVAL_MS });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const found = await pollOnce();
      if (!found) await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      logger.error("worker: unhandled error in main loop", {
        message: err instanceof Error ? err.message : String(err),
      });
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`worker: received ${signal}, shutting down`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

mainLoop().catch((err) => {
  logger.error("worker: fatal error", { message: err instanceof Error ? err.message : String(err) });
  prisma.$disconnect().finally(() => process.exit(1));
});
