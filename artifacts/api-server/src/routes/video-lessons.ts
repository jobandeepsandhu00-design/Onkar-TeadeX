import { Router, type IRouter } from "express";
import { GoogleGenAI, FileState, createPartFromUri } from "@google/genai";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MAX_PROCESSING_BYTES = 80 * 1024 * 1024;

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Automatic transcription is not configured. Add GEMINI_API_KEY to the API server.");
  return new GoogleGenAI({ apiKey });
}

async function requireSupabaseUser(authorization?: string) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error("Supabase server environment is incomplete.");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Authentication required.");
  const response = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { Authorization: authorization, apikey: publishableKey },
  });
  if (!response.ok) throw new Error("Your session has expired. Please log in again.");
  const user = await response.json() as { id?: string };
  if (!user.id) throw new Error("Authentication required.");
  return { supabaseUrl };
}

function validateStorageUrl(rawUrl: string, supabaseUrl: string) {
  const mediaUrl = new URL(rawUrl);
  const projectUrl = new URL(supabaseUrl);
  const projectRef = projectUrl.hostname.split(".")[0];
  const allowedHosts = new Set([projectUrl.hostname, `${projectRef}.storage.supabase.co`]);
  if (mediaUrl.protocol !== "https:" || !allowedHosts.has(mediaUrl.hostname)) throw new Error("Video URL is not from this Supabase project.");
  if (!mediaUrl.pathname.includes("/storage/v1/object/sign/trading-lessons/")) throw new Error("Video URL is not a signed lesson object.");
  return mediaUrl;
}

function parseTranscript(raw: string) {
  const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as {
    captions?: Array<{ startTime?: number; endTime?: number; text?: string }>;
    shortDescription?: string;
    description?: string;
    tags?: string[];
    rules?: string[];
    checklist?: string[];
  };
  const captions = (parsed.captions || [])
    .filter((caption) => typeof caption.text === "string" && caption.text.trim())
    .map((caption) => ({
      startTime: Math.max(0, Number(caption.startTime || 0)),
      endTime: Math.max(Number(caption.startTime || 0) + 0.25, Number(caption.endTime || 0)),
      text: String(caption.text).trim(),
    }))
    .sort((a, b) => a.startTime - b.startTime);
  return {
    captions,
    shortDescription: String(parsed.shortDescription || ""),
    description: String(parsed.description || ""),
    tags: (parsed.tags || []).map(String).slice(0, 12),
    rules: (parsed.rules || []).map(String).filter(Boolean).slice(0, 12),
    checklist: (parsed.checklist || []).map(String).filter(Boolean).slice(0, 12),
  };
}

router.post("/video-lessons/transcribe", async (req, res): Promise<void> => {
  const { videoUrl, title } = req.body as { videoUrl?: string; title?: string };
  if (!videoUrl || typeof videoUrl !== "string") { res.status(400).json({ error: "Missing signed video URL." }); return; }

  let tempPath: string | null = null;
  let geminiFileName: string | undefined;
  let ai: GoogleGenAI | null = null;
  try {
    const { supabaseUrl } = await requireSupabaseUser(req.headers.authorization);
    const safeUrl = validateStorageUrl(videoUrl, supabaseUrl);
    ai = getAI();

    const media = await fetch(safeUrl);
    if (!media.ok) throw new Error("The uploaded video could not be opened for transcription.");
    const declaredSize = Number(media.headers.get("content-length") || 0);
    if (declaredSize > MAX_PROCESSING_BYTES) throw new Error("Automatic transcription currently supports videos up to 80 MB. The video remains uploaded and captions can be edited manually.");
    const bytes = Buffer.from(await media.arrayBuffer());
    if (bytes.byteLength > MAX_PROCESSING_BYTES) throw new Error("Automatic transcription currently supports videos up to 80 MB. The video remains uploaded and captions can be edited manually.");
    const mimeType = media.headers.get("content-type")?.split(";")[0] || "video/mp4";
    const extension = mimeType.includes("webm") ? ".webm" : mimeType.includes("quicktime") ? ".mov" : ".mp4";
    tempPath = join(tmpdir(), `lesson-${crypto.randomUUID()}${extension}`);
    await writeFile(tempPath, bytes);

    let uploaded = await ai.files.upload({ file: tempPath, config: { mimeType, displayName: String(title || "Trading lesson").slice(0, 120) } });
    geminiFileName = uploaded.name;
    const deadline = Date.now() + 32_000;
    while (uploaded.state === FileState.PROCESSING && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      if (!uploaded.name) break;
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    if (uploaded.state === FileState.FAILED) throw new Error(uploaded.error?.message || "The video processor could not read this file.");
    if (uploaded.state !== FileState.ACTIVE || !uploaded.uri || !uploaded.mimeType) throw new Error("Video processing is taking longer than expected. Try Generate Transcript again shortly.");

    const prompt = `Transcribe the spoken words in this trading education video into accurately timestamped caption phrases. Keep each caption to roughly one or two readable lines. Also create concise lesson metadata based only on what is actually taught in the video.

Return ONLY valid JSON with this shape:
{
  "captions": [{"startTime": 0.0, "endTime": 4.2, "text": "Exact spoken phrase"}],
  "shortDescription": "One sentence",
  "description": "A concise lesson summary",
  "tags": ["tag"],
  "rules": ["User-process rule taught in the video"],
  "checklist": ["Manual review checkpoint"]
}

Do not invent a trading signal, price prediction, or guaranteed outcome. This is an educational transcript and user-defined process summary. Lesson title: ${String(title || "Trading lesson").slice(0, 160)}`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [createPartFromUri(uploaded.uri, uploaded.mimeType), { text: prompt }] }],
      config: { maxOutputTokens: 16384, responseMimeType: "application/json" },
    });
    const result = parseTranscript(response.text || "{}");
    req.log.info({ captionCount: result.captions.length }, "Video lesson transcription complete");
    res.json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Automatic transcription failed.";
    logger.error({ err: message }, "Video lesson transcription error");
    res.status(message.includes("Authentication") || message.includes("session") ? 401 : message.includes("URL") ? 400 : 500).json({ error: message });
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => undefined);
    if (ai && geminiFileName) await ai.files.delete({ name: geminiFileName }).catch(() => undefined);
  }
});

export default router;
