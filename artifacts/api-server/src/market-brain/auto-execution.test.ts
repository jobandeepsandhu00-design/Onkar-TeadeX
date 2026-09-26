import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_CONFIRM_RECONCILIATION_GRACE_MS,
  autoConfirmedReconciliationBlocked,
  autoReconciliationDecision,
  calculateBrokerVolume,
  candidateEntryGeometryBlocker,
  capabilityAfterMT5Reconciliation,
  deriveCandidateEntryInstruction,
  executionEventBlocksRetry,
} from "./auto-execution";
import { calculatePaperResult } from "./paper-execution";
import { executionRequestId } from "./execution-identity";
import { storedTwelveDataCapability } from "./execution-router";
import { scannerConfigSchema } from "@workspace/api-zod";
import type { ConfigRow } from "./store";

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

test("READY candidate price deterministically selects all four MT5 pending types", () => {
  const quote = { bid: 100, ask: 100.2, tickSize: 0.1 };
  assert.deepEqual(
    deriveCandidateEntryInstruction({
      ...quote,
      direction: "long",
      plannedEntry: 99,
    }),
    { ok: true, action: "BUY_LIMIT", executionPrice: 99, price: 99 },
  );
  assert.deepEqual(
    deriveCandidateEntryInstruction({
      ...quote,
      direction: "long",
      plannedEntry: 101,
    }),
    { ok: true, action: "BUY_STOP", executionPrice: 101, price: 101 },
  );
  assert.deepEqual(
    deriveCandidateEntryInstruction({
      ...quote,
      direction: "short",
      plannedEntry: 101,
    }),
    { ok: true, action: "SELL_LIMIT", executionPrice: 101, price: 101 },
  );
  assert.deepEqual(
    deriveCandidateEntryInstruction({
      ...quote,
      direction: "short",
      plannedEntry: 99,
    }),
    { ok: true, action: "SELL_STOP", executionPrice: 99, price: 99 },
  );
});

test("candidate entry derivation keeps candle Bid/close and inside-spread plans at market", () => {
  assert.deepEqual(
    deriveCandidateEntryInstruction({
      direction: "long",
      plannedEntry: 100.2,
      bid: 100,
      ask: 100.2,
      tickSize: 0.1,
    }),
    { ok: true, action: "MARKET_BUY", executionPrice: 100.2 },
  );
  assert.deepEqual(
    deriveCandidateEntryInstruction({
      direction: "short",
      plannedEntry: 100.1,
      bid: 100,
      ask: 100.2,
      tickSize: 0.1,
    }),
    { ok: true, action: "MARKET_SELL", executionPrice: 100 },
  );
  assert.deepEqual(
    deriveCandidateEntryInstruction({
      direction: "long",
      plannedEntry: 100,
      bid: 100,
      ask: 100.2,
      tickSize: 0.1,
    }),
    { ok: true, action: "MARKET_BUY", executionPrice: 100.2 },
  );
});

test("candidate entry derivation rejects invalid or crossed broker quotes", () => {
  assert.equal(
    deriveCandidateEntryInstruction({
      direction: "long",
      plannedEntry: 100,
      bid: 101,
      ask: 100,
      tickSize: 0.1,
    }).ok,
    false,
  );
});

test("candidate pending entries retain directional protection and minimum reward risk", () => {
  assert.equal(
    candidateEntryGeometryBlocker({
      direction: "long",
      entry: 100,
      stop: 99,
      target: 102,
      minimumRR: 2,
    }),
    null,
  );
  assert.match(
    candidateEntryGeometryBlocker({
      direction: "long",
      entry: 100,
      stop: 101,
      target: 102,
      minimumRR: 2,
    }) ?? "",
    /geometry/i,
  );
  assert.match(
    candidateEntryGeometryBlocker({
      direction: "short",
      entry: 100,
      stop: 101,
      target: 99.5,
      minimumRR: 2,
    }) ?? "",
    /reward\/risk/i,
  );
});

