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
// instrument.ts must load before anything else touches the network — the worker
// is its own process (separate Railway service from the Express API in index.ts),
// so it never picked up Sentry.init() from there. Without this line every
// Sentry.captureException call below is a silent no-op.
import "./instrument";
import * as Sentry from "@sentry/node";
import { Anthropic } from "@anthropic-ai/sdk";
import { ScanJob, ScanJobType } from "@prisma/client";
import { prismaAdmin as prisma } from "./lib/prisma";
import { s3Service } from "./services/s3Service";
import logger from "./utils/logger";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const WEBHOOK_TIMEOUT_MS = 10_000;

// Mirrors the pre-Sprint-1 synchronous aiController.extractInvoice prompt exactly —
// ScanInvoiceModal's manual-form population and product-name search both key off
// this exact field set, so the schema must not drift even though extraction now
// happens out-of-request.
const VALID_COGS_SUGGESTIONS = ["BEER", "LIQUOR", "WINE", "FOOD", "NON_ALCOHOLIC"] as const;
type CogsSuggestion = typeof VALID_COGS_SUGGESTIONS[number];

const INVOICE_SYSTEM_PROMPT = `You are an invoice data extraction assistant. Analyze this invoice image and extract the following fields as a JSON object. Return ONLY valid JSON with no markdown, no code fences, no explanation.

Extract these fields:
- "name": the product or item name (string, required)
- "purveyor": the supplier or vendor company name (string or null)
- "invoiceDate": the invoice date in YYYY-MM-DD format (string or null)
- "unit": the unit of measurement — must be one of: KG, LITERS, PIECES, LB, OZ, G, EA, DOZ (string or null)
- "quantity": the quantity ordered or delivered as a number (number or null). Look for values like "20 lbs", "5 cases", "12 bottles" — extract just the numeric part.
- "costPerUnit": the unit cost as a number (number or null). This is the price per single unit, not the line total.
- "sku": the supplier's product code, item number, or SKU if clearly printed on the invoice (string or null). Look for codes like "SYSCO-45821", "PLU 1234", "Item #: 9876".
- "category": one of: "Perishable Food", "Dry Food", "Beverages", "Paper Goods", "Chemicals", "Office Supplies", "Miscellaneous" (string or null)
- "department": classify the item into exactly one of these three values based on what the item is:
  - "BAR" — liquor, wine, beer, spirits, cocktail ingredients, mixers, bar supplies, glassware for bar
  - "BOH" — proteins, meat, seafood, produce, dairy, eggs, dry goods, grains, spices, kitchen equipment, food prep items, cooking supplies
  - "FOH" — office supplies, cleaning supplies, paper goods, napkins, to-go containers, uniforms, front-of-house décor, guest-facing items
  If the item clearly fits one category, return that value. If genuinely ambiguous, return null.
- "suggestedCogsCategory": based on the product name and category, suggest which COGS bucket this item belongs to.
  You MUST return exactly one of these values, or null if you truly cannot determine:
  - "BEER" — beer, ale, lager, cider, draft beer, canned/bottled beer
  - "LIQUOR" — spirits, vodka, rum, tequila, gin, whiskey, bourbon, brandy, mezcal
  - "WINE" — wine (red, white, rosé, sparkling), champagne, prosecco, cava
  - "FOOD" — any food item: produce, meat, seafood, dairy, dry goods, spices, oils, condiments, bread, eggs
  - "NON_ALCOHOLIC" — non-alcoholic beverages: soda, juice, water, coffee, tea, syrups, mixers with no alcohol
  Use null only if the item is not a food or beverage (e.g. cleaning supplies, paper goods, uniforms).

If you cannot confidently extract any other field, set it to null. If there are multiple line items, extract the most prominent or first item.

Return ONLY the JSON object, nothing else.`;

// Mirrors the pre-Sprint-1 synchronous scanController.scanInventory prompt exactly —
// ScanCountModal matches each returned item against matchedProductId, so the
// product list must still be sent to Claude for matching, same as before.
const INVENTORY_SYSTEM_PROMPT = `You are an inventory count extraction assistant for a restaurant management system.
The user will provide a photo of a handwritten or printed inventory count sheet.
Extract all product names and their counted quantities from the image.
You will also receive a list of existing products in the system (each with id, name, unit, and cogsCategory).
For each item you find in the image, try to match it to the closest product in the provided list.
Return ONLY a JSON array with no markdown, no explanation, just the raw JSON.
Format: [{ "extractedName": string, "matchedProductId": string | null, "matchedProductName": string | null, "quantity": number, "unit": string | null, "confidence": "high" | "medium" | "low", "suggestedCogsCategory": string | null }]
- extractedName: exactly what you read from the image
- matchedProductId: the id of the best matching product from the list, or null if no match
- matchedProductName: the name of the matched product, or null
- quantity: the number counted (use 0 if unclear)
- unit: the unit written on the sheet if visible, or null
- confidence: high if exact/near-exact match, medium if likely match, low if unsure
- suggestedCogsCategory: if the item matched a product, copy that product's cogsCategory.name; if unmatched, suggest one of BEER, LIQUOR, WINE, FOOD, NON_ALCOHOLIC based on the item name, or null if not a food/beverage`;

