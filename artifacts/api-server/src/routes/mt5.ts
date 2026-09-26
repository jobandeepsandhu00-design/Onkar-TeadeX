import { Router, type IRouter, type Request, type Response } from "express";
import { scannerConfigSchema } from "@workspace/api-zod";
import { requireSupabaseUser } from "../lib/supabase-auth";
import type { SupabaseIdentity } from "../lib/supabase-auth";
import { logger } from "../lib/logger";
import { ScannerStore } from "../market-brain/store";
import {
  MT5BridgeError,
  claimMT5Order,
  checkMT5Order,
  executeMT5Order,
  getMT5Account,
  getMT5AccountIdentity,
  getMT5ExecutionResult,
  getMT5Orders,
  getMT5Positions,
  getMT5SymbolSpec,
  getMT5TradeHistory,
  mt5BridgeRequest,
  reconcileMT5State,
} from "../mt5/client";
import {
  mt5AccountBindingMatches,
  mt5FingerprintsMatch,
  type MT5AccountBinding,
} from "../mt5/account-identity";
import {
  MANUAL_PREFLIGHT_TTL_MS,
  MANUAL_CONFIRM_RECONCILIATION_GRACE_MS,
  MANUAL_UNRESOLVED_STATUSES,
  manualConfirmedReconciliationBlocker,
  manualMT5OrderDigest,
  manualNewExposureBlocker,
  manualPreflightBlocker,
  manualReconciliationDecision,
  parseManualMT5Order,
  type ManualPreflightBinding,
} from "../mt5/manual-preflight";
import { requireMT5BridgeOwner, syncMT5JournalUser } from "../mt5/journal-sync";
import {
  defaultMT5PortfolioDependencies,
  getVerifiedMT5Portfolio,
} from "../mt5/portfolio";

const router: IRouter = Router();
const executionTimes = new Map<string, number[]>();

function isZodError(error: unknown): error is Error & { issues: unknown[] } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    Array.isArray((error as Error & { issues?: unknown }).issues)
  );
}

function enforceExecutionRate(userId: string) {
  const now = Date.now();
  const recent = (executionTimes.get(userId) ?? []).filter(
    (value) => value > now - 60_000,
  );
  if (recent.length >= 10)
    throw new MT5BridgeError("Execution rate limit reached", 429);
  executionTimes.set(userId, [...recent, now]);
}

