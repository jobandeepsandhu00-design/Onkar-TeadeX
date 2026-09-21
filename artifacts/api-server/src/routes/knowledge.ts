import { Router, type IRouter, type Request, type Response } from "express";
import { requireSupabaseUser } from "../lib/supabase-auth";
import { ScannerError, ScannerStore } from "../market-brain/store";
import { knowledgeDashboard, searchKnowledge, syncLibraryKnowledge } from "../onkar-ai/knowledge-service";

const router: IRouter = Router();
const uuid = (value: unknown) => {
  const id = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new ScannerError("Invalid identifier", 400);
  return id;
};
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try { await handler(req, res); }
    catch (cause) {
      const status = cause instanceof ScannerError ? cause.status : 500;
      res.status(status).json({ error: cause instanceof ScannerError ? cause.message : "Knowledge service unavailable. Existing Library data is unchanged." });
    }
  };
}
async function identity(req: Request) {
  try { return await requireSupabaseUser(req.headers.authorization); }
  catch { throw new ScannerError("Please log in again to access Onkar AI knowledge.", 401); }
}

router.get("/onkar-ai/knowledge", route(async (req, res) => {
  const current = await identity(req);
  res.json(await knowledgeDashboard(current.userId));
}));

router.get("/onkar-ai/knowledge/search", route(async (req, res) => {
  const current = await identity(req);
  const query = String(req.query.q || "").trim();
  if (query.length < 2) throw new ScannerError("Enter at least two search characters.", 400);
  res.json({ items: await searchKnowledge(current.userId, query), query });
}));

router.post("/onkar-ai/knowledge/sync", route(async (req, res) => {
  const current = await identity(req);
  res.json({ synced: true, ...(await syncLibraryKnowledge(current.userId)) });
}));

router.get("/onkar-ai/knowledge/:id", route(async (req, res) => {
  const current = await identity(req), id = uuid(req.params.id), store = ScannerStore.service();
  const [item] = await store.request<Array<Record<string, unknown>>>("onkar_knowledge_items", { id: `eq.${id}`, user_id: `eq.${current.userId}`, limit: "1" });
  if (!item) throw new ScannerError("Knowledge item not found.", 404);
  const [sources, outgoing, incoming] = await Promise.all([
    store.request<Array<Record<string, unknown>>>("onkar_knowledge_sources", { knowledge_id: `eq.${id}`, user_id: `eq.${current.userId}`, order: "created_at.asc", limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_knowledge_links", { from_knowledge_id: `eq.${id}`, user_id: `eq.${current.userId}`, limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_knowledge_links", { to_knowledge_id: `eq.${id}`, user_id: `eq.${current.userId}`, limit: "100" }),
  ]);
  res.json({ item, sources, links: [...outgoing, ...incoming] });
}));

router.patch("/onkar-ai/knowledge/:id", route(async (req, res) => {
  const current = await identity(req), id = uuid(req.params.id), store = ScannerStore.service();
  const action = String(req.body?.action || "").toUpperCase();
  const patch = action === "APPROVE"
    ? { status: "HUMAN_VERIFIED", human_verified: true, updated_at: new Date().toISOString() }
    : action === "REJECT"
      ? { status: "REJECTED", human_verified: false, updated_at: new Date().toISOString() }
      : action === "TEST_FIRST"
        ? { status: "NEEDS_REVIEW", human_verified: false, updated_at: new Date().toISOString() }
        : null;
  if (!patch) throw new ScannerError("Choose APPROVE, REJECT or TEST_FIRST.", 400);
  const rows = await store.request<Array<Record<string, unknown>>>("onkar_knowledge_items", { id: `eq.${id}`, user_id: `eq.${current.userId}` }, "PATCH", patch);
  if (!rows.length) throw new ScannerError("Knowledge item not found.", 404);
  await store.request("onkar_learning_audit", { on_conflict: "user_id,event_key" }, "POST", {
    user_id: current.userId, event_key: `knowledge:${id}:${action}:${Date.now()}`, event_type: `KNOWLEDGE_${action}`,
    source_type: "KNOWLEDGE", source_id: id, agent: "HUMAN", title: `Knowledge ${action.toLowerCase().replaceAll("_", " ")}`,
    detail: { knowledgeId: id, action },
  }, "resolution=ignore-duplicates,return=minimal");
  res.json(rows[0]);
}));

router.post("/onkar-ai/knowledge/jobs/:id/retry", route(async (req, res) => {
  const current = await identity(req), id = uuid(req.params.id);
  const rows = await ScannerStore.service().request<Array<Record<string, unknown>>>("onkar_ingestion_jobs", { id: `eq.${id}`, user_id: `eq.${current.userId}` }, "PATCH", {
    stage: "UPLOADED", attempt_count: 0, next_attempt_at: new Date().toISOString(), locked_until: null,
    failed_stage: null, last_error: null, updated_at: new Date().toISOString(),
  });
  if (!rows.length) throw new ScannerError("Learning job not found.", 404);
  res.json(rows[0]);
}));

router.put("/onkar-ai/learning/preferences", route(async (req, res) => {
  const current = await identity(req), body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const safeKeys = ["auto_analysis","auto_library_learning","auto_video_analysis","auto_trade_learning","auto_pattern_discovery","auto_backtest","auto_replay","auto_shadow","auto_forward"];
  const patch = Object.fromEntries(safeKeys.filter((key) => typeof body[key] === "boolean").map((key) => [key, body[key]]));
  const [saved] = await ScannerStore.service().request<Array<Record<string, unknown>>>("onkar_learning_preferences", { on_conflict: "user_id" }, "POST", {
    user_id: current.userId, ...patch,
    auto_live_rule_changes: false, auto_strategy_promotion: false, auto_live_new_strategies: false,
    updated_at: new Date().toISOString(),
  }, "resolution=merge-duplicates,return=representation");
  res.json(saved);
}));

export default router;
