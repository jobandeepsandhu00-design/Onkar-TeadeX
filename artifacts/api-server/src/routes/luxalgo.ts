import { Router, type Request, type Response } from "express";
import { requireSupabaseUser, type SupabaseIdentity } from "../lib/supabase-auth";
import { ScannerStore } from "../market-brain/store";
import { luxAlgoMCP } from "../luxalgo/mcp-service";
import { cachedLuxAlgoCall } from "../luxalgo/research-service";
import {
  cancelLuxAlgoSync,
  luxAlgoLocalOverview,
  luxAlgoSyncStatus,
  resumeLuxAlgoSync,
  retryLuxAlgoFailures,
  startLuxAlgoSync,
  stepLuxAlgoSync,
} from "../luxalgo/sync-service";
import {
  getLocalLuxAlgo,
  getLocalLuxAlgoSource,
  listLocalLuxAlgo,
  localLuxAlgoTaxonomy,
  searchLocalLuxAlgo,
} from "../luxalgo/library-store";

const router = Router();
const text = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const integer = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const boolean = (value: unknown) => value === true || value === "true" || value === "1";
const safeSlug = (value: unknown) => {
  const slug = text(value, 180);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) throw new Error("Invalid LuxAlgo identifier.");
  return slug;
};
const safeUrl = (value: unknown) => {
  const url = text(value, 1000);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !/(^|\.)luxalgo\.com$/i.test(parsed.hostname)) throw new Error("Only official LuxAlgo URLs can be saved.");
  return parsed.toString();
};
const safeReferenceUrl = (value: unknown) => {
  const url = text(value, 1000);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !/(^|\.)(luxalgo\.com|mozilla\.org)$/i.test(parsed.hostname)) throw new Error("Only official LuxAlgo or license reference URLs can be saved.");
  return parsed.toString();
};
const responseError = (res: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "LuxAlgo Research Temporarily Unavailable";
  const status = /Authentication required|session has expired/i.test(message) ? 401 : /already running/i.test(message) ? 409 : /Sign-In Required/i.test(message) ? 424 : /Invalid|must|required/i.test(message) ? 400 : 503;
  res.status(status).json({ error: message });
};
async function identity(req: Request) { return requireSupabaseUser(req.headers.authorization); }
async function preferences(current: SupabaseIdentity) {
  const rows = await ScannerStore.user(current).request<Array<Record<string, unknown>>>("luxalgo_user_settings", {
    user_id: `eq.${current.userId}`, select: "*", limit: "1",
  }).catch(() => []);
  return rows[0] ?? { enabled: true, cache_enabled: true, cache_duration_minutes: 360, edge_stats_enabled: true, saved_research_enabled: true };
}
async function call(res: Response, current: SupabaseIdentity, tool: string, args: Record<string, unknown>, force: boolean) {
  const settings = await preferences(current);
  if (settings.enabled === false) throw new Error("LuxAlgo MCP is disabled in Settings.");
  if (tool.startsWith("edge_") && settings.edge_stats_enabled === false) throw new Error("LuxAlgo Edge Stats is disabled in Settings.");
  const result = await cachedLuxAlgoCall(tool, args, { force, cache: settings.cache_enabled !== false, ttlMinutes: integer(settings.cache_duration_minutes, 360, 5, 10080) });
  res.json({ ...result, sourceType: "LUXALGO_REFERENCE" });
}

