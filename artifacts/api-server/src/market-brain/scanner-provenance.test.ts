import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateDataScopeMatches,
  scannerCandidateFingerprint,
} from "./scanner";
import type { CandidateRow } from "./store";

const scopedCandidate = {
  payload: {
    provider: "mt5",
    scopeAccountId: "mt5-account-a",
  },
} as CandidateRow;

test("scanner candidate reuse is provider and selected-account scoped", () => {
  assert.equal(
    candidateDataScopeMatches(scopedCandidate, "mt5", "mt5-account-a"),
    true,
  );
  assert.equal(
    candidateDataScopeMatches(scopedCandidate, "mt5", "mt5-account-b"),
    false,
  );
  assert.equal(
    candidateDataScopeMatches(scopedCandidate, "twelvedata", "mt5-account-a"),
    false,
  );
});

test("candidate identity changes across provider or selected account", () => {
  const base = {
    configId: "config-a",
    versionId: "version-a",
    symbol: "XAUUSD",
    lastCandleAt: "2026-09-25T12:00:00.000Z",
    provider: "mt5",
    accountId: "mt5-account-a",
  };
  const fingerprint = scannerCandidateFingerprint(base);
  assert.equal(fingerprint, scannerCandidateFingerprint(base));
  assert.notEqual(
    fingerprint,
    scannerCandidateFingerprint({ ...base, accountId: "mt5-account-b" }),
  );
  assert.notEqual(
    fingerprint,
    scannerCandidateFingerprint({ ...base, provider: "twelvedata" }),
  );
});
