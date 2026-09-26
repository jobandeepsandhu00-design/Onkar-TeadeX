import {
  scannerConfigSchema,
  strategyVersionSchema,
  type MT5OrderRequest,
} from "@workspace/api-zod";
import { automaticEntryStillAllowed } from "./controls";
import {
  checkMT5Order,
  claimMT5Order,
  executeMT5Order,
  getMT5Account,
  getMT5BrokerSnapshot,
  getMT5ExecutionResult,
  MT5BridgeError,
  reconcileMT5State,
  type MT5ExecutionLookup,
  type MT5Reconciliation,
  type MT5SymbolSpec,
} from "../mt5/client";
import {
  mt5CandidateProvenanceMatches,
  type MT5AccountBinding,
  type MT5CandidateProvenance,
} from "../mt5/account-identity";
import { logger } from "../lib/logger";
import {
  ScannerStore,
  records,
  type CandidateRow,
  type ConfigRow,
  type VersionRow,
} from "./store";
import { executionRequestId } from "./execution-identity";
import {
  confirmationAfterSourceActivation,
  earliestEligibleCandleOpen,
} from "./execution-candle";
import { orderExecutionCandidates } from "./execution-queue";
import { NotificationService } from "../notifications/service";

type RuntimeRow = {
  user_id: string;
  workspace_id: string;
  scanner_config_id: string;
  scanner_state: "RUNNING" | "PAUSED" | "STOPPED";
  trading_mode: "ANALYSIS" | "CONFIRM" | "AUTO";
  auto_execution_enabled: boolean;
  emergency_stop: boolean;
  trading_source: "MT5" | "TWELVE_DATA";
  source_activated_at: string;
  reconciled_at: string | null;
};

export type AutoExecutionCapability = {
  ready: boolean;
  state: "READY" | "DISABLED" | "NOT_CONFIGURED" | "DISCONNECTED" | "BLOCKED";
  reason: string;
  accountType: "DEMO" | "LIVE" | "CONTEST" | null;
  broker: string | null;
};

export const autoExecutionWorkerEnabled = () =>
  process.env.AUTO_EXECUTION_WORKER_ENABLED === "true";
const bridgeOwner = () => process.env.MT5_BRIDGE_USER_ID || "";
const BLOCKED_RETRY_COOLDOWN_MS = 10_000;
const IN_FLIGHT_RETRY_TIMEOUT_MS = 120_000;
export const AUTO_CONFIRM_RECONCILIATION_GRACE_MS = 30_000;
export const AUTO_RECONCILIATION_LEASE_MS = 30_000;

type AutoExecutionRequestRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  request_id: string;
  candidate_id: string;
  status: "CONFIRMED" | "UNCERTAIN" | "RECONCILING";
  updated_at: string;
};

export type AutoReconciliationDecision =
  | {
      resolved: false;
      status: "UNCERTAIN";
      message: string;
      result: Record<string, unknown> | null;
    }
  | {
      resolved: true;
      status: "SENT" | "REJECTED";
      message: string;
      result: Record<string, unknown>;
    };

/** Project durable bridge truth without ever resubmitting the original order. */
export function autoReconciliationDecision(
  lookup: MT5ExecutionLookup,
): AutoReconciliationDecision {
  if (lookup.state === "COMPLETED" && lookup.resolved && lookup.result) {
    const accepted = lookup.result.ok === true;
    return {
      resolved: true,
      status: accepted ? "SENT" : "REJECTED",
      message: accepted
        ? "The original MT5 AUTO request was found and accepted. No retry was sent."
        : "The original MT5 AUTO request was found and rejected. No retry was sent.",
      result: lookup.result,
    };
  }
  if (
    lookup.resolved &&
    (lookup.state === "ARMED" || lookup.state === "CANCELLED")
  ) {
    return {
      resolved: true,
      status: "REJECTED",
      message:
        lookup.state === "ARMED"
          ? "The original AUTO request never advanced beyond broker preflight. No order was sent."
          : "The original AUTO execution claim was cancelled before order_send. No order was sent.",
      result:
        lookup.result ??
        ({
          ok: false,
          requestId: lookup.requestId,
          stage: lookup.state === "ARMED" ? "armed" : "claim_cancelled",
          notSent: true,
        } satisfies Record<string, unknown>),
    };
  }
  const manualReview =
    lookup.state === "NOT_FOUND" ||
    lookup.reconciliationState === "MANUAL_REVIEW";
  return {
    resolved: false,
    status: "UNCERTAIN",
    message: manualReview
      ? "The original MT5 AUTO outcome is unresolved. Inspect the broker terminal; every new order remains locked."
      : "MT5 is reconciling the original AUTO request with broker history. Every new order remains locked.",
    result: lookup.result,
  };
}

export function autoConfirmedReconciliationBlocked(
  row: { status: string; updated_at: string },
  now = Date.now(),
) {
  if (row.status !== "CONFIRMED") return false;
  const updatedAt = Date.parse(row.updated_at);
  return (
    !Number.isFinite(updatedAt) ||
    now - updatedAt < AUTO_CONFIRM_RECONCILIATION_GRACE_MS
  );
}

export function executionEventBlocksRetry(
  event: { state: string; created_at: string } | undefined,
  now = Date.now(),
) {
  if (!event) return false;
  if (["EXECUTED", "ERROR", "INVALIDATED"].includes(event.state)) return true;
  const createdAt = Date.parse(event.created_at);
  if (!Number.isFinite(createdAt)) return false;
  const age = Math.max(0, now - createdAt);
  if (event.state === "BLOCKED") return age < BLOCKED_RETRY_COOLDOWN_MS;
  return (
    ["RISK_CHECK", "READY_TO_EXECUTE", "EXECUTING"].includes(event.state) &&
    age < IN_FLIGHT_RETRY_TIMEOUT_MS
  );
}

