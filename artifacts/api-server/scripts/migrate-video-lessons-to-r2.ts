import {
  createObjectKey,
  objectExists,
  uploadObject,
  validateMedia,
} from "../src/lib/r2";

type LegacyLesson = {
  id: string;
  owner_id: string;
  video_path: string;
  thumbnail_path: string | null;
};

const apply = process.argv.includes("--apply");
const bucket = "trading-lessons";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

function storageObjectUrl(supabaseUrl: string, path: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encoded}`;
}

async function downloadLegacyObject(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
) {
  const response = await fetch(storageObjectUrl(supabaseUrl, path), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok)
    throw new Error(`Could not download legacy object (${response.status}).`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: (
      response.headers.get("content-type") || "application/octet-stream"
    ).split(";")[0],
  };
}

async function copyAndVerify(input: {
  lesson: LegacyLesson;
  path: string;
  mediaType: "video" | "thumbnail";
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  const source = await downloadLegacyObject(
    input.supabaseUrl,
    input.serviceRoleKey,
    input.path,
  );
  const contentType = validateMedia(
    input.mediaType,
    source.contentType,
    source.bytes.byteLength,
    input.path,
  );
  const objectKey = createObjectKey(
    input.lesson.owner_id,
    input.lesson.id,
    input.mediaType,
    contentType,
  );
  await uploadObject(objectKey, source.bytes, contentType);
  const uploaded = await objectExists(objectKey);
  if (
    !uploaded ||
    Number(uploaded.ContentLength || 0) !== source.bytes.byteLength
  ) {
    throw new Error(
      "R2 verification failed; Supabase metadata was not changed.",
    );
  }
  return { objectKey, size: source.bytes.byteLength, contentType };
}

async function updateLesson(
  supabaseUrl: string,
  serviceRoleKey: string,
  lessonId: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/video_lessons?id=eq.${lessonId}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok)
    throw new Error(`Could not update lesson metadata (${response.status}).`);
}

async function main() {
  const supabaseUrl = required("VITE_SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/video_lessons?video_storage_provider=eq.supabase_storage&select=id,owner_id,video_path,thumbnail_path`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!response.ok)
    throw new Error(`Could not list legacy lessons (${response.status}).`);
  const lessons = (await response.json()) as LegacyLesson[];
  console.log(
    `${lessons.length} Supabase Storage lesson(s) found. Mode: ${apply ? "APPLY" : "DRY RUN"}.`,
  );
  if (!apply) {
    console.log(
      "No objects or metadata changed. Re-run with --apply after reviewing the count.",
    );
    return;
  }

  for (const lesson of lessons) {
    const video = await copyAndVerify({
      lesson,
      path: lesson.video_path,
      mediaType: "video",
      supabaseUrl,
      serviceRoleKey,
    });
    const thumbnail = lesson.thumbnail_path
      ? await copyAndVerify({
          lesson,
          path: lesson.thumbnail_path,
          mediaType: "thumbnail",
          supabaseUrl,
          serviceRoleKey,
        })
      : null;
    await updateLesson(supabaseUrl, serviceRoleKey, lesson.id, {
      video_storage_provider: "cloudflare_r2",
      video_object_key: video.objectKey,
      video_path: video.objectKey,
      video_file_name: lesson.video_path.split("/").pop() || "legacy-video",
      video_size_bytes: video.size,
      video_mime_type: video.contentType,
      thumbnail_object_key: thumbnail?.objectKey || null,
      thumbnail_path: thumbnail?.objectKey || null,
      upload_status: "ready",
      processing_status: "ready",
      updated_at: new Date().toISOString(),
    });
    console.log(
      `Migrated and verified lesson ${lesson.id}. Supabase source objects retained.`,
    );
  }
}

main().catch((cause) => {
  console.error(
    cause instanceof Error ? cause.message : "Lesson media migration failed.",
  );
  process.exitCode = 1;
});
