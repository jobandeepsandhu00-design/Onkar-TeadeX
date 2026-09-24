import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  FlaskConical,
  MessageSquare,
  Power,
  Save,
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
import { brainRequest, masterAIRequest } from "../market-brain/api";
import type { MasterAIResponse, ScannerSnapshot } from "@workspace/api-zod";
import { agentRuntime } from "./agent-runtime";
import { agentVoice } from "./agent-voice";
import { useAgentAnimationState } from "./useAgentAnimationState";
import { AnimatedAgentAvatar } from "./AnimatedAgentAvatar";
import { AgentVoiceControls } from "./AgentVoiceControls";
import { useNotificationInbox } from "../notifications/NotificationCenter";
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
  const [openAIHealth, setOpenAIHealth] = useState<{
    status: string;
    model: string;
    message: string;
  } | null>(null);
  const [checkingOpenAI, setCheckingOpenAI] = useState(false);
  const notificationInbox = useNotificationInbox();
  const alertContextSent = useRef(false);
  const speaker = "master" as const;
  const animation = useAgentAnimationState(speaker);
  const request = useRef<{ token: string; abort: AbortController } | null>(
    null,
  );
  const [events, setEvents] = useState<
    { agent: string; state: string; timestamp: string }[]
  >([]);
  useEffect(
    () => () => {
      if (request.current) {
        request.current.abort.abort();
        agentRuntime.fail(request.current.token, "Request cancelled");
        request.current = null;
      }
      agentRuntime.listen("master", false);
    },
    [],
  );
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<MasterAIResponse | null>(null);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const prompts = [
    "Analyze XAUUSD right now and explain the exact setup and execution blockers",
    "Analyze GBPJPY right now and explain the exact setup and execution blockers",
    "Analyze my trading performance",
    "What is my biggest recorded mistake?",
    "Which setup works best for me?",
    "Why did my last trade lose?",
  ];
  const checkOpenAI = async () => {
    setCheckingOpenAI(true);
    try {
      setOpenAIHealth(await brainRequest<{
        status: string;
        model: string;
        message: string;
      }>("/openai-health"));
    } catch (cause) {
      setOpenAIHealth({
        status: "unavailable",
        model: "—",
        message: cause instanceof Error ? cause.message : "Connection check failed.",
      });
    } finally {
      setCheckingOpenAI(false);
    }
  };
  const send = async (input: string) => {
    if (input.trim().length < 3 || request.current) return;
    const token = crypto.randomUUID(),
      abort = new AbortController();
    request.current = { token, abort };
    agentVoice.stop();
    agentRuntime.begin(token);
    setEvents([]);
    const q = input.trim();
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    setError("");
    setLoading(true);
    try {
      const result = await masterAIRequest(
        { question: q, deepAnalysis: false },
        AbortSignal.any([abort.signal, AbortSignal.timeout(55_000)]),
        (event) => {
          if (abort.signal.aborted) return;
          agentRuntime.event(token, event.agent, event.state);
          setEvents((items) => [...items.slice(-39), event]);
        },
      );
      if (abort.signal.aborted) return;
      setLastRun(result);
      setMessages((m) => [...m, { role: "assistant", text: result.answer }]);
      // Uncalled agents remain Preview; a returned report is not a permanent live connection.
      for (const agent of result.agents)
        agentRuntime.event(
          token,
          agent.agent,
          agent.status === "complete"
            ? "success"
            : agent.status === "unavailable"
              ? "unavailable"
              : "warning",
        );
      agentRuntime.finish(token);
      agentVoice.speak(speaker, result.answer, true);
    } catch (cause) {
      if (abort.signal.aborted) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Master AI is temporarily unavailable.",
      );
      agentRuntime.fail(token, "Analysis unavailable");
    } finally {
      if (request.current?.token === token) {
        request.current = null;
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    const ids = new URLSearchParams(window.location.search).get("alerts")?.split(",").filter(Boolean) ?? [];
    if (!ids.length || alertContextSent.current || notificationInbox.loading) return;
    const selected = notificationInbox.items.filter((item) => ids.includes(item.id));
    if (!selected.length) return;
    alertContextSent.current = true;
    const context = selected.map((item) => ({
      title: item.title,
      message: item.message,
      priority: item.priority,
      lifecycle: item.lifecycle_state,
      symbol: item.symbol,
      timeframe: item.timeframe,
      evidence: item.evidence,
      recommendedAction: item.recommended_action,
    }));
    void send(`Review these current authenticated notification threads and tell me what needs attention first. Do not invent missing data. Alert context: ${JSON.stringify(context)}`);
  }, [notificationInbox.loading, notificationInbox.items]);
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
          disabled={loading}
          onClick={() => {
            agentVoice.stop();
            setMessages([]);
            setLastRun(null);
            setEvents([]);
          }}
        >
          Clear conversation
        </button>
        <button
          className="oai-text-button oai-panel-link"
          onClick={() => onNavigate("/onkar-ai/connected")}
        >
          Open connected analysis
        </button>
        <button
          className="oai-text-button oai-panel-link"
          disabled={checkingOpenAI}
          onClick={() => void checkOpenAI()}
        >
          {checkingOpenAI ? "Checking OpenAI…" : "Check OpenAI API connection"}
        </button>
        {openAIHealth && (
          <div className="oai-note" role="status">
            OpenAI: {openAIHealth.status} · {openAIHealth.model}.{" "}
            {openAIHealth.message}
          </div>
        )}
      </Panel>
      <Panel
        title="Your market thinking partner"
        kicker="AUTHENTICATED · EVIDENCE-BASED"
        className="oai-chat-panel"
      >
        <div className={`oai-assistant-agent-presence oai-agent-${speaker}`}>
          <AnimatedAgentAvatar
            agentId={speaker}
            image={`/onkar-ai/agents/${speaker}.jpg`}
            alt={`${speaker} AI animated robot`}
            quality="preview"
          />
          <div>
            <strong>Master AI voice</strong>
            <small>{animation.statusLabel}</small>
            <small>
              Specialist agents report silently. Only Master AI can speak.
            </small>
          </div>
        </div>
        <div className="oai-chat-messages" aria-live="polite">
          {!messages.length ? (
            <div className="oai-chat-welcome">
              <Sparkles size={35} />
              <h3>Clarity starts with a better question.</h3>
              <p>
                Ask about your real journal, approved strategies and available
                scanner evidence.
              </p>
              <small>
                Master AI never invents missing market or journal data.
              </small>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`oai-chat-message ${m.role}`}>
                <small>{m.role === "user" ? "You" : "Master AI"}</small>
                <p>{m.text}</p>
              </div>
            ))
          )}
          {loading && (
            <div className="oai-chat-message assistant">
              <small>Master AI · thinking</small>
              <p>Retrieving the minimum relevant evidence…</p>
            </div>
          )}
          {error && (
            <div className="oai-note" role="alert">
              {error}
            </div>
          )}
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
            onFocus={() => agentRuntime.listen(speaker, true)}
            onBlur={() => agentRuntime.listen(speaker, false)}
            maxLength={1000}
            aria-label="Ask Onkar AI"
            placeholder="Ask about your trading…"
          />
          <button
            disabled={question.trim().length < 3 || loading}
            aria-label="Ask Master AI"
          >
            <Send size={19} />
          </button>
        </form>
        <AgentVoiceControls
          agent={speaker}
          text={lastRun?.answer ?? ""}
          label="Read response aloud"
        />
        {loading && events.length > 0 && (
          <div className="oai-command-log" aria-label="Live operational events">
            {events.slice(-5).map((event, index) => (
              <div key={`${event.timestamp}-${index}`}>
                <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                <strong>{event.agent} AI</strong>
                <span>{event.state}</span>
              </div>
            ))}
          </div>
        )}
        {lastRun && (
          <div className="oai-model-usage" role="status">
            {lastRun.usage.model
              ? `OpenAI response received · ${lastRun.usage.model} · ${lastRun.usage.inputTokens} input / ${lastRun.usage.outputTokens} output tokens. Specialist reviews are advisory; scanner and Risk AI retain execution authority.`
              : "OpenAI did not return a response. The report uses stored deterministic evidence only; no trade was authorized by AI."}
          </div>
        )}
        {lastRun && (
          <details className="oai-specialist-reviews">
            <summary>Agent evidence and OpenAI interpretation · {lastRun.agents.length} agents</summary>
            <div className="oai-specialist-review-list">
              {lastRun.agents.map((agent) => {
                const interpretation = agent.result.aiInterpretation;
                return (
                  <article key={agent.agent}>
                    <div>
                      <strong>{agent.agent.toUpperCase()} AI</strong>
                      <span>{agent.dataStatus}</span>
                    </div>
                    {typeof interpretation === "string" ? (
                      <p>{interpretation}</p>
                    ) : agent.agent === "insight" && lastRun.usage.model ? (
                      <p>Synthesized the Master AI answer above using one shared model call.</p>
                    ) : (
                      <p>No model interpretation returned for this agent.</p>
                    )}
                    <small>
                      {agent.missingData.length
                        ? `Missing: ${agent.missingData.join(", ")}`
                        : `Evidence: ${agent.source.join(", ") || "none"}`}
                    </small>
                  </article>
                );
              })}
            </div>
          </details>
        )}
        {lastRun && (
          <details className="oai-command-log">
            <summary>
              Command log · {lastRun.agents.length} agent results ·{" "}
              {lastRun.dataStatus}
            </summary>
            {lastRun.commandLog.map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`}>
                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                <strong>
                  {entry.source} → {entry.target}
                </strong>
                <span>{entry.summary}</span>
              </div>
            ))}
          </details>
        )}
      </Panel>
    </div>
  );
}
export function RiskPage({
  snapshot,
  onRefresh,
  onOpenScanner,
}: {
  snapshot: ScannerSnapshot | null;
  onRefresh: () => Promise<void>;
  onOpenScanner: () => void;
}) {
  const config = snapshot?.config?.config;
  const [riskPercent, setRiskPercent] = useState("");
  const [maxDailyLoss, setMaxDailyLoss] = useState("");
  const [maxOpenPositions, setMaxOpenPositions] = useState("");
  const [minimumRR, setMinimumRR] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!config) return;
    setRiskPercent(String(config.risk.riskPercent));
    setMaxDailyLoss(String(config.risk.maxDailyLossPercent));
    setMaxOpenPositions(String(config.risk.maxOpenPositions));
    setMinimumRR(String(config.risk.minimumRR));
  }, [config]);
  if (!snapshot || !config) {
    return <div className="oai-empty">Loading connected Risk AI…</div>;
  }
  const account = snapshot.accounts.find(
    (item) => item.id === config.accountId,
  );
  const permissions = config.permissions;
  const sourcePermission =
    snapshot.runtime.tradingSource === "TWELVE_DATA"
      ? permissions.paperTradeExecution
      : permissions.mt5LiveExecution;
  const riskRulesActive =
    permissions.automaticRiskCalculation &&
    permissions.automaticOrderPreparation;
  const executionWorkerReady = snapshot.connection.executionWorker === "ready";
  const armed =
    snapshot.runtime.tradingMode === "AUTO" &&
    snapshot.runtime.autoExecutionEnabled &&
    !snapshot.runtime.emergencyStop;
  const paperSource = snapshot.runtime.tradingSource === "TWELVE_DATA";
  const canArm =
    paperSource &&
    Boolean(account) &&
    riskRulesActive &&
    sourcePermission &&
    executionWorkerReady &&
    !snapshot.runtime.emergencyStop;
  const candidate = [...snapshot.candidates]
    .filter((item) => !item.staleNow)
    .sort((a, b) => b.score - a.score)[0];
  const riskDraft = () => ({
    ...config.risk,
    riskPercent: Number(riskPercent),
    maxDailyLossPercent: Number(maxDailyLoss),
    maxOpenPositions: Number(maxOpenPositions),
    minimumRR: Number(minimumRR),
    // Legacy manual values remain available only for unsupported custom
    // instruments. FX, gold and MT5 broker symbols are resolved server-side.
    valuePerPriceUnit: config.risk.valuePerPriceUnit,
  });
  const saveRisk = async () => {
    setBusy(true);
    setMessage("");
    try {
      await brainRequest("/config", "PUT", { ...config, risk: riskDraft() });
      await onRefresh();
      setMessage(
        "Risk profile saved. Risk AI will use these limits on the next scan.",
      );
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Risk profile could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const armPaperAuto = async () => {
    setBusy(true);
    setMessage("");
    try {
      await brainRequest("/config", "PUT", { ...config, risk: riskDraft() });
      await brainRequest("/runtime", "PUT", {
        scannerState:
          snapshot.runtime.scannerState === "STOPPED"
            ? "RUNNING"
            : snapshot.runtime.scannerState,
        tradingMode: "AUTO",
        tradingSource: snapshot.runtime.tradingSource,
        mt5DisconnectBehavior: snapshot.runtime.mt5DisconnectBehavior,
        autoReturnMt5: snapshot.runtime.autoReturnMt5,
        autoStart: true,
        autoExecutionEnabled: true,
      });
      await onRefresh();
      setMessage(
        "Twelve Data Paper AUTO is armed. Risk AI keeps final veto authority.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "AUTO execution could not be armed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="oai-two-columns">
      <Panel title="Live Risk Profile" kicker="CONNECTED RISK AI">
        <div className="oai-risk-runtime">
          <span className={riskRulesActive ? "is-ready" : "is-blocked"}>
            <i /> Risk AI {riskRulesActive ? "ACTIVE" : "BLOCKED"}
          </span>
          <strong>{account?.name ?? "No risk account selected"}</strong>
          <small>
            {account
              ? `${account.currency} · ${account.balance == null ? "Balance unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: account.currency }).format(account.balance)}`
              : "Select an account in Scanner Settings"}
          </small>
        </div>
        <div className="oai-form-grid">
          <label>
            Risk per trade (%)
            <input
              type="number"
              min="0.01"
              max="5"
              step="0.01"
              value={riskPercent}
              onChange={(event) => setRiskPercent(event.target.value)}
            />
          </label>
          <label>
            Maximum daily loss (%)
            <input
              type="number"
              min="0.01"
              max="20"
              step="0.01"
              value={maxDailyLoss}
              onChange={(event) => setMaxDailyLoss(event.target.value)}
            />
          </label>
          <label>
            Maximum open positions
            <input
              type="number"
              min="1"
              max="20"
              step="1"
              value={maxOpenPositions}
              onChange={(event) => setMaxOpenPositions(event.target.value)}
            />
          </label>
          <label>
            Minimum R:R
            <input
              type="number"
              min="1"
              max="10"
              step="0.1"
              value={minimumRR}
              onChange={(event) => setMinimumRR(event.target.value)}
            />
          </label>
        </div>
        <div className="oai-risk-instruments">
          <div>
            <strong>Automatic instrument sizing</strong>
            <span>Twelve Data prices + live account-currency conversion</span>
          </div>
          {config.symbols.map((symbol) => (
            <div className="oai-risk-instrument-auto" key={symbol}>
              <span>
                {symbol}
                <small>
                  {symbol === "XAUUSD"
                    ? "100 oz Onkar Paper contract"
                    : "100,000 base-currency FX contract"}
                </small>
              </span>
              <strong>AUTO</strong>
            </div>
          ))}
        </div>
        <button
          className="oai-risk-action"
          disabled={busy}
          onClick={() => void saveRisk()}
        >
          <Save size={17} /> Save risk profile
        </button>
        <div className="oai-note">
          Values are saved to the real scanner profile. Risk AI cannot increase
          these limits by itself.
        </div>
      </Panel>
      <Panel
        title="Execution Readiness"
        action={<Shield className="oai-blue" size={22} />}
      >
        <div className="oai-risk-total">
          <span>ORDER EXECUTION</span>
          <strong className={armed ? "is-live" : ""}>
            {armed ? "AUTO ARMED" : "NOT ARMED"}
          </strong>
          <small>
            {snapshot.runtime.tradingSource.replace("_", " ")} ·{" "}
            {paperSource ? "Paper execution" : "MT5 broker execution"}
          </small>
        </div>
        <div className="oai-risk-checks">
          {[
            ["Selected account", Boolean(account), account?.name ?? "Required"],
            [
              "Risk calculation",
              permissions.automaticRiskCalculation,
              permissions.automaticRiskCalculation
                ? "Enabled"
                : "Permission disabled",
            ],
            [
              "Order preparation",
              permissions.automaticOrderPreparation,
              permissions.automaticOrderPreparation
                ? "Enabled"
                : "Permission disabled",
            ],
            [
              paperSource ? "Paper execution" : "MT5 live execution",
              sourcePermission,
              sourcePermission ? "Permitted" : "Permission disabled",
            ],
            [
              "Execution worker",
              executionWorkerReady,
              snapshot.connection.executionReason ??
                snapshot.connection.executionWorker,
            ],
            [
              "Instrument sizing",
              true,
              paperSource
                ? "Automatic Paper contract + live FX conversion"
                : "Connected MT5 broker specification",
            ],
          ].map(([label, pass, detail]) => (
            <div className={pass ? "is-pass" : "is-fail"} key={String(label)}>
              {pass ? <Check size={16} /> : <AlertTriangle size={16} />}
              <span>
                <strong>{String(label)}</strong>
                <small>{String(detail)}</small>
              </span>
            </div>
          ))}
        </div>
        {candidate?.plan && (
          <div className="oai-card-body oai-risk-candidate">
            <strong>
              {candidate.symbol} · {candidate.payload.strategyName}
            </strong>
            <KeyValue
              label="Risk decision"
              value={candidate.plan.allowed ? "PASS" : "BLOCKED"}
            />
            <KeyValue
              label="Position size"
              value={
                candidate.plan.positionSize == null
                  ? "Pending"
                  : `${candidate.plan.positionSize} lots`
              }
            />
            <KeyValue
              label="Loss at SL"
              value={
                candidate.plan.estimatedLossAtStop == null ||
                !candidate.plan.currency
                  ? "Pending"
                  : new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: candidate.plan.currency,
                    }).format(candidate.plan.estimatedLossAtStop)
              }
            />
            <KeyValue
              label="Sizing source"
              value={
                candidate.plan.sizingSource?.replaceAll("_", " ") ?? "Pending"
              }
            />
            <small>
              {candidate.plan.warnings[0] ??
                `${candidate.plan.riskPercent}% · ${candidate.plan.rr.toFixed(2)}R`}
            </small>
          </div>
        )}
        {paperSource ? (
          <button
            className="oai-risk-action is-arm"
            disabled={busy || armed || !canArm}
            onClick={() => void armPaperAuto()}
          >
            <Power size={17} />{" "}
            {armed ? "Paper AUTO is armed" : "Arm Twelve Data Paper AUTO"}
          </button>
        ) : (
          <button className="oai-risk-action" onClick={onOpenScanner}>
            <Power size={17} /> Manage MT5 execution controls
          </button>
        )}
        {message && (
          <div className="oai-note" role="status">
            {message}
          </div>
        )}
        {!armed && !canArm && (
          <div className="oai-note">
            Resolve every failed readiness check above before AUTO can be armed.
            Risk AI will never bypass a missing safety input.
          </div>
        )}
        {armed && (
          <div className="oai-note">
            Execution is active. Trades still require a fresh closed-candle
            setup, approved AUTO rule, valid sizing, news clearance, minimum R:R
            and duplicate protection.
          </div>
        )}
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
