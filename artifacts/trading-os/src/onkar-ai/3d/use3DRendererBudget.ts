import { useEffect, useRef, useState } from "react";

const MAX_ACTIVE_SCENES = 2;
const activeRenderers = new Set<symbol>();
const listeners = new Set<() => void>();

function announceAvailability() {
  for (const listener of listeners) listener();
}

/** Prevents a dashboard viewport from mounting ten independent WebGL canvases. */
export function use3DRendererBudget(eligible: boolean) {
  const token = useRef(Symbol("onkar-agent-renderer"));
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const current = token.current;
    const tryAcquire = () => {
      if (!eligible || activeRenderers.has(current)) return;
      if (activeRenderers.size >= MAX_ACTIVE_SCENES) return;
      activeRenderers.add(current);
      setGranted(true);
    };

    if (!eligible) {
      if (activeRenderers.delete(current)) announceAvailability();
      setGranted(false);
      return;
    }

    listeners.add(tryAcquire);
    tryAcquire();
    return () => {
      listeners.delete(tryAcquire);
      if (activeRenderers.delete(current)) announceAvailability();
    };
  }, [eligible]);

  return granted;
}

