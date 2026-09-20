import type { ScannerCandidate, ScannerSnapshot } from "@workspace/api-zod";
import type { CSSProperties } from "react";
import {
  Activity,
  BrainCircuit,
  Check,
  CircleDot,
  CloudCog,
  Database,
  GitBranch,
  History,
  Lightbulb,
  Network,
  Radio,
  ScanLine,
  ShieldCheck,
  Target,
  X,
  Zap,
} from "lucide-react";
import type { AgentId } from "../onkar-ai/agent-data";
import { useAgentAnimationState } from "../onkar-ai/useAgentAnimationState";

const lifecycle = [
  ["SCANNING", "Scanning", ScanLine],
  ["DEVELOPING", "Approaching", Activity],
  ["WATCH", "Waiting close", CircleDot],
  ["READY", "Confirmed", Check],
  ["TRIGGERED", "Active", Zap],
  ["COMPLETED", "Closed", History],
] as const;

const stageIndex = (state?: string) => {
  const found = lifecycle.findIndex(([id]) => id === state);
  return found < 0 ? 0 : found;
};

export function TradingLifecycle({
  candidate,
}: {
  candidate?: ScannerCandidate | null;
}) {
  const current = stageIndex(candidate?.state);
  const invalid = ["INVALIDATED", "EXPIRED"].includes(candidate?.state ?? "");
  return (
    <section className={`mb-lifecycle ${invalid ? "is-invalid" : ""}`}>
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">Live setup lifecycle</span>
          <h3>
            {candidate
              ? `${candidate.symbol} · ${candidate.payload.strategyName}`
              : "Scanner pipeline"}
          </h3>
        </div>
        <span className={`mb-badge ${invalid ? "mb-danger" : "mb-positive"}`}>
          {candidate?.state ?? "AWAITING CANDIDATE"}
        </span>
      </div>
      <div className="mb-life-scroll">
        <div
          className="mb-life-track"
          style={
            {
              "--life-progress": `${(current / (lifecycle.length - 1)) * 100}%`,
            } as CSSProperties
          }
        >
          {lifecycle.map(([id, label, Icon], index) => (
            <div
              className={`mb-life-stage ${index < current ? "is-complete" : ""} ${index === current && candidate ? "is-current" : ""}`}
              key={id}
            >
              <span className="mb-life-node">
                <Icon size={17} />
              </span>
              <strong>{label}</strong>
              <small>
                {index < current
                  ? "Complete"
                  : index === current && candidate
                    ? "Current stage"
                    : "Pending"}
              </small>
            </div>
          ))}
        </div>
      </div>
      {invalid ? (
        <p className="mb-life-invalid">
          <X size={15} /> Setup left the valid path: {candidate?.state}.
        </p>
      ) : null}
    </section>
  );
}

const agentNodes: Array<[AgentId, string, typeof Activity]> = [
  ["trend", "Trend", GitBranch],
  ["zone", "Zone", ScanLine],
  ["setup", "Setup", Target],
  ["risk", "Risk", ShieldCheck],
  ["news", "News", Radio],
  ["backtest", "Backtest", History],
  ["journal", "Journal", Database],
  ["insight", "Insight", Lightbulb],
  ["execution", "Execution", Zap],
];

function AgentOrbitNode({
  id,
  name,
  Icon,
  index,
  onOpen,
}: {
  id: AgentId;
  name: string;
  Icon: typeof Activity;
  index: number;
  onOpen?: (id: AgentId) => void;
}) {
  const state = useAgentAnimationState(id);
  return (
    <button
      type="button"
      className={`mb-agent-node is-${state.state}`}
      style={{ "--agent-index": index } as CSSProperties}
      onClick={() => onOpen?.(id)}
      aria-label={`${name} ${state.statusLabel}`}
    >
      <span>
        <Icon size={17} />
      </span>
      <strong>{name}</strong>
      <small>{state.statusLabel}</small>
    </button>
  );
}

export function MasterAIOrbitalHub({
  onOpen,
}: {
  onOpen?: (id: AgentId) => void;
}) {
  const master = useAgentAnimationState("master");
  return (
    <section className="mb-ai-hub-panel">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">AI orchestration hub</span>
          <h3>Master AI command network</h3>
        </div>
        <span className={`mb-badge ${master.confirmed ? "mb-positive" : ""}`}>
          {master.statusLabel}
        </span>
      </div>
      <div className="mb-ai-orbit" aria-label="Onkar AI agent activity">
        <div className="mb-orbit-ring mb-ring-one" />
        <div className="mb-orbit-ring mb-ring-two" />
        <button
          className={`mb-master-core is-${master.state}`}
          onClick={() => onOpen?.("master")}
        >
          <span className="mb-master-halo" />
          <BrainCircuit size={38} />
          <strong>MASTER AI</strong>
          <small>{master.statusLabel}</small>
        </button>
        {agentNodes.map(([id, name, Icon], index) => (
          <AgentOrbitNode
            key={id}
            id={id}
            name={name}
            Icon={Icon}
            index={index}
            onOpen={onOpen}
          />
        ))}
      </div>
      <p className="mb-hub-note">
        Nodes light up only when the real agent runtime reports work. Preview
        and unavailable states are never presented as live analysis.
      </p>
    </section>
  );
}