test("AUTO pending orders keep the existing audited pipeline and final action fence", () => {
  const source = readFileSync(
    new URL("./auto-execution.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /positions\.length \+ pendingOrders\.length/);
  assert.match(source, /price: entryInstruction\.price/);
  assert.match(
    source,
    /preSendInstruction\.action !== entryInstruction\.action/,
  );
  const finalFence = source.indexOf('"confirm_mt5_auto_post_claim"');
  const execute = source.indexOf("result = await executeMT5Order", finalFence);
  assert.ok(finalFence > 0 && execute > finalFence);
});

test("transient execution blocks retry after a short cooldown", () => {
  const now = Date.parse("2026-09-25T12:00:30.000Z");
  assert.equal(
    executionEventBlocksRetry(
      { state: "BLOCKED", created_at: "2026-09-25T12:00:25.000Z" },
      now,
    ),
    true,
  );
  assert.equal(
    executionEventBlocksRetry(
      { state: "BLOCKED", created_at: "2026-09-25T12:00:19.000Z" },
      now,
    ),
    false,
  );
});

test("completed or rejected broker requests remain terminal", () => {
  const now = Date.parse("2026-09-25T12:00:30.000Z");
  for (const state of ["EXECUTED", "ERROR", "INVALIDATED"])
    assert.equal(
      executionEventBlocksRetry(
        { state, created_at: "2026-09-25T10:00:00.000Z" },
        now,
      ),
      true,
    );
});

test("an abandoned in-flight execution becomes reconcilable", () => {
  const now = Date.parse("2026-09-25T12:03:00.000Z");
  assert.equal(
    executionEventBlocksRetry(
      { state: "EXECUTING", created_at: "2026-09-25T12:02:30.000Z" },
      now,
    ),
    true,
  );
  assert.equal(
    executionEventBlocksRetry(
      { state: "EXECUTING", created_at: "2026-09-25T12:00:00.000Z" },
      now,
    ),
    false,
  );
});

test("AUTO reconciliation projects only exact terminal bridge truth", () => {
  assert.deepEqual(
    autoReconciliationDecision({
      requestId: "auto-request-accepted",
      state: "COMPLETED",
      resolved: true,
      result: { ok: true, order: 71, deal: 72, retcode: 10009 },
    }),
    {
      resolved: true,
      status: "SENT",
      message:
        "The original MT5 AUTO request was found and accepted. No retry was sent.",
      result: { ok: true, order: 71, deal: 72, retcode: 10009 },
    },
  );
  assert.equal(
    autoReconciliationDecision({
      requestId: "auto-request-rejected",
      state: "COMPLETED",
      resolved: true,
      result: { ok: false, retcode: 10016 },
    }).status,
    "REJECTED",
  );
});

test("AUTO reconciliation treats cancelled claims as proved not sent", () => {
  const decision = autoReconciliationDecision({
    requestId: "auto-request-cancelled",
    state: "CANCELLED",
    resolved: true,
    result: {
      ok: false,
      requestId: "auto-request-cancelled",
      notSent: true,
    },
  });
  assert.equal(decision.resolved, true);
  assert.equal(decision.status, "REJECTED");
  assert.equal(decision.result?.notSent, true);
});

test("AUTO reconciliation keeps missing and reserved request IDs globally locked", () => {
  for (const state of ["NOT_FOUND", "RESERVED"] as const) {
    const decision = autoReconciliationDecision({
      requestId: `auto-request-${state.toLowerCase()}`,
      state,
      resolved: false,
      reconciliationState:
        state === "NOT_FOUND" ? "MANUAL_REVIEW" : "AWAITING_BROKER_HISTORY",
      result: null,
    });
    assert.equal(decision.resolved, false);
    assert.equal(decision.status, "UNCERTAIN");
  }
});

test("bridge reconciliation blocks capability while any request is unresolved", () => {
  const capability = {
    ready: true,
    state: "READY" as const,
    reason: "MT5 is ready.",
    accountType: "DEMO" as const,
    broker: "IC Markets",
  };
  const blocked = capabilityAfterMT5Reconciliation(capability, {
    positions: 0,
    orders: 0,
    resolvedRequests: [],
    unresolvedRequests: [
      {
        requestId: "reserved-without-database-row",
        ageSeconds: 12,
        state: "AWAITING_BROKER_HISTORY",
      },
    ],
    reconciledAt: 1_795_000_000,
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.state, "BLOCKED");
  assert.match(blocked.reason, /reserved-without-database-row/);
  assert.match(blocked.reason, /no request was resent/i);

  const clear = capabilityAfterMT5Reconciliation(capability, {
    positions: 0,
    orders: 0,
    resolvedRequests: [],
    unresolvedRequests: [],
    reconciledAt: 1_795_000_001,
  });
  assert.equal(clear.ready, true);
  assert.equal(clear.state, "READY");
});

test("fresh CONFIRMED AUTO handoffs cannot be raced by reconciliation", () => {
  const now = Date.parse("2026-09-25T12:00:30.000Z");
  assert.equal(
    autoConfirmedReconciliationBlocked(
      { status: "CONFIRMED", updated_at: new Date(now - 1_000).toISOString() },
      now,
    ),
    true,
  );
  assert.equal(
    autoConfirmedReconciliationBlocked(
      {
        status: "CONFIRMED",
        updated_at: new Date(
          now - AUTO_CONFIRM_RECONCILIATION_GRACE_MS,
        ).toISOString(),
      },
      now,
    ),
    false,
  );
  assert.equal(
    autoConfirmedReconciliationBlocked(
      { status: "UNCERTAIN", updated_at: new Date(now).toISOString() },
      now,
    ),
    false,
  );
});

test("database reconciliation fence rechecks CONFIRMED age under the advisory lock", () => {
  const migration = readFileSync(
    new URL(
      "../../../../supabase/migrations/20260925170000_mt5_auto_execution_audit.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const claimStart = migration.indexOf(
    "create or replace function public.claim_mt5_auto_reconciliation",
  );
  const claimBody = migration.slice(
    claimStart,
    migration.indexOf("$$;", claimStart),
  );
  assert.match(
    claimBody,
    /request\.status = 'UNCERTAIN'[\s\S]*request\.status in \('CONFIRMED','RECONCILING'\)[\s\S]*request\.updated_at < p_stale_before/,
  );
  const confirmStart = migration.indexOf(
    "create or replace function public.confirm_mt5_auto_post_claim",
  );
  const confirmBody = migration.slice(
    confirmStart,
    migration.indexOf("$$;", confirmStart),
  );
  assert.match(
    confirmBody,
    /pg_advisory_xact_lock[\s\S]*request\.status = 'CONFIRMED'/,
  );
  for (const gate of [
    "runtime.scanner_config_id = p_scanner_config",
    "runtime.scanner_state = 'RUNNING'",
    "runtime.trading_mode = 'AUTO'",
    "runtime.auto_execution_enabled = true",
    "runtime.emergency_stop = false",
    "runtime.trading_source = 'MT5'",
  ])
    assert.ok(
      confirmBody.includes(gate),
      `final AUTO database fence is missing ${gate}`,
    );
});

test("AUTO claim ambiguity pauses and reconciles instead of terminalizing the request", () => {
  const source = readFileSync(
    new URL("./auto-execution.ts", import.meta.url),
    "utf8",
  );
  const claim = source.indexOf("await claimMT5Order(");
  const nextExecutingEvent = source.indexOf('"EXECUTING"', claim);
  const claimHandoff = source.slice(claim, nextExecutingEvent);
  assert.match(claimHandoff, /markAutoUncertain/);
  assert.match(claimHandoff, /notifyAutoUncertain/);
  assert.doesNotMatch(claimHandoff, /resolveAutoAudit/);
  assert.match(claimHandoff, /do not retry/i);
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

test("Paper result preserves initial risk after a partial close and stop move", () => {
  const result = calculatePaperResult(
    {
      entry: 100,
      stop_loss: 100,
      position_size: 1,
      direction: "BUY",
      detail: {
        valuePerPriceUnit: 10,
        initialStopLoss: 98,
        initialPositionSize: 2,
        realizedPnl: 20,
      },
    },
    104,
  );
  assert.deepEqual(result, { pnl: 60, rMultiple: 1.5 });
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

test("Paper execution readiness reuses persisted fresh scanner health", (t) => {
  const previous = process.env.AUTO_EXECUTION_WORKER_ENABLED;
  process.env.AUTO_EXECUTION_WORKER_ENABLED = "true";
  t.after(() => {
    if (previous === undefined)
      delete process.env.AUTO_EXECUTION_WORKER_ENABLED;
    else process.env.AUTO_EXECUTION_WORKER_ENABLED = previous;
  });
  const now = Date.now();
  const config: ConfigRow = {
    id: "config",
    user_id: "user",
    workspace_id: "workspace",
    config: scannerConfigSchema.parse({ provider: "twelvedata" }),
    enabled: true,
    cursor: 0,
    lease_token: "lease",
    last_run_at: new Date(now).toISOString(),
    last_duration_ms: 100,
    health: { status: "connected", checkedAt: new Date(now).toISOString() },
    last_error: null,
  };
  assert.equal(storedTwelveDataCapability(config, now).ready, true);
  assert.equal(
    storedTwelveDataCapability(
      { ...config, last_error: "Provider request failed (429)" },
      now,
    ).ready,
    false,
  );
  assert.equal(
    storedTwelveDataCapability(
      {
        ...config,
        health: {
          status: "connected",
          checkedAt: new Date(now - 31 * 60_000).toISOString(),
        },
      },
      now,
    ).ready,
    false,
  );
});
