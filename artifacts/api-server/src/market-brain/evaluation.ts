import {
  type CandidateState,
  type FeatureValue,
  type RuleResult,
  type StrategyVersion,
  type ScannerConfig,
  type Candle,
  type Timeframe,
  timeframeMs,
  normalizeTimeframe,
} from "@workspace/api-zod";
import {
  timeframeContext,
  type TimeframeContext,
  marketSession,
  mean,
} from "./calculations";
import {
  buildGlobalTradingWorkflow,
  finalizeGlobalTradingWorkflow,
  globalWorkflowRequired,
} from "./global-workflow";
import { evaluateSetupWorkflow } from "./setup-workflows";
import { floorVolume, type InstrumentSizing } from "./risk-sizing";

export type NewsCheck = {
  status: "safe" | "blocked" | "unavailable";
  checkedAt: string;
  events: Array<{ title: string; time: number; currency: string }>;
};
export type AccountContext = {
  id: string;
  currency: string;
  balance: number;
  dailyLossBase?: number;
  dailyLossPercent?: number;
  dailyPnl: number;
  openPositions: number;
  openRiskMoney: number | null;
  valuePerUnit: number | null;
  sizing?: InstrumentSizing | null;
  sizingError?: string | null;
};
export function evaluateRules(
  strategy: StrategyVersion,
  contexts: Partial<Record<Timeframe, TimeframeContext>>,
  extra: Record<string, FeatureValue>,
): RuleResult[] {
  return strategy.rules.map((rule) => {
    const actual = Object.prototype.hasOwnProperty.call(extra, rule.feature)
      ? extra[rule.feature]
      : (contexts[rule.timeframe]?.features[rule.feature] ?? null);
    const available = actual !== null && actual !== undefined;
    let passed = false;
    if (available) {
      switch (rule.operator) {
        case "eq":
          passed = actual === rule.expected;
          break;
        case "neq":
          passed = actual !== rule.expected;
          break;
        case "gt":
          passed =
            typeof actual === "number" &&
            typeof rule.expected === "number" &&
            actual > rule.expected;
          break;
        case "gte":
          passed =
            typeof actual === "number" &&
            typeof rule.expected === "number" &&
            actual >= rule.expected;
          break;
        case "lt":
          passed =
            typeof actual === "number" &&
            typeof rule.expected === "number" &&
            actual < rule.expected;
          break;
        case "lte":
          passed =
            typeof actual === "number" &&
            typeof rule.expected === "number" &&
            actual <= rule.expected;
          break;
      }
    }
    return { ...rule, actual: actual ?? null, passed, available };
  });
}
export function confluence(results: RuleResult[]) {
  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  const score =
    totalWeight > 0
      ? Math.round(
          (100 *
            results.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0)) /
            totalWeight,
        )
      : 0;
  return {
    score,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    requiredPass: results.filter((r) => r.required).every((r) => r.passed),
    quality:
      score >= 90
        ? "exceptional"
        : score >= 80
          ? "high quality"
          : score >= 65
            ? "watch"
            : score >= 50
              ? "developing"
              : "weak",
  };
}
export function calculateRisk(
  entry: number,
  stop: number,
  target: number,
  direction: "long" | "short",
  account: AccountContext | null,
  profile: ScannerConfig["risk"],
) {
  const sign = direction === "long" ? 1 : -1,
    distance = (entry - stop) * sign,
    reward = (target - entry) * sign;
  const rr = distance > 0 ? reward / distance : 0;
  const monetaryRisk =
    account && account.balance > 0
      ? (account.balance * profile.riskPercent) / 100
      : null;
  const warnings: string[] = [];
  if (!(entry > 0 && stop > 0 && target > 0 && distance > 0 && reward > 0))
    warnings.push("Invalid entry, stop, or target geometry");
  if (rr < profile.minimumRR) warnings.push("Reward/risk below minimum");
  if (!account || !(account.balance > 0))
    warnings.push("Select a funded trading account for risk checks");
  if (account) {
    const dailyLimit =
      ((account.dailyLossBase ?? account.balance) *
        Math.min(
          account.dailyLossPercent ?? profile.maxDailyLossPercent,
          profile.maxDailyLossPercent,
        )) /
      100;
    if (account.dailyPnl <= -dailyLimit)
      warnings.push("Account daily loss limit reached");
    // A plan must fit the remaining daily allowance, not merely pass a check
    // that today's realized loss has not already reached the limit.
    if (
      account.openRiskMoney !== null &&
      monetaryRisk !== null &&
      Math.max(0, -account.dailyPnl) + account.openRiskMoney + monetaryRisk >
        dailyLimit
    )
      warnings.push(
        "Proposed risk plus open exposure exceeds remaining daily loss allowance",
      );
    if (account.openPositions >= profile.maxOpenPositions)
      warnings.push("Maximum open positions reached");
    if (account.openRiskMoney === null)
      warnings.push(
        "Open exposure cannot be calculated: a position is missing risk data",
      );
    else if (
      account.openRiskMoney + (monetaryRisk || 0) >
      (account.balance * profile.maxOpenRiskPercent) / 100
    )
      warnings.push("Maximum simultaneous exposure exceeded");
    if (!account.valuePerUnit)
      warnings.push(
        account.sizingError ||
          "Instrument contract value / account-currency conversion required for position sizing",
      );
  }
  const rawPositionSize =
    account?.valuePerUnit && monetaryRisk !== null && distance > 0
      ? monetaryRisk / (distance * account.valuePerUnit)
      : null;
  const positionSize =
    rawPositionSize !== null
      ? floorVolume(rawPositionSize, account?.sizing?.volumeStep ?? 0.01)
      : null;
  if (
    positionSize !== null &&
    account?.sizing &&
    positionSize < account.sizing.volumeMin
  )
    warnings.push("Calculated position is below the instrument minimum volume");
  if (
    positionSize !== null &&
    account?.sizing &&
    positionSize > account.sizing.volumeMax
  )
    warnings.push("Calculated position exceeds the instrument maximum volume");
  const estimatedLossAtStop =
    positionSize !== null && account?.valuePerUnit
      ? distance * positionSize * account.valuePerUnit
      : null;
  const allowed = warnings.length === 0;
  return {
    entry,
    stop,
    target,
    rr,
    stopDistance: distance,
    riskPercent: profile.riskPercent,
    monetaryRisk,
    positionSize,
    rawPositionSize,
    estimatedLossAtStop,
    valuePerPriceUnit: account?.valuePerUnit ?? null,
    contractSize: account?.sizing?.contractSize ?? null,
    profitCurrency: account?.sizing?.profitCurrency ?? null,
    conversionRate: account?.sizing?.conversionRate ?? null,
    sizingSafetyFactor: account?.sizing?.safetyFactor ?? 1,
    volumeStep: account?.sizing?.volumeStep ?? null,
    sizingSource: account?.sizing?.source ?? null,
    currency: account?.currency ?? null,
    accountId: account?.id ?? null,
    allowed,
    warnings,
    executionEnabled: allowed,
  };
}
export function analyzeCandidate(
  strategy: StrategyVersion,
  histories: Partial<Record<Timeframe, Candle[]>>,
  config: ScannerConfig,
  account: AccountContext | null,
  news: NewsCheck,
  now: number,
  symbol = "",
) {
  const contexts: Partial<Record<Timeframe, TimeframeContext>> = {};
  for (const [tf, bars] of Object.entries(histories))
    if (bars && bars.length >= 30)
      contexts[tf as Timeframe] = timeframeContext(bars, tf as Timeframe, now);
  const primary = contexts[strategy.timeframe],
    higher = contexts[strategy.higherTimeframe];
  if (!primary || !higher)
    throw new Error("Insufficient primary/higher timeframe history");
  const requiresGlobalWorkflow = globalWorkflowRequired(symbol);
  const parentWorkflow = requiresGlobalWorkflow
    ? buildGlobalTradingWorkflow({ symbol, histories, now })
    : null;
  const setupWorkflow = evaluateSetupWorkflow({
    setupName: strategy.name,
    requestedDirection: strategy.direction,
    workflow: parentWorkflow,
    closedThirtyMinuteCandles: histories["30m"] ?? [],
  });
  const direction =
    setupWorkflow?.direction ??
    (strategy.direction === "both"
      ? (parentWorkflow?.fourHour.bias ?? higher.structure.trend) === "bearish"
        ? "short"
        : "long"
      : strategy.direction);
  const bullish = direction === "long",
    atr = primary.indicators.atr;
  if (!atr || atr <= 0) throw new Error("ATR warmup incomplete");
  const entry = primary.indicators.close;
  const relevant = higher.zones
    .filter(
      (z) =>
        !z.invalidated &&
        (bullish
          ? z.low < entry && ["support", "equal_lows"].includes(z.type)
          : z.high > entry && ["resistance", "equal_highs"].includes(z.type)),
    )
    .sort(
      (a, b) =>
        Math.abs((a.low + a.high) / 2 - entry) -
        Math.abs((b.low + b.high) / 2 - entry),
    );
  const zone = relevant[0] ?? null;
  const stop = bullish
    ? Math.min(entry - atr, (zone?.low ?? entry - atr) - atr * 0.15)
    : Math.max(entry + atr, (zone?.high ?? entry + atr) + atr * 0.15);
  const obstacles = higher.zones
    .filter(
      (z) =>
        !z.invalidated &&
        (bullish
          ? z.low > entry && ["resistance", "equal_highs"].includes(z.type)
          : z.high < entry && ["support", "equal_lows"].includes(z.type)),
    )
    .sort((a, b) => Math.abs(a.low - entry) - Math.abs(b.low - entry));
  const plannedTarget =
    entry + (bullish ? 1 : -1) * Math.abs(entry - stop) * strategy.minRR;
  const target = obstacles[0]
    ? bullish
      ? Math.min(plannedTarget, obstacles[0].low)
      : Math.max(plannedTarget, obstacles[0].high)
    : plannedTarget;
  const risk = calculateRisk(
    entry,
    stop,
    target,
    direction,
    account,
    config.risk,
  );
  const extra: Record<string, FeatureValue> = {
    rr: risk.rr,
    newsSafe: news.status === "unavailable" ? null : news.status === "safe",
    openRangeATR: obstacles[0]
      ? Math.abs((bullish ? obstacles[0].low : obstacles[0].high) - entry) / atr
      : null,
    zoneDistanceATR: zone
      ? Math.abs((zone.low + zone.high) / 2 - entry) / atr
      : null,
    session: marketSession(now),
  };
  if (setupWorkflow) Object.assign(extra, setupWorkflow.features);
  const rules = evaluateRules(strategy, contexts, extra),
    score = confluence(rules);
  const needed = new Set([
    strategy.timeframe,
    strategy.higherTimeframe,
    ...strategy.rules.map((r) => r.timeframe),
  ]);
  const stale = [...needed].some((tf) => !contexts[tf] || contexts[tf]!.stale);
  const sessionPass =
    !strategy.sessions.length || strategy.sessions.includes(marketSession(now));
  const setupMatched =
    score.requiredPass && score.score >= config.alertThreshold;
  const globalWorkflow = parentWorkflow
    ? finalizeGlobalTradingWorkflow(parentWorkflow, setupMatched, risk.allowed)
    : null;
  const parentGatePassed =
    !requiresGlobalWorkflow || globalWorkflow?.gate.status === "UNLOCKED";
  const canReady =
    score.requiredPass &&
    risk.allowed &&
    sessionPass &&
    !stale &&
    parentGatePassed &&
    (!config.requireNews || news.status === "safe");
  const status: CandidateState = stale
    ? "SCANNING"
    : requiresGlobalWorkflow && !globalWorkflow
      ? "SCANNING"
      : requiresGlobalWorkflow && !parentGatePassed
        ? globalWorkflow?.masterStatus === "AT_SETUP_AREA" ||
          globalWorkflow?.masterStatus === "APPROACHING_ZONE" ||
          globalWorkflow?.masterStatus === "NO_CONFIRMATION"
          ? "WATCH"
          : "DEVELOPING"
        : score.score >= config.alertThreshold && canReady
          ? "READY"
          : score.score >= 65
            ? "WATCH"
            : "DEVELOPING";
  return {
    engineVersion: "onkar-global-workflow-v2",
    source: "calculated" as const,
    direction,
    status: status as CandidateState,
    ...score,
    rules,
    risk,
    globalWorkflow,
    globalWorkflowRequired: requiresGlobalWorkflow,
    setupWorkflow,
    contexts,
    news,
    stale,
    zone,
    entryZone: { low: entry - atr * 0.1, high: entry + atr * 0.1 },
    invalidation: stop,
    targets: [target],
    session: marketSession(now),
    sessionPass,
    primaryTimeframe: strategy.timeframe,
    higherTimeframe: strategy.higherTimeframe,
    marketBias: higher.structure.trend,
    lastCandleAt: primary.lastCandleAt,
    analyzedAt: new Date(now).toISOString(),
    expiresAt: new Date(
      now + timeframeMs[strategy.timeframe] * strategy.expiresBars,
    ).toISOString(),
    warnings: [
      ...risk.warnings,
      ...(stale
        ? ["STALE DATA: a required timeframe is unavailable or old"]
        : []),
      ...(news.status === "unavailable"
        ? ["News confirmation unavailable"]
        : []),
      ...(requiresGlobalWorkflow && !globalWorkflow
        ? ["Global 4H → 1H → 30M workflow data is incomplete"]
        : globalWorkflow?.gate.status === "LOCKED"
          ? [`Setup AI locked: ${globalWorkflow.gate.missing.join("; ")}`]
          : []),
      ...(setupWorkflow?.invalidated
        ? ["Setup-specific invalidation condition is present"]
        : []),
      ...(!sessionPass ? ["Outside preferred session"] : []),
    ],
  };
}
export type Analysis = ReturnType<typeof analyzeCandidate>;
export function nextLifecycle(
  state: CandidateState,
  bar: Candle,
  plan: { stop: number; target: number; entry: number },
  direction: "long" | "short",
  expiresAt: number,
  now: number,
): { state: CandidateState; event: string | null } {
  if (["INVALIDATED", "EXPIRED", "COMPLETED"].includes(state))
    return { state, event: null };
  const stop = direction === "long" ? bar.l <= plan.stop : bar.h >= plan.stop;
  const target =
    direction === "long" ? bar.h >= plan.target : bar.l <= plan.target;
  // Stop wins intrabar ambiguity; never invent profitable ordering from OHLC.
  if (state === "TRIGGERED" && stop)
    return { state: "INVALIDATED", event: "stop_reached" };
  if (state === "TRIGGERED" && target)
    return { state: "COMPLETED", event: "target_reached" };
  if (now >= expiresAt) return { state: "EXPIRED", event: "setup_expired" };
  if (stop) return { state: "INVALIDATED", event: "setup_invalidated" };
  if (state === "READY" && bar.l <= plan.entry && bar.h >= plan.entry)
    return { state: "TRIGGERED", event: "entry_zone_reached" };
  return { state, event: null };
}
export function historicalMatches(
  trades: Array<Record<string, unknown>>,
  setupId: string,
  symbol: string,
  timeframe: string,
  accountId: string | null,
) {
  const number = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? null
      : Number.isFinite(Number(v))
        ? Number(v)
        : null;
  const sameTimeframe = (v: unknown) => {
    try {
      return normalizeTimeframe(String(v)) === normalizeTimeframe(timeframe);
    } catch {
      return false;
    }
  };
  const rows = trades.filter(
    (t) =>
      (!accountId || t.accountId === accountId) &&
      (t.setupId === setupId ||
        String(t.setupId) === setupId.split(":").at(-1)) &&
      String(t.symbol).replace(/[/-]/g, "") === symbol.replace(/[/-]/g, "") &&
      sameTimeframe(t.timeframe) &&
      number(t.exit) !== null,
  );
  const pnls = rows
    .map((t) => number(t.netPnl) ?? number(t.manualPnl) ?? number(t.pnl))
    .filter((v): v is number => v !== null);
  const r = rows
    .map((t) => number(t.rMultiple))
    .filter((v): v is number => v !== null);
  const wins = pnls.filter((p) => p > 0).length,
    losses = pnls.filter((p) => p < 0).length;
  const tags = new Map<string, number>();
  for (const t of rows)
    for (const m of Array.isArray(t.mistakes) ? t.mistakes : [])
      if (typeof m === "string") tags.set(m, (tags.get(m) || 0) + 1);
  return {
    sample: rows.length,
    knownPnl: pnls.length,
    wins,
    losses,
    breakeven: pnls.length - wins - losses,
    winRate: pnls.length ? (wins / pnls.length) * 100 : null,
    averageR: r.length ? mean(r) : null,
    mostCommonMistakes: [...tags]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    caution:
      rows.length < 30
        ? "Small sample; descriptive comparison only"
        : "Historical association, not a forecast",
    method: "exact_setup_symbol_timeframe_account",
    tradeIds: rows.map((t) => String(t.id)),
  };
}
