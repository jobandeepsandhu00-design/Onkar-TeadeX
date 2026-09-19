import { useEffect, useState } from "react";
import {
  CirclePause,
  CirclePlay,
  Octagon,
  ShieldAlert,
  Zap,
} from "lucide-react";
import type { ScannerRuntime } from "@workspace/api-zod";
import { brainRequest } from "./api";

export function AutomationControlBar({
  runtime,
  mt5Status,
  markets,
  onChanged,
}: {
  runtime: ScannerRuntime;
  mt5Status: string;
  markets: number;
  onChanged: (message: string) => void;
}) {
  const [mode, setMode] = useState(runtime.tradingMode);
  const [autoStart, setAutoStart] = useState(runtime.autoStart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setMode(runtime.tradingMode);
    setAutoStart(runtime.autoStart);
  }, [runtime.autoStart, runtime.tradingMode]);

  const control = async (
    action: "PAUSE" | "RESUME" | "STOP" | "EMERGENCY_STOP" | "DISABLE_AUTO",
  ) => {
    setBusy(true);
    setError("");
    try {
      await brainRequest("/control", "POST", { action });
      onChanged(
        action === "EMERGENCY_STOP"
          ? "Emergency Stop is active server-side. New executions are blocked."
          : "Scanner control updated.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Control update failed",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (
      mode === "AUTO" &&
      !window.confirm(
        "Arm automatic execution for the selected account? Approved rules and server risk checks remain mandatory.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await brainRequest("/runtime", "PUT", {
        scannerState:
          runtime.scannerState === "STOPPED" ? "RUNNING" : runtime.scannerState,
        tradingMode: mode,
        autoStart,
        autoExecutionEnabled: mode === "AUTO",
      });
      onChanged(
        mode === "AUTO"
          ? "AUTO was armed by the server."
          : "Trading mode saved.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mode update failed");
    } finally {
      setBusy(false);
    }
  };

  const armed =
    runtime.tradingMode === "AUTO" &&
    runtime.autoExecutionEnabled &&
    !runtime.emergencyStop;
  return (
    <section
      className={`mb-automation ${runtime.emergencyStop ? "is-emergency" : armed ? "is-armed" : ""}`}
    >
      <div className="mb-automation-status">
        <span className="mb-automation-orb">
          <Zap size={18} />
        </span>
        <div>
          <span className="mb-eyebrow">Onkar Brain</span>
          <strong>
            {runtime.emergencyStop ? "EXECUTION LOCKED" : runtime.scannerState}
          </strong>
        </div>
        <div className="mb-auto-facts">
          <span>
            MT5 <b>{mt5Status.replaceAll("_", " ")}</b>
          </span>
          <span>
            Markets <b>{markets}</b>
          </span>
          <span>
            Mode <b>{runtime.tradingMode}</b>
          </span>
        </div>
      </div>
      <div className="mb-mode-controls">
        <label>
          Trading mode
          <select
            value={mode}
            disabled={busy || runtime.emergencyStop}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="ANALYSIS">Analysis only</option>
            <option value="CONFIRM">Confirm before execution</option>
              <option value="AUTO" disabled>
                Auto trading · execution worker required
              </option>
          </select>
        </label>
        <label className="mb-check">
          <input
            type="checkbox"
            checked={autoStart}
            disabled={busy}
            onChange={(event) => setAutoStart(event.target.checked)}
          />{" "}
          Auto-start scanner
        </label>
        <button
          type="button"
          disabled={
            busy ||
            (mode === runtime.tradingMode && autoStart === runtime.autoStart)
          }
          onClick={() => void save()}
        >
          Apply
        </button>
        {runtime.scannerState === "RUNNING" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void control("PAUSE")}
          >
            <CirclePause size={16} /> Pause
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || runtime.emergencyStop}
            onClick={() => void control("RESUME")}
          >
            <CirclePlay size={16} /> Resume
          </button>
        )}
        {armed ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void control("DISABLE_AUTO")}
          >
            <Octagon size={16} /> Disable auto
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || runtime.emergencyStop}
          className="mb-emergency"
          onClick={() => void control("EMERGENCY_STOP")}
        >
          <ShieldAlert size={16} /> Emergency stop
        </button>
      </div>
      {runtime.emergencyStop ? (
        <p className="mb-runtime-warning">
          Emergency Stop is persisted. AUTO cannot be re-enabled until the
          backend reconciles the MT5 account and clears the lock.
        </p>
      ) : null}
      {error ? (
        <p className="mb-notice" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
