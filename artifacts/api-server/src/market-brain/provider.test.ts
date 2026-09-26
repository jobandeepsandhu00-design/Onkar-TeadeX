import test from "node:test";
import assert from "node:assert/strict";
import { CoinbaseProvider, TwelveDataProvider } from "./providers";
import {
  candidateMatchesProviderAccount,
  mt5CandleBundleSchema,
  mt5SnapshotMatchesSelectedAccount,
  scannerConfigSchema,
  sharedMarketSnapshotSchema,
  type ScannerCandidate,
  type Timeframe,
} from "@workspace/api-zod";
import { indicators, marketStructure, detectZones } from "./calculations";
import {
  configuredPrimary,
  selectScannerMarketProvider,
} from "./provider-selection";
import {
  closedCandleCacheMs,
  filterVerifiedMT5ChartCandidates,
  latestClosedCandleOpenTime,
  mapDetection,
  mt5BundleMarketEntries,
  mt5ChartContextMatches,
  sharedProviderCandles,
} from "./shared-market";
import type { CandidateRow, ScannerStore } from "./store";
import { getMarketProvider } from "./providers";
import type {
  MT5AccountBinding,
  MT5CandidateProvenance,
} from "../mt5/account-identity";

test("scanner candle cache refreshes just after the next timeframe close", () => {
  const now = Date.UTC(2026, 8, 21, 9, 7, 0);
  assert.equal(closedCandleCacheMs("30m", now), 23 * 60_000 + 15_000);
  assert.equal(closedCandleCacheMs("1h", now), 53 * 60_000 + 15_000);
  assert.equal(
    closedCandleCacheMs("4h", now),
    2 * 60 * 60_000 + 53 * 60_000 + 15_000,
  );
});

test("durable scanner cache targets the latest fully closed candle", () => {
  const beforeGrace = Date.UTC(2026, 8, 21, 10, 30, 10);
  const afterGrace = Date.UTC(2026, 8, 21, 10, 30, 20);
  assert.equal(
    latestClosedCandleOpenTime("30m", beforeGrace),
    Date.UTC(2026, 8, 21, 9, 30),
  );
  assert.equal(
    latestClosedCandleOpenTime("30m", afterGrace),
    Date.UTC(2026, 8, 21, 10, 0),
  );
});

test("a saved provider selection overrides the deployment default", () => {
  const previous = process.env.PRIMARY_MARKET_PROVIDER;
  process.env.PRIMARY_MARKET_PROVIDER = "mt5";
  try {
    assert.equal(configuredPrimary("twelvedata"), "twelvedata");
    assert.equal(configuredPrimary(undefined), "mt5");
  } finally {
    if (previous === undefined) delete process.env.PRIMARY_MARKET_PROVIDER;
    else process.env.PRIMARY_MARKET_PROVIDER = previous;
  }
});

test("MT5 scanner mode never falls back to Twelve Data", async () => {
  const previous = process.env.MARKET_DATA_FALLBACK_ENABLED;
  process.env.MARKET_DATA_FALLBACK_ENABLED = "true";
  const healthChecks: string[] = [];
  const providerFactory = ((name: string) => ({
    name,
    capabilities: { quotes: true, websocket: false, historical: true },
    getSymbols: async () => [],
    getHistoricalBars: async () => [],
    getQuote: async () => ({ price: 1, timestamp: new Date().toISOString() }),
    getMarketStatus: async () => "unknown" as const,
    reconnect: async () => undefined,
    healthCheck: async () => {
      healthChecks.push(name);
      return {
        status: name === "mt5" ? ("offline" as const) : ("connected" as const),
        checkedAt: new Date().toISOString(),
        latencyMs: 1,
        message: `${name} status`,
      };
    },
  })) as typeof getMarketProvider;
  try {
    await assert.rejects(
      () => selectScannerMarketProvider("mt5", providerFactory),
      /never falls back to Twelve Data/,
    );
    assert.deepEqual(healthChecks, ["mt5"]);
  } finally {
    if (previous === undefined) delete process.env.MARKET_DATA_FALLBACK_ENABLED;
    else process.env.MARKET_DATA_FALLBACK_ENABLED = previous;
  }
});

