import { Response, NextFunction } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

const SYSTEM_PROMPT = `You are an inventory count extraction assistant for a restaurant management system.
The user will provide a photo of a handwritten or printed inventory count sheet.
Extract all product names and their counted quantities from the image.
You will also receive a list of existing products in the system.
For each item you find in the image, try to match it to the closest product in the provided list.
Return ONLY a JSON array with no markdown, no explanation, just the raw JSON.
Format: [{ "extractedName": string, "matchedProductId": string | null, "matchedProductName": string | null, "quantity": number, "unit": string | null, "confidence": "high" | "medium" | "low" }]
- extractedName: exactly what you read from the image
- matchedProductId: the id of the best matching product from the list, or null if no match
- matchedProductName: the name of the matched product, or null
- quantity: the number counted (use 0 if unclear)
- unit: the unit written on the sheet if visible, or null
- confidence: high if exact/near-exact match, medium if likely match, low if unsure`;

interface ScanItem {
  extractedName:     string;
  matchedProductId:  string | null;
  matchedProductName: string | null;
  quantity:          number;
  unit:              string | null;
  confidence:        "high" | "medium" | "low";
}

/**
 * POST /api/inventory/scan
 * Accepts a multipart image file, sends it to Claude vision, and returns
 * extracted inventory count data matched against the restaurant's products.
 */
export async function scanInventory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const restaurantId = req.user.restaurantId ?? "";

    // req.file is populated by multer memoryStorage
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    const imageSizeBytes = file.buffer.byteLength;

    logger.debug("scanInventory: entry", {
      userId: req.user.userId,
      restaurantId,
      imageSizeBytes,
      mimeType: file.mimetype,
    });

    if (imageSizeBytes > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "Image too large — maximum 10 MB" });
    }

    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedMimes.includes(file.mimetype)) {
      return res.status(400).json({ error: "Unsupported image type — use JPEG, PNG, WebP, or GIF" });
    }

    // ── 1. Fetch restaurant products ──────────────────────────────────────────
    const products = await prisma.product.findMany({
      where:  { restaurantId },
      select: { id: true, name: true, unit: true, cogsCategory: true },
      orderBy: { name: "asc" },
    });

    // ── 2. Call Claude vision API ─────────────────────────────────────────────
    const imageBase64 = file.buffer.toString("base64");
    const mediaType   = file.mimetype as "image/jpeg" | "image/png" | "image/webp" | "image/gif";

    const userMessage = `Here are the existing products in this restaurant:
${JSON.stringify(products, null, 2)}

Please extract all inventory counts from this image.`;

    const claudeResponse = await client.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type:   "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            { type: "text", text: userMessage },
          ],
        },
      ],
    });

    const rawText = claudeResponse.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    // ── 3. Parse JSON response ────────────────────────────────────────────────
    let items: ScanItem[] = [];
    try {
      // Strip any accidental markdown fences
      const clean = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        items = parsed.map((item: any) => ({
          extractedName:      String(item.extractedName ?? ""),
          matchedProductId:   item.matchedProductId   ?? null,
          matchedProductName: item.matchedProductName ?? null,
          quantity:           Number(item.quantity)   ?? 0,
          unit:               item.unit               ?? null,
          confidence:         (["high", "medium", "low"].includes(item.confidence)
                                ? item.confidence
                                : "low") as "high" | "medium" | "low",
        }));
      }
    } catch {
      logger.debug("scanInventory: could not parse Claude JSON — returning empty", { rawText: rawText.slice(0, 200) });
    }

    logger.info("scanInventory: success", {
      userId:         req.user.userId,
      restaurantId,
      itemsExtracted: items.length,
    });

    res.json({ items, rawText });
  } catch (err) {
    logger.error("scanInventory: error", {
      userId:  req.user.userId,
      message: (err as Error).message,
    });
    next(err);
  }
}
