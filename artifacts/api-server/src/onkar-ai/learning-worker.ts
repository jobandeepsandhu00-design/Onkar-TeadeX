import { ScannerStore } from "../market-brain/store";
import { deriveLearningInsights, normalizeTrades, summarizeTrades, type LearnedTrade } from "./learning";

export function classifyTradeAutopsy(trade: LearnedTrade) {
  const mistakes = trade.mistakes.map((item) => item.toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
  const has = (pattern: RegExp) => mistakes.some((item) => pattern.test(item));
  const classification = trade.outcome === "WIN" ? "VALID_WIN"
    : has(/EARLY.*ENTRY|BEFORE.*CLOSE/) ? "EARLY_ENTRY"
      : has(/LATE.*ENTRY/) ? "LATE_ENTRY"
        : has(/WRONG.*ZONE/) ? "WRONG_ZONE"
          : has(/WEAK.*CONFIRM/) ? "WEAK_CONFIRMATION"
            : has(/STOP.*TIGHT/) ? "STOP_TOO_TIGHT"
              : has(/RISK/) ? "RISK_ISSUE"
                : has(/EXECUTION/) ? "EXECUTION_ERROR"
                  : trade.rulesFailed.length ? "RULE_VIOLATION"
                    : trade.outcome === "LOSS" ? "VALID_LOSS"
                      : "NEEDS_REVIEW";
  const completeContext = Boolean(trade.symbol && trade.setupId && trade.timeframe && trade.date);
  return {
    classification,
    dataQuality: completeContext ? "VALID" : "PARTIAL",
    strategyChangeNeeded: classification === "VALID_WIN" || classification === "VALID_LOSS" ? "NO" : "NEED_MORE_DATA",
    conclusion: classification === "VALID_LOSS"
      ? "The recorded rules were followed; one loss is not evidence that a verified strategy should change."
      : classification === "VALID_WIN"
        ? "The result is retained as supporting evidence without assuming every condition caused the win."
        : "The result is retained as behavioral evidence; verified strategy logic remains unchanged.",
  } as const;
}

export async function persistLearningEvidence(service: ScannerStore, userId: string, source: Record<string, unknown>) {
  const trades = normalizeTrades(source);
  const summary = summarizeTrades(trades);
  const learned = trades.filter((trade) => trade.closed && trade.outcome !== "UNKNOWN").map((trade) => ({
    user_id: userId, source_trade_id: trade.id, outcome: trade.outcome,
    r_multiple: trade.rMultiple, setup_id: trade.setupId || null,
    strategy_version_id: trade.strategyVersionId, symbol: trade.symbol || null,
    timeframe: trade.timeframe, session: trade.session, rules_matched: trade.rulesPassed,
    rules_failed: trade.rulesFailed, mistakes: trade.mistakes, strengths: trade.strengths,
    evidence: { pnl: trade.pnl, date: trade.date }, updated_at: new Date().toISOString(),
  }));
  if (learned.length) await service.request("trade_learning_records", { on_conflict: "user_id,source_trade_id" }, "POST", learned, "resolution=merge-duplicates,return=minimal");
  const autopsies = trades.filter((trade) => trade.closed && trade.outcome !== "UNKNOWN").map((trade) => {
    const classification = classifyTradeAutopsy(trade);
    return {
      user_id: userId, trade_id: trade.id, setup_id: trade.setupId || null,
      strategy_version_id: trade.strategyVersionId,
      classification: classification.classification,
      result: { outcome: trade.outcome, pnl: trade.pnl, rMultiple: trade.rMultiple, direction: trade.direction },
      market_context: {
        symbol: trade.symbol, timeframe: trade.timeframe, session: trade.session,
        fourHour: trade.raw.fourHourContext ?? trade.raw.htfBias ?? null,
        oneHour: trade.raw.oneHourContext ?? null, thirtyMinute: trade.raw.thirtyMinuteContext ?? null,
        regime: trade.raw.regime ?? null, news: trade.raw.news ?? null, volatility: trade.raw.volatility ?? null,
      },
      library_rules_used: [...trade.rulesPassed, ...trade.rulesFailed],
      rules_followed: trade.rulesPassed, rules_broken: trade.rulesFailed,
      ai_decisions: Array.isArray(trade.raw.aiDecisions) ? trade.raw.aiDecisions : [],
      lessons: [{ conclusion: classification.conclusion, mistakes: trade.mistakes, strengths: trade.strengths }],
      strategy_change_needed: classification.strategyChangeNeeded,
      data_quality: classification.dataQuality, updated_at: new Date().toISOString(),
    };
  });
  if (autopsies.length) await service.request("onkar_trade_autopsies", { on_conflict: "user_id,trade_id" }, "POST", autopsies, "resolution=merge-duplicates,return=minimal");
  for (const mistake of summary.mistakes) {
    const affected = trades.filter((trade) => trade.closed && trade.mistakes.includes(mistake.name));
    const symbolCounts = new Map<string, number>(), sessionCounts = new Map<string, number>();
    for (const trade of affected) {
      symbolCounts.set(trade.symbol, (symbolCounts.get(trade.symbol) ?? 0) + 1);
      sessionCounts.set(trade.session, (sessionCounts.get(trade.session) ?? 0) + 1);
    }
    const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const totalEffectR = affected.filter((trade) => trade.rMultiple !== null).reduce((sum, trade) => sum + trade.rMultiple!, 0);
    await service.request("onkar_mistake_memory", { on_conflict: "user_id,mistake_key" }, "POST", {
      user_id: userId, mistake_key: mistake.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), title: mistake.name,
      occurrences: mistake.occurrences, total_effect_r: totalEffectR, most_common_symbol: top(symbolCounts),
      most_common_session: top(sessionCounts), trend: mistake.occurrences < 5 ? "INSUFFICIENT" : "STABLE",
      evidence: { losses: mistake.losses, sample: affected.length, tradeIds: affected.map((trade) => trade.id).slice(0, 100) },
      updated_at: new Date().toISOString(),
    }, "resolution=merge-duplicates,return=minimal");
  }
  const insights = deriveLearningInsights(summary).map((insight) => ({ ...insight, user_id: userId, last_confirmed_at: new Date().toISOString() }));
  if (insights.length) await service.request("learning_insights", { on_conflict: "user_id,insight_key" }, "POST", insights, "resolution=merge-duplicates,return=minimal");
  if (autopsies.length) await service.request("onkar_learning_audit", { on_conflict: "user_id,event_key" }, "POST", autopsies.map((autopsy) => ({
    user_id: userId, event_key: `trade:${autopsy.trade_id}:autopsy:${String(autopsy.result.outcome)}`,
    event_type: "TRADE_AUTOPSY_COMPLETED", source_type: "TRADE", source_id: autopsy.trade_id,
    agent: "JOURNAL_AI", title: `Trade ${autopsy.trade_id} autopsy completed`,
    detail: { classification: autopsy.classification, strategyChangeNeeded: autopsy.strategy_change_needed, dataQuality: autopsy.data_quality },
  })), "resolution=ignore-duplicates,return=minimal");
  return { tradesReviewed: learned.length, autopsiesUpdated: autopsies.length, insightsUpdated: insights.length };
}

export async function runNextLearningJob() {
  const service = ScannerStore.service();
  let userId: string | null;
  try {
    userId = await service.rpc<string | null>("claim_onkar_learning_job", {});
  } catch {
    // Keep the existing market scanner healthy while a new migration is being deployed.
    return { status: "unavailable" as const, error: "Learning migration is not installed." };
  }
  if (!userId) return { status: "idle" as const };
  try {
    const result = await persistLearningEvidence(service, userId, await service.source(userId));
    await service.request("onkar_learning_jobs", { user_id: `eq.${userId}` }, "PATCH", { pending: false, locked_until: null, last_run_at: new Date().toISOString(), last_error: null });
    return { status: "complete" as const, userId, ...result };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : "Learning refresh failed";
    await service.request("onkar_learning_jobs", { user_id: `eq.${userId}` }, "PATCH", { pending: true, locked_until: null, next_run_at: new Date(Date.now() + 300_000).toISOString(), last_error: message });
    return { status: "failed" as const, userId, error: message };
  }
}
