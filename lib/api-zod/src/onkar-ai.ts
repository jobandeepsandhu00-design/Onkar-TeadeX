import { z } from "zod";

export const onkarAgentIds = [
  "master", "trend", "zone", "setup", "risk", "news", "backtest",
  "journal", "insight", "execution",
] as const;
export const onkarAgentIdSchema = z.enum(onkarAgentIds);
export type OnkarAgentId = z.infer<typeof onkarAgentIdSchema>;

export const onkarAgentStateSchema = z.enum([
  "idle", "listening", "thinking", "scanning", "mapping", "matching",
  "validating", "monitoring", "reviewing", "learning", "simulating",
  "delegating", "synthesizing", "speaking", "success", "warning", "alert",
  "offline", "unavailable",
]);
export type OnkarAgentState = z.infer<typeof onkarAgentStateSchema>;

export const masterAIRequestSchema = z.object({
  question: z.string().trim().min(3).max(1200),
  candidateId: z.string().uuid().optional(),
  tradeId: z.string().trim().min(1).max(180).optional(),
  deepAnalysis: z.boolean().default(false),
}).strict();
export type MasterAIRequest = z.infer<typeof masterAIRequestSchema>;

export const agentResultSchema = z.object({
  agent: onkarAgentIdSchema,
  status: z.enum(["complete", "partial", "unavailable", "error"]),
  dataStatus: z.enum(["verified", "partial", "unavailable"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  source: z.array(z.string().max(120)).max(12),
  result: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string().max(500)).max(20),
  missingData: z.array(z.string().max(120)).max(20),
  confidenceInData: z.enum(["high", "medium", "low"]),
}).strict();
export type AgentResult = z.infer<typeof agentResultSchema>;

export const masterAIResponseSchema = z.object({
  runId: z.string().uuid(),
  intent: z.string(),
  answer: z.string(),
  dataStatus: z.enum(["verified", "partial", "unavailable"]),
  agents: z.array(agentResultSchema),
  commandLog: z.array(z.object({
    timestamp: z.string().datetime(),
    source: z.string(),
    target: z.string(),
    action: z.string(),
    status: z.string(),
    durationMs: z.number().int().nonnegative(),
    summary: z.string(),
  }).strict()),
  usage: z.object({
    model: z.string().nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }).strict(),
  animationStates: z.record(onkarAgentIdSchema, onkarAgentStateSchema),
}).strict();
export type MasterAIResponse = z.infer<typeof masterAIResponseSchema>;