export async function getAutoExecutionCapability(
  userId: string,
): Promise<AutoExecutionCapability> {
  if (!autoExecutionWorkerEnabled())
    return {
      ready: false,
      state: "DISABLED",
      reason: "AUTO execution worker is disabled on the server.",
      accountType: null,
      broker: null,
    };
  if (
    !process.env.MT5_BRIDGE_URL ||
    !process.env.MT5_BRIDGE_API_KEY ||
    !bridgeOwner()
  )
    return {
      ready: false,
      state: "NOT_CONFIGURED",
      reason: "Windows MT5 Bridge environment is not configured.",
      accountType: null,
      broker: null,
    };
  if (bridgeOwner() !== userId)
    return {
      ready: false,
      state: "BLOCKED",
      reason: "The connected MT5 terminal belongs to a different user.",
      accountType: null,
      broker: null,
    };
  try {
    const account = await getMT5Account(AbortSignal.timeout(5_000));
    if (
      account.connection !== "CONNECTED" ||
      !account.terminalConnected ||
      !account.tradeAllowed
    )
      return {
        ready: false,
        state: "DISCONNECTED",
        reason: "MT5 terminal is disconnected or trading is not allowed.",
        accountType: account.accountType,
        broker: account.broker,
      };
    if (account.tradeApiDisabled)
      return {
        ready: false,
        state: "BLOCKED",
        reason: "External Python trading is disabled inside the MT5 terminal.",
        accountType: account.accountType,
        broker: account.broker,
      };
    if (!account.tradingEnabled)
      return {
        ready: false,
        state: "BLOCKED",
        reason: "ENABLE_MT5_TRADING is disabled on the Windows bridge.",
        accountType: account.accountType,
        broker: account.broker,
      };
    if (account.accountType === "LIVE" && !account.liveTradingAllowed)
      return {
        ready: false,
        state: "BLOCKED",
        reason: "LIVE auto trading is blocked by the Windows bridge.",
        accountType: account.accountType,
        broker: account.broker,
      };
    return {
      ready: true,
      state: "READY",
      reason: `${account.broker} ${account.accountType} is ready for guarded execution.`,
      accountType: account.accountType,
      broker: account.broker,
    };
  } catch (error) {
    return {
      ready: false,
      state: "DISCONNECTED",
      reason:
        error instanceof Error ? error.message : "MT5 Bridge is unreachable.",
      accountType: null,
      broker: null,
    };
  }
}

export function calculateBrokerVolume(
  equity: number,
  riskPercent: number,
  entry: number,
  stop: number,
  spec: MT5SymbolSpec,
) {
  const tickSize = spec.tickSize || spec.point;
  const tickValue =
    spec.tickValueLoss || spec.tickValue || spec.tickValueProfit;
  const riskMoney = (equity * riskPercent) / 100;
  const stopDistance = Math.abs(entry - stop);
  if (
    !(equity > 0) ||
    !(riskPercent > 0) ||
    !(stopDistance > 0) ||
    !(tickSize > 0) ||
    !(tickValue > 0) ||
    !(spec.volumeStep > 0)
  )
    return null;
  const riskPerLot = (stopDistance / tickSize) * tickValue;
  const raw = riskMoney / riskPerLot;
  const stepped = Math.floor((raw + 1e-12) / spec.volumeStep) * spec.volumeStep;
  const precision = Math.max(
    0,
    String(spec.volumeStep).split(".")[1]?.length ?? 0,
  );
  const volume = Number(Math.min(spec.volumeMax, stepped).toFixed(precision));
  return volume >= spec.volumeMin ? volume : null;
}

type CandidateEntryAction = Extract<
  MT5OrderRequest["action"],
  | "MARKET_BUY"
  | "MARKET_SELL"
  | "BUY_LIMIT"
  | "SELL_LIMIT"
  | "BUY_STOP"
  | "SELL_STOP"
>;

export type CandidateEntryInstruction =
  | {
      ok: true;
      action: CandidateEntryAction;
      executionPrice: number;
      price?: number;
    }
  | { ok: false; reason: string };

/**
 * Convert one frozen candidate entry into a broker order type. There is no
 * user-controlled order-type override: direction and the current account-
 * atomic Bid/Ask determine the only valid action.
 */
export function deriveCandidateEntryInstruction(args: {
  direction: "long" | "short";
  plannedEntry: number;
  bid: number;
  ask: number;
  tickSize: number;
}): CandidateEntryInstruction {
  const { direction, plannedEntry, bid, ask, tickSize } = args;
  if (
    ![plannedEntry, bid, ask, tickSize].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    ask < bid
  )
    return {
      ok: false,
      reason: "Candidate entry or broker Bid/Ask/tick size is invalid.",
    };

  const reference = direction === "long" ? ask : bid;
  // Candle plans commonly use Bid/close while a BUY executes at Ask. Treat
  // the complete spread plus one broker tick on either side as at-market.
  // Only a price materially below Bid or above Ask becomes pending.
  const numericTolerance =
    Math.max(Math.abs(bid), Math.abs(ask)) * Number.EPSILON * 16;
  const atMarketLow = bid - tickSize - numericTolerance;
  const atMarketHigh = ask + tickSize + numericTolerance;
  if (plannedEntry >= atMarketLow && plannedEntry <= atMarketHigh)
    return {
      ok: true,
      action: direction === "long" ? "MARKET_BUY" : "MARKET_SELL",
      executionPrice: reference,
    };
  if (direction === "long")
    return {
      ok: true,
      action: plannedEntry < atMarketLow ? "BUY_LIMIT" : "BUY_STOP",
      executionPrice: plannedEntry,
      price: plannedEntry,
    };
  return {
    ok: true,
    action: plannedEntry > atMarketHigh ? "SELL_LIMIT" : "SELL_STOP",
    executionPrice: plannedEntry,
    price: plannedEntry,
  };
}

