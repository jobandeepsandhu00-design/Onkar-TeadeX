import assert from "node:assert/strict";
import test from "node:test";
import { paperCandidateBlockers } from "./paper-readiness";

const closedCandle = {
  last_candle_at: "2026-09-21T13:00:00.000Z",
  timeframe: "30m",
  payload: {
    stale: false,
    risk: { allowed: true, warnings: [] as string[] },
    paperFastEntryApplied: false,
    news: { status: "safe" },
  },
};

test("Paper dry-run uses the confirmation close, not candle open", () => {
  assert.deepEqual(
    paperCandidateBlockers(
      closedCandle,
      "2026-09-21T13:15:00.000Z",
      false,
      true,
    ),
    [],
  );
  assert.match(
    paperCandidateBlockers(
      closedCandle,
      "2026-09-21T13:31:00.000Z",
      false,
      true,
    )[0],
    /before the Paper source/,
  );
});

test("Paper dry-run reports every independent safety blocker without placing an order", () => {
  const blockers = paperCandidateBlockers(
    {
      ...closedCandle,
      payload: {
        stale: true,
        risk: { allowed: false, warnings: ["Daily risk limit reached"] },
        paperFastEntryApplied: true,
        news: { status: "blocked" },
      },
    },
    "2026-09-21T13:15:00.000Z",
    false,
    true,
  );
  assert.deepEqual(blockers, [
    "Scanner candle evidence is stale",
    "Risk approval is missing",
    "Daily risk limit reached",
    "Paper Fast Entry was switched off after confirmation",
    "News clearance is blocked",
  ]);
});
