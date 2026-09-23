import test from "node:test";
import assert from "node:assert/strict";
import { nextCandidateCloseAt } from "./candidate-timing";

test("the next 30M close follows the last evaluated closed candle", () => {
  assert.equal(
    nextCandidateCloseAt("2026-09-23T09:00:00.000Z", "30m"),
    Date.parse("2026-09-23T10:00:00.000Z"),
  );
});

test("the same open-time rule works for every scanner timeframe", () => {
  assert.equal(
    nextCandidateCloseAt("2026-09-23T08:00:00.000Z", "1h"),
    Date.parse("2026-09-23T10:00:00.000Z"),
  );
  assert.equal(
    nextCandidateCloseAt("2026-09-23T04:00:00.000Z", "4h"),
    Date.parse("2026-09-23T12:00:00.000Z"),
  );
  assert.equal(nextCandidateCloseAt("bad timestamp", "30m"), null);
  assert.equal(nextCandidateCloseAt("2026-09-23T09:00:00Z", "bad"), null);
});
