import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import {
  AIButton,
  AIScoreBadge,
  AIStatusBadge,
  DemoLabel,
  KeyValue,
  Panel,
} from "./ui";
import { MarketChart } from "./charts";
import {
  AlertsPanel,
  IntegrationsPanel,
  NewsPanel,
  PerformancePanel,
  SessionPanel,
  SetupAnalysis,
  SetupTable,
} from "./DashboardPanels";
import {
  JournalPage,
  RiskPage,
} from "./WorkspacePages";
import {
  demoSetups,
  price,
  sectionPath,
  setupPath,
  type AISection,
  type SetupPreview,
} from "./demo-data";
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
  const main = useRef<HTMLElement>(null);
  const detail = detailId ? demoSetups.find((s) => s.id === detailId) : null;
  const current = detail || selected;
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
  const connectedPanel = (initialTab: "Watchlist" | "Rules" | "Settings" | "Connections" | "Journal insights" | "Replay" = "Watchlist") => (
    <>
      <div className="oai-note">
        Connected workspace · authenticated scanner data, stored strategy rules,
        real health states and worker timestamps.
      </div>
      <Suspense fallback={<div className="oai-empty">Loading connected scanner…</div>}>
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
            <DemoLabel />
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
        <div className="oai-ticker" aria-label="Illustrative market quotes">
          <span className="oai-ticker-label">SAMPLE MARKETS</span>
          {demoSetups.slice(0, 5).map((s) => (
            <button key={s.id} onClick={() => select(s)}>
              <strong>{s.symbol}</strong>
              <span>{price(s.price)}</span>
              <em
                className={s.change.startsWith("−") ? "oai-red" : "oai-green"}
              >
                {s.change}
              </em>
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
                  DESIGN PREVIEW
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
                  ? "Less noise. More context. A clearer view of every opportunity."
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
                  onClick={() => navigate("/onkar-ai/connected")}
                >
                  Open connected system <ArrowRight size={15} />
                </button>
                <span className="oai-muted">
                  Sample data · no background scan running here
                </span>
              </div>
            )}
          </section>
          {segment === "dashboard" ? (
            <>
              <div className="oai-kpi-grid">
                {[
                  [
                    "Markets in preview",
                    "08",
                    "5 asset classes",
                    Globe2,
                    "blue",
                  ],
                  [
                    "High-quality setups",
                    "01",
                    "Confluence, not probability",
                    Target,
                    "green",
                  ],
                  [
                    "Developing",
                    "02",
                    "Awaiting confirmation",
                    Activity,
                    "gold",
                  ],
                  [
                    "Example alerts",
                    "04",
                    "Illustrative event feed",
                    Bell,
                    "purple",
                  ],
                  [
                    "Example win rate",
                    "60%",
                    "3 wins / 5 sample trades",
                    ChartNoAxesCombined,
                    "cyan",
                  ],
                  [
                    "System status",
                    "Preview",
                    "Open Integrations for checks",
                    ShieldCheck,
                    "blue",
                  ],
                ].map(([title, value, hint, Icon, tone]) => {
                  const MetricIcon = Icon as typeof Globe2;
                  return (
                    <div
                      className={`oai-kpi oai-accent-${tone}`}
                      key={String(title)}
                    >
                      <div>
                        <span>{String(title)}</span>
                        <MetricIcon size={17} />
                      </div>
                      <strong>{String(value)}</strong>
                      <small>{String(hint)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="oai-dashboard-command">
                <Panel
                  title="Top AI Setups"
                  kicker="SAMPLE RULE CONFLUENCE"
                  className="oai-dashboard-watchlist"
                  action={
                    <button
                      className="oai-text-button"
                      onClick={() => navigate("/onkar-ai/scanner")}
                    >
                      View all <ArrowUpRight size={14} />
                    </button>
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
                    setups={demoSetups.filter(
                      (s) => assetFilter === "All" || s.asset === assetFilter,
                    )}
                    selectedId={selected.id}
                    onSelect={setSelected}
                    compact
                  />
                </Panel>
                <MarketChart
                  setup={selected}
                  onExpand={() => navigate("/onkar-ai/charts")}
                />
                {analysis}
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
          ) : segment === "scanner" || segment === "markets" || segment === "watchlist" ? (
            connectedPanel("Watchlist")
          ) : segment === "charts" ? (
            connectedPanel("Watchlist")
          ) : segment === "setup" && detail ? (
            <>
              <div className="oai-section-intro">
                <div className="oai-row">
                  <AIStatusBadge status={detail.status} />
                  <span className="oai-muted">
                    {detail.symbol} · Illustrative setup
                  </span>
                </div>
                <AIButton onClick={() => navigate("/onkar-ai/scanner")}>
                  <ArrowLeft size={15} />
                  Back to scanner
                </AIButton>
              </div>
              <div className="oai-command-grid">
                <MarketChart setup={detail} expanded />
                {analysis}
              </div>
              <div className="oai-two-columns">
                <Panel
                  title="Trade Plan"
                  kicker="SAMPLE PRICES · NOT AN EXECUTABLE PLAN"
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
                <Panel title="Setup Timeline" kicker="ILLUSTRATIVE LIFECYCLE">
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
            connectedPanel("Watchlist")
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
