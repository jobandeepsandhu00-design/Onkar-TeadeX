import { type CSSProperties, memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  Clock3,
  RadioTower,
  Sparkles,
} from "lucide-react";
import {
  AGENT_DEFINITIONS,
  type AgentDefinition,
  type AgentId,
  type AgentRuntimeSnapshot,
} from "./agent-data";
import { AgentMotionLayer } from "./motion";

type ConnectionState = "connected" | "preview" | "offline";

type Props = {
  onNavigate: (path: string) => void;
  connectionState?: ConnectionState;
  runtime?: Partial<Record<AgentId, AgentRuntimeSnapshot>>;
};

const sampleActivity = [
  ["Trend AI", "XAUUSD 1H bias confirmed bullish", "18:24"],
  ["Zone AI", "Price approaching example demand zone", "18:23"],
  ["Setup AI", "Sample rule score increased to 91", "18:22"],
  ["News AI", "Example USD event window reviewed", "18:21"],
  ["Risk AI", "Sample risk validation passed", "18:20"],
] as const;

function stateLabel(
  agent: AgentDefinition,
  connectionState: ConnectionState,
  runtime?: AgentRuntimeSnapshot,
) {
  if (connectionState === "offline") return "Offline";
  if (connectionState !== "connected" || !runtime) return "Preview";
  return runtime.statusLabel;
}
const HomeAgentCard = memo(function HomeAgentCard({
  agent,
  connectionState,
  runtime,
  onNavigate,
  index,
}: {
  agent: AgentDefinition;
  connectionState: ConnectionState;
  runtime?: AgentRuntimeSnapshot;
  onNavigate: (path: string) => void;
  index: number;
}) {
  const reduceMotion = useReducedMotion();
  const Icon = agent.icon;
  const connected = connectionState === "connected" && Boolean(runtime);
  const primary = runtime?.primaryMetric || agent.primaryMetric;
  const secondary = runtime?.secondaryMetric || agent.secondaryMetric;

  return (
    <motion.button
      type="button"
      className={`oai-home-agent oai-agent-${agent.id}`}
      data-state={connected ? agent.visualState : connectionState === "offline" ? "disabled" : "idle"}
      onClick={() => onNavigate(agent.destination)}
      aria-label={`Open ${agent.name} in Onkar AI`}
      initial={reduceMotion ? false : { opacity: 0.76, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: index * 0.035 }}
      whileHover={reduceMotion ? undefined : { y: -3, rotateX: 1.2, rotateY: -1.5 }}
      whileTap={reduceMotion ? undefined : { scale: 0.975 }}
    >
      <span className="oai-home-agent-visual">
        <img
          src={agent.image}
          alt={`${agent.name} robotic avatar`}
          width="720"
          height="720"
          loading={index > 2 ? "lazy" : "eager"}
          decoding="async"
        />
        <AgentMotionLayer
          agent={agent.id}
          state={connected ? agent.visualState : connectionState === "offline" ? "disabled" : "idle"}
        />
        <span className="oai-home-agent-icon"><Icon size={13} /></span>
      </span>
      <span className="oai-home-agent-copy">
        <span className="oai-home-agent-heading">
          <strong>{agent.name}</strong>
          <i><b />{stateLabel(agent, connectionState, runtime)}</i>
        </span>
        <small>{agent.role}</small>
        <span className="oai-home-agent-metrics">
          <b>{connected ? primary : `Sample · ${primary}`}</b>
          <em>{secondary}</em>
        </span>
        <span className="oai-home-agent-open">Open <ChevronRight size={12} /></span>
      </span>
    </motion.button>
  );
});

