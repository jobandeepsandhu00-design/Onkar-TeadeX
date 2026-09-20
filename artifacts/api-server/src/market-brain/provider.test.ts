import test from "node:test";
import assert from "node:assert/strict";
import { CoinbaseProvider, TwelveDataProvider } from "./providers";
import { scannerConfigSchema } from "@workspace/api-zod";
import { indicators, marketStructure, detectZones } from "./calculations";
import { configuredPrimary } from "./provider-selection";

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

test("approved Setup Library versions auto-activate by default", () => {
  const config = scannerConfigSchema.parse({});
  assert.equal(config.autoActivateApprovedSetups, true);
  assert.deepEqual(config.strategyVersionIds, []);
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
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    status: "ok",
    values: [
      { datetime: "2026-09-13 12:00:00", open: "100", high: "104", low: "99", close: "103" },
      { datetime: "2026-09-13 11:45:00", open: "98", high: "101", low: "97", close: "100" },
    ],
  }), { headers: { "Content-Type": "application/json" } }));
  const provider = new TwelveDataProvider("test-key");
  const includingOpen = await provider.getBarsIncludingOpen("XAUUSD", "15m", now - 3_600_000, now);
  assert.deepEqual(includingOpen.map((bar) => bar.t), [Date.UTC(2026, 8, 13, 11, 45), Date.UTC(2026, 8, 13, 12, 0)]);
  const closed = await provider.getHistoricalBars("XAUUSD", "15m", now - 3_600_000, now);
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
