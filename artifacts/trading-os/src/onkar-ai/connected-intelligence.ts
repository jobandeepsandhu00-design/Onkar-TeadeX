import type { ScannerSnapshot } from "@workspace/api-zod";
import type { AgentId, AgentRuntimeSnapshot } from "./agent-data";
import { connectedSetups, scannerIsLive } from "./connected-setups";
import type { InsightPreview, SetupPreview } from "./demo-data";
import { setupCoverage } from "../market-brain/setup-coverage";
import { latestApprovedVersions } from "../market-brain/strategy-versions";

export type ConnectedAgentActivity = {
  id: string;
  agent: string;
  activity: string;
  time: string;
};

function newestCandidate(snapshot: ScannerSnapshot) {
  return [...snapshot.candidates].sort(
    (a, b) =>
      Date.parse(b.updated_at ?? b.payload.analyzedAt) -
      Date.parse(a.updated_at ?? a.payload.analyzedAt),
  )[0];
}

function runtime(
  agentId: AgentId,
  state: AgentRuntimeSnapshot["state"],
  statusLabel: string,
  currentTask: string,
  primaryMetric?: string,
  secondaryMetric?: string,
): AgentRuntimeSnapshot {
  return {
    agentId,
    state,
    statusLabel,
    currentTask,
    primaryMetric,
    secondaryMetric,
    lastUpdate: new Date().toISOString(),
  };
}

