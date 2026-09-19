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
      {
        id: "trend",
        type: "condition",
        content: "Higher timeframe bullish trend",
      },
      { id: "zone", type: "condition", content: "Price inside demand zone" },
      { id: "news", type: "no_trade", content: "News must be clear" },
      { id: "rr", type: "risk", content: "Minimum R:R 2" },
      {
        id: "manual",
        type: "condition",
        content: "Wait for my discretionary confirmation",
      },
    ],
  });
  assert.ok(compiled);
  assert.equal(compiled.approval, "ai_extracted");
  assert.equal(compiled.timeframe, "30m");
  assert.equal(compiled.direction, "long");
  assert.equal(
    compiled.rules.find((rule) => rule.id === "manual")?.feature,
    "manualConfirmation",
  );
  assert.equal(compiled.rules.find((rule) => rule.id === "manual")?.weight, 0);
});

test("all 16 canonical workflows compile to closed-candle machine gates", () => {
  const names = [
    "Wickfill in Range",
    "Breakout A+",
    "Breakout Impulse",
    "Breakout Small Body",
    "Breakout Wickfill",
    "Fakeout at S/R",
    "Pullback — S/R Formed",
    "Pullback Impulse A+ — With S/R",
    "Pullback Impulse — Without S/R",
    "Pullback Wickfill",
    "S/R Buy / Sell",
    "S/R Impulse",
    "Counter Buy / Sell",
    "Defended Breakout",
    "Breakout Big Body",
    "A+ Buy / Sell",
  ];
  for (const [index, name] of names.entries()) {
    const compiled = compileLibrarySetup({
      id: `workflow-${index + 1}`,
      name,
      direction: "Both",
      timeframe: "M30",
      session: "Any",
      rules: [
        { id: "source", type: "condition", content: "Source workflow rule" },
      ],
    });
    assert.ok(compiled, name);
    assert.equal(compiled.approval, "ai_extracted");
    assert.equal(compiled.timeframe, "30m");
    assert.equal(compiled.higherTimeframe, "4h");
    assert.equal(
      compiled.rules.find((rule) => rule.id === "canonical-pattern")?.feature,
      "setupPatternMatched",
    );
    assert.equal(
      compiled.rules.find((rule) => rule.id === "closed-entry-trigger")
        ?.required,
      true,
    );
  }
});

test("legacy split setup names map to their canonical workflow without auto-approval", () => {
  const compiled = compileLibrarySetup({
    id: "legacy-sr-buy",
    name: "S/R Buy",
    direction: "Buy",
    timeframe: "M30",
    rules: [
      { id: "source", type: "condition", content: "Fresh support forms" },
    ],
  });
  assert.ok(compiled);
  assert.equal(compiled.direction, "long");
  assert.equal(compiled.approval, "ai_extracted");
  assert.equal(compiled.rules[0]?.feature, "setupPatternMatched");
});
