import { memo, type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import {
  BookOpenCheck,
  History,
  Lightbulb,
  Network,
  Radio,
  ShieldCheck,
} from "lucide-react";

export type AgentVisualState =
  | "idle"
  | "active"
  | "scanning"
  | "thinking"
  | "speaking"
  | "alert"
  | "success"
  | "offline"
  | "disabled";

export type AgentMotionId =
  | "master"
  | "trend"
  | "zone"
  | "setup"
  | "risk"
  | "news"
  | "backtest"
  | "journal"
  | "insight"
  | "execution";

const motifIcons = {
  risk: ShieldCheck,
  news: Radio,
  backtest: History,
  journal: BookOpenCheck,
  insight: Lightbulb,
  execution: Network,
} as const;

export const AgentMotionLayer = memo(function AgentMotionLayer({
  agent,
  state,
  detail = false,
}: {
  agent: AgentMotionId;
  state: AgentVisualState;
  detail?: boolean;
}) {
  const MotifIcon = motifIcons[agent as keyof typeof motifIcons];

  return (
    <span
      className={`oai-agent-motion ${detail ? "oai-agent-motion-detail" : ""}`}
      data-agent={agent}
      data-state={state}
      aria-hidden="true"
    >
      <span className="oai-agent-aura" />
      <span className="oai-agent-platform" />
      <span className="oai-agent-ring oai-agent-ring-one" />
      <span className="oai-agent-ring oai-agent-ring-two" />
      <span className="oai-agent-energy-lines">
        <i /><i /><i />
      </span>
      {(agent === "master" || agent === "trend" || agent === "execution") && (
        <span className="oai-agent-signal-path">
          <svg viewBox="0 0 120 48" preserveAspectRatio="none">
            <path d="M2 37 C19 37 20 15 39 22 S65 39 78 18 S103 10 118 4" />
            <circle cx="39" cy="22" r="2" />
            <circle cx="78" cy="18" r="2" />
            <circle cx="118" cy="4" r="2" />
          </svg>
        </span>
      )}
      {agent === "zone" && (
        <span className="oai-agent-zone-scan"><i /><i /><i /></span>
      )}
      {agent === "setup" && (
        <span className="oai-agent-rule-nodes"><i /><i /><i /><i /></span>
      )}
      {MotifIcon && (
        <span className="oai-agent-motif"><MotifIcon size={detail ? 30 : 20} /></span>
      )}
    </span>
  );
});

export const AmbientCommandField = memo(function AmbientCommandField() {
  const particles = [
    [8, 22],
    [19, 58],
    [31, 34],
    [43, 72],
    [55, 18],
    [66, 52],
    [76, 29],
    [86, 66],
    [94, 40],
  ] as const;

  return (
    <div className="oai-command-ambient" aria-hidden="true">
      {particles.map(([left, top], index) => (
        <i
          key={index}
          style={{
            "--particle-left": `${left}%`,
            "--particle-top": `${top}%`,
            "--particle-duration": `${5.5 + index * 0.28}s`,
            "--particle-delay": `${index * -0.44}s`,
          } as CSSProperties}
        />
      ))}
      <span className="oai-command-radar" />
      <span className="oai-command-waveform"><b /><b /><b /><b /><b /></span>
    </div>
  );
});

export function MotionReveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0.72, y: 9 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.48, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedMetricValue({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    const match = value.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/);
    if (!element || !match || reduceMotion) {
      if (element) element.textContent = value;
      return;
    }

    const [, prefix, rawNumber, suffix] = match;
    const target = Number(rawNumber);
    const decimals = rawNumber.includes(".") ? rawNumber.split(".")[1].length : 0;
    const leadingZero = rawNumber.length > 1 && rawNumber.startsWith("0");
    const controls = animate(0, target, {
      duration: 1.15,
      delay: 0.14,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(latest) {
        const formatted = decimals
          ? latest.toFixed(decimals)
          : Math.round(latest).toString().padStart(leadingZero ? rawNumber.length : 1, "0");
        element.textContent = `${prefix}${formatted}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [reduceMotion, value]);

  return <span ref={ref}>{value}</span>;
}
