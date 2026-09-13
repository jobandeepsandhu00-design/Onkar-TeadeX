import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_IDS,
  agentRuntime,
  createAgentRuntime,
  normalizeAnimationState,
} from "../agent-runtime";
import {
  createAgentVoiceManager,
  type AgentVoiceProvider,
} from "../agent-voice";
import { ROBOT_PROFILES } from "../robot-profiles";
import { readMasterStream } from "../read-master-stream";
import type { MasterAIResponse } from "@workspace/api-zod";

test("all ten agents have individually aligned eye masks, head masks and chest coordinates", () => {
  assert.equal(Object.keys(ROBOT_PROFILES).length, 10);
  for (const id of AGENT_IDS) {
    const profile = ROBOT_PROFILES[id];
    assert.equal(profile.eyes.length, 2);
    assert.ok(profile.head.startsWith("polygon("));
    for (const eye of profile.eyes)
      assert.ok(eye.center.every((value) => value > 0 && value < 720));
    assert.ok(profile.chest.every((value) => value > 0 && value < 720));
  }
});
test("runtime never randomly activates specialists; ignores stale requests", () => {
  const runtime = createAgentRuntime();
  runtime.begin("first");
  assert.equal(runtime.snapshot("master").confirmed, false);
  assert.equal(runtime.snapshot("trend").statusLabel, "Preview");
  runtime.begin("second");
  runtime.event("first", "trend", "scanning");
  assert.equal(runtime.snapshot("trend").statusLabel, "Preview");
  runtime.event("second", "journal", "reviewing");
  assert.equal(runtime.snapshot("journal").isWorking, true);
  runtime.event("second", "news", "unavailable");
  runtime.finish("second");
  assert.equal(runtime.snapshot("master").state, "idle");
  assert.equal(runtime.snapshot("news").state, "offline");
  assert.equal(runtime.snapshot("execution").statusLabel, "Preview");
  runtime.reset();
});
test("all lifecycle states normalize without inventing execution or microphone activity", () => {
  for (const id of AGENT_IDS) {
    const runtime = createAgentRuntime();
    runtime.begin(id);
    for (const state of [
      "idle",
      "listening",
      "thinking",
      "scanning",
      "speaking",
      "success",
      "warning",
      "alert",
      "offline",
    ]) {
      runtime.event(id, id, state);
      assert.equal(runtime.snapshot(id).state, state);
    }
    runtime.reset();
    runtime.listen(id, true);
    assert.match(runtime.snapshot(id).statusLabel, /microphone off/);
    runtime.reset();
  }
  assert.equal(normalizeAnimationState("mapping"), "scanning");
  assert.equal(normalizeAnimationState("reviewing"), "thinking");
  assert.equal(normalizeAnimationState("nonsense"), "offline");
});
test("success fades to idle and runtime reset clears delayed state", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const runtime = createAgentRuntime();
  runtime.begin("test");
  runtime.event("test", "trend", "success");
  context.mock.timers.tick(1401);
  assert.equal(runtime.snapshot("trend").state, "idle");
  runtime.event("test", "trend", "success");
  runtime.reset();
  context.mock.timers.tick(1500);
  assert.equal(runtime.snapshot("trend").statusLabel, "Preview");
});
test("speech overlays work state and returns to the actual underlying state", () => {
  const runtime = createAgentRuntime();
  runtime.begin("test");
  runtime.event("test", "master", "thinking");
  runtime.speaking("master", true);
  assert.equal(runtime.snapshot("master").state, "speaking");
  runtime.event("test", "master", "idle");
  runtime.speaking("master", false);
  assert.equal(runtime.snapshot("master").state, "idle");
  runtime.reset();
});
test("one voice at a time; starts only on playback, auto-speak defaults OFF, late callbacks ignored", () => {
  let callbacks: Parameters<AgentVoiceProvider["speak"]>[3] | undefined;
  const provider: AgentVoiceProvider = {
    available: () => true,
    speak(_id, _text, _settings, next) {
      callbacks = next;
    },
    stop() {},
  };
  const voice = createAgentVoiceManager(provider);
  assert.equal(voice.getSnapshot().settings.autoSpeak, false);
  assert.equal(voice.speak("master", "Test", true), false);
  voice.speak("master", "Test");
  assert.equal(voice.isSpeaking("master"), false);
  callbacks!.start();
  assert.equal(voice.isSpeaking("master"), true);
  const old = callbacks!;
  voice.speak("insight", "New speech");
  callbacks!.start();
  old.end();
  assert.equal(voice.isSpeaking("insight"), true);
  assert.equal(agentRuntime.snapshot("master").isSpeaking, false);
  callbacks!.end();
  assert.equal(voice.getSnapshot().agent, null);
  voice.configure({ volume: 9 });
  assert.equal(voice.getSnapshot().settings.volume, 1);
  voice.configure({ volume: -2 });
  assert.equal(voice.getSnapshot().settings.volume, 0);
  assert.equal(voice.speak("journal", "Muted"), false);
  voice.stop();
  agentRuntime.reset();
});
test("speech failure or unsupported browsers cannot leave an avatar speaking", () => {
  const voice = createAgentVoiceManager({
    available: () => false,
    speak() {},
    stop() {},
  });
  assert.equal(voice.speak("master", "Test"), false);
  assert.match(voice.getSnapshot().error!, /does not support/);
  assert.equal(voice.getSnapshot().agent, null);
  const failure = createAgentVoiceManager({
    available: () => true,
    speak(_a, _t, _s, callbacks) {
      callbacks.error("Device failed");
    },
    stop() {},
  });
  failure.speak("journal", "Test");
  assert.equal(failure.getSnapshot().agent, null);
  assert.equal(failure.getSnapshot().error, "Device failed");
  failure.stop();
});
const runId = "76129217-b596-4fb7-b7ae-cf811820ca20";
const response: MasterAIResponse = {
  runId,
  intent: "journal_review",
  answer: "Test evidence only",
  dataStatus: "unavailable",
  agents: [],
  commandLog: [],
  usage: { model: null, inputTokens: 0, outputTokens: 0 },
  animationStates: Object.fromEntries(
    AGENT_IDS.map((id) => [id, "idle"]),
  ) as MasterAIResponse["animationStates"],
};
const stream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      for (let index = 0; index < bytes.length; index += 7)
        controller.enqueue(bytes.slice(index, index + 7));
      controller.close();
    },
  });
test("operational stream supports fragmented frames and validates terminal result", async () => {
  const event = {
    type: "agent-state",
    runId,
    agent: "journal",
    state: "reviewing",
    timestamp: new Date().toISOString(),
  };
  const received: string[] = [];
  const result = await readMasterStream(
    stream(
      `data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify({ type: "result", data: response })}\n\n`,
    ),
    (item) => received.push(item.agent),
  );
  assert.deepEqual(received, ["journal"]);
  assert.equal(result.answer, response.answer);
});
test("incomplete, invalid and error streams never report success", async () => {
  await assert.rejects(
    readMasterStream(stream(": heartbeat\n\n")),
    /before completion/,
  );
  await assert.rejects(
    readMasterStream(stream('data: {"type":"result","data":{}}\n\n')),
    /Invalid analysis/,
  );
  await assert.rejects(
    readMasterStream(
      stream('data: {"type":"error","error":"Unavailable"}\n\n'),
    ),
    /Unavailable/,
  );
});
