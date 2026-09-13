import type { AgentId } from "./agent-data";
import { agentRuntime } from "./agent-runtime";

export const KOKORO_MALE_VOICES = [
  { id: "bm_george", label: "George · British professional" },
  { id: "bm_daniel", label: "Daniel · British calm" },
  { id: "am_michael", label: "Michael · American composed" },
  { id: "am_adam", label: "Adam · American authoritative" },
] as const;

export type KokoroVoiceId = (typeof KOKORO_MALE_VOICES)[number]["id"];
export type VoiceSettings = {
  enabled: boolean;
  autoSpeak: boolean;
  rate: "slow" | "normal" | "fast";
  volume: number;
  voice: KokoroVoiceId;
};
export type VoiceEngineState =
  | "idle"
  | "loading"
  | "webgpu"
  | "wasm"
  | "unavailable";
type VoiceSnapshot = {
  settings: VoiceSettings;
  agent: "master" | null;
  pending: boolean;
  queueLength: number;
  engine: VoiceEngineState;
  progress: number | null;
  error: string | null;
};
type VoiceCallbacks = {
  start(): void;
  end(): void;
  error(message: string): void;
  status?(engine: VoiceEngineState, progress?: number): void;
};
export interface AgentVoiceProvider {
  available(): boolean;
  speak(
    agent: "master",
    text: string,
    settings: VoiceSettings,
    callbacks: VoiceCallbacks,
  ): void;
  stop(): void;
}
export type MasterAlertSpeech = {
  key: string;
  candidateId: string;
  text: string;
  priority?: number;
};

const defaults: VoiceSettings = {
  enabled: true,
  autoSpeak: false,
  rate: "normal",
  volume: 0.8,
  voice: "bm_george",
};
const speed: Record<VoiceSettings["rate"], number> = {
  slow: 0.88,
  normal: 1,
  fast: 1.12,
};

type WorkerResponse =
  | {
      type: "status";
      id: string;
      phase: "loading" | "fallback";
      device: "webgpu" | "wasm";
      progress?: number;
    }
  | {
      type: "audio";
      id: string;
      device: "webgpu" | "wasm";
      buffer: ArrayBuffer;
    }
  | { type: "error"; id: string; message: string };

/** Kokoro inference runs in a worker. Model files are browser-cached; text/audio never reaches a TTS API. */
export class LocalKokoroVoiceProvider implements AgentVoiceProvider {
  private worker: Worker | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private activeId: string | null = null;
  private activeCallbacks: VoiceCallbacks | null = null;
  private volume = 0.8;
  private cache = new Map<string, Blob>();

  available() {
    return (
      typeof window !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof Audio !== "undefined"
    );
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), {
      type: "module",
      name: "onkar-kokoro-tts",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.id !== this.activeId || !this.activeCallbacks) return;
      if (message.type === "status") {
        this.activeCallbacks.status?.("loading", message.progress);
        return;
      }
      if (message.type === "error") {
        const callbacks = this.activeCallbacks;
        this.activeId = null;
        this.activeCallbacks = null;
        callbacks.error(
          `Local Kokoro voice is unavailable: ${message.message}. Notifications remain enabled.`,
        );
        return;
      }
      this.activeCallbacks.status?.(message.device);
      const blob = new Blob([message.buffer], { type: "audio/wav" });
      const cacheKey = this.activeId;
      if (cacheKey) {
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, blob);
        while (this.cache.size > 12)
          this.cache.delete(this.cache.keys().next().value!);
      }
      void this.play(blob);
    };
    this.worker.onerror = () => {
      const callbacks = this.activeCallbacks;
      this.resetWorker();
      callbacks?.error(
        "Local Kokoro worker stopped unexpectedly. Notifications remain enabled.",
      );
    };
    return this.worker;
  }

  private async play(blob: Blob) {
    const callbacks = this.activeCallbacks;
    if (!callbacks || !this.activeId) return;
    this.objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.objectUrl);
    this.audio = audio;
    audio.volume = this.volume;
    audio.onplay = callbacks.start;
    audio.onended = () => {
      this.releaseAudio();
      this.activeId = null;
      this.activeCallbacks = null;
      callbacks.end();
    };
    audio.onerror = () => {
      this.releaseAudio();
      this.activeId = null;
      this.activeCallbacks = null;
      callbacks.error(
        "Kokoro generated the alert, but this device blocked audio playback. Tap Preview voice once to enable it.",
      );
    };
    try {
      await audio.play();
    } catch {
      audio.onerror?.(new Event("error"));
    }
  }

  private releaseAudio() {
    if (this.audio) {
      this.audio.onplay = null;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private resetWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.activeId = null;
    this.activeCallbacks = null;
  }

  stop() {
    this.releaseAudio();
    // ONNX generation cannot be aborted safely. Terminating prevents outdated alerts playing later.
    if (this.activeId) this.resetWorker();
  }

  speak(
    _agent: "master",
    text: string,
    settings: VoiceSettings,
    callbacks: VoiceCallbacks,
  ) {
    this.stop();
    this.volume = settings.volume;
    const cacheId = `${settings.voice}:${speed[settings.rate]}:${text}`;
    this.activeId = cacheId;
    this.activeCallbacks = callbacks;
    const cached = this.cache.get(cacheId);
    if (cached) {
      void this.play(cached);
      return;
    }
    callbacks.status?.("loading", 0);
    this.ensureWorker().postMessage({
      type: "generate",
      id: cacheId,
      text,
      voice: settings.voice,
      speed: speed[settings.rate],
    });
  }
}

