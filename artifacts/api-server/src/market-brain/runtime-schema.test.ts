import test from "node:test";
import assert from "node:assert/strict";
import {
  scannerConfigSchema,
  scannerConfigWithCurrentScorePolicy,
  scannerRuntimeSchema,
  mt5HistoryTradeSchema,
  mt5PendingOrderSchema,
  mt5PositionSchema,
} from "@workspace/api-zod";

test("scanner runtime accepts Supabase timestamptz offsets", () => {
  const runtime = scannerRuntimeSchema.parse({
    reconciledAt: "2026-09-20T12:00:00+00:00",
    updatedAt: "2026-09-20T12:00:01+00:00",
  });

  assert.equal(runtime.reconciledAt, "2026-09-20T12:00:00+00:00");
  assert.equal(runtime.updatedAt, "2026-09-20T12:00:01+00:00");
});

test("scanner runtime keeps Z timestamps and null defaults", () => {
  const runtime = scannerRuntimeSchema.parse({
    updatedAt: "2026-09-20T12:00:00Z",
  });

  assert.equal(runtime.reconciledAt, null);
  assert.equal(runtime.updatedAt, "2026-09-20T12:00:00Z");
  assert.equal(runtime.tradingSource, "TWELVE_DATA");
  assert.equal(runtime.mt5DisconnectBehavior, "LOCK");
  assert.equal(runtime.autoReturnMt5, false);
});

test("permission center defaults keep analysis and Paper safe while MT5 live is explicit", () => {
  const config = scannerConfigSchema.parse({});

  assert.equal(config.permissions.automaticScanning, true);
  assert.equal(config.permissions.automaticSetupDetection, true);
  assert.equal(config.permissions.automaticRiskCalculation, true);
  assert.equal(config.permissions.paperTradeExecution, true);
  assert.equal(config.permissions.mt5LiveExecution, false);
  assert.equal(config.permissions.autoTradeClose, false);
  assert.equal(config.paperFastEntry, false);
  assert.equal(
    scannerConfigSchema.parse({ paperFastEntry: true }).paperFastEntry,
    true,
  );
  assert.equal(config.tradeManagement.breakEvenTriggerR, 1);
  assert.equal(config.tradeManagement.partialClosePercent, 50);
  assert.equal(config.tradeManagement.stopModificationLockR, 0.5);
  assert.equal(config.tradeManagement.tradeCloseTriggerR, 2);
});

test("opportunity score policy defaults to 20 and upgrades the original profile", () => {
  const defaults = scannerConfigSchema.parse({});
  assert.equal(defaults.minimumScore, 20);
  assert.equal(defaults.aiThreshold, 20);
  assert.equal(defaults.alertThreshold, 20);
  assert.throws(() => scannerConfigSchema.parse({ minimumScore: 19 }));

  const upgraded = scannerConfigWithCurrentScorePolicy({
    minimumScore: 50,
    aiThreshold: 75,
    alertThreshold: 80,
  });
  assert.equal(upgraded.minimumScore, 20);
  assert.equal(upgraded.aiThreshold, 20);
  assert.equal(upgraded.alertThreshold, 20);
});

test("MT5 broker position and pending-order responses retain chart fields", () => {
  const position = mt5PositionSchema.parse({
    ticket: 42,
    symbol: "XAU/USD",
    brokerSymbol: "XAUUSD.a",
    direction: "BUY",
    volume: 0.1,
    entryPrice: 2300,
    currentPrice: 2301,
    stopLoss: 2290,
    takeProfit: 2320,
    profitLoss: 10,
    openTime: Date.UTC(2026, 8, 21),
  });
  const order = mt5PendingOrderSchema.parse({
    ticket: 43,
    symbol: "GBP/JPY",
    brokerSymbol: "GBPJPYm",
    type: 2,
    volume: 0.2,
    price: 209.5,
    stopLoss: 209,
    takeProfit: 210.5,
    createdAt: Date.UTC(2026, 8, 21),
    comment: "OTX:test",
    magic: 260923,
  });

  assert.equal(position.brokerSymbol, "XAUUSD.a");
  assert.equal(order.price, 209.5);
  assert.equal(order.volume, 0.2);
  const history = mt5HistoryTradeSchema.parse({
    positionTicket: 44,
    symbol: "XAU/USD",
    brokerSymbol: "XAUUSD.a",
    direction: "SELL",
    volume: 0.1,
    entryPrice: 2301,
    entryTime: Date.UTC(2026, 8, 21),
    exitPrice: 2295,
    exitTime: Date.UTC(2026, 8, 22),
    profitLoss: 60,
    status: "Closed",
  });
  assert.equal(history.status, "Closed");
});
