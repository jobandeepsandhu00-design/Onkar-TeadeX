import assert from "node:assert/strict";
import test from "node:test";
import type { ScannerCandidate } from "@workspace/api-zod";
import {
  claimConfirmedAlert,
  isConfirmedClosedCandidate,
  masterAlertCopy,
  masterAlertKey,
} from "../MasterSetupAlertBridge";
import { kokoroRuntimeAttempts } from "../kokoro-runtime";

function candidate(
  state: ScannerCandidate["state"] = "READY",
  candleAt = "2026-09-14T10:00:00.000Z",
): ScannerCandidate {
  return {
    id: "candidate-1",
    symbol: "XAUUSD",
    timeframe: "15m",
    state,
    score: 91,
    version_id: "version-1",
    last_candle_at: candleAt,
    expires_at: "2026-09-14T13:00:00.000Z",
    plan: null,
    payload: {
      strategyName: "SRC Support Rejection",
      source: "twelvedata",
      direction: "long",
      marketBias: "bullish",
      session: "London",
      score: 91,
      passed: 9,
      total: 10,
      rules: [],
      risk: {
        entry: 2405,
        stop: 2395,
        target: 2431,
        rr: 2.6,
        stopDistance: 10,
        riskPercent: 1,
        monetaryRisk: null,
        positionSize: null,
        currency: null,
        accountId: null,
        allowed: true,
        warnings: [],
        executionEnabled: false,
      },
      warnings: [],
      stale: false,
      analyzedAt: candleAt,
      lastCandleAt: candleAt,
      higherTimeframe: "1h",
      primaryTimeframe: "15m",
      entryZone: { low: 2404, high: 2408 },
      invalidation: 2395,
      targets: [2431],
      news: { status: "unavailable", checkedAt: candleAt, events: [] },
    },
  };
}

test("unconfirmed or still-forming candles never produce a confirmed delivery", () => {
  const now = Date.parse("2026-09-14T10:10:00.000Z");
  assert.equal(isConfirmedClosedCandidate(candidate("WATCH"), now), false);
  assert.equal(isConfirmedClosedCandidate(candidate("READY"), now), false);
  assert.equal(
    isConfirmedClosedCandidate(
      candidate("READY"),
      Date.parse("2026-09-14T10:15:00.000Z"),
    ),
    true,
  );
});

test("Master alert identity is per setup candle and copy includes required risk fields", () => {
  const item = candidate();
  assert.equal(masterAlertKey(item), masterAlertKey(item));
  const copy = masterAlertCopy(item);
  assert.match(copy.spoken, /XAUUSD/);
  assert.match(copy.spoken, /15m/);
  assert.match(copy.spoken, /SRC Support Rejection/);
  assert.match(copy.spoken, /BUY direction/);
  assert.match(copy.spoken, /confirmation status confirmed/);
  assert.match(copy.spoken, /Important risk warning/);
});

test("the same confirmed setup candle is claimed only once", () => {
  const ledger = new Set<string>();
  const item = candidate();
  const now = Date.parse("2026-09-14T10:15:00.000Z");
  assert.equal(claimConfirmedAlert(item, "setup_ready", ledger, now), true);
  assert.equal(claimConfirmedAlert(item, "setup_ready", ledger, now), false);
  assert.equal(claimConfirmedAlert(item, "conditions_changed", new Set(), now), false);
});

test("Kokoro runtime is WebGPU-first with automatic WASM-only fallback", () => {
  assert.deepEqual(kokoroRuntimeAttempts(true), [
    { device: "webgpu", dtype: "fp32" },
    { device: "wasm", dtype: "q8" },
  ]);
  assert.deepEqual(kokoroRuntimeAttempts(false), [
    { device: "wasm", dtype: "q8" },
  ]);
});
