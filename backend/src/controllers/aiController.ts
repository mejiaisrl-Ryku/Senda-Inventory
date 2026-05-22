import { Response, NextFunction } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AuthRequest } from "../types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const extractInvoiceSchema = z.object({
  imageBase64: z.string().min(1, "Image data is required"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg"),
});

const EXTRACTION_PROMPT = `You are an invoice data extraction assistant. Analyze this invoice image and extract the following fields as a JSON object. Return ONLY valid JSON with no markdown, no code fences, no explanation.

Extract these fields:
- "name": the product or item name (string, required)
- "purveyor": the supplier or vendor company name (string or null)
- "invoiceDate": the invoice date in YYYY-MM-DD format (string or null)
- "unit": the unit of measurement — must be one of: KG, LITERS, PIECES, LB, OZ, G, EA, DOZ (string or null)
- "costPerUnit": the unit cost as a number (number or null)
- "category": one of: "Perishable Food", "Dry Food", "Beverages", "Non-Food Supplies" (string or null)

If you cannot confidently extract a field, set it to null. If there are multiple line items, extract the most prominent or first item.

Return ONLY the JSON object, nothing else.`;

export async function extractInvoice(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { imageBase64, mimeType } = req.body as z.infer<typeof extractInvoiceSchema>;

    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return res.status(502).json({ error: "No text response from AI" });
    }

    let extracted: Record<string, unknown>;
    try {
      // Strip any accidental markdown fences just in case
      const raw = textBlock.text.trim().replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
      extracted = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "AI returned invalid JSON",
        raw: textBlock.text,
      });
    }

    res.json({
      name: extracted.name ?? null,
      purveyor: extracted.purveyor ?? null,
      invoiceDate: extracted.invoiceDate ?? null,
      unit: extracted.unit ?? null,
      costPerUnit: extracted.costPerUnit ?? null,
      category: extracted.category ?? null,
    });
  } catch (err) {
    next(err);
  }
}
