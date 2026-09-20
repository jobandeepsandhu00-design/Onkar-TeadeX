import test from "node:test";
import assert from "node:assert/strict";
import { calculateBrokerVolume } from "./auto-execution";
import { calculatePaperResult } from "./paper-execution";
import { executionRequestId } from "./execution-identity";

const spec = {
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
  fillingMode: 0,
  executionMode: 2,
  tradeMode: 1,
};

test("broker sizing risks the configured percentage and rounds down to step", () => {
  assert.equal(calculateBrokerVolume(10_000, 0.5, 2000, 1995, spec), 0.1);
});

test("broker sizing blocks an order below minimum volume", () => {
  assert.equal(calculateBrokerVolume(100, 0.1, 2000, 1900, spec), null);
});

test("broker sizing blocks missing tick economics", () => {
  assert.equal(
    calculateBrokerVolume(10_000, 0.5, 2000, 1995, {
      ...spec,
      tickValue: 0,
      tickValueProfit: 0,
      tickValueLoss: 0,
    }),
    null,
  );
});

test("Paper execution calculates BUY and SELL results from stored contract value", () => {
  const base = {
    entry: 100,
    stop_loss: 98,
    position_size: 2,
    detail: { valuePerPriceUnit: 10 },
  };
  assert.deepEqual(calculatePaperResult({ ...base, direction: "BUY" }, 104), {
    pnl: 80,
    rMultiple: 2,
  });
  assert.deepEqual(
    calculatePaperResult({ ...base, direction: "SELL", stop_loss: 102 }, 96),
    { pnl: 80, rMultiple: 2 },
  );
});

test("execution identity is stable and provider/account scoped", () => {
  const input = {
    accountId: "paper-account",
    executionProvider: "PAPER" as const,
    symbol: "XAUUSD",
    versionId: "version-1",
    direction: "long",
    confirmationCandle: "2026-09-20T12:00:00.000Z",
    entryEvent: "event-1",
  };
  assert.equal(executionRequestId(input), executionRequestId(input));
  assert.notEqual(
    executionRequestId(input),
    executionRequestId({
      ...input,
      executionProvider: "MT5",
    }),
  );
  assert.notEqual(
    executionRequestId(input),
    executionRequestId({ ...input, accountId: "another-account" }),
  );
});
