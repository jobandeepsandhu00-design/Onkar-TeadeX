import { ScannerStore } from "../market-brain/store";
import { deriveLearningInsights, normalizeTrades, summarizeTrades } from "./learning";

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
  const insights = deriveLearningInsights(summary).map((insight) => ({ ...insight, user_id: userId, last_confirmed_at: new Date().toISOString() }));
  if (insights.length) await service.request("learning_insights", { on_conflict: "user_id,insight_key" }, "POST", insights, "resolution=merge-duplicates,return=minimal");
  return { tradesReviewed: learned.length, insightsUpdated: insights.length };
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
