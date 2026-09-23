import assert from "node:assert/strict";
import test from "node:test";
import { confirmationAfterSourceActivation } from "./execution-candle";

test("a candle that closes after AUTO activation is eligible", () => {
  assert.equal(
    confirmationAfterSourceActivation(
      "2026-09-23T11:00:00.000Z",
      "30m",
      "2026-09-23T11:20:00.000Z",
    ),
    true,
  );
});

test("a signal confirmed before AUTO activation remains ineligible", () => {
  assert.equal(
    confirmationAfterSourceActivation(
      "2026-09-23T11:00:00.000Z",
      "30m",
      "2026-09-23T11:31:00.000Z",
    ),
    false,
  );
});

test("invalid timestamps and timeframes fail closed", () => {
  assert.equal(
    confirmationAfterSourceActivation("bad", "30m", "2026-09-23T11:20:00Z"),
    false,
  );
  assert.equal(
    confirmationAfterSourceActivation(
      "2026-09-23T11:00:00Z",
      "bad",
      "2026-09-23T11:20:00Z",
    ),
    false,
  );
});
