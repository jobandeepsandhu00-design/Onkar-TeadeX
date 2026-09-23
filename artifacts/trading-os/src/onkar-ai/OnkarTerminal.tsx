import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type {
  MT5Position,
  ScannerCandidate,
  ScannerSnapshot,
  SharedChartSymbol,
  SharedChartTimeframe,
  SharedMarketSnapshot,
} from "@workspace/api-zod";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  FileClock,
  GitBranch,
  History,
  Lightbulb,
  ListChecks,
  Newspaper,
  PanelRightOpen,
  Radar,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Target,
  TerminalSquare,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { brainRequest } from "../market-brain/api";
import { mt5Request } from "../market-brain/MT5StatusPanel";
import { requestLiveRefresh } from "../live-refresh";
import { SharedMarketChart } from "./SharedMarketChart";
import "./onkar-terminal.css";

type Props = {
  scannerSnapshot: ScannerSnapshot | null;
  scannerLoading?: boolean;
  scannerError?: string;
  journalTrades?: Array<{ id: string; symbol?: string; date?: string }>;
  onNavigate: (path: string) => void;
  onOpenJournal?: () => void;
};

type TerminalTab =
  | "trade"
  | "positions"
  | "orders"
  | "history"
  | "journal"
  | "timeline"
  | "logs";

type CandidateDetail = {
  events: Array<{
    id: string;
    kind: string;
    detail?: Record<string, unknown>;
    created_at: string;
  }>;
};

type PendingOrder = {
  ticket: number;
  symbol: string;
  type: number;
  volume_current: number;
  price_open: number;
  sl?: number;
  tp?: number;
  time_setup?: number;
};

type AgentCard = {
  id: string;
  name: string;
  icon: ComponentType<{ size?: number }>;
  state: "online" | "waiting" | "approved" | "blocked" | "scanning";
  headline: string;
  detail: string;
};

const tabs: Array<{
  id: TerminalTab;
  label: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { id: "trade", label: "Trade", icon: WalletCards },
  { id: "positions", label: "Positions", icon: Activity },
  { id: "orders", label: "Orders", icon: ListChecks },
  { id: "history", label: "History", icon: History },
  { id: "journal", label: "Journal", icon: BookOpen },
  { id: "timeline", label: "AI Timeline", icon: FileClock },
  { id: "logs", label: "Logs", icon: TerminalSquare },
];

