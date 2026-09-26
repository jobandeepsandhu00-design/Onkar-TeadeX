import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MANUAL_CONFIRM_RECONCILIATION_GRACE_MS,
  manualNewExposureBlocker,
  manualConfirmedReconciliationBlocker,
  manualMT5OrderDigest,
  manualPostClaimCASPassed,
  manualPreflightBlocker,
  manualReconciliationDecision,
  parseManualMT5Order,
  type ManualPreflightBinding,
} from "./manual-preflight";

test("manual MT5 surface keeps management but cannot bypass the candidate entry pipeline", () => {
  for (const action of [
    "MARKET_BUY",
    "MARKET_SELL",
    "BUY_LIMIT",
    "SELL_LIMIT",
    "BUY_STOP",
    "SELL_STOP",
  ] as const)
    assert.match(
      manualNewExposureBlocker(action) ?? "",
      /READY setup candidate/,
    );

  for (const action of ["CLOSE", "PARTIAL_CLOSE", "MODIFY", "CANCEL"] as const)
    assert.equal(manualNewExposureBlocker(action), null);

  const route = readFileSync(
    new URL("../routes/mt5.ts", import.meta.url),
    "utf8",
  );
  const parser = route.slice(
    route.indexOf("function manualOrder"),
    route.indexOf("async function workspaceFor"),
  );
  assert.match(parser, /manualNewExposureBlocker\(order\.action\)/);
});

const fingerprint = "a".repeat(64);
const checkedOrder = {
  requestId: "manual-request-123",
  symbol: "XAU/USD",
  action: "MARKET_BUY" as const,
  volume: 0.1,
  stopLoss: 1990,
  takeProfit: 2020,
  confirmed: false,
};

const binding = (updates: Partial<ManualPreflightBinding> = {}) => ({
  account_fingerprint: fingerprint,
  selected_account_id: "mt5-account-a",
  internal_symbol: "XAU/USD",
  broker_symbol: "XAUUSDm",
  request_digest: manualMT5OrderDigest(checkedOrder),
  expires_at: "2026-09-25T12:01:00.000Z",
  consumed_at: null,
  ...updates,
});

test("manual preflight permits only the false-to-true confirmation transition", () => {
  assert.equal(
    manualMT5OrderDigest(checkedOrder),
    manualMT5OrderDigest({ ...checkedOrder, confirmed: true }),
  );
  assert.equal(
    manualPreflightBlocker({
      binding: binding(),
      order: { ...checkedOrder, confirmed: true },
      accountFingerprint: fingerprint,
      selectedAccountId: "mt5-account-a",
      brokerSymbol: "XAUUSDm",
      now: Date.parse("2026-09-25T12:00:30.000Z"),
    }),
    null,
  );
});

test("manual order input cannot supply or override the selected account", () => {
  assert.throws(() =>
    parseManualMT5Order(
      { ...checkedOrder, selectedAccountId: "browser-controlled-account" },
      false,
    ),
  );
});

test("manual preflight fails closed after account, mapping, or payload changes", () => {
  const base = {
    binding: binding(),
    order: { ...checkedOrder, confirmed: true },
    accountFingerprint: fingerprint,
    selectedAccountId: "mt5-account-a",
    brokerSymbol: "XAUUSDm",
    now: Date.parse("2026-09-25T12:00:30.000Z"),
  };
  assert.match(
    manualPreflightBlocker({ ...base, accountFingerprint: "b".repeat(64) })!,
    /account changed/i,
  );
  assert.match(
    manualPreflightBlocker({ ...base, selectedAccountId: "mt5-account-b" })!,
    /selected trading account changed/i,
  );
  assert.match(
    manualPreflightBlocker({ ...base, brokerSymbol: "XAUUSD.pro" })!,
    /mapping changed/i,
  );
  assert.match(
    manualPreflightBlocker({
      ...base,
      order: { ...base.order, volume: 0.2 },
    })!,
    /values changed/i,
  );
});

test("manual preflight is one-time and expires", () => {
  const base = {
    order: { ...checkedOrder, confirmed: true },
    accountFingerprint: fingerprint,
    selectedAccountId: "mt5-account-a",
    brokerSymbol: "XAUUSDm",
  };
  assert.match(
    manualPreflightBlocker({
      ...base,
      binding: binding({ consumed_at: "2026-09-25T12:00:20.000Z" }),
      now: Date.parse("2026-09-25T12:00:30.000Z"),
    })!,
    /already used/i,
  );
  assert.match(
    manualPreflightBlocker({
      ...base,
      binding: binding(),
      now: Date.parse("2026-09-25T12:01:00.000Z"),
    })!,
    /expired/i,
  );
});