interface InventoryScanItem {
  extractedName:         string;
  matchedProductId:      string | null;
  matchedProductName:    string | null;
  quantity:              number;
  unit:                  string | null;
  confidence:            "high" | "medium" | "low";
  suggestedCogsCategory: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelForAttempt(retryCount: number): string {
  // First attempt: sonnet (cheap). Retries: opus (more accurate on the
  // images sonnet already failed/misread).
  return retryCount === 0 ? "claude-sonnet-4-5" : "claude-opus-4-5";
}

/**
 * Mirrors the post-processing aiController.extractInvoice used to do inline:
 * validate department, resolve the AI's suggestedCogsCategory token to an
 * actual CogsCategory row (ownerAccountId comes via the restaurant, since
 * ScanJob only carries restaurantId).
 */
async function resolveInvoiceExtraction(
  restaurantId: string,
  extracted: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const rawDept = extracted.department;
  const department = rawDept === "BAR" || rawDept === "BOH" || rawDept === "FOH" ? rawDept : null;

  const rawSuggestion = extracted.suggestedCogsCategory;
  const suggestion: CogsSuggestion | null =
    typeof rawSuggestion === "string" && (VALID_COGS_SUGGESTIONS as readonly string[]).includes(rawSuggestion)
      ? (rawSuggestion as CogsSuggestion)
      : null;

  let cogsCategory: { id: string; name: string } | null = null;

  if (suggestion) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { ownerAccountId: true },
    });
    if (restaurant?.ownerAccountId) {
      const match = await prisma.cogsCategory.findUnique({
        where: { ownerAccountId_name: { ownerAccountId: restaurant.ownerAccountId, name: suggestion } },
        select: { id: true, name: true },
      });
      cogsCategory = match ?? null;
    }
  }

  return {
    name:        extracted.name        ?? null,
    purveyor:    extracted.purveyor    ?? null,
    invoiceDate: extracted.invoiceDate ?? null,
    unit:        extracted.unit        ?? null,
    quantity:    typeof extracted.quantity === "number" ? extracted.quantity : null,
    costPerUnit: extracted.costPerUnit ?? null,
    sku:         typeof extracted.sku === "string" && extracted.sku.trim() ? extracted.sku.trim() : null,
    category:    extracted.category    ?? null,
    department,
    cogsCategory,
  };
}

/** Mirrors scanController.scanInventory's array-shaping of Claude's raw output. */
function normalizeInventoryItems(parsed: unknown): InventoryScanItem[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item: any) => ({
    extractedName:         String(item.extractedName ?? ""),
    matchedProductId:      item.matchedProductId      ?? null,
    matchedProductName:    item.matchedProductName    ?? null,
    quantity:              Number(item.quantity)      || 0,
    unit:                  item.unit                  ?? null,
    confidence:            (["high", "medium", "low"].includes(item.confidence) ? item.confidence : "low") as
      "high" | "medium" | "low",
    suggestedCogsCategory: typeof item.suggestedCogsCategory === "string" ? item.suggestedCogsCategory : null,
  }));
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

    let userPrompt: string;
    if (job.type === "INVOICE") {
      userPrompt = "Please extract the invoice fields from this image.";
    } else {
      // Inventory matching needs the restaurant's product catalog in context,
      // same as the old synchronous scanController — Claude matches extracted
      // names against these ids.
      const products = await prisma.product.findMany({
        where: { restaurantId: job.restaurantId },
        select: { id: true, name: true, unit: true, cogsCategory: { select: { name: true } } },
        orderBy: { name: "asc" },
      });
      userPrompt = `Here are the existing products in this restaurant:
${JSON.stringify(products, null, 2)}

Please extract all inventory counts from this image.`;
    }

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

    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      throw new Error(`JSON parse failed on Claude response: ${clean.slice(0, 200)}`);
    }

    const extractedData = job.type === "INVOICE"
      ? await resolveInvoiceExtraction(job.restaurantId, parsed as Record<string, unknown>)
      : { items: normalizeInventoryItems(parsed), rawText };

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
    Sentry.captureException(err, {
      tags: { jobId: job.id, jobType: job.type, attempt: job.retryCount + 1 },
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
  await s3Service.verifyLifecyclePolicy();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const found = await pollOnce();
      if (!found) await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      logger.error("worker: unhandled error in main loop", {
        message: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, { tags: { scope: "worker-main-loop" } });
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
  Sentry.captureException(err, { tags: { scope: "worker-fatal" } });
  // process.exit() races ahead of Sentry's async event delivery — flush first
  // so a fatal crash doesn't also silently drop the error report.
  Sentry.flush(2000)
    .catch(() => undefined)
    .finally(() => prisma.$disconnect().finally(() => process.exit(1)));
});