export function DataProviderManager({
  snapshot,
  busy,
  onSelect,
  onTest,
}: {
  snapshot: ScannerSnapshot;
  busy: boolean;
  onSelect: (provider: "MT5" | "TWELVE_DATA") => void;
  onTest: () => void;
}) {
  const selected = snapshot.runtime.tradingSource;
  const health = snapshot.config?.health ?? {};
  const selectedAccount = snapshot.accounts.find(
    (account) => account.id === snapshot.config?.config.accountId,
  );
  const cards = [
    {
      id: "MT5" as const,
      name: "MetaTrader 5",
      icon: Network,
      status: String(health.mt5 ?? snapshot.connection.mt5 ?? "not configured"),
      description: `Broker execution · ${snapshot.connection.executionBroker ?? "not connected"} ${snapshot.connection.executionAccountType ?? ""}`,
    },
    {
      id: "TWELVE_DATA" as const,
      name: "Twelve Data",
      icon: CloudCog,
      status: String(
        health.twelveData ??
          (selected === "TWELVE_DATA"
            ? (snapshot.connection.twelveData ?? snapshot.connection.market)
            : "standby"),
      ),
      description: `Paper execution · ${selectedAccount?.name ?? "select an Onkar account"}`,
    },
  ];
  return (
    <section className="mb-provider-manager">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">TRADING SOURCE</span>
          <h3>MT5 or Twelve Data Paper</h3>
        </div>
        <button onClick={onTest} disabled={busy}>
          Test active feed
        </button>
      </div>
      <div className="mb-provider-grid">
        {cards.map(({ id, name, icon: Icon, status, description }) => {
          const active = selected === id;
          const connected = /connected|fresh|standby/i.test(status);
          return (
            <article
              className={`mb-provider-card ${active ? "is-primary" : ""}`}
              key={id}
            >
              <div className="mb-provider-icon">
                <Icon size={23} />
              </div>
              <div>
                <strong>{name}</strong>
                <p>{description}</p>
              </div>
              <span
                className={`mb-provider-health ${connected ? "is-up" : ""}`}
              >
                {status.replaceAll("_", " ")}
              </span>
              <button disabled={busy || active} onClick={() => onSelect(id)}>
                {active
                  ? `✓ ${id === "MT5" ? "MT5" : "TWELVE DATA"} ACTIVE`
                  : `USE ${id === "MT5" ? "MT5" : "TWELVE DATA"}`}
              </button>
            </article>
          );
        })}
      </div>
      <div className="mb-provider-route">
        <span className="is-active">
          {selected === "MT5" ? "MT5" : "TWELVE DATA"}
        </span>
        <i />
        <span>SHARED CANDLES</span>
        <i />
        <span>CHART + SCANNER + 10 AIs</span>
      </div>
      <p className="mb-hub-note">
        One Market Brain and Setup Engine are shared. MT5 sends broker orders;
        Twelve Data opens virtual trades only in the selected Onkar Paper
        account.
      </p>
    </section>
  );
}

export function SetupActivationPanel({
  snapshot,
  busy,
  onToggle,
}: {
  snapshot: ScannerSnapshot;
  busy: boolean;
  onToggle: (versionId: string, enabled: boolean) => void;
}) {
  const approved = snapshot.versions.filter(
    (v) => v.definition.approval === "approved",
  );
  const automatic =
    snapshot.config?.config.autoActivateApprovedSetups ??
    snapshot.defaults.autoActivateApprovedSetups;
  const enabled = new Set(
    automatic
      ? approved.map((version) => version.id)
      : (snapshot.config?.config.strategyVersionIds ?? []),
  );
  return (
    <section className="mb-setup-activation">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">Approved strategy library</span>
          <h3>Automatic Setup Detection</h3>
        </div>
        <span className="mb-badge mb-positive">{enabled.size} ACTIVE</span>
      </div>
      {!approved.length ? (
        <p className="mb-notice">
          No approved strategy version is available. Draft and AI-extracted
          rules remain safely blocked.
        </p>
      ) : (
        <div className="mb-setup-slider">
          {approved.map((version) => {
            const on = enabled.has(version.id);
            const candidates = snapshot.candidates.filter(
              (candidate) => candidate.version_id === version.id,
            );
            const latest = candidates[0];
            return (
              <article
                className={`mb-setup-card ${on ? "is-on" : ""}`}
                key={version.id}
              >
                <div className="mb-row mb-between">
                  <span className="mb-setup-number">
                    {String(approved.indexOf(version) + 1).padStart(2, "0")}
                  </span>
                  <button
                    className="mb-switch"
                    role="switch"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => onToggle(version.id, !on)}
                  >
                    <span />
                  </button>
                </div>
                <h4>{version.name}</h4>
                <p>
                  {version.definition.direction.toUpperCase()} ·{" "}
                  {version.definition.higherTimeframe} →{" "}
                  {version.definition.timeframe}
                </p>
                <div className="mb-chip-row">
                  <span>
                    {version.definition.symbols.length
                      ? version.definition.symbols.join(" · ")
                      : "Scanner markets"}
                  </span>
                  <span>R:R ≥ {version.definition.minRR}</span>
                </div>
                <div className="mb-setup-result">
                  <small>LAST RESULT</small>
                  <strong>{latest?.state ?? "NO CANDIDATE"}</strong>
                  <small>
                    {candidates.length} candidate
                    {candidates.length === 1 ? "" : "s"}
                  </small>
                </div>
                <footer>
                  {version.definition.autoExecutionAllowed
                    ? "AUTO PERMITTED"
                    : "REVIEW / MANUAL"}
                  <span>APPROVED</span>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
