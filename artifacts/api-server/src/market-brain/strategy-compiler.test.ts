import test from "node:test";
import assert from "node:assert/strict";
import { compileLibrarySetup } from "./strategy-compiler";

test("Setup Library rules compile into a review-required machine version", () => {
  const compiled = compileLibrarySetup({
    id: "src-1",
    name: "SRC Support Rejection",
    direction: "Buy",
    timeframe: "M30",
    session: "London",
    rules: [
      { id: "trend", type: "condition", content: "Higher timeframe bullish trend" },
      { id: "zone", type: "condition", content: "Price inside demand zone" },
      { id: "news", type: "no_trade", content: "News must be clear" },
      { id: "rr", type: "risk", content: "Minimum R:R 2" },
      { id: "manual", type: "condition", content: "Wait for my discretionary confirmation" },
    ],
  });
  assert.ok(compiled);
  assert.equal(compiled.approval, "ai_extracted");
  assert.equal(compiled.timeframe, "30m");
  assert.equal(compiled.direction, "long");
  assert.equal(compiled.rules.find((rule) => rule.id === "manual")?.feature, "manualConfirmation");
  assert.equal(compiled.rules.find((rule) => rule.id === "manual")?.weight, 0);
});

