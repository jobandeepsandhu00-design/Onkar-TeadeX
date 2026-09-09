import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type LessonMediaType = "video" | "thumbnail" | "caption" | "audio";

export const MEDIA_LIMITS: Record<LessonMediaType, number> = {
  video: 250 * 1024 * 1024,
  thumbnail: 10 * 1024 * 1024,
  caption: 5 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
};

const allowedMimeTypes: Record<LessonMediaType, ReadonlySet<string>> = {
  video: new Set(["video/mp4", "video/webm", "video/quicktime"]),
  thumbnail: new Set(["image/jpeg", "image/png", "image/webp"]),
  caption: new Set(["text/vtt", "application/x-subrip", "text/plain"]),
  audio: new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"]),
};

const allowedExtensions: Record<LessonMediaType, ReadonlySet<string>> = {
  video: new Set(["mp4", "webm", "mov"]),
  thumbnail: new Set(["jpg", "jpeg", "png", "webp"]),
  caption: new Set(["vtt", "srt", "txt"]),
  audio: new Set(["mp3", "m4a", "mp4", "wav"]),
};

const extensionsByMime: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/vtt": "vtt",
  "application/x-subrip": "srt",
  "text/plain": "txt",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

const prefixes: Record<LessonMediaType, string> = {
  video: "videos",
  thumbnail: "thumbnails",
  caption: "captions",
  audio: "audio",
};

let r2Client: S3Client | null = null;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Cloudflare R2 is not configured on the server.");
  return value;
}

export function getR2Config() {
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const endpoint = (
    process.env.CLOUDFLARE_R2_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`
  ).replace(/\/$/, "");
  const parsedEndpoint = new URL(endpoint);
  if (
    parsedEndpoint.protocol !== "https:" ||
    !parsedEndpoint.hostname.endsWith(".r2.cloudflarestorage.com")
  ) {
    throw new Error("Cloudflare R2 endpoint configuration is invalid.");
  }
  return {
    accountId,
    endpoint,
    bucket: requiredEnvironment("CLOUDFLARE_R2_BUCKET_NAME"),
    accessKeyId: requiredEnvironment("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
  };
}

export function getR2Client() {
  if (r2Client) return r2Client;
  const config = getR2Config();
  r2Client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return r2Client;
}

export function validateMedia(
  mediaType: LessonMediaType,
  mimeType: string,
  size: number,
  originalName?: string,
) {
  const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();
  if (!allowedMimeTypes[mediaType].has(normalizedMime))
    throw new Error(`Unsupported ${mediaType} file type.`);
  if (!Number.isFinite(size) || size <= 0 || size > MEDIA_LIMITS[mediaType])
    throw new Error(
      `${mediaType[0].toUpperCase()}${mediaType.slice(1)} file is too large.`,
    );
  if (originalName) {
    const extension =
      originalName
        .trim()
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/)?.[1] || "";
    if (!allowedExtensions[mediaType].has(extension))
      throw new Error(`Unsupported ${mediaType} file extension.`);
  }
  return normalizedMime;
}

export function createObjectKey(
  userId: string,
  lessonId: string,
  mediaType: LessonMediaType,
  mimeType: string,
) {
  const extension = extensionsByMime[mimeType];
  if (!extension) throw new Error("Unsupported media file extension.");
  return `${prefixes[mediaType]}/${userId}/${lessonId}/${crypto.randomUUID()}.${extension}`;
}

export function isOwnedLessonKey(
  objectKey: string,
  userId: string,
  lessonId: string,
  mediaType?: LessonMediaType,
) {
  if (!objectKey || objectKey.includes("..") || objectKey.startsWith("/"))
    return false;
  const allowedPrefixes = mediaType
    ? [prefixes[mediaType]]
    : Object.values(prefixes);
  return allowedPrefixes.some((prefix) =>
    objectKey.startsWith(`${prefix}/${userId}/${lessonId}/`),
  );
}

export async function createUploadUrl(input: {
  objectKey: string;
  contentType: string;
  fileSize: number;
  userId: string;
  lessonId: string;
  mediaType: LessonMediaType;
}) {
  const config = getR2Config();
  const commandInput: PutObjectCommandInput = {
    Bucket: config.bucket,
    Key: input.objectKey,
    ContentType: input.contentType,
    CacheControl:
      input.mediaType === "thumbnail"
        ? "public, max-age=86400"
        : "private, max-age=3600",
    Metadata: {
      userId: input.userId,
      lessonId: input.lessonId,
      mediaType: input.mediaType,
      expectedSize: String(input.fileSize),
    },
  };
  const expiresIn = 10 * 60;
  return {
    uploadUrl: await getSignedUrl(
      getR2Client(),
      new PutObjectCommand(commandInput),
      { expiresIn },
    ),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function createDownloadUrl(
  objectKey: string,
  expiresIn = 60 * 60,
) {
  const config = getR2Config();
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    { expiresIn },
  );
}

export async function uploadObject(
  objectKey: string,
  body: Uint8Array,
  contentType: string,
) {
  const config = getR2Config();
  return getR2Client().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function objectExists(objectKey: string) {
  const config = getR2Config();
  try {
    return await getR2Client().send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  } catch (cause) {
    const status = (cause as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw cause;
  }
}

export async function deleteObject(objectKey: string) {
  return deleteLessonMedia([objectKey]);
}

export async function deleteLessonMedia(objectKeys: string[]) {
  if (!objectKeys.length) return;
  const config = getR2Config();
  await getR2Client().send(
    new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: objectKeys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}