type QueueItem = {
  key: string;
  candidateId?: string;
  text: string;
  priority: number;
};

export function createAgentVoiceManager(provider: AgentVoiceProvider) {
  let snapshot: VoiceSnapshot = {
    settings: { ...defaults },
    agent: null,
    pending: false,
    queueLength: 0,
    engine: "idle",
    progress: null,
    error: null,
  };
  let generation = 0;
  let initialized = false;
  let active: QueueItem | null = null;
  let queue: QueueItem[] = [];
  const delivered = new Set<string>();
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<VoiceSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((fn) => fn());
  };
  const startNext = () => {
    if (active || !queue.length || !snapshot.settings.enabled) return;
    active = queue.shift()!;
    const token = ++generation;
    update({
      agent: "master",
      pending: true,
      queueLength: queue.length,
      error: null,
    });
    const finish = (error: string | null = null) => {
      if (token !== generation) return;
      clearTimeout(startupTimer);
      clearTimeout(endTimer);
      agentRuntime.speaking("master", false);
      active = null;
      update({ agent: null, pending: false, error });
      startNext();
    };
    startupTimer = setTimeout(
      () => finish("Local voice did not start within the time limit."),
      120_000,
    );
    endTimer = setTimeout(
      () => finish("Local voice stopped after the playback time limit."),
      300_000,
    );
    try {
      provider.speak("master", active.text, snapshot.settings, {
        start() {
          if (token !== generation) return;
          clearTimeout(startupTimer);
          agentRuntime.speaking("master", true);
          update({ agent: "master", pending: false });
        },
        end() {
          finish();
        },
        error(message) {
          finish(message);
        },
        status(engine, progress) {
          if (token === generation)
            update({
              engine,
              progress:
                typeof progress === "number"
                  ? Math.max(0, Math.min(100, progress))
                  : null,
            });
        },
      });
    } catch {
      finish(
        "Local Kokoro voice could not start. Notifications remain enabled.",
      );
    }
  };
  const clearActive = () => {
    generation++;
    clearTimeout(startupTimer);
    clearTimeout(endTimer);
    provider.stop();
    agentRuntime.speaking("master", false);
    active = null;
    update({ agent: null, pending: false });
  };
  const manager = {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    available: () => provider.available(),
    initialize() {
      if (initialized || typeof window === "undefined") return;
      initialized = true;
      try {
        const saved = JSON.parse(
          localStorage.getItem("onkar-agent-voice-v2") ||
            localStorage.getItem("onkar-agent-voice-v1") ||
            "null",
        );
        if (saved) manager.configure(saved);
      } catch {
        /* Optional preference only. */
      }
      window.addEventListener("pagehide", () => manager.stop());
      window.addEventListener("onkar-session-ended", () => {
        manager.stop();
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
      if (KOKORO_MALE_VOICES.some((voice) => voice.id === patch.voice))
        settings.voice = patch.voice!;
      if (!settings.enabled || settings.volume === 0) manager.stop();
      update({ settings });
      try {
        localStorage.setItem("onkar-agent-voice-v2", JSON.stringify(settings));
      } catch {
        /* Private browsing/storage denial must not break alerts. */
      }
    },
    speak(agent: AgentId, text: string, automatic = false) {
      manager.initialize();
      if (
        agent !== "master" ||
        !snapshot.settings.enabled ||
        snapshot.settings.volume === 0 ||
        (automatic && !snapshot.settings.autoSpeak) ||
        !text.trim() ||
        !provider.available()
      ) {
        if (agent !== "master") update({ error: "Only Master AI can speak." });
        else if (!provider.available())
          update({
            error: "Local Kokoro voice is unsupported in this browser.",
          });
        return false;
      }
      manager.stop();
      queue = [
        {
          key: `response:${crypto.randomUUID()}`,
          text: text.replace(/[#*_`]/g, "").slice(0, 1800),
          priority: 30,
        },
      ];
      startNext();
      return true;
    },
    enqueueAlert(alert: MasterAlertSpeech) {
      manager.initialize();
      if (delivered.has(alert.key)) return false;
      delivered.add(alert.key);
      if (
        !snapshot.settings.enabled ||
        snapshot.settings.volume === 0 ||
        !provider.available()
      )
        return false;
      const item: QueueItem = {
        ...alert,
        priority: alert.priority ?? 50,
        text: alert.text.replace(/[#*_`]/g, "").slice(0, 1200),
      };
      if (item.priority >= 90)
        queue = queue.filter((queued) => queued.priority >= item.priority);
      queue.push(item);
      queue.sort((a, b) => b.priority - a.priority);
      update({ queueLength: queue.length });
      startNext();
      return true;
    },
    cancelAlert(candidateId: string) {
      queue = queue.filter((item) => item.candidateId !== candidateId);
      if (active?.candidateId === candidateId) clearActive();
      update({ queueLength: queue.length });
      startNext();
    },
    preview(voice = snapshot.settings.voice) {
      manager.configure({ voice, enabled: true });
      return manager.speak(
        "master",
        "Master AI voice ready. Confirmed setup alerts will include risk warnings.",
      );
    },
    stop(agent?: AgentId) {
      if (agent && agent !== "master") return;
      queue = [];
      clearActive();
      update({ queueLength: 0 });
    },
    isSpeaking: (agent: AgentId) =>
      agent === "master" && snapshot.agent === "master" && !snapshot.pending,
  };
  return manager;
}

export const agentVoice = createAgentVoiceManager(
  new LocalKokoroVoiceProvider(),
);
