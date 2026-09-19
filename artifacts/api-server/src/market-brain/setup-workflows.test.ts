import test from "node:test";
import assert from "node:assert/strict";
import { globalTradingWorkflowSchema, type Candle } from "@workspace/api-zod";
import {
  CANONICAL_SETUP_WORKFLOWS,
  canonicalSetupWorkflow,
  evaluateSetupWorkflow,
} from "./setup-workflows";

const candle = (
  index: number,
  o: number,
  h: number,
  l: number,
  c: number,
): Candle => ({
  t: index * 1_800_000,
  o,
  h,
  l,
  c,
  v: 100,
});

function workflow(status: "LOCKED" | "UNLOCKED" = "UNLOCKED") {
  const zone = (
    low: number,
    high: number,
    type: "support" | "resistance",
    timeframe: "4h" | "1h" | "30m",
  ) => ({ low, high, type, timeframe, touches: 2, freshness: 70 });
  return globalTradingWorkflowSchema.parse({
    version: "4h-1h-30m-v1",
    symbol: "XAUUSD",
    evaluatedAt: new Date(50_000_000).toISOString(),
    session: "London",
    currentPrice: 100.3,
    fourHour: {
      bias: "bullish",
      structure: ["HH", "HL"],
      support: zone(98, 98.5, "support", "4h"),
      resistance: zone(104, 104.5, "resistance", "4h"),
      swingHigh: 104,
      swingLow: 98,
      brokenStructure: "bullish",
    },
    oneHour: {
      bias: "bullish",
      alignment: "FULL_ALIGNMENT",
      support: zone(99, 99.3, "support", "1h"),
      resistance: zone(103, 103.3, "resistance", "1h"),
      setupZone: zone(99, 99.3, "support", "1h"),
      swingHigh: 103,
      swingLow: 99,
      brokenStructure: "bullish",
    },
    thirtyMinute: {
      support: zone(99.2, 99.4, "support", "30m"),
      resistance: zone(99.8, 100, "resistance", "30m"),
      swingHigh: 100,
      swingLow: 99.2,
      brokenStructure: "bullish",
      candle: { ...candle(25, 100.1, 100.35, 100.05, 100.3), closed: true },
      reaction: "BULLISH_BREAKOUT",
    },
    priceLocation: "AT_30M_SUPPORT",
    availableRange: {
      priceUnits: 3,
      pips: 300,
      pipSize: 0.01,
      status: "GOOD_RANGE",
      opposingZone: zone(103, 103.3, "resistance", "1h"),
    },
    gate: {
      status,
      passed: status === "UNLOCKED" ? ["30M candle closed"] : [],
      missing: status === "LOCKED" ? ["30M candle closed"] : [],
    },
    riskGate: "PENDING",
    masterStatus:
      status === "UNLOCKED" ? "SETUP_DETECTED" : "WAITING_FOR_30M_CLOSE",
  });
}

test("catalog exposes exactly the 16 documented setup families", () => {
  assert.equal(CANONICAL_SETUP_WORKFLOWS.length, 16);
  assert.equal(canonicalSetupWorkflow("S/R Buy"), "S/R Buy / Sell");
  assert.equal(canonicalSetupWorkflow("A+ Sell"), "A+ Buy / Sell");
});

test("small-body breakout confirms only with an unlocked gate and a later closed trigger", () => {
  const bars = Array.from({ length: 24 }, (_, index) =>
    candle(index, 99.5, 99.7, 99.4, 99.6),
  );
  bars.push(candle(24, 99.95, 100.2, 99.9, 100.05));
  bars.push(candle(25, 100.05, 100.35, 100.02, 100.3));
  const result = evaluateSetupWorkflow({
    setupName: "Breakout Small Body",
    requestedDirection: "both",
    workflow: workflow(),
    closedThirtyMinuteCandles: bars,
  });
  assert.ok(result);
  assert.equal(result.patternMatched, true);
  assert.equal(result.entryTrigger, true);

  const withoutTrigger = evaluateSetupWorkflow({
    setupName: "Breakout Small Body",
    requestedDirection: "both",
    workflow: workflow(),
    closedThirtyMinuteCandles: bars.slice(0, -1),
  });
  assert.ok(withoutTrigger);
  assert.equal(withoutTrigger.entryTrigger, false);

  const locked = evaluateSetupWorkflow({
    setupName: "Breakout Small Body",
    requestedDirection: "both",
    workflow: workflow("LOCKED"),
    closedThirtyMinuteCandles: bars,
  });
  assert.ok(locked);
  assert.equal(locked.patternMatched, false);
  assert.equal(locked.entryTrigger, false);
});

test("counter workflow resolves opposite the prevailing 4H trend", () => {
  const bars = Array.from({ length: 26 }, (_, index) =>
    candle(index, 99.5, 99.7, 99.4, 99.6),
  );
  const result = evaluateSetupWorkflow({
    setupName: "Counter Buy / Sell",
    requestedDirection: "both",
    workflow: workflow(),
    closedThirtyMinuteCandles: bars,
  });
  assert.ok(result);
  assert.equal(result.direction, "short");
});
