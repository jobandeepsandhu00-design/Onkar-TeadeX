import test from "node:test";
import assert from "node:assert/strict";
import {
  aiExplanationSchema,
  scannerConfigSchema,
  strategyVersionSchema,
  normalizeTimeframe,
  type Candle,
} from "@workspace/api-zod";
import {
  validClosedBars,
  sma,
  emaSeries,
  rsi,
  indicators,
  marketStructure,
  detectZones,
  priceAction,
  timeframeContext,
  marketSession,
} from "./calculations";
import {
  evaluateRules,
  confluence,
  calculateRisk,
  nextLifecycle,
  historicalMatches,
  analyzeCandidate,
} from "./evaluation";
import { verifyWebhook, secretHash } from "./webhook";
import { accountContext } from "./journal";
import { backtest } from "./backtest";

const bars = (count: number, step = 60_000): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    t: i * step,
    o: 100 + i,
    h: 102 + i,
    l: 99 + i,
    c: 101 + i,
    v: 100,
  }));
const config = scannerConfigSchema.parse({
  symbols: ["BTC-USD"],
  provider: "coinbase",
  accountId: "a",
  risk: { valuePerPriceUnit: { "BTC-USD": 1 } },
});
const strategy = strategyVersionSchema.parse({
  sourceSetupId: "s",
  name: "Test-only rule fixture",
  direction: "long",
  timeframe: "1m",
  higherTimeframe: "5m",
  approval: "approved",
  rules: [
    {
      id: "r",
      feature: "close",
      timeframe: "1m",
      operator: "gt",
      expected: 0,
      required: true,
      weight: 100,
    },
  ],
});
const account = {
  id: "a",
  currency: "USD",
  balance: 100_000,
  dailyLossBase: 100_000,
  dailyPnl: -1000,
  openPositions: 0,
  openRiskMoney: 0,
  valuePerUnit: 1,
};
test("timeframe aliases normalize without silently accepting unsupported intervals", () => {
  assert.equal(normalizeTimeframe("M15"), "15m");
  assert.equal(normalizeTimeframe("H4"), "4h");
  assert.throws(() => normalizeTimeframe("2m"));
});
test("candle ingestion deduplicates and excludes unfinished candles", () => {
  const b = bars(4);
  assert.equal(validClosedBars([...b, b[0]], "1m", 180_000).length, 3);
  assert.throws(() => validClosedBars([{ ...b[0], h: 1 }], "1m", 180_000));
});
test("SMA and seeded EMA calculations", () => {
  assert.equal(sma([1, 2, 3], 3), 2);
  assert.deepEqual(emaSeries([1, 2, 3, 4], 3), [null, null, 2, 3]);
});
test("RSI warmup, monotonic, declining and flat data", () => {
  assert.equal(rsi([1, 2]), null);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i)), 100);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => 30 - i)), 0);
  assert.equal(rsi(Array(20).fill(3)), 50);
});
test("ATR, Bollinger and missing volume are deterministic", () => {
  const b = bars(250);
  const result = indicators(b);
  assert.equal(result.atr, 3);
  assert.ok(result.bollinger!.upper > result.bollinger!.middle);
  assert.equal(result.volumeRatio, 1);
  assert.equal(indicators(b.map((c) => ({ ...c, v: null }))).volumeRatio, null);
});
test("swing needs two completed right-side candles, preventing look-ahead", () => {
  const b = bars(6).map((c, i) => ({
    ...c,
    h: [102, 105, 112, 108, 106, 110][i],
  }));
  assert.equal(
    marketStructure(b.slice(0, 4)).swings.filter((s) => s.type === "high")
      .length,
    0,
  );
  assert.equal(
    marketStructure(b.slice(0, 5)).swings.find((s) => s.type === "high")?.t,
    120_000,
  );
});
test("zone invalidation is retained after the price returns", () => {
  const b = bars(15).map((c, i) => ({
    ...c,
    o: 100,
    c: i === 10 ? 111 : 100,
    h: i === 4 ? 110 : i === 10 ? 112 : 103,
    l: 99,
  }));
  const z = detectZones(b, 2).find((z) => z.id === "high:240000");
  assert.equal(z?.invalidated, true);
});
test("rejection wick is calculated from real candle geometry", () => {
  const b = [
    ...bars(20),
    { t: 1_200_000, o: 110, c: 112, l: 100, h: 113, v: 100 },
  ];
  assert.equal(priceAction(b).rejection, "bullish");
});
test("missing rule data fails even for not-equal; score is weighted", () => {
  const rules = evaluateRules(
    {
      ...strategy,
      rules: [
        { ...strategy.rules[0], feature: "volumeRatio", operator: "neq" },
      ],
    },
    {},
    {},
  );
  assert.equal(rules[0].passed, false);
  assert.equal(confluence(rules).score, 0);
  assert.equal(
    confluence([
      { ...rules[0], passed: true, weight: 75 },
      { ...rules[0], weight: 25 },
    ]).score,
    75,
  );
});
test("risk uses selected 100K account, not 1K fallback; conservative limits", () => {
  const r = calculateRisk(100, 99, 102, "long", account, config.risk);
  assert.equal(r.monetaryRisk, 1000);
  assert.equal(r.allowed, true);
  assert.equal(r.executionEnabled, false);
  assert.equal(
    calculateRisk(
      100,
      99,
      102,
      "long",
      { ...account, dailyPnl: -3000 },
      config.risk,
    ).allowed,
    false,
  );
  assert.equal(
    calculateRisk(100, 99, 102, "long", null, config.risk).allowed,
    false,
  );
});
test("proposed loss must fit the account's remaining daily allowance", () => {
  const result = calculateRisk(
    100,
    99,
    102,
    "long",
    {
      ...account,
      dailyPnl: -2500,
      openRiskMoney: 0,
    },
    config.risk,
  );
  assert.equal(result.allowed, false);
  assert.ok(
    result.warnings.some((warning) => warning.includes("remaining daily")),
  );
  const withExposure = calculateRisk(
    100,
    99,
    102,
    "long",
    {
      ...account,
      dailyPnl: -1500,
      openRiskMoney: 600,
    },
    config.risk,
  );
  assert.equal(withExposure.allowed, false);
});
test("risk blocks unknown open exposure and missing contract conversion", () => {
  assert.equal(
    calculateRisk(
      100,
      99,
      102,
      "long",
      { ...account, openRiskMoney: null },
      config.risk,
    ).allowed,
    false,
  );
  assert.equal(
    calculateRisk(
      100,
      99,
      102,
      "long",
      { ...account, valuePerUnit: null },
      config.risk,
    ).allowed,
    false,
  );
});
test("journal sums each account trade once including fees", () => {
  const source = {
    account: { startingBalance: 1000 },
    tradingAccounts: [{ id: "a", balance: 100_000, currency: "USD" }],
    trades: [
      { id: "t", accountId: "a", manualPnl: -1000, date: "2026-09-10" },
      { id: "u", accountId: "other", manualPnl: -8000 },
    ],
  };
  const a = accountContext(
    source,
    config,
    "BTC-USD",
    Date.parse("2026-09-10T10:00:00Z"),
  );
  assert.equal(a?.balance, 99_000);
  assert.equal(a?.dailyPnl, -1000);
});
test("READY triggers, ambiguity is pessimistic, terminal states never resurrect", () => {
  const b = { t: 0, o: 100, c: 100, h: 103, l: 98, v: 10 };
  const plan = { entry: 100, stop: 99, target: 102 };
  assert.equal(
    nextLifecycle("TRIGGERED", b, plan, "long", 9999, 100).state,
    "INVALIDATED",
  );
  assert.equal(
    nextLifecycle("COMPLETED", b, plan, "long", 9999, 100).state,
    "COMPLETED",
  );
  assert.equal(
    nextLifecycle("WATCH", { ...b, l: 100 }, plan, "long", 50, 100).state,
    "EXPIRED",
  );
});
test("news unavailable cannot silently become READY", () => {
  const history = { "1m": bars(500), "5m": bars(100, 300_000) };
  const a = analyzeCandidate(
    strategy,
    history,
    config,
    account,
    {
      status: "unavailable",
      checkedAt: new Date(30_000_000).toISOString(),
      events: [],
    },
    30_000_000,
  );
  assert.notEqual(a.status, "READY");
});
test("stale data is flagged", () => {
  assert.equal(timeframeContext(bars(40), "1m", 10_000_000).stale, true);
});
test("London session observes DST rather than a fixed UTC offset", () => {
  assert.equal(marketSession(Date.parse("2026-07-06T07:30:00Z")), "London");
  assert.equal(marketSession(Date.parse("2026-01-05T07:30:00Z")), "Asia");
});
test("historical comparison normalizes timeframe, scopes account, reports sample", () => {
  const h = historicalMatches(
    [
      {
        id: "t",
        setupId: "s",
        symbol: "BTCUSD",
        timeframe: "M15",
        accountId: "a",
        exit: 100,
        netPnl: -20,
      },
      {
        id: "u",
        setupId: "s",
        symbol: "BTCUSD",
        timeframe: "M15",
        accountId: "b",
        exit: 100,
        netPnl: 100,
      },
    ],
    "s",
    "BTC-USD",
    "15m",
    "a",
  );
  assert.equal(h.sample, 1);
  assert.equal(h.wins, 0);
  assert.match(h.caution, /Small/);
});
test("TradingView verifies secret and replay window, strips secret", () => {
  const secret = "s".repeat(64),
    now = Date.now(),
    event = {
      eventId: "event-12345",
      timestamp: new Date(now).toISOString(),
      symbol: "BTC-USD",
      timeframe: "1m",
      event: "breakout",
      price: 100,
      secret,
    };
  assert.ok(verifyWebhook(event, secretHash(secret), now));
  assert.equal(verifyWebhook(event, secretHash("wrong"), now), null);
  assert.equal(verifyWebhook(event, secretHash(secret), now + 301_000), null);
  assert.equal(
    "secret" in verifyWebhook(event, secretHash(secret), now)!,
    false,
  );
});
test("AI schema rejects invented numeric scores and malformed output", () => {
  const output = {
    summary: "Observed",
    why: [],
    whyNot: [],
    missing: [],
    invalidation: "Below stop",
    educationalLesson: "Review rules",
  };
  assert.ok(aiExplanationSchema.safeParse(output).success);
  assert.equal(
    aiExplanationSchema.safeParse({ ...output, score: 99 }).success,
    false,
  );
});
test("backtest prefix is unchanged when future candles are appended", () => {
  const from = 20_000_000,
    to = 29_999_999;
  const history = { "1m": bars(500), "5m": bars(100, 300_000) };
  const a = backtest(
    strategy,
    history,
    { ...config, requireNews: false },
    account,
    from,
    to,
  );
  const b = backtest(
    strategy,
    { "1m": bars(800), "5m": bars(160, 300_000) },
    { ...config, requireNews: false },
    account,
    from,
    to,
  );
  assert.deepEqual(a, b);
  assert.equal(a.source, "simulated");
});
test("replay never sees a higher-timeframe candle before its close", () => {
  const s = {
    ...strategy,
    rules: [{ ...strategy.rules[0], timeframe: "5m" as const, expected: 180 }],
  };
  const result = backtest(
    s,
    { "1m": bars(500), "5m": bars(200, 300_000) },
    { ...config, requireNews: false },
    account,
    20_000_000,
    29_999_999,
  );
  assert.ok(result.signals.length > 30);
  assert.ok(
    result.signals.filter((s) => s.at < 24_300_000).every((s) => s.score === 0),
  );
});