export function connectedAgentRuntime(
  snapshot: ScannerSnapshot | null,
): Partial<Record<AgentId, AgentRuntimeSnapshot>> {
  if (!snapshot) return {};
  const candidate = newestCandidate(snapshot);
  const coverage = setupCoverage(snapshot);
  const approved = latestApprovedVersions(snapshot);
  const activeVersionIds = new Set(
    snapshot.config?.config.autoActivateApprovedSetups
      ? approved.map((version) => version.id)
      : (snapshot.config?.config.strategyVersionIds ?? []),
  );
  const activeCoverage = coverage.filter((result) =>
    activeVersionIds.has(result.versionId),
  );
  const evaluatedSetups = new Set(
    activeCoverage.map((result) => result.versionId),
  );
  const evaluatedMarkets = new Set(
    activeCoverage.map((result) => result.symbol),
  );
  const approvedSetups = activeVersionIds.size;
  const workflow = candidate?.payload.globalWorkflow;
  const fresh = scannerIsLive(snapshot);
  const activePaper = snapshot.paperTrades.filter(
    (trade) => trade.status === "OPEN",
  ).length;
  const risk = candidate?.payload.risk ?? candidate?.plan;
  return {
    master: runtime(
      "master",
      fresh ? "monitoring" : "offline",
      fresh ? "Monitoring live scanner" : "Scanner data unavailable",
      candidate
        ? `${candidate.symbol} · ${candidate.payload.strategyName ?? "approved setup"} · ${candidate.state}`
        : "Waiting for a deterministic candidate",
      candidate ? candidate.symbol : "No active candidate",
      `${evaluatedSetups.size}/${approvedSetups} setups checked · ${snapshot.candidates.length} qualified`,
    ),
    trend: runtime(
      "trend",
      workflow ? "scanning" : "idle",
      workflow ? "Multi-timeframe analysis" : "Awaiting structure",
      workflow
        ? `${candidate.symbol} 4H ${workflow.fourHour.bias} · 1H ${workflow.oneHour.alignment.replaceAll("_", " ")}`
        : "Waiting for 4H and 1H evidence",
      workflow?.fourHour.bias ?? "Awaiting data",
      workflow ? `1H ${workflow.oneHour.alignment.replaceAll("_", " ")}` : "—",
    ),
    zone: runtime(
      "zone",
      workflow ? "scanning" : "idle",
      workflow ? "Mapping verified zones" : "Awaiting structure",
      workflow
        ? `${candidate.symbol} · ${workflow.priceLocation.replaceAll("_", " ")}`
        : "Waiting for a valid 1H setup zone",
      workflow?.oneHour.setupZone
        ? `${workflow.oneHour.setupZone.low}–${workflow.oneHour.setupZone.high}`
        : "No valid zone",
      workflow?.priceLocation.replaceAll("_", " ") ?? "—",
    ),
    setup: runtime(
      "setup",
      candidate ? "scanning" : "idle",
      evaluatedSetups.size
        ? "All approved setups evaluated"
        : "Monitoring approved setups",
      `${evaluatedSetups.size}/${approvedSetups} setup versions checked across ${evaluatedMarkets.size} market${evaluatedMarkets.size === 1 ? "" : "s"}`,
      candidate ? `${candidate.score}/100 top confluence` : "No qualifying match",
      `${snapshot.candidates.length} qualified candidate${snapshot.candidates.length === 1 ? "" : "s"}`,
    ),
    risk: runtime(
      "risk",
      risk?.allowed ? "success" : candidate ? "alert" : "idle",
      risk?.allowed ? "Risk passed" : candidate ? "Risk blocked" : "Awaiting plan",
      risk
        ? risk.warnings[0] ?? `${risk.riskPercent}% risk approved`
        : "Waiting for entry, stop and account sizing",
      risk?.positionSize ? `${risk.positionSize} size` : "No position size",
      risk ? `${risk.rr.toFixed(2)}R` : "—",
    ),
    news: runtime(
      "news",
      candidate?.payload.news.status === "blocked" ? "alert" : "monitoring",
      candidate ? `News ${candidate.payload.news.status}` : "Monitoring",
      candidate
        ? `${candidate.symbol} clearance · ${candidate.payload.news.status}`
        : (snapshot.connection.economicCalendar ?? "unavailable").replaceAll("_", " "),
      candidate?.payload.news.status ?? "Awaiting candidate",
      candidate?.payload.news.checkedAt
        ? new Date(candidate.payload.news.checkedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
    ),
    backtest: runtime(
      "backtest",
      "idle",
      "Ready on request",
      "No continuous AI or market-data calls",
      "On demand",
      "No background cost",
    ),
    journal: runtime(
      "journal",
      snapshot.journal ? "monitoring" : "idle",
      snapshot.journal ? "Journal connected" : "Select an account",
      snapshot.journal
        ? `${snapshot.journal.trades} account trades · ${snapshot.journal.knownPnl} resolved P/L`
        : "No selected-account journal context",
      `${snapshot.journal?.wins ?? 0} wins`,
      `${snapshot.journal?.losses ?? 0} losses`,
    ),
    insight: runtime(
      "insight",
      snapshot.runs.length ? "active" : "idle",
      snapshot.runs.length ? "Explaining evidence" : "Ready on threshold",
      snapshot.runs.length
        ? `${snapshot.runs.length} verified explanations today`
        : "Deterministic analysis continues without an LLM call",
      `${snapshot.runs.length} calls today`,
      "Cached evidence",
    ),
    execution: runtime(
      "execution",
      snapshot.runtime.emergencyStop
        ? "alert"
        : snapshot.runtime.autoExecutionEnabled
          ? "monitoring"
          : "idle",
      snapshot.runtime.emergencyStop
        ? "Execution locked"
        : snapshot.runtime.autoExecutionEnabled
          ? "AUTO monitoring"
          : "Execution disabled",
      snapshot.connection.executionReason ??
        `${snapshot.runtime.tradingSource} · ${snapshot.connection.execution}`,
      snapshot.runtime.tradingSource,
      snapshot.connection.executionWorker === "ready" ? "Worker ready" : "Worker unavailable",
    ),
  };
}

function insightKind(setup: SetupPreview): InsightPreview["kind"] {
  if (setup.status === "Invalidated" || setup.status === "Awaiting data")
    return "invalidated";
  if (setup.status === "Confirmed" || setup.status === "High quality")
    return "setup";
  if (setup.status === "Watching") return "entry";
  return "developing";
}

export function connectedInsights(
  snapshot: ScannerSnapshot | null,
): InsightPreview[] {
  return connectedSetups(snapshot)
    .slice(0, 8)
    .map((setup, index) => ({
      id: setup.id,
      kind: insightKind(setup),
      setup,
      priority: index + 1,
    }));
}

export function connectedAgentActivity(
  snapshot: ScannerSnapshot | null,
): ConnectedAgentActivity[] {
  if (!snapshot) return [];
  return (snapshot.activity ?? []).slice(0, 6).map((event) => ({
    id: event.id,
    agent: event.source === "EXECUTION" ? "Execution AI" : "Setup AI",
    activity: event.reason || event.kind.replaceAll("_", " "),
    time: new Date(event.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
}
