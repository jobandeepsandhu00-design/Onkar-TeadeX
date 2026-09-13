import assert from "node:assert/strict";
import test from "node:test";
import { planMasterRequest } from "./planner";

test("performance questions route to journal instead of every agent", () => {
  const plan = planMasterRequest("Analyze my performance and biggest mistake");
  assert.equal(plan.intent, "journal_review");
  assert.deepEqual(plan.agents, ["journal", "insight"]);
});

test("live symbol requests select required market specialists", () => {
  const plan = planMasterRequest("Analyze XAUUSD on 15m");
  assert.equal(plan.intent, "live_market");
  assert.equal(plan.symbol, "XAUUSD");
  assert.equal(plan.timeframe, "15m");
  assert.ok(plan.agents.includes("trend"));
  assert.ok(plan.agents.includes("news"));
});

test("strategy questions do not invoke market agents", () => {
  const plan = planMasterRequest("What are my SRC strategy rules?");
  assert.equal(plan.intent, "strategy_question");
  assert.deepEqual(plan.agents, ["setup", "insight"]);
});
