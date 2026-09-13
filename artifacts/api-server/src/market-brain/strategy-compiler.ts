import {
  normalizeTimeframe,
  strategyVersionSchema,
  timeframeMs,
  type MachineRule,
  type StrategyVersion,
  type Timeframe,
} from "@workspace/api-zod";

type LibraryRule = { id?: unknown; type?: unknown; content?: unknown };
type LibrarySetup = {
  id?: unknown;
  name?: unknown;
  direction?: unknown;
  timeframe?: unknown;
  customTimeframe?: unknown;
  session?: unknown;
  status?: unknown;
  rules?: unknown;
};

function setupTimeframe(setup: LibrarySetup): Timeframe {
  try {
    return normalizeTimeframe(String(setup.timeframe || setup.customTimeframe || "15m"));
  } catch {
    return "15m";
  }
}

function higherTimeframe(timeframe: Timeframe): Timeframe {
  const available: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"];
  return available.find((item) => timeframeMs[item] > timeframeMs[timeframe]) ?? "1W";
}

function directionOf(value: unknown): "long" | "short" | "both" {
  const normalized = String(value || "").toLowerCase();
  return normalized === "buy" || normalized === "long" ? "long" : normalized === "sell" || normalized === "short" ? "short" : "both";
}

function compileRule(rule: LibraryRule, index: number, timeframe: Timeframe, direction: StrategyVersion["direction"]): MachineRule {
  const content = String(rule.content || "").trim();
  const text = content.toLowerCase();
  const id = String(rule.id || `rule-${index + 1}`).slice(0, 80);
  const base = { id, timeframe, required: String(rule.type || "") !== "note", weight: 10, explanation: content.slice(0, 500) };
  const side = direction === "short" ? "bearish" : "bullish";
  const numeric = Number(text.match(/(?:>=|at least|minimum|min)\s*(\d+(?:\.\d+)?)/)?.[1] || text.match(/(\d+(?:\.\d+)?)\s*(?:r|:1)/)?.[1]);
  if (/news|economic event/.test(text)) return { ...base, feature: "newsSafe", operator: "eq", expected: true };
  if (/risk.?reward|\br\s*:\s*r\b|\brr\b/.test(text)) return { ...base, feature: "rr", operator: "gte", expected: Number.isFinite(numeric) ? numeric : 2 };
  if (/volume/.test(text)) return { ...base, feature: "volumeRatio", operator: "gte", expected: Number.isFinite(numeric) ? numeric : 1 };
  if (/rejection|wick/.test(text)) return { ...base, feature: "rejection", operator: "eq", expected: side };
  if (/engulf/.test(text)) return { ...base, feature: "engulfing", operator: "eq", expected: side };
  if (/liquidity sweep|sweep/.test(text)) return { ...base, feature: "sweep", operator: "eq", expected: side };
  if (/breakout|break of structure|\bbos\b/.test(text)) return { ...base, feature: /structure|bos/.test(text) ? "structure" : "breakout", operator: "eq", expected: side };
  if (/trend|bullish|bearish|higher high|lower low/.test(text)) {
    const expected = /bearish|lower low/.test(text) ? "bearish" : /bullish|higher high/.test(text) ? "bullish" : side;
    return { ...base, feature: "trend", operator: "eq", expected };
  }
  if (/support|resistance|supply|demand|zone/.test(text)) return { ...base, feature: "zoneDistanceATR", operator: "lte", expected: Number.isFinite(numeric) ? numeric : 0.5 };
  if (/open range|room to target|major resistance|major support/.test(text)) return { ...base, feature: "openRangeATR", operator: "gte", expected: Number.isFinite(numeric) ? numeric : 2 };
  if (/rsi/.test(text)) {
    const level = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
    return { ...base, feature: "rsi", operator: /below|under|less/.test(text) ? "lte" : "gte", expected: Number.isFinite(level) ? level : 50 };
  }
  return { ...base, feature: "manualConfirmation", operator: "eq", expected: true, weight: 0 };
}

export function compileLibrarySetup(setup: LibrarySetup): StrategyVersion | null {
  const sourceSetupId = String(setup.id || "").trim();
  const name = String(setup.name || "").trim();
  const rawRules = Array.isArray(setup.rules) ? (setup.rules as LibraryRule[]) : [];
  if (!sourceSetupId || !name || !rawRules.length || String(setup.status || "active") !== "active") return null;
  const timeframe = setupTimeframe(setup);
  if (timeframe === "1W") return null;
  const direction = directionOf(setup.direction);
  const sessions = String(setup.session || "").toLowerCase() === "any" || !setup.session ? [] : [String(setup.session)];
  const rules = rawRules
    .filter((rule) => String(rule.content || "").trim())
    .map((rule, index) => compileRule(rule, index, timeframe, direction));
  if (!rules.length || !rules.some((rule) => rule.weight > 0)) return null;
  return strategyVersionSchema.parse({
    sourceSetupId,
    name,
    direction,
    timeframe,
    higherTimeframe: higherTimeframe(timeframe),
    symbols: [],
    sessions,
    rules,
    approval: "ai_extracted",
    minRR: 2,
    expiresBars: 16,
  });
}
