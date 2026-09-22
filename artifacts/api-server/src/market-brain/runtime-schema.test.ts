import test from "node:test";
import assert from "node:assert/strict";
import {
  scannerConfigSchema,
  scannerConfigWithCurrentScorePolicy,
  scannerRuntimeSchema,
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
