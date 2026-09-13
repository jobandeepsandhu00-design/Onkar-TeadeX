import type { LucideIcon } from "lucide-react";
import {
  BookOpenCheck,
  Crown,
  GitBranch,
  History,
  Lightbulb,
  Network,
  Radio,
  ScanLine,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { AgentVisualState } from "./motion";

export type AgentId =
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

export type AgentDefinition = {
  id: AgentId;
  name: string;
  role: string;
  status: string;
  mission: string;
  output: string;
  signal: string;
  image: string;
  icon: LucideIcon;
  destination: string;
  visualState: AgentVisualState;
  primaryMetric: string;
  secondaryMetric: string;
};

export type AgentRuntimeState =
  | "idle"
  | "active"
  | "scanning"
  | "thinking"
  | "speaking"
  | "monitoring"
  | "alert"
  | "success"
  | "offline";

export type AgentRuntimeSnapshot = {
  agentId: AgentId;
  state: AgentRuntimeState;
  statusLabel: string;
  currentTask?: string;
  primaryMetric?: string;
  secondaryMetric?: string;
  lastUpdate?: string;
};

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: "master",
    name: "Master AI",
    role: "Coordinates every AI agent",
    status: "Coordinating",
    mission: "Prioritize signals and keep every specialist aligned.",
    output: "10 specialist channels synchronized",
    signal: "Network harmony 98%",
    image: "/onkar-ai/agents/master.jpg",
    icon: Crown,
    destination: "/onkar-ai/assistant",
    visualState: "active",
    primaryMetric: "XAUUSD",
    secondaryMetric: "91 score",
  },
  {
    id: "trend",
    name: "Trend AI",
    role: "Multi-timeframe bias",
    status: "Scanning",
    mission: "Compare daily, 4H, 1H and execution-timeframe direction.",
    output: "Bullish alignment detected on 3 sample markets",
    signal: "6 timeframes in view",
    image: "/onkar-ai/agents/trend.jpg",
    icon: GitBranch,
    destination: "/onkar-ai/scanner",
    visualState: "scanning",
    primaryMetric: "Bullish",
    secondaryMetric: "84% strength",
  },
  {
    id: "zone",
    name: "Zone AI",
    role: "Supply, demand & levels",
    status: "Mapping",
    mission: "Map clean areas where price may react or invalidate.",
    output: "XAUUSD demand zone remains in focus",
    signal: "Key levels mapped",
    image: "/onkar-ai/agents/zone.jpg",
    icon: ScanLine,
    destination: "/onkar-ai/charts",
    visualState: "scanning",
    primaryMetric: "2,404–2,408",
    secondaryMetric: "6 sample zones",
  },
  {
    id: "setup",
    name: "Setup AI",
    role: "Strategy rule matching",
    status: "Matching",
    mission: "Turn market context into explainable rule matches.",
    output: "SRC Support Rejection · 9/10 sample match",
    signal: "1 high-quality preview",
    image: "/onkar-ai/agents/setup.jpg",
    icon: Target,
    destination: "/onkar-ai/setups",
    visualState: "thinking",
    primaryMetric: "9 / 10 rules",
    secondaryMetric: "91 score",
  },
  {
    id: "risk",
    name: "Risk AI",
    role: "Capital protection",
    status: "Guarding",
    mission: "Keep every plan inside the trader's risk boundaries.",
    output: "Example plan validates at 1:2.6 R:R",
    signal: "Protection layer ready",
    image: "/onkar-ai/agents/risk.jpg",
    icon: ShieldCheck,
    destination: "/onkar-ai/risk",
    visualState: "active",
    primaryMetric: "1.0% risk",
    secondaryMetric: "1 : 2.6 R:R",
  },
  {
    id: "news",
    name: "News AI",
    role: "Economic event filter",
    status: "Monitoring",
    mission: "Surface scheduled risk before it reaches a setup.",
    output: "Next sample event: CPI · high impact",
    signal: "Event feed monitored",
    image: "/onkar-ai/agents/news.jpg",
    icon: Radio,
    destination: "/onkar-ai/news",
    visualState: "alert",
    primaryMetric: "CPI · High",
    secondaryMetric: "42m sample",
  },
  {
    id: "backtest",
    name: "Backtest AI",
    role: "Historical simulation",
    status: "Running",
    mission: "Test setup behavior without hiding the sample size.",
    output: "Historical replay workspace available",
    signal: "Bias-safe workflow",
    image: "/onkar-ai/agents/backtest.jpg",
    icon: History,
    destination: "/onkar-ai/backtesting",
    visualState: "scanning",
    primaryMetric: "73 trades",
    secondaryMetric: "65.7% sample",
  },
  {
    id: "journal",
    name: "Journal AI",
    role: "Trading habit coaching",
    status: "Coaching",
    mission: "Connect decisions, rule adherence and repeatable habits.",
    output: "Journal context ready for review",
    signal: "Private trader context",
    image: "/onkar-ai/agents/journal.jpg",
    icon: BookOpenCheck,
    destination: "/onkar-ai/journal",
    visualState: "thinking",
    primaryMetric: "42 reviewed",
    secondaryMetric: "+18% sample",
  },
  {
    id: "insight",
    name: "Insight AI",
    role: "Explain & compare",
    status: "Ready",
    mission: "Explain why a setup qualifies, what is missing and what breaks it.",
    output: "Context summary prepared for XAUUSD",
    signal: "Explainability online",
    image: "/onkar-ai/agents/insight.jpg",
    icon: Lightbulb,
    destination: "/onkar-ai/assistant",
    visualState: "active",
    primaryMetric: "XAUUSD",
    secondaryMetric: "91 confidence",
  },
  {
    id: "execution",
    name: "Execution AI",
    role: "Routing & verification",
    status: "Monitoring",
    mission: "Monitor handoffs and alerts while preserving user control.",
    output: "Execution remains disabled by default",
    signal: "Human approval protected",
    image: "/onkar-ai/agents/execution.jpg",
    icon: Network,
    destination: "/onkar-ai/integrations",
    visualState: "success",
    primaryMetric: "Manual",
    secondaryMetric: "34ms sample",
  },
];
