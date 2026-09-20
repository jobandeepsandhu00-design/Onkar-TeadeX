import test from "node:test";
import assert from "node:assert/strict";
import { scannerRuntimeSchema } from "@workspace/api-zod";

test("scanner runtime accepts Supabase timestamptz offsets", () => {
  const runtime = scannerRuntimeSchema.parse({
    reconciledAt: "2026-09-20T12:00:00+00:00",
    updatedAt: "2026-09-20T12:00:01+00:00",
  });

  assert.equal(runtime.reconciledAt, "2026-09-20T12:00:00+00:00");
  assert.equal(runtime.updatedAt, "2026-09-20T12:00:01+00:00");
});

test("scanner runtime keeps Z timestamps and null defaults", () => {
  const runtime = scannerRuntimeSchema.parse({
    updatedAt: "2026-09-20T12:00:00Z",
  });

  assert.equal(runtime.reconciledAt, null);
  assert.equal(runtime.updatedAt, "2026-09-20T12:00:00Z");
});
