import { Router, type IRouter } from "express";
import { toFile } from "openai";
import { logger } from "../lib/logger";
import { getOpenAI, structuredResponse } from "../lib/openai";
import { createDownloadUrl, isOwnedLessonKey, objectExists } from "../lib/r2";
import { requireSupabaseUser } from "../lib/supabase-auth";

const router: IRouter = Router();
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

function validateStorageUrl(rawUrl: string, supabaseUrl: string) {
  const mediaUrl = new URL(rawUrl);
  const projectUrl = new URL(supabaseUrl);
  const projectRef = projectUrl.hostname.split(".")[0];
  const allowedHosts = new Set([projectUrl.hostname, `${projectRef}.storage.supabase.co`]);
  if (mediaUrl.protocol !== "https:" || !allowedHosts.has(mediaUrl.hostname))
    throw new Error("Video URL is not from this Supabase project.");
  if (!mediaUrl.pathname.includes("/storage/v1/object/sign/trading-lessons/"))
    throw new Error("Video URL is not a signed lesson object.");
  return mediaUrl;
}

router.post("/video-lessons/transcribe", async (req, res): Promise<void> => {
  const { videoUrl, videoObjectKey, lessonId, title } = req.body as {
    videoUrl?: string;
    videoObjectKey?: string;
    lessonId?: string;
    title?: string;
  };
  if ((!videoUrl || typeof videoUrl !== "string") && (!videoObjectKey || typeof videoObjectKey !== "string")) {
    res.status(400).json({ error: "Missing lesson video." });
    return;
  }

  try {
    const identity = await requireSupabaseUser(req.headers.authorization);
    let safeUrl: URL;
    if (videoObjectKey) {
      if (!lessonId || !isOwnedLessonKey(videoObjectKey, identity.userId, lessonId))
        throw new Error("Video ownership could not be verified.");
      if (!(await objectExists(videoObjectKey))) throw new Error("The uploaded R2 video was not found.");
      safeUrl = new URL(await createDownloadUrl(videoObjectKey, 10 * 60));
    } else {
      safeUrl = validateStorageUrl(String(videoUrl), identity.supabaseUrl);
    }

    const media = await fetch(safeUrl);
    if (!media.ok) throw new Error("The uploaded video could not be opened for transcription.");
    const declaredSize = Number(media.headers.get("content-length") || 0);
    if (declaredSize > MAX_TRANSCRIPTION_BYTES)
      throw new Error("Automatic transcription supports files up to 25 MB. The video remains uploaded and captions can be edited manually.");
    const bytes = Buffer.from(await media.arrayBuffer());
    if (bytes.byteLength > MAX_TRANSCRIPTION_BYTES)
      throw new Error("Automatic transcription supports files up to 25 MB. The video remains uploaded and captions can be edited manually.");

    const mimeType = media.headers.get("content-type")?.split(";")[0] || "video/mp4";
    const extension = mimeType.includes("webm") ? ".webm" : mimeType.includes("quicktime") ? ".mov" : ".mp4";
    const transcription = await getOpenAI().audio.transcriptions.create({
      file: await toFile(bytes, `lesson${extension}`, { type: mimeType }),
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      prompt: "Trading education lesson. Preserve market, chart, price action and strategy terminology accurately.",
    });
    const segments = (transcription as unknown as {
      segments?: Array<{ start?: number; end?: number; text?: string }>;
      text?: string;
    }).segments ?? [];
    const captions = segments
      .filter((segment) => segment.text?.trim())
      .map((segment) => ({
        startTime: Math.max(0, Number(segment.start || 0)),
        endTime: Math.max(Number(segment.start || 0) + 0.25, Number(segment.end || 0)),
        text: String(segment.text).trim(),
      }));
    const transcriptText = (transcription as unknown as { text?: string }).text || captions.map((caption) => caption.text).join(" ");

    const metadata = await structuredResponse<{
      shortDescription: string;
      description: string;
      tags: string[];
      rules: string[];
      checklist: string[];
    }>({
      name: "video_lesson_metadata",
      instructions: "Summarize only what is taught in the transcript. Never invent a trade signal, prediction, outcome or guarantee.",
      input: `Lesson title: ${String(title || "Trading lesson").slice(0, 160)}\n\nTranscript:\n${transcriptText.slice(0, 80_000)}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["shortDescription", "description", "tags", "rules", "checklist"],
        properties: {
          shortDescription: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", maxItems: 12, items: { type: "string" } },
          rules: { type: "array", maxItems: 12, items: { type: "string" } },
          checklist: { type: "array", maxItems: 12, items: { type: "string" } },
        },
      },
      maxOutputTokens: 1800,
    });

    req.log.info({ captionCount: captions.length, model: metadata.model }, "OpenAI video lesson transcription complete");
    res.json({ captions, ...metadata.output });
  } catch (cause) {
    const internal = cause instanceof Error ? cause.message : "Automatic transcription failed.";
    logger.error({ err: internal }, "Video lesson transcription error");
    const status = /Authentication|session/i.test(internal) ? 401 : /URL|ownership|Missing|25 MB/i.test(internal) ? 400 : 500;
    const error = status === 500 ? "Automatic transcription failed. Please retry or edit captions manually." : internal;
    res.status(status).json({ error });
  }
});

export default router;
