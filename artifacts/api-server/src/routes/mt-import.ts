import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { getOpenAI, openAIModel } from "../lib/openai";
import { requireSupabaseUser } from "../lib/supabase-auth";

const router: IRouter = Router();
const MAX_IMAGE_BASE64_CHARS = 14_000_000;
const tradeProperties = {
  symbol: { type: ["string", "null"] }, type: { type: ["string", "null"], enum: ["buy", "sell", null] },
  lots: { type: ["number", "null"] }, openPrice: { type: ["number", "null"] }, closePrice: { type: ["number", "null"] },
  openTime: { type: ["string", "null"] }, closeTime: { type: ["string", "null"] }, profit: { type: ["number", "null"] },
  sl: { type: ["number", "null"] }, tp: { type: ["number", "null"] }, commission: { type: ["number", "null"] },
  swap: { type: ["number", "null"] }, ticket: { type: ["string", "null"] }, comment: { type: ["string", "null"] },
} as const;

router.post("/mt-import/ocr", async (req, res): Promise<void> => {
  const { image, mimeType } = req.body as { image?: string; mimeType?: string };
  if (!image || typeof image !== "string") { res.status(400).json({ error: "Missing image (base64 string)" }); return; }
  if (image.length > MAX_IMAGE_BASE64_CHARS) { res.status(413).json({ error: "The screenshot is too large. Please upload an image under 10 MB." }); return; }
  const imageType = mimeType || "image/png";
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(imageType)) { res.status(400).json({ error: "Unsupported screenshot type." }); return; }

  try {
    await requireSupabaseUser(req.headers.authorization);
    const response = await getOpenAI().responses.create({
      model: openAIModel(),
      instructions: "Extract every visible MetaTrader 4/5 open or historical trade row. Use null for unknown values. Treat pending buys as buy and pending sells as sell. Never invent rows.",
      input: [{ role: "user", content: [
        { type: "input_text", text: "Extract all visible MetaTrader trades from this screenshot." },
        { type: "input_image", image_url: `data:${imageType};base64,${image}`, detail: "high" },
      ] }],
      max_output_tokens: 5000,
      text: { format: { type: "json_schema", name: "metatrader_trades", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["trades"], properties: { trades: { type: "array", items: {
          type: "object", additionalProperties: false, required: Object.keys(tradeProperties), properties: tradeProperties,
        } } },
      } } },
    });
    const parsed = JSON.parse(response.output_text || "{\"trades\":[]}") as { trades?: unknown[] };
    const trades = Array.isArray(parsed.trades) ? parsed.trades : [];
    req.log.info({ count: trades.length, model: openAIModel() }, "OpenAI MT import OCR complete");
    res.json({ trades });
  } catch (cause) {
    const internal = cause instanceof Error ? cause.message : "OCR failed";
    logger.error({ err: internal }, "MT import OCR error");
    const status = /Authentication|session/i.test(internal) ? 401 : 500;
    res.status(status).json({ error: status === 401 ? internal : "Screenshot analysis failed. Please retry." });
  }
});

router.post("/mt-import/ai-chat", async (req, res): Promise<void> => {
  const { prompt, systemPrompt } = req.body as { prompt?: string; systemPrompt?: string };
  if (!prompt || typeof prompt !== "string") { res.status(400).json({ error: "Missing prompt" }); return; }
  if (prompt.length > 60_000 || (systemPrompt?.length || 0) > 8_000) { res.status(413).json({ error: "The AI request is too large." }); return; }
  try {
    await requireSupabaseUser(req.headers.authorization);
    const response = await getOpenAI().responses.create({
      model: openAIModel(),
      instructions: systemPrompt || "You are a professional trading journal coach. Be concise, educational, evidence-based, and never guarantee an outcome.",
      input: prompt,
      max_output_tokens: 4000,
    });
    req.log.info({ model: openAIModel() }, "OpenAI coaching response generated");
    res.json({ response: response.output_text || "" });
  } catch (cause) {
    const internal = cause instanceof Error ? cause.message : "AI request failed";
    logger.error({ err: internal }, "OpenAI coaching error");
    const status = /Authentication|session/i.test(internal) ? 401 : 500;
    res.status(status).json({ error: status === 401 ? internal : "AI analysis failed. Please retry." });
  }
});

export default router;
