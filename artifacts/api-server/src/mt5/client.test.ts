import test from "node:test";
import assert from "node:assert/strict";
import {
  MT5BridgeError,
  getMT5BrokerSnapshot,
  getMT5CandleBundle,
  mt5BridgeRequest,
  resolveMT5BridgeConfig,
} from "./client";

const strongKey = "OtxBridge_9vN2!qR7#kL4$wP8@mC5-zX3_D6hJ1fB8";
const fingerprint = "a".repeat(64);

test("MT5 bridge transport permits HTTPS and loopback HTTP", () => {
  assert.equal(
    resolveMT5BridgeConfig({
      MT5_BRIDGE_URL: "https://mt5.private.example",
      MT5_BRIDGE_API_KEY: strongKey,
    }).url,
    "https://mt5.private.example",
  );
  assert.equal(
    resolveMT5BridgeConfig({
      MT5_BRIDGE_URL: "http://127.0.0.1:8765",
      MT5_BRIDGE_API_KEY: strongKey,
    }).url,
    "http://127.0.0.1:8765",
  );
  assert.equal(
    resolveMT5BridgeConfig({
      MT5_BRIDGE_URL: "http://[::1]:8765",
      MT5_BRIDGE_API_KEY: strongKey,
    }).url,
    "http://[::1]:8765",
  );
});

test("MT5 bridge transport rejects cleartext non-loopback URLs by default", () => {
  assert.throws(
    () =>
      resolveMT5BridgeConfig({
        MT5_BRIDGE_URL: "http://10.20.30.40:8765",
        MT5_BRIDGE_API_KEY: strongKey,
      }),
    (error: unknown) =>
      error instanceof MT5BridgeError &&
      error.message === "MT5 bridge URL must use HTTPS outside loopback",
  );
});

test("MT5 bridge cleartext override is explicit and narrowly named", () => {
  const config = resolveMT5BridgeConfig({
    MT5_BRIDGE_URL: "http://10.20.30.40:8765",
    MT5_BRIDGE_API_KEY: strongKey,
    MT5_BRIDGE_ALLOW_INSECURE_PRIVATE_DEVELOPMENT: "true",
  });

  assert.equal(config.url, "http://10.20.30.40:8765");
});

test("MT5 bridge transport rejects placeholder and low-entropy keys", () => {
  for (const key of [
    "replace_with_the_same_32_plus_character_bridge_key",
    "x".repeat(32),
    "abcd1234".repeat(4),
  ]) {
    assert.throws(
      () =>
        resolveMT5BridgeConfig({
          MT5_BRIDGE_URL: "https://mt5.private.example",
          MT5_BRIDGE_API_KEY: key,
        }),
      MT5BridgeError,
    );
  }
});

test("only a lost execute transport is classified as delivery uncertain", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.MT5_BRIDGE_URL;
  const originalKey = process.env.MT5_BRIDGE_API_KEY;
  process.env.MT5_BRIDGE_URL = "https://mt5.private.example";
  process.env.MT5_BRIDGE_API_KEY = strongKey;
  globalThis.fetch = async () => {
    throw new Error("connection reset");
  };
  try {
    await assert.rejects(
      () => mt5BridgeRequest("/trade/execute", { method: "POST" }),
      (error: unknown) =>
        error instanceof MT5BridgeError && error.deliveryUncertain,
    );
    await assert.rejects(
      () => mt5BridgeRequest("/account"),
      (error: unknown) =>
        error instanceof MT5BridgeError && !error.deliveryUncertain,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MT5_BRIDGE_URL;
    else process.env.MT5_BRIDGE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.MT5_BRIDGE_API_KEY;
    else process.env.MT5_BRIDGE_API_KEY = originalKey;
  }
});

test("a non-success execute response is also delivery uncertain", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.MT5_BRIDGE_URL;
  const originalKey = process.env.MT5_BRIDGE_API_KEY;
  process.env.MT5_BRIDGE_URL = "https://mt5.private.example";
  process.env.MT5_BRIDGE_API_KEY = strongKey;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "bridge audit failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  try {
    await assert.rejects(
      () => mt5BridgeRequest("/trade/execute", { method: "POST" }),
      (error: unknown) =>
        error instanceof MT5BridgeError && error.deliveryUncertain,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MT5_BRIDGE_URL;
    else process.env.MT5_BRIDGE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.MT5_BRIDGE_API_KEY;
    else process.env.MT5_BRIDGE_API_KEY = originalKey;
  }
});

