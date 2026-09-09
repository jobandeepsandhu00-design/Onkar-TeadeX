export type SupabaseIdentity = {
  userId: string;
  authorization: string;
  apiKey: string;
  supabaseUrl: string;
};

export type LessonAccess = {
  id: string;
  owner_id: string;
  published: boolean;
  video_storage_provider: string | null;
  video_object_key: string | null;
  thumbnail_object_key: string | null;
  caption_object_key: string | null;
  audio_object_key: string | null;
};

function getSupabaseEnvironment() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !apiKey)
    throw new Error("Supabase server environment is incomplete.");
  return { supabaseUrl, apiKey };
}

export async function requireSupabaseUser(
  authorization?: string,
): Promise<SupabaseIdentity> {
  const { supabaseUrl, apiKey } = getSupabaseEnvironment();
  if (!authorization?.startsWith("Bearer "))
    throw new Error("Authentication required.");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: apiKey },
  });
  if (!response.ok)
    throw new Error("Your session has expired. Please log in again.");
  const user = (await response.json()) as { id?: string };
  if (!user.id) throw new Error("Authentication required.");
  return { userId: user.id, authorization, apiKey, supabaseUrl };
}

export async function getLesson(
  identity: SupabaseIdentity,
  lessonId: string,
): Promise<LessonAccess | null> {
  const select =
    "id,owner_id,published,video_storage_provider,video_object_key,thumbnail_object_key,caption_object_key,audio_object_key";
  const response = await fetch(
    `${identity.supabaseUrl}/rest/v1/video_lessons?id=eq.${lessonId}&select=${select}`,
    {
      headers: {
        Authorization: identity.authorization,
        apikey: identity.apiKey,
      },
    },
  );
  if (!response.ok) throw new Error("Lesson access could not be verified.");
  const rows = (await response.json()) as LessonAccess[];
  return rows[0] || null;
}