export function candidateEntryGeometryBlocker(args: {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  minimumRR: number;
}) {
  const { direction, entry, stop, target, minimumRR } = args;
  if (
    ![entry, stop, target, minimumRR].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return "Candidate entry protection contains invalid prices.";
  const stopDistance = direction === "long" ? entry - stop : stop - entry;
  const rewardDistance = direction === "long" ? target - entry : entry - target;
  if (!(stopDistance > 0 && rewardDistance > 0))
    return "Candidate SL/TP geometry conflicts with its approved direction.";
  if (rewardDistance / stopDistance + 1e-12 < minimumRR)
    return "Candidate reward/risk is below the configured minimum at the broker entry price.";
  return null;
}

async function event(
  store: ScannerStore,
  runtime: RuntimeRow,
  candidate: CandidateRow,
  requestId: string,
  state:
    | "RISK_CHECK"
    | "READY_TO_EXECUTE"
    | "EXECUTING"
    | "EXECUTED"
    | "BLOCKED"
    | "ERROR",
  reason: string,
  detail: Record<string, unknown> = {},
) {
  await store.request("scanner_execution_events", {}, "POST", {
    user_id: runtime.user_id,
    workspace_id: runtime.workspace_id,
    candidate_id: candidate.id,
    request_id: requestId,
    state,
    reason,
    execution_provider: "MT5",
    market_data_provider: "MT5",
    account_id: candidate.payload.scopeAccountId ?? null,
    detail,
  });
  await new NotificationService(store)
    .execution({
      userId: runtime.user_id,
      candidate,
      state,
      reason,
      provider: "MT5",
      eventKey: requestId,
      tradeId: typeof detail.tradeId === "string" ? detail.tradeId : null,
      detail,
    })
    .catch(() => undefined);
}

async function autoCandidate(
  store: ScannerStore,
  userId: string,
  candidateId: string,
) {
  const [candidate] = await store.request<CandidateRow[]>("setup_candidates", {
    id: `eq.${candidateId}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  return candidate ?? null;
}

async function notifyAutoUncertain(
  store: ScannerStore,
  row: AutoExecutionRequestRow,
  candidate: CandidateRow | null,
  reason: string,
) {
  if (!candidate) {
    await new NotificationService(store).systemHealth({
      userId: row.user_id,
      component: `MT5 AUTO ${row.request_id}`,
      healthy: false,
      message: reason,
      metadata: {
        requestId: row.request_id,
        auditStatus: "UNCERTAIN",
        automaticExecutionPaused: true,
      },
    });
    return;
  }
  await new NotificationService(store).upsert({
    userId: row.user_id,
    eventKey: `execution:${row.request_id}`,
    eventVersion: `${row.request_id}:UNCERTAIN`,
    category: "TRADING",
    priority: "CRITICAL",
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    setupId: candidate.id,
    agentSource: "EXECUTION_AI",
    lifecycleState: "UNCERTAIN",
    title: `${candidate.symbol} · MT5 outcome uncertain`,
    message: reason,
    recommendedAction:
      "Do not retry. Keep automation paused while the original request ID is reconciled with MT5.",
    evidence: [
      {
        agent: "EXECUTION_AI",
        provider: "MT5",
        requestId: row.request_id,
        auditStatus: "UNCERTAIN",
        automaticExecutionPaused: true,
      },
    ],
    actions: [
      {
        id: "status",
        label: "View execution status",
        href: "/onkar-ai/integrations",
        intent: "NAVIGATE",
        confirm: false,
      },
    ],
    metadata: {
      requestId: row.request_id,
      automaticExecutionPaused: true,
      voiceEligible: true,
    },
    status: "ACTIVE",
  });
}

async function notifyAutoResolved(
  store: ScannerStore,
  row: AutoExecutionRequestRow,
  candidate: CandidateRow | null,
  decision: Extract<AutoReconciliationDecision, { resolved: true }>,
  reconciled: boolean,
) {
  if (!candidate) return;
  await new NotificationService(store).upsert({
    userId: row.user_id,
    eventKey: `execution:${row.request_id}`,
    eventVersion: `${row.request_id}:${decision.status}:${reconciled ? "reconciled" : "direct"}`,
    category: "TRADING",
    priority: decision.status === "SENT" ? "HIGH" : "IMPORTANT",
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    setupId: candidate.id,
    tradeId:
      decision.result.deal === undefined ? null : String(decision.result.deal),
    agentSource: "EXECUTION_AI",
    lifecycleState: decision.status === "SENT" ? "ACTIVE" : "REJECTED",
    title: `${candidate.symbol} · MT5 ${decision.status.toLowerCase()}`,
    message: decision.message,
    recommendedAction:
      decision.status === "SENT"
        ? "Open trade management and verify the broker position. Re-enable AUTO only after review."
        : "Review the broker rejection before explicitly re-enabling AUTO.",
    evidence: [
      {
        agent: "EXECUTION_AI",
        provider: "MT5",
        requestId: row.request_id,
        reconciled,
        result: decision.result,
      },
    ],
    actions: [
      {
        id: "trade",
        label: "Open trade monitor",
        href: "/onkar-ai/scanner",
        intent: "NAVIGATE",
        confirm: false,
      },
    ],
    metadata: {
      requestId: row.request_id,
      reconciled,
      voiceEligible: true,
    },
    status: "RESOLVED",
  });
}

async function claimAutoAudit(
  store: ScannerStore,
  runtime: RuntimeRow,
  candidate: CandidateRow,
  order: Record<string, unknown>,
) {
  return store.rpc<string | null>("claim_mt5_auto_execution", {
    p_user: runtime.user_id,
    p_workspace: runtime.workspace_id,
    p_candidate: candidate.id,
    p_request_id: String(order.requestId),
    p_action: String(order.action),
    p_request: order,
    p_confirmed_at: new Date().toISOString(),
  });
}

async function markAutoUncertain(
  store: ScannerStore,
  row: AutoExecutionRequestRow,
  reason: string,
) {
  return store.rpc<boolean>("mark_mt5_auto_execution_uncertain", {
    p_user: row.user_id,
    p_execution_request: row.id,
    p_observed_at: new Date().toISOString(),
    p_reason: reason,
  });
}

async function resolveAutoAudit(
  store: ScannerStore,
  row: AutoExecutionRequestRow,
  decision: Extract<AutoReconciliationDecision, { resolved: true }>,
  reconciled: boolean,
) {
  return store.rpc<boolean>("resolve_mt5_auto_execution", {
    p_user: row.user_id,
    p_execution_request: row.id,
    p_status: decision.status,
    p_result: decision.result,
    p_resolved_at: new Date().toISOString(),
    p_reconciled: reconciled,
  });
}

/**
 * Reconcile one unresolved candidate-backed AUTO request by exact request ID.
 * This function never calls check, claim, or execute and therefore cannot
 * resend an order. A blocking result must stop every new execution route.
 */
export async function reconcilePendingAutoExecution(
  store = ScannerStore.service(),
  userId = bridgeOwner(),
) {
  if (!userId)
    return {
      blocking: false,
      skipped: true,
      reason: "MT5 bridge owner is not configured.",
    };
  const [row] = await store.request<AutoExecutionRequestRow[]>(
    "trade_execution_requests",
    {
      user_id: `eq.${userId}`,
      candidate_id: "not.is.null",
      status: "in.(CONFIRMED,UNCERTAIN,RECONCILING)",
      select:
        "id,user_id,workspace_id,request_id,candidate_id,status,updated_at",
      order: "updated_at.asc",
      limit: "1",
    },
  );
  if (!row)
    return {
      blocking: false,
      skipped: true,
      reason: "No unresolved MT5 AUTO request.",
    };

  const candidate = await autoCandidate(store, userId, row.candidate_id);
  if (autoConfirmedReconciliationBlocked(row))
    return {
      blocking: true,
      requestId: row.request_id,
      state: row.status,
      reason:
        "The original MT5 AUTO handoff may still be active. Every new order remains locked.",
    };

  const now = new Date();
  const claimed = await store.rpc<boolean>("claim_mt5_auto_reconciliation", {
    p_user: userId,
    p_execution_request: row.id,
    p_claimed_at: now.toISOString(),
    p_stale_before: new Date(
      now.getTime() - AUTO_RECONCILIATION_LEASE_MS,
    ).toISOString(),
  });
  if (!claimed)
    return {
      blocking: true,
      requestId: row.request_id,
      state: "RECONCILING",
      reason:
        "Another worker is reconciling the original MT5 AUTO request. Every new order remains locked.",
    };

  let lookup: MT5ExecutionLookup;
  try {
    lookup = await getMT5ExecutionResult(row.request_id);
  } catch (error) {
    const reason =
      error instanceof Error
        ? `Exact MT5 reconciliation failed: ${error.message}`
        : "Exact MT5 reconciliation failed.";
    await markAutoUncertain(store, row, reason).catch(() => false);
    await notifyAutoUncertain(store, row, candidate, reason).catch(
      () => undefined,
    );
    return {
      blocking: true,
      requestId: row.request_id,
      state: "UNCERTAIN",
      reason,
    };
  }

  const decision = autoReconciliationDecision(lookup);
  if (!decision.resolved) {
    await markAutoUncertain(store, row, decision.message);
    await notifyAutoUncertain(store, row, candidate, decision.message).catch(
      () => undefined,
    );
    return {
      blocking: true,
      requestId: row.request_id,
      state: "UNCERTAIN",
      reason: decision.message,
    };
  }

  const resolved = await resolveAutoAudit(store, row, decision, true);
  if (!resolved)
    return {
      blocking: true,
      requestId: row.request_id,
      state: "RECONCILING",
      reason:
        "MT5 broker truth was found, but the execution audit state changed before it could be committed.",
    };
  await notifyAutoResolved(store, row, candidate, decision, true).catch(
    () => undefined,
  );
  logger.info(
    {
      event: "mt5_auto_execution_reconciled",
      requestId: row.request_id,
      candidateId: row.candidate_id,
      status: decision.status,
    },
    "Exact MT5 AUTO request reconciled without resend",
  );
  return {
    blocking: false,
    resolved: true,
    requestId: row.request_id,
    status: decision.status,
  };
}

/** Process at most one execution per invocation. The bridge remains the final broker gate. */
export async function runNextAutoExecution() {
  const owner = bridgeOwner();
  if (!autoExecutionWorkerEnabled() || !owner)
    return {
      skipped: true,
      reason: "AUTO execution worker is not configured.",
    };
  // Reconcile the bridge ledger before every new AUTO submission. A RESERVED
  // request can survive an API/database crash without a Supabase audit row;
  // bridge truth must therefore participate in the global send fence too.
  const capability = await reconcileAutoExecution(owner);
  if (!capability.ready) return { skipped: true, reason: capability.reason };
  const store = ScannerStore.service();
  const [runtime] = await store.request<RuntimeRow[]>(
    "scanner_runtime_controls",
    {
      user_id: `eq.${owner}`,
      scanner_state: "eq.RUNNING",
      trading_mode: "eq.AUTO",
      auto_execution_enabled: "eq.true",
      emergency_stop: "eq.false",
      trading_source: "eq.MT5",
      limit: "1",
    },
  );
  if (!runtime) return { skipped: true, reason: "AUTO is not armed." };
  const [configRow] = await store.request<ConfigRow[]>("scanner_configs", {
    id: `eq.${runtime.scanner_config_id}`,
    user_id: `eq.${owner}`,
    enabled: "eq.true",
    limit: "1",
  });
  if (!configRow)
    return { skipped: true, reason: "Scanner configuration is disabled." };
  const config = scannerConfigSchema.parse(configRow.config);
  if (!config.permissions.mt5LiveExecution)
    return {
      skipped: true,
      reason: "MT5 live execution is disabled in Permission Center.",
    };
  if (
    !config.permissions.automaticRiskCalculation ||
    !config.permissions.automaticOrderPreparation
  )
    return {
      skipped: true,
      reason:
        "Automatic risk calculation or order preparation is disabled in Permission Center.",
    };
  const earliestOpen = earliestEligibleCandleOpen(runtime.source_activated_at);
  if (!earliestOpen)
    return {
      skipped: true,
      reason: "Execution source activation time is invalid.",
    };
  const candidates = await store.request<CandidateRow[]>("setup_candidates", {
    config_id: `eq.${configRow.id}`,
    user_id: `eq.${owner}`,
    state: "eq.READY",
    last_candle_at: `gte.${earliestOpen}`,
    expires_at: `gt.${new Date().toISOString()}`,
    order: "updated_at.asc",
    limit: "100",
  });
  const candidateIds = candidates.map((item) => item.id).join(",");
  const [blockedEvents, terminalEvents] = candidateIds
    ? await Promise.all([
        store.request<
          Array<{ candidate_id: string | null; created_at: string }>
        >("scanner_execution_events", {
          user_id: `eq.${owner}`,
          candidate_id: `in.(${candidateIds})`,
          state: "eq.BLOCKED",
          select: "candidate_id,created_at",
          order: "created_at.desc",
          limit: "100",
        }),
        store.request<Array<{ candidate_id: string | null }>>(
          "scanner_execution_events",
          {
            user_id: `eq.${owner}`,
            candidate_id: `in.(${candidateIds})`,
            state: "in.(EXECUTED,ERROR,INVALIDATED)",
            select: "candidate_id",
            limit: "100",
          },
        ),
      ])
    : [[], []];
  const [candidate] = orderExecutionCandidates(
    candidates.filter(
      (item) =>
        confirmationAfterSourceActivation(
          item.last_candle_at,
          item.timeframe,
          runtime.source_activated_at,
        ) &&
        item.payload.provider === "mt5" &&
        item.payload.scopeAccountId === config.accountId &&
        !item.payload.stale &&
        item.payload.risk.allowed &&
        item.payload.risk.warnings.length === 0,
    ),
    blockedEvents,
    new Set(
      terminalEvents
        .map((item) => item.candidate_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (!candidate)
    return {
      skipped: true,
      reason: "No new risk-approved MT5 setup is ready.",
    };
  const [version] = await store.request<VersionRow[]>(
    "scanner_strategy_versions",
    {
      id: `eq.${candidate.version_id}`,
      user_id: `eq.${owner}`,
      limit: "1",
    },
  );
  const definition = version
    ? strategyVersionSchema.parse(version.definition)
    : null;
  if (
    !definition ||
    definition.approval !== "approved" ||
    !definition.autoExecutionAllowed
  ) {
    const requestId = `auto_validation_${candidate.id}_${candidate.last_candle_at}`;
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Rule version is not approved for AUTO execution.",
    );
    return {
      blocked: true,
      reason: "Rule version is not approved for AUTO execution.",
    };
  }
  const source = await store.source(owner);
  const requestId = executionRequestId({
    accountId: config.accountId ?? "",
    executionProvider: "MT5",
    symbol: candidate.symbol,
    versionId: candidate.version_id,
    direction: candidate.payload.direction,
    confirmationCandle: candidate.last_candle_at,
    entryEvent: candidate.fingerprint,
  });
  const existing = await store.request<
    Array<{ state: string; created_at: string }>
  >("scanner_execution_events", {
    user_id: `eq.${owner}`,
    request_id: `eq.${requestId}`,
    select: "state,created_at",
    order: "created_at.desc",
    limit: "1",
  });
  if (executionEventBlocksRetry(existing[0]))
    return {
      skipped: true,
      reason: `Execution already recorded as ${existing[0].state}.`,
    };
  if (config.requireNews && candidate.payload.news.status !== "safe") {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "News safety is not verified.",
    );
    return { blocked: true, reason: "News safety is not verified." };
  }
  const analyzedAt = Date.parse(candidate.payload.analyzedAt);
  if (
    !Number.isFinite(analyzedAt) ||
    Date.now() - analyzedAt > config.frequencySeconds * 2_000
  ) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Setup analysis is stale.",
    );
    return { blocked: true, reason: "Setup analysis is stale." };
  }
  const symbol =
    candidate.symbol === "XAUUSD"
      ? "XAU/USD"
      : `${candidate.symbol.slice(0, 3)}/${candidate.symbol.slice(3)}`;
  const storedAccount = records(source.tradingAccounts).find(
    (item) => item.id === config.accountId,
  );
  const [bindings, provenanceRows] = await Promise.all([
    config.accountId
      ? store.request<MT5AccountBinding[]>("mt5_account_bindings", {
          user_id: `eq.${owner}`,
          selected_account_id: `eq.${config.accountId}`,
          select: "selected_account_id,account_fingerprint",
          limit: "1",
        })
      : Promise.resolve([]),
    store.request<MT5CandidateProvenance[]>("mt5_candidate_provenance", {
      candidate_id: `eq.${candidate.id}`,
      user_id: `eq.${owner}`,
      select:
        "candidate_id,candidate_last_candle_at,selected_account_id,account_fingerprint,broker_symbol",
      limit: "1",
    }),
  ]);
  const binding = bindings[0];
  if (!storedAccount || !binding) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "The selected MT5 account is not bound to the connected terminal.",
    );
    return {
      blocked: true,
      reason: "The selected MT5 account binding is missing.",
    };
  }
  let brokerSnapshot: Awaited<ReturnType<typeof getMT5BrokerSnapshot>>;
  try {
    brokerSnapshot = await getMT5BrokerSnapshot(
      binding.account_fingerprint,
      symbol,
    );
  } catch (error) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "The account-atomic MT5 risk snapshot was unavailable or changed identity.",
    );
    return {
      blocked: true,
      reason:
        error instanceof Error
          ? `MT5 broker snapshot unavailable: ${error.message}`
          : "MT5 broker snapshot unavailable.",
    };
  }
  if (!brokerSnapshot.symbol) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "The MT5 symbol snapshot is missing.",
    );
    return { blocked: true, reason: "The MT5 symbol snapshot is missing." };
  }
  const account = brokerSnapshot.account;
  const positions = brokerSnapshot.positions;
  const pendingOrders = brokerSnapshot.orders;
  const { tick, spec } = brokerSnapshot.symbol;
  if (
    !mt5CandidateProvenanceMatches(
      provenanceRows[0],
      binding,
      candidate.id,
      candidate.last_candle_at,
      config.accountId,
      account.accountFingerprint,
      spec.brokerSymbol,
    )
  ) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Candidate MT5 provenance, selected account, and connected terminal identity do not exactly match. Rescan after syncing MT5 before AUTO execution.",
    );
    return {
      blocked: true,
      reason:
        "Candidate MT5 provenance does not exactly match the selected and connected account.",
    };
  }
  if (positions.length + pendingOrders.length >= config.risk.maxOpenPositions) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Maximum combined open-position and pending-order exposure reached.",
    );
    return {
      blocked: true,
      reason: "Maximum combined broker exposure reached.",
    };
  }
  await event(
    store,
    runtime,
    candidate,
    requestId,
    "RISK_CHECK",
    "Broker risk validation started.",
  );
  if (tick.state !== "CONNECTED" || tick.approximateLatencyMs > 30_000) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "MT5 price feed is stale or disconnected.",
    );
    return {
      blocked: true,
      reason: "MT5 price feed is stale or disconnected.",
    };
  }
  const plan = candidate.plan;
  if (!plan || !(plan.entry > 0 && plan.stop > 0 && plan.target > 0)) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Execution plan is incomplete.",
    );
    return { blocked: true, reason: "Execution plan is incomplete." };
  }
  const buy = candidate.payload.direction === "long";
  const currentPrice = buy ? tick.ask : tick.bid;
  const zone = candidate.payload.entryZone;
  if (
    currentPrice < zone.low ||
    currentPrice > zone.high ||
    plan.entry < zone.low ||
    plan.entry > zone.high
  ) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Current or planned entry price left the verified entry zone.",
    );
    return {
      blocked: true,
      reason: "Current or planned entry price left the verified entry zone.",
    };
  }
  const entryInstruction = deriveCandidateEntryInstruction({
    direction: candidate.payload.direction,
    plannedEntry: plan.entry,
    bid: tick.bid,
    ask: tick.ask,
    tickSize: spec.tickSize || spec.point,
  });
  if (!entryInstruction.ok) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      entryInstruction.reason,
    );
    return { blocked: true, reason: entryInstruction.reason };
  }
  const geometryBlocker = candidateEntryGeometryBlocker({
    direction: candidate.payload.direction,
    entry: entryInstruction.executionPrice,
    stop: plan.stop,
    target: plan.target,
    minimumRR: config.risk.minimumRR,
  });
  if (geometryBlocker) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      geometryBlocker,
    );
    return { blocked: true, reason: geometryBlocker };
  }
  const stopDistance = Math.abs(entryInstruction.executionPrice - plan.stop);
  if (!(stopDistance > 0) || tick.spread > stopDistance * 0.1) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Spread is too large for the planned stop distance.",
    );
    return {
      blocked: true,
      reason: "Spread is too large for the planned stop distance.",
    };
  }
  const volume = calculateBrokerVolume(
    account.equity,
    Math.min(config.risk.riskPercent, candidate.payload.risk.riskPercent),
    entryInstruction.executionPrice,
    plan.stop,
    spec,
  );
  if (!volume) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Broker volume could not be calculated safely.",
    );
    return {
      blocked: true,
      reason: "Broker volume could not be calculated safely.",
    };
  }
  const order: MT5OrderRequest = {
    requestId,
    symbol,
    action: entryInstruction.action,
    volume,
    ...(entryInstruction.price === undefined
      ? {}
      : { price: entryInstruction.price }),
    stopLoss: plan.stop,
    takeProfit: plan.target,
    deviation: 20,
    comment: `Onkar AUTO ${candidate.id.slice(0, 8)}`,
    confirmed: true,
  };
  const checked = await checkMT5Order(
    order,
    account.accountFingerprint,
    provenanceRows[0].broker_symbol,
  );
  if (!checked.ok) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Broker order_check rejected the plan.",
      { retcode: checked.retcode ?? null },
    );
    return { blocked: true, reason: "Broker order_check rejected the plan." };
  }
  await event(
    store,
    runtime,
    candidate,
    requestId,
    "READY_TO_EXECUTE",
    "All deterministic checks passed.",
    {
      volume,
      symbol,
      action: entryInstruction.action,
      executionPrice: entryInstruction.executionPrice,
    },
  );
  if (
    !(await automaticEntryStillAllowed(
      store,
      runtime.user_id,
      runtime.scanner_config_id,
      "MT5",
    ))
  ) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Automatic entry was paused during broker checks. No order submitted.",
    );
    return {
      blocked: true,
      reason:
        "Automatic entry was paused during broker checks. No order submitted.",
    };
  }
  const auditId = await claimAutoAudit(store, runtime, candidate, order);
  if (!auditId) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Another MT5 execution is unresolved, or this exact request was already audited. No order submitted.",
    );
    return {
      blocked: true,
      reason:
        "Another MT5 execution is unresolved, or this exact request was already audited.",
    };
  }
  const auditRow: AutoExecutionRequestRow = {
    id: auditId,
    user_id: runtime.user_id,
    workspace_id: runtime.workspace_id,
    request_id: requestId,
    candidate_id: candidate.id,
    status: "CONFIRMED",
    updated_at: new Date().toISOString(),
  };
  try {
    await claimMT5Order(
      order,
      account.accountFingerprint,
      provenanceRows[0].broker_symbol,
    );
  } catch (error) {
    // /trade/claim changes durable bridge state from ARMED to CLAIMED. A lost
    // response cannot prove whether that transition committed, even though no
    // order_send has happened yet. Keep the exact request globally locked and
    // let result lookup atomically cancel/reconcile CLAIMED without a resend.
    const reason = `The MT5 claim response was lost or rejected after a possible durable state change (${error instanceof Error ? error.message : "unknown error"}). AUTO is paused; reconcile the exact request ID and do not retry.`;
    await markAutoUncertain(store, auditRow, reason).catch(() => false);
    await notifyAutoUncertain(store, auditRow, candidate, reason).catch(
      () => undefined,
    );
    return { blocked: true, uncertain: true, reason, requestId };
  }
  await event(
    store,
    runtime,
    candidate,
    requestId,
    "EXECUTING",
    "The audited MT5 execute handoff started.",
  );
  const [preSendBindings, preSendAllowed] = await Promise.all([
    config.accountId
      ? store.request<MT5AccountBinding[]>("mt5_account_bindings", {
          user_id: `eq.${owner}`,
          selected_account_id: `eq.${config.accountId}`,
          select: "selected_account_id,account_fingerprint",
          limit: "1",
        })
      : Promise.resolve([]),
    automaticEntryStillAllowed(
      store,
      runtime.user_id,
      runtime.scanner_config_id,
      "MT5",
    ),
  ]);
  const preSendBinding = preSendBindings[0];
  let preSendSnapshot: Awaited<ReturnType<typeof getMT5BrokerSnapshot>> | null =
    null;
  if (preSendAllowed && preSendBinding) {
    try {
      preSendSnapshot = await getMT5BrokerSnapshot(
        preSendBinding.account_fingerprint,
        symbol,
      );
    } catch {
      preSendSnapshot = null;
    }
  }
  const preSendAccount = preSendSnapshot?.account;
  const preSendSpec = preSendSnapshot?.symbol?.spec;
  const preSendTick = preSendSnapshot?.symbol?.tick;
  const preSendInstruction =
    preSendSpec && preSendTick
      ? deriveCandidateEntryInstruction({
          direction: candidate.payload.direction,
          plannedEntry: plan.entry,
          bid: preSendTick.bid,
          ask: preSendTick.ask,
          tickSize: preSendSpec.tickSize || preSendSpec.point,
        })
      : null;
  const preSendCurrentPrice = preSendTick
    ? buy
      ? preSendTick.ask
      : preSendTick.bid
    : null;
  const preSendRiskVolume =
    preSendAccount && preSendSpec && preSendInstruction?.ok
      ? calculateBrokerVolume(
          preSendAccount.equity,
          Math.min(config.risk.riskPercent, candidate.payload.risk.riskPercent),
          preSendInstruction.executionPrice,
          plan.stop,
          preSendSpec,
        )
      : null;
  const preSendGeometryBlocker = preSendInstruction?.ok
    ? candidateEntryGeometryBlocker({
        direction: candidate.payload.direction,
        entry: preSendInstruction.executionPrice,
        stop: plan.stop,
        target: plan.target,
        minimumRR: config.risk.minimumRR,
      })
    : "Candidate order type is no longer valid.";
  if (
    !preSendAllowed ||
    !preSendSnapshot ||
    !preSendAccount ||
    !preSendSpec ||
    !preSendTick ||
    preSendTick.state !== "CONNECTED" ||
    preSendTick.approximateLatencyMs > 30_000 ||
    !preSendInstruction?.ok ||
    preSendInstruction.action !== entryInstruction.action ||
    preSendGeometryBlocker !== null ||
    preSendTick.spread >
      Math.abs(preSendInstruction.executionPrice - plan.stop) * 0.1 ||
    preSendCurrentPrice === null ||
    preSendCurrentPrice < zone.low ||
    preSendCurrentPrice > zone.high ||
    preSendSnapshot.positions.length + preSendSnapshot.orders.length >=
      config.risk.maxOpenPositions ||
    preSendRiskVolume === null ||
    volume > preSendRiskVolume + preSendSpec.volumeStep / 1000 ||
    !mt5CandidateProvenanceMatches(
      provenanceRows[0],
      preSendBinding,
      candidate.id,
      candidate.last_candle_at,
      config.accountId,
      preSendAccount.accountFingerprint,
      preSendSpec.brokerSymbol,
    )
  ) {
    const reason =
      "AUTO permission, candidate order type, risk/exposure, fresh price, selected account, connected MT5 identity, or broker symbol changed after the durable claim. No execute request was sent; the exact claim must be reconciled.";
    await markAutoUncertain(store, auditRow, reason).catch(() => false);
    await notifyAutoUncertain(store, auditRow, candidate, reason).catch(
      () => undefined,
    );
    return { blocked: true, uncertain: true, reason, requestId };
  }
  // Final compare-and-swap after every slow pre-send check. Reconciliation
  // uses the same per-user advisory lock; if it won, execute is forbidden.
  const postClaimConfirmed = await store.rpc<boolean>(
    "confirm_mt5_auto_post_claim",
    {
      p_user: runtime.user_id,
      p_execution_request: auditRow.id,
      p_scanner_config: runtime.scanner_config_id,
      p_refreshed_at: new Date().toISOString(),
    },
  );
  if (!postClaimConfirmed)
    return {
      blocked: true,
      uncertain: true,
      reason:
        "AUTO execution state changed during the broker handoff. No execute request was sent; the original request remains locked for reconciliation.",
      requestId,
    };
  let result: Record<string, unknown>;
  try {
    result = await executeMT5Order(
      order,
      preSendAccount.accountFingerprint,
      preSendSpec.brokerSymbol,
    );
  } catch (error) {
    if (error instanceof MT5BridgeError && error.deliveryUncertain) {
      const reason =
        "The MT5 execute response was lost or ambiguous. AUTO is paused and every new order is locked while the exact request ID is reconciled; do not retry.";
      await markAutoUncertain(store, auditRow, reason).catch(() => false);
      await notifyAutoUncertain(store, auditRow, candidate, reason).catch(
        () => undefined,
      );
      logger.error(
        {
          event: "mt5_auto_execution_uncertain",
          requestId,
          candidateId: candidate.id,
        },
        reason,
      );
      return { blocked: true, uncertain: true, reason, requestId };
    }
    const decision: Extract<AutoReconciliationDecision, { resolved: true }> = {
      resolved: true,
      status: "REJECTED",
      message:
        "The MT5 execute request failed before delivery. No order was submitted.",
      result: {
        ok: false,
        requestId,
        stage: "execute_pre_delivery",
        notSent: true,
        error: error instanceof Error ? error.message : "Execute failed",
      },
    };
    await resolveAutoAudit(store, auditRow, decision, false);
    await notifyAutoResolved(store, auditRow, candidate, decision, false).catch(
      () => undefined,
    );
    return { blocked: true, reason: decision.message, requestId };
  }
  const succeeded = result.ok === true;
  const decision: Extract<AutoReconciliationDecision, { resolved: true }> = {
    resolved: true,
    status: succeeded ? "SENT" : "REJECTED",
    message: succeeded
      ? "The broker accepted the audited MT5 AUTO request."
      : "The broker rejected the audited MT5 AUTO request.",
    result,
  };
  try {
    const resolved = await resolveAutoAudit(store, auditRow, decision, false);
    if (!resolved)
      throw new Error("The MT5 AUTO audit row changed before resolution.");
  } catch {
    const reason =
      "MT5 returned an exact result, but the execution audit write was interrupted. AUTO is paused until the original request ID is reconciled; do not retry.";
    await markAutoUncertain(store, auditRow, reason).catch(() => false);
    await notifyAutoUncertain(store, auditRow, candidate, reason).catch(
      () => undefined,
    );
    return { blocked: true, uncertain: true, reason, requestId };
  }
  await notifyAutoResolved(store, auditRow, candidate, decision, false).catch(
    () => undefined,
  );
  logger.info(
    { event: "auto_execution", candidateId: candidate.id, succeeded },
    succeeded ? "AUTO order accepted by MT5" : "AUTO order rejected by MT5",
  );
  return { executed: succeeded, candidateId: candidate.id, requestId };
}

export function capabilityAfterMT5Reconciliation(
  capability: AutoExecutionCapability,
  reconciliation: MT5Reconciliation,
) {
  if (!reconciliation.unresolvedRequests.length)
    return { ...capability, reconciliation };

  const unresolved = reconciliation.unresolvedRequests
    .slice(0, 3)
    .map(
      (request) =>
        `${request.requestId} (${request.state}, ${Math.max(0, request.ageSeconds)}s)`,
    )
    .join(", ");
  const remaining = Math.max(0, reconciliation.unresolvedRequests.length - 3);
  return {
    ...capability,
    ready: false,
    state: "BLOCKED" as const,
    reason: `MT5 has ${reconciliation.unresolvedRequests.length} unresolved bridge execution request(s): ${unresolved}${remaining ? `, plus ${remaining} more` : ""}. New execution remains locked until each original request ID is reconciled; no request was resent.`,
    reconciliation,
  };
}

export async function reconcileAutoExecution(userId: string) {
  const capability = await getAutoExecutionCapability(userId);
  if (!capability.ready) return capability;
  const reconciliation = await reconcileMT5State();
  return capabilityAfterMT5Reconciliation(capability, reconciliation);
}

export async function reconcileConfiguredAutoExecution() {
  const owner = bridgeOwner();
  if (!owner)
    return { skipped: true, reason: "MT5 bridge owner is not configured." };
  return reconcileAutoExecution(owner);
}
