import assert from "node:assert/strict";
import test from "node:test";
import { getCandleClosureSnapshot } from "./shared-market";
import type { ScannerStore } from "./store";

test("candle closure reads four persisted closed timeframes without provider requests", async () => {
  const calls: Array<{ table: string; query: Record<string, string> }> = [];
  const store = {
    request: async (table: string, query: Record<string, string>) => {
      calls.push({ table, query });
      return [{ open_time: Date.parse("2026-09-23T08:00:00Z"), ingested_at: "2026-09-23T12:00:00+00:00" }];
    },
  } as unknown as Pick<ScannerStore, "request">;
  const snapshot = await getCandleClosureSnapshot({ symbol: "XAUUSD", store });
  assert.equal(snapshot.provider, "twelvedata");
  assert.deepEqual(snapshot.candles.map((candle) => candle.timeframe), ["15m", "30m", "1h", "4h"]);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.table, "market_candles");
    assert.equal(call.query.provider, "eq.twelvedata");
    assert.equal(call.query.symbol, "eq.XAUUSD");
    assert.equal(call.query.select, "open_time,ingested_at");
    assert.match(call.query.open_time, /^lte\.\d+$/);
  }
});
