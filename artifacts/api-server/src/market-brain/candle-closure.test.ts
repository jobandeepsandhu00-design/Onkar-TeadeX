import assert from "node:assert/strict";
import test from "node:test";
import { getCandleClosureSnapshot } from "./shared-market";
import { scannerConfigSchema } from "@workspace/api-zod";
import type { ConfigRow, ScannerStore } from "./store";

test("candle closure reads four persisted closed timeframes without provider requests", async () => {
  const calls: Array<{ table: string; query: Record<string, string> }> = [];
  const store = {
    request: async (table: string, query: Record<string, string>) => {
      calls.push({ table, query });
      return [
        {
          open_time: Date.parse("2026-09-23T08:00:00Z"),
          ingested_at: "2026-09-23T12:00:00+00:00",
        },
      ];
    },
  } as unknown as Pick<ScannerStore, "request">;
  const snapshot = await getCandleClosureSnapshot({ symbol: "XAUUSD", store });
  assert.equal(snapshot.provider, "twelvedata");
  assert.deepEqual(
    snapshot.candles.map((candle) => candle.timeframe),
    ["15m", "30m", "1h", "4h"],
  );
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.table, "market_candles");
    assert.equal(call.query.provider, "eq.twelvedata");
    assert.equal(call.query.symbol, "eq.XAUUSD");
    assert.equal(call.query.select, "open_time,ingested_at");
    assert.match(call.query.open_time, /^lte\.\d+$/);
  }
});

test("MT5 candle closure never falls back to Twelve Data", async () => {
  const previous = process.env.MARKET_DATA_FALLBACK_ENABLED;
  process.env.MARKET_DATA_FALLBACK_ENABLED = "true";
  const providers: string[] = [];
  const store = {
    request: async (_table: string, query: Record<string, string>) => {
      providers.push(query.provider);
      return query.provider === "eq.twelvedata"
        ? [
            {
              open_time: Date.parse("2026-09-23T08:00:00Z"),
              ingested_at: "2026-09-23T12:00:00+00:00",
            },
          ]
        : [];
    },
  } as unknown as Pick<ScannerStore, "request">;
  const config = {
    config: scannerConfigSchema.parse({ provider: "mt5" }),
  } as ConfigRow;
  try {
    const snapshot = await getCandleClosureSnapshot({
      config,
      symbol: "XAUUSD",
      store,
    });
    assert.equal(snapshot.provider, "mt5");
    assert.equal(
      snapshot.candles.every((candle) => candle.lastClosedOpenTime === null),
      true,
    );
    assert.deepEqual(providers, ["eq.mt5", "eq.mt5", "eq.mt5", "eq.mt5"]);
  } finally {
    if (previous === undefined) delete process.env.MARKET_DATA_FALLBACK_ENABLED;
    else process.env.MARKET_DATA_FALLBACK_ENABLED = previous;
  }
});
