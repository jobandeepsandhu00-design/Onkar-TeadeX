import test from "node:test";
import assert from "node:assert/strict";
import { CoinbaseProvider, TwelveDataProvider } from "./providers";
import { indicators, marketStructure, detectZones } from "./calculations";
test("unconfigured Twelve Data does not fall back to simulated candles", async () => {
  const provider = new TwelveDataProvider("");
  assert.equal((await provider.healthCheck()).status, "unconfigured");
  await assert.rejects(
    provider.getHistoricalBars("EURUSD", "1m", 0, Date.now()),
    /not configured/,
  );
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
