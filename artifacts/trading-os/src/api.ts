import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const AUTH_PERSISTENCE_KEY = "tradex_auth_persistence";

function selectedAuthStorage() {
  return localStorage.getItem(AUTH_PERSISTENCE_KEY) === "session" ? sessionStorage : localStorage;
}

const authStorage = {
  getItem(key: string) {
    const selected = selectedAuthStorage();
    const alternate = selected === localStorage ? sessionStorage : localStorage;
    const value = selected.getItem(key) ?? alternate.getItem(key);
    if (value && !selected.getItem(key)) {
      selected.setItem(key, value);
      alternate.removeItem(key);
    }
    return value;
  },
  setItem(key: string, value: string) {
    const selected = selectedAuthStorage();
    const alternate = selected === localStorage ? sessionStorage : localStorage;
    selected.setItem(key, value);
    alternate.removeItem(key);
  },
  removeItem(key: string) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

if (!url || !publishableKey) {
  throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage,
  },
});

export function setAuthPersistence(remember: boolean) {
  localStorage.setItem(AUTH_PERSISTENCE_KEY, remember ? "local" : "session");

  const selected = remember ? localStorage : sessionStorage;
  const alternate = remember ? sessionStorage : localStorage;
  const authKeys = Array.from({ length: alternate.length }, (_, index) => alternate.key(index))
    .filter((key): key is string => Boolean(key?.includes("-auth-token")));

  for (const key of authKeys) {
    const value = alternate.getItem(key);
    if (value) selected.setItem(key, value);
    alternate.removeItem(key);
  }
}

export function getAuthPersistence() {
  return localStorage.getItem(AUTH_PERSISTENCE_KEY) !== "session";
}

export async function login(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function register(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
  return data.user;
}

export async function loginWithOAuth(provider: "google" | "apple") {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) throw error;
}

export async function getOAuthProviderAvailability() {
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
  });
  if (!response.ok) throw new Error("Could not check social sign-in availability.");
  const settings = await response.json() as { external?: Record<string, boolean> };
  return {
    google: Boolean(settings.external?.google),
    apple: Boolean(settings.external?.apple),
  };
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function me() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error || new Error("unauthorized");
  return data.user;
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function getProfile() {
  const user = await me();
  const { data, error } = await supabase.from("profiles").select("id,email,role").eq("id", user.id).single();
  if (error) throw error;
  return data as { id: string; email: string | null; role: "user" | "owner" };
}

export async function uploadAttachment(file: File) {
  const user = await me();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("trading-attachments").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  const { data, error: signedError } = await supabase.storage.from("trading-attachments").createSignedUrl(path, 60 * 60);
  if (signedError) throw signedError;
  return { path, signedUrl: data.signedUrl };
}

/** Download private attachment bytes for an offline backup. */
export async function downloadAttachment(path: string) {
  const { data, error } = await supabase.storage.from("trading-attachments").download(path);
  if (error) throw error;
  return data;
}

/** Re-home restored bytes under the authenticated user's private storage prefix. */
export async function uploadRestoredAttachment(blob: Blob, name: string, mime?: string) {
  const user = await me();
  const safeName = (name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("trading-attachments").upload(path, blob, {
    contentType: mime || blob.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  const { data, error: signedError } = await supabase.storage.from("trading-attachments").createSignedUrl(path, 60 * 60);
  if (signedError) throw signedError;
  return { path, signedUrl: data.signedUrl };
}

export async function removeAttachment(path?: string) {
  if (!path) return;
  const { error } = await supabase.storage.from("trading-attachments").remove([path]);
  if (error) throw error;
}

export async function refreshAttachmentUrl(path?: string) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("trading-attachments").createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export const storage = {
  async get(_key: string) {
    const user = await me();
    const { data, error } = await supabase.from("app_state").select("data").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return data ? { value: JSON.stringify(data.data) } : null;
  },
  async set(_key: string, value: string) {
    const parsed = JSON.parse(value);
    const { error } = await supabase.rpc("save_trading_state", { state: parsed });
    if (error) throw error;
  },
};