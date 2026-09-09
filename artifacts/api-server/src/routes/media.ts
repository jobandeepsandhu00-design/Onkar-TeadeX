import { Router, type IRouter, type Response } from "express";
import {
  createDownloadUrl,
  createObjectKey,
  createUploadUrl,
  deleteLessonMedia,
  isOwnedLessonKey,
  objectExists,
  validateMedia,
  type LessonMediaType,
} from "../lib/r2";
import { getLesson, requireSupabaseUser } from "../lib/supabase-auth";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mediaTypes = new Set<LessonMediaType>([
  "video",
  "thumbnail",
  "caption",
  "audio",
]);

function readMediaType(value: unknown): LessonMediaType {
  if (typeof value !== "string" || !mediaTypes.has(value as LessonMediaType))
    throw new Error("Invalid media type.");
  return value as LessonMediaType;
}

function sendError(res: Response, cause: unknown) {
  const rawMessage = cause instanceof Error ? cause.message : "";
  const isPublicMessage =
    /^(Authentication required|Your session|Supabase server|Invalid |Unsupported |Video file is too large|Thumbnail file is too large|Caption file is too large|Audio file is too large|You can only |Upload ownership|The uploaded R2 object|Lesson access|Lesson media access|This lesson media|No lesson media|Cloudflare R2 is not configured)/.test(
      rawMessage,
    );
  const message = isPublicMessage
    ? rawMessage
    : "Cloudflare media request failed. Please retry.";
  const status = !isPublicMessage
    ? 502
    : message.includes("Authentication") || message.includes("session")
      ? 401
      : message.includes("access") ||
          message.includes("permission") ||
          message.includes("own")
        ? 403
        : message.includes("configured")
          ? 503
          : 400;
  res.status(status).json({ error: message });
}

router.post("/media/upload-url", async (req, res): Promise<void> => {
  try {
    const identity = await requireSupabaseUser(req.headers.authorization);
    const { fileName, fileType, fileSize, lessonId } = req.body as Record<
      string,
      unknown
    >;
    const mediaType = readMediaType(req.body?.mediaType);
    if (typeof lessonId !== "string" || !UUID_PATTERN.test(lessonId))
      throw new Error("Invalid lesson ID.");
    if (
      typeof fileName !== "string" ||
      !fileName.trim() ||
      fileName.length > 255
    )
      throw new Error("Invalid file name.");
    const mimeType = validateMedia(
      mediaType,
      String(fileType || ""),
      Number(fileSize),
      fileName,
    );
    const lesson = await getLesson(identity, lessonId);
    if (lesson && lesson.owner_id !== identity.userId)
      throw new Error("You can only replace media on lessons you own.");

    const objectKey = createObjectKey(
      identity.userId,
      lessonId,
      mediaType,
      mimeType,
    );
    const signed = await createUploadUrl({
      objectKey,
      contentType: mimeType,
      fileSize: Number(fileSize),
      userId: identity.userId,
      lessonId,
      mediaType,
    });
    res.json({
      ...signed,
      objectKey,
      contentType: mimeType,
      storageProvider: "cloudflare_r2",
    });
  } catch (cause) {
    sendError(res, cause);
  }
});

router.post("/media/confirm-upload", async (req, res): Promise<void> => {
  try {
    const identity = await requireSupabaseUser(req.headers.authorization);
    const { objectKey, lessonId } = req.body as Record<string, unknown>;
    const mediaType = readMediaType(req.body?.mediaType);
    if (
      typeof lessonId !== "string" ||
      !UUID_PATTERN.test(lessonId) ||
      typeof objectKey !== "string" ||
      !isOwnedLessonKey(objectKey, identity.userId, lessonId, mediaType)
    ) {
      throw new Error("Upload ownership could not be verified.");
    }
    const object = await objectExists(objectKey);
    if (!object)
      throw new Error(
        "The uploaded R2 object was not found. Retry the upload.",
      );
    const size = Number(object.ContentLength || 0);
    const expectedSize = Number(object.Metadata?.expectedsize || 0);
    let mimeType: string;
    try {
      if (!expectedSize || expectedSize !== size)
        throw new Error(
          "The uploaded file size did not match the signed request.",
        );
      mimeType = validateMedia(mediaType, object.ContentType || "", size);
    } catch (cause) {
      await deleteLessonMedia([objectKey]).catch(() => undefined);
      throw cause;
    }
    res.json({
      objectKey,
      size,
      mimeType,
      etag: object.ETag || null,
      storageProvider: "cloudflare_r2",
    });
  } catch (cause) {
    sendError(res, cause);
  }
});

router.post("/media/playback-url", async (req, res): Promise<void> => {
  try {
    const identity = await requireSupabaseUser(req.headers.authorization);
    const { lessonId, objectKey } = req.body as Record<string, unknown>;
    if (
      typeof lessonId !== "string" ||
      !UUID_PATTERN.test(lessonId) ||
      typeof objectKey !== "string"
    )
      throw new Error("Invalid playback request.");
    const lesson = await getLesson(identity, lessonId);
    if (!lesson || lesson.video_storage_provider !== "cloudflare_r2")
      throw new Error("Lesson access was denied.");
    const allowedKeys = [
      lesson.video_object_key,
      lesson.thumbnail_object_key,
      lesson.caption_object_key,
      lesson.audio_object_key,
    ].filter(Boolean);
    if (!allowedKeys.includes(objectKey))
      throw new Error("Lesson media access was denied.");
    const object = await objectExists(objectKey);
    if (!object) throw new Error("This lesson media is unavailable.");
    const expiresIn = 60 * 60;
    res.json({
      url: await createDownloadUrl(objectKey, expiresIn),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
  } catch (cause) {
    sendError(res, cause);
  }
});

router.post("/media/delete", async (req, res): Promise<void> => {
  try {
    const identity = await requireSupabaseUser(req.headers.authorization);
    const { lessonId, objectKeys } = req.body as {
      lessonId?: string;
      objectKeys?: unknown;
    };
    if (
      !lessonId ||
      !UUID_PATTERN.test(lessonId) ||
      !Array.isArray(objectKeys) ||
      objectKeys.length > 8
    )
      throw new Error("Invalid media deletion request.");
    const keys = objectKeys.filter(
      (key): key is string => typeof key === "string",
    );
    if (!keys.length)
      throw new Error("No lesson media was selected for deletion.");
    const lesson = await getLesson(identity, lessonId);
    if (lesson) {
      if (lesson.owner_id !== identity.userId)
        throw new Error("You can only delete lesson media you own.");
      const lessonKeys = [
        lesson.video_object_key,
        lesson.thumbnail_object_key,
        lesson.caption_object_key,
        lesson.audio_object_key,
      ].filter(Boolean);
      if (keys.some((key) => !lessonKeys.includes(key)))
        throw new Error("You can only delete media attached to this lesson.");
    } else if (
      keys.some((key) => !isOwnedLessonKey(key, identity.userId, lessonId))
    ) {
      throw new Error("You can only delete lesson media you own.");
    }
    await deleteLessonMedia(keys);
    res.json({ deleted: keys.length });
  } catch (cause) {
    sendError(res, cause);
  }
});

export default router;
