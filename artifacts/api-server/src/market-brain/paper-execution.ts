import { scannerConfigSchema, strategyVersionSchema } from "@workspace/api-zod";
import { getMarketProvider } from "./providers";
import { accountContext } from "./journal";
import {
  ScannerStore,
  records,
  type CandidateRow,
  type ConfigRow,
  type VersionRow,
} from "./store";
import { executionRequestId } from "./execution-identity";

type PaperRuntime = {
  user_id: string;
  workspace_id: string;
  scanner_config_id: string;
  source_activated_at: string;
};

type PaperTrade = {
  id: string;
  user_id: string;
  workspace_id: string;
  candidate_id: string;
  request_id: string;
  account_id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  setup_id: string | null;
  setup_version_id: string;
  confirmation_candle: string;
  entry: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  risk_percent: number;
  status: "OPEN" | "CLOSED" | "INVALIDATED";
  close_price: number | null;
  pnl: number | null;
  r_multiple: number | null;
  opened_at: string;
  last_managed_at: string;
  closed_at: string | null;
  detail: Record<string, unknown>;
};

const freshQuote = (timestamp: string, now = Date.now()) => {
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -30_000 && age <= 180_000;
};

export function calculatePaperResult(
  trade: Pick<
    PaperTrade,
    "direction" | "entry" | "stop_loss" | "position_size" | "detail"
  >,
  closePrice: number,
) {
  const unit = Number(trade.detail.valuePerPriceUnit);
  if (!(unit > 0) || !(trade.position_size > 0)) return null;
  const sign = trade.direction === "BUY" ? 1 : -1;
  const pnl = (closePrice - trade.entry) * sign * trade.position_size * unit;
  const initialRisk =
    Math.abs(trade.entry - trade.stop_loss) * trade.position_size * unit;
  return {
    pnl,
    rMultiple: initialRisk > 0 ? pnl / initialRisk : null,
  };
}

function journalTrade(trade: PaperTrade) {
  const opened = new Date(trade.opened_at);
  const closed = trade.closed_at ? new Date(trade.closed_at) : null;
  return {
    id: trade.id,
    accountId: trade.account_id,
    symbol: trade.symbol,
    market: trade.symbol === "XAUUSD" ? "Gold" : "Forex",
    side: trade.direction === "BUY" ? "Buy" : "Sell",
    date: opened.toISOString().slice(0, 10),
    entryTime: opened.toISOString().slice(11, 16),
    entry: trade.entry,
    sl: trade.stop_loss,
    tp: trade.take_profit,
    positionSize: trade.position_size,
    riskPct: trade.risk_percent,
    setupId: trade.setup_id,
    strategyVersionId: trade.setup_version_id,
    confirmationCandle: trade.confirmation_candle,
    executionProvider: "PAPER",
    marketDataProvider: "TWELVE_DATA",
    status: trade.status,
    ...(closed
      ? {
          exit: trade.close_price,
          exitDate: closed.toISOString().slice(0, 10),
          exitTime: closed.toISOString().slice(11, 16),
          netPnl: trade.pnl,
          manualPnl: trade.pnl,
          rMultiple: trade.r_multiple,
        }
      : {}),
  };
}

async function syncJournal(store: ScannerStore, trade: PaperTrade) {
  await store.rpc("upsert_paper_trade_journal", {
    p_user: trade.user_id,
    p_trade: journalTrade(trade),
  });
}

async function executionEvent(
  store: ScannerStore,
  runtime: PaperRuntime,
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
  accountId: string,
  detail: Record<string, unknown> = {},
) {
  await store.request("scanner_execution_events", {}, "POST", {
    user_id: runtime.user_id,
    workspace_id: runtime.workspace_id,
    candidate_id: candidate.id,
    request_id: requestId,
    state,
    reason,
    execution_provider: "PAPER",
    market_data_provider: "TWELVE_DATA",
    account_id: accountId,
    detail,
  });
}

