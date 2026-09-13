import { AGENT_DEFINITIONS, type AgentId } from "./agent-data";
import { AnimatedAgentAvatar } from "./AnimatedAgentAvatar";
import { useAgentAnimationState } from "./useAgentAnimationState";

const roleForPage: Record<string, AgentId> = {
  scanner: "trend",
  markets: "trend",
  watchlist: "trend",
  charts: "zone",
  setups: "setup",
  strategies: "setup",
  risk: "risk",
  news: "news",
  backtesting: "backtest",
  journal: "journal",
  integrations: "execution",
};
export function AgentWorkspacePresence({ section }: { section: string }) {
  const id = roleForPage[section];
  return id ? <Presence key={id} id={id} /> : null;
}
function Presence({ id }: { id: AgentId }) {
  const agent = AGENT_DEFINITIONS.find((item) => item.id === id)!;
  const runtime = useAgentAnimationState(id);
  return (
    <div className={`oai-assistant-agent-presence oai-agent-${id}`}>
      <AnimatedAgentAvatar
        agentId={id}
        image={agent.image}
        alt={`${agent.name} animated robot`}
        quality="full"
      />
      <div>
        <strong>{agent.name}</strong>
        <small>
          {agent.role} · {runtime.statusLabel}
        </small>
      </div>
    </div>
  );
}