test("MT5 chart entries are projected only from the atomic broker bundle", () => {
  const candle = (time: number, isClosed: boolean) => ({
    time,
    open: 2_000,
    high: 2_002,
    low: 1_999,
    close: 2_001,
    tick_volume: 10,
    spread: 2,
    real_volume: 0,
    isClosed,
    candleId: `scope:XAUUSDm:30m:${time}`,
  });
  const bundle = mt5CandleBundleSchema.parse({
    account: {
      connection: "CONNECTED",
      broker: "Broker",
      server: "Demo",
      account: "****1234",
      accountType: "DEMO",
      currency: "USD",
      balance: 10_000,
      equity: 10_000,
      margin: 0,
      freeMargin: 10_000,
      marginLevel: null,
      tradeAllowed: true,
      terminalConnected: true,
      tradeApiDisabled: false,
      tradingEnabled: true,
      liveTradingAllowed: false,
      accountFingerprint: "a".repeat(64),
    },
    symbol: {
      internalSymbol: "XAU/USD",
      brokerSymbol: "XAUUSDm",
      tick: {
        symbol: "XAU/USD",
        brokerSymbol: "XAUUSDm",
        bid: 2_001,
        ask: 2_001.2,
        last: 0,
        timestamp: Date.now(),
        spread: 0.2,
        tickVolume: 1,
        state: "CONNECTED",
        approximateLatencyMs: 1,
      },
      spec: {
        symbol: "XAU/USD",
        brokerSymbol: "XAUUSDm",
        digits: 2,
        point: 0.01,
        tickSize: 0.01,
        tickValue: 1,
        tickValueProfit: 1,
        tickValueLoss: 1,
        contractSize: 100,
        volumeMin: 0.01,
        volumeMax: 100,
        volumeStep: 0.01,
        stopsLevel: 10,
        fillingMode: 2,
        executionMode: 2,
        tradeMode: 1,
      },
    },
    requestedTimeframes: ["30m", "1h", "4h"],
    timeframes: {
      "30m": [candle(1_000, true), candle(2_800, false)],
      "1h": [candle(1_000, true)],
      "4h": [candle(1_000, true)],
    },
    capturedAt: Date.now(),
  });

  const entries = mt5BundleMarketEntries(
    bundle,
    new Set<Timeframe>(["30m", "1h", "4h"]),
  );
  const selected = new Map(entries).get("30m");
  assert.deepEqual(
    selected?.candles.map((row) => row.o),
    [2_000, 2_000],
  );
  assert.deepEqual(
    selected?.candles.map((row) => row.closed),
    [true, false],
  );
});

