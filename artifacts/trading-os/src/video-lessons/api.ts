import { getAccessToken, getProfile, me, supabase } from "../api";
import * as tus from "tus-js-client";
import type {
  DashboardPlacement,
  LessonCaption,
  LessonChecklistItem,
  LessonDraft,
  LessonProgress,
  LessonRule,
  TranscriptResult,
  VideoLesson,
} from "./types";

const LESSON_BUCKET = "trading-lessons";

type LessonRow = {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  category: VideoLesson["category"];
  difficulty: VideoLesson["difficulty"];
  timeframe: string;
  tags: string[] | null;
  video_path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  audio_type: VideoLesson["audioType"];
  captions_enabled: boolean;
  autoplay: boolean;
  published: boolean;
  featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  video_lesson_captions?: Array<{ id: string; start_time: number; end_time: number; text: string; sort_order: number }>;
  video_lesson_rules?: Array<{ id: string; text: string; sort_order: number }>;
  video_lesson_checklist?: Array<{ id: string; text: string; sort_order: number }>;
  dashboard_placements?: Array<{ placement: DashboardPlacement; enabled: boolean }>;
};

function mapLesson(row: LessonRow): VideoLesson {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    slug: row.slug,
    shortDescription: row.short_description || "",
    description: row.description || "",
    category: row.category,
    difficulty: row.difficulty,
    timeframe: row.timeframe,
    tags: row.tags || [],
    videoPath: row.video_path,
    thumbnailPath: row.thumbnail_path,
    duration: Number(row.duration_seconds || 0),
    audioType: row.audio_type || "original_video_audio",
    captionsEnabled: row.captions_enabled,
    autoplay: row.autoplay,
    published: row.published,
    featured: row.featured,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    captions: (row.video_lesson_captions || []).map((caption) => ({
      id: caption.id,
      startTime: Number(caption.start_time),
      endTime: Number(caption.end_time),
      text: caption.text,
      order: caption.sort_order,
    })).sort((a, b) => a.order - b.order),
    rules: (row.video_lesson_rules || []).map((rule) => ({ id: rule.id, text: rule.text, order: rule.sort_order })).sort((a, b) => a.order - b.order),
    checklist: (row.video_lesson_checklist || []).map((item) => ({ id: item.id, text: item.text, order: item.sort_order })).sort((a, b) => a.order - b.order),
    placements: (row.dashboard_placements || []).filter((item) => item.enabled).map((item) => item.placement),
  };
}

const lessonSelect = `
  *,
  video_lesson_captions(id,start_time,end_time,text,sort_order),
  video_lesson_rules(id,text,sort_order),
  video_lesson_checklist(id,text,sort_order),
  dashboard_placements(placement,enabled)
`;

export async function listVideoLessons(includeDrafts = false): Promise<VideoLesson[]> {
  let query = supabase.from("video_lessons").select(lessonSelect).order("featured", { ascending: false }).order("sort_order").order("updated_at", { ascending: false });
  if (!includeDrafts) query = query.eq("published", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message.includes("video_lessons") ? "Video Lessons database is not installed yet." : error.message);
  return ((data || []) as unknown as LessonRow[]).map(mapLesson);
}

export async function getVideoLesson(id: string): Promise<VideoLesson | null> {
  const { data, error } = await supabase.from("video_lessons").select(lessonSelect).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapLesson(data as unknown as LessonRow) : null;
}

