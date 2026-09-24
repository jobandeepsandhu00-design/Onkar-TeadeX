import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateRow } from "../market-brain/store";
import { selectLiveCandidate } from "./candidate-selection";
import { validAgentReviews } from "./synthesis";

const now = Date.parse("2026-09-24T10:00:00Z");
const candidate = (
  id: string,
  state: CandidateRow["state"],
  score: number,
  extra: Partial<CandidateRow> = {},
): CandidateRow => ({
  id,
  config_id: "current-config",
  symbol: "GBPJPY",
  timeframe: "30m",
  state,
  score,
  expires_at: "2026-09-24T11:00:00Z",
  last_candle_at: "2026-09-24T09:30:00Z",
  updated_at: "2026-09-24T09:31:00Z",
  ...extra,
} as CandidateRow);

test("Master AI selects the strongest current setup, not the newest zero-score row", () => {
  const rows = [
    candidate("newest", "SCANNING", 0, { updated_at: "2026-09-24T09:59:00Z" }),
    candidate("ready", "READY", 100),
    candidate("other-config", "READY", 100, { config_id: "other-config" }),
  ];
  assert.equal(selectLiveCandidate(rows, { configId: "current-config", symbol: "GBPJPY", now })?.id, "ready");
});

test("expired and terminal candidates never become live Master AI evidence", () => {
  const rows = [
    candidate("expired", "READY", 100, { expires_at: "2026-09-24T09:59:00Z" }),
    candidate("closed", "COMPLETED", 100),
  ];
  assert.equal(selectLiveCandidate(rows, { symbol: "GBPJPY", now }), undefined);
  assert.equal(selectLiveCandidate(rows, { candidateId: "expired", now })?.id, "expired");
});

test("a requested timeframe wins when active evidence exists for it", () => {
  const rows = [
    candidate("thirty", "READY", 100),
    candidate("fifteen", "WATCH", 80, { timeframe: "15m" }),
  ];
  assert.equal(selectLiveCandidate(rows, { timeframe: "15m", now })?.id, "fifteen");
});

test("model reviews can annotate only requested agents once", () => {
  const reviews = validAgentReviews([
    { agent: "setup", review: " Waiting for a closed candle. " },
    { agent: "setup", review: "Duplicate" },
    { agent: "execution", review: "Unrequested" },
    { agent: "unknown", review: "Invented" },
  ], ["setup", "risk"]);
  assert.deepEqual(reviews, [{ agent: "setup", review: "Waiting for a closed candle." }]);
});
