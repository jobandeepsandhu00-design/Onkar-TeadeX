import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ScannerSnapshot } from "@workspace/api-zod";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  BrainCircuit,
  ChartNoAxesCombined,
  ChartCandlestick,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FlaskConical,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Newspaper,
  Plus,
  Radar,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { AIButton, AIScoreBadge, AIStatusBadge, KeyValue, Panel } from "./ui";
import { MarketChart } from "./charts";
import { SharedMarketChart } from "./SharedMarketChart";
import {
  AlertsPanel,
  IntegrationsPanel,
  NewsPanel,
  PerformancePanel,
  SessionPanel,
  SetupAnalysis,
  SetupTable,
} from "./DashboardPanels";
import { AssistantPage, JournalPage, RiskPage } from "./WorkspacePages";
import { AgentCommandCenter } from "./AgentCommandCenter";
import { AgentWorkspacePresence } from "./AgentWorkspacePresence";
import { AnimatedMetricValue, MotionReveal } from "./motion";
import {
  demoSetups,
  price,
  sectionPath,
  setupPath,
  type AISection,
  type SetupPreview,
} from "./demo-data";
import { brainRequest } from "../market-brain/api";
import { connectedSetups, scannerIsLive } from "./connected-setups";
import "./onkar-ai.css";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
const ConnectedScanner = lazy(() => import("../market-brain/MarketBrain"));
const groups: Array<{
  label: string;
  items: Array<[AISection, string, LucideIcon]>;
}> = [
  {
    label: "WORKSPACE",
    items: [
      ["dashboard", "Dashboard", LayoutDashboard],
      ["scanner", "AI Scanner", Radar],
      ["markets", "Markets", Globe2],
      ["watchlist", "Watchlist", Star],
      ["charts", "Charts", ChartCandlestick],
    ],
  },
  {
    label: "STRATEGY & GROWTH",
    items: [
      ["setups", "Setups", Target],
      ["strategies", "Strategy Library", BookOpen],
      ["journal", "Trading Journal", ClipboardList],
      ["backtesting", "Backtesting", FlaskConical],
      ["analytics", "Analytics", ChartNoAxesCombined],
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      ["assistant", "AI Assistant", Sparkles],
      ["news", "News & Calendar", Newspaper],
      ["risk", "Risk Management", ShieldCheck],
      ["integrations", "Integrations", Workflow],
      ["settings", "Settings", Settings2],
    ],
  },
];
type Props = {
  path: string;
  onNavigate: (path: string) => void;
  onExit: (tab?: string) => void;
  onLogout?: () => void;
  accountName?: string;
  journalTrades?: Array<{ id: string; symbol?: string; date?: string }>;
};
export default function OnkarAIWorkspace({
  path,
  onNavigate,
  onExit,
  onLogout,
  accountName = "Your trading workspace",
  journalTrades = [],
}: Props) {
  const segment =
    path.replace(/^\/onkar-ai\/?/, "").split("/")[0] || "dashboard";
  const detailId = segment === "setup" ? path.split("/")[3] : null;
  const validSection =
    groups.some((g) => g.items.some(([key]) => key === segment)) ||
    segment === "connected" ||
    segment === "setup";
  const [selected, setSelected] = useState(demoSetups[0]);
  const [saved, setSaved] = useState<string[]>([
    "gold-rejection",
    "btc-pullback",
  ]);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [assetFilter, setAssetFilter] = useState("All");
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertSymbol, setAlertSymbol] = useState(demoSetups[0].symbol);
  const [alertScore, setAlertScore] = useState(80);
  const [preferences, setPreferences] = useState({
    compact: false,
    news: true,
    motion: true,
  });
  const [scannerSnapshot, setScannerSnapshot] =
    useState<ScannerSnapshot | null>(null);
  const [scannerLoading, setScannerLoading] = useState(true);
  const [scannerError, setScannerError] = useState("");
  const [scannerSaving, setScannerSaving] = useState(false);
  const main = useRef<HTMLElement>(null);
  const liveSetups = useMemo(
    () => connectedSetups(scannerSnapshot),
    [scannerSnapshot],
  );
  const detail = detailId
    ? (liveSetups.find((s) => s.id === detailId) ??
      demoSetups.find((s) => s.id === detailId))
    : null;
  const current = detail || selected;
  const dashboardSelected =
    liveSetups.find((setup) => setup.id === selected.id) ??
    liveSetups[0] ??
    null;
  const scannerLive = scannerIsLive(scannerSnapshot);
  const refreshScanner = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await brainRequest<ScannerSnapshot>(
        "",
        "GET",
        undefined,
        signal,
      );
      setScannerSnapshot(data);
      setScannerError("");
    } catch (error) {
      if (!signal?.aborted)
        setScannerError(
          error instanceof Error ? error.message : "Scanner data unavailable.",
        );
    } finally {
      if (!signal?.aborted) setScannerLoading(false);
    }
  }, []);
  const navigate = (next: string) => {
    setMenu(false);
    onNavigate(next);
  };
  const save = (id: string) => {
    setSaved((previous) =>
      previous.includes(id)
        ? previous.filter((x) => x !== id)
        : [...previous, id],
    );
    setNotice("Preview watchlist updated for this open session.");
  };
  useEffect(() => {
    setMenu(false);
    main.current?.focus({ preventScroll: true });
  }, [path]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    void refreshScanner(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshScanner();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refreshScanner]);
  const toggleScanner = async () => {
    const config = scannerSnapshot?.config?.config;
    if (!config) {
      setNotice(
        "Save scanner settings and approve strategy rules before enabling continuous analysis.",
      );
      navigate("/onkar-ai/settings");
      return;
    }
    if (!config.enabled && !config.strategyVersionIds.length) {
      setNotice(
        "Select at least one approved strategy before enabling continuous analysis.",
      );
      navigate("/onkar-ai/settings");
      return;
    }
    setScannerSaving(true);
    try {
      await brainRequest("/config", "PUT", {
        ...config,
        enabled: !config.enabled,
      });
      await refreshScanner();
      setNotice(
        config.enabled
          ? "Continuous setup scanning is off."
          : "Continuous setup scanning is on. The worker will evaluate approved strategies on closed candles.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not change scanner state.",
      );
    } finally {
      setScannerSaving(false);
    }
  };
  const label =
    segment === "setup"
      ? "Setup Analysis"
      : segment === "connected"
        ? "Connected Scanner"
        : groups.flatMap((g) => g.items).find(([id]) => id === segment)?.[1] ||
          "Page not found";
  const select = (setup: SetupPreview) => {
    setSelected(setup);
    navigate(setupPath(setup.id));
  };
  const analysis = (
    <SetupAnalysis
      setup={current}
      saved={saved.includes(current.id)}
      onSave={() => save(current.id)}
      onNavigate={navigate}
      onJournal={() => onExit("journal")}
    />
  );
  const connectedPanel = (
    initialTab:
      | "Watchlist"
      | "Rules"
      | "Settings"
      | "Connections"
      | "Journal insights"
      | "Replay" = "Watchlist",
  ) => (
    <>
      <div className="oai-note">
        Connected workspace · authenticated scanner data, stored strategy rules,
        real health states and worker timestamps.
      </div>
      <Suspense
        fallback={<div className="oai-empty">Loading connected scanner…</div>}
      >
        <ConnectedScanner
          initialTab={initialTab}
          onJournal={() => onExit("journal")}
          journalTrades={journalTrades}
        />
      </Suspense>
    </>
  );
  return (
    <div
      className={`oai oai-workspace ${preferences.compact ? "oai-prefer-compact" : ""} ${preferences.motion ? "" : "oai-no-motion"}`}
    >
      <a className="oai-skip" href="#onkar-ai-main">
        Skip to workspace content
      </a>
      <aside className="oai-sidebar">
        <button className="oai-brand" onClick={() => navigate("/onkar-ai")}>
          <span className="oai-brand-icon">
            <BrainCircuit size={27} />
          </span>
          <span>
            ONKAR <b>AI</b>
            <small>INTELLIGENCE WORKSPACE</small>
          </span>
        </button>
        <button className="oai-back" onClick={() => onExit()}>
          <ArrowLeft size={16} />
          Back to OnkarTradex
        </button>
        <nav aria-label="Onkar AI workspace">
          {groups.map((group) => (
            <div className="oai-nav-group" key={group.label}>
              <span>{group.label}</span>
              {group.items.map(([key, text, Icon]) => (
                <button
                  key={key}
                  aria-current={segment === key ? "page" : undefined}
                  className={segment === key ? "active" : ""}
                  onClick={() => navigate(sectionPath(key))}
                >
                  <Icon size={17} />
                  <span>{text}</span>
                  {key === "scanner" && <small>8</small>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="oai-sidebar-footer">
          <ShieldCheck size={18} />
          <span>
            Analysis only<small>No live order execution</small>
          </span>
        </div>
        <div className="oai-user">
          <span className="oai-avatar">T</span>
          <span>
            <strong>OnkarTradex</strong>
            <small>{accountName}</small>
          </span>
        </div>
      </aside>
      <div className="oai-workspace-body">
        <header className="oai-topbar">
          <div className="oai-row">
            <button
              className="oai-icon-button oai-mobile-menu"
              aria-label="Open workspace navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={21} />
            </button>
            <span className="oai-breadcrumb">
              Onkar AI <ChevronRight size={13} />
              <strong>{label}</strong>
            </span>
          </div>
          <div className="oai-topbar-actions">
            <span
              className={`oai-demo-label ${scannerLive ? "is-connected" : ""}`}
            >
              {scannerLoading
                ? "CHECKING SCANNER"
                : scannerLive
                  ? "VERIFIED DATA · LIVE SCANNER"
                  : scannerSnapshot?.config?.enabled
                    ? "SCANNER ON · WAITING FOR FRESH DATA"
                    : "SCANNER OFF"}
            </span>
            <button
              className="oai-icon-button"
              aria-label="Search markets"
              onClick={() => navigate("/onkar-ai/scanner")}
            >
              <Search size={18} />
            </button>
            <button
              className="oai-icon-button"
              aria-label="View preview alerts"
              onClick={() => {
                navigate("/onkar-ai");
                setNotice(
                  "The Recent Alerts panel shows illustrative activity, not live notifications.",
                );
              }}
            >
              <Bell size={18} />
            </button>
            {onLogout && (
              <button className="oai-logout" onClick={onLogout}>
                <LogOut size={15} />
                <span>Logout</span>
              </button>
            )}
          </div>
        </header>
        <Dialog open={menu} onOpenChange={setMenu}>
          <DialogContent className="oai oai-mobile-navigation">
            <DialogTitle className="sr-only">Workspace navigation</DialogTitle>
            <DialogDescription className="sr-only">
              Choose an Onkar AI section.
            </DialogDescription>
            <div className="oai-row-between">
              <strong>Onkar AI workspace</strong>
            </div>
            <button className="oai-back" onClick={() => onExit()}>
              <ArrowLeft size={16} />
              Back to OnkarTradex
            </button>
            <nav aria-label="Mobile Onkar AI navigation">
              {groups
                .flatMap((g) => g.items)
                .map(([key, text, Icon]) => (
                  <button
                    key={key}
                    className={segment === key ? "active" : ""}
                    aria-current={segment === key ? "page" : undefined}
                    onClick={() => navigate(sectionPath(key))}
                  >
                    <Icon size={17} />
                    {text}
                  </button>
                ))}
            </nav>
          </DialogContent>
        </Dialog>
        <div className="oai-ticker" aria-label="Verified scanner candidates">
          <span className="oai-ticker-label">SCANNER EVIDENCE</span>
          {(liveSetups.length
            ? liveSetups.slice(0, 5)
            : (scannerSnapshot?.config?.config.symbols ?? []).map((symbol) => ({
                id: symbol,
                symbol,
                score: null,
                status: "Awaiting data",
              }))
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => {
                const setup = liveSetups.find(
                  (candidate) => candidate.id === s.id,
                );
                if (setup) select(setup);
              }}
              disabled={s.score === null}
            >
              <strong>{s.symbol}</strong>
              <span>{s.score === null ? "—" : `${s.score}/100`}</span>
              <em>{s.status}</em>
            </button>
          ))}
        </div>
        <main id="onkar-ai-main" className="oai-main" tabIndex={-1} ref={main}>
          <section
            className={`oai-hero ${segment === "dashboard" ? "" : "oai-hero-compact"}`}
          >
            <div>
              <div className="oai-row">
                <span className="oai-eyebrow">ONKARTRADEX / INTELLIGENCE</span>
                <span className="oai-preview-pill">
                  <span className="oai-dot" />
                  {scannerLive
                    ? "VERIFIED LIVE DATA"
                    : scannerSnapshot?.config?.enabled
                      ? "SCANNER WAITING"
                      : "SCANNER OFF"}
                </span>
              </div>
              <h1>
                {segment === "dashboard" ? (
                  <>
                    ONKAR <span>AI</span>
                  </>
                ) : (
                  label
                )}
              </h1>
              <div className="oai-hero-subtitle">
                {segment === "dashboard"
                  ? "MARKET SCANNER"
                  : "YOUR EDGE, CLEARLY ORGANIZED."}
              </div>
              <p>
                {segment === "dashboard"
                  ? "Ten specialist agents. One disciplined AI trading command center."
                  : "One connected workspace for markets, strategy and your trading process."}
              </p>
            </div>
            {segment === "dashboard" && (
              <div className="oai-hero-actions">
                <AIButton primary onClick={() => navigate("/onkar-ai/scanner")}>
                  <ScanLine size={18} />
                  Explore scanner
                  <ArrowUpRight size={16} />
                </AIButton>
                <button
                  className="oai-text-button"
                  onClick={() =>
                    document
                      .getElementById("agent-network-title")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  Meet the agents <ArrowRight size={15} />
                </button>
                <span className="oai-muted">
                  {scannerLive
                    ? "Twelve Data candles · approved Setup Library rules"
                    : "Open scanner settings to verify the market worker and approved rules"}
                </span>
              </div>
            )}
          </section>
          <AgentWorkspacePresence section={segment} />
          {segment === "dashboard" ? (
            <>
              <div className="oai-kpi-grid">
                {[
                  [
                    "Configured markets",
                    String(
                      scannerSnapshot?.config?.config.symbols.length ?? 0,
                    ).padStart(2, "0"),
                    scannerSnapshot?.config?.config.provider === "twelvedata"
                      ? "Twelve Data"
                      : "Market provider",
                    Globe2,
                    "blue",
                  ],
                  [
                    "Confirmed setups",
                    String(
                      liveSetups.filter((setup) => setup.status === "Confirmed")
                        .length,
                    ).padStart(2, "0"),
                    "Verified closed-candle rules",
                    Target,
                    "green",
                  ],
                  [
                    "Partial / watching",
                    String(
                      liveSetups.filter((setup) =>
                        ["Partial match", "Watching"].includes(setup.status),
                      ).length,
                    ).padStart(2, "0"),
                    "Awaiting rule confirmation",
                    Activity,
                    "gold",
                  ],
                  [
                    "Scanner alerts",
                    String(scannerSnapshot?.alerts.length ?? 0).padStart(
                      2,
                      "0",
                    ),
                    "Stored verified events",
                    Bell,
                    "purple",
                  ],
                  [
                    "Journal win rate",
                    scannerSnapshot?.journal &&
                    scannerSnapshot.journal.wins +
                      scannerSnapshot.journal.losses >
                      0
                      ? `${Math.round((scannerSnapshot.journal.wins / (scannerSnapshot.journal.wins + scannerSnapshot.journal.losses)) * 100)}%`
                      : "—",
                    scannerSnapshot?.journal
                      ? `${scannerSnapshot.journal.wins + scannerSnapshot.journal.losses} resolved trades`
                      : "Select a risk account",
                    ChartNoAxesCombined,
                    "cyan",
                  ],
                  [
                    "System status",
                    scannerLive
                      ? "Live"
                      : scannerSnapshot?.config?.enabled
                        ? "Waiting"
                        : "Off",
                    scannerError ||
                      (scannerLive
                        ? "Worker and market are fresh"
                        : "Open Connections for checks"),
                    ShieldCheck,
                    "blue",
                  ],
                ].map(([title, value, hint, Icon, tone], index) => {
                  const MetricIcon = Icon as typeof Globe2;
                  return (
                    <MotionReveal
                      className={`oai-kpi oai-accent-${tone}`}
                      key={String(title)}
                      delay={index * 0.055}
                    >
                      <div>
                        <span>{String(title)}</span>
                        <MetricIcon size={17} />
                      </div>
                      <strong>
                        <AnimatedMetricValue value={String(value)} />
                      </strong>
                      <small>{String(hint)}</small>
                    </MotionReveal>
                  );
                })}
              </div>
              <AgentCommandCenter onNavigate={navigate} />
              <div className="oai-dashboard-command">
                <Panel
                  title="Top AI Setups"
                  kicker="VERIFIED RULE CONFLUENCE"
                  className="oai-dashboard-watchlist"
                  action={
                    <div className="oai-scanner-actions">
                      <button
                        className={`oai-scanner-switch ${scannerSnapshot?.config?.enabled ? "is-on" : ""}`}
                        onClick={() => void toggleScanner()}
                        disabled={scannerLoading || scannerSaving}
                        role="switch"
                        aria-checked={Boolean(scannerSnapshot?.config?.enabled)}
                      >
                        <i />{" "}
                        {scannerSaving
                          ? "Saving"
                          : scannerSnapshot?.config?.enabled
                            ? "Scanner on"
                            : "Scanner off"}
                      </button>
                      <button
                        className="oai-text-button"
                        onClick={() => navigate("/onkar-ai/scanner")}
                      >
                        View all <ArrowUpRight size={14} />
                      </button>
                    </div>
                  }
                >
                  <div className="oai-tabs oai-watch-tabs">
                    {["All", "Forex", "Gold", "Indices", "Crypto"].map(
                      (asset) => (
                        <button
                          key={asset}
                          className={asset === assetFilter ? "active" : ""}
                          aria-pressed={asset === assetFilter}
                          onClick={() => setAssetFilter(asset)}
                        >
                          {asset}
                        </button>
                      ),
                    )}
                  </div>
                  <SetupTable
                    setups={liveSetups.filter(
                      (s) => assetFilter === "All" || s.asset === assetFilter,
                    )}
                    selectedId={dashboardSelected?.id}
                    onSelect={setSelected}
                    compact
                    emptyMessage={
                      scannerSnapshot?.config?.enabled
                        ? "The scanner has not stored a qualifying candidate yet. Approved strategies will appear after verified closed-candle evaluation."
                        : "Turn on the scanner to evaluate your approved Setup Library rules."
                    }
                  />
                </Panel>
                <SharedMarketChart compact />
                {dashboardSelected ? (
                  <SetupAnalysis
                    setup={dashboardSelected}
                    saved={saved.includes(dashboardSelected.id)}
                    onSave={() => save(dashboardSelected.id)}
                    onNavigate={navigate}
                    onJournal={() => onExit("journal")}
                  />
                ) : (
                  <Panel
                    title="AI Setup Analysis"
                    kicker="AWAITING VERIFIED EVIDENCE"
                    className="oai-analysis"
                  >
                    <div className="oai-empty">
                      <Radar size={30} />
                      <h3>No real setup candidate yet</h3>
                      <p>
                        {scannerSnapshot?.config?.enabled
                          ? "Approved strategies are evaluated from Twelve Data closed candles. A result will appear when the deterministic rules produce a candidate."
                          : "Turn on the scanner after approving at least one strategy version."}
                      </p>
                      <AIButton onClick={() => navigate("/onkar-ai/settings")}>
                        Open scanner settings <ArrowUpRight size={15} />
                      </AIButton>
                    </div>
                  </Panel>
                )}
              </div>
              <div className="oai-dashboard-widgets">
                <SessionPanel />
                {preferences.news && <NewsPanel onNavigate={navigate} />}
                <AlertsPanel onNavigate={navigate} />
                <PerformancePanel onNavigate={navigate} />
              </div>
              <div className="oai-two-columns oai-support-grid">
                <IntegrationsPanel
                  onConnect={() => navigate("/onkar-ai/connected")}
                />
                <Panel
                  title="Quick Actions"
                  kicker="MOVE FROM CONTEXT TO PROCESS"
                >
                  <div className="oai-quick-grid">
                    {[
                      ["Scanner", Radar, "scanner"],
                      ["Open chart", ChartCandlestick, "charts"],
                      ["Create alert", Bell, "integrations"],
                      ["Journal", ClipboardList, "journal"],
                      ["AI analysis", Sparkles, "assistant"],
                      ["Backtest", FlaskConical, "backtesting"],
                    ].map(([title, Icon, target]) => {
                      const ActionIcon = Icon as typeof Radar;
                      return (
                        <button
                          key={String(title)}
                          onClick={() =>
                            title === "Create alert"
                              ? setAlertOpen(true)
                              : navigate(sectionPath(String(target)))
                          }
                        >
                          <ActionIcon size={20} />
                          <span>{String(title)}</span>
                          <ArrowUpRight size={14} />
                        </button>
                      );
                    })}
                  </div>
                </Panel>
              </div>
            </>
          ) : segment === "scanner" ||
            segment === "markets" ||
            segment === "watchlist" ? (
            connectedPanel("Watchlist")
          ) : segment === "charts" ? (
            <>
              <div className="oai-section-intro">
                <div>
                  <span className="oai-kicker">SHARED MARKET INTELLIGENCE</span>
                  <h2>Live chart and agent context</h2>
                  <p>
                    The chart, Master AI and every specialist consume this same
                    authenticated candle snapshot.
                  </p>
                </div>
              </div>
              <SharedMarketChart />
            </>
          ) : segment === "setup" && detail ? (
            <>
              <div className="oai-section-intro">
                <div className="oai-row">
                  <AIStatusBadge status={detail.status} />
                  <span className="oai-muted">
                    {detail.symbol} ·{" "}
                    {detail.source === "verified"
                      ? "Verified scanner result"
                      : "Illustrative setup"}
                  </span>
                </div>
                <AIButton onClick={() => navigate("/onkar-ai/scanner")}>
                  <ArrowLeft size={15} />
                  Back to scanner
                </AIButton>
              </div>
              <div className="oai-command-grid">
                {detail.source === "verified" ? (
                  <SharedMarketChart
                    initialSymbol={
                      detail.symbol.replace(/[/-]/g, "") === "GBPJPY"
                        ? "GBPJPY"
                        : "XAUUSD"
                    }
                    initialTimeframe={
                      detail.timeframe === "30m" || detail.timeframe === "1h"
                        ? detail.timeframe
                        : "15m"
                    }
                  />
                ) : (
                  <MarketChart setup={detail} expanded />
                )}
                {analysis}
              </div>
              <div className="oai-two-columns">
                <Panel
                  title="Trade Plan"
                  kicker={
                    detail.source === "verified"
                      ? "CALCULATED PLAN · MANUAL REVIEW REQUIRED"
                      : "SAMPLE PRICES · NOT AN EXECUTABLE PLAN"
                  }
                >
                  <div className="oai-plan-grid">
                    <KeyValue
                      label="Entry zone"
                      value={`${price(detail.entry[0])} – ${price(detail.entry[1])}`}
                    />
                    <KeyValue
                      label="Stop / invalidation"
                      value={price(detail.stop)}
                    />
                    <KeyValue
                      label="Target 1"
                      value={price(detail.targets[0])}
                    />
                    <KeyValue
                      label="Target 2"
                      value={price(detail.targets[1])}
                    />
                  </div>
                </Panel>
                <Panel
                  title="Setup Timeline"
                  kicker={
                    detail.source === "verified"
                      ? "VERIFIED SCANNER LIFECYCLE"
                      : "ILLUSTRATIVE LIFECYCLE"
                  }
                >
                  {detail.source === "verified" ? (
                    <ol className="oai-timeline">
                      <li>
                        <time>
                          {detail.updatedAt
                            ? new Date(detail.updatedAt).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" },
                              )
                            : "—"}
                        </time>
                        <span>
                          Closed-candle rules evaluated by the deterministic
                          scanner
                        </span>
                      </li>
                      <li>
                        <time>{detail.validation ?? "—"}</time>
                        <span>{detail.reason}</span>
                      </li>
                      <li>
                        <time>NEXT</time>
                        <span>{detail.waitFor}</span>
                      </li>
                    </ol>
                  ) : (
                    <ol className="oai-timeline">
                      <li>
                        <time>09:15</time>
                        <span>Higher-timeframe zone identified</span>
                      </li>
                      <li>
                        <time>10:00</time>
                        <span>Price approaches the area of interest</span>
                      </li>
                      <li>
                        <time>10:15</time>
                        <span>
                          {detail.status === "Invalidated"
                            ? "Support failed · setup invalidated"
                            : "Confirmation reviewed · waiting for trader review"}
                        </span>
                      </li>
                    </ol>
                  )}
                </Panel>
              </div>
            </>
          ) : segment === "setups" || segment === "strategies" ? (
            connectedPanel("Rules")
          ) : segment === "journal" ? (
            <JournalPage onJournal={() => onExit("journal")} />
          ) : segment === "analytics" ? (
            connectedPanel("Journal insights")
          ) : segment === "assistant" ? (
            <AssistantPage onNavigate={navigate} />
          ) : segment === "risk" ? (
            <RiskPage />
          ) : segment === "backtesting" ? (
            connectedPanel("Replay")
          ) : segment === "news" ? (
            <>
              <div className="oai-news-banner">
                <ShieldCheck size={25} />
                <div>
                  <h3>Know what is moving the market.</h3>
                  <p>
                    These events demonstrate the design. They are not a live
                    economic calendar.
                  </p>
                </div>
              </div>
              <NewsPanel full />
              <SessionPanel />
            </>
          ) : segment === "integrations" ? (
            connectedPanel("Connections")
          ) : segment === "settings" ? (
            connectedPanel("Settings")
          ) : segment === "connected" ? (
            connectedPanel("Watchlist")
          ) : (
            <Panel>
              <div className="oai-empty">
                <CircleHelp size={35} />
                <h3>
                  {validSection
                    ? "This sample setup was not found"
                    : "Workspace page not found"}
                </h3>
                <AIButton onClick={() => navigate("/onkar-ai")}>
                  Return to Onkar AI
                </AIButton>
              </div>
            </Panel>
          )}
          <footer className="oai-workspace-footer">
            <span>
              <BrainCircuit size={14} />
              ONKAR AI · Part of OnkarTradex
            </span>
            <span>Design preview · Sample data · No trading signals</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="oai-toast" role="status">
          <Check size={17} />
          {notice}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent className="oai oai-alert-dialog">
          <DialogTitle>Create a preview alert</DialogTitle>
          <DialogDescription>
            Try the alert workflow. This design preview does not monitor markets
            or send notifications.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAlertOpen(false);
              setNotice(
                `Preview alert created: ${alertSymbol}, score ≥ ${alertScore}. No live monitoring enabled.`,
              );
            }}
          >
            <label>
              Market
              <select
                value={alertSymbol}
                onChange={(e) => setAlertSymbol(e.target.value)}
              >
                {demoSetups.map((s) => (
                  <option key={s.id}>{s.symbol}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum confluence score
              <input
                type="number"
                min={0}
                max={100}
                required
                value={alertScore}
                onChange={(e) => setAlertScore(Number(e.target.value))}
              />
            </label>
            <AIButton primary type="submit">
              Create preview alert
            </AIButton>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
