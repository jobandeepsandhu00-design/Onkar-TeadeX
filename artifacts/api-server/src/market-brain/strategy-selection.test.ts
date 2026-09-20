import assert from "node:assert/strict";
import test from "node:test";
import type { VersionRow } from "./store";
import { latestApprovedVersions } from "./strategy-selection";

const row = (
  id: string,
  setup: string,
  created: string,
  approval: "approved" | "draft" = "approved",
) =>
  ({
    id,
    source_setup_id: setup,
    name: id,
    created_at: created,
    definition: { approval },
  }) as VersionRow;

test("automatic setup selection keeps only the newest approved version", () => {
  const selected = latestApprovedVersions([
    row("old", "setup-a", "2026-01-01T00:00:00Z"),
    row("draft", "setup-a", "2026-03-01T00:00:00Z", "draft"),
    row("latest", "setup-a", "2026-02-01T00:00:00Z"),
    row("other", "setup-b", "2026-01-15T00:00:00Z"),
  ]);
  assert.deepEqual(
    selected.map((version) => version.id),
    ["latest", "other"],
  );
});
