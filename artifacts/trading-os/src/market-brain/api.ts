import { getAccessToken } from "../api";
import {
  masterAIResponseSchema,
  type AgentProgressEvent,
  type MasterAIRequest,
} from "@workspace/api-zod";
import { readMasterStream } from "../onkar-ai/read-master-stream";
import { agentRuntime } from "../onkar-ai/agent-runtime";
export async function brainRequest<T>(
  path = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to access your scanner.");
  // Only requests with an actual analysis endpoint get a lifecycle; queued scans are NOT scanning.
  const agent =
    method === "POST" && path === "/backtest"
      ? "backtest"
      : method === "POST" && path === "/chat"
        ? "insight"
        : null;
  const operation = crypto.randomUUID();
  if (agent) agentRuntime.operationStart(agent, operation);
  try {
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
    if (agent) agentRuntime.operationEnd(agent, operation, true);
    return data as T;
  } catch (error) {
    if (agent) agentRuntime.operationEnd(agent, operation, false);
    throw error;
  }
}

export async function masterAIRequest(
  input: MasterAIRequest,
  signal?: AbortSignal,
  onProgress?: (event: AgentProgressEvent) => void,
) {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to use Master AI.");
  const response = await fetch("/api/onkar-ai/master", {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(55_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input),
  });
  if (
    response.ok &&
    response.body &&
    response.headers.get("content-type")?.includes("text/event-stream")
  )
    return readMasterStream(response.body, onProgress);
  const data = await response
    .json()
    .catch(() => ({ error: "Master AI is temporarily unavailable." }));
  if (!response.ok) throw new Error(data.error || "Master AI request failed");
  return masterAIResponseSchema.parse(data);
}
