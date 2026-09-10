import type { ScannerConfig } from "@workspace/api-zod";
import type { AccountContext } from "./evaluation";
import { numeric as n, records } from "./store";

/** Broker P&L is authoritative. No implicit FX conversion or contract-size guess. */
export function journalPnl(
  t: Record<string, unknown>,
  values: Record<string, number>,
): number | null {
  if (n(t.netPnl) !== null) return n(t.netPnl);
  const manual = n(t.manualPnl) ?? n(t.pnl);
  const entry = n(t.entry),
    exit = n(t.exit),
    size = n(t.positionSize),
    unit = values[String(t.symbol)];
  const gross =
    manual ??
    (entry !== null && exit !== null && size !== null && unit
      ? (exit - entry) * (t.side === "Sell" ? -1 : 1) * size * unit
      : null);
  return gross === null
    ? null
    : gross - (n(t.fees) ?? 0) - (n(t.commission) ?? 0);
}
export function accountContext(
  source: Record<string, unknown>,
  config: ScannerConfig,
  symbol: string,
  now: number,
): AccountContext | null {
  const id = config.accountId; // No global/fallback balance and no implicit account switching.
  const account = records(source.tradingAccounts).find((a) => a.id === id);
  if (!account || !id) return null;
  const trades = records(source.trades).filter((t) => t.accountId === id);
  const closed = trades.filter(
    (t) =>
      n(t.exit) !== null || n(t.manualPnl) !== null || n(t.netPnl) !== null,
  );
  const pnls = closed.map((t) => journalPnl(t, config.risk.valuePerPriceUnit));
  if (pnls.some((p) => p === null) || n(account.balance) === null) return null;
  const balance =
    n(account.balance)! + pnls.reduce<number>((sum, p) => sum + (p ?? 0), 0);
  const today = new Date(now).toISOString().slice(0, 10);
  const dailyPnl = closed.reduce(
    (sum, t, i) =>
      sum +
      (String(t.exitDate || t.date).slice(0, 10) === today
        ? (pnls[i] ?? 0)
        : 0),
    0,
  );
  const open = trades.filter((t) => !closed.includes(t));
  let openRiskMoney: number | null = 0;
  for (const t of open) {
    const entry = n(t.entry),
      stop = n(t.sl),
      size = n(t.positionSize),
      unit = config.risk.valuePerPriceUnit[String(t.symbol)];
    if (entry === null || stop === null || !size || !unit) {
      openRiskMoney = null;
      break;
    }
    openRiskMoney += Math.abs(entry - stop) * size * unit;
  }
  const challenge = records(source.propChallenges).find(
    (c) => c.accountId === id,
  );
  return {
    id,
    currency: String(account.currency || "USD"),
    balance,
    dailyPnl,
    dailyLossBase: n(challenge?.accountSize) ?? balance - dailyPnl,
    dailyLossPercent:
      n(challenge?.maxDailyLossPct) ??
      n(account.dailyLossLimitPct) ??
      config.risk.maxDailyLossPercent,
    openPositions: open.length,
    openRiskMoney,
    valuePerUnit: config.risk.valuePerPriceUnit[symbol] ?? null,
  };
}
export function journalSummary(
  source: Record<string, unknown>,
  config: ScannerConfig,
) {
  const trades = records(source.trades).filter(
    (t) => config.accountId && t.accountId === config.accountId,
  );
  const closed = trades
    .map((t) => ({
      ...t,
      netPnl: journalPnl(t, config.risk.valuePerPriceUnit),
    }))
    .filter((t) => t.netPnl !== null);
  const wins = closed.filter((t) => t.netPnl! > 0),
    losses = closed.filter((t) => t.netPnl! < 0);
  const grouped = (field: string) =>
    [
      ...new Set(
        closed.map((t) =>
          String((t as Record<string, unknown>)[field] || "Unspecified"),
        ),
      ),
    ].map((key) => {
      const sample = closed.filter(
        (t) =>
          String((t as Record<string, unknown>)[field] || "Unspecified") ===
          key,
      );
      return {
        key,
        count: sample.length,
        pnl: sample.reduce((s, t) => s + t.netPnl!, 0),
        wins: sample.filter((t) => t.netPnl! > 0).length,
      };
    });
  return {
    accountId: config.accountId,
    trades: trades.length,
    knownPnl: closed.length,
    wins: wins.length,
    losses: losses.length,
    pnl: closed.reduce((s, t) => s + t.netPnl!, 0),
    bySetup: grouped("setupId"),
    bySession: grouped("session"),
    byTimeframe: grouped("timeframe"),
    caution:
      "Only recorded evidence is compared. Psychology or intent is never inferred from a loss alone.",
  };
}