export function OnkarAIAgentCommandCenter({
  onNavigate,
  connectionState = "preview",
  runtime = {},
}: Props) {
  const reduceMotion = useReducedMotion();
  const master = AGENT_DEFINITIONS[0];
  const specialists = AGENT_DEFINITIONS.slice(1);
  const connected = connectionState === "connected" && Boolean(runtime.master);
  const statusCopy = connected
    ? "Agent runtime connected"
    : connectionState === "offline"
      ? "Agent runtime offline"
      : "Awaiting verified agent data";

  return (
    <section className="oai-home-command" aria-labelledby="oai-home-command-title">
      <header className="oai-home-command-head">
        <div>
          <span><BrainCircuit size={14} /> ONKAR AI</span>
          <h2 id="oai-home-command-title">Multi-Agent Command Center</h2>
          <p>10 specialised AI agents working together.</p>
        </div>
        <span className={`oai-home-connection oai-home-${connectionState}`}>
          <i />{connected ? "LIVE" : connectionState === "offline" ? "OFFLINE" : "PREVIEW"}
        </span>
      </header>

      <div className="oai-home-data-notice">
        <RadioTower size={13} />
        <span>{statusCopy}</span>
        <b>{connected ? "10 / 10 online" : "No live status claimed"}</b>
      </div>

      <motion.article
        className="oai-home-master"
        data-state={connected ? master.visualState : connectionState === "offline" ? "disabled" : "idle"}
        initial={reduceMotion ? false : { opacity: 0.8, y: 10 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="oai-home-master-portrait">
          <img
            src={master.image}
            alt="Master AI robotic supervisor"
            width="720"
            height="720"
            decoding="async"
          />
          <AgentMotionLayer agent="master" state={connected ? master.visualState : "idle"} detail />
          <span className="oai-home-master-orbit" aria-hidden="true" />
        </div>
        <div className="oai-home-master-copy">
          <span className="oai-home-master-kicker"><Sparkles size={12} /> MASTER AI</span>
          <h3>Supervisor · Coordinates All Agents</h3>
          <div className="oai-home-master-grid">
            <span><small>Status</small><strong>{connected ? runtime.master?.statusLabel : "Preview"}</strong></span>
            <span><small>Market</small><strong>{runtime.master?.primaryMetric || "XAUUSD sample"}</strong></span>
            <span><small>Mission</small><strong>{runtime.master?.currentTask || "Evaluating example setups"}</strong></span>
            <span><small>Specialists</small><strong>{connected ? "9 / 9 online" : "9 available"}</strong></span>
          </div>
          <button type="button" onClick={() => onNavigate(master.destination)}>
            Open Master AI <ArrowRight size={14} />
          </button>
        </div>
      </motion.article>

      <div className="oai-home-specialist-heading">
        <div><strong>Specialist Network</strong><span>Swipe or tap an agent</span></div>
        <span>9 specialists</span>
      </div>

      <div className="oai-home-agent-strip" role="list" aria-label="Onkar AI specialist agents">
        {specialists.map((agent, index) => (
          <div role="listitem" key={agent.id}>
            <HomeAgentCard
              agent={agent}
              connectionState={connectionState}
              runtime={runtime[agent.id]}
              onNavigate={onNavigate}
              index={index}
            />
          </div>
        ))}
      </div>

      <div className="oai-home-support-grid">
        <section className="oai-home-activity" aria-labelledby="oai-home-activity-title">
          <header>
            <div><Clock3 size={13} /><h3 id="oai-home-activity-title">Agent Activity</h3></div>
            <span>{connected ? "LIVE" : "SAMPLE"}</span>
          </header>
          <div>
            {sampleActivity.slice(0, 3).map(([agent, activity, time]) => (
              <span key={agent}>
                <time>{time}</time><i /><strong>{agent}</strong><em>{activity}</em>
              </span>
            ))}
          </div>
        </section>

        <section className="oai-home-conclusion" aria-labelledby="oai-home-conclusion-title">
          <header><BrainCircuit size={14} /><h3 id="oai-home-conclusion-title">Master AI Conclusion</h3></header>
          <span className="oai-home-conclusion-label">{connected ? "VERIFIED OUTPUT" : "EXAMPLE OUTPUT"}</span>
          <div className="oai-home-conclusion-main">
            <div><strong>XAUUSD</strong><span>SRC Support Rejection</span></div>
            <b>91<small>/100</small></b>
          </div>
          <div className="oai-home-votes" aria-label="Example specialist agreement">
            {AGENT_DEFINITIONS.slice(1, 6).map((agent) => (
              <span key={agent.id}><Check size={10} />{agent.name.replace(" AI", "")}</span>
            ))}
          </div>
          <button type="button" onClick={() => onNavigate("/onkar-ai/setup/gold-rejection")}>
            View complete analysis <ArrowRight size={13} />
          </button>
        </section>
      </div>

      <button type="button" className="oai-home-open-full" onClick={() => onNavigate("/onkar-ai")}>
        <BrainCircuit size={17} />
        <span><strong>Open Full Onkar AI</strong><small>Scanner · agents · charts · journal</small></span>
        <ArrowRight size={17} />
      </button>
    </section>
  );
}
