import { createHash, randomUUID } from "node:crypto";
import { logger } from "../lib/logger";

export const LUXALGO_ENDPOINT = "https://mcp.luxalgo.com/mcp";
const PUBLIC_TOOLS = new Set([
  "library_search", "library_get_concept", "library_get_indicator",
  "library_get_source_code", "library_list_concepts", "library_list_indicators",
  "library_list_tags", "library_list_families", "library_get_family",
  "edge_symbols", "edge_presets", "edge_report",
]);

export type LuxAlgoHealthState = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "AUTH_REQUIRED";
export type LuxAlgoTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};
export type LuxAlgoHealth = {
  status: LuxAlgoHealthState;
  endpoint: string;
  lastSuccessfulRequest: string | null;
  lastAttempt: string | null;
  availableTools: string[];
  authenticationState: "PUBLIC" | "REQUIRED" | "UNKNOWN";
  lastError: string | null;
};

type RpcEnvelope = {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const externalMessage = (value: unknown) =>
  value instanceof Error ? value.message.slice(0, 500) : String(value).slice(0, 500);

function parseMcpBody(text: string): RpcEnvelope {
  const candidates = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  const raw = candidates.at(-1) ?? text.trim();
  if (!raw) throw new Error("LuxAlgo MCP returned an empty response.");
  const parsed = JSON.parse(raw) as RpcEnvelope;
  if (parsed.error) throw new Error(parsed.error.message || "LuxAlgo MCP request failed.");
  return parsed;
}

async function boundedResponseText(response: Response, maxBytes = 5_000_000) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("LuxAlgo MCP response exceeded the research size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("LuxAlgo MCP response exceeded the research size limit.");
    }
    chunks.push(part.value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

function parseToolResult(result: Record<string, unknown> | undefined): unknown {
  if (!result) throw new Error("LuxAlgo MCP returned no result.");
  if (result.isError === true) {
    const blocks = Array.isArray(result.content) ? result.content : [];
    const message = blocks
      .filter((block): block is { text: string } => Boolean(block && typeof block === "object" && "text" in block && typeof block.text === "string"))
      .map((block) => block.text)
      .join("\n");
    throw new Error(message || "LuxAlgo MCP tool reported an error.");
  }
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks
    .filter((block): block is { text: string } => Boolean(block && typeof block === "object" && "text" in block && typeof block.text === "string"))
    .map((block) => block.text)
    .join("\n");
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { text }; }
}

export class LuxAlgoMCPService {
  private tools = new Map<string, LuxAlgoTool>();
  private lastSuccessfulRequest: string | null = null;
  private lastAttempt: string | null = null;
  private lastError: string | null = null;
  private status: LuxAlgoHealthState = "DISCONNECTED";
  private discoveryExpiresAt = 0;
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly endpoint = process.env.LUXALGO_MCP_ENDPOINT || LUXALGO_ENDPOINT,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  health(): LuxAlgoHealth {
    return {
      status: this.status,
      endpoint: this.endpoint,
      lastSuccessfulRequest: this.lastSuccessfulRequest,
      lastAttempt: this.lastAttempt,
      availableTools: [...this.tools.keys()].sort(),
      authenticationState: this.status === "AUTH_REQUIRED" ? "REQUIRED" : this.lastSuccessfulRequest ? "PUBLIC" : "UNKNOWN",
      lastError: this.lastError,
    };
  }

  private async rpc(method: string, params: Record<string, unknown>, retries = 2): Promise<RpcEnvelope> {
    let failure: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      this.lastAttempt = new Date().toISOString();
      try {
        const response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            "User-Agent": "OnkarTradeX-LuxAlgo-Research/1.0",
          },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
        });
        if (response.status === 401 || response.status === 403) {
          this.status = "AUTH_REQUIRED";
          throw new Error("LuxAlgo Sign-In Required");
        }
        if (!response.ok) throw new Error(`LuxAlgo MCP returned HTTP ${response.status}.`);
        const envelope = parseMcpBody(await boundedResponseText(response));
        this.lastSuccessfulRequest = new Date().toISOString();
        this.lastError = null;
        this.status = "CONNECTED";
        return envelope;
      } catch (error) {
        failure = error;
        this.lastError = externalMessage(error);
        if (this.status === "AUTH_REQUIRED") break;
        this.status = this.lastSuccessfulRequest ? "DEGRADED" : "DISCONNECTED";
        if (attempt < retries) await sleep(180 * 2 ** attempt);
      }
    }
    logger.warn({ err: this.lastError, method }, "LuxAlgo MCP request failed");
    throw failure instanceof Error ? failure : new Error("LuxAlgo Research Temporarily Unavailable");
  }

  async discoverTools(force = false): Promise<LuxAlgoTool[]> {
    if (!force && this.tools.size && Date.now() < this.discoveryExpiresAt) return [...this.tools.values()];
    const envelope = await this.rpc("tools/list", {}, 1);
    const tools = Array.isArray(envelope.result?.tools) ? envelope.result.tools : [];
    this.tools.clear();
    for (const raw of tools) {
      if (!raw || typeof raw !== "object") continue;
      const tool = raw as LuxAlgoTool;
      if (typeof tool.name === "string" && PUBLIC_TOOLS.has(tool.name)) this.tools.set(tool.name, tool);
    }
    this.discoveryExpiresAt = Date.now() + 15 * 60_000;
    return [...this.tools.values()];
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!PUBLIC_TOOLS.has(name)) throw new Error("This LuxAlgo tool is not permitted in the research module.");
    await this.discoverTools();
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`LuxAlgo tool '${name}' is not available.`);
    const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
    const input = {
      ...args,
      ...(required.includes("context") && !args.context
        ? { context: "Retrieving public technical-analysis research to support an educational comparison within a trading research workspace." }
        : {}),
    };
    const key = createHash("sha256").update(JSON.stringify([name, input])).digest("hex");
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const request = this.rpc("tools/call", { name, arguments: input })
      .then((envelope) => parseToolResult(envelope.result) as T)
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }
}

export const luxAlgoMCP = new LuxAlgoMCPService();
export const LUXALGO_PUBLIC_TOOLS = [...PUBLIC_TOOLS];
