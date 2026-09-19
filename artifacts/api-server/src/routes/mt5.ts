import { Router, type IRouter, type Request, type Response } from "express";
import { requireSupabaseUser } from "../lib/supabase-auth";
import type { SupabaseIdentity } from "../lib/supabase-auth";
import { ScannerStore } from "../market-brain/store";
import {
  MT5BridgeError,
  checkMT5Order,
  executeMT5Order,
  getMT5Account,
  getMT5Orders,
  getMT5Positions,
  mt5BridgeRequest,
} from "../mt5/client";
import {
  requireMT5BridgeOwner,
  syncMT5JournalUser,
} from "../mt5/journal-sync";

const router: IRouter = Router();
const executionTimes = new Map<string, number[]>();
function enforceExecutionRate(userId: string) {
  const now = Date.now();
  const recent = (executionTimes.get(userId) ?? []).filter(
    (value) => value > now - 60_000,
  );
  if (recent.length >= 10)
    throw new MT5BridgeError("Execution rate limit reached", 429);
  executionTimes.set(userId, [...recent, now]);
}
async function workspaceFor(identity: SupabaseIdentity) {
  const service = ScannerStore.service();
  const memberships = await service.request<Array<{ workspace_id: string }>>(
    "workspace_members",
    { user_id: `eq.${identity.userId}`, select: "workspace_id", limit: "1" },
  );
  if (!memberships[0]?.workspace_id)
    throw new MT5BridgeError("Trading workspace unavailable", 403);
  return { service, workspaceId: memberships[0].workspace_id };
}

async function syncConnection(identity: SupabaseIdentity) {
  const context = await workspaceFor(identity);
  const savedManualMappings = await context.service.request<
    Array<{ internal_symbol: string; broker_symbol: string }>
  >("broker_symbol_map", {
    user_id: `eq.${identity.userId}`,
    manually_confirmed: "eq.true",
    select: "internal_symbol,broker_symbol",
  });
  await Promise.allSettled(
    savedManualMappings.map((item) =>
      mt5BridgeRequest(
        `/symbols/mapping?internal=${encodeURIComponent(item.internal_symbol)}&broker=${encodeURIComponent(item.broker_symbol)}`,
        { method: "PUT" },
      ),
    ),
  );
  const [account, symbols, health] = await Promise.all([
    getMT5Account(),
    mt5BridgeRequest<{
      watchlist: Array<{
        internal: string;
        broker: string | null;
        confidence: number;
        manual?: boolean;
      }>;
      available: string[];
    }>("/symbols"),
    mt5BridgeRequest<{
      diagnostics?: {
        lastTickAt?: number | null;
        lastClosedCandle?: unknown;
        lastExecutionAt?: number | null;
        webSocketClients?: number;
        symbolsSubscribed?: number;
      };
    }>("/health"),
  ]);
  const rows = await context.service.request<Array<{ id: string }>>(
    "mt5_connections",
    { on_conflict: "user_id" },
    "POST",
    {
      user_id: identity.userId,
      workspace_id: context.workspaceId,
      broker: account.broker,
      server: account.server,
      masked_account: account.account,
      account_type: account.accountType,
      currency: account.currency,
      status: account.connection,
      last_tick_at: health.diagnostics?.lastTickAt
        ? new Date(health.diagnostics.lastTickAt).toISOString()
        : null,
      last_seen_at: new Date().toISOString(),
      diagnostics: {
        terminalConnected: account.terminalConnected,
        tradeAllowed: account.tradeAllowed,
        tradingEnabled: account.tradingEnabled,
        liveTradingAllowed: account.liveTradingAllowed,
        availableSymbols: symbols.available.length,
        ...health.diagnostics,
      },
      updated_at: new Date().toISOString(),
    },
    "resolution=merge-duplicates,return=representation",
  );
  const mappings = symbols.watchlist.filter((item) => item.broker);
  if (mappings.length)
    await context.service.request(
      "broker_symbol_map",
      { on_conflict: "connection_id,internal_symbol" },
      "POST",
      mappings.map((item) => ({
        user_id: identity.userId,
        connection_id: rows[0].id,
        internal_symbol: item.internal,
        broker_symbol: item.broker,
        confidence: item.confidence,
        manually_confirmed: Boolean(item.manual),
        updated_at: new Date().toISOString(),
      })),
      "resolution=merge-duplicates,return=minimal",
    );
  return { account, symbols };
}
const route =
  (handler: (req: Request, res: Response, identity: SupabaseIdentity) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const identity = await requireSupabaseUser(req.headers.authorization);
      requireMT5BridgeOwner(identity.userId);
      await handler(req, res, identity);
    } catch (error) {
      const status = error instanceof MT5BridgeError ? error.status : 401;
      res.status(status).json({
        error:
          error instanceof Error ? error.message : "MT5 request unavailable",
      });
    }
  };

