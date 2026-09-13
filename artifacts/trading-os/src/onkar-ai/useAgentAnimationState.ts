import { useSyncExternalStore } from "react";
import type { AgentId } from "./agent-data";
import { agentRuntime } from "./agent-runtime";

export function useAgentAnimationState(agentId: AgentId) {
  return useSyncExternalStore(
    agentRuntime.subscribe,
    () => agentRuntime.snapshot(agentId),
    () => agentRuntime.snapshot(agentId),
  );
}

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};
export function useDocumentVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => false,
  );
}

let motionQuery: MediaQueryList | undefined;
const motionListeners = new Set<() => void>();
const notifyMotion = () => motionListeners.forEach((notify) => notify());
const query = () =>
  (motionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)"));
const subscribeMotion = (notify: () => void) => {
  if (!motionListeners.size) query().addEventListener("change", notifyMotion);
  motionListeners.add(notify);
  return () => {
    motionListeners.delete(notify);
    if (!motionListeners.size)
      query().removeEventListener("change", notifyMotion);
  };
};
/** Unlike the installed Motion hook, this also reacts to OS preference changes mid-session. */
export function useReducedMotionPreference() {
  return useSyncExternalStore(
    subscribeMotion,
    () => query().matches,
    () => true,
  );
}
