import { useEffect, useRef, useState } from "react";
import type { Agent3DState } from "./types";

/** Coordinates request/stream lifecycles without owning business logic. */
export function useAgentStateController(initial: Agent3DState = "idle") {
  const [state, setState] = useState<Agent3DState>(initial);
  const completionTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
  }, []);

  const complete = (result: "success" | "warning" = "success", holdMs = 1400) => {
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
    setState(result);
    completionTimer.current = window.setTimeout(() => setState("idle"), holdMs);
  };

  return {
    state,
    setIdle: () => setState("idle"),
    listen: () => setState("listening"),
    think: () => setState("thinking"),
    scan: () => setState("scanning"),
    speak: () => setState("speaking"),
    warn: () => setState("warning"),
    alert: () => setState("alert"),
    offline: () => setState("offline"),
    complete,
  };
}