function manualOrder(input: unknown, confirmed: boolean) {
  try {
    const order = parseManualMT5Order(input, confirmed);
    const newExposureBlocker = manualNewExposureBlocker(order.action);
    if (newExposureBlocker) throw new MT5BridgeError(newExposureBlocker, 403);
    return order;
  } catch (error) {
    if (error instanceof MT5BridgeError) throw error;
    const message =
      error instanceof Error && error.name !== "ZodError"
        ? error.message
        : "Invalid MT5 order request";
    throw new MT5BridgeError(message, 400);
  }
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

async function selectedManualMT5Account(
  service: ScannerStore,
  userId: string,
  connectedFingerprint: string,
) {
  const [configRow] = await service.request<Array<{ config: unknown }>>(
    "scanner_configs",
    { user_id: `eq.${userId}`, select: "config", limit: "1" },
  );
  const config = scannerConfigSchema.safeParse(configRow?.config);
  const selectedAccountId = config.success ? config.data.accountId : null;
  if (!selectedAccountId)
    throw new MT5BridgeError(
      "Select and sync the MT5 trading account in scanner settings before checking an order.",
      409,
    );
  const [binding] = await service.request<MT5AccountBinding[]>(
    "mt5_account_bindings",
    {
      user_id: `eq.${userId}`,
      selected_account_id: `eq.${selectedAccountId}`,
      select: "selected_account_id,account_fingerprint",
      limit: "1",
    },
  );
  if (
    !mt5AccountBindingMatches(binding, selectedAccountId, connectedFingerprint)
  )
    throw new MT5BridgeError(
      "The selected trading account does not match the connected MT5 terminal. Sync MT5 and select that exact account before continuing.",
      409,
    );
  return { selectedAccountId, binding: binding! };
}

type ManualExecutionRow = {
  id: string;
  request_id: string;
  status: string;
  updated_at: string;
  candidate_id?: string | null;
};

const unresolvedStatusFilter = `in.(${MANUAL_UNRESOLVED_STATUSES.join(",")})`;

async function unresolvedManualExecution(
  service: ScannerStore,
  userId: string,
  requestId?: string,
) {
  const rows = await service.request<ManualExecutionRow[]>(
    "trade_execution_requests",
    {
      user_id: `eq.${userId}`,
      candidate_id: "is.null",
      status: unresolvedStatusFilter,
      ...(requestId ? { request_id: `eq.${requestId}` } : {}),
      select: "id,request_id,status,updated_at",
      order: "updated_at.asc",
      limit: "1",
    },
  );
  return rows[0] ?? null;
}

async function unresolvedMT5Execution(service: ScannerStore, userId: string) {
  const rows = await service.request<ManualExecutionRow[]>(
    "trade_execution_requests",
    {
      user_id: `eq.${userId}`,
      status: unresolvedStatusFilter,
      select: "id,request_id,status,updated_at,candidate_id",
      order: "updated_at.asc",
      limit: "1",
    },
  );
  return rows[0] ?? null;
}

function unresolvedAutomaticProjection(row: ManualExecutionRow) {
  return {
    state: "RECONCILING" as const,
    requestId: row.request_id,
    updatedAt: row.updated_at,
    message:
      "An automatic MT5 execution is unresolved. Manual orders remain locked while the execution engine reconciles it.",
    canReconcile: false,
  };
}

function unresolvedManualProjection(row: ManualExecutionRow | null) {
  if (!row)
    return {
      state: "CLEAR" as const,
      requestId: null,
      message: "No unresolved manual MT5 order.",
      canReconcile: false,
    };
  const handoffBlocker = manualConfirmedReconciliationBlocker(row);
  if (handoffBlocker)
    return {
      state: "RECONCILING" as const,
      requestId: row.request_id,
      updatedAt: row.updated_at,
      message: handoffBlocker,
      canReconcile: false,
    };
  return {
    state: row.status === "RECONCILING" ? "RECONCILING" : "UNCERTAIN",
    requestId: row.request_id,
    updatedAt: row.updated_at,
    message:
      row.status === "RECONCILING"
        ? "The original MT5 request is being reconciled. Do not submit another order."
        : "The original MT5 outcome is uncertain. Reconcile it before preparing another order.",
    canReconcile: true,
  };
}

async function storeManualExecutionResult(
  service: ScannerStore,
  userId: string,
  executionRequestId: string,
  result: Record<string, unknown>,
) {
  await service.request(
    "trade_execution_results",
    { on_conflict: "request_id" },
    "POST",
    {
      user_id: userId,
      request_id: executionRequestId,
      mt5_order: result.order ?? null,
      mt5_deal: result.deal ?? null,
      retcode: result.retcode ?? null,
      success: Boolean(result.ok),
      result,
    },
    "resolution=merge-duplicates,return=minimal",
  );
}

async function reconcileManualExecution(
  service: ScannerStore,
  identity: SupabaseIdentity,
  row: ManualExecutionRow,
) {
  const handoffBlocker = manualConfirmedReconciliationBlocker(row);
  if (handoffBlocker) throw new MT5BridgeError(handoffBlocker, 409);
  const claimedAt = new Date();
  const claimed = await service.rpc<boolean>(
    "claim_mt5_manual_reconciliation",
    {
      p_user: identity.userId,
      p_execution_request: row.id,
      p_claimed_at: claimedAt.toISOString(),
      p_stale_before: new Date(
        claimedAt.getTime() - MANUAL_CONFIRM_RECONCILIATION_GRACE_MS,
      ).toISOString(),
    },
  );
  if (!claimed)
    throw new MT5BridgeError(
      "Manual MT5 reconciliation state changed or the broker handoff is still fresh. Refresh before continuing.",
      409,
    );

  let lookup;
  try {
    lookup = await getMT5ExecutionResult(row.request_id);
  } catch (error) {
    await service
      .request(
        "trade_execution_requests",
        { id: `eq.${row.id}`, user_id: `eq.${identity.userId}` },
        "PATCH",
        { status: "UNCERTAIN", updated_at: new Date().toISOString() },
        "return=minimal",
      )
      .catch(() => undefined);
    throw error;
  }

  const decision = manualReconciliationDecision(lookup);
  if (!decision.resolved) {
    await service.request(
      "trade_execution_requests",
      { id: `eq.${row.id}`, user_id: `eq.${identity.userId}` },
      "PATCH",
      { status: "UNCERTAIN", updated_at: new Date().toISOString() },
      "return=minimal",
    );
    return {
      state: "UNCERTAIN" as const,
      requestId: row.request_id,
      message: decision.message,
      canReconcile: true,
      reconciliationState: lookup.reconciliationState ?? "MANUAL_REVIEW",
    };
  }

  // Store broker truth before releasing the global manual-order lock. A crash
  // between these writes leaves RECONCILING and is safe to repeat.
  await storeManualExecutionResult(
    service,
    identity.userId,
    row.id,
    decision.result,
  );
  await service.request(
    "trade_execution_requests",
    { id: `eq.${row.id}`, user_id: `eq.${identity.userId}` },
    "PATCH",
    { status: decision.status, updated_at: new Date().toISOString() },
    "return=minimal",
  );
  return {
    state: "RESOLVED" as const,
    outcome: decision.status,
    requestId: row.request_id,
    message: decision.message,
    canReconcile: false,
    result: decision.result,
  };
}

async function syncConnection(identity: SupabaseIdentity) {
  const context = await workspaceFor(identity);
  const identityBefore = await getMT5AccountIdentity();
  const savedManualMappings = await context.service.request<
    Array<{ internal_symbol: string; broker_symbol: string }>
  >("mt5_symbol_mapping_bindings", {
    user_id: `eq.${identity.userId}`,
    account_fingerprint: `eq.${identityBefore.accountFingerprint}`,
    select: "internal_symbol,broker_symbol",
  });
  await Promise.all(
    savedManualMappings.map((item) =>
      mt5BridgeRequest(
        `/symbols/mapping?internal=${encodeURIComponent(item.internal_symbol)}&broker=${encodeURIComponent(item.broker_symbol)}`,
        {
          method: "PUT",
          headers: {
            "X-Expected-Account-Fingerprint": identityBefore.accountFingerprint,
          },
        },
      ),
    ),
  );
  const identityAfterMappings = await getMT5AccountIdentity();
  if (
    !mt5FingerprintsMatch(
      identityBefore.accountFingerprint,
      identityAfterMappings.accountFingerprint,
    )
  )
    throw new MT5BridgeError(
      "Connected MT5 account changed while restoring symbol mappings. Sync again.",
      409,
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
  const identityAfterRead = await getMT5AccountIdentity();
  if (
    !mt5FingerprintsMatch(
      identityBefore.accountFingerprint,
      identityAfterRead.accountFingerprint,
    )
  )
    throw new MT5BridgeError(
      "Connected MT5 account changed during synchronization. Sync again.",
      409,
    );
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
  (
    handler: (
      req: Request,
      res: Response,
      identity: SupabaseIdentity,
    ) => Promise<unknown>,
  ) =>
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    let identity: SupabaseIdentity;
    try {
      identity = await requireSupabaseUser(req.headers.authorization);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message === "Authentication required." ||
        message === "Your session has expired. Please log in again."
      ) {
        res.status(401).json({ error: message });
        return;
      }
      logger.error(
        { event: "mt5_auth_service_error", err: error },
        "MT5 authentication service failed",
      );
      res.status(500).json({ error: "Authentication service unavailable." });
      return;
    }
    try {
      requireMT5BridgeOwner(identity.userId);
      await handler(req, res, identity);
    } catch (error) {
      if (error instanceof MT5BridgeError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (isZodError(error)) {
        logger.error(
          { event: "mt5_bridge_contract_error", issues: error.issues },
          "MT5 bridge response failed contract validation",
        );
        res.status(502).json({ error: "MT5 bridge returned invalid data." });
        return;
      }
      logger.error(
        { event: "mt5_route_error", err: error },
        "Unexpected MT5 route failure",
      );
      res.status(500).json({ error: "MT5 request unavailable." });
    }
  };

router.get(
  "/mt5/status",
  route(async (_req, res) => res.json(await mt5BridgeRequest("/health"))),
);
router.get(
  "/mt5/account",
  route(async (_req, res) => res.json(await getMT5Account())),
);
router.get(
  "/mt5/portfolio",
  route(async (_req, res, identity) => {
    const service = ScannerStore.service();
    res.json(
      await getVerifiedMT5Portfolio(
        identity.userId,
        defaultMT5PortfolioDependencies(service),
      ),
    );
  }),
);
router.get(
  "/mt5/positions",
  route(async (_req, res) => res.json({ positions: await getMT5Positions() })),
);
router.get(
  "/mt5/orders",
  route(async (_req, res) => res.json(await getMT5Orders())),
);
router.get(
  "/mt5/history/deals",
  route(async (req, res) =>
    res.json({
      trades: await getMT5TradeHistory(Number(req.query.days || 30)),
    }),
  ),
);
router.get(
  "/mt5/symbols",
  route(async (_req, res, identity) =>
    res.json((await syncConnection(identity)).symbols),
  ),
);
router.post(
  "/mt5/sync",
  route(async (_req, res, identity) => {
    const reconciliation = await reconcileMT5State();
    const connection = await syncConnection(identity);
    const journal = await syncMT5JournalUser(identity.userId);
    res.json({ ...connection, reconciliation, journal });
  }),
);
router.post(
  "/mt5/reconcile",
  route(async (_req, res, identity) => {
    const reconciliation = await reconcileMT5State();
    const connection = await syncConnection(identity);
    const journal = await syncMT5JournalUser(identity.userId);
    res.json({ reconciliation, connection, journal });
  }),
);
router.post(
  "/mt5/journal/sync",
  route(async (req, res, identity) =>
    res.json(
      await syncMT5JournalUser(identity.userId, Number(req.body?.days || 30)),
    ),
  ),
);
router.put(
  "/mt5/symbols/mapping",
  route(async (req, res, identity) => {
    const internal = String(req.body?.internal || "").toUpperCase();
    const broker = String(req.body?.broker || "");
    if (
      !/^[A-Z]{3}\/[A-Z]{3}$/.test(internal) ||
      !/^[A-Za-z0-9._-]{3,40}$/.test(broker)
    )
      throw new MT5BridgeError("Invalid symbol mapping", 400);
    const { service } = await workspaceFor(identity);
    const connections = await service.request<Array<{ id: string }>>(
      "mt5_connections",
      { user_id: `eq.${identity.userId}`, select: "id", limit: "1" },
    );
    if (!connections[0])
      throw new MT5BridgeError("Sync MT5 connection first", 409);
    const identityBefore = await getMT5AccountIdentity();
    await mt5BridgeRequest(
      `/symbols/mapping?internal=${encodeURIComponent(internal)}&broker=${encodeURIComponent(broker)}`,
      {
        method: "PUT",
        headers: {
          "X-Expected-Account-Fingerprint": identityBefore.accountFingerprint,
        },
      },
    );
    const identityAfter = await getMT5AccountIdentity();
    if (
      !mt5FingerprintsMatch(
        identityBefore.accountFingerprint,
        identityAfter.accountFingerprint,
      )
    )
      throw new MT5BridgeError(
        "Connected MT5 account changed while saving the symbol mapping. Sync again.",
        409,
      );
    await service.request(
      "mt5_symbol_mapping_bindings",
      { on_conflict: "user_id,account_fingerprint,internal_symbol" },
      "POST",
      {
        user_id: identity.userId,
        account_fingerprint: identityAfter.accountFingerprint,
        internal_symbol: internal,
        broker_symbol: broker,
        verified_at: new Date().toISOString(),
      },
      "resolution=merge-duplicates,return=minimal",
    );
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
router.get(
  "/mt5/orders/manual/state",
  route(async (_req, res, identity) => {
    const { service } = await workspaceFor(identity);
    const manual = await unresolvedManualExecution(service, identity.userId);
    if (manual) {
      res.json(unresolvedManualProjection(manual));
      return;
    }
    const global = await unresolvedMT5Execution(service, identity.userId);
    res.json(
      global
        ? unresolvedAutomaticProjection(global)
        : unresolvedManualProjection(null),
    );
  }),
);
router.post(
  "/mt5/orders/manual/reconcile",
  route(async (req, res, identity) => {
    const requestId = String(req.body?.requestId || "");
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestId))
      throw new MT5BridgeError("Invalid manual MT5 request id", 400);
    const { service } = await workspaceFor(identity);
    const row = await unresolvedManualExecution(
      service,
      identity.userId,
      requestId,
    );
    if (!row)
      throw new MT5BridgeError(
        "This manual MT5 request is no longer awaiting reconciliation.",
        409,
      );
    res.json(await reconcileManualExecution(service, identity, row));
  }),
);
router.post(
  "/mt5/orders/check",
  route(async (req, res, identity) => {
    const order = manualOrder(req.body, false);
    const { service, workspaceId } = await workspaceFor(identity);
    const unresolved = await unresolvedMT5Execution(service, identity.userId);
    if (unresolved)
      throw new MT5BridgeError(
        `MT5 request ${unresolved.request_id} is unresolved. Reconcile it before checking another order.`,
        409,
      );
    const existing = await service.request<Array<{ id: string }>>(
      "trade_execution_requests",
      {
        user_id: `eq.${identity.userId}`,
        request_id: `eq.${order.requestId}`,
        select: "id",
        limit: "1",
      },
    );
    if (existing.length)
      throw new MT5BridgeError(
        "This request id was already used. Check again with a new request.",
        409,
      );

    const accountBefore = await getMT5AccountIdentity();
    const [specBefore, selectedBefore] = await Promise.all([
      getMT5SymbolSpec(order.symbol),
      selectedManualMT5Account(
        service,
        identity.userId,
        accountBefore.accountFingerprint,
      ),
    ]);
    const checked = await checkMT5Order(
      order,
      accountBefore.accountFingerprint,
      specBefore.brokerSymbol,
    );
    if (checked.ok !== true) {
      res.json(checked);
      return;
    }
    const checkedBrokerSymbol = String(checked.brokerSymbol || "");
    const accountAfter = await getMT5AccountIdentity();
    const [specAfter, selectedAfter] = await Promise.all([
      getMT5SymbolSpec(order.symbol),
      selectedManualMT5Account(
        service,
        identity.userId,
        accountAfter.accountFingerprint,
      ),
    ]);
    if (
      !mt5FingerprintsMatch(
        accountBefore.accountFingerprint,
        accountAfter.accountFingerprint,
      )
    )
      throw new MT5BridgeError(
        "Connected MT5 account changed during broker check. Check the order again.",
        409,
      );
    if (selectedBefore.selectedAccountId !== selectedAfter.selectedAccountId)
      throw new MT5BridgeError(
        "The selected trading account changed during broker check. Check the order again.",
        409,
      );
    if (
      !checkedBrokerSymbol ||
      specBefore.brokerSymbol !== checkedBrokerSymbol ||
      specAfter.brokerSymbol !== checkedBrokerSymbol
    )
      throw new MT5BridgeError(
        "MT5 broker symbol mapping changed during broker check. Check the order again.",
        409,
      );

    const checkedAt = new Date();
    const expiresAt = new Date(checkedAt.getTime() + MANUAL_PREFLIGHT_TTL_MS);
    const rows = await service.request<Array<{ id: string }>>(
      "trade_execution_requests",
      {},
      "POST",
      {
        user_id: identity.userId,
        workspace_id: workspaceId,
        request_id: order.requestId,
        candidate_id: null,
        action: order.action,
        request: order,
        status: "CHECKED",
      },
      "return=representation",
    );
    try {
      await service.request(
        "mt5_manual_preflight_bindings",
        {},
        "POST",
        {
          user_id: identity.userId,
          workspace_id: workspaceId,
          execution_request_id: rows[0].id,
          request_id: order.requestId,
          account_fingerprint: accountAfter.accountFingerprint,
          selected_account_id: selectedAfter.selectedAccountId,
          internal_symbol: order.symbol,
          broker_symbol: checkedBrokerSymbol,
          request_digest: manualMT5OrderDigest(order),
          checked_at: checkedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        "return=minimal",
      );
    } catch (error) {
      await service
        .request(
          "trade_execution_requests",
          { id: `eq.${rows[0].id}`, user_id: `eq.${identity.userId}` },
          "PATCH",
          { status: "FAILED", updated_at: new Date().toISOString() },
          "return=minimal",
        )
        .catch(() => undefined);
      throw error;
    }

    // Never serialize accountAfter: accountFingerprint is server-only.
    res.json({
      ok: true,
      stage: "check",
      requestId: order.requestId,
      brokerSymbol: checkedBrokerSymbol,
      expiresAt: expiresAt.toISOString(),
    });
  }),
);
router.post(
  "/mt5/orders/execute",
  route(async (req, res, identity) => {
    enforceExecutionRate(identity.userId);
    const { candidateId = null, ...orderInput } = req.body ?? {};
    if (candidateId !== null)
      throw new MT5BridgeError(
        "AI candidates must use the guarded scanner execution pipeline; this endpoint is manual only.",
        400,
      );
    const order = manualOrder(orderInput, true);
    const { service } = await workspaceFor(identity);
    const unresolved = await unresolvedMT5Execution(service, identity.userId);
    if (unresolved)
      throw new MT5BridgeError(
        `MT5 request ${unresolved.request_id} is unresolved. Manual execution remains locked until it is reconciled.`,
        409,
      );
    const existingRows = await service.request<
      Array<{ id: string; status: string; request: unknown }>
    >("trade_execution_requests", {
      user_id: `eq.${identity.userId}`,
      request_id: `eq.${order.requestId}`,
      candidate_id: "is.null",
      select: "id,status,request",
      limit: "1",
    });
    const existing = existingRows[0];
    if (existing?.status === "SENT")
      throw new MT5BridgeError("This order request was already executed", 409);
    if (
      existing &&
      MANUAL_UNRESOLVED_STATUSES.includes(
        existing.status as (typeof MANUAL_UNRESOLVED_STATUSES)[number],
      )
    )
      throw new MT5BridgeError(
        "The original MT5 request must be reconciled; it will not be sent again.",
        409,
      );
    if (!existing || existing.status !== "CHECKED")
      throw new MT5BridgeError(
        "A current, unused broker preflight is required. Check the order again.",
        409,
      );
    const bindingRows = await service.request<ManualPreflightBinding[]>(
      "mt5_manual_preflight_bindings",
      {
        user_id: `eq.${identity.userId}`,
        request_id: `eq.${order.requestId}`,
        select:
          "account_fingerprint,selected_account_id,internal_symbol,broker_symbol,request_digest,expires_at,consumed_at",
        limit: "1",
      },
    );
    const binding = bindingRows[0];
    if (!binding)
      throw new MT5BridgeError(
        "Broker preflight was not found. Check the order again.",
        409,
      );
    const [account, spec] = await Promise.all([
      getMT5AccountIdentity(),
      getMT5SymbolSpec(order.symbol),
    ]);
    const selectedAccount = await selectedManualMT5Account(
      service,
      identity.userId,
      account.accountFingerprint,
    );
    const blocker = manualPreflightBlocker({
      binding,
      order,
      accountFingerprint: account.accountFingerprint,
      selectedAccountId: selectedAccount.selectedAccountId,
      brokerSymbol: spec.brokerSymbol,
    });
    if (blocker) throw new MT5BridgeError(blocker, 409);
    if (manualMT5OrderDigest(existing.request) !== binding.request_digest)
      throw new MT5BridgeError(
        "Stored broker preflight no longer matches. Check the order again.",
        409,
      );

    const confirmedAt = new Date().toISOString();
    const claimedBindings = await service.request<
      Array<{ request_id: string }>
    >(
      "mt5_manual_preflight_bindings",
      {
        user_id: `eq.${identity.userId}`,
        request_id: `eq.${order.requestId}`,
        consumed_at: "is.null",
        expires_at: `gt.${confirmedAt}`,
        select: "request_id",
      },
      "PATCH",
      { consumed_at: confirmedAt },
      "return=representation",
    );
    if (claimedBindings.length !== 1)
      throw new MT5BridgeError(
        "Broker preflight expired or was already used. Check the order again.",
        409,
      );
    let confirmed = false;
    try {
      confirmed = await service.rpc<boolean>("claim_mt5_manual_execution", {
        p_user: identity.userId,
        p_execution_request: existing.id,
        p_confirmed_at: confirmedAt,
      });
    } catch (error) {
      // This point is still before any bridge execute call, so failing this
      // request cannot hide broker activity. The serialized database claim may
      // have rejected it because another manual request is unresolved.
      await service
        .request(
          "trade_execution_requests",
          { id: `eq.${existing.id}`, user_id: `eq.${identity.userId}` },
          "PATCH",
          { status: "FAILED", updated_at: new Date().toISOString() },
          "return=minimal",
        )
        .catch(() => undefined);
      throw new MT5BridgeError(
        "Another manual MT5 request is unresolved. Reconcile it before executing a new order.",
        409,
      );
    }
    if (!confirmed) {
      await service
        .request(
          "trade_execution_requests",
          { id: `eq.${existing.id}`, user_id: `eq.${identity.userId}` },
          "PATCH",
          { status: "FAILED", updated_at: new Date().toISOString() },
          "return=minimal",
        )
        .catch(() => undefined);
      throw new MT5BridgeError(
        "Another manual MT5 request is unresolved, or this preflight state changed. Reconcile before continuing.",
        409,
      );
    }

    try {
      const preClaimAccount = await getMT5AccountIdentity();
      const preClaimSelection = await selectedManualMT5Account(
        service,
        identity.userId,
        preClaimAccount.accountFingerprint,
      );
      if (
        preClaimSelection.selectedAccountId !== binding.selected_account_id ||
        !mt5FingerprintsMatch(
          binding.account_fingerprint,
          preClaimAccount.accountFingerprint,
        )
      )
        throw new MT5BridgeError(
          "The selected or connected MT5 account changed before broker claim. Check the order again.",
          409,
        );
      await claimMT5Order(
        order,
        binding.account_fingerprint,
        binding.broker_symbol,
      );
    } catch (error) {
      // claim never invokes order_send, but it does durably transition ARMED
      // to CLAIMED. If the response is lost, FAILED would hide the original
      // request from exact reconciliation while the bridge remains locked.
      await service
        .request(
          "trade_execution_requests",
          { id: `eq.${existing.id}`, user_id: `eq.${identity.userId}` },
          "PATCH",
          { status: "UNCERTAIN", updated_at: new Date().toISOString() },
          "return=minimal",
        )
        .catch(() => undefined);
      throw new MT5BridgeError(
        `The MT5 claim response was lost or rejected after a possible durable state change (${error instanceof Error ? error.message : "unknown error"}). The original request remains locked; reconcile its exact request ID and do not retry.`,
        503,
      );
    }

    // Repeat every identity input after the durable bridge claim. The final
    // database fence below is deliberately the last await before execute.
    const preSendAccount = await getMT5AccountIdentity();
    const [preSendSelection, preSendSpec] = await Promise.all([
      selectedManualMT5Account(
        service,
        identity.userId,
        preSendAccount.accountFingerprint,
      ),
      getMT5SymbolSpec(order.symbol),
    ]);
    if (
      preSendSelection.selectedAccountId !== binding.selected_account_id ||
      !mt5FingerprintsMatch(
        binding.account_fingerprint,
        preSendAccount.accountFingerprint,
      ) ||
      preSendSpec.brokerSymbol !== binding.broker_symbol
    )
      throw new MT5BridgeError(
        "The selected account, connected MT5 identity, or broker symbol changed after broker claim. No execute request was sent; reconcile the original request.",
        409,
      );

    // Reconciliation uses the same advisory-lock key and SQL-side freshness
    // predicate. A stale reader cannot overwrite this refresh and race execute.
    const postClaimConfirmed = await service.rpc<boolean>(
      "confirm_mt5_manual_post_claim",
      {
        p_user: identity.userId,
        p_execution_request: existing.id,
        p_refreshed_at: new Date().toISOString(),
      },
    );
    if (!postClaimConfirmed)
      throw new MT5BridgeError(
        "Manual MT5 execution state changed during the broker handoff. No execute request was sent; reconcile the original request.",
        409,
      );

    let result: Record<string, unknown>;
    try {
      result = await executeMT5Order(
        order,
        preSendAccount.accountFingerprint,
        preSendSpec.brokerSymbol,
      );
    } catch (error) {
      await service
        .request(
          "trade_execution_requests",
          { id: `eq.${existing.id}`, user_id: `eq.${identity.userId}` },
          "PATCH",
          {
            status:
              error instanceof MT5BridgeError && error.deliveryUncertain
                ? "UNCERTAIN"
                : "FAILED",
            updated_at: new Date().toISOString(),
          },
          "return=minimal",
        )
        .catch(() => undefined);
      if (error instanceof MT5BridgeError && error.deliveryUncertain)
        throw new MT5BridgeError(
          "The MT5 response was lost. The original request is locked and must be reconciled; do not retry it.",
          503,
        );
      throw error;
    }
    try {
      // Persist broker truth first. Until the final state write succeeds, the
      // request remains CONFIRMED and blocks every new manual preflight.
      await storeManualExecutionResult(
        service,
        identity.userId,
        existing.id,
        result,
      );
      await service.request(
        "trade_execution_requests",
        { id: `eq.${existing.id}`, user_id: `eq.${identity.userId}` },
        "PATCH",
        {
          status: result.ok ? "SENT" : "REJECTED",
          updated_at: new Date().toISOString(),
        },
        "return=minimal",
      );
    } catch (error) {
      await service
        .request(
          "trade_execution_requests",
          { id: `eq.${existing.id}`, user_id: `eq.${identity.userId}` },
          "PATCH",
          { status: "UNCERTAIN", updated_at: new Date().toISOString() },
          "return=minimal",
        )
        .catch(() => undefined);
      throw new MT5BridgeError(
        "MT5 returned a result but the audit write was interrupted. Reconcile the original request before continuing.",
        503,
      );
    }
    res.json(result);
  }),
);

export default router;