test("approved Setup Library versions auto-activate by default", () => {
  const config = scannerConfigSchema.parse({});
  assert.equal(config.autoActivateApprovedSetups, true);
  assert.deepEqual(config.strategyVersionIds, []);
});
test("chart labels trade levels only after a server-approved risk plan exists", () => {
  const decisionCandleAt = new Date(Date.now() - 60 * 60_000).toISOString();
  const candidate = {
    id: "candidate",
    symbol: "XAUUSD",
    timeframe: "30m",
    state: "WATCH",
    score: 70,
    payload: {
      strategyName: "Fakeout at S/R",
      direction: "long",
      stale: false,
      lastCandleAt: decisionCandleAt,
      analyzedAt: new Date().toISOString(),
      passed: 7,
      total: 10,
      rules: [],
      entryZone: { low: 4300, high: 4305 },
      invalidation: 4290,
      targets: [4330],
      risk: { rr: 2 },
      warnings: [],
    },
    plan: null,
    last_candle_at: decisionCandleAt,
  } as unknown as CandidateRow;
  const partial = mapDetection(candidate);
  assert.equal(partial.decisionCandleAt, decisionCandleAt);
  assert.equal(partial.entry, null);
  assert.equal(partial.stopLoss, null);
  assert.equal(partial.takeProfit, null);
  assert.equal(partial.riskReward, null);
  assert.ok(partial.zones.some((zone) => zone.kind === "entry"));

  candidate.state = "READY";
  candidate.plan = {
    entry: 4304,
    stop: 4290,
    target: 4332,
    rr: 2,
  } as CandidateRow["plan"];
  const ready = mapDetection(candidate);
  assert.equal(ready.entry, 4304);
  assert.equal(ready.stopLoss, 4290);
  assert.equal(ready.takeProfit, 4332);
  assert.equal(ready.riskReward, 2);
});
test("strict MT5 chart data ignores durable rows and returns only current broker candles", async () => {
  const now = Date.UTC(2026, 8, 21, 12, 7, 0);
  let reads = 0;
  const writes: unknown[] = [];
  const store = {
    request: async <T>(
      _table: string,
      _query?: Record<string, unknown>,
      method = "GET",
      body?: unknown,
    ): Promise<T> => {
      if (method === "POST") {
        writes.push(body);
        return [] as T;
      }
      reads += 1;
      return [
        {
          open_time: Date.UTC(2026, 8, 21, 11, 0),
          o: 100,
          h: 101,
          l: 99,
          c: 100.5,
          v: 1,
        },
      ] as T;
    },
  } as unknown as ScannerStore;
  const brokerCandles = [
    {
      t: Date.UTC(2026, 8, 21, 11, 30),
      o: 200,
      h: 204,
      l: 198,
      c: 203,
      v: 10,
    },
    {
      t: Date.UTC(2026, 8, 21, 12, 0),
      o: 203,
      h: 205,
      l: 202,
      c: 204,
      v: 4,
    },
  ];
  const nextBrokerCandles = brokerCandles.map((candle) => ({
    ...candle,
    o: candle.o + 100,
    h: candle.h + 100,
    l: candle.l + 100,
    c: candle.c + 100,
  }));
  let providerFetches = 0;
  const providerFactory = (() => ({
    name: "mt5",
    capabilities: { quotes: true, websocket: false, historical: true },
    getSymbols: async () => [],
    getQuote: async () => ({
      price: 204,
      timestamp: new Date(now).toISOString(),
    }),
    getHistoricalBars: async () => brokerCandles.slice(0, 1),
    getBarsIncludingOpen: async () => {
      providerFetches += 1;
      return providerFetches === 1 ? brokerCandles : nextBrokerCandles;
    },
    getMarketStatus: async () => "open" as const,
    reconnect: async () => undefined,
    healthCheck: async () => ({
      status: "connected" as const,
      checkedAt: new Date(now).toISOString(),
      latencyMs: 1,
      message: "connected",
    }),
  })) as typeof getMarketProvider;

  const result = await sharedProviderCandles(
    store,
    "mt5",
    "STRICTXAUUSD",
    "30m",
    now,
    {
      cacheMode: "live",
      strictSource: true,
      providerFactory,
    },
  );

  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
  assert.deepEqual(
    result.candles.map((candle) => candle.o),
    [200, 203],
  );
  assert.equal(result.candles[0].closed, true);
  assert.equal(result.candles[1].closed, false);

  // A same-key strict request must contact MT5 again. The connected account or
  // broker server may have changed between these calls, so the former broker's
  // candles cannot be served from a process-level cache.
  const refreshed = await sharedProviderCandles(
    store,
    "mt5",
    "STRICTXAUUSD",
    "30m",
    now,
    {
      cacheMode: "live",
      strictSource: true,
      providerFactory,
    },
  );
  assert.equal(providerFetches, 2);
  assert.deepEqual(
    refreshed.candles.map((candle) => candle.o),
    [300, 303],
  );
});
test("an MT5 chart snapshot requires one account and broker mapping for the complete read", () => {
  const binding: MT5AccountBinding = {
    selected_account_id: "account-a",
    account_fingerprint: "a".repeat(64),
  };
  const verified = {
    binding,
    selectedAccountId: "account-a",
    beforeFingerprint: "a".repeat(64),
    afterFingerprint: "a".repeat(64),
    beforeBrokerSymbol: "XAUUSD.a",
    afterBrokerSymbol: "XAUUSD.a",
    quoteBrokerSymbol: "XAUUSD.a",
  };
  assert.equal(mt5ChartContextMatches(verified), true);
  assert.equal(
    mt5ChartContextMatches({
      ...verified,
      afterFingerprint: "b".repeat(64),
    }),
    false,
  );
  assert.equal(
    mt5ChartContextMatches({
      ...verified,
      afterBrokerSymbol: "XAUUSD.pro",
    }),
    false,
  );
  assert.equal(
    mt5ChartContextMatches({
      ...verified,
      quoteBrokerSymbol: "XAUUSD.pro",
    }),
    false,
  );
});