const normalizedSymbol = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const eventTime = (value?: string | number | null) => {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const number = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

const human = (value: string | null | undefined) =>
  value ? value.replaceAll("_", " ") : "Unavailable";

const candidateTime = (candidate: ScannerCandidate) =>
  Date.parse(candidate.updated_at ?? candidate.payload.analyzedAt);

function newestCandidate(
  snapshot: ScannerSnapshot | null,
  symbol: SharedChartSymbol,
  timeframe: SharedChartTimeframe,
) {
  if (!snapshot) return null;
  const statePriority: Record<string, number> = {
    READY: 0,
    WATCH: 1,
    DEVELOPING: 2,
    SCANNING: 3,
  };
  return (
    snapshot.candidates
      .filter(
        (item) =>
          normalizedSymbol(item.symbol) === symbol &&
          !["TRIGGERED", "INVALIDATED", "EXPIRED", "COMPLETED"].includes(
            item.state,
          ),
      )
      .sort(
        (left, right) =>
          (statePriority[left.state] ?? 9) -
            (statePriority[right.state] ?? 9) ||
          right.score - left.score ||
          Number(right.timeframe.toLowerCase() === timeframe) -
            Number(left.timeframe.toLowerCase() === timeframe) ||
          candidateTime(right) - candidateTime(left),
      )[0] ?? null
  );
}

function detailText(detail: Record<string, unknown> | undefined) {
  if (!detail) return "Deterministic scanner event";
  for (const key of ["reason", "message", "waitFor", "status"]) {
    if (typeof detail[key] === "string" && detail[key])
      return String(detail[key]);
  }
  return "Deterministic scanner event";
}

export function OnkarTerminal({
  scannerSnapshot,
  scannerLoading = false,
  scannerError = "",
  journalTrades = [],
  onNavigate,
  onOpenJournal,
}: Props) {
  const [symbol, setSymbol] = useState<SharedChartSymbol>("XAUUSD");
  const [timeframe, setTimeframe] = useState<SharedChartTimeframe>("30m");
  const [market, setMarket] = useState<SharedMarketSnapshot | null>(null);
  const [tab, setTab] = useState<TerminalTab>("trade");
  const [aiOpen, setAiOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [candidateDetail, setCandidateDetail] =
    useState<CandidateDetail | null>(null);
  const [mt5Positions, setMt5Positions] = useState<MT5Position[]>([]);
  const [mt5Orders, setMt5Orders] = useState<PendingOrder[]>([]);
  const [mt5Error, setMt5Error] = useState("");
  const aiToggle = useRef<HTMLButtonElement>(null);
  const mobileAiSheet = useRef<HTMLDivElement>(null);

  const candidate = useMemo(
    () => newestCandidate(scannerSnapshot, symbol, timeframe),
    [scannerSnapshot, symbol, timeframe],
  );
  const workflow =
    market?.workflow ?? candidate?.payload.globalWorkflow ?? null;
  const paperPositions = useMemo(
    () =>
      (scannerSnapshot?.paperTrades ?? []).filter(
        (trade) =>
          trade.status === "OPEN" && normalizedSymbol(trade.symbol) === symbol,
      ),
    [scannerSnapshot, symbol],
  );
  const paperHistory = useMemo(
    () =>
      (scannerSnapshot?.paperTrades ?? []).filter(
        (trade) =>
          trade.status !== "OPEN" && normalizedSymbol(trade.symbol) === symbol,
      ),
    [scannerSnapshot, symbol],
  );
  const tradeOverlays = useMemo(() => {
    if (scannerSnapshot?.runtime.tradingSource === "MT5")
      return mt5Positions
        .filter((position) => normalizedSymbol(position.symbol) === symbol)
        .map((position) => ({
          id: String(position.ticket),
          direction: position.direction,
          entry: position.entryPrice,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          status: "OPEN" as const,
          openedAt: new Date(position.openTime).toISOString(),
          closedAt: null,
          source: "MT5" as const,
        }));
    return (scannerSnapshot?.paperTrades ?? [])
      .filter((trade) => normalizedSymbol(trade.symbol) === symbol)
      .slice(0, 12)
      .map((trade) => ({
        id: trade.id,
        direction: trade.direction,
        entry: trade.entry,
        stopLoss: trade.stop_loss,
        takeProfit: trade.take_profit,
        status: trade.status,
        openedAt: trade.opened_at,
        closedAt: trade.closed_at,
        source: "PAPER" as const,
      }));
  }, [mt5Positions, scannerSnapshot, symbol]);

  useEffect(() => {
    if (!candidate) {
      setCandidateDetail(null);
      return;
    }
    const controller = new AbortController();
    void brainRequest<CandidateDetail>(
      `/candidates/${candidate.id}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setCandidateDetail)
      .catch(() => {
        if (!controller.signal.aborted) setCandidateDetail(null);
      });
    return () => controller.abort();
  }, [candidate?.id, candidate?.updated_at]);

  useEffect(() => {
    if (scannerSnapshot?.runtime.tradingSource !== "MT5") {
      setMt5Positions([]);
      setMt5Orders([]);
      setMt5Error("");
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const [positions, orders] = await Promise.all([
          mt5Request<{ positions: MT5Position[] }>(
            "/positions",
            controller.signal,
          ),
          mt5Request<{ orders: PendingOrder[] }>("/orders", controller.signal),
        ]);
        setMt5Positions(positions.positions);
        setMt5Orders(orders.orders);
        setMt5Error("");
      } catch (error) {
        if (!controller.signal.aborted) {
          setMt5Positions([]);
          setMt5Orders([]);
          setMt5Error(
            error instanceof Error ? error.message : "MT5 unavailable",
          );
        }
      }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [scannerSnapshot?.runtime.tradingSource]);

  useEffect(() => {
    if (!aiOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = mobileAiSheet.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const focusFrame = window.requestAnimationFrame(() =>
      focusable()[0]?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAiOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      (previous ?? aiToggle.current)?.focus();
    };
  }, [aiOpen]);

  const setupBlockingReasons = useMemo(() => {
    const reasons: string[] = [];
    const paperFast = Boolean(
      candidate?.payload.paperFastEntryApplied &&
        scannerSnapshot?.config?.config.paperFastEntry &&
        scannerSnapshot.runtime.tradingSource === "TWELVE_DATA" &&
        market?.provider === "twelvedata",
    );
    if (scannerError) reasons.push(`Scanner unavailable: ${scannerError}`);
    if (!market) reasons.push("Waiting for shared market data");
    else if (market.dataStatus !== "live")
      reasons.push(`Market data is ${market.dataStatus}`);
    if (market?.provider === "mt5" && market.quote?.state !== "CONNECTED")
      reasons.push(`MT5 quote is ${market.quote?.state ?? "unavailable"}`);
    if (!candidate) reasons.push("No valid setup candidate");
    else {
      if (candidate.staleNow || candidate.payload.stale)
        reasons.push("Candidate evidence is stale");
      if (candidate.state !== "READY")
        reasons.push(`Setup state is ${candidate.state}`);
      if (
        candidate.payload.paperFastEntryApplied &&
        !scannerSnapshot?.config?.config.paperFastEntry
      )
        reasons.push("Paper Fast Entry is now off; wait for a new scan");
      if (
        !paperFast &&
        candidate.payload.globalWorkflow?.gate.status !== "UNLOCKED"
      )
        reasons.push("Frozen candidate 4H → 1H → closed 30M gate is locked");
      if (!paperFast && market?.workflow?.gate.status !== "UNLOCKED")
        reasons.push("Current 4H → 1H → closed 30M gate is locked");
      if (paperFast && market?.workflow?.thirtyMinute.candle.closed !== true)
        reasons.push("Current 30M confirmation candle has not closed");
      if (
        candidate.payload.setupWorkflow &&
        (!candidate.payload.setupWorkflow.patternMatched ||
          !candidate.payload.setupWorkflow.entryTrigger)
      )
        reasons.push(candidate.payload.setupWorkflow.waitFor);
      if (!candidate.plan?.allowed)
        reasons.push(candidate.plan?.warnings[0] ?? "Risk AI has not approved");
      if (
        scannerSnapshot?.config?.config.requireNews &&
        candidate.payload.news.status !== "safe"
      )
        reasons.push(`News clearance is ${candidate.payload.news.status}`);
    }
    return [...new Set(reasons.filter(Boolean))];
  }, [candidate, market, scannerError, scannerSnapshot]);

  const paperFastPlan = Boolean(
    candidate?.payload.paperFastEntryApplied &&
      scannerSnapshot?.config?.config.paperFastEntry &&
      scannerSnapshot.runtime.tradingSource === "TWELVE_DATA" &&
      market?.provider === "twelvedata" &&
      market.workflow?.thirtyMinute.candle.closed,
  );
  const plan =
    !scannerError &&
    market?.dataStatus === "live" &&
    (market.workflow?.gate.status === "UNLOCKED" || paperFastPlan) &&
    candidate?.payload.provider === market.provider &&
    candidate?.state === "READY" &&
    !candidate.staleNow &&
    !candidate.payload.stale &&
    (candidate.payload.globalWorkflow?.gate.status === "UNLOCKED" ||
      paperFastPlan) &&
    (!candidate.payload.setupWorkflow ||
      (candidate.payload.setupWorkflow.patternMatched &&
        candidate.payload.setupWorkflow.entryTrigger))
      ? candidate.plan
      : null;
  const setupReady = setupBlockingReasons.length === 0;
  const executionBlockingReasons = useMemo(() => {
    const reasons = [...setupBlockingReasons];
    const config = scannerSnapshot?.config?.config;
    const permissions = config?.permissions;
    const source = scannerSnapshot?.runtime.tradingSource;
    const version = scannerSnapshot?.versions.find(
      (item) => item.id === candidate?.version_id,
    );
    if (!config?.enabled) reasons.push("Scanner is disabled");
    if (scannerSnapshot?.runtime.scannerState !== "RUNNING")
      reasons.push(
        `Scanner is ${scannerSnapshot?.runtime.scannerState ?? "offline"}`,
      );
    if (scannerSnapshot?.runtime.emergencyStop)
      reasons.push("Emergency Stop is active");
    if (scannerSnapshot?.connection.executionWorker !== "ready")
      reasons.push(
        scannerSnapshot?.connection.executionReason ??
          "Execution provider is unavailable",
      );
    if (scannerSnapshot?.runtime.tradingMode !== "AUTO")
      reasons.push(
        `Trading mode is ${scannerSnapshot?.runtime.tradingMode ?? "unavailable"}`,
      );
    if (!scannerSnapshot?.runtime.autoExecutionEnabled)
      reasons.push("Automatic execution is not armed");
    if (
      !permissions?.automaticScanning ||
      !permissions.automaticSetupDetection ||
      !permissions.automaticCandidateCreation ||
      !permissions.automaticRiskCalculation ||
      !permissions.automaticOrderPreparation
    )
      reasons.push("Required scanner or order-preparation permissions are off");
    if (source === "TWELVE_DATA" && !permissions?.paperTradeExecution)
      reasons.push("Paper-trade execution permission is off");
    if (source === "MT5" && !permissions?.mt5LiveExecution)
      reasons.push("MT5 live execution permission is off");
    const expectedProvider = source === "MT5" ? "mt5" : "twelvedata";
    if (candidate?.payload.provider !== expectedProvider)
      reasons.push(
        "Candidate provider does not match the active execution source",
      );
    if (market?.provider !== expectedProvider)
      reasons.push("Chart market source does not match the execution source");
    if (!config?.accountId || plan?.accountId !== config.accountId)
      reasons.push("Frozen risk plan does not match the selected risk account");
    if (
      !version ||
      version.definition.approval !== "approved" ||
      !version.definition.autoExecutionAllowed
    )
      reasons.push("Strategy version is not approved for AUTO execution");
    const sourceActivatedAt = Date.parse(
      scannerSnapshot?.runtime.sourceActivatedAt ?? "",
    );
    const candidateCandleAt = Date.parse(candidate?.last_candle_at ?? "");
    if (
      !Number.isFinite(sourceActivatedAt) ||
      !Number.isFinite(candidateCandleAt) ||
      candidateCandleAt < sourceActivatedAt
    )
      reasons.push("Candidate predates the active execution source");
    if (!plan?.executionEnabled)
      reasons.push("The frozen risk plan does not permit execution");
    return [...new Set(reasons.filter(Boolean))];
  }, [
    candidate,
    plan?.executionEnabled,
    scannerSnapshot,
    setupBlockingReasons,
  ]);
  const executionReady = executionBlockingReasons.length === 0;
  const currentPrice = market?.quote?.last ?? market?.candles.at(-1)?.c ?? null;
  const executionMode = scannerSnapshot
    ? `${scannerSnapshot.runtime.tradingSource.replaceAll("_", " ")} · ${scannerSnapshot.runtime.tradingMode}`
    : "Checking execution";

  const agents = useMemo<AgentCard[]>(() => {
    const setupName =
      candidate?.payload.strategyName ?? market?.detections[0]?.setup;
    const setupRules = candidate
      ? `${candidate.payload.passed}/${candidate.payload.total} rules · ${candidate.score}/100 confluence`
      : market?.detections[0]
        ? `${market.detections[0].status} · ${market.detections[0].reason}`
        : "No qualifying setup from the current approved set";
    const zone = workflow?.oneHour.setupZone;
    const risk = plan ?? candidate?.payload.risk;
    const news = candidate?.payload.news;
    return [
      {
        id: "master",
        name: "Master AI",
        icon: BrainCircuit,
        state: !market ? "waiting" : setupReady ? "approved" : "scanning",
        headline: setupReady
          ? "Setup evidence is aligned"
          : human(workflow?.masterStatus ?? "SCANNING"),
        detail: setupReady
          ? `${candidate?.symbol} ${setupName} passed its deterministic setup review; execution permissions remain separate.`
          : (setupBlockingReasons[0] ??
            "Coordinating chart, setup and safety evidence."),
      },
      {
        id: "trend",
        name: "Trend AI",
        icon: GitBranch,
        state: workflow ? "online" : "waiting",
        headline: workflow
          ? `4H ${workflow.fourHour.bias} · 1H ${human(workflow.oneHour.alignment)}`
          : "Waiting for 4H and 1H context",
        detail: workflow?.fourHour.structure.length
          ? `Structure: ${workflow.fourHour.structure.join(" · ")}`
          : "No verified structure labels available.",
      },
      {
        id: "zone",
        name: "Zone AI",
        icon: ScanLine,
        state: workflow ? "online" : "waiting",
        headline: workflow ? human(workflow.priceLocation) : "Mapping levels",
        detail: zone
          ? `1H ${human(zone.type)} ${number(zone.low)}–${number(zone.high)} · ${Math.round(zone.freshness)}% fresh · ${zone.touches} touches`
          : "No active 1H setup zone is currently verified.",
      },
      {
        id: "setup",
        name: "Setup AI",
        icon: Target,
        state: !candidate
          ? "scanning"
          : ["READY", "TRIGGERED"].includes(candidate.state)
            ? "approved"
            : "waiting",
        headline: setupName
          ? `${setupName} · ${candidate?.timeframe?.toUpperCase() ?? timeframe.toUpperCase()} · ${candidate?.state ?? "WATCH"}`
          : "Scanning approved setups",
        detail: setupRules,
      },
      {
        id: "risk",
        name: "Risk AI",
        icon: ShieldCheck,
        state: !plan
          ? risk
            ? "waiting"
            : "waiting"
          : plan.allowed
            ? "approved"
            : "blocked",
        headline: !risk
          ? "Waiting for a complete plan"
          : !plan
            ? `${risk.riskPercent}% provisional risk calculation`
            : plan.allowed
              ? `${plan.riskPercent}% frozen plan approved`
              : "Trade risk blocked",
        detail: plan
          ? `${number(plan.positionSize, 3)} configured volume · ${number(plan.rr)}R · ${plan.warnings[0] ?? "Sizing validated"}`
          : risk
            ? `${number(risk.positionSize, 3)} provisional volume · ${number(risk.rr)}R · approval waits for a frozen candidate plan`
            : "Position size is calculated only from account and instrument data.",
      },
      {
        id: "news",
        name: "News AI",
        icon: Newspaper,
        state: !news
          ? "waiting"
          : news.status === "safe"
            ? "online"
            : "blocked",
        headline: news
          ? `News clearance ${news.status}`
          : human(scannerSnapshot?.connection.economicCalendar),
        detail: news?.events.length
          ? `${news.events.length} relevant event${news.events.length === 1 ? "" : "s"} in the checked window.`
          : news?.status === "safe"
            ? "No relevant events were returned in the checked restriction window."
            : "Unavailable news is never treated as safe.",
      },
      {
        id: "execution",
        name: "Execution AI",
        icon: Zap,
        state: scannerSnapshot?.runtime.emergencyStop
          ? "blocked"
          : scannerSnapshot?.connection.executionWorker === "ready"
            ? "online"
            : "waiting",
        headline: human(scannerSnapshot?.connection.execution),
        detail:
          scannerSnapshot?.connection.executionReason ??
          `Account/system scope · ${executionMode} · ${human(scannerSnapshot?.connection.executionWorker)}`,
      },
      {
        id: "backtest",
        name: "Backtest AI",
        icon: History,
        state: "waiting",
        headline: "Available on demand",
        detail:
          "Account/system scope · chart refresh does not start a backtest. Existing strategy tests remain isolated from execution.",
      },
      {
        id: "journal",
        name: "Journal AI",
        icon: BookOpen,
        state: scannerSnapshot?.journal ? "online" : "waiting",
        headline: scannerSnapshot?.journal
          ? `${scannerSnapshot.journal.trades} account trades connected`
          : "Waiting for account journal context",
        detail: scannerSnapshot?.journal
          ? `Account scope · ${scannerSnapshot.journal.wins} wins · ${scannerSnapshot.journal.losses} losses · ${number(scannerSnapshot.journal.knownPnl)} known P/L`
          : "No journal result is being invented.",
      },
      {
        id: "insight",
        name: "Insight AI",
        icon: Lightbulb,
        state: scannerSnapshot?.runs.length ? "online" : "waiting",
        headline: scannerSnapshot?.runs.length
          ? `${scannerSnapshot.runs.length} recorded AI run${scannerSnapshot.runs.length === 1 ? "" : "s"} today`
          : "Ready when evidence needs explanation",
        detail:
          "Account/system scope · deterministic scanning continues without spending an AI call on every chart refresh.",
      },
    ];
  }, [
    candidate,
    executionMode,
    market,
    plan,
    scannerSnapshot,
    setupBlockingReasons,
    setupReady,
    workflow,
  ]);

  const refresh = () => {
    setRefreshing(true);
    requestLiveRefresh();
    window.setTimeout(() => setRefreshing(false), 700);
  };

  const activity = (scannerSnapshot?.activity ?? []).filter(
    (item) =>
      !candidate ||
      item.candidate_id === candidate.id ||
      normalizedSymbol(String(item.detail?.symbol ?? "")) === symbol,
  );

  const aiPanel = (
    <>
      <header className="oxt-rail-head">
        <div>
          <span>ONKAR AI DESK</span>
          <h3>Chart intelligence</h3>
        </div>
        <button
          className="oxt-mobile-close"
          onClick={() => setAiOpen(false)}
          aria-label="Close AI panel"
        >
          <X size={18} />
        </button>
      </header>
      <div className="oxt-agent-list">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <article className={`oxt-agent is-${agent.state}`} key={agent.id}>
              <div className="oxt-agent-icon">
                <Icon size={16} />
              </div>
              <div>
                <div className="oxt-agent-line">
                  <strong>{agent.name}</strong>
                  <span>{agent.state}</span>
                </div>
                <b>{agent.headline}</b>
                <p>{agent.detail}</p>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );

  return (
    <section className="oxt" aria-label="OnkarTradeX professional terminal">
      <header className="oxt-head">
        <div>
          <span className="oxt-kicker">ONKAR AI · PROFESSIONAL TERMINAL</span>
          <h2>Chart, intelligence and execution context</h2>
          <p>
            One shared market snapshot powers the chart, scanner and every AI
            decision shown here.{" "}
            {scannerSnapshot
              ? `${scannerSnapshot.setups.length} Setup Library entries are visible; only approved strategy versions can unlock execution.`
              : "Setup Library state is loading."}
          </p>
        </div>
        <div className="oxt-head-actions">
          <div
            className={`oxt-readiness ${executionReady ? "is-ready" : setupReady ? "is-review" : "is-blocked"}`}
          >
            {executionReady ? (
              <CheckCircle2 size={15} />
            ) : setupReady ? (
              <Clock3 size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
            <span>
              {executionReady
                ? "AUTO EXECUTION READY"
                : setupReady
                  ? "SETUP READY · EXECUTION OFF"
                  : "EXECUTION BLOCKED"}
            </span>
          </div>
          <span className="oxt-mode">{executionMode}</span>
          <button
            ref={aiToggle}
            className="oxt-ai-toggle"
            onClick={() => setAiOpen(true)}
            aria-expanded={aiOpen}
            aria-controls="oxt-mobile-ai-dialog"
          >
            <PanelRightOpen size={16} /> AI
          </button>
          <button
            className="oxt-refresh"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "is-spinning" : ""} size={16} />
            Refresh
          </button>
        </div>
      </header>

      {(scannerError || market?.warnings.length) && (
        <div className="oxt-warning" role="status">
          <AlertTriangle size={15} />
          <span>{scannerError || market?.warnings[0] || "Market warning"}</span>
        </div>
      )}

      <div className="oxt-workspace">
        <div className="oxt-chart-stage">
          <SharedMarketChart
            initialSymbol="XAUUSD"
            initialTimeframe="30m"
            tradeOverlays={tradeOverlays}
            onSnapshot={setMarket}
            onUnavailable={() => setMarket(null)}
            onContextChange={(nextSymbol, nextTimeframe) => {
              setSymbol(nextSymbol);
              setTimeframe(nextTimeframe);
              setMarket((current) =>
                current?.symbol === nextSymbol &&
                current.timeframe === nextTimeframe
                  ? current
                  : null,
              );
            }}
          />
        </div>
        <aside className="oxt-ai-rail">{aiPanel}</aside>
      </div>

      {aiOpen && (
        <>
          <div
            ref={mobileAiSheet}
            id="oxt-mobile-ai-dialog"
            className="oxt-mobile-ai-sheet is-open"
            role="dialog"
            aria-modal="true"
            aria-label="Onkar AI chart intelligence"
          >
            {aiPanel}
          </div>
          <button
            aria-label="Close AI panel"
            className="oxt-sheet-backdrop"
            onClick={() => setAiOpen(false)}
          />
        </>
      )}

      <section className="oxt-bottom" aria-label="Trading terminal panel">
        <nav className="oxt-tabs" aria-label="Terminal tabs" role="tablist">
          {tabs.map((item) => {
            const Icon = item.icon;
            const count =
              item.id === "positions"
                ? scannerSnapshot?.runtime.tradingSource === "MT5"
                  ? mt5Positions.length
                  : paperPositions.length
                : item.id === "orders"
                  ? scannerSnapshot?.runtime.tradingSource === "MT5"
                    ? mt5Orders.length
                    : 0
                  : item.id === "logs"
                    ? activity.length
                    : null;
            return (
              <button
                key={item.id}
                id={`oxt-tab-${item.id}`}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
                role="tab"
                aria-selected={tab === item.id}
                aria-controls="oxt-active-tabpanel"
              >
                <Icon size={14} />
                <span>{item.label}</span>
                {count != null && count > 0 && <i>{count}</i>}
              </button>
            );
          })}
        </nav>

        <div
          id="oxt-active-tabpanel"
          className="oxt-panel-body"
          role="tabpanel"
          aria-labelledby={`oxt-tab-${tab}`}
          tabIndex={0}
        >
          {tab === "trade" && (
            <div className="oxt-trade-layout">
              <div className="oxt-ticket">
                <div className="oxt-ticket-head">
                  <div>
                    <span>SERVER-VALIDATED TRADE TICKET</span>
                    <h3>
                      {candidate
                        ? `${candidate.symbol} · ${candidate.payload.strategyName ?? "Approved setup"}`
                        : `${symbol} · No valid setup`}
                    </h3>
                  </div>
                  <b
                    className={
                      candidate?.payload.direction === "short"
                        ? "is-sell"
                        : "is-buy"
                    }
                  >
                    {candidate?.payload.direction?.toUpperCase() ?? "WAIT"}
                  </b>
                </div>
                <div className="oxt-side-selector" aria-label="Setup direction">
                  <button
                    className={
                      candidate?.payload.direction === "long" ? "active" : ""
                    }
                    disabled
                  >
                    BUY
                  </button>
                  <button
                    className={
                      candidate?.payload.direction === "short" ? "active" : ""
                    }
                    disabled
                  >
                    SELL
                  </button>
                  <span>
                    Direction is locked to the approved setup; it cannot be
                    changed from the chart.
                  </span>
                </div>
                <div className="oxt-ticket-grid">
                  <label>
                    Symbol
                    <input value={candidate?.symbol ?? symbol} readOnly />
                  </label>
                  <label>
                    Setup timeframe
                    <input
                      value={candidate?.timeframe?.toUpperCase() ?? "—"}
                      readOnly
                    />
                  </label>
                  <label>
                    Current price
                    <input
                      value={number(currentPrice, symbol === "GBPJPY" ? 3 : 2)}
                      readOnly
                    />
                  </label>
                  <label>
                    Entry
                    <input
                      value={number(plan?.entry, symbol === "GBPJPY" ? 3 : 2)}
                      readOnly
                    />
                  </label>
                  <label>
                    Stop loss
                    <input
                      value={number(plan?.stop, symbol === "GBPJPY" ? 3 : 2)}
                      readOnly
                    />
                  </label>
                  <label>
                    Take profit
                    <input
                      value={number(plan?.target, symbol === "GBPJPY" ? 3 : 2)}
                      readOnly
                    />
                  </label>
                  <label>
                    Risk %
                    <input
                      value={plan ? `${plan.riskPercent}%` : "—"}
                      readOnly
                    />
                  </label>
                  <label>
                    Position size
                    <input value={number(plan?.positionSize, 3)} readOnly />
                  </label>
                  <label>
                    Money risk
                    <input
                      value={
                        plan?.monetaryRisk == null
                          ? "—"
                          : `${plan.currency ?? ""} ${number(plan.monetaryRisk)}`
                      }
                      readOnly
                    />
                  </label>
                  <label>
                    R:R
                    <input
                      value={plan ? `1 : ${number(plan.rr)}` : "—"}
                      readOnly
                    />
                  </label>
                </div>
                <div className="oxt-ticket-actions">
                  <button
                    disabled={!candidate}
                    onClick={() =>
                      candidate && onNavigate(`/onkar-ai/setup/${candidate.id}`)
                    }
                  >
                    View evidence
                  </button>
                  <button
                    className="primary"
                    disabled={!candidate}
                    onClick={() => onNavigate("/onkar-ai/integrations")}
                  >
                    Open secured execution controls
                  </button>
                </div>
                <p className="oxt-safe-note">
                  This ticket never bypasses setup, closed-candle, risk, news,
                  provider or confirmation policies. Final execution remains in
                  the existing secured execution controls.
                </p>
              </div>
              <div className="oxt-gate">
                <span>TRADE READINESS</span>
                <h3>
                  {executionReady
                    ? "AUTO execution ready"
                    : setupReady
                      ? "Setup ready · execution not armed"
                      : "Waiting / Blocked"}
                </h3>
                {executionBlockingReasons.length ? (
                  <ul>
                    {executionBlockingReasons.slice(0, 7).map((reason) => (
                      <li key={reason}>
                        <CircleDot size={11} /> {reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    All deterministic and runtime execution checks currently
                    pass. The server-side execution worker remains responsible
                    for the final race-condition check.
                  </p>
                )}
                {candidate && (
                  <div className="oxt-score">
                    <strong>{candidate.score}</strong>
                    <span>/100 confluence</span>
                    <small>Not win probability</small>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "positions" && (
            <div className="oxt-table-wrap">
              <header className="oxt-panel-title">
                <div>
                  <span>LIVE POSITION MONITOR</span>
                  <h3>
                    {scannerSnapshot?.runtime.tradingSource === "MT5"
                      ? "MT5 positions"
                      : "Paper positions"}
                  </h3>
                </div>
                <button onClick={() => onNavigate("/onkar-ai/integrations")}>
                  Management controls
                </button>
              </header>
              {mt5Error && scannerSnapshot?.runtime.tradingSource === "MT5" ? (
                <div className="oxt-empty">
                  <AlertTriangle size={20} />
                  <p>{mt5Error}</p>
                </div>
              ) : scannerSnapshot?.runtime.tradingSource === "MT5" ? (
                mt5Positions.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Entry</th>
                        <th>SL</th>
                        <th>TP</th>
                        <th>Volume</th>
                        <th>Current</th>
                        <th>P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mt5Positions.map((position) => (
                        <tr key={position.ticket}>
                          <td>{position.symbol}</td>
                          <td>
                            <b
                              className={
                                position.direction === "BUY"
                                  ? "is-buy"
                                  : "is-sell"
                              }
                            >
                              {position.direction}
                            </b>
                          </td>
                          <td>{position.entryPrice}</td>
                          <td>{position.stopLoss ?? "—"}</td>
                          <td>{position.takeProfit ?? "—"}</td>
                          <td>{position.volume}</td>
                          <td>{position.currentPrice}</td>
                          <td
                            className={
                              position.profitLoss >= 0
                                ? "is-positive"
                                : "is-negative"
                            }
                          >
                            {number(position.profitLoss)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty label="No MT5 positions are open." />
                )
              ) : paperPositions.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Setup</th>
                      <th>Entry</th>
                      <th>SL</th>
                      <th>TP</th>
                      <th>Size</th>
                      <th>Current</th>
                      <th>P/L</th>
                      <th>R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paperPositions.map((position) => (
                      <tr key={position.id}>
                        <td>{position.symbol}</td>
                        <td>
                          <b
                            className={
                              position.direction === "BUY"
                                ? "is-buy"
                                : "is-sell"
                            }
                          >
                            {position.direction}
                          </b>
                        </td>
                        <td>
                          {String(
                            position.detail.setupName ?? "Approved setup",
                          )}
                        </td>
                        <td>{position.entry}</td>
                        <td>{position.stop_loss}</td>
                        <td>{position.take_profit}</td>
                        <td>{position.position_size}</td>
                        <td>{position.current_price}</td>
                        <td
                          className={
                            (position.pnl ?? 0) >= 0
                              ? "is-positive"
                              : "is-negative"
                          }
                        >
                          {number(position.pnl)}
                        </td>
                        <td>{number(position.r_multiple)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty label="No Paper positions are open." />
              )}
              <div
                className="oxt-management-actions"
                aria-label="Position management actions"
              >
                <button
                  disabled={
                    scannerSnapshot?.runtime.tradingSource === "MT5"
                      ? mt5Positions.length === 0
                      : paperPositions.length === 0
                  }
                  onClick={() => onNavigate("/onkar-ai/integrations")}
                >
                  Open break-even controls
                </button>
                <button
                  disabled={
                    scannerSnapshot?.runtime.tradingSource === "MT5"
                      ? mt5Positions.length === 0
                      : paperPositions.length === 0
                  }
                  onClick={() => onNavigate("/onkar-ai/integrations")}
                >
                  Open partial-close controls
                </button>
                <button
                  className="is-danger"
                  disabled={
                    scannerSnapshot?.runtime.tradingSource === "MT5"
                      ? mt5Positions.length === 0
                      : paperPositions.length === 0
                  }
                  onClick={() => onNavigate("/onkar-ai/integrations")}
                >
                  Open close-trade controls
                </button>
                <span>
                  Opens the existing secured provider controls; no trade is
                  modified from this read-only monitor.
                </span>
              </div>
            </div>
          )}

          {tab === "orders" && (
            <div className="oxt-table-wrap">
              <header className="oxt-panel-title">
                <div>
                  <span>ORDER BOOK</span>
                  <h3>Pending orders</h3>
                </div>
                <button onClick={() => onNavigate("/onkar-ai/integrations")}>
                  Open execution controls
                </button>
              </header>
              {scannerSnapshot?.runtime.tradingSource !== "MT5" ? (
                <Empty label="Twelve Data Paper uses validated market entry; it has no pending-order model." />
              ) : mt5Orders.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Symbol</th>
                      <th>Type</th>
                      <th>Entry</th>
                      <th>SL</th>
                      <th>TP</th>
                      <th>Volume</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mt5Orders.map((order) => (
                      <tr key={order.ticket}>
                        <td>#{order.ticket}</td>
                        <td>{order.symbol}</td>
                        <td>{order.type}</td>
                        <td>{order.price_open}</td>
                        <td>{order.sl ?? "—"}</td>
                        <td>{order.tp ?? "—"}</td>
                        <td>{order.volume_current}</td>
                        <td>{eventTime(order.time_setup)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty label={mt5Error || "No MT5 pending orders."} />
              )}
              <div
                className="oxt-management-actions"
                aria-label="Order management actions"
              >
                <button
                  className="is-danger"
                  disabled={
                    scannerSnapshot?.runtime.tradingSource !== "MT5" ||
                    mt5Orders.length === 0
                  }
                  onClick={() => onNavigate("/onkar-ai/integrations")}
                >
                  Open cancel-order controls
                </button>
                <span>
                  Cancellation remains subject to the existing provider and
                  confirmation policy.
                </span>
              </div>
            </div>
          )}

          {tab === "history" && (
            <div className="oxt-table-wrap">
              <header className="oxt-panel-title">
                <div>
                  <span>EXECUTION HISTORY</span>
                  <h3>
                    {scannerSnapshot?.runtime.tradingSource === "MT5"
                      ? "MT5 history via synchronized journal"
                      : "Closed Paper trades"}
                  </h3>
                </div>
                {scannerSnapshot?.runtime.tradingSource === "MT5" && (
                  <button
                    onClick={() =>
                      onOpenJournal
                        ? onOpenJournal()
                        : onNavigate("/onkar-ai/journal")
                    }
                  >
                    Open synchronized journal
                  </button>
                )}
              </header>
              {scannerSnapshot?.runtime.tradingSource === "MT5" ? (
                <Empty label="Closed MT5 deals are synchronized into the existing Journal; broker history is not duplicated in this chart terminal." />
              ) : paperHistory.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Setup</th>
                      <th>Entry</th>
                      <th>Exit status</th>
                      <th>P/L</th>
                      <th>R</th>
                      <th>Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paperHistory.map((trade) => (
                      <tr key={trade.id}>
                        <td>{trade.symbol}</td>
                        <td>{trade.direction}</td>
                        <td>
                          {String(trade.detail.setupName ?? "Approved setup")}
                        </td>
                        <td>{trade.entry}</td>
                        <td>{trade.status}</td>
                        <td
                          className={
                            (trade.pnl ?? 0) >= 0
                              ? "is-positive"
                              : "is-negative"
                          }
                        >
                          {number(trade.pnl)}
                        </td>
                        <td>{number(trade.r_multiple)}</td>
                        <td>{eventTime(trade.closed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty label="No closed Paper trades are available for this symbol." />
              )}
            </div>
          )}

          {tab === "journal" && (
            <div className="oxt-journal">
              <header className="oxt-panel-title">
                <div>
                  <span>TRADE JOURNAL</span>
                  <h3>Linked trading evidence</h3>
                </div>
                <button
                  onClick={() =>
                    onOpenJournal
                      ? onOpenJournal()
                      : onNavigate("/onkar-ai/journal")
                  }
                >
                  Open full journal
                </button>
              </header>
              {journalTrades.length ? (
                <div className="oxt-journal-grid">
                  {journalTrades.slice(0, 8).map((trade) => (
                    <article key={trade.id}>
                      <BookOpen size={16} />
                      <div>
                        <strong>{trade.symbol ?? "Journal trade"}</strong>
                        <span>{trade.date ?? trade.id}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty label="No journal trades are available in this workspace." />
              )}
            </div>
          )}

          {tab === "timeline" && (
            <div className="oxt-timeline">
              <header className="oxt-panel-title">
                <div>
                  <span>SETUP / TRADE LIFECYCLE</span>
                  <h3>
                    {candidate
                      ? `${candidate.symbol} · ${candidate.payload.strategyName ?? "Approved setup"}`
                      : "AI timeline"}
                  </h3>
                </div>
              </header>
              {candidateDetail?.events.length ? (
                <ol>
                  {candidateDetail.events.map((event) => (
                    <li key={event.id}>
                      <time>{eventTime(event.created_at)}</time>
                      <i />
                      <div>
                        <strong>{human(event.kind)}</strong>
                        <span>{detailText(event.detail)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty label="No candidate lifecycle events are available for the selected chart context." />
              )}
            </div>
          )}

          {tab === "logs" && (
            <div className="oxt-logs">
              <header className="oxt-panel-title">
                <div>
                  <span>CONNECTED SYSTEM LOG</span>
                  <h3>Scanner, AI and execution events</h3>
                </div>
              </header>
              {activity.length ? (
                activity.slice(0, 30).map((event) => (
                  <article key={event.id}>
                    <time>{eventTime(event.created_at)}</time>
                    <b className={`is-${event.source.toLowerCase()}`}>
                      {event.source}
                    </b>
                    <div>
                      <strong>{human(event.kind)}</strong>
                      <span>{event.reason ?? detailText(event.detail)}</span>
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  label={
                    scannerLoading
                      ? "Loading connected activity…"
                      : "No related system events are available."
                  }
                />
              )}
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="oxt-empty">
      <Radar size={23} />
      <p>{label}</p>
    </div>
  );
}
