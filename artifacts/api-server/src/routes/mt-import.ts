import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured on server");
  return new GoogleGenAI({ apiKey });
}

const SYSTEM_PROMPT = `You are a MetaTrader 4/5 trade data extractor. The user will upload a screenshot of their MetaTrader terminal — this may be the "Trade" tab (open positions), the "History" tab (closed trades), or the "Account History" report.

Extract ALL visible trades/positions from the screenshot and return them as a JSON array.

For each trade return an object with these fields (use null for any field you cannot determine):
{
  "symbol": string,          // e.g. "EURUSD", "XAUUSD", "GBPUSD"
  "type": string,            // "buy" or "sell"
  "lots": number,            // lot size e.g. 0.10
  "openPrice": number,       // entry/open price
  "closePrice": number|null, // exit/close price (null if still open)
  "openTime": string|null,   // ISO-style or MT4 format e.g. "2024.01.15 09:30"
  "closeTime": string|null,  // close time or null if open
  "profit": number|null,     // P&L in account currency (negative for loss)
  "sl": number|null,         // stop loss price
  "tp": number|null,         // take profit price
  "commission": number|null, // commission charged
  "swap": number|null,       // swap/overnight fee
  "ticket": string|null,     // order ticket/ID number
  "comment": string|null     // any comment shown
}

Rules:
- Return ONLY valid JSON array, no explanation, no markdown code fences
- If the image shows no trades, return []
- For "buy limit", "buy stop" etc treat type as "buy"
- For "sell limit", "sell stop" etc treat type as "sell"
- Extract every row you can see, even partial ones`;

router.post("/mt-import/ocr", async (req, res): Promise<void> => {
  const { image, mimeType } = req.body as { image?: string; mimeType?: string };

  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Missing image (base64 string)" });
    return;
  }

  let ai: GoogleGenAI;
  try {
    ai = getAI();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  const imageType = (mimeType || "image/png");

  try {
    req.log.info("MT import OCR request received");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: imageType,
                data: image,
              },
            },
            {
              text: SYSTEM_PROMPT + "\n\nExtract all trades visible in this MetaTrader screenshot and return as a JSON array.",
            },
          ],
        },
      ],
      config: { maxOutputTokens: 8192 },
    });

    const raw = response.text ?? "[]";

    let trades: unknown[];
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      trades = JSON.parse(cleaned);
      if (!Array.isArray(trades)) trades = [];
    } catch {
      req.log.warn({ raw }, "Failed to parse OCR JSON response");
      trades = [];
    }

    req.log.info({ count: trades.length }, "MT import OCR complete");
    res.json({ trades });
  } catch (err: any) {
    logger.error({ err: err.message }, "MT import OCR error");
    res.status(500).json({ error: err.message || "OCR failed" });
  }
});

router.post("/mt-import/ai-chat", async (req, res): Promise<void> => {
  const { prompt, systemPrompt } = req.body as { prompt?: string; systemPrompt?: string };

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }

  let ai: GoogleGenAI;
  try {
    ai = getAI();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  try {
    req.log.info("AI chat request received");

    const sysInstruction = systemPrompt || "You are a professional forex trading coach. Be concise and specific.";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: prompt }] },
      ],
      config: {
        maxOutputTokens: 8192,
        systemInstruction: sysInstruction,
      },
    });

    const text = response.text ?? "";
    req.log.info("AI chat response generated");
    res.json({ response: text });
  } catch (err: any) {
    logger.error({ err: err.message }, "AI chat error");
    res.status(500).json({ error: err.message || "AI request failed" });
  }
});

export default router;
