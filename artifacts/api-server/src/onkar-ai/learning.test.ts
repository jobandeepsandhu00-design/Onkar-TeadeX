import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTrades, sampleConfidence, similarTrades, summarizeTrades } from "./learning";

const source = {
  setups: [{ id: "src", name: "SRC Support Rejection" }],
  trades: [
    { id: "1", symbol: "XAUUSD", setupId: "src", timeframe: "15m", session: "London", side: "Buy", entry: 2400, sl: 2390, exit: 2420, manualPnl: 200, mistakes: [], strengths: ["CONFIRMATION_ENTRY"], date: "2026-09-01" },
    { id: "2", symbol: "XAUUSD", setupId: "src", timeframe: "15m", session: "London", side: "Buy", entry: 2400, sl: 2390, exit: 2390, manualPnl: -100, mistakes: ["EARLY_ENTRY"], date: "2026-09-02" },
    { id: "open", symbol: "EURUSD", setupId: "src", entry: 1.1 },
  ],
};

test("journal learning uses only recorded closed outcomes", () => {
  const trades = normalizeTrades(source);
  const summary = summarizeTrades(trades);
  assert.equal(summary.sample, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.averageR, 0.5);
  assert.equal(summary.mistakes[0]?.name, "EARLY_ENTRY");
});

test("similar trade ranking is structured and deterministic", () => {
  const rows = similarTrades(normalizeTrades(source), { symbol: "XAUUSD", setupId: "src", timeframe: "15m", session: "London", direction: "long" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].score, 95);
});

test("minimum sample thresholds remain conservative", () => {
  assert.equal(sampleConfidence(4).level, "insufficient");
  assert.equal(sampleConfidence(9).level, "very_low");
  assert.equal(sampleConfidence(19).level, "early");
  assert.equal(sampleConfidence(49).level, "moderate");
  assert.equal(sampleConfidence(50).level, "stronger");
});
