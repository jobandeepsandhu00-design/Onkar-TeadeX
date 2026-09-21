import { scannerConfigSchema, strategyVersionSchema } from "@workspace/api-zod";
import {
  checkMT5Order,
  executeMT5Order,
  getMT5Account,
  getMT5Orders,
  getMT5Positions,
  getMT5SymbolSpec,
  getMT5Tick,
  type MT5SymbolSpec,
} from "../mt5/client";
import { logger } from "../lib/logger";
import {
  ScannerStore,
  records,
  type CandidateRow,
  type ConfigRow,
  type VersionRow,
} from "./store";
import { executionRequestId } from "./execution-identity";

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
}

const accountMatches = (stored: Record<string, unknown>, masked: string) => {
  const configured = String(stored.accountNumber || "").replace(/\D/g, "");
  const connected = masked.replace(/\D/g, "");
  return Boolean(
    configured && connected && configured.slice(-4) === connected.slice(-4),
  );
};

/** Process at most one execution per invocation. The bridge remains the final broker gate. */
export async function runNextAutoExecution() {
  const owner = bridgeOwner();
  if (!autoExecutionWorkerEnabled() || !owner)
    return {
      skipped: true,
      reason: "AUTO execution worker is not configured.",
    };
  const capability = await getAutoExecutionCapability(owner);
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
  const candidates = await store.request<CandidateRow[]>("setup_candidates", {
    config_id: `eq.${configRow.id}`,
    user_id: `eq.${owner}`,
    state: "eq.READY",
    last_candle_at: `gte.${runtime.source_activated_at}`,
    order: "updated_at.asc",
    limit: "10",
  });
  const candidate = candidates.find(
    (item) =>
      item.payload.provider === "mt5" &&
      !item.payload.stale &&
      item.payload.risk.allowed &&
      item.payload.risk.warnings.length === 0,
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
  const existing = await store.request<Array<{ state: string }>>(
    "scanner_execution_events",
    { user_id: `eq.${owner}`, request_id: `eq.${requestId}`, limit: "1" },
  );
  if (existing.length)
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
  const storedAccount = records(source.tradingAccounts).find(
    (item) => item.id === config.accountId,
  );
  const [account, positions] = await Promise.all([
    getMT5Account(),
    getMT5Positions(),
  ]);
  if (!storedAccount || !accountMatches(storedAccount, account.account)) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Selected account does not match the connected MT5 account.",
    );
    return {
      blocked: true,
      reason: "Selected account does not match connected MT5.",
    };
  }
  if (positions.length >= config.risk.maxOpenPositions) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Maximum open positions reached.",
    );
    return { blocked: true, reason: "Maximum open positions reached." };
  }
  await event(
    store,
    runtime,
    candidate,
    requestId,
    "RISK_CHECK",
    "Broker risk validation started.",
  );
  const symbol =
    candidate.symbol === "XAUUSD"
      ? "XAU/USD"
      : `${candidate.symbol.slice(0, 3)}/${candidate.symbol.slice(3)}`;
  const [tick, spec] = await Promise.all([
    getMT5Tick(symbol),
    getMT5SymbolSpec(symbol),
  ]);
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
  if (currentPrice < zone.low || currentPrice > zone.high) {
    await event(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Price left the verified entry zone.",
    );
    return { blocked: true, reason: "Price left the verified entry zone." };
  }
  const stopDistance = Math.abs(currentPrice - plan.stop);
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
    currentPrice,
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
  const order = {
    requestId,
    symbol,
    action: buy ? ("MARKET_BUY" as const) : ("MARKET_SELL" as const),
    volume,
    stopLoss: plan.stop,
    takeProfit: plan.target,
    deviation: 20,
    comment: `Onkar AUTO ${candidate.id.slice(0, 8)}`,
    confirmed: true,
  };
  const checked = await checkMT5Order(order);
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
    { volume, symbol },
  );
  await event(
    store,
    runtime,
    candidate,
    requestId,
    "EXECUTING",
    "Order submitted to the connected MT5 bridge.",
  );
  const result = await executeMT5Order(order);
  const succeeded = Boolean(result.ok);
  await event(
    store,
    runtime,
    candidate,
    requestId,
    succeeded ? "EXECUTED" : "ERROR",
    succeeded ? "Broker accepted the order." : "Broker rejected the order.",
    {
      order: result.order ?? null,
      deal: result.deal ?? null,
      retcode: result.retcode ?? null,
      volume,
      brokerSymbol: result.brokerSymbol ?? spec.brokerSymbol,
    },
  );
  if (succeeded)
    await store.request(
      "setup_candidates",
      { id: `eq.${candidate.id}`, user_id: `eq.${owner}`, state: "eq.READY" },
      "PATCH",
      { state: "TRIGGERED", updated_at: new Date().toISOString() },
    );
  logger.info(
    { event: "auto_execution", candidateId: candidate.id, succeeded },
    succeeded ? "AUTO order accepted by MT5" : "AUTO order rejected by MT5",
  );
  return { executed: succeeded, candidateId: candidate.id, requestId };
}

export async function reconcileAutoExecution(userId: string) {
  const capability = await getAutoExecutionCapability(userId);
  if (!capability.ready) return capability;
  await Promise.all([getMT5Positions(), getMT5Orders()]);
  return capability;
}
