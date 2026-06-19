// Talks to the Express backend. Keeps the same shape the app already expects:
//   storage.get(key)  -> { value: string } | null
//   storage.set(key, value) -> Promise<void>
// In dev, requests go to "/api/*" and Vite proxies them to the Express server.

const TOKEN_KEY = "src_auth_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    throw new Error("unauthorized");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/* ---------- Auth ---------- */
export async function register(email: string, password: string) {
  const { token } = await req("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(token);
  return token;
}

export async function login(email: string, password: string) {
  const { token } = await req("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(token);
  return token;
}

export async function me() {
  return req("/auth/me");
}

export function logout() {
  clearToken();
}

/* ---------- Per-user state (drop-in for window.storage) ---------- */
export const storage = {
  async get(_key: string): Promise<{ value: string } | null> {
    const { value } = await req("/state");
    return value ? { value } : null;
  },
  async set(_key: string, value: string): Promise<void> {
    await req("/state", { method: "PUT", body: JSON.stringify({ value }) });
  },
};
