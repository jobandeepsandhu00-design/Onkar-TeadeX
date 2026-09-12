import { type CSSProperties, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { AIButton, DemoLabel } from "./ui";
import {
  AgentMotionLayer,
  AmbientCommandField,
} from "./motion";
import { AGENT_DEFINITIONS, type AgentDefinition } from "./agent-data";

type Props = {
  onNavigate: (path: string) => void;
};

export function AgentCommandCenter({ onNavigate }: Props) {
  const [selected, setSelected] = useState<AgentDefinition | null>(null);
  const reduceMotion = useReducedMotion();

  return (
    <section className="oai-agent-command" aria-labelledby="agent-network-title">
      <div className="oai-agent-command-head">
        <div>
          <DemoLabel />
          <h2 id="agent-network-title">Meet the Onkar AI agent network</h2>
          <p>
            One coordinated command center for market context, strategy, risk and
            trader improvement.
          </p>
        </div>
        <div className="oai-agent-network-state" aria-label="Agent interface preview">
          <span className="oai-agent-live-dot" />
          AGENT UI PREVIEW
        </div>
      </div>

      <div className="oai-agent-feature">
        <AmbientCommandField />
        <img
          src="/onkar-ai/agent-command-center.jpg"
          alt="Ten Onkar AI robotic agents assembled around a market command center"
        />
        <div className="oai-agent-feature-shade" />
        <motion.div
          className="oai-agent-feature-copy"
        >
          <span><BrainCircuit size={15} /> MASTER AI / ORCHESTRATION</span>
          <h3>Ten specialists. One disciplined intelligence system.</h3>
          <p>
            Explore each agent's responsibility, mission and workspace without
            changing the connected scanner underneath.
          </p>
          <AIButton primary onClick={() => setSelected(AGENT_DEFINITIONS[0])}>
            Open command agent <ArrowRight size={16} />
          </AIButton>
        </motion.div>
      </div>

      <div className="oai-agent-grid">
        {AGENT_DEFINITIONS.map((agent, index) => {
          const Icon = agent.icon;
          const motionStyle = { "--agent-delay": `${index * -0.37}s` } as CSSProperties;
          return (
            <motion.button
              type="button"
              key={agent.id}
              className={`oai-agent-card oai-agent-${agent.id}`}
              style={motionStyle}
              data-state={agent.visualState}
              aria-pressed={selected?.id === agent.id}
              onClick={() => setSelected(agent)}
              initial={reduceMotion ? false : { opacity: 0.78, y: 10 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: index * 0.035 }}
              whileHover={reduceMotion ? undefined : { y: -6, scale: 1.012 }}
              whileTap={reduceMotion ? undefined : { scale: 0.985 }}
            >
              <span className="oai-agent-portrait">
                <img src={agent.image} alt={`${agent.name} robotic avatar`} loading="lazy" />
                <AgentMotionLayer agent={agent.id} state={agent.visualState} />
                <span className="oai-agent-face-scan" aria-hidden="true" />
                <span className="oai-agent-orbit" aria-hidden="true" />
              </span>
              <span className="oai-agent-card-content">
                <span className="oai-agent-card-topline">
                  <span className="oai-agent-icon"><Icon size={15} /></span>
                  <span className="oai-agent-status"><i />{agent.status}</span>
                </span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
                <span className="oai-agent-output">{agent.output}</span>
                <span className="oai-agent-open">Inspect agent <ArrowRight size={14} /></span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <div className="oai-agent-signal-bus" aria-hidden="true">
        {AGENT_DEFINITIONS.map((agent) => <i key={agent.id} className={`oai-agent-${agent.id}`} />)}
        <span><BrainCircuit size={16} /></span>
      </div>

      <div className="oai-agent-preview-note">
        <Sparkles size={15} />
        Agent activity shown here is a visual preview. Use Connected System for
        live provider, worker and scanner health.
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className={`oai-agent-dialog ${selected ? `oai-agent-${selected.id}` : ""}`}>
          {selected && (
            <div className="oai-agent-detail">
              <div className="oai-agent-detail-visual">
                <img src={selected.image} alt={`${selected.name} full robotic portrait`} />
                <AgentMotionLayer agent={selected.id} state={selected.visualState} detail />
                <span className="oai-agent-face-scan" aria-hidden="true" />
                <div className="oai-agent-detail-status"><i />{selected.status}</div>
              </div>
              <div className="oai-agent-detail-copy">
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>{selected.role}</DialogDescription>
                <div className="oai-agent-mission">
                  <span>CURRENT MISSION</span>
                  <strong>{selected.mission}</strong>
                </div>
                <div className="oai-agent-detail-stats">
                  <div><span>Latest output</span><strong>{selected.output}</strong></div>
                  <div><span>System signal</span><strong>{selected.signal}</strong></div>
                </div>
                <div className="oai-agent-detail-actions">
                  <AIButton primary onClick={() => onNavigate(selected.destination)}>
                    Open workspace <ArrowRight size={16} />
                  </AIButton>
                  <button className="oai-text-button" onClick={() => setSelected(null)}>
                    Return to command center
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
