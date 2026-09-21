import type { OnkarAgentId } from "@workspace/api-zod";

export type MasterIntent =
  | "journal_review"
  | "best_setup"
  | "last_trade"
  | "similar_trades"
  | "strategy_question"
  | "backtest"
  | "risk"
  | "live_market"
  | "general";
export type MasterPlan = {
  intent: MasterIntent;
  agents: OnkarAgentId[];
  symbol?: string;
  timeframe?: string;
  needsOpenAI: boolean;
};

const SYMBOL =
  /\b(XAUUSD|EURUSD|GBPUSD|USDJPY|AUDUSD|NZDUSD|USDCAD|USDCHF|NAS100|US30|GER40|BTCUSD|ETHUSD|GBPJPY)\b/i;
const TIMEFRAME = /\b(1m|5m|15m|30m|1h|4h|1d|1w)\b/i;

export function planMasterRequest(question: string): MasterPlan {
  const q = question.toLowerCase();
  const symbol = question.match(SYMBOL)?.[1]?.toUpperCase();
  const timeframe = question.match(TIMEFRAME)?.[1];
  const base = { symbol, timeframe, needsOpenAI: true };
  if (
    /why.*(los|loss)|biggest (problem|mistake|weakness)|mistakes?.*repeat|performance|last 30 trades/.test(
      q,
    )
  )
    return {
      ...base,
      intent: "journal_review",
      agents: ["journal", "insight"],
    };
  if (/best (setup|strategy)|setup works best|most profitable setup/.test(q))
    return {
      ...base,
      intent: "best_setup",
      agents: ["journal", "setup", "insight"],
    };
  if (/last .*trade|trade.*last|why did.*trade/.test(q))
    return {
      ...base,
      intent: "last_trade",
      agents: ["journal", "setup", "insight"],
    };
  if (/similar trades?|find.*examples?|best .* examples?/.test(q))
    return {
      ...base,
      intent: "similar_trades",
      agents: ["journal", "setup", "insight"],
    };
  if (/strategy|rules?|library|valid setup|video|lesson|knowledge|learned|conflict|confirmation/.test(q))
    return {
      ...base,
      intent: "strategy_question",
      agents: ["setup", "insight"],
    };
  if (/backtest|historical simulation/.test(q))
    return {
      ...base,
      intent: "backtest",
      agents: ["backtest", "setup", "insight"],
    };
  if (/risk|position size|exposure|drawdown/.test(q))
    return { ...base, intent: "risk", agents: ["risk", "journal", "insight"] };
  if (symbol || /analy[sz]e (the )?market|setup right now|scan/.test(q))
    return {
      ...base,
      intent: "live_market",
      agents: [
        "trend",
        "zone",
        "setup",
        "risk",
        "news",
        "backtest",
        "journal",
        "execution",
        "insight",
      ],
    };
  return {
    ...base,
    intent: "general",
    agents: ["journal", "setup", "insight"],
  };
}
