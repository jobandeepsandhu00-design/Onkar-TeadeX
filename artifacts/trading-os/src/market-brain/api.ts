import { getAccessToken } from "../api";
import type { MasterAIRequest, MasterAIResponse } from "@workspace/api-zod";
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

export async function masterAIRequest(input: MasterAIRequest, signal?: AbortSignal) {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to use Master AI.");
  const response = await fetch("/api/onkar-ai/master", {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(35_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({ error: "Master AI is temporarily unavailable." }));
  if (!response.ok) throw new Error(data.error || "Master AI request failed");
  return data as MasterAIResponse;
}