export async function saveVideoLesson(draft: LessonDraft): Promise<VideoLesson> {
  const profile = await getProfile();
  const payload = {
    id: draft.id,
    owner_id: profile.id,
    title: draft.title.trim(),
    slug: draft.slug,
    short_description: draft.shortDescription,
    description: draft.description,
    category: draft.category,
    difficulty: draft.difficulty,
    timeframe: draft.timeframe,
    tags: draft.tags,
    video_path: draft.videoPath,
    thumbnail_path: draft.thumbnailPath,
    duration_seconds: draft.duration,
    audio_type: draft.audioType,
    captions_enabled: draft.captionsEnabled,
    autoplay: draft.autoplay,
    published: draft.published,
    featured: draft.featured,
    sort_order: draft.sortOrder,
  };
  const { error } = await supabase.from("video_lessons").upsert(payload);
  if (error) throw error;

  const childTables = ["video_lesson_captions", "video_lesson_rules", "video_lesson_checklist", "dashboard_placements"] as const;
  for (const table of childTables) {
    const { error: deleteError } = await supabase.from(table).delete().eq("lesson_id", draft.id);
    if (deleteError) throw deleteError;
  }

  if (draft.captions.length) {
    const { error: captionsError } = await supabase.from("video_lesson_captions").insert(draft.captions.map((caption) => ({
      id: caption.id, lesson_id: draft.id, start_time: caption.startTime, end_time: caption.endTime, text: caption.text, sort_order: caption.order,
    })));
    if (captionsError) throw captionsError;
  }
  if (draft.rules.length) {
    const { error: rulesError } = await supabase.from("video_lesson_rules").insert(draft.rules.map((rule) => ({ id: rule.id, lesson_id: draft.id, text: rule.text, sort_order: rule.order })));
    if (rulesError) throw rulesError;
  }
  if (draft.checklist.length) {
    const { error: checklistError } = await supabase.from("video_lesson_checklist").insert(draft.checklist.map((item) => ({ id: item.id, lesson_id: draft.id, text: item.text, sort_order: item.order })));
    if (checklistError) throw checklistError;
  }
  if (draft.placements.length) {
    const { error: placementsError } = await supabase.from("dashboard_placements").insert(draft.placements.map((placement, sortOrder) => ({ lesson_id: draft.id, placement, sort_order: sortOrder, enabled: true })));
    if (placementsError) throw placementsError;
  }
  const lesson = await getVideoLesson(draft.id);
  if (!lesson) throw new Error("Lesson was saved but could not be reloaded.");
  return lesson;
}

export async function deleteVideoLesson(lesson: VideoLesson): Promise<void> {
  const profile = await getProfile();
  if (lesson.ownerId !== profile.id) throw new Error("You can only delete lessons you uploaded.");
  const candidatePaths = [lesson.videoPath, lesson.thumbnailPath].filter((path): path is string => Boolean(path));
  const paths: string[] = [];
  for (const path of candidatePaths) {
    const { count, error: referenceError } = await supabase
      .from("video_lessons")
      .select("id", { count: "exact", head: true })
      .neq("id", lesson.id)
      .or("video_path.eq." + path + ",thumbnail_path.eq." + path);
    if (referenceError) throw referenceError;
    if (!count) paths.push(path);
  }
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(LESSON_BUCKET).remove(paths);
    if (storageError) throw storageError;
  }
  const { error } = await supabase.from("video_lessons").delete().eq("id", lesson.id);
  if (error) throw error;
}

export async function uploadLessonMedia(
  file: File,
  kind: "videos" | "thumbnails",
  lessonId: string,
  onProgress?: (percentage: number) => void,
): Promise<string> {
  const profile = await getProfile();
  const allowed = kind === "videos"
    ? ["video/mp4", "video/webm", "video/quicktime"]
    : ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error(kind === "videos" ? "Use MP4, WEBM, or MOV video." : "Use JPG, PNG, or WEBP image.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = [profile.id, lessonId, kind, crypto.randomUUID() + "-" + safeName].join("/");
  if (kind === "videos" && file.size > 6 * 1024 * 1024) {
    const token = await getAccessToken();
    const projectUrl = new URL(import.meta.env.VITE_SUPABASE_URL as string);
    const projectRef = projectUrl.hostname.split(".")[0];
    if (!token || !projectRef) throw new Error("Your session expired before the upload started.");
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: "https://" + projectRef + ".storage.supabase.co/storage/v1/upload/resumable",
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: "Bearer " + token },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
        metadata: {
          bucketName: LESSON_BUCKET,
          objectName: path,
          contentType: file.type,
          cacheControl: "3600",
          metadata: JSON.stringify({ lessonId, kind }),
        },
        onError: reject,
        onProgress: (uploaded, total) => onProgress?.(total ? uploaded / total * 100 : 0),
        onSuccess: () => resolve(),
      });
      void upload.findPreviousUploads().then((previousUploads) => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      }).catch(reject);
    });
    onProgress?.(100);
    return path;
  }
  const { error } = await supabase.storage.from(LESSON_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  onProgress?.(100);
  return path;
}

