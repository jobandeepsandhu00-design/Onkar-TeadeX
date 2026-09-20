import test from "node:test";
import assert from "node:assert/strict";
import { calculateBrokerVolume } from "./auto-execution";

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
