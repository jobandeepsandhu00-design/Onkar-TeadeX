import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  FlaskConical,
  MessageSquare,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
} from "lucide-react";
import { AIButton, AIScoreBadge, AIStatusBadge, KeyValue, Panel } from "./ui";
import { ComparisonChart, MiniMarketChart, PerformanceChart } from "./charts";
import {
  demoSetups,
  demoTrades,
  price,
  setupPath,
  type SetupPreview,
} from "./demo-data";
import { SetupTable } from "./DashboardPanels";
import { masterAIRequest } from "../market-brain/api";
import type { MasterAIResponse } from "@workspace/api-zod";
type Navigate = (path: string) => void;
export function ScannerPage({
  onSelect,
}: {
  onSelect: (setup: SetupPreview) => void;
}) {
  const [query, setQuery] = useState("");
  const [asset, setAsset] = useState("All markets");
  const [status, setStatus] = useState("All statuses");
  const [minimum, setMinimum] = useState(0);
  const [direction, setDirection] = useState("Both");
  const [sort, setSort] = useState("Score");
  const filtered = demoSetups
    .filter(
      (s) =>
        `${s.symbol} ${s.name}`.toLowerCase().includes(query.toLowerCase()) &&
        (asset === "All markets" || s.asset === asset) &&
        (status === "All statuses" || s.status === status) &&
        s.score >= minimum &&
        (direction === "Both" || s.direction === direction),
    )
    .sort((a, b) =>
      sort === "Score" ? b.score - a.score : a.symbol.localeCompare(b.symbol),
    );
  return (
    <Panel
      title="Opportunity Scanner"
      kicker="FILTER THE NOISE. FIND YOUR FOCUS."
      action={
        <span className="oai-muted">{filtered.length} sample markets</span>
      }
    >
      <div className="oai-filter-bar">
        <label className="oai-search">
          <Search size={16} />
          <input
            aria-label="Search scanner"
            placeholder="Search symbol or setup…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Asset class</span>
          <select
            aria-label="Asset class"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
          >
            {["All markets", "Forex", "Gold", "Indices", "Crypto"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select
            aria-label="Setup status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              "All statuses",
              "High quality",
              "Watching",
              "Developing",
              "Weak",
              "Invalidated",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            {["Both", "Long", "Short"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Min score
          <select
            value={minimum}
            onChange={(e) => setMinimum(Number(e.target.value))}
          >
            {[0, 50, 65, 80, 90].map((x) => (
              <option key={x} value={x}>
                {x === 0 ? "Any score" : `${x}+`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option>Score</option>
            <option>Symbol</option>
          </select>
        </label>
      </div>
      <SetupTable setups={filtered} onSelect={onSelect} />
    </Panel>
  );
}
export function MarketCards({
  saved,
  onSave,
  onNavigate,
  watchlist = false,
}: {
  saved: string[];
  onSave: (id: string) => void;
  onNavigate: Navigate;
  watchlist?: boolean;
}) {
  const rows = watchlist
    ? demoSetups.filter((s) => saved.includes(s.id))
    : demoSetups;
  return (
    <>
      <div className="oai-section-intro">
        <p>
          {watchlist
            ? "Your focused collection. Saved only for this preview session."
            : "Explore the sample market universe by instrument."}
        </p>
        {watchlist && (
          <AIButton onClick={() => onNavigate("/onkar-ai/markets")}>
            Add markets <ArrowRight size={16} />
          </AIButton>
        )}
      </div>
      <div className="oai-market-grid">
        {rows.map((s) => (
          <Panel
            key={s.id}
            title={s.symbol}
            kicker={s.asset}
            action={
              <button
                className="oai-icon-button"
                aria-label={`${saved.includes(s.id) ? "Remove" : "Save"} ${s.symbol}`}
                aria-pressed={saved.includes(s.id)}
                onClick={() => onSave(s.id)}
              >
                <Star
                  size={18}
                  fill={saved.includes(s.id) ? "currentColor" : "none"}
                />
              </button>
            }
          >
            <div className="oai-card-body">
              <div className="oai-row-between">
                <strong className="oai-market-price">{price(s.price)}</strong>
                <AIScoreBadge score={s.score} />
              </div>
              <MiniMarketChart setup={s} />
              <h3>{s.name}</h3>
              <div className="oai-row-between">
                <AIStatusBadge status={s.status} />
                <span className="oai-muted">
                  {s.timeframe} · {s.direction}
                </span>
              </div>
              <AIButton onClick={() => onNavigate(setupPath(s.id))}>
                Open analysis <ArrowUpRight size={15} />
              </AIButton>
            </div>
          </Panel>
        ))}
      </div>
      {!rows.length && (
        <Panel>
          <div className="oai-empty">
            <Star size={30} />
            <h3>Build a quieter watchlist</h3>
            <p>Save a market to keep its setup within reach.</p>
            <AIButton onClick={() => onNavigate("/onkar-ai/markets")}>
              Explore markets
            </AIButton>
          </div>
        </Panel>
      )}
    </>
  );
}
export function StrategyPage({
  onNavigate,
  onLibrary,
}: {
  onNavigate: Navigate;
  onLibrary: () => void;
}) {
  const [category, setCategory] = useState("All");
  const types = ["All", "Rejection", "Retest", "Continuation"];
  return (
    <>
      <div className="oai-section-intro">
        <div className="oai-tabs">
          {types.map((x) => (
            <button
              key={x}
              className={category === x ? "active" : ""}
              onClick={() => setCategory(x)}
            >
              {x}
            </button>
          ))}
        </div>
        <AIButton onClick={onLibrary}>
          <BookOpen size={16} />
          Your existing library
        </AIButton>
      </div>
      <div className="oai-market-grid">
        {demoSetups
          .filter((s) => category === "All" || s.name.includes(category))
          .map((s) => (
            <Panel
              key={s.id}
              kicker={`${s.asset} · ${s.timeframe}`}
              title={s.name}
              action={
                <span className="oai-strategy-icon">
                  <SlidersHorizontal size={20} />
                </span>
              }
            >
              <div className="oai-card-body">
                <p className="oai-muted">
                  Align the higher-timeframe context with a clear price-action
                  confirmation. Review the setup before considering risk.
                </p>
                <div className="oai-row">
                  <AIStatusBadge status={s.direction} />
                  <span className="oai-small-chip">Preview rules</span>
                </div>
                <ul className="oai-checklist">
                  <li>
                    <Check size={14} />
                    Identify structure and key levels
                  </li>
                  <li>
                    <Check size={14} />
                    Wait for candle confirmation
                  </li>
                  <li>
                    <Check size={14} />
                    Define risk and invalidation
                  </li>
                </ul>
                <AIButton onClick={() => onNavigate(setupPath(s.id))}>
                  Explore example <ArrowRight size={15} />
                </AIButton>
              </div>
            </Panel>
          ))}
      </div>
    </>
  );
}
export function JournalPage({ onJournal }: { onJournal: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <>
      <div className="oai-section-intro">
        <p>
          Review the process, not just the outcome. These are sample trades.
        </p>
        <AIButton primary onClick={onJournal}>
          Open my real journal <ArrowUpRight size={16} />
        </AIButton>
      </div>
      <div className="oai-summary-grid">
        {[
          ["Net result", "+$880"],
          ["Win rate", "60%"],
          ["Average R", "+0.88R"],
          ["Rule compliance", "Not recorded"],
        ].map(([label, value]) => (
          <Panel key={label}>
            <KeyValue label={label} value={value} />
          </Panel>
        ))}
      </div>
      <Panel title="Trade Review" kicker="5 EXAMPLE TRADES">
        <div className="oai-table-wrap">
          <table className="oai-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Setup</th>
                <th>Session</th>
                <th>Result</th>
                <th>P&L</th>
                <th>R multiple</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {demoTrades.map((t, i) => (
                <tr key={t.symbol}>
                  <td>
                    <strong>{t.symbol}</strong>
                  </td>
                  <td>{t.setup}</td>
                  <td>{t.session}</td>
                  <td>
                    <AIStatusBadge status={t.result} />
                  </td>
                  <td className={t.pnl > 0 ? "oai-green" : "oai-red"}>
                    {t.pnl > 0 ? "+" : ""}${t.pnl}
                  </td>
                  <td>{t.r}R</td>
                  <td>
                    <button
                      className="oai-text-button"
                      onClick={() => setSelected(selected === i ? null : i)}
                    >
                      Notes <MessageSquare size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected !== null && (
          <div className="oai-note">
            <strong>{demoTrades[selected].symbol} · Lesson</strong>
            <p>{demoTrades[selected].note}</p>
            <small>Screenshot not included in the example dataset.</small>
          </div>
        )}
      </Panel>
    </>
  );
}
export function AnalyticsPage() {
  return (
    <>
      <div className="oai-summary-grid">
        {[
          ["Sample net P&L", "+$880"],
          ["Sample win rate", "60%"],
          ["Average result", "0.88R"],
          ["Profit factor", "3.2"],
        ].map(([label, value]) => (
          <Panel key={label}>
            <KeyValue label={label} value={value} />
          </Panel>
        ))}
      </div>
      <div className="oai-two-columns">
        <Panel title="Equity Progression" kicker="ILLUSTRATIVE CURVE">
          <PerformanceChart />
        </Panel>
        <Panel title="Results by Session" kicker="5 EXAMPLE TRADES · NET USD">
          <ComparisonChart
            data={[
              { label: "London", value: 320 },
              { label: "New York", value: 140 },
              { label: "Asian", value: 420 },
            ]}
          />
        </Panel>
        <Panel title="Results by Setup" kicker="SAMPLE NET USD">
          <ComparisonChart
            data={demoTrades.map((t) => ({ label: t.symbol, value: t.pnl }))}
          />
        </Panel>
        <Panel title="The lesson behind the numbers" kicker="PROCESS INSIGHT">
          <div className="oai-card-body">
            <span className="oai-strategy-icon">
              <Sparkles size={25} />
            </span>
            <h3>Confirmation before commitment.</h3>
            <p className="oai-muted">
              The two losing example trades mention early entry and insufficient
              range. Use the real journal to test whether that pattern exists in
              your own history.
            </p>
            <div className="oai-note">
              Five sample trades are not evidence of an edge or statistical
              significance.
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
export function AssistantPage({ onNavigate }: { onNavigate: Navigate }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<MasterAIResponse | null>(null);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const prompts = [
    "Analyze my trading performance",
    "What is my biggest recorded mistake?",
    "Which setup works best for me?",
    "Why did my last trade lose?",
  ];
  const send = async (input: string) => {
    if (!input.trim() || loading) return;
    const q = input.trim();
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    setError("");
    setLoading(true);
    window.dispatchEvent(new CustomEvent("onkar-ai-agent-state", { detail: { master: "thinking", insight: "thinking" } }));
    try {
      const result = await masterAIRequest({ question: q, deepAnalysis: false });
      setLastRun(result);
      setMessages((m) => [...m, { role: "assistant", text: result.answer }]);
      window.dispatchEvent(new CustomEvent("onkar-ai-agent-state", { detail: result.animationStates }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Master AI is temporarily unavailable.");
      window.dispatchEvent(new CustomEvent("onkar-ai-agent-state", { detail: { master: "offline", insight: "offline" } }));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="oai-assistant-layout">
      <Panel title="Explore with Onkar AI" kicker="SUGGESTED PROMPTS">
        <div className="oai-prompt-list">
          {prompts.map((p) => (
            <button key={p} onClick={() => send(p)}>
              <MessageSquare size={17} />
              {p}
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
        <button
          className="oai-text-button oai-panel-link"
          onClick={() => setMessages([])}
        >
          Clear conversation
        </button>
        <button
          className="oai-text-button oai-panel-link"
          onClick={() => onNavigate("/onkar-ai/connected")}
        >
          Open connected analysis
        </button>
      </Panel>
      <Panel
        title="Your market thinking partner"
        kicker="AUTHENTICATED · EVIDENCE-BASED"
        className="oai-chat-panel"
      >
        <div className="oai-chat-messages" aria-live="polite">
          {!messages.length ? (
            <div className="oai-chat-welcome">
              <Sparkles size={35} />
              <h3>Clarity starts with a better question.</h3>
              <p>
                Ask about your real journal, approved strategies and available
                scanner evidence.
              </p>
              <small>Master AI never invents missing market or journal data.</small>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`oai-chat-message ${m.role}`}>
                <small>
                  {m.role === "user" ? "You" : "Master AI"}
                </small>
                <p>{m.text}</p>
              </div>
            ))
          )}
          {loading && <div className="oai-chat-message assistant"><small>Master AI · thinking</small><p>Retrieving the minimum relevant evidence…</p></div>}
          {error && <div className="oai-note" role="alert">{error}</div>}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(question);
          }}
          className="oai-chat-compose"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={1000}
            aria-label="Ask Onkar AI"
            placeholder="Ask about your trading…"
          />
          <button
            disabled={!question.trim() || loading}
            aria-label="Ask Master AI"
          >
            <Send size={19} />
          </button>
        </form>
        {lastRun && (
          <details className="oai-command-log">
            <summary>Command log · {lastRun.agents.length} agent results · {lastRun.dataStatus}</summary>
            {lastRun.commandLog.map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><strong>{entry.source} → {entry.target}</strong><span>{entry.summary}</span></div>
            ))}
          </details>
        )}
      </Panel>
    </div>
  );
}
export function RiskPage() {
  const [balance, setBalance] = useState("100000");
  const [risk, setRisk] = useState("1");
  const [entry, setEntry] = useState("2406");
  const [stop, setStop] = useState("2395");
  const [contract, setContract] = useState("100");
  const amount = (Number(balance) * Number(risk)) / 100;
  const distance = Math.abs(Number(entry) - Number(stop));
  const valid =
    Number(balance) > 0 &&
    Number(risk) > 0 &&
    Number(risk) <= 100 &&
    distance > 0 &&
    Number(contract) > 0;
  return (
    <div className="oai-two-columns">
      <Panel
        title="Plan the risk. Protect the process."
        kicker="PREVIEW CALCULATOR"
      >
        <div className="oai-form-grid">
          {[
            ["Example account balance", balance, setBalance],
            ["Risk per trade (%)", risk, setRisk],
            ["Entry price", entry, setEntry],
            ["Stop loss", stop, setStop],
            ["Account-currency value per price unit", contract, setContract],
          ].map(([label, value, setter]) => (
            <label key={String(label)}>
              {String(label)}
              <input
                type="number"
                step="any"
                min="0"
                value={String(value)}
                onChange={(e) =>
                  (setter as (v: string) => void)(e.target.value)
                }
              />
            </label>
          ))}
        </div>
        <div className="oai-note">
          Manual example values only. Account balance, contract size and
          conversion are not retrieved from your broker.
        </div>
      </Panel>
      <Panel
        title="Risk Overview"
        action={<Shield className="oai-blue" size={22} />}
      >
        <div className="oai-risk-total">
          <span>PLANNED MONETARY RISK</span>
          <strong>
            {valid
              ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : "—"}
          </strong>
          <small>Example currency · USD</small>
        </div>
        <div className="oai-card-body">
          <KeyValue
            label="Stop distance"
            value={valid ? price(distance) : "Enter valid prices"}
          />
          <KeyValue
            label="Position size (configured units)"
            value={
              valid ? (amount / (distance * Number(contract))).toFixed(3) : "—"
            }
          />
          <KeyValue label="Order execution" value="Disabled" />
          <div className="oai-note">
            This interactive calculation does not create a trade or change your
            real account’s risk settings.
          </div>
        </div>
      </Panel>
    </div>
  );
}
export function BacktestingPage({ onExisting }: { onExisting: () => void }) {
  const [run, setRun] = useState(false);
  const [setup, setSetup] = useState(demoSetups[0].name);
  const [tf, setTf] = useState("15m");
  return (
    <div className="oai-two-columns">
      <Panel title="Build a test hypothesis" kicker="REPLAY DESIGN PREVIEW">
        <div className="oai-form-grid">
          <label>
            Strategy
            <select
              value={setup}
              onChange={(e) => {
                setSetup(e.target.value);
                setRun(false);
              }}
            >
              {[...new Set(demoSetups.map((s) => s.name))].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Timeframe
            <select
              value={tf}
              onChange={(e) => {
                setTf(e.target.value);
                setRun(false);
              }}
            >
              {["5m", "15m", "1h", "4h"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              defaultValue="2026-08-01"
              onChange={() => setRun(false)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              defaultValue="2026-08-31"
              onChange={() => setRun(false)}
            />
          </label>
        </div>
        <div className="oai-card-body">
          <AIButton primary onClick={() => setRun(true)}>
            <FlaskConical size={16} />
            Show example results
          </AIButton>
          <AIButton onClick={onExisting}>
            Open existing backtesting <ArrowUpRight size={15} />
          </AIButton>
        </div>
      </Panel>
      <Panel
        title={run ? "Example report" : "From idea to evidence"}
        kicker="NO BACKTEST IS EXECUTED"
      >
        {run ? (
          <div className="oai-card-body">
            <h3>
              {setup} · {tf}
            </h3>
            <p className="oai-muted">
              Static report layout using the same five sample journal trades;
              not a computed result for your selected dates or strategy.
            </p>
            <PerformanceChart />
            <div className="oai-analysis-stats">
              <KeyValue label="Examples" value="5" />
              <KeyValue label="Win rate" value="60%" />
              <KeyValue label="Average R" value="0.88R" />
            </div>
          </div>
        ) : (
          <div className="oai-empty">
            <FlaskConical size={38} />
            <h3>Define. Test. Refine.</h3>
            <p>
              Choose a hypothesis to preview the report layout, or open the
              existing backtesting tool.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
export type PreviewPreferences = {
  compact: boolean;
  news: boolean;
  motion: boolean;
};
export function SettingsPage({
  onConnected,
  preferences,
  onApply,
}: {
  onConnected: () => void;
  preferences: PreviewPreferences;
  onApply: (value: PreviewPreferences) => void;
}) {
  const [settings, setSettings] = useState(preferences);
  const [notice, setNotice] = useState("");
  return (
    <div className="oai-two-columns">
      <Panel
        title="Workspace Preferences"
        kicker="APPLIES TO THIS DESIGN SESSION ONLY"
      >
        <div className="oai-settings-list">
          {(
            [
              ["compact", "Compact information preference"],
              ["news", "Show news warnings preference"],
              ["motion", "Motion preference"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>
                <strong>{label}</strong>
                <small>Preview preference · not a server setting</small>
              </span>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => {
                  setSettings({ ...settings, [key]: e.target.checked });
                  setNotice("");
                }}
              />
            </label>
          ))}
        </div>
        <div className="oai-card-body">
          <AIButton
            primary
            onClick={() => {
              onApply(settings);
              setNotice(
                "Preferences kept for this open preview. No account settings were changed.",
              );
            }}
          >
            <Check size={16} />
            Apply preview preferences
          </AIButton>
          <p role="status" className="oai-muted">
            {notice}
          </p>
        </div>
      </Panel>
      <Panel title="Scanner Configuration" kicker="EXISTING CONNECTED SYSTEM">
        <div className="oai-card-body">
          <SlidersHorizontal size={28} className="oai-blue" />
          <h3>One app. One source of truth.</h3>
          <p className="oai-muted">
            Account selection, approved strategy rules and real provider
            settings remain in your existing scanner. This UI pass does not
            create duplicate configuration.
          </p>
          <AIButton onClick={onConnected}>
            Open real scanner settings <ArrowUpRight size={16} />
          </AIButton>
          <div className="oai-note">
            Live execution is disabled. No new backend functionality was added.
          </div>
        </div>
      </Panel>
    </div>
  );
}
