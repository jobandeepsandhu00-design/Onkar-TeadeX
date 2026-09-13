import type { AgentId } from "./agent-data";

export type AnimationState =
  | "idle"
  | "listening"
  | "thinking"
  | "scanning"
  | "speaking"
  | "success"
  | "warning"
  | "alert"
  | "offline";
export type AgentAnimationSnapshot = {
  state: AnimationState;
  statusLabel: string;
  confirmed: boolean;
  isSpeaking: boolean;
  isWorking: boolean;
  progress: number | null;
  error: string | null;
};
export const AGENT_IDS: AgentId[] = [
  "master",
  "trend",
  "zone",
  "setup",
  "risk",
  "news",
  "backtest",
  "journal",
  "insight",
  "execution",
];
const preview: AgentAnimationSnapshot = Object.freeze({
  state: "idle",
  statusLabel: "Preview",
  confirmed: false,
  isSpeaking: false,
  isWorking: false,
  progress: null,
  error: null,
});
const working = new Set([
  "thinking",
  "scanning",
  "mapping",
  "matching",
  "validating",
  "reviewing",
  "learning",
  "simulating",
  "delegating",
  "synthesizing",
  "checking",
  "monitoring",
]);
export function normalizeAnimationState(state: string): AnimationState {
  if (["mapping", "simulating", "monitoring", "checking"].includes(state))
    return "scanning";
  if (
    [
      "matching",
      "validating",
      "reviewing",
      "learning",
      "delegating",
      "synthesizing",
    ].includes(state)
  )
    return "thinking";
  if (["unavailable", "disabled"].includes(state)) return "offline";
  if (["error", "invalid"].includes(state)) return "warning";
  if (state === "complete") return "success";
  if (state === "active") return "idle";
  return [
    "idle",
    "listening",
    "thinking",
    "scanning",
    "speaking",
    "success",
    "warning",
    "alert",
    "offline",
  ].includes(state)
    ? (state as AnimationState)
    : "offline";
}

/** One in-memory runtime shared across routes. Never stores journal content or credentials. */
export function createAgentRuntime() {
  let run: string | null = null;
  const listeners = new Set<() => void>();
  const states = new Map<AgentId, AgentAnimationSnapshot>();
  const speech = new Map<AgentId, AgentAnimationSnapshot>();
  const timers = new Map<AgentId, ReturnType<typeof setTimeout>>();
  const operations = new Map<AgentId, string>();
  const emit = () => listeners.forEach((listener) => listener());
  const snapshot = (id: AgentId) => speech.get(id) ?? states.get(id) ?? preview;
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };
  const setState = (
    id: AgentId,
    value: string,
    confirmed: boolean,
    error: string | null = null,
  ) => {
    clearTimeout(timers.get(id));
    states.set(id, {
      state: normalizeAnimationState(value),
      statusLabel:
        value === "unavailable"
          ? "Unavailable"
          : value === "idle"
            ? "Ready for request"
            : value,
      confirmed,
      isSpeaking: false,
      isWorking: working.has(value),
      progress: null,
      error,
    });
    emit();
    if (value === "success")
      timers.set(
        id,
        setTimeout(() => setState(id, "idle", confirmed), 1400),
      );
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot,
    begin(token: string) {
      clearTimers();
      run = token;
      states.clear();
      setState("master", "thinking", false);
      states.set("master", {
        ...snapshot("master"),
        statusLabel: "Requesting analysis",
      });
      emit();
    },
    event(token: string, id: AgentId, value: string) {
      if (run !== token || !AGENT_IDS.includes(id)) return;
      setState(id, value, true);
    },
    operationStart(id: AgentId, token: string) {
      operations.set(id, token);
      setState(id, "thinking", false);
      states.set(id, {
        ...states.get(id)!,
        statusLabel: "Requesting analysis",
      });
      emit();
    },
    operationEnd(id: AgentId, token: string, success: boolean) {
      if (operations.get(id) !== token) return;
      operations.delete(id);
      setState(id, success ? "success" : "warning", success);
    },
    finish(token: string) {
      if (run !== token) return;
      run = null;
      for (const [id, state] of states)
        if (state.isWorking || id === "master")
          setState(id, "idle", state.confirmed);
    },
    fail(token: string, message: string) {
      if (run !== token) return;
      run = null;
      for (const [id, state] of states)
        if (state.isWorking) setState(id, "warning", state.confirmed, message);
    },
    listen(id: AgentId, listening: boolean) {
      if (run) return;
      if (listening)
        states.set(id, {
          ...preview,
          state: "listening",
          statusLabel: "Composing · microphone off",
        });
      else if (states.get(id)?.state === "listening") states.delete(id);
      emit();
    },
    speaking(id: AgentId, enabled: boolean) {
      if (enabled) {
        speech.clear();
        speech.set(id, {
          ...snapshot(id),
          state: "speaking",
          isSpeaking: true,
          statusLabel: "Speaking · device voice",
        });
      } else speech.delete(id);
      emit();
    },
    reset() {
      clearTimers();
      run = null;
      operations.clear();
      states.clear();
      speech.clear();
      emit();
    },
  };
}
export const agentRuntime = createAgentRuntime();