test("MT5 chart detections keep only exact account, candle and broker-symbol provenance", () => {
  const fingerprint = "a".repeat(64);
  const binding: MT5AccountBinding = {
    selected_account_id: "account-a",
    account_fingerprint: fingerprint,
  };
  const candidate = (id: string, accountId: string, candleAt: string) =>
    ({
      id,
      symbol: "XAUUSD",
      timeframe: "30m",
      state: "READY",
      payload: { provider: "mt5", scopeAccountId: accountId },
      last_candle_at: candleAt,
    }) as CandidateRow;
  const candleAt = "2026-09-25T12:00:00.000Z";
  const candidates = [
    candidate("same-account", "account-a", candleAt),
    candidate("other-account", "account-b", candleAt),
    candidate("other-candle", "account-a", candleAt),
    candidate("other-symbol-map", "account-a", candleAt),
  ];
  const provenance = (
    candidateId: string,
    overrides: Partial<MT5CandidateProvenance> = {},
  ): MT5CandidateProvenance => ({
    candidate_id: candidateId,
    candidate_last_candle_at: candleAt,
    selected_account_id: "account-a",
    account_fingerprint: fingerprint,
    broker_symbol: "XAUUSD.a",
    ...overrides,
  });
  const result = filterVerifiedMT5ChartCandidates({
    candidates,
    provenances: [
      provenance("same-account"),
      provenance("other-account"),
      provenance("other-candle", {
        candidate_last_candle_at: "2026-09-25T11:30:00.000Z",
      }),
      provenance("other-symbol-map", { broker_symbol: "XAUUSD.pro" }),
    ],
    context: {
      selectedAccountId: "account-a",
      accountFingerprint: fingerprint,
      brokerSymbol: "XAUUSD.a",
      binding,
    },
  });
  assert.deepEqual(
    result.map((item) => item.id),
    ["same-account"],
  );
});

