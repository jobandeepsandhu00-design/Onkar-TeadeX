import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AudioLines,
  ArrowUp,
  Mic,
  MicOff,
  ShieldAlert,
  VolumeX,
  X,
  History,
  ChevronDown,
} from "lucide-react";
import {
  parseJarvisIntent,
  stripJarvisWake,
  type JarvisAction,
  type JarvisResult,
} from "@workspace/api-zod";
import { getAccessToken } from "../api";
import { agentVoice } from "../onkar-ai/agent-voice";
import { agentRuntime } from "../onkar-ai/agent-runtime";
import { brainRequest, masterAIRequest } from "../market-brain/api";
import {
  jarvisContext,
  navigateJarvis,
  publishJarvisChart,
  backJarvis,
} from "./app-bridge";
import {
  browserSpeechAvailable,
  createJarvisMicrophone,
  localSpeechAvailable,
} from "./speech";
import "./jarvis.css";

type Entry = { id: string; who: "you" | "jarvis"; text: string; time: string };
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const token = await getAccessToken();
  if (!token)
    throw new Error(
      "Sign in again. Microphone commands cannot run without your session.",
    );
  const response = await fetch(`/api/onkar-ai/jarvis${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Command service unavailable." }));
  if (!response.ok) throw new Error(data.error || "Command failed.");
  return data;
}
const clock = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export default function Jarvis() {
  const [open, setOpen] = useState(false),
    [minimized, setMinimized] = useState(false);
  const [micState, setMicState] = useState("OFF"),
    [task, setTask] = useState("");
  const [text, setText] = useState(""),
    [caption, setCaption] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]),
    [pending, setPending] = useState<JarvisResult | null>(null);
  const [unknownId, setUnknownId] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false),
    [browserConsent, setBrowserConsent] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false),
    [jarAlias, setJarAlias] = useState(false),
    [windowSeconds, setWindowSeconds] = useState(12);
  const [settings, setSettings] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const voice = useSyncExternalStore(
    agentVoice.subscribe,
    agentVoice.getSnapshot,
  );
  const busy = useRef(false),
    alive = useRef(true),
    generation = useRef(0),
    mode = useRef<"local-wake" | "browser-talk">("local-wake"),
    followUntil = useRef(0),
    cooldown = useRef(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const refs = useRef({ voiceReplies, jarAlias, windowSeconds });
  refs.current = { voiceReplies, jarAlias, windowSeconds };
  const lastPhrase = useRef({ value: "", at: 0 });
  const bottom = useRef<HTMLDivElement>(null);
  const executeRef = useRef<(value: string) => Promise<void>>(async () => {});
  const replyRef = useRef<(value: string) => void>(() => {});
  const microphone = useRef<ReturnType<typeof createJarvisMicrophone> | null>(
    null,
  );
  const playback = () => {
    const speech = agentVoice.getSnapshot();
    // Cross-origin video playback cannot be inspected reliably. A visible embedded
    // player conservatively blocks wake recognition, even if it might be paused.
    const embeddedMedia = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src*="youtube"],iframe[src*="vimeo"]')).some(frame => frame.getClientRects().length > 0);
    return (
      embeddedMedia ||
      speech.pending ||
      Boolean(speech.agent) ||
      Date.now() < cooldown.current ||
      Array.from(
        document.querySelectorAll<HTMLMediaElement>("video,audio"),
      ).some((media) => !media.paused && !media.ended)
    );
  };
  const append = (who: Entry["who"], value: string) => {
    if (alive.current)
      setEntries((list) => [
        ...list.slice(-29),
        { id: crypto.randomUUID(), who, text: value, time: clock() },
      ]);
  };
  function reply(value: string) {
    if (!alive.current) return;
    append("jarvis", value);
    setCaption("");
    if (refs.current.voiceReplies && !document.hidden)
      agentVoice.speak("master", value);
  }
  replyRef.current = reply;
  function result(value: JarvisResult) {
    if (!alive.current) return;
    setPending(value.state === "AWAITING_CONFIRMATION" ? value : null);
    setUnknownId(
      ["UNKNOWN", "RUNNING"].includes(value.state) ? value.id : null,
    );
    setTask(
      value.state === "AWAITING_CONFIRMATION"
        ? "AWAITING CONFIRMATION"
        : value.state === "UNKNOWN"
          ? "ERROR"
          : "",
    );
    reply(value.message);
    if (value.state === "SUCCEEDED")
      window.dispatchEvent(new Event("onkar-jarvis-state-changed"));
  }
  async function command(action: JarvisAction, token: number) {
    const requestId = crypto.randomUUID();
    setTask("EXECUTING");
    try {
      const value = await request<JarvisResult>("/commands", "POST", {
        requestId,
        action,
      });
      if (token === generation.current) result(value);
    } catch (error) {
      setUnknownId(requestId);
      throw error;
    }
  }
  async function decision(value: "CONFIRM" | "CANCEL") {
    const target = pendingRef.current;
    if (!target?.nonce || busy.current) return;
    busy.current = true;
    setTask("EXECUTING");
    microphone.current?.interruptCapture();
    try {
      result(
        await request<JarvisResult>(`/commands/${target.id}`, "POST", {
          decision: value,
          nonce: target.nonce,
        }),
      );
    } catch (error) {
      setUnknownId(target.id);
      setTask("ERROR");
      reply(error instanceof Error ? error.message : "Confirmation failed.");
    } finally {
      busy.current = false;
    }
  }
  async function execute(value: string) {
    if (!value.trim() || busy.current || !alive.current) return;
    append("you", value);
    setOpen(true);
    setText("");
    setCaption("");
    const intent =
      /^(?:jarvis[, ]*)?(?:open|show|go to) (?:the )?other dashboard[.!?]?$/i.test(
        value.trim(),
      )
        ? {
            kind: "NAVIGATE" as const,
            destination: jarvisContext().page.startsWith("/onkar-ai")
              ? ("tradex" as const)
              : ("onkar" as const),
          }
        : parseJarvisIntent(value);
    if (intent.kind === "LOCAL") {
      if (intent.action === "CANCEL") {
        if (pendingRef.current) await decision("CANCEL");
        else
          reply(
            "No unconfirmed action is pending. Already submitted actions are not canceled by stopping speech.",
          );
        return;
      }
      if (intent.action === "MIC_OFF") {
        microphone.current?.stop();
        reply("Microphone off. Tap Enable Voice to listen again.");
        return;
      }
      if (intent.action === "STOP_SPEECH") {
        agentVoice.stop();
        setTask("INTERRUPTED");
        return;
      }
      if (intent.action === "SLEEP") {
        followUntil.current = 0;
        reply(
          mode.current === "local-wake" && micState !== "OFF"
            ? "Conversation asleep. Local wake listening remains on."
            : "Conversation ended. Microphone off.",
        );
        if (mode.current !== "local-wake") microphone.current?.stop();
        return;
      }
      if (intent.action === "BACK") {
        try {
          reply(`Current screen: ${(await backJarvis()).page}.`);
        } catch (error) {
          reply(
            error instanceof Error ? error.message : "Navigation unavailable.",
          );
        }
        return;
      }
      reply("Yes, Boss? Assistant awake. Trading state is unchanged.");
      return;
    }
    if (intent.kind === "VOLUME") {
      agentVoice.configure({ volume: intent.value });
      reply(
        `Voice volume ${Math.round(intent.value * 100)} percent, saved on this device.`,
      );
      return;
    }
    if (intent.kind === "CLARIFY") {
      reply(intent.message);
      return;
    }
    if (intent.kind === "COMMAND" && intent.action.kind === "SAFE_PAUSE") {
      await emergencyPause();
      return;
    }
    if (pendingRef.current) {
      reply(
        "Confirm or cancel the pending action before starting another command. Emergency pause is always available.",
      );
      return;
    }
    if (
      unknownId &&
      intent.kind === "COMMAND" &&
      !["STATUS", "DISABLE_AUTO"].includes(intent.action.kind)
    ) {
      reply(
        "A previous command has an unverified outcome. Use Check command result before making another change. Emergency pause remains available.",
      );
      return;
    }
    busy.current = true;
    microphone.current?.interruptCapture();
    const token = ++generation.current;
    try {
      if (!navigator.onLine)
        throw new Error("Offline. No command was submitted or queued.");
      if (intent.kind === "NAVIGATE") {
        const next = await navigateJarvis(intent.destination);
        if (intent.destination === "notifications")
          window.dispatchEvent(new Event("onkar-open-notifications"));
        reply(
          `Current screen: ${next.page}.${intent.destination === "library" ? " Use Upload in the existing Library to choose your file; browsers require a touch for file access." : ""}`,
        );
      } else if (intent.kind === "CHART") {
        publishJarvisChart(intent);
        const next = await navigateJarvis("charts");
        reply(
          `Chart request applied in ${next.page}${intent.symbol ? `: ${intent.symbol}` : ""}${intent.timeframe ? `, ${intent.timeframe}` : ""}. The chart shows its actual data freshness; this does not confirm a setup.`,
        );
      } else if (intent.kind === "COMMAND") await command(intent.action, token);
      else {
        setTask("THINKING");
        const context = jarvisContext();
        const question =
          `Current UI page: ${context.page}. UI selected account ID: ${context.accountId ?? "not selected"}; label: ${context.account ?? "unknown"}. Do not assume it matches scanner risk account. This is a read-only question, not permission to change anything. User asks: ${intent.question}`.slice(
            0,
            1200,
          );
        const runToken = crypto.randomUUID();
        agentRuntime.begin(runToken);
        try {
          const answer = await masterAIRequest(
            { question, deepAnalysis: false },
            undefined,
            (event) => agentRuntime.event(runToken, event.agent, event.state),
          );
          if (token === generation.current && alive.current)
            reply(answer.answer);
        } finally {
          agentRuntime.finish(runToken);
        }
      }
    } catch (error) {
      setTask("ERROR");
      reply(
        error instanceof Error
          ? error.message
          : "Command unavailable. No success is assumed.",
      );
    } finally {
      busy.current = false;
      if (token === generation.current)
        setTask((current) =>
          current === "THINKING" || current === "EXECUTING" ? "" : current,
        );
    }
  }
  executeRef.current = execute;
  async function enable(modeValue: "local-wake" | "browser-talk") {
    setOpen(true);
    agentVoice.stop();
    mode.current = modeValue;
    try {
      await microphone.current?.start(modeValue);
    } catch (error) {
      setMicState("ERROR");
      reply(error instanceof Error ? error.message : "Microphone unavailable.");
    }
  }
  async function emergencyPause() {
    setOpen(true);
    agentVoice.stop();
    microphone.current?.stop();
    // Independent of recognition, LLM availability and the pending conversation.
    generation.current++;
    setTask("EXECUTING");
    try {
      const response = await brainRequest<{
        saved: boolean;
        runtime?: { controlAuditRecorded?: boolean };
      }>("/control", "POST", { action: "EMERGENCY_STOP" });
      if (!response.saved)
        throw new Error("Emergency pause could not be verified.");
      setPending(null);
      setTask("");
      reply(
        "Emergency pause verified. New automatic entries OFF; scanner PAUSED. Protective position management and required data remain enabled. Existing broker orders were not canceled or verified. Check Connections. Learning and backtest jobs are unaffected." +
          (response.runtime?.controlAuditRecorded === false
            ? " Warning: the control audit record could not be saved."
            : ""),
      );
      window.dispatchEvent(new Event("onkar-jarvis-state-changed"));
    } catch (error) {
      setTask("ERROR");
      reply(
        `Pause NOT verified. ${error instanceof Error ? error.message : "Check server and broker status immediately."}`,
      );
    }
  }
  useEffect(() => {
    alive.current = true;
    agentVoice.initialize();
    void localSpeechAvailable().then((value) => {
      if (alive.current) setLocalReady(value);
    });
    const mic = createJarvisMicrophone({
      blocked: () => busy.current || playback(),
      state: (value, message) => {
        if (alive.current) {
          setMicState(value);
          if (message) replyRef.current(message);
        }
      },
      transcript(value, final, confidence) {
        if (!final) {
          setCaption(value);
          return;
        }
        const wake = stripJarvisWake(value, refs.current.jarAlias);
        if (
          mode.current === "local-wake" &&
          wake === null &&
          Date.now() > followUntil.current
        ) {
          setCaption("");
          return;
        }
        const phrase = wake ?? value;
        if (!phrase.trim()) {
          followUntil.current = Date.now() + refs.current.windowSeconds * 1000;
          setOpen(true);
          replyRef.current("Yes, Boss?");
          return;
        }
        if (confidence > 0 && confidence < 0.6) {
          replyRef.current(
            "I did not hear that clearly. Please repeat the exact command; nothing was changed.",
          );
          return;
        }
        if (
          lastPhrase.current.value === phrase &&
          Date.now() - lastPhrase.current.at < 4000
        )
          return;
        lastPhrase.current = { value: phrase, at: Date.now() };
        followUntil.current = Date.now() + refs.current.windowSeconds * 1000;
        void executeRef.current(phrase);
      },
    });
    microphone.current = mic;
    const unsubscribe = agentVoice.subscribe(() => {
      const state = agentVoice.getSnapshot();
      if (state.pending || state.agent) {
        cooldown.current = Date.now() + 2000;
        mic.interruptCapture();
      } else cooldown.current = Date.now() + 2000;
    });
    const suspend = () => {
      if (document.hidden) {
        mic.stop();
        agentVoice.stop();
      }
    };
    const end = () => {
      mic.stop();
      agentVoice.stop();
      generation.current++;
    };
    const connection = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) end();
    };
    const media = (event: Event) => {
      if (event.target instanceof HTMLMediaElement) {
        cooldown.current = Date.now() + 2000;
        mic.interruptCapture();
      }
    };
    const dirty = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-jarvis]"))
        target.closest("form")?.setAttribute("data-jarvis-dirty", "true");
    };
    document.addEventListener("visibilitychange", suspend);
    document.addEventListener("play", media, true);
    document.addEventListener("input", dirty, true);
    window.addEventListener("onkar-session-ended", end);
    window.addEventListener("pagehide", end);
    window.addEventListener("offline", connection);
    window.addEventListener("online", connection);
    return () => {
      alive.current = false;
      end();
      unsubscribe();
      document.removeEventListener("visibilitychange", suspend);
      document.removeEventListener("play", media, true);
      document.removeEventListener("input", dirty, true);
      window.removeEventListener("onkar-session-ended", end);
      window.removeEventListener("pagehide", end);
      window.removeEventListener("offline", connection);
      window.removeEventListener("online", connection);
    };
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [entries, pending]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  const state = !online
    ? "DISCONNECTED"
    : voice.agent && !voice.pending
      ? "SPEAKING"
      : task || (voice.pending ? "THINKING" : micState);
  return (
    <div
      className={`jarvis-root ${minimized ? "is-minimized" : ""}`}
      data-jarvis
      data-state={state}
    >
      {open && (
        <section
          className="jarvis-panel"
          aria-label="Jarvis Master AI voice interface"
        >
          <header>
            <div>
              <span className="jarvis-eyebrow">
                ONKAR AI · MASTER INTERFACE
              </span>
              <h2>
                Jarvis <span>{state}</span>
              </h2>
            </div>
            <button aria-label="Minimize Jarvis" onClick={() => setOpen(false)}>
              <ChevronDown size={21} />
            </button>
          </header>
          <p className="jarvis-scope">
            Your existing AI. Your rules. No voice command can bypass risk
            checks.
          </p>
          <div className="jarvis-conversation" role="log" aria-live="polite">
            {!entries.length && (
              <div className="jarvis-welcome">
                <div className="jarvis-face">
                  <i />
                  <i />
                  <b />
                </div>
                <h3>At your command.</h3>
                <p>
                  Navigate, check your scanner, learn from your Library, or ask
                  Master AI.
                </p>
                <div className="jarvis-suggestions">
                  {[
                    "Open Onkar AI",
                    "Open TradeX dashboard",
                    "Read my scanner settings",
                    "Show gold on thirty minutes",
                  ].map((example) => (
                    <button key={example} onClick={() => void execute(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {entries.map((entry) => (
              <article key={entry.id} data-who={entry.who}>
                <small>
                  {entry.who === "you" ? "YOU" : "MASTER AI"} · {entry.time}
                </small>
                <p>{entry.text}</p>
              </article>
            ))}
            {caption && <p className="jarvis-caption">Hearing: {caption}</p>}
            {pending && (
              <div className="jarvis-confirm">
                <strong>Review exact change</strong>
                <p>{pending.message}</p>
                <small>
                  Expires {new Date(pending.expiresAt!).toLocaleTimeString()} ·
                  one use · this session
                </small>
                <div>
                  <button onClick={() => void decision("CANCEL")}>
                    Cancel
                  </button>
                  <button onClick={() => void decision("CONFIRM")}>
                    Confirm this action
                  </button>
                </div>
              </div>
            )}
            {unknownId && (
              <button
                className="jarvis-reconcile"
                onClick={async () => {
                  try {
                    result(
                      await request<JarvisResult>(`/commands/${unknownId}`),
                    );
                  } catch (error) {
                    if (
                      error instanceof Error &&
                      /Command not found/.test(error.message)
                    )
                      setUnknownId(null);
                    reply(
                      error instanceof Error
                        ? error.message
                        : "Still unverified.",
                    );
                  }
                }}
              >
                Check command result — do not resubmit
              </button>
            )}
            <div ref={bottom} />
          </div>
          <div className="jarvis-controls">
            <button
              onClick={() => {
                agentVoice.stop();
                setTask("INTERRUPTED");
              }}
            >
              <VolumeX size={15} /> Stop speech
            </button>
            <button onClick={() => microphone.current?.stop()}>
              <MicOff size={15} /> Mic off
            </button>
            <button
              onClick={() => setSettings(!settings)}
              aria-expanded={settings}
            >
              Voice settings
            </button>
          </div>
          {settings && (
            <div className="jarvis-settings">
              <p>
                Local wake:{" "}
                {localReady
                  ? "available on this device"
                  : "unavailable / language pack missing"}
                . Listening works only with this page open and foreground.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={browserConsent}
                  onChange={(e) => setBrowserConsent(e.target.checked)}
                />{" "}
                Allow one-shot browser speech recognition (may send audio to the
                browser vendor). Never used for ambient wake listening.
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={voiceReplies}
                  onChange={(e) => {
                    setVoiceReplies(e.target.checked);
                    if (e.target.checked)
                      agentVoice.configure({ enabled: true });
                  }}
                />{" "}
                Speak replies using existing local Kokoro (first use downloads
                the voice model).
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={jarAlias}
                  onChange={(e) => setJarAlias(e.target.checked)}
                />{" "}
                Also recognize “Jar” locally (more accidental activations).
              </label>
              <label>
                Follow-up window{" "}
                <select
                  value={windowSeconds}
                  onChange={(e) => setWindowSeconds(Number(e.target.value))}
                >
                  <option value={0}>Wake every command</option>
                  <option value={12}>12 seconds</option>
                  <option value={25}>25 seconds</option>
                </select>
              </label>
              <label>
                Voice volume{" "}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(voice.settings.volume * 100)}
                  onChange={(e) =>
                    agentVoice.configure({
                      volume: Number(e.target.value) / 100,
                    })
                  }
                />
              </label>
              <p>
                Microphone capture pauses during Jarvis, notification or Library
                playback. Tap Talk to interrupt safely. Voice barge-in while
                speakers play is not enabled.
              </p>
              <p>
                Provider: {voice.engine}.{" "}
                {voice.pending ? "Preparing local speech…" : ""} {voice.error}
              </p>
              <button
                onClick={async () => {
                  try {
                    const rows =
                      await request<
                        Array<{ output: JarvisResult; created_at: string }>
                      >("/history");
                    reply(
                      rows.length
                        ? rows
                            .map(
                              (row) =>
                                `${new Date(row.created_at).toLocaleString()} — ${row.output.state}: ${row.output.message}`,
                            )
                            .join("\n")
                        : "No saved Jarvis commands yet.",
                    );
                  } catch (error) {
                    reply(
                      error instanceof Error
                        ? error.message
                        : "History unavailable.",
                    );
                  }
                }}
              >
                <History size={15} /> Read command history
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void execute(text);
            }}
          >
            <input
              aria-label="Command or question for Jarvis"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              placeholder="Ask or command Jarvis…"
            />
            <button
              aria-label="Send command"
              disabled={!text.trim() || busy.current}
            >
              <ArrowUp size={19} />
            </button>
          </form>
          <div className="jarvis-mic-row">
            <button
              disabled={!online}
              onClick={() => void enable("local-wake")}
            >
              <Mic size={17} /> Enable local wake
            </button>
            <button
              disabled={!browserConsent || !browserSpeechAvailable() || !online}
              onClick={() => void enable("browser-talk")}
            >
              <AudioLines size={17} /> Talk
            </button>
          </div>
          <button
            className="jarvis-emergency"
            onClick={() => void emergencyPause()}
          >
            <ShieldAlert size={16} /> Emergency pause — no position closures
          </button>
        </section>
      )}
      <div className="jarvis-dock">
        {!minimized && (
          <button
            className="jarvis-pause"
            onClick={() => void emergencyPause()}
            aria-label="Emergency pause new automatic entries"
          >
            <ShieldAlert size={18} />
          </button>
        )}
        <button
          className="jarvis-avatar"
          onClick={() => {
            setMinimized(false);
            setOpen(!open);
          }}
          aria-label={`Open Jarvis. ${state}`}
          aria-expanded={open}
        >
          <span className="jarvis-face">
            <i />
            <i />
            <b />
          </span>
          {!minimized && (
            <span>
              <strong>JARVIS</strong>
              <small>{state}</small>
            </span>
          )}
        </button>
        {!minimized && (
          <button
            className="jarvis-mini"
            aria-label="Minimize Jarvis avatar"
            onClick={() => {
              setMinimized(true);
              setOpen(false);
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
