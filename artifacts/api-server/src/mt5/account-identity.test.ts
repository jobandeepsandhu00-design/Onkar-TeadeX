import test from "node:test";
import assert from "node:assert/strict";
import {
  mt5AccountBindingMatches,
  mt5CandidateProvenanceMatches,
  mt5FingerprintsMatch,
  mt5JournalAccountId,
  mt5ScanAccountMatches,
} from "./account-identity";
import { mt5AccountSchema } from "@workspace/api-zod";

const fingerprint = "a".repeat(64);

test("journal account id is stable and does not expose the bridge fingerprint", () => {
  const id = mt5JournalAccountId(fingerprint);
  assert.equal(id, mt5JournalAccountId(fingerprint));
  assert.match(id, /^mt5-[a-f0-9]{32}$/);
  assert.equal(id.includes(fingerprint), false);
  assert.notEqual(id, mt5JournalAccountId("b".repeat(64)));
});

test("AUTO binding requires the exact selected account and fingerprint", () => {
  const binding = {
    selected_account_id: "mt5-account-a",
    account_fingerprint: fingerprint,
  };
  assert.equal(
    mt5AccountBindingMatches(binding, "mt5-account-a", fingerprint),
    true,
  );
  assert.equal(
    mt5AccountBindingMatches(binding, "mt5-account-b", fingerprint),
    false,
  );
  assert.equal(
    mt5AccountBindingMatches(binding, "mt5-account-a", "b".repeat(64)),
    false,
  );
  assert.equal(mt5FingerprintsMatch(fingerprint, fingerprint), true);
  assert.equal(mt5FingerprintsMatch(fingerprint, "b".repeat(64)), false);
});

test("AUTO binding fails closed for missing or malformed identities", () => {
  assert.equal(mt5AccountBindingMatches(null, "account", fingerprint), false);
  assert.equal(
    mt5AccountBindingMatches(
      { selected_account_id: "account", account_fingerprint: "not-a-hash" },
      "account",
      fingerprint,
    ),
    false,
  );
  assert.throws(() => mt5JournalAccountId("not-a-hash"));
});

test("an MT5 scan requires one exact identity before and after candle fetch", () => {
  const binding = {
    selected_account_id: "mt5-account-a",
    account_fingerprint: fingerprint,
  };
  assert.equal(
    mt5ScanAccountMatches(binding, "mt5-account-a", fingerprint, fingerprint),
    true,
  );
  assert.equal(
    mt5ScanAccountMatches(
      binding,
      "mt5-account-a",
      fingerprint,
      "b".repeat(64),
    ),
    false,
  );
  assert.equal(
    mt5ScanAccountMatches(binding, "mt5-account-b", fingerprint, fingerprint),
    false,
  );
});

test("AUTO requires candidate provenance from the same candidate and account", () => {
  const candleAt = "2026-09-25T12:00:00.000Z";
  const binding = {
    selected_account_id: "mt5-account-a",
    account_fingerprint: fingerprint,
  };
  const provenance = {
    candidate_id: "candidate-a",
    candidate_last_candle_at: candleAt,
    selected_account_id: "mt5-account-a",
    account_fingerprint: fingerprint,
    broker_symbol: "XAUUSDm",
  };
  assert.equal(
    mt5CandidateProvenanceMatches(
      provenance,
      binding,
      "candidate-a",
      candleAt,
      "mt5-account-a",
      fingerprint,
      "XAUUSDm",
    ),
    true,
  );
  assert.equal(
    mt5CandidateProvenanceMatches(
      provenance,
      binding,
      "candidate-b",
      candleAt,
      "mt5-account-a",
      fingerprint,
      "XAUUSDm",
    ),
    false,
  );
  assert.equal(
    mt5CandidateProvenanceMatches(
      provenance,
      binding,
      "candidate-a",
      candleAt,
      "mt5-account-a",
      "b".repeat(64),
      "XAUUSDm",
    ),
    false,
  );
  assert.equal(
    mt5CandidateProvenanceMatches(
      null,
      binding,
      "candidate-a",
      candleAt,
      "mt5-account-a",
      fingerprint,
      "XAUUSDm",
    ),
    false,
  );
  assert.equal(
    mt5CandidateProvenanceMatches(
      provenance,
      binding,
      "candidate-a",
      "2026-09-25T12:30:00.000Z",
      "mt5-account-a",
      fingerprint,
      "XAUUSDm",
    ),
    false,
  );
  assert.equal(
    mt5CandidateProvenanceMatches(
      provenance,
      binding,
      "candidate-a",
      candleAt,
      "mt5-account-a",
      fingerprint,
      "XAUUSD.pro",
    ),
    false,
  );
});

test("the browser-safe account contract strips the server-only fingerprint", () => {
  const parsed = mt5AccountSchema.parse({
    connection: "CONNECTED",
    broker: "Broker",
    server: "Demo-1",
    account: "****5678",
    accountType: "DEMO",
    currency: "USD",
    balance: 10_000,
    equity: 10_000,
    margin: 0,
    freeMargin: 10_000,
    marginLevel: null,
    tradeAllowed: true,
    terminalConnected: true,
    tradeApiDisabled: false,
    tradingEnabled: true,
    liveTradingAllowed: false,
    accountFingerprint: fingerprint,
  });
  assert.equal("accountFingerprint" in parsed, false);
});
