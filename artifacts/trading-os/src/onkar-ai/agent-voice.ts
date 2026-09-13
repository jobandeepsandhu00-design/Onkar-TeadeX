import type { AgentId } from "./agent-data";
import { agentRuntime } from "./agent-runtime";

export type VoiceSettings = {
  enabled: boolean;
  autoSpeak: boolean;
  rate: "slow" | "normal" | "fast";
  volume: number;
};
type VoiceSnapshot = {
  settings: VoiceSettings;
  agent: AgentId | null;
  pending: boolean;
  error: string | null;
};
type VoiceCallbacks = {
  start(): void;
  end(): void;
  error(message: string): void;
};
export interface AgentVoiceProvider {
  available(): boolean;
  speak(
    agent: AgentId,
    text: string,
    settings: VoiceSettings,
    callbacks: VoiceCallbacks,
  ): void;
  stop(): void;
}
const defaults: VoiceSettings = {
  enabled: true,
  autoSpeak: false,
  rate: "normal",
  volume: 0.8,
};
const personality: Record<AgentId, [number, number]> = {
  master: [0.92, 0.86],
  trend: [1, 0.96],
  zone: [0.96, 0.96],
  setup: [1.02, 1],
  risk: [0.94, 0.9],
  news: [1, 1],
  backtest: [0.98, 0.94],
  journal: [0.9, 1.04],
  insight: [0.98, 1.08],
  execution: [1.02, 0.9],
};

/** Browser synthesis has no accessible audio samples: avatar waveform is procedural, not lip-sync. */
export class BrowserAgentVoiceProvider implements AgentVoiceProvider {
  private utterance: SpeechSynthesisUtterance | null = null;
  available() {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window
    );
  }
  stop() {
    if (this.available()) window.speechSynthesis.cancel();
    this.utterance = null;
  }
  speak(
    agent: AgentId,
    text: string,
    settings: VoiceSettings,
    callbacks: VoiceCallbacks,
  ) {
    const utterance = new SpeechSynthesisUtterance(text);
    this.utterance = utterance; // Retain through asynchronous Safari speech callbacks.
    const voices = window.speechSynthesis.getVoices(); // Re-read on every request; voices load asynchronously.
    const language = navigator.language || "en";
    // Reports are currently English. Prefer local English voices, otherwise the system default.
    const english = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang));
    utterance.voice =
      english.find((voice) => voice.localService && voice.lang === language) ??
      english.find((voice) => voice.localService) ??
      english[0] ??
      voices.find((voice) => voice.default) ??
      null;
    utterance.lang = utterance.voice?.lang ?? "en-US";
    utterance.rate =
      { slow: 0.82, normal: 1, fast: 1.18 }[settings.rate] *
      personality[agent][0];
    utterance.pitch = personality[agent][1];
    utterance.volume = settings.volume;
    utterance.onstart = callbacks.start;
    utterance.onend = callbacks.end;
    utterance.onerror = (event) =>
      callbacks.error(
        event.error === "not-allowed"
          ? "Tap Read aloud to allow voice on this device."
          : "Device voice is unavailable. You can still read the response.",
      );
    window.speechSynthesis.speak(utterance);
  }
}

export function createAgentVoiceManager(provider: AgentVoiceProvider) {
  let snapshot: VoiceSnapshot = {
    settings: { ...defaults },
    agent: null,
    pending: false,
    error: null,
  };
  let generation = 0,
    initialized = false;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<VoiceSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((fn) => fn());
  };
  const stop = (agent?: AgentId) => {
    if (agent && snapshot.agent !== agent) return;
    generation++;
    clearTimeout(startupTimer);
    clearTimeout(endTimer);
    if (snapshot.agent) agentRuntime.speaking(snapshot.agent, false);
    provider.stop();
    update({ agent: null, pending: false });
  };
  const manager = {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
    available: () => provider.available(),
    initialize() {
      if (initialized || typeof window === "undefined") return;
      initialized = true;
      try {
        const saved = JSON.parse(
          localStorage.getItem("onkar-agent-voice-v1") || "null",
        );
        if (saved) manager.configure(saved);
      } catch {
        /* Private browsing/storage denial must not break avatars. */
      }
      window.addEventListener("pagehide", () => stop());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop();
      });
      window.addEventListener("onkar-session-ended", () => {
        stop();
        agentRuntime.reset();
      });
    },
    configure(patch: Partial<VoiceSettings>) {
      const settings = { ...snapshot.settings };
      if (typeof patch.enabled === "boolean") settings.enabled = patch.enabled;
      if (typeof patch.autoSpeak === "boolean")
        settings.autoSpeak = patch.autoSpeak;
      if (["slow", "normal", "fast"].includes(patch.rate ?? ""))
        settings.rate = patch.rate!;
      if (typeof patch.volume === "number" && Number.isFinite(patch.volume))
        settings.volume = Math.min(1, Math.max(0, patch.volume));
      if (!settings.enabled || settings.volume === 0) stop();
      update({ settings });
      try {
        localStorage.setItem("onkar-agent-voice-v1", JSON.stringify(settings));
      } catch {
        /* Optional preference only. */
      }
    },
    speak(agent: AgentId, text: string, automatic = false) {
      manager.initialize();
      if (
        !snapshot.settings.enabled ||
        snapshot.settings.volume === 0 ||
        (automatic && !snapshot.settings.autoSpeak) ||
        !text.trim()
      )
        return false;
      stop();
      if (!provider.available()) {
        update({ error: "This browser does not support device voice." });
        return false;
      }
      const token = ++generation;
      update({ agent, pending: true, error: null });
      const finish = (error: string | null = null) => {
        if (token !== generation) return;
        stop();
        update({ error });
      };
      startupTimer = setTimeout(
        () =>
          finish(
            "Voice did not start. Tap Read aloud to retry on this device.",
          ),
        8000,
      );
      endTimer = setTimeout(
        () => finish("Voice stopped after the playback time limit."),
        240_000,
      );
      try {
        provider.speak(
          agent,
          text.replace(/[#*_`]/g, "").slice(0, 6000),
          snapshot.settings,
          {
            start() {
              if (token !== generation) return;
              clearTimeout(startupTimer);
              agentRuntime.speaking(agent, true);
              update({ pending: false });
            },
            end() {
              finish();
            },
            error(message) {
              finish(message);
            },
          },
        );
      } catch {
        finish(
          "Device voice could not start. Your text response remains available.",
        );
        return false;
      }
      return true;
    },
    stop,
    isSpeaking: (agent: AgentId) =>
      snapshot.agent === agent && !snapshot.pending,
  };
  return manager;
}
export const agentVoice = createAgentVoiceManager(
  new BrowserAgentVoiceProvider(),
);
