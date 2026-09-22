// Deliberately no remote wake-word fallback. Browser STT is a separately consented,
// one-utterance push-to-talk option and may use the browser vendor's service.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string; confidence: number };
        }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionConstructor = {
  new (): Recognition;
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<string>;
};
function constructor() {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
export async function localSpeechAvailable() {
  const C = constructor();
  if (!C || !("processLocally" in new C()) || !C.available) return false;
  try {
    return (
      (await C.available({ langs: ["en-US"], processLocally: true })) ===
      "available"
    );
  } catch {
    return false;
  }
}
export function browserSpeechAvailable() {
  return Boolean(constructor());
}
export function createJarvisMicrophone(callbacks: {
  transcript(text: string, final: boolean, confidence: number): void;
  state(
    value: "LISTENING" | "WAKE LISTENING" | "OFF" | "ERROR",
    message?: string,
  ): void;
  blocked(): boolean;
}) {
  let recognition: Recognition | null = null,
    enabled = false,
    wake = false,
    generation = 0;
  let release: (() => void) | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  let utteranceTimer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    enabled = false;
    generation++;
    clearTimeout(timer);
    clearTimeout(utteranceTimer);
    recognition?.abort();
    recognition = null;
    release?.();
    release = null;
    callbacks.state("OFF");
  }
  function listen(token: number, local: boolean) {
    if (!enabled || token !== generation) return;
    if (document.hidden || callbacks.blocked()) {
      timer = setTimeout(() => listen(token, local), 900);
      return;
    }
    const C = constructor();
    if (!C) {
      stop();
      callbacks.state(
        "ERROR",
        "Speech recognition is unsupported. Use the typed command field.",
      );
      return;
    }
    const rec = new C();
    recognition = rec;
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    if (local) rec.processLocally = true;
    rec.onstart = () => {
      if (token === generation)
        callbacks.state(wake ? "WAKE LISTENING" : "LISTENING");
    };
    rec.onresult = (event) => {
      if (token !== generation || !enabled || callbacks.blocked()) return;
      for (let i = event.resultIndex; i < event.results.length; i++)
        callbacks.transcript(
          event.results[i][0].transcript,
          event.results[i].isFinal,
          event.results[i][0].confidence,
        );
    };
    rec.onerror = (event) => {
      if (token !== generation || event.error === "aborted") return;
      if (event.error === "no-speech" && wake) return;
      stop();
      callbacks.state(
        "ERROR",
        `Microphone: ${event.error}. Use Enable Voice to retry; no remote wake fallback was activated.`,
      );
    };
    rec.onend = () => {
      if (token !== generation || !enabled) return;
      callbacks.state("OFF");
      if (wake) timer = setTimeout(() => listen(token, local), 1000);
      else stop();
    };
    try {
      rec.start();
    } catch {
      stop();
      callbacks.state(
        "ERROR",
        "Microphone could not start. Tap Enable Voice again.",
      );
    }
  }
  return {
    stop,
    interruptCapture() {
      if (recognition) {
        callbacks.state("OFF");
        recognition.abort();
      }
    },
    async start(mode: "local-wake" | "browser-talk") {
      stop();
      if (!window.isSecureContext) throw new Error("Voice requires HTTPS.");
      if (mode === "local-wake" && !(await localSpeechAvailable()))
        throw new Error(
          "On-device wake recognition is unavailable or its English language pack is missing. Use explicitly enabled push-to-talk; background listening is not supported here.",
        );
      if (!navigator.locks)
        throw new Error(
          "Exclusive microphone ownership is unavailable in this browser. Use typed commands.",
        );
      const token = ++generation;
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request(
            "onkar-jarvis-microphone",
            { ifAvailable: true },
            async (lock) => {
              if (!lock) {
                reject(
                  new Error(
                    "Jarvis microphone is active in another tab. Turn it off there first.",
                  ),
                );
                return;
              }
              if (token !== generation) {
                resolve();
                return;
              }
              enabled = true;
              wake = mode === "local-wake";
              const held = new Promise<void>((r) => {
                release = r;
              });
              listen(token, wake);
              resolve();
              if (!wake) utteranceTimer = setTimeout(stop, 20_000);
              await held;
            },
          )
          .catch(reject);
      });
    },
  };
}
