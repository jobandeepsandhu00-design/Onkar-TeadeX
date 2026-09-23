import test from "node:test";
import assert from "node:assert/strict";
import { chooseOptionalCronStage } from "./cron-scheduling";

test("active scanner work never starts optional learning in the same cron tick", () => {
  assert.equal(chooseOptionalCronStage(0, 5_000, true), "deferred");
  assert.equal(chooseOptionalCronStage(0, 41_000, false), "deferred");
});

test("idle ticks alternate one learning or knowledge job", () => {
  assert.equal(chooseOptionalCronStage(0, 1_000, false), "learning");
  assert.equal(chooseOptionalCronStage(60_000, 61_000, false), "knowledge");
});
