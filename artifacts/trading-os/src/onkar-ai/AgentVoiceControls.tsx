import { useEffect, useSyncExternalStore } from "react";
import { Bell, Volume2, Square } from "lucide-react";
import type { AgentId } from "./agent-data";
import {
  agentVoice,
  KOKORO_MALE_VOICES,
  type KokoroVoiceId,
  type VoiceSettings,
} from "./agent-voice";
import { requestMasterNotificationPermission } from "./MasterSetupAlertBridge";

export function AgentVoiceControls({
  agent,
  text,
  label = "Read aloud",
  settings = true,
}: {
  agent: AgentId;
  text: string;
  label?: string;
  settings?: boolean;
}) {
  const voice = useSyncExternalStore(
    agentVoice.subscribe,
    agentVoice.getSnapshot,
    agentVoice.getSnapshot,
  );
  useEffect(() => {
    agentVoice.initialize();
  }, []);
  useEffect(() => () => agentVoice.stop(agent), [agent]);
  if (agent !== "master") return null;
  const playing = voice.agent === agent;
  return (
    <div className="oai-voice-controls">
      <button
        type="button"
        className="oai-text-button"
        disabled={
          !playing &&
          (!text ||
            !voice.settings.enabled ||
            voice.settings.volume === 0 ||
            !agentVoice.available())
        }
        onClick={() =>
          playing ? agentVoice.stop(agent) : agentVoice.speak(agent, text)
        }
      >
        {playing ? <Square size={14} /> : <Volume2 size={14} />}
        {playing ? "Stop voice" : label}
      </button>
      {playing && (
        <small role="status">
          {voice.pending
            ? voice.engine === "loading"
              ? `Loading Kokoro locally${voice.progress == null ? "…" : ` · ${Math.round(voice.progress)}%`}`
              : "Preparing local voice…"
            : `Speaking · Kokoro ${voice.engine.toUpperCase()}`}
        </small>
      )}
      {!agentVoice.available() && <small>Local Kokoro voice unavailable</small>}
      {voice.error && <small role="status">{voice.error}</small>}
      {settings && (
        <details>
          <summary>Voice settings</summary>
          <div className="oai-voice-settings">
            <label>
              <input
                type="checkbox"
                checked={voice.settings.enabled}
                onChange={(event) =>
                  agentVoice.configure({ enabled: event.target.checked })
                }
              />{" "}
              Master AI voice
            </label>
            <label>
              <input
                type="checkbox"
                checked={voice.settings.autoSpeak}
                onChange={(event) =>
                  agentVoice.configure({ autoSpeak: event.target.checked })
                }
              />{" "}
              Auto speak responses
            </label>
            <label>
              Speech rate{" "}
              <select
                value={voice.settings.rate}
                onChange={(event) =>
                  agentVoice.configure({
                    rate: event.target.value as VoiceSettings["rate"],
                  })
                }
              >
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </label>
            <label>
              Kokoro voice{" "}
              <select
                value={voice.settings.voice}
                onChange={(event) =>
                  agentVoice.configure({
                    voice: event.target.value as KokoroVoiceId,
                  })
                }
              >
                {KOKORO_MALE_VOICES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="oai-text-button"
              onClick={() => agentVoice.preview()}
            >
              <Volume2 size={14} /> Preview selected voice
            </button>
            <button
              type="button"
              className="oai-text-button"
              onClick={() => void requestMasterNotificationPermission()}
            >
              <Bell size={14} /> Enable browser notifications
            </button>
            <label>
              Volume{" "}
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={voice.settings.volume}
                onChange={(event) =>
                  agentVoice.configure({ volume: Number(event.target.value) })
                }
              />
            </label>
            <small>
              Kokoro-82M runs locally using WebGPU, with ONNX WASM fallback. The
              model downloads once and is cached by the browser. No TTS API, API
              key, or microphone recording is used. iPhone may require one
              Preview tap before automatic audio can play.
            </small>
          </div>
        </details>
      )}
    </div>
  );
}