export async function removeLessonMedia(path?: string | null): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(LESSON_BUCKET).remove([path]);
  if (error) throw error;
}

export async function getLessonMediaUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(LESSON_BUCKET).createSignedUrl(path, 60 * 60 * 6);
  if (error) throw error;
  return data.signedUrl;
}

export async function generateLessonTranscript(videoPath: string, title: string): Promise<TranscriptResult> {
  const videoUrl = await getLessonMediaUrl(videoPath);
  const token = await getAccessToken();
  if (!videoUrl || !token) throw new Error("Your session expired before transcription started.");
  const response = await fetch("/api/video-lessons/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ videoUrl, title }),
  });
  const body = await response.json() as TranscriptResult & { error?: string };
  if (!response.ok) throw new Error(body.error || "Automatic transcription failed.");
  return body;
}

export async function getLessonProgress(): Promise<Record<string, LessonProgress>> {
  const user = await me();
  const { data, error } = await supabase.from("lesson_progress").select("lesson_id,watched_seconds,percentage,completed,last_watched_at,notes,checklist_state").eq("user_id", user.id);
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.lesson_id, {
    lessonId: row.lesson_id,
    watchedSeconds: Number(row.watched_seconds || 0),
    percentage: Number(row.percentage || 0),
    completed: Boolean(row.completed),
    lastWatchedAt: row.last_watched_at,
    notes: row.notes || "",
    checklistState: (row.checklist_state || {}) as Record<string, boolean>,
  }]));
}

export async function saveLessonProgress(progress: LessonProgress): Promise<void> {
  const user = await me();
  const { error } = await supabase.from("lesson_progress").upsert({
    user_id: user.id,
    lesson_id: progress.lessonId,
    watched_seconds: progress.watchedSeconds,
    percentage: progress.percentage,
    completed: progress.completed,
    last_watched_at: progress.lastWatchedAt,
    notes: progress.notes,
    checklist_state: progress.checklistState,
  }, { onConflict: "user_id,lesson_id" });
  if (error) throw error;
}

export async function getSavedLessonIds(): Promise<string[]> {
  const user = await me();
  const { data, error } = await supabase.from("saved_lessons").select("lesson_id").eq("user_id", user.id);
  if (error) throw error;
  return (data || []).map((row) => row.lesson_id);
}

export async function setLessonSaved(lessonId: string, saved: boolean): Promise<void> {
  const user = await me();
  if (saved) {
    const { error } = await supabase.from("saved_lessons").upsert({ user_id: user.id, lesson_id: lessonId }, { onConflict: "user_id,lesson_id" });
    if (error) throw error;
  } else {
    const { error } = await supabase.from("saved_lessons").delete().eq("user_id", user.id).eq("lesson_id", lessonId);
    if (error) throw error;
  }
}

export function makeCaption(text = "", startTime = 0, endTime = 4, order = 0): LessonCaption {
  return { id: crypto.randomUUID(), text, startTime, endTime, order };
}

export function makeRule(text = "", order = 0): LessonRule {
  return { id: crypto.randomUUID(), text, order };
}

export function makeChecklistItem(text = "", order = 0): LessonChecklistItem {
  return { id: crypto.randomUUID(), text, order };
}
