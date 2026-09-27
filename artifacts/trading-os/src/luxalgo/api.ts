import { getAccessToken } from "../api";

export async function luxRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to use LuxAlgo Research.");
  const response = await fetch(`/api/luxalgo${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({ error: "LuxAlgo Research Temporarily Unavailable" }));
  if (!response.ok) throw new Error(data.error || "LuxAlgo request failed.");
  return data as T;
}
