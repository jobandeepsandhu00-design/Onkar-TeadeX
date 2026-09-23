import assert from "node:assert/strict";
import test from "node:test";
import { orderExecutionCandidates } from "./execution-queue";

test("a blocked READY setup cannot starve an untried setup", () => {
  const ready = [{ id: "first" }, { id: "second" }];
  const ordered = orderExecutionCandidates(
    ready,
    [{ candidate_id: "first", created_at: "2026-09-23T11:31:00Z" }],
    new Set(),
  );
  assert.deepEqual(
    ordered.map((candidate) => candidate.id),
    ["second", "first"],
  );
});

test("already executed candidates are not selected again", () => {
  const ordered = orderExecutionCandidates(
    [{ id: "first" }, { id: "second" }],
    [],
    new Set(["first"]),
  );
  assert.deepEqual(
    ordered.map((candidate) => candidate.id),
    ["second"],
  );
});
