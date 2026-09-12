import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Radar,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import {
  AIButton,
  AIScoreBadge,
  AIStatusBadge,
  KeyValue,
  Panel,
  SymbolMark,
} from "./ui";
import {
  demoEvents,
  demoSetups,
  price,
  setupPath,
  type SetupPreview,
} from "./demo-data";
import { PerformanceChart } from "./charts";
export function SetupTable({
  setups = demoSetups,
  onSelect,
  selectedId,
  compact = false,
}: {
  setups?: SetupPreview[];
  onSelect: (s: SetupPreview) => void;
  selectedId?: string;
  compact?: boolean;
}) {
  return (
    <div className="oai-table-wrap">
      <table className="oai-table">
        <thead>
          <tr>
            <th>Market / Setup</th>
            <th>Score</th>
            <th>Trend</th>
            {!compact && <th>Timeframe</th>}
            <th>Status</th>
            <th>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {setups.map((s) => (
            <tr key={s.id} className={selectedId === s.id ? "selected" : ""}>
              <td>
                <button className="oai-symbol-cell" onClick={() => onSelect(s)}>
                  <SymbolMark setup={s} />
                  <span>
                    <strong>{s.symbol}</strong>
                    <small>{s.name}</small>
                  </span>
                </button>
              </td>
              <td>
                <AIScoreBadge score={s.score} />
              </td>
              <td>
                <span
                  className={`oai-row ${s.direction === "Long" ? "oai-green" : "oai-red"}`}
                >
                  {s.direction === "Long" ? (
                    <ArrowUpRight size={15} />
                  ) : (
                    <ArrowDownRight size={15} />
                  )}
                  <span>{s.direction}</span>
                </span>
              </td>
              {!compact && <td>{s.timeframe}</td>}
              <td>
                <AIStatusBadge status={s.status} />
              </td>
              <td>
                <button
                  className="oai-icon-button"
                  aria-label={`Analyze ${s.symbol}`}
                  onClick={() => onSelect(s)}
                >
                  <ChevronRight size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!setups.length && (
        <div className="oai-empty">
          <Radar size={30} />
          <h3>No matching markets</h3>
          <p>Try another symbol, asset class or score filter.</p>
        </div>
      )}
    </div>
  );
}
export function SetupAnalysis({
  setup,
  onNavigate,
  onSave,
  saved,
  onJournal,
}: {
  setup: SetupPreview;
  onNavigate: (path: string) => void;
  onSave: () => void;
  saved: boolean;
  onJournal: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const checks = [
    "Higher-timeframe bias aligned",
    "Price at a key demand / supply zone",
    "Confirmation candle formed",
    "Volume above average",
    "Open range sufficient",
    "Risk / reward meets plan",
  ];
  return (
    <Panel
      title="AI Setup Analysis"
      kicker="EXPLAINABLE INTELLIGENCE"
      className="oai-analysis"
    >
      <div className="oai-analysis-top">
        <div>
          <AIStatusBadge status={setup.status} />
          <h3>{setup.name}</h3>
          <p>
            {setup.symbol} · {setup.timeframe} · {setup.direction}
          </p>
        </div>
        <AIScoreBadge score={setup.score} large />
      </div>
      <div className="oai-match">
        <span>Rule confluence</span>
        <strong>{setup.rules} / 10</strong>
        <div>
          <motion.i
            key={`${setup.id}-${setup.rules}`}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${setup.rules * 10}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>
      <ul className="oai-checklist">
        {checks.map((rule, i) => (
          <motion.li
            key={rule}
            className={i < setup.rules - 3 ? "passed" : "missing"}
            initial={reduceMotion ? false : { opacity: 0.45, x: -7 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.32, delay: reduceMotion ? 0 : i * 0.055 }}
          >
            {i < setup.rules - 3 ? <Check size={15} /> : <Clock3 size={15} />}
            <span>{rule}</span>
          </motion.li>
        ))}
      </ul>
      <div className="oai-analysis-stats">
        <KeyValue label="Sample R : R" value={`1 : ${setup.rr}`} />
        <KeyValue label="Direction" value={setup.direction} />
        <KeyValue label="Validation" value="Preview" />
      </div>
      <p className="oai-disclaimer">
        Illustrative analysis. Confluence is not a win probability. News safety
        has not been verified.
      </p>
      <AIButton primary onClick={() => onNavigate(setupPath(setup.id))}>
        View full analysis <ArrowUpRight size={16} />
      </AIButton>
      <div className="oai-row">
        <AIButton onClick={onSave}>
          <Star size={15} fill={saved ? "currentColor" : "none"} />
          {saved ? "Watching" : "Watch setup"}
        </AIButton>
        <AIButton onClick={onJournal}>
          Open journal <ExternalLink size={14} />
        </AIButton>
      </div>
    </Panel>
  );
}
export function SessionPanel() {
  return (
    <Panel
      title="Market Sessions"
      action={<span className="oai-muted">Sample · 12:12 UTC</span>}
    >
      <div className="oai-sessions">
        {[
          ["Tokyo", "00:00 – 09:00", "Closed", false],
          ["London", "08:00 – 17:00", "Open", true],
          ["New York", "13:00 – 22:00", "Pre-market", false],
          ["Sydney", "22:00 – 07:00", "Closed", false],
        ].map(([name, time, status, open]) => (
          <div key={String(name)} className={open ? "session-active" : ""}>
            <span className="oai-row">
              <span className="oai-dot" />
              {name}
            </span>
            <strong>{status}</strong>
            <small>{time} UTC</small>
            <div className="oai-session-track">
              <i style={{ width: open ? "56%" : "16%" }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
export function NewsPanel({
  full = false,
  onNavigate,
}: {
  full?: boolean;
  onNavigate?: (path: string) => void;
}) {
  const [impact, setImpact] = useState("All");
  const [currency, setCurrency] = useState("All");
  const events = demoEvents.filter(
    (e) =>
      (impact === "All" || e.impact === impact) &&
      (currency === "All" || e.currency === currency),
  );
  return (
    <Panel
      title="News & Economic Events"
      kicker="ILLUSTRATIVE CALENDAR"
      action={
        onNavigate ? (
          <button
            className="oai-text-button"
            onClick={() => onNavigate("/onkar-ai/news")}
          >
            Calendar <ArrowUpRight size={15} />
          </button>
        ) : undefined
      }
    >
      {full && (
        <div className="oai-filter-bar">
          <label>
            Impact
            <select value={impact} onChange={(e) => setImpact(e.target.value)}>
              {["All", "High", "Medium", "Low"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["All", "USD", "EUR", "GBP"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <span className="oai-muted">
            Sample schedule · not today’s calendar
          </span>
        </div>
      )}
      <div className="oai-table-wrap">
        <table className="oai-table">
          <thead>
            <tr>
              <th>UTC</th>
              <th>Currency</th>
              <th>Event</th>
              <th>Impact</th>
              {full && (
                <>
                  <th>Forecast</th>
                  <th>Previous</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {events.slice(0, full ? 10 : 3).map((e) => (
              <tr key={e.title}>
                <td>{e.time}</td>
                <td>
                  <span className="oai-currency">{e.currency}</span>
                </td>
                <td>{e.title}</td>
                <td>
                  <span
                    className={`oai-impact impact-${e.impact.toLowerCase()}`}
                  >
                    {e.impact}
                  </span>
                </td>
                {full && (
                  <>
                    <td>{e.forecast}</td>
                    <td>{e.previous}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && (
          <p className="oai-empty">No sample events match these filters.</p>
        )}
      </div>
    </Panel>
  );
}
export function IntegrationsPanel({
  full = false,
  onConnect,
}: {
  full?: boolean;
  onConnect: () => void;
}) {
  const names = [
    "Market data",
    "TradingView",
    "AI services",
    "Supabase",
    "Cloudflare R2",
    "MCP / Vision",
  ];
  return (
    <Panel
      title={full ? "Your connected ecosystem" : "System Status"}
      kicker="STATUS IS NEVER SIMULATED"
      action={<ShieldCheck size={18} className="oai-blue" />}
    >
      <div className={full ? "oai-integration-grid" : "oai-status-list"}>
        {names.map((name, i) => (
          <div key={name}>
            <span className="oai-row">
              <span className={`oai-dot ${i === 5 ? "oai-purple" : ""}`} />
              <strong>{name}</strong>
            </span>
            <span>{i === 5 ? "Optional" : "Not checked in preview"}</span>
            {full && (
              <p>
                Use the existing scanner’s Connections view to inspect actual
                availability. This design does not connect or modify providers.
              </p>
            )}
          </div>
        ))}
      </div>
      <button className="oai-text-button oai-panel-link" onClick={onConnect}>
        Open real connection status <ArrowUpRight size={15} />
      </button>
    </Panel>
  );
}
export function PerformancePanel({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  return (
    <Panel
      title="Process Performance"
      kicker="ILLUSTRATIVE JOURNAL"
      action={
        <button
          className="oai-icon-button"
          aria-label="Open analytics"
          onClick={() => onNavigate("/onkar-ai/analytics")}
        >
          <ArrowUpRight size={17} />
        </button>
      }
    >
      <div className="oai-performance-summary">
        <strong>
          +4.4<small> R</small>
        </strong>
        <span className="oai-green">Across 5 sample trades</span>
      </div>
      <PerformanceChart />
      <div className="oai-analysis-stats">
        <KeyValue label="Win rate" value="60%" />
        <KeyValue label="Average R" value="0.88R" />
        <KeyValue label="Profit factor" value="3.2" />
      </div>
    </Panel>
  );
}
export function AlertsPanel({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Panel
      title="Recent Alerts"
      action={<span className="oai-muted">Sample activity</span>}
    >
      <div className="oai-alert-list">
        {[
          [
            "Ready for review",
            "XAUUSD · SRC Support Rejection",
            "2m",
            setupPath("gold-rejection"),
            "green",
          ],
          [
            "Entry zone approaching",
            "NAS100 · Breakout Retest",
            "6m",
            setupPath("nas-retest"),
            "blue",
          ],
          [
            "High-impact event ahead",
            "US CPI · USD exposure",
            "12m",
            "/onkar-ai/news",
            "gold",
          ],
          [
            "Setup invalidated",
            "AUDUSD · Support lost",
            "24m",
            setupPath("aud-invalid"),
            "red",
          ],
        ].map(([title, detail, time, path, tone], index) => (
          <motion.button
            key={title}
            onClick={() => onNavigate(path)}
            initial={reduceMotion ? false : { opacity: 0.6, x: 7 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.34, delay: reduceMotion ? 0 : index * 0.06 }}
            whileHover={reduceMotion ? undefined : { x: 3 }}
            whileTap={reduceMotion ? undefined : { scale: 0.99 }}
          >
            <span className={`oai-dot oai-${tone}`} />
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <time>{time}</time>
          </motion.button>
        ))}
      </div>
    </Panel>
  );
}
