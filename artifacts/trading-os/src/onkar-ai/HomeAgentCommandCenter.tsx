import { type CSSProperties, memo } from "react";
import { motion } from "framer-motion";
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
import { AnimatedAgentAvatar, type AgentAvatarState } from "./AnimatedAgentAvatar";
import { useAgentAnimationState, useReducedMotionPreference } from "./useAgentAnimationState";
import { AgentVoiceControls } from "./AgentVoiceControls";
import type { SetupPreview } from "./demo-data";
import type { ConnectedAgentActivity } from "./connected-intelligence";

type ConnectionState = "connected" | "preview" | "offline";

type Props = {
  onNavigate: (path: string) => void;
  connectionState?: ConnectionState;
  runtime?: Partial<Record<AgentId, AgentRuntimeSnapshot>>;
  activity?: ConnectedAgentActivity[];
  topSetup?: SetupPreview | null;
};

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
  const reduceMotion = useReducedMotionPreference();
  const animation = useAgentAnimationState(agent.id);
  const Icon = agent.icon;
  const connected = connectionState === "connected" && Boolean(runtime);
  const primary = runtime?.primaryMetric || "Awaiting verified data";
  const secondary = runtime?.secondaryMetric || "—";
  const avatarState: AgentAvatarState = connected
    ? runtime?.state ?? agent.visualState
    : connectionState === "offline"
      ? "offline"
      : "idle";

  return (
    <motion.button
      type="button"
      className={`oai-home-agent oai-agent-${agent.id}`}
      data-state={avatarState}
      onClick={() => onNavigate(agent.destination)}
      aria-label={`Open ${agent.name} in Onkar AI`}
      initial={reduceMotion ? false : { opacity: 0.76, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: index * 0.035 }}
      whileHover={reduceMotion ? undefined : { y: -3, rotateX: 1.2, rotateY: -1.5 }}
      whileTap={reduceMotion ? undefined : { scale: 0.975 }}
    >
      <AnimatedAgentAvatar
        className="oai-home-agent-visual"
        agentId={agent.id}
        state={avatarState}
        image={agent.image}
        alt={`${agent.name} robotic avatar`}
        quality="card"
        loading={index > 2 ? "lazy" : "eager"}
      >
        <span className="oai-home-agent-icon"><Icon size={13} /></span>
      </AnimatedAgentAvatar>
      <span className="oai-home-agent-copy">
        <span className="oai-home-agent-heading">
          <strong>{agent.name}</strong>
          <i><b />{animation.confirmed || animation.isSpeaking || animation.isWorking ? animation.statusLabel : stateLabel(agent, connectionState, runtime)}</i>
        </span>
        <small>{agent.role}</small>
        <span className="oai-home-agent-metrics">
          <b>{connected ? primary : "Awaiting verified data"}</b>
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
  activity = [],
  topSetup = null,
}: Props) {
  const reduceMotion = useReducedMotionPreference();
  const animation = useAgentAnimationState("master");
  const master = AGENT_DEFINITIONS[0];
  const specialists = AGENT_DEFINITIONS.slice(1);
  const connected = connectionState === "connected" && Boolean(runtime.master);
  const masterState: AgentAvatarState = connected
    ? runtime.master?.state ?? master.visualState
    : connectionState === "offline"
      ? "offline"
      : "idle";
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
        <b>{connected ? "Per-agent status below" : "No live status claimed"}</b>
      </div>

      <motion.article
        className="oai-home-master"
        data-state={masterState}
        initial={reduceMotion ? false : { opacity: 0.8, y: 10 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
      >
        <AnimatedAgentAvatar
          className="oai-home-master-portrait"
          agentId="master"
          state={masterState}
          image={master.image}
          alt="Master AI robotic supervisor"
          quality="featured"
          loading="eager"
        >
          <span className="oai-home-master-orbit" aria-hidden="true" />
        </AnimatedAgentAvatar>
        <div className="oai-home-master-copy">
          <span className="oai-home-master-kicker"><Sparkles size={12} /> MASTER AI</span>
          <h3>Supervisor · Coordinates All Agents</h3>
          <div className="oai-home-master-grid">
            <span><small>Status</small><strong>{animation.confirmed || animation.isSpeaking || animation.isWorking ? animation.statusLabel : connected ? runtime.master?.statusLabel : "Preview"}</strong></span>
            <span><small>Market</small><strong>{runtime.master?.primaryMetric || "Awaiting candidate"}</strong></span>
            <span><small>Mission</small><strong>{runtime.master?.currentTask || "Waiting for verified scanner data"}</strong></span>
            <span><small>Specialists</small><strong>9 available roles</strong></span>
          </div>
          <button type="button" onClick={() => onNavigate(master.destination)}>
            Open Master AI <ArrowRight size={14} />
          </button>
          <AgentVoiceControls agent="master" text="I am Master AI. I coordinate the Onkar AI specialists. Open my workspace to ask about your recorded trades, strategy rules, and available market evidence." label="Hear Master AI" />
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
            <span>{connected ? "LIVE" : "AWAITING DATA"}</span>
          </header>
          <div>
            {activity.slice(0, 3).map((event) => (
              <span key={event.id}>
                <time>{event.time}</time><i /><strong>{event.agent}</strong><em>{event.activity}</em>
              </span>
            ))}
            {!activity.length && (
              <p className="oai-home-live-empty">No verified agent activity yet.</p>
            )}
          </div>
        </section>

        <section className="oai-home-conclusion" aria-labelledby="oai-home-conclusion-title">
          <header><BrainCircuit size={14} /><h3 id="oai-home-conclusion-title">Master AI Conclusion</h3></header>
          <span className="oai-home-conclusion-label">
            {topSetup ? "LATEST VERIFIED CANDIDATE" : "AWAITING CANDIDATE"}
          </span>
          <div className="oai-home-conclusion-main">
            <div><strong>{topSetup?.symbol ?? "No active setup"}</strong><span>{topSetup?.name ?? "Scanner has not produced a verified candidate"}</span></div>
            <b>{topSetup?.score ?? "—"}{topSetup ? <small>/100</small> : null}</b>
          </div>
          {topSetup ? (
            <>
              <div className="oai-home-votes" aria-label="Verified specialist evidence">
                {AGENT_DEFINITIONS.slice(1, 6).map((agent) => (
                  <span key={agent.id}><Check size={10} />{agent.name.replace(" AI", "")}</span>
                ))}
              </div>
              <button type="button" onClick={() => onNavigate(`/onkar-ai/setup/${encodeURIComponent(topSetup.id)}`)}>
                View complete analysis <ArrowRight size={13} />
              </button>
            </>
          ) : (
            <p className="oai-home-live-empty">Approved setups will appear here after real closed-candle evidence passes the candidate threshold.</p>
          )}
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