export async function manageNextPaperTrade(store = ScannerStore.service()) {
  const [trade] = await store.request<PaperTrade[]>("paper_trades", {
    status: "eq.OPEN",
    order: "last_managed_at.asc",
    limit: "1",
  });
  if (!trade) return { skipped: true, reason: "No open Paper trade." };
  const quote = await getMarketProvider("twelvedata").getQuote(trade.symbol);
  if (!freshQuote(quote.timestamp))
    return {
      skipped: true,
      reason: "Twelve Data quote is stale; Paper trade unchanged.",
    };
  const price = quote.price;
  const stopHit =
    trade.direction === "BUY"
      ? price <= trade.stop_loss
      : price >= trade.stop_loss;
  const targetHit =
    trade.direction === "BUY"
      ? price >= trade.take_profit
      : price <= trade.take_profit;
  const now = new Date().toISOString();
  if (!stopHit && !targetHit) {
    await store.request(
      "paper_trades",
      { id: `eq.${trade.id}`, status: "eq.OPEN" },
      "PATCH",
      { current_price: price, last_managed_at: now },
    );
    return { managed: true, tradeId: trade.id, status: "OPEN" };
  }
  const closePrice = stopHit ? trade.stop_loss : trade.take_profit;
  const result = calculatePaperResult(trade, closePrice);
  if (!result)
    return {
      skipped: true,
      reason: "Paper trade contract value is unavailable.",
    };
  const [closed] = await store.request<PaperTrade[]>(
    "paper_trades",
    { id: `eq.${trade.id}`, status: "eq.OPEN" },
    "PATCH",
    {
      status: "CLOSED",
      current_price: closePrice,
      close_price: closePrice,
      pnl: result.pnl,
      r_multiple: result.rMultiple,
      last_managed_at: now,
      closed_at: now,
    },
  );
  if (closed) {
    await syncJournal(store, closed);
    await store.request(
      "setup_candidates",
      { id: `eq.${trade.candidate_id}`, state: "eq.TRIGGERED" },
      "PATCH",
      { state: "COMPLETED", updated_at: now },
    );
  }
  return {
    managed: true,
    tradeId: trade.id,
    status: "CLOSED",
    pnl: result.pnl,
  };
}

