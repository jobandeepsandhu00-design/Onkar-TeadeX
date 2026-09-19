import type { OnkarAgentId, OnkarAgentState } from "@workspace/api-zod";

export type AgentDefinition = {
  id: OnkarAgentId;
  name: string;
  description: string;
  capabilities: string[];
  requiredData: string[];
  enabled: boolean;
  activeState: OnkarAgentState;
};
export const agentRegistry: Record<OnkarAgentId, AgentDefinition> = {
  master: {
    id: "master",
    name: "Master AI",
    description: "Coordinates verified specialists and synthesizes evidence.",
    capabilities: ["intent", "planning", "synthesis"],
    requiredData: [],
    enabled: true,
    activeState: "thinking",
  },
  trend: {
    id: "trend",
    name: "Trend AI",
    description: "Deterministic multi-timeframe direction analysis.",
    capabilities: ["trend", "structure", "momentum"],
    requiredData: ["candles"],
    enabled: true,
    activeState: "scanning",
  },
  zone: {
    id: "zone",
    name: "Zone AI",
    description:
      "Deterministic support, resistance, supply and demand evidence.",
    capabilities: ["zones", "levels"],
    requiredData: ["candles"],
    enabled: true,
    activeState: "mapping",
  },
  setup: {
    id: "setup",
    name: "Setup AI",
    description:
      "Matches the 16 approved setup workflows only after the 4H → 1H → closed 30M gate unlocks.",
    capabilities: ["strategy", "rules", "confluence", "closed-candle-patterns"],
    requiredData: ["strategy", "market", "global-workflow"],
    enabled: true,
    activeState: "matching",
  },
  risk: {
    id: "risk",
    name: "Risk AI",
    description: "Calculates risk using configured instrument specifications.",
    capabilities: ["risk", "position-size", "exposure"],
    requiredData: ["account", "instrument-spec"],
    enabled: true,
    activeState: "validating",
  },
  news: {
    id: "news",
    name: "News AI",
    description: "Checks connected event sources without inventing news.",
    capabilities: ["calendar", "event-risk"],
    requiredData: ["news-provider"],
    enabled: true,
    activeState: "monitoring",
  },
  backtest: {
    id: "backtest",
    name: "Backtest AI",
    description: "Runs deterministic historical simulations.",
    capabilities: ["backtest", "historical-stats"],
    requiredData: ["historical-candles", "strategy"],
    enabled: true,
    activeState: "simulating",
  },
  journal: {
    id: "journal",
    name: "Journal AI",
    description: "Analyzes the user's recorded closed trades.",
    capabilities: ["performance", "mistakes", "review"],
    requiredData: ["journal"],
    enabled: true,
    activeState: "reviewing",
  },
  insight: {
    id: "insight",
    name: "Insight AI",
    description: "Explains verified structured results.",
    capabilities: ["explain", "compare"],
    requiredData: ["agent-results"],
    enabled: true,
    activeState: "thinking",
  },
  execution: {
    id: "execution",
    name: "Execution AI",
    description:
      "Monitors execution evidence; autonomous execution is disabled.",
    capabilities: ["execution-quality", "latency"],
    requiredData: ["execution-records"],
    enabled: true,
    activeState: "monitoring",
  },
};
