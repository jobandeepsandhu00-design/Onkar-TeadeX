import { createHash, timingSafeEqual } from "node:crypto";

const FINGERPRINT = /^[a-f0-9]{64}$/;

/**
 * Produce a stable app account id without exposing the bridge fingerprint.
 * The fingerprint is already an HMAC, and this domain-separated digest keeps
 * the browser-visible journal id distinct from that server-only identity.
 */
export function mt5JournalAccountId(accountFingerprint: string) {
  if (!FINGERPRINT.test(accountFingerprint))
    throw new Error("MT5 account fingerprint is invalid");
  return `mt5-${createHash("sha256")
    .update("onkar-mt5-journal-account-v1\0")
    .update(accountFingerprint)
    .digest("hex")
    .slice(0, 32)}`;
}

export type MT5AccountBinding = {
  selected_account_id: string;
  account_fingerprint: string;
};

export type MT5CandidateProvenance = {
  candidate_id: string;
  candidate_last_candle_at: string;
  selected_account_id: string;
  account_fingerprint: string;
  broker_symbol: string;
};

export function mt5FingerprintsMatch(
  expected: string | null | undefined,
  actual: string | null | undefined,
) {
  if (
    !expected ||
    !actual ||
    !FINGERPRINT.test(expected) ||
    !FINGERPRINT.test(actual)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(actual, "hex"),
  );
}

/** Exact, constant-time comparison; malformed or missing identities fail closed. */
export function mt5AccountBindingMatches(
  binding: MT5AccountBinding | null | undefined,
  selectedAccountId: string | null | undefined,
  connectedFingerprint: string | null | undefined,
) {
  if (
    !binding ||
    !selectedAccountId ||
    binding.selected_account_id !== selectedAccountId ||
    !FINGERPRINT.test(binding.account_fingerprint) ||
    !connectedFingerprint ||
    !FINGERPRINT.test(connectedFingerprint)
  )
    return false;
  return mt5FingerprintsMatch(
    binding.account_fingerprint,
    connectedFingerprint,
  );
}

/**
 * A scan is trusted only when one selected app account stayed bound to one
 * connected terminal identity for the complete broker-data read.
 */
export function mt5ScanAccountMatches(
  binding: MT5AccountBinding | null | undefined,
  selectedAccountId: string | null | undefined,
  beforeFingerprint: string | null | undefined,
  afterFingerprint: string | null | undefined,
) {
  return (
    mt5AccountBindingMatches(binding, selectedAccountId, beforeFingerprint) &&
    mt5AccountBindingMatches(binding, selectedAccountId, afterFingerprint) &&
    mt5FingerprintsMatch(beforeFingerprint, afterFingerprint)
  );
}

/**
 * AUTO may execute only the exact candidate/account/terminal identity that
 * produced the candidate's MT5 candles. All malformed or missing values fail
 * closed and comparisons of the opaque HMAC use constant-time equality.
 */
export function mt5CandidateProvenanceMatches(
  provenance: MT5CandidateProvenance | null | undefined,
  binding: MT5AccountBinding | null | undefined,
  candidateId: string | null | undefined,
  candidateLastCandleAt: string | null | undefined,
  selectedAccountId: string | null | undefined,
  connectedFingerprint: string | null | undefined,
  connectedBrokerSymbol: string | null | undefined,
) {
  const expectedCandleAt = Date.parse(candidateLastCandleAt || "");
  const provenanceCandleAt = Date.parse(
    provenance?.candidate_last_candle_at || "",
  );
  if (
    !provenance ||
    !candidateId ||
    provenance.candidate_id !== candidateId ||
    !Number.isFinite(expectedCandleAt) ||
    !Number.isFinite(provenanceCandleAt) ||
    provenanceCandleAt !== expectedCandleAt ||
    provenance.selected_account_id !== selectedAccountId ||
    !provenance.broker_symbol ||
    !connectedBrokerSymbol ||
    provenance.broker_symbol !== connectedBrokerSymbol
  )
    return false;
  return (
    mt5AccountBindingMatches(
      binding,
      selectedAccountId,
      connectedFingerprint,
    ) &&
    mt5FingerprintsMatch(
      provenance.account_fingerprint,
      binding?.account_fingerprint,
    ) &&
    mt5FingerprintsMatch(provenance.account_fingerprint, connectedFingerprint)
  );
}