export async function runNextPaperExecution(store = ScannerStore.service()) {
  const [runtime] = await store.request<PaperRuntime[]>(
    "scanner_runtime_controls",
    {
      scanner_state: "eq.RUNNING",
      trading_mode: "eq.AUTO",
      auto_execution_enabled: "eq.true",
      emergency_stop: "eq.false",
      trading_source: "eq.TWELVE_DATA",
      order: "updated_at.asc",
      limit: "1",
    },
  );
  if (!runtime)
    return { skipped: true, reason: "No AUTO Paper runtime is armed." };
  const [configRow] = await store.request<ConfigRow[]>("scanner_configs", {
    id: `eq.${runtime.scanner_config_id}`,
    user_id: `eq.${runtime.user_id}`,
    enabled: "eq.true",
    limit: "1",
  });
  if (!configRow)
    return {
      skipped: true,
      reason: "Paper scanner configuration is disabled.",
    };
  const config = scannerConfigSchema.parse(configRow.config);
  if (!config.permissions.paperTradeExecution)
    return {
      skipped: true,
      reason: "Paper-trade execution is disabled in Permission Center.",
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
  const [candidate] = await store.request<CandidateRow[]>("setup_candidates", {
    config_id: `eq.${configRow.id}`,
    user_id: `eq.${runtime.user_id}`,
    state: "eq.READY",
    last_candle_at: `gte.${runtime.source_activated_at}`,
    "payload->>provider": "eq.twelvedata",
    order: "updated_at.asc",
    limit: "1",
  });
  if (!candidate)
    return {
      skipped: true,
      reason: "No new Twelve Data Paper setup is ready.",
    };
  const [version] = await store.request<VersionRow[]>(
    "scanner_strategy_versions",
    {
      id: `eq.${candidate.version_id}`,
      user_id: `eq.${runtime.user_id}`,
      limit: "1",
    },
  );
  const definition = version
    ? strategyVersionSchema.parse(version.definition)
    : null;
  const source = await store.source(runtime.user_id);
  const account = accountContext(source, config, candidate.symbol, Date.now());
  const accountRecord = records(source.tradingAccounts).find(
    (item) => item.id === config.accountId,
  );
  const requestId = executionRequestId({
    accountId: config.accountId ?? "",
    executionProvider: "PAPER",
    symbol: candidate.symbol,
    versionId: candidate.version_id,
    direction: candidate.payload.direction,
    confirmationCandle: candidate.last_candle_at,
    entryEvent: candidate.fingerprint,
  });
  const existing = await store.request<PaperTrade[]>("paper_trades", {
    user_id: `eq.${runtime.user_id}`,
    request_id: `eq.${requestId}`,
    limit: "1",
  });
  if (existing.length)
    return { skipped: true, reason: "This Paper setup was already executed." };
  if (
    !definition ||
    definition.approval !== "approved" ||
    !definition.autoExecutionAllowed
  ) {
    await executionEvent(
      store,
      runtime,
      candidate,
      requestId,
      "BLOCKED",
      "Rule version is not approved for AUTO execution.",
      config.accountId ?? "",
    );
    return {
      blocked: true,
      reason: "Setup is not approved for AUTO execution.",
    };
  }
  if (!account || !accountRecord || !config.accountId)
    return { blocked: true, reason: "Select a funded Onkar Paper account." };
  if (
    candidate.payload.stale ||
    !candidate.payload.risk.allowed ||
    candidate.payload.risk.warnings.length ||
    (config.requireNews && candidate.payload.news.status !== "safe")
  )
    return { blocked: true, reason: "Setup risk or news checks do not pass." };
  const plan = candidate.plan;
  if (!plan?.positionSize || !(plan.stop > 0 && plan.target > 0))
    return { blocked: true, reason: "Paper position sizing is unavailable." };
  const quote = await getMarketProvider("twelvedata").getQuote(
    candidate.symbol,
  );
  if (!freshQuote(quote.timestamp))
    return { blocked: true, reason: "Twelve Data quote is stale." };
  const entry = quote.price;
  const zone = candidate.payload.entryZone;
  if (entry < zone.low || entry > zone.high)
    return { blocked: true, reason: "Price left the verified entry zone." };
  const sign = candidate.payload.direction === "long" ? 1 : -1;
  const distance = (entry - plan.stop) * sign;
  const reward = (plan.target - entry) * sign;
  if (!(distance > 0 && reward / distance >= config.risk.minimumRR))
    return {
      blocked: true,
      reason: "Live Paper entry no longer meets minimum R:R.",
    };
  await executionEvent(
    store,
    runtime,
    candidate,
    requestId,
    "RISK_CHECK",
    "Paper account risk validation started.",
    config.accountId,
  );
  await executionEvent(
    store,
    runtime,
    candidate,
    requestId,
    "READY_TO_EXECUTE",
    "All deterministic Paper checks passed.",
    config.accountId,
    { entry, positionSize: plan.positionSize },
  );
  await executionEvent(
    store,
    runtime,
    candidate,
    requestId,
    "EXECUTING",
    "Opening virtual position in the selected Onkar Paper account.",
    config.accountId,
  );
  const [trade] = await store.request<PaperTrade[]>(
    "paper_trades",
    {},
    "POST",
    {
      user_id: runtime.user_id,
      workspace_id: runtime.workspace_id,
      candidate_id: candidate.id,
      request_id: requestId,
      account_id: config.accountId,
      symbol: candidate.symbol,
      direction: candidate.payload.direction === "long" ? "BUY" : "SELL",
      setup_id: version.source_setup_id,
      setup_version_id: version.id,
      confirmation_candle: candidate.last_candle_at,
      entry,
      current_price: entry,
      stop_loss: plan.stop,
      take_profit: plan.target,
      position_size: plan.positionSize,
      risk_percent: plan.riskPercent,
      detail: {
        accountName: accountRecord.alias || accountRecord.accountNumber,
        accountCurrency: account.currency,
        setupName: version.name,
        valuePerPriceUnit: account.valuePerUnit,
      },
    },
  );
  if (!trade)
    return { blocked: true, reason: "Paper trade could not be stored." };
  await syncJournal(store, trade);
  await executionEvent(
    store,
    runtime,
    candidate,
    requestId,
    "EXECUTED",
    "Paper trade opened from verified Twelve Data prices.",
    config.accountId,
    { paperTradeId: trade.id, entry, positionSize: plan.positionSize },
  );
  await store.request(
    "setup_candidates",
    { id: `eq.${candidate.id}`, state: "eq.READY" },
    "PATCH",
    { state: "TRIGGERED", updated_at: new Date().toISOString() },
  );
  return { executed: true, provider: "PAPER", tradeId: trade.id, requestId };
}
