import { useEffect, useSyncExternalStore } from "react";
import { Volume2, Square } from "lucide-react";
import type { AgentId } from "./agent-data";
import { agentVoice, type VoiceSettings } from "./agent-voice";

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
            ? "Starting device voice…"
            : "Speaking · procedural visor animation"}
        </small>
      )}
      {!agentVoice.available() && <small>Device voice unavailable</small>}
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
              Agent voice
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
              Uses voices available on your device. No microphone recording.
              Auto speak may require a tap on iPhone.
            </small>
          </div>
        </details>
      )}
    </div>
  );
}