test("atomic broker snapshot sends the exact expected account and validates the response", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.MT5_BRIDGE_URL;
  const originalKey = process.env.MT5_BRIDGE_API_KEY;
  process.env.MT5_BRIDGE_URL = "https://mt5.private.example";
  process.env.MT5_BRIDGE_API_KEY = strongKey;
  let requestedUrl = "";
  let expectedHeader = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    expectedHeader = String(
      (init?.headers as Record<string, string> | undefined)?.[
        "X-Expected-Account-Fingerprint"
      ],
    );
    return new Response(
      JSON.stringify({
        account: {
          connection: "CONNECTED",
          broker: "Broker",
          server: "Demo",
          account: "****1234",
          accountType: "DEMO",
          currency: "USD",
          balance: 10_000,
          equity: 10_010,
          margin: 100,
          freeMargin: 9_910,
          marginLevel: 10_010,
          tradeAllowed: true,
          terminalConnected: true,
          tradeApiDisabled: false,
          tradingEnabled: true,
          liveTradingAllowed: false,
          accountFingerprint: fingerprint,
        },
        positions: [],
        orders: [],
        symbol: {
          tick: {
            symbol: "XAU/USD",
            brokerSymbol: "XAUUSDm",
            bid: 2_000,
            ask: 2_000.2,
            last: 0,
            timestamp: Date.now(),
            spread: 0.2,
            tickVolume: 2,
            state: "CONNECTED",
            approximateLatencyMs: 10,
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
        capturedAt: Date.now(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const snapshot = await getMT5BrokerSnapshot(fingerprint, "XAU/USD");
    assert.equal(expectedHeader, fingerprint);
    assert.equal(
      requestedUrl,
      "https://mt5.private.example/snapshot?symbol=XAU%2FUSD",
    );
    assert.equal(snapshot.account.accountFingerprint, fingerprint);
    assert.equal(snapshot.symbol?.spec.brokerSymbol, "XAUUSDm");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MT5_BRIDGE_URL;
    else process.env.MT5_BRIDGE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.MT5_BRIDGE_API_KEY;
    else process.env.MT5_BRIDGE_API_KEY = originalKey;
  }
});

test("atomic candle bundle binds account, symbol and all requested timeframes in one request", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.MT5_BRIDGE_URL;
  const originalKey = process.env.MT5_BRIDGE_API_KEY;
  process.env.MT5_BRIDGE_URL = "https://mt5.private.example";
  process.env.MT5_BRIDGE_API_KEY = strongKey;
  let requestedUrl = "";
  let expectedHeader = "";
  const candle = (time: number, isClosed: boolean, timeframe: string) => ({
    time,
    open: 2_000,
    high: 2_002,
    low: 1_999,
    close: 2_001,
    tick_volume: 10,
    spread: 2,
    real_volume: 0,
    isClosed,
    candleId: `scope:XAUUSDm:${timeframe}:${time}`,
  });
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    expectedHeader = String(
      (init?.headers as Record<string, string> | undefined)?.[
        "X-Expected-Account-Fingerprint"
      ],
    );
    return new Response(
      JSON.stringify({
        account: {
          connection: "CONNECTED",
          broker: "Broker",
          server: "Demo",
          account: "****1234",
          accountType: "DEMO",
          currency: "USD",
          balance: 10_000,
          equity: 10_010,
          margin: 100,
          freeMargin: 9_910,
          marginLevel: 10_010,
          tradeAllowed: true,
          terminalConnected: true,
          tradeApiDisabled: false,
          tradingEnabled: true,
          liveTradingAllowed: false,
          accountFingerprint: fingerprint,
        },
        symbol: {
          internalSymbol: "XAU/USD",
          brokerSymbol: "XAUUSDm",
          tick: {
            symbol: "XAU/USD",
            brokerSymbol: "XAUUSDm",
            bid: 2_000,
            ask: 2_000.2,
            last: 0,
            timestamp: Date.now(),
            spread: 0.2,
            tickVolume: 2,
            state: "CONNECTED",
            approximateLatencyMs: 10,
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
          "30m": [candle(1_000, true, "30m"), candle(2_800, false, "30m")],
          "1h": [candle(1_000, true, "1h")],
          "4h": [candle(1_000, true, "4h")],
        },
        capturedAt: Date.now(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const bundle = await getMT5CandleBundle(
      fingerprint,
      "XAUUSD",
      ["30m", "1h", "4h"],
    );
    assert.equal(expectedHeader, fingerprint);
    assert.equal(
      requestedUrl,
      "https://mt5.private.example/market/snapshot/XAU%2FUSD?timeframes=30m%2C1h%2C4h&count=300",
    );
    assert.equal(bundle.symbol.brokerSymbol, "XAUUSDm");
    assert.deepEqual(bundle.requestedTimeframes, ["30m", "1h", "4h"]);
    assert.deepEqual(
      bundle.timeframes["30m"]?.map((row) => row.isClosed),
      [true, false],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MT5_BRIDGE_URL;
    else process.env.MT5_BRIDGE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.MT5_BRIDGE_API_KEY;
    else process.env.MT5_BRIDGE_API_KEY = originalKey;
  }
});
