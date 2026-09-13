import assert from "node:assert/strict";
import test from "node:test";
import {
  agentProgressEventSchema,
  type AgentProgressEvent,
} from "@workspace/api-zod";
import { runMasterAI } from "./orchestrator";
import { ScannerStore } from "../market-brain/store";

test("real orchestration emits only operational states and never speaks without playback", async (context) => {
  const prior = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  context.after(() => {
    if (prior === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prior;
  });
  // Prevent all external persistence and network access in this integration test.
  context.mock.method(ScannerStore, "service", () => {
    throw new Error("Test persistence disabled");
  });
  const user = {
    source: async () => ({ trades: [], setups: [] }),
    request: async () => [],
  } as unknown as ScannerStore;
  const events: AgentProgressEvent[] = [];
  const result = await runMasterAI({
    identity: { userId: "test-user" },
    user,
    input: { question: "Review my trading performance", deepAnalysis: false },
    onProgress(event) {
      events.push(agentProgressEventSchema.parse(event));
    },
  });
  assert.equal(result.animationStates.master, "idle");
  assert.ok(
    events.some(
      (event) => event.agent === "journal" && event.state === "reviewing",
    ),
  );
  assert.ok(
    events.some(
      (event) => event.agent === "insight" && event.state === "unavailable",
    ),
  );
  assert.ok(
    events.every(
      (event) => !["trend", "zone", "execution"].includes(event.agent),
    ),
  );
  assert.ok(events.every((event) => event.state !== "speaking"));
  assert.equal(events.at(-1)?.state, "idle");
  assert.ok(events.every((event) => event.runId === result.runId));
});
