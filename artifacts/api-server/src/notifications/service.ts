import type { CandidateRow } from "../market-brain/store";
import { ScannerStore } from "../market-brain/store";

type Priority = "INFO" | "IMPORTANT" | "HIGH" | "CRITICAL";
type Category = "TRADING" | "SETUPS" | "AI" | "RISK" | "NEWS" | "SYSTEM";
type ThreadInput = {
  userId: string;
  eventKey: string;
  eventVersion: string;
  category: Category;
  priority: Priority;
  title: string;
  message: string;
  agentSource: string;
  lifecycleState?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  setupId?: string | null;
  tradeId?: string | null;
  recommendedAction?: string | null;
  evidence?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  status?: "ACTIVE" | "RESOLVED" | "INVALIDATED" | "EXPIRED";
  expiresAt?: string | null;
};

export class NotificationService {
  constructor(private store = ScannerStore.service()) {}

  async upsert(input: ThreadInput) {
    const now = new Date().toISOString();
    const [existing] = await this.store.request<Array<{ id: string; lifecycle_state: string | null; priority: Priority }>>(
      "notifications",
      { user_id: `eq.${input.userId}`, event_key: `eq.${input.eventKey}`, select: "id,lifecycle_state,priority", limit: "1" },
    );
    const changed = existing?.lifecycle_state !== (input.lifecycleState ?? null) || existing?.priority !== input.priority;
    const [thread] = await this.store.request<Array<{ id: string }>>(
      "notifications",
      { on_conflict: "user_id,event_key" },
      "POST",
      {
        user_id: input.userId,
        event_key: input.eventKey,
        category: input.category,
        priority: input.priority,
        symbol: input.symbol ?? null,
        timeframe: input.timeframe ?? null,
        setup_id: input.setupId ?? null,
        trade_id: input.tradeId ?? null,
        agent_source: input.agentSource,
        title: input.title,
        message: input.message,
        evidence: input.evidence ?? [],
        lifecycle_state: input.lifecycleState ?? null,
        recommended_action: input.recommendedAction ?? null,
        actions: input.actions ?? [],
        metadata: input.metadata ?? {},
        status: input.status ?? "ACTIVE",
        expires_at: input.expiresAt ?? null,
        updated_at: now,
        ...(changed ? { read_at: null } : {}),
      },
      "resolution=merge-duplicates,return=representation",
    );
    if (!thread) return null;
    await this.store.request(
      "notification_events",
      { on_conflict: "notification_id,event_key" },
      "POST",
      {
        notification_id: thread.id,
        user_id: input.userId,
        event_key: input.eventVersion,
        lifecycle_state: input.lifecycleState ?? null,
        agent_source: input.agentSource,
        title: input.title,
        message: input.message,
        evidence: input.evidence ?? [],
        metadata: input.metadata ?? {},
      },
      "resolution=ignore-duplicates,return=minimal",
    );
    return thread.id;
  }

  async candidate(candidate: CandidateRow, event: string) {
    const risk = candidate.payload.risk;
    const news = candidate.payload.news;
    const terminal = candidate.state === "INVALIDATED" || candidate.state === "EXPIRED";
    const riskBlocked = risk.allowed === false;
    const actionableRisk = riskBlocked && candidate.state === "WATCH" && candidate.score > 0;
    const newsBlocked = news.status === "blocked";
    const lifecycle = candidate.state === "DEVELOPING" &&
        candidate.payload.globalWorkflow?.masterStatus === "APPROACHING_ZONE" ? "APPROACHING"
      : candidate.state === "WATCH" ? "WAITING_CLOSE"
        : candidate.state === "TRIGGERED" ? "ACTIVE"
          : candidate.state === "COMPLETED" ? "CLOSED"
            : candidate.state;
    const priority: Priority = terminal || candidate.state === "READY" || candidate.state === "TRIGGERED"
      ? "HIGH"
      : lifecycle === "WAITING_CLOSE" ||
          (lifecycle === "APPROACHING" && candidate.score > 0)
        ? "IMPORTANT"
        : "INFO";
    const direction = candidate.payload.direction === "short" ? "SELL" : "BUY";
    const setup = candidate.payload.strategyName || "Approved setup";
    const missing = candidate.payload.rules.filter((rule) => rule.required && !rule.passed).map((rule) => rule.id);
    const blocker = newsBlocked
      ? "High-impact news restriction is active."
      : actionableRisk
        ? risk.warnings[0] || "Risk approval is blocked."
        : missing.length
          ? `Still required: ${missing.slice(0, 3).join(", ")}.`
          : candidate.state === "READY"
            ? "All deterministic requirements and the required candle close passed."
            : "Master AI is monitoring the next deterministic lifecycle step.";
    return this.upsert({
      userId: candidate.user_id,
      eventKey: `setup:${candidate.id}`,
      eventVersion: `${candidate.last_candle_at}:${event}:${candidate.state}:${candidate.score}`,
      category: newsBlocked ? "NEWS" : actionableRisk ? "RISK" : "SETUPS",
      priority,
      symbol: candidate.symbol,
      timeframe: candidate.timeframe,
      setupId: candidate.id,
      agentSource: "MASTER_AI",
      lifecycleState: lifecycle,
      title: `${candidate.symbol} · ${setup} · ${lifecycle.replaceAll("_", " ")}`,
      message: `${direction} ${candidate.timeframe} · ${candidate.score}/100 confluence. ${blocker}`,
      recommendedAction: terminal ? "Review why the setup failed." : candidate.state === "READY" ? "Review evidence and execution readiness." : "Continue monitoring; do not enter early.",
      evidence: [
        { agent: "TREND_AI", result: candidate.payload.marketBias },
        { agent: "SETUP_AI", score: candidate.score, passed: candidate.payload.passed, total: candidate.payload.total, missing },
        { agent: "RISK_AI", allowed: risk.allowed, warnings: risk.warnings, riskPercent: risk.riskPercent },
        { agent: "NEWS_AI", status: news.status, events: news.events },
      ],
      actions: [
        { id: "chart", label: "View chart", href: `/onkar-ai/setup/${candidate.id}`, intent: "NAVIGATE", confirm: false },
        { id: "evidence", label: "View evidence", href: `/onkar-ai/setup/${candidate.id}`, intent: "NAVIGATE", confirm: false },
        { id: "ask", label: "Ask Onkar AI", href: `/onkar-ai/assistant?candidate=${candidate.id}`, intent: "NAVIGATE", confirm: false },
      ],
      metadata: { candidateId: candidate.id, versionId: candidate.version_id, lastCandleAt: candidate.last_candle_at, confluenceScore: candidate.score, voiceEligible: priority === "HIGH" },
      status: candidate.state === "INVALIDATED" ? "INVALIDATED" : candidate.state === "EXPIRED" ? "EXPIRED" : candidate.state === "COMPLETED" ? "RESOLVED" : "ACTIVE",
      expiresAt: candidate.expires_at,
    });
  }

