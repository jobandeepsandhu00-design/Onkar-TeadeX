import { getAccessToken } from "../api";
export async function brainRequest<T>(
  path = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to access your scanner.");
  const response = await fetch(`/api/market-brain${path}`, {
    method,
    signal: signal ?? AbortSignal.timeout(25_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Scanner API unavailable. Retry shortly." }));
  if (!response.ok) throw new Error(data.error || "Scanner request failed");
  return data as T;
}
