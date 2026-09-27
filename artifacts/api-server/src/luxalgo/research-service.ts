import { createHash } from "node:crypto";
import type { SupabaseIdentity } from "../lib/supabase-auth";
import { ScannerStore } from "../market-brain/store";
import { luxAlgoMCP } from "./mcp-service";
import { searchLocalLuxAlgo } from "./library-store";

type CacheRow = { payload: unknown; expires_at: string };
const inflight = new Map<string, Promise<unknown>>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const cacheKey = (tool: string, args: Record<string, unknown>) => hash(JSON.stringify([tool, args]));

export async function cachedLuxAlgoCall<T>(
  tool: string,
  args: Record<string, unknown> = {},
  options: { force?: boolean; ttlMinutes?: number; cache?: boolean } = {},
): Promise<{ data: T; cache: "HIT" | "MISS" | "STALE" }> {
  const service = ScannerStore.service();
  const key = cacheKey(tool, args);
  if (options.cache !== false && !options.force) {
    const rows = await service.request<CacheRow[]>("luxalgo_cache_items", {
      cache_key: `eq.${key}`, select: "payload,expires_at", limit: "1",
    }).catch(() => []);
    if (rows[0] && new Date(rows[0].expires_at).getTime() > Date.now()) return { data: rows[0].payload as T, cache: "HIT" };
  }
  const pending = inflight.get(key);
  if (pending) return { data: await pending as T, cache: "MISS" };
  const request = luxAlgoMCP.callTool<T>(tool, args);
  inflight.set(key, request);
  try {
    const data = await request;
    const fetched = new Date();
    const expires = new Date(fetched.getTime() + (options.ttlMinutes ?? 360) * 60_000);
    if (options.cache !== false)
      await service.request("luxalgo_cache_items", { on_conflict: "cache_key" }, "POST", {
        cache_key: key, tool_name: tool, arguments: args, payload: data,
        content_hash: hash(JSON.stringify(data)), fetched_at: fetched.toISOString(), expires_at: expires.toISOString(), updated_at: fetched.toISOString(),
      }, "resolution=merge-duplicates,return=minimal").catch(() => null);
    return { data, cache: "MISS" };
  } catch (error) {
    const rows = options.cache === false ? [] : await service.request<CacheRow[]>("luxalgo_cache_items", {
      cache_key: `eq.${key}`, select: "payload,expires_at", limit: "1",
    }).catch(() => []);
    if (rows[0]) return { data: rows[0].payload as T, cache: "STALE" };
    throw error;
  } finally { inflight.delete(key); }
}

export const searchLuxAlgoConcept = (query: string, force = false) =>
  cachedLuxAlgoCall("library_search", { query, type: "concepts", limit: 12 }, { force, ttlMinutes: 180 });
export const getLuxAlgoConcept = (slug: string, force = false) =>
  cachedLuxAlgoCall("library_get_concept", { slug }, { force, ttlMinutes: 1440 });
export const getLuxAlgoIndicator = (slug: string, force = false) =>
  cachedLuxAlgoCall("library_get_indicator", { slug }, { force, ttlMinutes: 1440 });
export const getLuxAlgoSource = (slug: string, force = false) =>
  cachedLuxAlgoCall("library_get_source_code", { slug }, { force, ttlMinutes: 1440 });
export const getLuxAlgoEdgeStats = (preset: string, symbol: string, force = false) =>
  cachedLuxAlgoCall("edge_report", { preset, symbol }, { force, ttlMinutes: 720 });

export type LuxAlgoAgent = "master" | "trend" | "zone" | "setup" | "backtest" | "insight";
export async function agentLuxAlgoResearch(identity: Pick<SupabaseIdentity, "userId">, agent: LuxAlgoAgent, query: string) {
  const rows = await ScannerStore.service().request<Array<Record<string, unknown>>>("luxalgo_user_settings", {
    user_id: `eq.${identity.userId}`, select: "*", limit: "1",
  }).catch(() => []);
  const settings = rows[0] ?? {};
  if (settings.enabled === false || settings[`allow_${agent}_ai`] === false) return null;
  const savedResults = await searchLocalLuxAlgo(identity, query, "all").catch(() => []);
  if (savedResults.length) return { sourceType: "LUXALGO_REFERENCE" as const, source: "SUPABASE_SYNC" as const, data: { results: savedResults }, cache: "HIT" as const };
  const result = await searchLuxAlgoConcept(query);
  return { sourceType: "LUXALGO_REFERENCE" as const, source: "MCP_FALLBACK" as const, ...result };
}
