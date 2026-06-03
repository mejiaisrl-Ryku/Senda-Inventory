import { Response, NextFunction } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const extractInvoiceSchema = z.object({
  imageBase64: z.string().min(1, "Image data is required"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg"),
});

// Valid suggestion tokens the AI may return — match the seeded CogsCategory names.
const VALID_COGS_SUGGESTIONS = ["BEER", "LIQUOR", "WINE", "FOOD", "NON_ALCOHOLIC"] as const;
type CogsSuggestion = typeof VALID_COGS_SUGGESTIONS[number];

const EXTRACTION_PROMPT = `You are an invoice data extraction assistant. Analyze this invoice image and extract the following fields as a JSON object. Return ONLY valid JSON with no markdown, no code fences, no explanation.

Extract these fields:
- "name": the product or item name (string, required)
- "purveyor": the supplier or vendor company name (string or null)
- "invoiceDate": the invoice date in YYYY-MM-DD format (string or null)
- "unit": the unit of measurement — must be one of: KG, LITERS, PIECES, LB, OZ, G, EA, DOZ (string or null)
- "costPerUnit": the unit cost as a number (number or null)
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
      const raw = textBlock.text.trim().replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
      extracted = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "AI returned invalid JSON",
        raw: textBlock.text,
      });
    }

    // Validate department
    const rawDept = extracted.department;
    const department =
      rawDept === "BAR" || rawDept === "BOH" || rawDept === "FOH" ? rawDept : null;

    // ── Resolve suggestedCogsCategory → CogsCategory record ──────────────────
    const rawSuggestion = extracted.suggestedCogsCategory;
    const suggestion: CogsSuggestion | null =
      typeof rawSuggestion === "string" &&
      (VALID_COGS_SUGGESTIONS as readonly string[]).includes(rawSuggestion)
        ? (rawSuggestion as CogsSuggestion)
        : null;

    let cogsCategory: { id: string; name: string } | null = null;

    if (suggestion) {
      // Resolve ownerAccountId: prefer JWT claim, fall back to restaurant lookup.
      const ownerAccountId =
        req.user.ownerAccountId ??
        (req.user.restaurantId
          ? (
              await prisma.restaurant.findUnique({
                where: { id: req.user.restaurantId },
                select: { ownerAccountId: true },
              })
            )?.ownerAccountId ?? null
          : null);

      if (ownerAccountId) {
        const match = await prisma.cogsCategory.findUnique({
          where: { ownerAccountId_name: { ownerAccountId, name: suggestion } },
          select: { id: true, name: true },
        });
        cogsCategory = match ?? null;
      }
    }

    res.json({
      name:           extracted.name         ?? null,
      purveyor:       extracted.purveyor      ?? null,
      invoiceDate:    extracted.invoiceDate   ?? null,
      unit:           extracted.unit          ?? null,
      costPerUnit:    extracted.costPerUnit   ?? null,
      category:       extracted.category      ?? null,
      department,
      cogsCategory,   // { id, name } or null
    });
  } catch (err) {
    next(err);
  }
}