router.get("/mt5/status", route(async (_req, res) => res.json(await mt5BridgeRequest("/health"))));
router.get("/mt5/account", route(async (_req, res) => res.json(await getMT5Account())));
router.get("/mt5/positions", route(async (_req, res) => res.json({ positions: await getMT5Positions() })));
router.get("/mt5/orders", route(async (_req, res) => res.json(await getMT5Orders())));
router.get(
  "/mt5/symbols",
  route(async (_req, res, identity) =>
    res.json((await syncConnection(identity)).symbols),
  ),
);
router.post(
  "/mt5/sync",
  route(async (_req, res, identity) => {
    const connection = await syncConnection(identity);
    const journal = await syncMT5JournalUser(identity.userId);
    res.json({ ...connection, journal });
  }),
);
router.post(
  "/mt5/journal/sync",
  route(async (req, res, identity) =>
    res.json(await syncMT5JournalUser(identity.userId, Number(req.body?.days || 30))),
  ),
);
router.put(
  "/mt5/symbols/mapping",
  route(async (req, res, identity) => {
    const internal = String(req.body?.internal || "").toUpperCase();
    const broker = String(req.body?.broker || "");
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(internal) || !/^[A-Za-z0-9._-]{3,40}$/.test(broker))
      throw new MT5BridgeError("Invalid symbol mapping", 400);
    await mt5BridgeRequest(
      `/symbols/mapping?internal=${encodeURIComponent(internal)}&broker=${encodeURIComponent(broker)}`,
      { method: "PUT" },
    );
    const { service } = await workspaceFor(identity);
    const connections = await service.request<Array<{ id: string }>>(
      "mt5_connections",
      { user_id: `eq.${identity.userId}`, select: "id", limit: "1" },
    );
    if (!connections[0]) throw new MT5BridgeError("Sync MT5 connection first", 409);
    await service.request(
      "broker_symbol_map",
      { on_conflict: "connection_id,internal_symbol" },
      "POST",
      {
        user_id: identity.userId,
        connection_id: connections[0].id,
        internal_symbol: internal,
        broker_symbol: broker,
        confidence: 1,
        manually_confirmed: true,
        updated_at: new Date().toISOString(),
      },
      "resolution=merge-duplicates,return=minimal",
    );
    res.json({ internal, broker, manuallyConfirmed: true });
  }),
);
router.post("/mt5/orders/check", route(async (req, res) => res.json(await checkMT5Order(req.body))));
router.post(
  "/mt5/orders/execute",
  route(async (req, res, identity) => {
    enforceExecutionRate(identity.userId);
    const { candidateId = null, ...orderInput } = req.body ?? {};
    const { service, workspaceId } = await workspaceFor(identity);
    const existing = await service.request<Array<{ id: string; status: string }>>(
      "trade_execution_requests",
      {
        user_id: `eq.${identity.userId}`,
        request_id: `eq.${String(orderInput.requestId || "")}`,
        select: "id,status",
        limit: "1",
      },
    );
    if (existing.length && existing[0].status === "SENT")
      throw new MT5BridgeError("This order request was already executed", 409);
    const rows = await service.request<Array<{ id: string }>>(
      "trade_execution_requests",
      { on_conflict: "user_id,request_id" },
      "POST",
      {
        user_id: identity.userId,
        workspace_id: workspaceId,
        request_id: orderInput.requestId,
        candidate_id: candidateId,
        action: orderInput.action,
        request: { ...orderInput, confirmed: Boolean(orderInput.confirmed) },
        status: orderInput.confirmed ? "CONFIRMED" : "PREPARED",
        manually_confirmed_at: orderInput.confirmed
          ? new Date().toISOString()
          : null,
      },
      "resolution=merge-duplicates,return=representation",
    );
    const result = await executeMT5Order(orderInput);
    await service.request(
      "trade_execution_requests",
      { id: `eq.${rows[0].id}`, user_id: `eq.${identity.userId}` },
      "PATCH",
      { status: result.ok ? "SENT" : "REJECTED", updated_at: new Date().toISOString() },
    );
    await service.request(
      "trade_execution_results",
      { on_conflict: "request_id" },
      "POST",
      {
        user_id: identity.userId,
        request_id: rows[0].id,
        mt5_order: result.order ?? null,
        mt5_deal: result.deal ?? null,
        retcode: result.retcode ?? null,
        success: Boolean(result.ok),
        result,
      },
      "resolution=merge-duplicates,return=minimal",
    );
    res.json(result);
  }),
);

export default router;
