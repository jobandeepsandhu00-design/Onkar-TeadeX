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
  executionAvailable,
  executionReason,
  markets,
  onChanged,
}: {
  runtime: ScannerRuntime;
  mt5Status: string;
  executionAvailable: boolean;
  executionReason: string;
  markets: number;
  onChanged: (message: string) => void;
}) {
  const [mode, setMode] = useState(runtime.tradingMode);
  const [autoStart, setAutoStart] = useState(runtime.autoStart);
  const [disconnectBehavior, setDisconnectBehavior] = useState(
    runtime.mt5DisconnectBehavior,
  );
  const [autoReturnMt5, setAutoReturnMt5] = useState(runtime.autoReturnMt5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setMode(runtime.tradingMode);
    setAutoStart(runtime.autoStart);
    setDisconnectBehavior(runtime.mt5DisconnectBehavior);
    setAutoReturnMt5(runtime.autoReturnMt5);
  }, [
    runtime.autoReturnMt5,
    runtime.autoStart,
    runtime.mt5DisconnectBehavior,
    runtime.tradingMode,
  ]);

  const control = async (
    action:
      | "PAUSE"
      | "RESUME"
      | "RESUME_ANALYSIS"
      | "STOP"
      | "EMERGENCY_STOP"
      | "DISABLE_AUTO",
  ) => {
    setBusy(true);
    setError("");
    try {
      await brainRequest("/control", "POST", { action });
      onChanged(
        action === "EMERGENCY_STOP"
          ? "Emergency Stop is active server-side. New executions are blocked."
          : action === "RESUME_ANALYSIS"
            ? "Emergency lock cleared. Scanner is running in analysis-only mode; automatic execution remains OFF."
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
        tradingSource: runtime.tradingSource,
        mt5DisconnectBehavior: disconnectBehavior,
        autoReturnMt5,
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
            Source <b>{runtime.tradingSource.replace("_", " ")}</b>
          </span>
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
            <option value="AUTO" disabled={!executionAvailable}>
              {executionAvailable
                ? "Auto trading"
                : "Auto trading · worker unavailable"}
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
        <label>
          MT5 disconnect
          <select
            value={disconnectBehavior}
            disabled={busy}
            onChange={(event) =>
              setDisconnectBehavior(
                event.target.value as typeof disconnectBehavior,
              )
            }
          >
            <option value="LOCK">Lock trading</option>
            <option value="PAPER">Switch to Twelve Data Paper</option>
            <option value="ANALYSIS">Analysis only</option>
          </select>
        </label>
        <label className="mb-check">
          <input
            type="checkbox"
            checked={autoReturnMt5}
            disabled={busy || disconnectBehavior !== "PAPER"}
            onChange={(event) => setAutoReturnMt5(event.target.checked)}
          />{" "}
          Return to MT5 after recovery
        </label>
        <button
          type="button"
          disabled={
            busy ||
            (mode === runtime.tradingMode &&
              autoStart === runtime.autoStart &&
              disconnectBehavior === runtime.mt5DisconnectBehavior &&
              autoReturnMt5 === runtime.autoReturnMt5)
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
        <div className="mb-runtime-warning mb-recovery-panel">
          <p>
            Emergency Stop is persisted. Clear the lock to resume scanning in
            analysis-only mode. Automatic execution stays OFF until you arm it
            separately and the server completes every safety check.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void control("RESUME_ANALYSIS")}
          >
            <CirclePlay size={16} /> Clear lock &amp; resume analysis
          </button>
        </div>
      ) : null}
      {!executionAvailable ? (
        <p className="mb-runtime-warning">
          AUTO unavailable: {executionReason}
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
