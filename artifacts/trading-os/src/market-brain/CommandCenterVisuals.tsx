import {
  timeframeMs,
  type ScannerCandidate,
  type ScannerConfig,
  type ScannerPermissions,
  type ScannerSnapshot,
  type TradeManagement,
} from "@workspace/api-zod";
import { useEffect, useState, type CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  BrainCircuit,
  CandlestickChart,
  Check,
  ChevronRight,
  CircleDot,
  CloudCog,
  Database,
  Gauge,
  GitBranch,
  History,
  Lightbulb,
  LockKeyhole,
  Network,
  Newspaper,
  PauseCircle,
  Radio,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
  UserRoundCheck,
  X,
  Zap,
} from "lucide-react";
import { latestApprovedVersions } from "./strategy-versions";
import { setupCoverage } from "./setup-coverage";
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
  monitoringCount = 0,
  candidates = [],
  onStageSelect,
}: {
  candidate?: ScannerCandidate | null;
  monitoringCount?: number;
  candidates?: ScannerCandidate[];
  onStageSelect?: (stage: string) => void;
}) {
  const current = stageIndex(candidate?.state);
  const invalid = ["INVALIDATED", "EXPIRED"].includes(candidate?.state ?? "");
  const monitoring = !candidate && monitoringCount > 0;
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
          {candidate?.state ??
            (monitoring
              ? `${monitoringCount} SETUPS MONITORING`
              : "AWAITING CANDIDATE")}
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
          {lifecycle.map(([id, label, Icon], index) => {
            const count =
              id === "SCANNING"
                ? monitoringCount
                : candidates.filter((item) => item.state === id).length;
            const Element = onStageSelect ? "button" : "div";
            return (
              <Element
                type={onStageSelect ? "button" : undefined}
                className={`mb-life-stage ${index < current ? "is-complete" : ""} ${index === current && (candidate || monitoring) ? "is-current" : ""}`}
                key={id}
                onClick={() => onStageSelect?.(id)}
              >
                <span className="mb-life-node">
                  <Icon size={17} />
                </span>
                <strong>
                  {label} <b>{count}</b>
                </strong>
                <small>
                  {index < current
                    ? "Complete"
                    : index === current && candidate
                      ? "Current stage"
                      : index === 0 && monitoring
                        ? "Real data monitoring"
                        : "Pending"}
                </small>
              </Element>
            );
          })}
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
  const approved = latestApprovedVersions(snapshot);
  const automatic =
    snapshot.config?.config.autoActivateApprovedSetups ??
    snapshot.defaults.autoActivateApprovedSetups;
  const enabled = new Set(
    automatic
      ? approved.map((version) => version.id)
      : (snapshot.config?.config.strategyVersionIds ?? []),
  );
  const coverage = setupCoverage(snapshot);
  const scannedVersions = new Set(
    coverage
      .filter((result) => enabled.has(result.versionId))
      .map((result) => result.versionId),
  );
  return (
    <section className="mb-setup-activation">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">Approved strategy library</span>
          <h3>Automatic Setup Detection</h3>
        </div>
        <span className="mb-badge mb-positive">
          {scannedVersions.size}/{enabled.size} SCANNED
        </span>
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
            const evaluations = coverage
              .filter((result) => result.versionId === version.id)
              .sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
            const latestEvaluation = evaluations[0];
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
                  <strong>
                    {latest?.state ??
                      latestEvaluation?.status ??
                      "AWAITING SCAN"}
                  </strong>
                  <small>
                    {latestEvaluation
                      ? `${latestEvaluation.score}/100 · ${evaluations.length} market${evaluations.length === 1 ? "" : "s"} checked`
                      : "No completed evaluation yet"}
                  </small>
                </div>
                <details className="mb-setup-proof">
                  <summary>Scanner evidence by market</summary>
                  {evaluations.length ? (
                    evaluations.map((result) => (
                      <div key={`${result.versionId}:${result.symbol}`}>
                        <strong>
                          {result.symbol} · {result.status} · {result.score}/100
                        </strong>
                        <small>
                          {result.passed}/{result.total} rules · candle {localTime(result.lastCandleAt)}
                        </small>
                        <small>
                          {result.requiredMissing.length
                            ? `Required missing: ${result.requiredMissing.join(", ")}`
                            : "All required rules passed"}
                        </small>
                      </div>
                    ))
                  ) : (
                    <p>Awaiting the first completed scanner cycle.</p>
                  )}
                </details>
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

const titleState = (value: string) => value.replaceAll("_", " ");
const localTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Vienna",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(value))
    : "—";

export function CommandCenterHero({
  snapshot,
  activeSetups,
  onOpenScanner,
  onRefresh,
}: {
  snapshot: ScannerSnapshot;
  activeSetups: number;
  onOpenScanner: () => void;
  onRefresh: () => void;
}) {
  const config = snapshot.config?.config;
  const account = snapshot.accounts.find(
    (item) => item.id === config?.accountId,
  );
  const fresh =
    snapshot.connection.market === "connected" &&
    snapshot.connection.worker === "recent_heartbeat";
  return (
    <section className="mb-os-hero">
      <div className="mb-os-grid" aria-hidden="true" />
      <div className="mb-os-hero-copy">
        <span className="mb-eyebrow">ONKAR AI · TRADING OPERATING SYSTEM</span>
        <h1>
          MARKET <em>SCANNER</em>
        </h1>
        <p>
          One shared market brain coordinating approved setups, deterministic
          risk, specialist intelligence and provider-safe execution.
        </p>
        <div className="mb-os-actions">
          <button onClick={onOpenScanner}>
            <ScanLine size={17} /> Open command scanner
          </button>
          <button className="is-secondary" onClick={onRefresh}>
            <RotateCcw size={16} /> Refresh system
          </button>
        </div>
      </div>
      <div className="mb-os-status-grid">
        {[
          [
            "Scanner",
            snapshot.runtime.scannerState,
            ScanLine,
            snapshot.runtime.scannerState === "RUNNING",
          ],
          [
            "Market data",
            fresh ? "FRESH" : snapshot.connection.market,
            Radio,
            fresh,
          ],
          [
            "Source",
            snapshot.runtime.tradingSource.replace("_", " "),
            CloudCog,
            true,
          ],
          [
            "Execution",
            snapshot.runtime.emergencyStop
              ? "LOCKED"
              : snapshot.runtime.autoExecutionEnabled
                ? "AUTO ARMED"
                : snapshot.runtime.tradingMode,
            Zap,
            snapshot.runtime.autoExecutionEnabled,
          ],
          [
            "Account",
            account?.name ?? "NOT SELECTED",
            UserRoundCheck,
            Boolean(account),
          ],
          ["Setups", `${activeSetups} ENABLED`, Target, activeSetups > 0],
          [
            "Markets",
            `${config?.symbols.length ?? 0} ACTIVE`,
            CandlestickChart,
            Boolean(config?.symbols.length),
          ],
          [
            "Master AI",
            snapshot.connection.ai ?? "UNAVAILABLE",
            BrainCircuit,
            /connected|configured/i.test(snapshot.connection.ai ?? ""),
          ],
        ].map(([label, value, Icon, healthy]) => {
          const StatusIcon = Icon as typeof ScanLine;
          return (
            <div className={healthy ? "is-healthy" : ""} key={String(label)}>
              <StatusIcon size={15} />
              <span>{String(label)}</span>
              <strong>{titleState(String(value))}</strong>
            </div>
          );
        })}
      </div>
      <footer>
        <span>
          <i className={fresh ? "is-live" : ""} /> Last scanner update{" "}
          {localTime(snapshot.config?.last_run_at)}
        </span>
        <span>
          Europe/Vienna ·{" "}
          {snapshot.runtime.tradingSource === "MT5"
            ? snapshot.connection.executionBroker
            : "Onkar Paper"}
        </span>
      </footer>
    </section>
  );
}

export function LiveCandidateCarousel({
  snapshot,
  onOpen,
}: {
  snapshot: ScannerSnapshot;
  onOpen: (id: string) => void;
}) {
  const candidates = snapshot.candidates
    .filter((item) =>
      ["SCANNING", "DEVELOPING", "WATCH", "READY", "TRIGGERED"].includes(
        item.state,
      ),
    )
    .sort((a, b) => b.score - a.score);
  const approved = latestApprovedVersions(snapshot);
  const activeVersionIds = new Set(
    snapshot.config?.config.autoActivateApprovedSetups
      ? approved.map((version) => version.id)
      : (snapshot.config?.config.strategyVersionIds ?? []),
  );
  const coverage = setupCoverage(snapshot).filter((result) =>
    activeVersionIds.has(result.versionId),
  );
  const markets = snapshot.config?.config.symbols ?? [];
  const eligibleChecks = approved.flatMap((version) =>
    markets
      .filter(
        (symbol) =>
          activeVersionIds.has(version.id) &&
          (!version.definition.symbols.length ||
            version.definition.symbols.includes(symbol)),
      )
      .map((symbol) => `${version.id}:${symbol}`),
  );
  const completedChecks = new Set(
    coverage.map((result) => `${result.versionId}:${result.symbol}`),
  );
  const completedEligibleChecks = eligibleChecks.filter((key) =>
    completedChecks.has(key),
  ).length;
  const coverageByMarket = markets.map((symbol) => {
    const eligible = eligibleChecks.filter((key) => key.endsWith(`:${symbol}`));
    const complete = eligible.filter((key) => completedChecks.has(key)).length;
    const scannedAt = coverage
      .filter((result) => result.symbol === symbol)
      .map((result) => result.analyzedAt)
      .sort((a, b) => b.localeCompare(a))[0];
    return { symbol, eligible: eligible.length, complete, scannedAt };
  });
  return (
    <section className="mb-os-panel">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">LIVE OPPORTUNITIES</span>
          <h3>Candidate command rail</h3>
        </div>
        <div className="mb-chip-row">
          <span className="mb-badge">{candidates.length} QUALIFIED</span>
          <span className="mb-badge mb-positive">
            {completedEligibleChecks}/{eligibleChecks.length} SETUP-MARKET CHECKS
          </span>
        </div>
      </div>
      {!candidates.length ? (
        <div className="mb-os-empty">
          <ScanLine size={24} />
          <div>
            <strong>No qualifying candidate yet</strong>
            <p>Approved setups continue monitoring real closed-candle data.</p>
          </div>
        </div>
      ) : (
        <div className="mb-os-candidate-rail">
          {candidates.map((candidate) => {
            const timeframe =
              timeframeMs[candidate.timeframe as keyof typeof timeframeMs] ?? 0;
            const nextClose = Date.parse(candidate.last_candle_at) + timeframe;
            const remaining = Math.max(0, nextClose - Date.now());
            const minutes = Math.floor(remaining / 60_000);
            const seconds = Math.floor((remaining % 60_000) / 1000);
            const passed = candidate.payload.rules.filter(
              (rule) => rule.passed,
            ).length;
            return (
              <article
                className={`mb-os-candidate is-${candidate.state.toLowerCase()}`}
                key={candidate.id}
              >
                <header>
                  <div>
                    <strong>{candidate.symbol}</strong>
                    <span>{candidate.payload.direction.toUpperCase()}</span>
                  </div>
                  <b>
                    {candidate.score}
                    <small>/100</small>
                  </b>
                </header>
                <h4>{candidate.payload.strategyName}</h4>
                <p>
                  {candidate.timeframe.toUpperCase()} ·{" "}
                  {titleState(candidate.state)}
                </p>
                <div className="mb-os-confluence">
                  <span style={{ width: `${candidate.score}%` }} />
                </div>
                <div className="mb-os-evidence">
                  <span>
                    Rules{" "}
                    <b>
                      {passed}/{candidate.payload.rules.length}
                    </b>
                  </span>
                  <span>
                    News <b>{candidate.payload.news.status}</b>
                  </span>
                  <span>
                    Risk <b>{candidate.plan?.allowed ? "PASS" : "PENDING"}</b>
                  </span>
                  <span>
                    Close{" "}
                    <b>
                      {remaining
                        ? `${minutes}:${String(seconds).padStart(2, "0")}`
                        : "CLOSED"}
                    </b>
                  </span>
                </div>
                <div className="mb-trade-plan">
                  <span>
                    <small>ENTRY</small>
                    {candidate.plan?.entry ?? "—"}
                  </span>
                  <span>
                    <small>SL</small>
                    {candidate.plan?.stop ?? "—"}
                  </span>
                  <span>
                    <small>TP</small>
                    {candidate.plan?.target ?? "—"}
                  </span>
                  <span>
                    <small>R:R</small>
                    {candidate.plan?.rr?.toFixed(2) ?? "—"}
                  </span>
                </div>
                <button onClick={() => onOpen(candidate.id)}>
                  View full analysis <ChevronRight size={15} />
                </button>
              </article>
            );
          })}
        </div>
      )}
      <div className="mb-coverage-proof" aria-label="Scanner setup coverage">
        <strong>
          Deterministic scanner: {activeVersionIds.size} approved setup versions
          {markets.length ? ` across ${markets.length} markets` : ""}
        </strong>
        <p>
          Candles are fetched once per timeframe and reused for every setup. AI
          explanations run only after deterministic confluence reaches your AI
          threshold.
        </p>
        <div className="mb-chip-row">
          {coverageByMarket.map((item) => (
            <span key={item.symbol}>
              {item.symbol} {item.complete}/{item.eligible}
              {item.scannedAt
                ? ` · ${new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(item.scannedAt))}`
                : " · awaiting scan"}
            </span>
          ))}
        </div>
      </div>
      <p className="mb-hub-note">
        Scores measure rule confluence—not probability. Every required rule must
        still pass.
      </p>
    </section>
  );
}

export function BossBriefing({ snapshot }: { snapshot: ScannerSnapshot }) {
  const waiting = snapshot.candidates.filter((item) => item.state === "WATCH");
  const ready = snapshot.candidates.filter((item) => item.state === "READY");
  const blocked = snapshot.candidates.filter(
    (item) => item.payload.warnings.length > 0 || item.staleNow,
  );
  const open = snapshot.paperTrades.filter((item) => item.status === "OPEN");
  const closed = snapshot.paperTrades.filter(
    (item) => item.status === "CLOSED",
  );
  const latest = [...snapshot.candidates].sort((a, b) =>
    String(b.updated_at ?? b.payload.analyzedAt).localeCompare(
      String(a.updated_at ?? a.payload.analyzedAt),
    ),
  )[0];
  const notes = [
    ready.length
      ? `${ready.length} setup${ready.length === 1 ? " is" : "s are"} confirmed and ready for execution checks.`
      : null,
    waiting.length
      ? `${waiting.length} setup${waiting.length === 1 ? " is" : "s are"} waiting for required candle confirmation.`
      : null,
    blocked.length
      ? `${blocked.length} candidate${blocked.length === 1 ? " has" : "s have"} stale-data, news or risk warnings.`
      : null,
    open.length
      ? `${open.length} Paper trade${open.length === 1 ? " is" : "s are"} currently managed by its saved plan.`
      : null,
    !snapshot.candidates.length
      ? "No setup has crossed the deterministic candidate threshold yet."
      : null,
  ].filter(Boolean) as string[];
  return (
    <section className="mb-os-panel mb-boss-briefing">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">MASTER AI · BOSS BRIEFING</span>
          <h3>What needs attention</h3>
        </div>
        <span className="mb-badge mb-positive">VERIFIED DATA</span>
      </div>
      <div className="mb-boss-layout">
        <div className="mb-boss-core">
          <BrainCircuit size={31} />
          <span>MASTER AI</span>
          <strong>{snapshot.runtime.scannerState}</strong>
        </div>
        <div className="mb-boss-notes">
          {notes.map((note) => (
            <p key={note}>
              <Check size={14} />
              {note}
            </p>
          ))}
          {latest ? (
            <small>
              Latest: {latest.symbol} · {latest.payload.strategyName} ·{" "}
              {titleState(latest.state)} at{" "}
              {localTime(latest.updated_at ?? latest.payload.analyzedAt)}
            </small>
          ) : null}
        </div>
        <div className="mb-boss-kpis">
          <span>
            <b>{ready.length}</b> Confirmed
          </span>
          <span>
            <b>{waiting.length}</b> Waiting close
          </span>
          <span>
            <b>{open.length}</b> Active
          </span>
          <span>
            <b>{closed.length}</b> Closed
          </span>
        </div>
      </div>
    </section>
  );
}

export function TradeCommandCenter({
  snapshot,
  onOpenJournal,
}: {
  snapshot: ScannerSnapshot;
  onOpenJournal: () => void;
}) {
  const preparing = snapshot.candidates.filter((item) =>
    ["DEVELOPING", "WATCH", "READY"].includes(item.state),
  );
  const active = snapshot.paperTrades.filter((item) => item.status === "OPEN");
  const closed = snapshot.paperTrades.filter(
    (item) => item.status === "CLOSED",
  );
  const [view, setView] = useState<"PREPARING" | "ACTIVE" | "CLOSED">(
    "PREPARING",
  );
  return (
    <section className="mb-os-panel">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">TRADE COMMAND</span>
          <h3>Preparing · Active · Closed</h3>
        </div>
      </div>
      <div className="mb-os-segments">
        {(["PREPARING", "ACTIVE", "CLOSED"] as const).map((item) => (
          <button
            className={view === item ? "is-active" : ""}
            onClick={() => setView(item)}
            key={item}
          >
            {item}
            <b>
              {item === "PREPARING"
                ? preparing.length
                : item === "ACTIVE"
                  ? active.length
                  : closed.length}
            </b>
          </button>
        ))}
      </div>
      <div className="mb-os-trade-list">
        {view === "PREPARING" &&
          preparing.map((item) => (
            <article key={item.id}>
              <Target size={18} />
              <div>
                <strong>
                  {item.symbol} · {item.payload.strategyName}
                </strong>
                <small>
                  {titleState(item.state)} · {item.timeframe.toUpperCase()} ·{" "}
                  {item.payload.passed}/{item.payload.total} rules
                </small>
              </div>
              <span>{item.score}/100</span>
            </article>
          ))}
        {view === "ACTIVE" &&
          active.map((item) => (
            <article key={item.id}>
              <TrendingUp size={18} />
              <div>
                <strong>
                  {item.symbol} · {item.direction}
                </strong>
                <small>
                  Entry {item.entry} · Current {item.current_price} · SL{" "}
                  {item.stop_loss} · TP {item.take_profit}
                </small>
              </div>
              <span>{item.pnl == null ? "—" : item.pnl.toFixed(2)}</span>
            </article>
          ))}
        {view === "CLOSED" &&
          closed.map((item) => (
            <article key={item.id}>
              <History size={18} />
              <div>
                <strong>
                  {item.symbol} · {item.direction}
                </strong>
                <small>
                  Closed {localTime(item.closed_at)} · Paper execution
                </small>
              </div>
              <span>
                {item.r_multiple == null
                  ? "—"
                  : `${item.r_multiple.toFixed(2)}R`}
              </span>
            </article>
          ))}
        {(view === "PREPARING" && !preparing.length) ||
        (view === "ACTIVE" && !active.length) ||
        (view === "CLOSED" && !closed.length) ? (
          <div className="mb-os-empty">
            <PauseCircle size={20} />
            <p>No real records in this stage.</p>
          </div>
        ) : null}
      </div>
      <button className="mb-os-link" onClick={onOpenJournal}>
        Open trade journal <ChevronRight size={15} />
      </button>
    </section>
  );
}

const permissionRows: Array<
  [keyof ScannerPermissions, string, string, typeof ScanLine]
> = [
  [
    "automaticScanning",
    "Automatic scanning",
    "Run the shared market worker",
    ScanLine,
  ],
  [
    "automaticSetupDetection",
    "Setup detection",
    "Evaluate approved deterministic rules",
    Target,
  ],
  [
    "automaticCandidateCreation",
    "Candidate creation",
    "Persist lifecycle candidates",
    CircleDot,
  ],
  [
    "automaticWatchlist",
    "Automatic watchlist",
    "Surface new candidates in command views",
    CandlestickChart,
  ],
  [
    "automaticAlerts",
    "Automatic alerts",
    "Create deduplicated scanner alerts",
    BellRing,
  ],
  [
    "automaticRiskCalculation",
    "Risk calculation",
    "Use the selected account and risk profile",
    ShieldCheck,
  ],
  [
    "automaticOrderPreparation",
    "Order preparation",
    "Prepare an execution plan after all gates pass",
    SlidersHorizontal,
  ],
  [
    "paperTradeExecution",
    "Paper execution",
    "Allow Twelve Data virtual orders",
    CloudCog,
  ],
  [
    "mt5LiveExecution",
    "MT5 live execution",
    "Allow broker routing when server policy also permits it",
    Network,
  ],
  [
    "aiAnalysis",
    "AI explanations",
    "Call specialists only after deterministic detection",
    BrainCircuit,
  ],
  [
    "journalInsights",
    "Journal insights",
    "Use stored outcomes for coaching and comparisons",
    Database,
  ],
  [
    "autoBreakEven",
    "Auto break-even",
    "Move the stop using your saved R trigger",
    LockKeyhole,
  ],
  [
    "autoPartialClose",
    "Auto partial close",
    "Reduce the open Paper position using your saved rule",
    Gauge,
  ],
  [
    "autoStopModification",
    "Auto SL modification",
    "Lock profit using your saved R rule",
    ShieldCheck,
  ],
  [
    "autoTradeClose",
    "Auto trade close",
    "Close at the saved R target or setup invalidation",
    X,
  ],
];

export function PermissionCenter({
  config,
  busy,
  onChange,
  onManagementChange,
}: {
  config: ScannerConfig;
  busy: boolean;
  onChange: (permissions: ScannerPermissions) => void;
  onManagementChange: (management: TradeManagement) => void;
}) {
  const [managementDraft, setManagementDraft] = useState(
    config.tradeManagement,
  );
  useEffect(() => {
    setManagementDraft(config.tradeManagement);
  }, [config.tradeManagement]);
  const managementSummary = (key: keyof ScannerPermissions) => {
    if (key === "autoBreakEven")
      return `Move SL at ${config.tradeManagement.breakEvenTriggerR}R`;
    if (key === "autoPartialClose")
      return `Close ${config.tradeManagement.partialClosePercent}% at ${config.tradeManagement.partialCloseTriggerR}R`;
    if (key === "autoStopModification")
      return `Lock ${config.tradeManagement.stopModificationLockR}R at ${config.tradeManagement.stopModificationTriggerR}R`;
    if (key === "autoTradeClose")
      return `Close at ${config.tradeManagement.tradeCloseTriggerR}R${config.tradeManagement.closeOnSetupInvalidation ? " or invalidation" : ""}`;
    return null;
  };
  const setRule = <K extends keyof TradeManagement>(
    key: K,
    value: TradeManagement[K],
  ) => setManagementDraft((current) => ({ ...current, [key]: value }));
  return (
    <section className="mb-os-panel">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">SERVER-RESPECTED CONTROLS</span>
          <h3>Permission Center</h3>
        </div>
        <span className="mb-badge">USER CONTROL</span>
      </div>
      <div className="mb-permission-grid">
        {permissionRows.map(([key, label, help, Icon]) => {
          const enabled = config.permissions[key];
          const management = managementSummary(key);
          return (
            <div className={enabled ? "is-on" : ""} key={key}>
              <Icon size={17} />
              <span>
                <strong>{label}</strong>
                <small>{help}</small>
                {management && <em>{management}</em>}
              </span>
              <button
                className="mb-switch"
                role="switch"
                aria-checked={enabled}
                disabled={busy}
                onClick={() =>
                  onChange({ ...config.permissions, [key]: !enabled })
                }
              >
                <span />
              </button>
            </div>
          );
        })}
      </div>
      <details className="mb-management-rules" open>
        <summary>
          <SlidersHorizontal size={16} /> Trade management rules{" "}
          <span>Editable · server enforced</span>
        </summary>
        <div className="mb-management-rule-grid">
          <label>
            <span>Break-even trigger</span>
            <input
              type="number"
              min="0.25"
              max="5"
              step="0.25"
              value={managementDraft.breakEvenTriggerR}
              onChange={(event) =>
                setRule("breakEvenTriggerR", Number(event.target.value))
              }
            />
            <small>Move the stop when this R is reached.</small>
          </label>
          <label>
            <span>Break-even offset</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={managementDraft.breakEvenOffsetR}
              onChange={(event) =>
                setRule("breakEvenOffsetR", Number(event.target.value))
              }
            />
            <small>0R means exact entry price.</small>
          </label>
          <label>
            <span>Partial-close trigger</span>
            <input
              type="number"
              min="0.25"
              max="5"
              step="0.25"
              value={managementDraft.partialCloseTriggerR}
              onChange={(event) =>
                setRule("partialCloseTriggerR", Number(event.target.value))
              }
            />
            <small>Profit level for the first reduction.</small>
          </label>
          <label>
            <span>Partial-close amount</span>
            <input
              type="number"
              min="5"
              max="90"
              step="5"
              value={managementDraft.partialClosePercent}
              onChange={(event) =>
                setRule("partialClosePercent", Number(event.target.value))
              }
            />
            <small>Percentage of the open size to close.</small>
          </label>
          <label>
            <span>SL modification trigger</span>
            <input
              type="number"
              min="0.5"
              max="10"
              step="0.25"
              value={managementDraft.stopModificationTriggerR}
              onChange={(event) =>
                setRule("stopModificationTriggerR", Number(event.target.value))
              }
            />
            <small>When the profit-lock rule becomes eligible.</small>
          </label>
          <label>
            <span>Profit locked by SL</span>
            <input
              type="number"
              min="0"
              max="5"
              step="0.25"
              value={managementDraft.stopModificationLockR}
              onChange={(event) =>
                setRule("stopModificationLockR", Number(event.target.value))
              }
            />
            <small>New stop measured from entry in R.</small>
          </label>
          <label>
            <span>Automatic close trigger</span>
            <input
              type="number"
              min="1"
              max="10"
              step="0.25"
              value={managementDraft.tradeCloseTriggerR}
              onChange={(event) =>
                setRule("tradeCloseTriggerR", Number(event.target.value))
              }
            />
            <small>Close the remaining position at this R.</small>
          </label>
          <label className="mb-management-check">
            <input
              type="checkbox"
              checked={managementDraft.closeOnSetupInvalidation}
              onChange={(event) =>
                setRule("closeOnSetupInvalidation", event.target.checked)
              }
            />
            <span>Close if the saved setup becomes invalidated or expires</span>
          </label>
        </div>
        <button
          className="mb-primary mb-save-management"
          disabled={busy}
          onClick={() => onManagementChange(managementDraft)}
        >
          Save management rules
        </button>
      </details>
      <p className="mb-hub-note">
        <AlertTriangle size={14} /> Emergency Stop and server-side live-trading
        policy always override these permissions.
      </p>
    </section>
  );
}

export function SystemActivityTimeline({
  snapshot,
}: {
  snapshot: ScannerSnapshot;
}) {
  const items = (snapshot.activity ?? []).slice(0, 12).map((event) => {
    const candidate = snapshot.candidates.find(
      (item) => item.id === event.candidate_id,
    );
    return {
      id: event.id,
      at: event.created_at,
      source: event.source === "EXECUTION" ? "Execution AI" : "Setup AI",
      text:
        event.reason ||
        `${candidate?.symbol ?? "Market"} · ${candidate?.payload.strategyName ?? titleState(event.kind)}`,
      tone: event.kind,
    };
  });
  return (
    <section className="mb-os-panel">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">AUDITABLE ACTIVITY</span>
          <h3>System timeline</h3>
        </div>
      </div>
      <div className="mb-os-timeline">
        {items.map((item) => (
          <div key={item.id}>
            <time>{localTime(item.at)}</time>
            <i />
            <span>
              <strong>{item.source}</strong>
              {item.text}
            </span>
            <em>{titleState(item.tone)}</em>
          </div>
        ))}
        {!items.length && (
          <div className="mb-os-empty">
            <History size={20} />
            <p>No scanner activity has been stored yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function JournalLearningPanel({
  snapshot,
}: {
  snapshot: ScannerSnapshot;
}) {
  const journal = snapshot.journal;
  const resolved = journal ? journal.wins + journal.losses : 0;
  const winRate =
    resolved && journal ? Math.round((journal.wins / resolved) * 100) : null;
  const best = [...(journal?.bySetup ?? [])].sort((a, b) => b.pnl - a.pnl)[0];
  const worst = [...(journal?.bySetup ?? [])].sort((a, b) => a.pnl - b.pnl)[0];
  return (
    <section className="mb-os-panel">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">JOURNAL + LEARNING</span>
          <h3>Evidence, not silent rule changes</h3>
        </div>
      </div>
      <div className="mb-learning-grid">
        <span>
          <small>Total trades</small>
          <strong>{journal?.trades ?? 0}</strong>
        </span>
        <span>
          <small>Win rate</small>
          <strong>{winRate == null ? "—" : `${winRate}%`}</strong>
        </span>
        <span>
          <small>Known P/L</small>
          <strong>{journal?.knownPnl ?? 0}</strong>
        </span>
        <span>
          <small>Best setup</small>
          <strong>{best?.key ?? "—"}</strong>
        </span>
        <span>
          <small>Needs review</small>
          <strong>{worst?.key ?? "—"}</strong>
        </span>
      </div>
      <p>
        {journal?.caution ??
          "Select a risk account to connect journal statistics."}
      </p>
    </section>
  );
}

export function MarketSessionTimeline({
  snapshot,
}: {
  snapshot: ScannerSnapshot;
}) {
  const hour = new Date().getUTCHours();
  const sessions = [
    ["Asia", hour >= 0 && hour < 8],
    ["London", hour >= 7 && hour < 16],
    ["London / NY", hour >= 12 && hour < 16],
    ["New York", hour >= 12 && hour < 21],
  ] as const;
  return (
    <section className="mb-os-panel">
      <div className="mb-section-heading">
        <div>
          <span className="mb-eyebrow">UTC MARKET CLOCK</span>
          <h3>Session intelligence</h3>
        </div>
        <span className="mb-badge">
          {new Date().toLocaleTimeString("en-GB", {
            timeZone: "Europe/Vienna",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          VIENNA
        </span>
      </div>
      <div className="mb-session-line">
        {sessions.map(([name, active]) => {
          const count = snapshot.candidates.filter((item) =>
            item.payload.session
              .toLowerCase()
              .includes(name.split(" ")[0].toLowerCase()),
          ).length;
          return (
            <div className={active ? "is-active" : ""} key={name}>
              <i />
              <strong>{name}</strong>
              <small>
                {active ? "OPEN" : "CLOSED"} · {count} setups
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
