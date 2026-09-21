import { useState } from "react";
import type {
  ScannerPermissions,
  ScannerRuntime,
  ScannerSnapshot,
} from "@workspace/api-zod";
import {
  Bell,
  BrainCircuit,
  CloudCog,
  Database,
  Network,
  Power,
  ScanLine,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { brainRequest } from "./api";

type RuntimePatch = Partial<
  Pick<
    ScannerRuntime,
    | "scannerState"
    | "tradingMode"
    | "tradingSource"
    | "mt5DisconnectBehavior"
    | "autoReturnMt5"
    | "autoStart"
    | "autoExecutionEnabled"
  >
>;

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`mb-system-switch ${checked ? "is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
      <strong>{checked ? "ON" : "OFF"}</strong>
    </button>
  );
}

export function SystemControlCenter({
  snapshot,
  onChanged,
}: {
  snapshot: ScannerSnapshot;
  onChanged: (message: string) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const config = snapshot.config?.config;
  const runtime = snapshot.runtime;
  const permissions = config?.permissions;
  const systemOn = Boolean(
    config?.enabled && runtime.scannerState === "RUNNING",
  );
  const twelveDataOn =
    systemOn && runtime.tradingSource === "TWELVE_DATA";
  const mt5On = systemOn && runtime.tradingSource === "MT5";

  if (!config || !permissions) return null;

  const runtimePayload = (patch: RuntimePatch = {}) => ({
    scannerState: runtime.scannerState,
    tradingMode: runtime.tradingMode,
    tradingSource: runtime.tradingSource,
    mt5DisconnectBehavior: runtime.mt5DisconnectBehavior,
    autoReturnMt5: runtime.autoReturnMt5,
    autoStart: runtime.autoStart,
    autoExecutionEnabled: runtime.autoExecutionEnabled,
    ...patch,
  });

  const perform = async (
    key: string,
    action: () => Promise<void>,
    message: string,
  ) => {
    setBusyKey(key);
    setError("");
    try {
      await action();
      onChanged(message);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "System control failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const saveConfig = (patch: Record<string, unknown>) =>
    brainRequest("/config", "PUT", { ...config, ...patch }).then(() => {});
  const saveRuntime = (patch: RuntimePatch) =>
    brainRequest("/runtime", "PUT", runtimePayload(patch)).then(() => {});
  const savePermissions = (patch: Partial<ScannerPermissions>) =>
    saveConfig({ permissions: { ...permissions, ...patch } });
  const coreAnalysisPermissions = {
    ...permissions,
    automaticScanning: true,
    automaticSetupDetection: true,
    automaticCandidateCreation: true,
    automaticWatchlist: true,
    automaticAlerts: true,
    automaticRiskCalculation: true,
    automaticOrderPreparation: true,
    aiAnalysis: true,
    journalInsights: true,
  };

  const setWholeSystem = (enabled: boolean) =>
    perform(
      "system",
      async () => {
        if (enabled) {
          await saveRuntime({
            scannerState: "RUNNING",
            tradingMode: "ANALYSIS",
            autoStart: true,
            autoExecutionEnabled: false,
          });
          await saveConfig({
            enabled: true,
            permissions: coreAnalysisPermissions,
          });
          return;
        }
        await saveRuntime({
          scannerState: "STOPPED",
          tradingMode: "ANALYSIS",
          autoStart: false,
          autoExecutionEnabled: false,
        });
        await saveConfig({ enabled: false });
      },
      enabled
        ? "Onkar AI system is ON in safe analysis mode."
        : "Onkar AI system, scanner and new execution are OFF.",
    );

  const setScanner = (enabled: boolean) =>
    perform(
      "scanner",
      async () => {
        if (enabled) {
          await saveRuntime({ scannerState: "RUNNING", autoStart: true });
          await saveConfig({
            enabled: true,
            permissions: {
              ...permissions,
              automaticScanning: true,
              automaticSetupDetection: true,
              automaticCandidateCreation: true,
            },
          });
          return;
        }
        await saveRuntime({
          scannerState: "STOPPED",
          tradingMode:
            runtime.tradingMode === "AUTO" ? "ANALYSIS" : runtime.tradingMode,
          autoStart: false,
          autoExecutionEnabled: false,
        });
        await saveConfig({ enabled: false });
      },
      enabled ? "Market scanner switched ON." : "Market scanner switched OFF.",
    );

  const setProvider = (source: "MT5" | "TWELVE_DATA", enabled: boolean) =>
    perform(
      source,
      async () => {
        if (!enabled) {
          if (runtime.tradingSource !== source) return;
          await saveRuntime({
            scannerState: "STOPPED",
            tradingMode: "ANALYSIS",
            autoStart: false,
            autoExecutionEnabled: false,
          });
          await saveConfig({ enabled: false });
          return;
        }
        await saveRuntime({
          scannerState: "RUNNING",
          tradingSource: source,
          autoStart: true,
          tradingMode: "ANALYSIS",
          autoExecutionEnabled: false,
        });
        await saveConfig({
          enabled: true,
          provider: source === "MT5" ? "mt5" : "twelvedata",
          permissions: {
            ...permissions,
            automaticScanning: true,
            automaticSetupDetection: true,
            automaticCandidateCreation: true,
          },
        });
      },
      enabled
        ? `${source === "MT5" ? "MT5" : "Twelve Data"} selected and switched ON.`
        : `${source === "MT5" ? "MT5" : "Twelve Data"} switched OFF; scanning stopped safely.`,
    );

  const setPermission = (
    key: keyof ScannerPermissions,
    enabled: boolean,
    label: string,
  ) =>
    perform(
      key,
      () => savePermissions({ [key]: enabled }),
      `${label} switched ${enabled ? "ON" : "OFF"}.`,
    );

  const setAutoExecution = (enabled: boolean) => {
    if (
      enabled &&
      !window.confirm(
        `Enable automatic ${runtime.tradingSource === "MT5" ? "broker" : "paper"} execution? Approved setup, candle-close, fresh-data and risk checks still apply.`,
      )
    )
      return;
    void perform(
      "autoExecution",
      () =>
        saveRuntime({
          scannerState: enabled ? "RUNNING" : runtime.scannerState,
          tradingMode: enabled ? "AUTO" : "CONFIRM",
          autoStart: enabled ? true : runtime.autoStart,
          autoExecutionEnabled: enabled,
        }),
      enabled
        ? "Automatic execution armed after server safety checks."
        : "Automatic execution switched OFF; confirmation mode remains available.",
    );
  };

  const controls = [
    {
      key: "scanner",
      title: "Market Scanner",
      detail: "Shared 4H → 1H → 30M scanning",
      Icon: ScanLine,
      checked: systemOn,
      onChange: setScanner,
    },
    {
      key: "TWELVE_DATA",
      title: "Twelve Data",
      detail:
        snapshot.connection.twelveData?.replaceAll("_", " ") ?? "market data",
      Icon: CloudCog,
      checked: twelveDataOn,
      onChange: (enabled: boolean) =>
        void setProvider("TWELVE_DATA", enabled),
    },
    {
      key: "MT5",
      title: "MetaTrader 5",
      detail:
        snapshot.connection.mt5?.replaceAll("_", " ") ?? "broker connection",
      Icon: Network,
      checked: mt5On,
      onChange: (enabled: boolean) => void setProvider("MT5", enabled),
    },
    {
      key: "aiAnalysis" as const,
      title: "AI Analysis",
      detail: "Specialist review after deterministic detection",
      Icon: BrainCircuit,
      checked: systemOn && permissions.aiAnalysis,
      disabled: !systemOn,
      onChange: (enabled: boolean) =>
        void setPermission("aiAnalysis", enabled, "AI analysis"),
    },
    {
      key: "automaticAlerts" as const,
      title: "Alerts",
      detail: "Lifecycle and system notifications",
      Icon: Bell,
      checked: systemOn && permissions.automaticAlerts,
      disabled: !systemOn,
      onChange: (enabled: boolean) =>
        void setPermission("automaticAlerts", enabled, "Alerts"),
    },
    {
      key: "paperTradeExecution" as const,
      title: "Paper Execution",
      detail: "Virtual orders using live market prices",
      Icon: Database,
      checked: systemOn && permissions.paperTradeExecution,
      disabled: !systemOn,
      onChange: (enabled: boolean) =>
        void setPermission("paperTradeExecution", enabled, "Paper execution"),
    },
    {
      key: "mt5LiveExecution" as const,
      title: "MT5 Live Permission",
      detail: "Allows routing only when broker execution is ready",
      Icon: ShieldCheck,
      checked: systemOn && permissions.mt5LiveExecution,
      disabled: !systemOn,
      onChange: (enabled: boolean) => {
        if (
          enabled &&
          !window.confirm(
            "Allow MT5 live execution? This grants permission only; automatic execution remains controlled separately and all risk checks still apply.",
          )
        )
          return;
        void setPermission("mt5LiveExecution", enabled, "MT5 live permission");
      },
    },
    {
      key: "autoExecution",
      title: "Automatic Execution",
      detail: `Current route: ${runtime.tradingSource.replaceAll("_", " ")}`,
      Icon: Zap,
      checked:
        systemOn &&
        runtime.tradingMode === "AUTO" &&
        runtime.autoExecutionEnabled,
      disabled: !systemOn,
      onChange: setAutoExecution,
    },
  ];

  return (
    <section className={`mb-system-control ${systemOn ? "is-on" : ""}`}>
      <div className="mb-system-master">
        <span className="mb-system-master-icon">
          <Power size={23} />
        </span>
        <div>
          <span className="mb-eyebrow">MAIN SYSTEM CONTROL</span>
          <h3>Onkar AI Trading System</h3>
          <p>
            {systemOn
              ? "System online · choose each connection and permission below."
              : "System offline · scanning and new execution are stopped."}
          </p>
        </div>
        <Toggle
          checked={systemOn}
          disabled={busyKey !== null}
          label="Turn the whole Onkar AI system on or off"
          onChange={(enabled) => void setWholeSystem(enabled)}
        />
      </div>
      <div className="mb-system-control-grid">
        {controls.map(
          ({ key, title, detail, Icon, checked, disabled, onChange }) => (
            <article
              className={`${checked ? "is-on" : ""} ${disabled ? "is-disabled" : ""}`}
              key={key}
            >
              <span className="mb-system-control-icon">
                <Icon size={19} />
              </span>
              <div>
                <strong>{title}</strong>
                <small>{detail}</small>
              </div>
              <Toggle
                checked={checked}
                disabled={busyKey !== null || disabled}
                label={`Turn ${title} on or off`}
                onChange={onChange}
              />
            </article>
          ),
        )}
      </div>
      <p className="mb-system-safety">
        Main ON starts safe analysis mode. Live or automatic orders require
        their own permission, a valid account, fresh data, approved setup rules
        and server risk approval.
      </p>
      {error ? (
        <p className="mb-notice" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