test("fresh confirmed handoff cannot be reconciled and a lost post-claim CAS cannot execute", () => {
  const confirmedAt = Date.parse("2026-09-25T12:00:00.000Z");
  const row = {
    status: "CONFIRMED",
    updated_at: new Date(confirmedAt).toISOString(),
  };
  assert.match(
    manualConfirmedReconciliationBlocker(
      row,
      confirmedAt + MANUAL_CONFIRM_RECONCILIATION_GRACE_MS - 1,
    )!,
    /still be in progress/i,
  );
  assert.equal(
    manualConfirmedReconciliationBlocker(
      row,
      confirmedAt + MANUAL_CONFIRM_RECONCILIATION_GRACE_MS,
    ),
    null,
  );
  assert.equal(
    manualConfirmedReconciliationBlocker(
      { status: "RECONCILING", updated_at: row.updated_at },
      confirmedAt,
    ),
    null,
  );
  assert.equal(manualPostClaimCASPassed([]), false);
  assert.equal(manualPostClaimCASPassed([{ status: "RECONCILING" }]), false);
  assert.equal(manualPostClaimCASPassed([{ status: "CONFIRMED" }]), true);
});

test("manual database fences recheck freshness under the shared advisory lock", () => {
  const migration = readFileSync(
    new URL(
      "../../../../supabase/migrations/20260925170000_mt5_auto_execution_audit.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const claimStart = migration.indexOf(
    "create or replace function public.claim_mt5_manual_reconciliation",
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
    "create or replace function public.confirm_mt5_manual_post_claim",
  );
  const confirmBody = migration.slice(
    confirmStart,
    migration.indexOf("$$;", confirmStart),
  );
  assert.match(
    confirmBody,
    /pg_advisory_xact_lock[\s\S]*request\.candidate_id is null[\s\S]*request\.status = 'CONFIRMED'/,
  );

  const route = readFileSync(
    new URL("../routes/mt5.ts", import.meta.url),
    "utf8",
  );
  const preSend = route.indexOf("const preSendAccount");
  const finalFence = route.indexOf('"confirm_mt5_manual_post_claim"', preSend);
  const execute = route.indexOf("result = await executeMT5Order", finalFence);
  assert.ok(preSend >= 0 && finalFence > preSend && execute > finalFence);
});

test("manual claim ambiguity remains globally reconcilable instead of becoming FAILED", () => {
  const route = readFileSync(
    new URL("../routes/mt5.ts", import.meta.url),
    "utf8",
  );
  const claim = route.indexOf("await claimMT5Order(");
  const preSend = route.indexOf("const preSendAccount", claim);
  const claimHandoff = route.slice(claim, preSend);
  assert.match(claimHandoff, /status: "UNCERTAIN"/);
  assert.doesNotMatch(claimHandoff, /status: "FAILED"/);
  assert.match(claimHandoff, /exact request ID/i);
  assert.match(claimHandoff, /do not retry/i);
});

test("manual reconciliation accepts only durable completed broker truth", () => {
  assert.deepEqual(
    manualReconciliationDecision({
      requestId: "manual-request-123",
      state: "COMPLETED",
      resolved: true,
      result: { ok: true, order: 42, deal: 84 },
    }),
    {
      resolved: true,
      status: "SENT",
      message:
        "The original MT5 request was found and accepted. No retry was sent.",
      result: { ok: true, order: 42, deal: 84 },
    },
  );
  assert.equal(
    manualReconciliationDecision({
      requestId: "manual-request-123",
      state: "COMPLETED",
      resolved: true,
      result: { ok: false, retcode: 10013 },
    }).status,
    "REJECTED",
  );
});

test("manual reconciliation clears an armed request but never a reserved or missing request", () => {
  assert.equal(
    manualReconciliationDecision({
      requestId: "manual-request-123",
      state: "ARMED",
      resolved: true,
      result: null,
    }).status,
    "FAILED",
  );
  assert.equal(
    manualReconciliationDecision({
      requestId: "manual-request-123",
      state: "CANCELLED",
      resolved: true,
      result: { ok: false, notSent: true, stage: "claim_cancelled" },
    }).status,
    "FAILED",
  );
  for (const lookup of [
    {
      requestId: "manual-request-123",
      state: "RESERVED" as const,
      resolved: false,
      reconciliationState: "AWAITING_BROKER_HISTORY" as const,
      result: { ok: false, uncertain: true },
    },
    {
      requestId: "manual-request-123",
      state: "NOT_FOUND" as const,
      resolved: false,
      reconciliationState: "MANUAL_REVIEW" as const,
      result: null,
    },
  ]) {
    const decision = manualReconciliationDecision(lookup);
    assert.equal(decision.resolved, false);
    assert.equal(decision.status, "UNCERTAIN");
  }
});
