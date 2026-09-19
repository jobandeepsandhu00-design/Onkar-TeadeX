import test from "node:test";
import assert from "node:assert/strict";
import { timeframeMs, type Candle, type Timeframe } from "@workspace/api-zod";
import {
  buildGlobalTradingWorkflow,
  finalizeGlobalTradingWorkflow,
  globalWorkflowRequired,
} from "./global-workflow";

function history(
  timeframe: Timeframe,
  now: number,
  options: { forming?: boolean; slope?: number; amplitude?: number } = {},
): Candle[] {
  const step = timeframeMs[timeframe];
  const lastOpen = Math.floor(now / step) * step - (options.forming ? 0 : step);
  return Array.from({ length: 220 }, (_, index) => {
    const phase = index * (Math.PI / 4);
    const center =
      100 +
      index * (options.slope ?? 0.08) +
      Math.sin(phase) * (options.amplitude ?? 1.8);
    const open = center - Math.cos(phase) * 0.25;
    const close = center + Math.cos(phase) * 0.25;
    return {
      t: lastOpen - (219 - index) * step,
      o: open,
      h: Math.max(open, close) + 0.65,
      l: Math.min(open, close) - 0.65,
      c: close,
      v: 100 + index,
    };
  });
}

test("the official workflow is mandatory for the enabled GBPJPY and XAUUSD markets", () => {
  assert.equal(globalWorkflowRequired("GBP/JPY"), true);
  assert.equal(globalWorkflowRequired("XAUUSD"), true);
  assert.equal(globalWorkflowRequired("BTCUSD"), false);
});

test("a forming 30M candle locks Setup AI and cannot confirm an entry", () => {
  const now =
    Math.floor(Date.now() / timeframeMs["30m"]) * timeframeMs["30m"] +
    5 * 60_000;
  const workflow = buildGlobalTradingWorkflow({
    symbol: "XAUUSD",
    now,
    histories: {
      "4h": history("4h", now),
      "1h": history("1h", now),
      "30m": history("30m", now, { forming: true }),
    },
  });
  assert.ok(workflow);
  assert.equal(workflow.thirtyMinute.candle.closed, false);
  assert.equal(workflow.gate.status, "LOCKED");
  assert.equal(workflow.masterStatus, "WAITING_FOR_30M_CLOSE");
  assert.ok(workflow.gate.missing.includes("30M candle closed"));
});

test("Risk AI keeps veto authority after the parent workflow and setup match", () => {
  const now = Math.floor(Date.now() / timeframeMs["30m"]) * timeframeMs["30m"];
  const workflow = buildGlobalTradingWorkflow({
    symbol: "GBPJPY",
    now,
    histories: {
      "4h": history("4h", now),
      "1h": history("1h", now),
      "30m": history("30m", now),
    },
  });
  assert.ok(workflow);
  const unlocked = {
    ...workflow,
    gate: { status: "UNLOCKED" as const, passed: ["fixture"], missing: [] },
  };
  const rejected = finalizeGlobalTradingWorkflow(unlocked, true, false);
  assert.equal(rejected.riskGate, "REJECTED");
  assert.equal(rejected.masterStatus, "RISK_REJECTED");
  const approved = finalizeGlobalTradingWorkflow(unlocked, true, true);
  assert.equal(approved.riskGate, "APPROVED");
  assert.equal(approved.masterStatus, "ENTRY_READY");
});