  async execution(args: {
    userId: string; candidate: CandidateRow; state: string; reason: string;
    provider: "MT5" | "PAPER"; tradeId?: string | null; eventKey: string;
    detail?: Record<string, unknown>;
  }) {
    const failed = args.state === "ERROR" || args.state === "BLOCKED";
    const executed = args.state === "EXECUTED";
    return this.upsert({
      userId: args.userId,
      eventKey: args.tradeId ? `trade:${args.tradeId}` : `execution:${args.eventKey}`,
      eventVersion: `${args.eventKey}:${args.state}`,
      category: failed ? "RISK" : "TRADING",
      priority: failed ? (args.state === "ERROR" ? "CRITICAL" : "HIGH") : executed ? "HIGH" : "IMPORTANT",
      symbol: args.candidate.symbol,
      timeframe: args.candidate.timeframe,
      setupId: args.candidate.id,
      tradeId: args.tradeId ?? null,
      agentSource: failed ? "RISK_AI" : "EXECUTION_AI",
      lifecycleState: executed ? "ACTIVE" : args.state,
      title: `${args.candidate.symbol} · ${args.provider} ${args.state.replaceAll("_", " ")}`,
      message: args.reason,
      recommendedAction: failed ? "Review the execution or risk blocker before retrying." : "Open the trade management view.",
      evidence: [{ agent: "EXECUTION_AI", provider: args.provider, state: args.state, ...args.detail }],
      actions: [{ id: "trade", label: "Open trade", href: "/onkar-ai/scanner", intent: "NAVIGATE", confirm: false }],
      metadata: { provider: args.provider, voiceEligible: failed || executed },
      status: failed ? "ACTIVE" : "ACTIVE",
    });
  }

  async systemHealth(args: {
    userId: string;
    component: string;
    healthy: boolean;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.upsert({
      userId: args.userId,
      eventKey: `system:${args.component.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      eventVersion: `${args.healthy ? "recovered" : "failure"}:${new Date().toISOString().slice(0, 16)}`,
      category: "SYSTEM",
      priority: args.healthy ? "INFO" : "CRITICAL",
      agentSource: "MASTER_AI",
      lifecycleState: args.healthy ? "ONLINE" : "ERROR",
      title: `${args.component} · ${args.healthy ? "healthy" : "automation paused"}`,
      message: args.message,
      recommendedAction: args.healthy ? "No action required." : "Open system status, restore fresh data, then explicitly resume automation.",
      evidence: [{ agent: "MASTER_AI", component: args.component, healthy: args.healthy, ...args.metadata }],
      actions: [{ id: "status", label: "View system status", href: "/onkar-ai/integrations", intent: "NAVIGATE", confirm: false }],
      metadata: { ...args.metadata, voiceEligible: !args.healthy },
      status: args.healthy ? "RESOLVED" : "ACTIVE",
    });
  }

  async tradeManagement(args: {
    userId: string; tradeId: string; candidateId: string; symbol: string;
    state: string; message: string; detail?: Record<string, unknown>; closed?: boolean;
  }) {
    const criticalClose = ["STOP_LOSS", "TAKE_PROFIT"].includes(args.state);
    return this.upsert({
      userId: args.userId,
      eventKey: `trade:${args.tradeId}`,
      eventVersion: `${args.state}:${String(args.detail?.at || new Date().toISOString())}`,
      category: "TRADING",
      priority: "HIGH",
      symbol: args.symbol,
      setupId: args.candidateId,
      tradeId: args.tradeId,
      agentSource: "EXECUTION_AI",
      lifecycleState: args.closed ? "CLOSED" : args.state,
      title: `${args.symbol} · ${args.state.replaceAll("_", " ")}`,
      message: args.message,
      recommendedAction: args.closed ? "Open the journal review and inspect the complete audit trail." : "Open trade management to review the current protective rules.",
      evidence: [{ agent: "EXECUTION_AI", ...args.detail }],
      actions: [
        { id: "management", label: args.closed ? "Journal review" : "View management", href: "/onkar-ai/scanner", intent: "NAVIGATE", confirm: false },
      ],
      metadata: { ...args.detail, voiceEligible: criticalClose },
      status: args.closed ? "RESOLVED" : "ACTIVE",
    });
  }
}
