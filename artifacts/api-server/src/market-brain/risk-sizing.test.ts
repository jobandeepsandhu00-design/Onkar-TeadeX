import assert from "node:assert/strict";
import test from "node:test";
import {
  conversionFromEcbRates,
  floorVolume,
  paperContract,
  resolveCurrencyConversion,
  resolvePaperInstrumentSizing,
} from "./risk-sizing";
import { calculateRisk } from "./evaluation";
import { scannerConfigSchema } from "@workspace/api-zod";

test("Paper contracts are explicit for FX and gold", () => {
  assert.equal(paperContract("GBPJPY")?.contractSize, 100_000);
  assert.equal(paperContract("GBP/JPY")?.profitCurrency, "JPY");
  assert.equal(paperContract("XAUUSD")?.contractSize, 100);
  assert.equal(paperContract("UNKNOWN"), null);
});

test("account-currency conversion accepts a direct Twelve Data pair", async () => {
  const rate = await resolveCurrencyConversion("JPY", "USD", async (symbol) => {
    assert.equal(symbol, "JPYUSD");
    return { price: 0.0067, timestamp: new Date().toISOString() };
  });
  assert.equal(rate, 0.0067);
});

test("account-currency conversion safely inverts the available pair", async () => {
  const rate = await resolveCurrencyConversion("JPY", "USD", async (symbol) => {
    if (symbol === "JPYUSD") throw new Error("pair unavailable");
    assert.equal(symbol, "USDJPY");
    return { price: 150, timestamp: new Date().toISOString() };
  });
  assert.ok(Math.abs(rate - 1 / 150) < 1e-12);
});

test("official ECB cross conversion derives JPY to USD through EUR", () => {
  const rate = conversionFromEcbRates("JPY", "USD", {
    USD: 1.18,
    JPY: 176,
  });
  assert.ok(rate);
  assert.ok(Math.abs(rate! - 1.18 / 176) < 1e-12);
});

test("GBPJPY sizing converts the 100,000 JPY price-unit value into USD", async () => {
  const sizing = await resolvePaperInstrumentSizing(
    "GBPJPY",
    "USD",
    async () => ({ price: 0.0067, timestamp: new Date().toISOString() }),
  );
  assert.equal(sizing?.valuePerPriceUnit, 670);
  assert.equal(sizing?.volumeStep, 0.01);
});

test("XAUUSD sizing uses 100 ounces and needs no USD conversion call", async () => {
  const sizing = await resolvePaperInstrumentSizing(
    "XAUUSD",
    "USD",
    async () => {
      throw new Error("conversion should not be requested");
    },
  );
  assert.equal(sizing?.valuePerPriceUnit, 100);
  assert.equal(sizing?.conversionRate, 1);
});

test("volume is rounded down to avoid exceeding configured risk", () => {
  assert.equal(floorVolume(1.239, 0.01), 1.23);
  assert.equal(floorVolume(0.009, 0.01), 0);
});

test("gold and JPY-cross risk stay at or below the selected monetary risk", () => {
  const profile = scannerConfigSchema.parse({}).risk;
  const baseAccount = {
    id: "paper",
    currency: "USD",
    balance: 100_000,
    dailyPnl: 0,
    openPositions: 0,
    openRiskMoney: 0,
  };
  const gold = calculateRisk(
    2_400,
    2_390,
    2_420,
    "long",
    {
      ...baseAccount,
      valuePerUnit: 100,
      sizing: {
        symbol: "XAUUSD",
        contractSize: 100,
        profitCurrency: "USD",
        accountCurrency: "USD",
        conversionRate: 1,
        valuePerPriceUnit: 100,
        volumeMin: 0.01,
        volumeMax: 100,
        volumeStep: 0.01,
        source: "TWELVE_DATA_PAPER_STANDARD",
      },
    },
    profile,
  );
  assert.equal(gold.positionSize, 1);
  assert.equal(gold.estimatedLossAtStop, 1_000);

  const gbpJpy = calculateRisk(
    200,
    198,
    204,
    "long",
    {
      ...baseAccount,
      valuePerUnit: 670,
      sizing: {
        symbol: "GBPJPY",
        contractSize: 100_000,
        profitCurrency: "JPY",
        accountCurrency: "USD",
        conversionRate: 0.0067,
        valuePerPriceUnit: 670,
        volumeMin: 0.01,
        volumeMax: 200,
        volumeStep: 0.01,
        source: "TWELVE_DATA_PAPER_STANDARD",
      },
    },
    profile,
  );
  assert.equal(gbpJpy.positionSize, 0.74);
  assert.ok((gbpJpy.estimatedLossAtStop ?? Infinity) <= 1_000);
});