router.get("/luxalgo/health", async (req, res) => {
  try {
    const current = await identity(req);
    if ((await preferences(current)).enabled === false) {
      res.json({ ...luxAlgoMCP.health(), status: "DISCONNECTED", lastError: "LuxAlgo MCP is disabled in Settings." });
      return;
    }
    await luxAlgoMCP.discoverTools(boolean(req.query.refresh));
    res.json(luxAlgoMCP.health());
  } catch (error) { responseError(res, error); }
});
router.post("/luxalgo/test-connection", async (req, res) => {
  try { await identity(req); await luxAlgoMCP.discoverTools(true); res.json(luxAlgoMCP.health()); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/tools", async (req, res) => {
  try { await identity(req); res.json({ tools: await luxAlgoMCP.discoverTools() }); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/overview", async (req, res) => {
  try { await identity(req); res.json(await luxAlgoLocalOverview()); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/taxonomy", async (req, res) => {
  try { await identity(req); res.json(await localLuxAlgoTaxonomy()); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/search", async (req, res) => {
  try {
    const current = await identity(req), query = text(req.query.q, 200);
    if (!query) throw new Error("Search query is required.");
    const kind = ["concepts", "indicators"].includes(text(req.query.type)) ? text(req.query.type) as "concepts" | "indicators" : "all";
    const results = await searchLocalLuxAlgo(current, query, kind, { family: text(req.query.family), tag: text(req.query.tag), source_code: boolean(req.query.source_code), saved: boolean(req.query.saved) });
    await ScannerStore.service().request("luxalgo_search_history", {}, "POST", { user_id: current.userId, query, filters: { kind, source: "SUPABASE_SYNC" } }, "return=minimal").catch(() => null);
    res.json({ results, total: results.length, sourceType: "LUXALGO_REFERENCE", source: "SUPABASE_SYNC" });
  } catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/concepts", async (req, res) => {
  try { const current = await identity(req); res.json(await listLocalLuxAlgo(current, "concepts", { ...req.query, source_code: boolean(req.query.source_code), saved: boolean(req.query.saved) })); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/indicators", async (req, res) => {
  try { const current = await identity(req); res.json(await listLocalLuxAlgo(current, "indicators", { ...req.query, source_code: boolean(req.query.source_code), saved: boolean(req.query.saved) })); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/concepts/:slug", async (req, res) => {
  try { await identity(req); const item = await getLocalLuxAlgo("concept", safeSlug(req.params.slug)); if (!item) { res.status(404).json({ error: "LuxAlgo concept is not imported yet." }); return; } res.json({ data: item, sourceType: "LUXALGO_REFERENCE" }); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/indicators/:slug", async (req, res) => {
  try { await identity(req); const item = await getLocalLuxAlgo("indicator", safeSlug(req.params.slug)); if (!item) { res.status(404).json({ error: "LuxAlgo indicator is not imported yet." }); return; } res.json({ data: item, sourceType: "LUXALGO_REFERENCE" }); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/local/source/:slug", async (req, res) => {
  try { await identity(req); const item = await getLocalLuxAlgoSource(safeSlug(req.params.slug)); if (!item) { res.status(404).json({ error: "Public source code has not been imported for this indicator." }); return; } res.json({ data: { ...item, available: true, source: item.source_code }, sourceType: "LUXALGO_REFERENCE" }); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/sync/status", async (req, res) => {
  try { await identity(req); res.json(await luxAlgoSyncStatus()); }
  catch (error) { responseError(res, error); }
});
router.post("/luxalgo/sync/start", async (req, res) => {
  try {
    const current = await identity(req), settings = await preferences(current);
    if (settings.enabled === false || settings.manual_sync_enabled === false) throw new Error("Manual LuxAlgo sync is disabled in Settings.");
    const mode = text(req.body?.mode).toUpperCase() === "FULL" ? "FULL" : "CHANGES";
    res.status(202).json({ state: await startLuxAlgoSync(current, mode, {
      saveRaw: settings.save_raw_responses !== false,
      saveSource: settings.save_public_source_code !== false,
      preserveAttribution: settings.preserve_attribution !== false,
      preserveLicense: settings.preserve_license_metadata !== false,
    }) });
  } catch (error) { responseError(res, error); }
});
router.post("/luxalgo/sync/resume", async (req, res) => {
  try { res.status(202).json({ state: await resumeLuxAlgoSync(await identity(req)) }); }
  catch (error) { responseError(res, error); }
});
router.post("/luxalgo/sync/retry", async (req, res) => {
  try { res.status(202).json({ state: await retryLuxAlgoFailures(await identity(req)) }); }
  catch (error) { responseError(res, error); }
});
router.post("/luxalgo/sync/step", async (req, res) => {
  try {
    const jobId = text(req.body?.jobId, 80);
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("A valid LuxAlgo sync job id is required.");
    res.json({ state: await stepLuxAlgoSync(await identity(req), jobId) });
  } catch (error) { responseError(res, error); }
});
router.post("/luxalgo/sync/cancel", async (req, res) => {
  try { res.json({ state: await cancelLuxAlgoSync(await identity(req)) }); }
  catch (error) { responseError(res, error); }
});
router.get("/luxalgo/overview", async (req, res) => {
  try {
    const current = await identity(req);
    const settings = await preferences(current);
    if (settings.enabled === false) throw new Error("LuxAlgo MCP is disabled in Settings.");
    const cacheOptions = { cache: settings.cache_enabled !== false, ttlMinutes: integer(settings.cache_duration_minutes, 360, 5, 10080), force: boolean(req.query.refresh) };
    const [families, concepts, indicators, edge] = await Promise.all([
      cachedLuxAlgoCall<any>("library_list_families", {}, cacheOptions),
      cachedLuxAlgoCall<any>("library_list_concepts", { page: 0, page_size: 1 }, cacheOptions),
      cachedLuxAlgoCall<any>("library_list_indicators", { page: 0, page_size: 1 }, cacheOptions),
      settings.edge_stats_enabled === false ? null : cachedLuxAlgoCall<any>("edge_symbols", {}, cacheOptions).catch(() => null),
    ]);
    res.json({ health: luxAlgoMCP.health(), families: families.data?.families ?? [], conceptCount: concepts.data?.total ?? null, indicatorCount: indicators.data?.total ?? null, edgeAvailable: Boolean(edge), cache: [families.cache, concepts.cache, indicators.cache] });
  } catch (error) { responseError(res, error); }
});
router.get("/luxalgo/search", async (req, res) => {
  try {
    const current = await identity(req), query = text(req.query.q, 200);
    if (!query) throw new Error("Search query is required.");
    const type = ["all", "concepts", "indicators"].includes(text(req.query.type)) ? text(req.query.type) : "all";
    await ScannerStore.service().request("luxalgo_search_history", {}, "POST", { user_id: current.userId, query, filters: { type, family: text(req.query.family) || null } }, "return=minimal").catch(() => null);
    await call(res, current, "library_search", { query, type, ...(text(req.query.family) ? { family: text(req.query.family) } : {}), limit: integer(req.query.limit, 20, 1, 50) }, boolean(req.query.refresh));
  } catch (error) { responseError(res, error); }
});
router.get("/luxalgo/families", async (req, res) => { try { const current = await identity(req); await call(res, current, "library_list_families", {}, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/families/:key", async (req, res) => { try { const current = await identity(req); await call(res, current, "library_get_family", { key: safeSlug(req.params.key) }, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/tags", async (req, res) => { try { const current = await identity(req); await call(res, current, "library_list_tags", {}, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/concepts", async (req, res) => {
  try { const current = await identity(req); await call(res, current, "library_list_concepts", { ...(text(req.query.family) ? { family: text(req.query.family) } : {}), page: integer(req.query.page, 0, 0, 10000), page_size: integer(req.query.page_size, 48, 1, 200) }, boolean(req.query.refresh)); }
  catch (e) { responseError(res, e); }
});
router.get("/luxalgo/concepts/:slug", async (req, res) => { try { const current = await identity(req); await call(res, current, "library_get_concept", { slug: safeSlug(req.params.slug) }, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/indicators", async (req, res) => {
  try {
    const current = await identity(req);
    const args: Record<string, unknown> = { page: integer(req.query.page, 0, 0, 10000), page_size: integer(req.query.page_size, 24, 1, 100) };
    for (const key of ["family", "text", "concept", "platform", "tier", "sort", "direction"]) if (text(req.query[key])) args[key] = text(req.query[key]);
    if (text(req.query.tags)) args.tags = text(req.query.tags).split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
    await call(res, current, "library_list_indicators", args, boolean(req.query.refresh));
  } catch (e) { responseError(res, e); }
});
router.get("/luxalgo/indicators/:slug", async (req, res) => { try { const current = await identity(req); await call(res, current, "library_get_indicator", { slug: safeSlug(req.params.slug) }, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/source/:slug", async (req, res) => { try { const current = await identity(req); await call(res, current, "library_get_source_code", { slug: safeSlug(req.params.slug) }, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/edge/symbols", async (req, res) => { try { const current = await identity(req); await call(res, current, "edge_symbols", {}, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/edge/presets", async (req, res) => { try { const current = await identity(req); await call(res, current, "edge_presets", text(req.query.category) ? { category: text(req.query.category) } : {}, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });
router.get("/luxalgo/edge/report", async (req, res) => { try { const current = await identity(req); await call(res, current, "edge_report", { preset: safeSlug(req.query.preset), symbol: text(req.query.symbol, 40).toUpperCase() }, boolean(req.query.refresh)); } catch (e) { responseError(res, e); } });

router.get("/luxalgo/saved", async (req, res) => {
  try { const current = await identity(req); res.json({ items: await ScannerStore.user(current).request("luxalgo_saved_items", { user_id: `eq.${current.userId}`, order: "created_at.desc", limit: "200" }) }); }
  catch (e) { responseError(res, e); }
});
router.post("/luxalgo/saved", async (req, res) => {
  try {
    const current = await identity(req), kind = text(req.body?.itemType, 30).toUpperCase(), externalId = safeSlug(req.body?.externalId);
    if ((await preferences(current)).saved_research_enabled === false) throw new Error("Saved Research is disabled in Settings.");
    if (!["CONCEPT", "INDICATOR", "FAMILY", "EDGE_REPORT"].includes(kind)) throw new Error("Invalid saved research type.");
    const [item] = await ScannerStore.service().request<any[]>("luxalgo_saved_items", { on_conflict: "user_id,item_type,external_id" }, "POST", {
      user_id: current.userId, item_type: kind, external_id: externalId, name: text(req.body?.name, 240) || externalId,
      family: text(req.body?.family, 80) || null, official_url: safeUrl(req.body?.officialUrl), snapshot: req.body?.snapshot && typeof req.body.snapshot === "object" ? req.body.snapshot : {},
      notes: text(req.body?.notes, 10_000) || null, related_onkar_setups: Array.isArray(req.body?.relatedOnkarSetups) ? req.body.relatedOnkarSetups.slice(0, 100) : [],
      attribution: text(req.body?.attribution, 240) || "LuxAlgo", license_url: safeReferenceUrl(req.body?.licenseUrl),
      license_metadata: req.body?.licenseMetadata && typeof req.body.licenseMetadata === "object" ? req.body.licenseMetadata : {},
      last_synced_at: text(req.body?.lastSyncedAt, 50) || null, updated_at: new Date().toISOString(),
    }, "resolution=merge-duplicates,return=representation");
    res.status(201).json({ item });
  } catch (e) { responseError(res, e); }
});
router.delete("/luxalgo/saved/:id", async (req, res) => {
  try { const current = await identity(req); await ScannerStore.user(current).request("luxalgo_saved_items", { id: `eq.${text(req.params.id, 80)}`, user_id: `eq.${current.userId}` }, "DELETE", undefined, "return=minimal"); res.status(204).end(); }
  catch (e) { responseError(res, e); }
});
router.get("/luxalgo/history", async (req, res) => {
  try { const current = await identity(req); res.json({ searches: await ScannerStore.user(current).request("luxalgo_search_history", { user_id: `eq.${current.userId}`, order: "created_at.desc", limit: "30" }) }); }
  catch (e) { responseError(res, e); }
});
router.get("/luxalgo/settings", async (req, res) => {
  try { const current = await identity(req); const rows = await ScannerStore.user(current).request<any[]>("luxalgo_user_settings", { user_id: `eq.${current.userId}`, limit: "1" }); res.json({ settings: rows[0] ?? null }); }
  catch (e) { responseError(res, e); }
});
router.put("/luxalgo/settings", async (req, res) => {
  try {
    const current = await identity(req), body = req.body ?? {};
    const row: Record<string, unknown> = { user_id: current.userId, updated_at: new Date().toISOString() };
    for (const key of ["enabled", "cache_enabled", "manual_sync_enabled", "allow_master_ai", "allow_trend_ai", "allow_zone_ai", "allow_setup_ai", "allow_backtest_ai", "allow_insight_ai", "edge_stats_enabled", "saved_research_enabled", "save_raw_responses", "save_public_source_code", "preserve_attribution", "preserve_license_metadata"]) if (key in body) row[key] = Boolean(body[key]);
    if ("cache_duration_minutes" in body) row.cache_duration_minutes = integer(body.cache_duration_minutes, 360, 5, 10080);
    const [settings] = await ScannerStore.service().request<any[]>("luxalgo_user_settings", { on_conflict: "user_id" }, "POST", row, "resolution=merge-duplicates,return=representation");
    res.json({ settings });
  } catch (e) { responseError(res, e); }
});
router.post("/luxalgo/compare", async (req, res) => {
  try {
    const current: SupabaseIdentity = await identity(req), concept = req.body?.concept;
    if (!concept || typeof concept !== "object") throw new Error("LuxAlgo concept data is required.");
    const query = text(req.body?.setup, 160);
    const versions = await ScannerStore.user(current).request<Array<Record<string, unknown>>>("scanner_strategy_versions", { order: "created_at.desc", limit: "100" });
    const selected = query ? versions.filter((row) => `${row.name ?? ""} ${JSON.stringify(row.definition ?? {})}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : versions.slice(0, 8);
    const luxText = `${(concept as any).name ?? ""} ${(concept as any).content_markdown ?? ""}`.toLowerCase();
    const tokens = new Set((luxText.match(/[a-z]{5,}/g) ?? []).filter((token: string) => !["which", "their", "about", "would", "trading", "market"].includes(token)));
    const comparisons = selected.map((row) => {
      const definition = JSON.stringify(row.definition ?? {});
      const words = [...new Set(definition.toLowerCase().match(/[a-z]{5,}/g) ?? [])];
      return { id: row.id, name: row.name, commonTerms: words.filter((word) => tokens.has(word)).slice(0, 12), onkarRules: row.definition, note: "Research comparison only. The approved Onkar setup remains authoritative and is not modified." };
    });
    res.json({ sourceType: "LUXALGO_REFERENCE", luxAlgo: concept, comparisons, executionAuthority: "ONKAR_SETUP_RULE" });
  } catch (e) { responseError(res, e); }
});

export default router;