test("browser chart guards invalidate MT5 candidates and overlays after an account switch", () => {
  const snapshot = sharedMarketSnapshotSchema.parse({
    symbol: "XAUUSD",
    displaySymbol: "XAU/USD",
    timeframe: "30m",
    provider: "mt5",
    dataSource: "broker",
    dataStatus: "live",
    fetchedAt: "2026-09-25T12:00:00.000Z",
    scopeAccountId: "account-a",
    accountIdentityVerified: true,
    candles: [],
    detections: [],
    workflow: null,
    warnings: [],
    source: [],
  });
  const candidate = {
    payload: { provider: "mt5", scopeAccountId: "account-a" },
  } as unknown as ScannerCandidate;
  assert.equal(mt5SnapshotMatchesSelectedAccount(snapshot, "account-a"), true);
  assert.equal(mt5SnapshotMatchesSelectedAccount(snapshot, "account-b"), false);
  assert.equal(
    candidateMatchesProviderAccount(candidate, "mt5", "account-a"),
    true,
  );
  assert.equal(
    candidateMatchesProviderAccount(candidate, "mt5", "account-b"),
    false,
  );
});
test("Twelve Data requests continue sharing the provider snapshot cache", async () => {
  const now = Date.UTC(2026, 8, 21, 12, 7, 0);
  const store = {
    request: async <T>(
      _table: string,
      _query?: Record<string, unknown>,
      _method = "GET",
      _body?: unknown,
    ): Promise<T> => [] as T,
  } as unknown as ScannerStore;
  let providerFetches = 0;
  const candles = [
    {
      t: Date.UTC(2026, 8, 21, 11, 30),
      o: 100,
      h: 102,
      l: 99,
      c: 101,
      v: 10,
    },
    {
      t: Date.UTC(2026, 8, 21, 12, 0),
      o: 101,
      h: 103,
      l: 100,
      c: 102,
      v: 4,
    },
  ];
  const providerFactory = (() => ({
    name: "twelvedata",
    capabilities: { quotes: true, websocket: false, historical: true },
    getSymbols: async () => [],
    getQuote: async () => ({
      price: 102,
      timestamp: new Date(now).toISOString(),
    }),
    getHistoricalBars: async () => candles.slice(0, 1),
    getBarsIncludingOpen: async () => {
      providerFetches += 1;
      return candles;
    },
    getMarketStatus: async () => "open" as const,
    reconnect: async () => undefined,
    healthCheck: async () => ({
      status: "connected" as const,
      checkedAt: new Date(now).toISOString(),
      latencyMs: 1,
      message: "connected",
    }),
  })) as typeof getMarketProvider;

  const first = await sharedProviderCandles(
    store,
    "twelvedata",
    "CACHEGBPJPY",
    "30m",
    now,
    { cacheMode: "live", providerFactory },
  );
  const second = await sharedProviderCandles(
    store,
    "twelvedata",
    "CACHEGBPJPY",
    "30m",
    now,
    { cacheMode: "live", providerFactory },
  );

  assert.equal(providerFetches, 1);
  assert.strictEqual(second, first);
});
test("unconfigured Twelve Data does not fall back to simulated candles", async () => {
  const provider = new TwelveDataProvider("");
  assert.equal((await provider.healthCheck()).status, "unconfigured");
  await assert.rejects(
    provider.getHistoricalBars("EURUSD", "1m", 0, Date.now()),
    /not configured/,
  );
});
test("Twelve Data series is normalized oldest-first while analysis excludes the forming candle", async (t) => {
  const now = Date.UTC(2026, 8, 13, 12, 7, 0);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          values: [
            {
              datetime: "2026-09-13 12:00:00",
              open: "100",
              high: "104",
              low: "99",
              close: "103",
            },
            {
              datetime: "2026-09-13 11:45:00",
              open: "98",
              high: "101",
              low: "97",
              close: "100",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  const provider = new TwelveDataProvider("test-key");
  const includingOpen = await provider.getBarsIncludingOpen(
    "XAUUSD",
    "15m",
    now - 3_600_000,
    now,
  );
  assert.deepEqual(
    includingOpen.map((bar) => bar.t),
    [Date.UTC(2026, 8, 13, 11, 45), Date.UTC(2026, 8, 13, 12, 0)],
  );
  const closed = await provider.getHistoricalBars(
    "XAUUSD",
    "15m",
    now - 3_600_000,
    now,
  );
  assert.equal(closed.length, 1);
  assert.equal(closed[0].t, Date.UTC(2026, 8, 13, 11, 45));
});
test(
  "real public Coinbase candles pass ingestion and deterministic engines",
  { skip: process.env.RUN_MARKET_PROVIDER_TESTS !== "1" },
  async () => {
    const provider = new CoinbaseProvider(),
      now = Date.now();
    const quote = await provider.getQuote("BTC-USD");
    const bars = await provider.getHistoricalBars(
      "BTC-USD",
      "5m",
      now - 240 * 300_000,
      now,
    );
    assert.ok(quote.price > 0);
    assert.ok(bars.length > 200);
    assert.equal(new Set(bars.map((b) => b.t)).size, bars.length);
    assert.ok(bars.every((b) => b.t + 300_000 <= now));
    const stats = indicators(bars);
    assert.ok(stats.ema200! > 0);
    assert.ok(stats.atr! > 0);
    assert.ok(marketStructure(bars).swings.length > 0);
    assert.ok(detectZones(bars, stats.atr).length > 0);
  },
);
