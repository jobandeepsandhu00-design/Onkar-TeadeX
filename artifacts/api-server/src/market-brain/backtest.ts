import {
  timeframeMs,
  type Candle,
  type ScannerConfig,
  type StrategyVersion,
  type Timeframe,
} from "@workspace/api-zod";
import {
  analyzeCandidate,
  type AccountContext,
  type NewsCheck,
} from "./evaluation";

export type BacktestResult = ReturnType<typeof backtest>;
/** Replay closed bars only. Fill on subsequent bars; stop-first on ambiguous OHLC.
 * This is explicitly a simulation, with no broker execution or claimed live returns.
 */
export function backtest(
  strategy: StrategyVersion,
  histories: Partial<Record<Timeframe, Candle[]>>,
  config: ScannerConfig,
  account: AccountContext | null,
  from: number,
  to: number,
  historicalNews: (at: number) => NewsCheck = (at) => ({
    status: "unavailable",
    checkedAt: new Date(at).toISOString(),
    events: [],
  }),
) {
  const primary = histories[strategy.timeframe] ?? [],
    duration = timeframeMs[strategy.timeframe];
  const results: Array<{
    signalAt: number;
    entryAt: number;
    exitAt: number;
    r: number;
    outcome: "win" | "loss";
  }> = [];
  const signals: Array<{ at: number; score: number; state: string }> = [];
  let plan: {
    entry: number;
    stop: number;
    target: number;
    direction: "long" | "short";
    signalAt: number;
    expires: number;
    entryAt: number | null;
  } | null = null;
  for (const bar of primary) {
    const now = bar.t + duration;
    if (now < from || now > to) continue;
    if (plan) {
      if (plan.entryAt === null && now > plan.expires) {
        plan = null;
        continue;
      }
      // A plan cannot be filled by the candle that produced it.
      if (bar.t < plan.signalAt) continue;
      const stop =
        plan.direction === "long" ? bar.l <= plan.stop : bar.h >= plan.stop;
      const target =
        plan.direction === "long" ? bar.h >= plan.target : bar.l <= plan.target;
      const entry = bar.l <= plan.entry && bar.h >= plan.entry;
      if (plan.entryAt === null && stop) {
        plan = null;
        continue;
      } // invalid before observable confirmation
      if (plan.entryAt === null && entry) {
        plan.entryAt = bar.t;
        continue;
      } // conservative: ignore same-bar target
      if (plan.entryAt !== null && (stop || target)) {
        const r = stop
          ? -1
          : Math.abs(plan.target - plan.entry) /
            Math.abs(plan.entry - plan.stop);
        results.push({
          signalAt: plan.signalAt,
          entryAt: plan.entryAt,
          exitAt: now,
          r,
          outcome: r > 0 ? "win" : "loss",
        });
        plan = null;
      }
      continue;
    }
    const available: Partial<Record<Timeframe, Candle[]>> = {};
    for (const [tf, bars] of Object.entries(histories))
      available[tf as Timeframe] = bars!
        .filter((b) => b.t + timeframeMs[tf as Timeframe] <= now)
        .slice(-260);
    try {
      const a = analyzeCandidate(
        strategy,
        available,
        config,
        account,
        historicalNews(now),
        now,
      );
      signals.push({ at: now, score: a.score, state: a.status });
      if (a.status === "READY")
        plan = {
          entry: a.risk.entry,
          stop: a.risk.stop,
          target: a.risk.target,
          direction: a.direction,
          signalAt: now,
          expires: now + strategy.expiresBars * duration,
          entryAt: null,
        };
    } catch {
      /* missing warmup: no signal */
    }
  }
  const wins = results.filter((r) => r.r > 0),
    losses = results.filter((r) => r.r < 0),
    gross = wins.reduce((s, r) => s + r.r, 0);
  let equityR = 0,
    peak = 0,
    maxDrawdownR = 0;
  for (const r of results) {
    equityR += r.r;
    peak = Math.max(peak, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equityR);
  }
  return {
    source: "simulated" as const,
    model: "closed_candle_limit_entry_stop_first_v1",
    signals,
    results,
    count: results.length,
    wins: wins.length,
    losses: losses.length,
    winRate: results.length ? (wins.length / results.length) * 100 : null,
    averageR: results.length ? equityR / results.length : null,
    expectancyR: results.length ? equityR / results.length : null,
    profitFactor: losses.length ? gross / losses.length : null,
    maxDrawdownR,
    unfinished: plan !== null,
    warnings: [
      "Simulation, not live performance. No spread, commission, slippage or intrabar sequencing model.",
      "Historical news is unavailable unless supplied; requireNews prevents READY by default.",
      "Static configured account risk is used; this is not an account-equity backtest.",
    ],
  };
}
