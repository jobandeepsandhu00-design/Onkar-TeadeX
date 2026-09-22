import { z } from "zod";

export const TIMEFRAMES = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1D",
  "1W",
] as const;
export const timeframeSchema = z.enum(TIMEFRAMES);
export type Timeframe = z.infer<typeof timeframeSchema>;
export const timeframeMs: Record<Timeframe, number> = {
  "1m": 60e3,
  "5m": 300e3,
  "15m": 900e3,
  "30m": 1800e3,
  "1h": 3600e3,
  "4h": 14400e3,
  "1D": 86400e3,
  "1W": 604800e3,
};
export const TWELVE_DATA_MIN_CYCLE_SECONDS = 15 * 60;
export function normalizeTimeframe(value: string): Timeframe {
  const aliases: Record<string, Timeframe> = {
    M1: "1m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
    H4: "4h",
    D1: "1D",
    W1: "1W",
    "1min": "1m",
    "5min": "5m",
    "15min": "15m",
    "30min": "30m",
    "1day": "1D",
    "1week": "1W",
    "1d": "1D",
    "1w": "1W",
  };
  return timeframeSchema.parse(aliases[value] ?? value);
}
export const symbolSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[A-Z0-9/:.^_-]+$/);
export const candleSchema = z
  .object({
    t: z.number().int().nonnegative(),
    o: z.number().positive().finite(),
    h: z.number().positive().finite(),
    l: z.number().positive().finite(),
    c: z.number().positive().finite(),
    v: z.number().nonnegative().finite().nullable(),
  })
  .strict()
  .refine(
    (c) => c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && c.h >= c.l,
    "Invalid OHLC range",
  );
export type Candle = z.infer<typeof candleSchema>;
export const sharedChartSymbolSchema = z.enum([
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "GBPJPY",
  "EURJPY",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURGBP",
  "XAUUSD",
]);
export const sharedChartTimeframeSchema = z.enum(["15m", "30m", "1h", "4h"]);
export type SharedChartSymbol = z.infer<typeof sharedChartSymbolSchema>;
export type SharedChartTimeframe = z.infer<typeof sharedChartTimeframeSchema>;
export const chartCandleSchema = z
  .object({
    t: z.number().int().nonnegative(),
    o: z.number().positive().finite(),
    h: z.number().positive().finite(),
    l: z.number().positive().finite(),
    c: z.number().positive().finite(),
    v: z.number().nonnegative().finite().nullable(),
    closed: z.boolean(),
  })
  .strict()
  .refine(
    (c) => c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && c.h >= c.l,
    "Invalid chart OHLC range",
  );
export const workflowBiasSchema = z.enum(["bullish", "bearish", "ranging"]);
export const workflowAlignmentSchema = z.enum([
  "FULL_ALIGNMENT",
  "PARTIAL_ALIGNMENT",
  "CONFLICT",
  "RANGING",
]);
export const workflowLocationSchema = z.enum([
  "AT_4H_SUPPORT",
  "AT_4H_RESISTANCE",
  "AT_1H_SUPPORT",
  "AT_1H_RESISTANCE",
  "AT_30M_SUPPORT",
  "AT_30M_RESISTANCE",
  "APPROACHING_ZONE",
  "MIDDLE_OF_RANGE",
  "TOO_FAR_FROM_ZONE",
  "AT_OPPOSING_ZONE",
]);
export const workflowRangeStatusSchema = z.enum([
  "GOOD_RANGE",
  "LIMITED_RANGE",
  "INSUFFICIENT_RANGE",
  "UNAVAILABLE",
]);
export const workflowReactionSchema = z.enum([
  "BULLISH_REJECTION",
  "BEARISH_REJECTION",
  "BULLISH_CONTINUATION",
  "BEARISH_CONTINUATION",
  "BULLISH_BREAKOUT",
  "BEARISH_BREAKOUT",
  "BULLISH_FAKEOUT",
  "BEARISH_FAKEOUT",
  "SUPPORT_CONFIRMED",
  "RESISTANCE_CONFIRMED",
  "NO_CONFIRMATION",
]);
const workflowZoneSchema = z
  .object({
    low: z.number().finite(),
    high: z.number().finite(),
    type: z.string(),
    timeframe: z.enum(["4h", "1h", "30m"]),
    touches: z.number().int().nonnegative(),
    freshness: z.number().min(0).max(100),
  })
  .nullable();
export const globalTradingWorkflowSchema = z.object({
  version: z.literal("4h-1h-30m-v1"),
  symbol: z.string(),
  evaluatedAt: z.string().datetime(),
  session: z.string(),
  currentPrice: z.number().positive().finite(),
  fourHour: z.object({
    bias: workflowBiasSchema,
    structure: z.array(z.string()),
    support: workflowZoneSchema,
    resistance: workflowZoneSchema,
    swingHigh: z.number().finite().nullable(),
    swingLow: z.number().finite().nullable(),
    brokenStructure: z.enum(["bullish", "bearish"]).nullable(),
  }),
  oneHour: z.object({
    bias: workflowBiasSchema,
    alignment: workflowAlignmentSchema,
    support: workflowZoneSchema,
    resistance: workflowZoneSchema,
    setupZone: workflowZoneSchema,
    swingHigh: z.number().finite().nullable(),
    swingLow: z.number().finite().nullable(),
    brokenStructure: z.enum(["bullish", "bearish"]).nullable(),
  }),
  thirtyMinute: z.object({
    support: workflowZoneSchema,
    resistance: workflowZoneSchema,
    swingHigh: z.number().finite().nullable(),
    swingLow: z.number().finite().nullable(),
    brokenStructure: z.enum(["bullish", "bearish"]).nullable(),
    candle: chartCandleSchema,
    reaction: workflowReactionSchema,
  }),
  priceLocation: workflowLocationSchema,
  availableRange: z.object({
    priceUnits: z.number().nonnegative().finite().nullable(),
    pips: z.number().nonnegative().finite().nullable(),
    pipSize: z.number().positive().finite().nullable(),
    status: workflowRangeStatusSchema,
    opposingZone: workflowZoneSchema,
  }),
  gate: z.object({
    status: z.enum(["LOCKED", "UNLOCKED"]),
    passed: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  riskGate: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  masterStatus: z.enum([
    "SCANNING",
    "APPROACHING_ZONE",
    "AT_SETUP_AREA",
    "WAITING_FOR_30M_CLOSE",
    "NO_CONFIRMATION",
    "SETUP_DETECTED",
    "RISK_REVIEW",
    "RISK_REJECTED",
    "ENTRY_READY",
    "INVALIDATED",
  ]),
});
export type GlobalTradingWorkflow = z.infer<typeof globalTradingWorkflowSchema>;
export const setupDetectionStatusSchema = z.enum([
  "WATCHING",
  "PARTIAL",
  "CONFIRMED",
  "INVALID",
]);
export const setupDetectionSchema = z.object({
  id: z.string(),
  symbol: sharedChartSymbolSchema,
  timeframe: sharedChartTimeframeSchema,
  setup: z.string(),
  status: setupDetectionStatusSchema,
  direction: z.enum(["BUY", "SELL", "NONE"]),
  conditionsMatched: z.array(z.string()),
  conditionsMissing: z.array(z.string()),
  entry: z.number().finite().nullable(),
  stopLoss: z.number().finite().nullable(),
  takeProfit: z.number().finite().nullable(),
  riskReward: z.number().finite().nullable(),
  learningInsight: z.string(),
  reason: z.string(),
  waitFor: z.string(),
  candleClosed: z.boolean(),
  decisionCandleAt: z.string().datetime({ offset: true }),
  timestamp: z.string().datetime(),
  zones: z
    .array(
      z.object({
        low: z.number().finite(),
        high: z.number().finite(),
        kind: z.string(),
      }),
    )
    .default([]),
});
export type SetupDetection = z.infer<typeof setupDetectionSchema>;
export const sharedMarketSnapshotSchema = z.object({
  symbol: sharedChartSymbolSchema,
  displaySymbol: z.string(),
  timeframe: sharedChartTimeframeSchema,
  provider: z.enum(["mt5", "twelvedata"]),
  dataSource: z.enum(["broker", "primary", "fallback"]),
  dataStatus: z.enum(["live", "delayed", "cached", "unavailable"]),
  fetchedAt: z.string().datetime(),
  broker: z.string().nullable().default(null),
  server: z.string().nullable().default(null),
  accountType: z.enum(["DEMO", "LIVE", "CONTEST"]).nullable().default(null),
  quote: z
    .object({
      bid: z.number().finite(),
      ask: z.number().finite(),
      last: z.number().finite(),
      spread: z.number().nonnegative().finite(),
      timestamp: z.string().datetime(),
      approximateLatencyMs: z.number().nonnegative().finite().nullable(),
      state: z.enum(["CONNECTED", "STALE", "MARKET_CLOSED", "DISCONNECTED"]),
      brokerSymbol: z.string(),
    })
    .nullable()
    .default(null),
  candles: z.array(chartCandleSchema),
  detections: z.array(setupDetectionSchema),
  workflow: globalTradingWorkflowSchema.nullable(),
  warnings: z.array(z.string()),
  source: z.array(z.string()),
});
export type SharedMarketSnapshot = z.infer<typeof sharedMarketSnapshotSchema>;
export const FEATURES = [
  "trend",
  "structure",
  "rsi",
  "ema20",
  "ema50",
  "ema200",
  "close",
  "atr",
  "volumeRatio",
  "momentum",
  "rejection",
  "engulfing",
  "breakout",
  "sweep",
  "inside",
  "consolidation",
  "zoneDistanceATR",
  "openRangeATR",
  "rr",
  "newsSafe",
  "session",
  "manualConfirmation",
  "setupPatternMatched",
  "entryTrigger",
  "volumeWindow",
] as const;
export const ruleSchema = z
  .object({
    id: z.string().min(1).max(80),
    feature: z.enum(FEATURES),
    timeframe: timeframeSchema,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    expected: z.union([z.string().max(80), z.number().finite(), z.boolean()]),
    required: z.boolean(),
    weight: z.number().min(0).max(100),
    explanation: z.string().max(500).default(""),
  })
  .strict();
export type MachineRule = z.infer<typeof ruleSchema>;
export const strategyVersionSchema = z
  .object({
    sourceSetupId: z.string().min(1).max(180),
    name: z.string().min(1).max(120),
    direction: z.enum(["long", "short", "both"]),
    timeframe: timeframeSchema,
    higherTimeframe: timeframeSchema,
    symbols: z.array(symbolSchema).max(32).default([]),
    sessions: z.array(z.string().max(40)).max(6).default([]),
    rules: z.array(ruleSchema).min(1).max(30),
    approval: z.enum(["draft", "ai_extracted", "approved"]),
    autoExecutionAllowed: z.boolean().default(false),
    minRR: z.number().min(1).max(10).default(2),
    expiresBars: z.number().int().min(2).max(96).default(16),
  })
  .strict()
  .refine(
    (v) => timeframeMs[v.higherTimeframe] > timeframeMs[v.timeframe],
    "Higher timeframe must exceed execution timeframe",
  )
  .refine(
    (v) => new Set(v.rules.map((r) => r.id)).size === v.rules.length,
    "Rule IDs must be unique",
  )
  .refine(
    (v) => v.rules.some((r) => r.weight > 0),
    "At least one rule needs a weight",
  );
export type StrategyVersion = z.infer<typeof strategyVersionSchema>;
export const riskProfileSchema = z
  .object({
    riskPercent: z.number().positive().max(5).default(1),
    maxDailyLossPercent: z.number().positive().max(20).default(3),
    maxOpenPositions: z.number().int().min(1).max(20).default(3),
    maxOpenRiskPercent: z.number().positive().max(20).default(3),
    minimumRR: z.number().min(1).max(10).default(2),
    valuePerPriceUnit: z.record(z.string(), z.number().positive()).default({}),
  })
  .strict();
export const scannerPermissionsSchema = z
  .object({
    automaticScanning: z.boolean().default(true),
    automaticSetupDetection: z.boolean().default(true),
    automaticCandidateCreation: z.boolean().default(true),
    automaticWatchlist: z.boolean().default(true),
    automaticAlerts: z.boolean().default(true),
    automaticRiskCalculation: z.boolean().default(true),
    automaticOrderPreparation: z.boolean().default(true),
    paperTradeExecution: z.boolean().default(true),
    mt5LiveExecution: z.boolean().default(false),
    aiAnalysis: z.boolean().default(true),
    journalInsights: z.boolean().default(true),
    autoBreakEven: z.boolean().default(false),
    autoPartialClose: z.boolean().default(false),
    autoStopModification: z.boolean().default(false),
    autoTradeClose: z.boolean().default(false),
  })
  .strict();
export type ScannerPermissions = z.infer<typeof scannerPermissionsSchema>;
export const tradeManagementSchema = z
  .object({
    breakEvenTriggerR: z.number().min(0.25).max(5).default(1),
    breakEvenOffsetR: z.number().min(0).max(1).default(0),
    partialCloseTriggerR: z.number().min(0.25).max(5).default(1),
    partialClosePercent: z.number().min(5).max(90).default(50),
    stopModificationTriggerR: z.number().min(0.5).max(10).default(1.5),
    stopModificationLockR: z.number().min(0).max(5).default(0.5),
    tradeCloseTriggerR: z.number().min(1).max(10).default(2),
    closeOnSetupInvalidation: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) => value.stopModificationLockR < value.stopModificationTriggerR,
    "The locked R must be below the SL-modification trigger",
  );
export type TradeManagement = z.infer<typeof tradeManagementSchema>;
export const scannerConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    provider: z.enum(["mt5", "twelvedata", "coinbase"]).default("twelvedata"),
    symbols: z.array(symbolSchema).min(1).max(32).default(["GBPJPY", "XAUUSD"]),
    timeframes: z
      .array(timeframeSchema)
      .min(1)
      .max(8)
      .default(["15m", "30m", "1h"]),
    accountId: z.string().max(180).nullable().default(null),
    autoActivateApprovedSetups: z.boolean().default(true),
    strategyVersionIds: z.array(z.string().uuid()).max(100).default([]),
    minimumScore: z.number().min(0).max(100).default(50),
    aiThreshold: z.number().min(60).max(100).default(75),
    alertThreshold: z.number().min(50).max(100).default(80),
    visionThreshold: z.number().min(75).max(100).default(85),
    frequencySeconds: z
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(TWELVE_DATA_MIN_CYCLE_SECONDS),
    maxAlertsPerDay: z.number().int().min(0).max(50).default(10),
    maxAiCallsPerDay: z.number().int().min(0).max(50).default(10),
    newsBeforeMinutes: z.number().int().min(0).max(180).default(30),
    newsAfterMinutes: z.number().int().min(0).max(180).default(15),
    requireNews: z.boolean().default(true),
    visionEnabled: z.boolean().default(false),
    risk: riskProfileSchema.default({}),
    permissions: scannerPermissionsSchema.default({}),
    tradeManagement: tradeManagementSchema.default({}),
  })
  .strict();
export type ScannerConfig = z.infer<typeof scannerConfigSchema>;
export type RuleResult = MachineRule & {
  actual: string | number | boolean | null;
  passed: boolean;
  available: boolean;
};
export const STATES = [
  "SCANNING",
  "DEVELOPING",
  "WATCH",
  "READY",
  "TRIGGERED",
  "INVALIDATED",
  "EXPIRED",
  "COMPLETED",
] as const;
export type CandidateState = (typeof STATES)[number];
export const aiExplanationSchema = z
  .object({
    summary: z.string().min(1).max(1500),
    why: z.array(z.string().max(500)).max(12),
    whyNot: z.array(z.string().max(500)).max(12),
    missing: z.array(z.string().max(500)).max(12),
    invalidation: z.string().max(500),
    educationalLesson: z.string().max(800),
  })
  .strict();
export type AIExplanation = z.infer<typeof aiExplanationSchema>;
export const webhookSchema = z
  .object({
    eventId: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[a-zA-Z0-9:_-]+$/),
    timestamp: z.string().datetime(),
    symbol: symbolSchema,
    timeframe: timeframeSchema,
    event: z.enum([
      "breakout",
      "support_retest",
      "resistance_retest",
      "ema_cross",
      "rejection",
      "liquidity_sweep",
      "custom",
    ]),
    price: z.number().positive().finite(),
    secret: z.string().min(32).max(256),
  })
  .strict();
export const featureValueSchema = z.union([
  z.number().finite(),
  z.string(),
  z.boolean(),
  z.null(),
]);
export type FeatureValue = z.infer<typeof featureValueSchema>;

export type ScannerCandidate = {
  id: string;
  symbol: string;
  timeframe: string;
  state: CandidateState;
  score: number;
  version_id: string;
  staleNow?: boolean;
  created_at?: string;
  updated_at?: string;
  last_candle_at: string;
  expires_at: string;
  plan: RiskResult | null;
  payload: {
    strategyName?: string;
    provider?: string;
    source: string;
    direction: "long" | "short";
    marketBias: string;
    session: string;
    score: number;
    passed: number;
    total: number;
    rules: RuleResult[];
    risk: RiskResult;
    warnings: string[];
    stale: boolean;
    analyzedAt: string;
    lastCandleAt: string;
    higherTimeframe: string;
    primaryTimeframe: string;
    entryZone: { low: number; high: number };
    invalidation: number;
    targets: number[];
    news: {
      status: "safe" | "blocked" | "unavailable";
      checkedAt: string;
      events: Array<{ title: string; time: number; currency: string }>;
    };
    globalWorkflow?: GlobalTradingWorkflow | null;
    globalWorkflowRequired?: boolean;
    setupWorkflow?: {
      setup: string;
      direction: "long" | "short";
      patternMatched: boolean;
      entryTrigger: boolean;
      conditionsMatched: string[];
      conditionsMissing: string[];
      invalidated: boolean;
      waitFor: string;
    } | null;
    historical?: {
      sample: number;
      knownPnl: number;
      wins: number;
      losses: number;
      winRate: number | null;
      averageR: number | null;
      caution: string;
      mostCommonMistakes: Array<{ name: string; count: number }>;
    };
  };
};
export type RiskResult = {
  entry: number;
  stop: number;
  target: number;
  rr: number;
  stopDistance: number;
  riskPercent: number;
  monetaryRisk: number | null;
  positionSize: number | null;
  rawPositionSize?: number | null;
  estimatedLossAtStop?: number | null;
  valuePerPriceUnit?: number | null;
  contractSize?: number | null;
  profitCurrency?: string | null;
  conversionRate?: number | null;
  sizingSafetyFactor?: number | null;
  volumeStep?: number | null;
  sizingSource?:
    | "TWELVE_DATA_PAPER_STANDARD"
    | "ECB_REFERENCE_FALLBACK"
    | "MT5_BROKER_SPEC"
    | "MANUAL"
    | null;
  currency: string | null;
  accountId: string | null;
  allowed: boolean;
  warnings: string[];
  executionEnabled: boolean;
};
export type ScannerVersion = {
  id: string;
  name: string;
  source_setup_id: string;
  definition: StrategyVersion;
  created_at: string;
};
export type ScannerSnapshot = {
  config: {
    id: string;
    config: ScannerConfig;
    enabled: boolean;
    last_run_at: string | null;
    last_duration_ms: number | null;
    last_error: string | null;
    health: Record<string, unknown>;
  } | null;
  defaults: ScannerConfig;
  candidates: ScannerCandidate[];
  versions: ScannerVersion[];
  alerts: Array<{
    id: string;
    candidate_id: string;
    message: string;
    kind: string;
    read_at: string | null;
    created_at: string;
  }>;
  activity?: Array<{
    id: string;
    candidate_id: string | null;
    kind: string;
    source: "SCANNER" | "EXECUTION";
    reason: string | null;
    detail: Record<string, unknown>;
    created_at: string;
  }>;
  paperTrades: Array<{
    id: string;
    account_id: string;
    symbol: string;
    direction: "BUY" | "SELL";
    entry: number;
    current_price: number;
    stop_loss: number;
    take_profit: number;
    position_size: number;
    status: "OPEN" | "CLOSED" | "INVALIDATED";
    pnl: number | null;
    r_multiple: number | null;
    opened_at: string;
    closed_at: string | null;
    detail: Record<string, unknown>;
  }>;
  runs: Array<{
    id: string;
    status: string;
    model: string | null;
    latency_ms: number | null;
    created_at: string;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
    type: string;
    broker?: string;
    accountNumber?: string;
    source?: string;
    balance?: number | null;
  }>;
  setups: Array<{
    id: string;
    name: string;
    direction?: string;
    timeframe?: string;
    description?: string;
    rules?: unknown[];
  }>;
  connection: Record<string, string>;
  runtime: ScannerRuntime;
  journal: {
    accountId: string | null;
    trades: number;
    knownPnl: number;
    wins: number;
    losses: number;
    pnl: number;
    caution: string;
    bySetup: Array<{ key: string; count: number; pnl: number; wins: number }>;
    bySession: Array<{ key: string; count: number; pnl: number; wins: number }>;
    byTimeframe: Array<{
      key: string;
      count: number;
      pnl: number;
      wins: number;
    }>;
  } | null;
};

export const scannerRuntimeSchema = z.object({
  scannerState: z.enum(["RUNNING", "PAUSED", "STOPPED"]).default("STOPPED"),
  tradingMode: z.enum(["ANALYSIS", "CONFIRM", "AUTO"]).default("ANALYSIS"),
  tradingSource: z.enum(["MT5", "TWELVE_DATA"]).default("TWELVE_DATA"),
  mt5DisconnectBehavior: z.enum(["LOCK", "PAPER", "ANALYSIS"]).default("LOCK"),
  autoReturnMt5: z.boolean().default(false),
  autoStart: z.boolean().default(false),
  autoExecutionEnabled: z.boolean().default(false),
  emergencyStop: z.boolean().default(false),
  // Postgres/Supabase serializes timestamptz values with an explicit UTC
  // offset (for example `+00:00`). Accept both that wire format and `Z`.
  reconciledAt: z.string().datetime({ offset: true }).nullable().default(null),
  sourceActivatedAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .default(null),
  updatedAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type ScannerRuntime = z.infer<typeof scannerRuntimeSchema>;

export const scannerRuntimeUpdateSchema = scannerRuntimeSchema.pick({
  scannerState: true,
  tradingMode: true,
  tradingSource: true,
  mt5DisconnectBehavior: true,
  autoReturnMt5: true,
  autoStart: true,
  autoExecutionEnabled: true,
});

export const scannerControlSchema = z.object({
  action: z.enum([
    "PAUSE",
    "RESUME",
    "RESUME_ANALYSIS",
    "STOP",
    "EMERGENCY_STOP",
    "DISABLE_AUTO",
  ]),
});

export const scannerToolInputSchema = z
  .object({
    name: z.enum([
      "get_active_setup_candidates",
      "get_market_context",
      "evaluate_setup_rules",
      "calculate_risk",
      "get_historical_matches",
      "get_journal_statistics",
      "get_economic_events",
      "get_strategy_rules",
    ]),
    candidateId: z.string().uuid().optional(),
  })
  .strict();
export const scannerChatSchema = z
  .object({
    question: z.string().trim().min(4).max(800),
    candidateId: z.string().uuid(),
  })
  .strict();
export const backtestRequestSchema = z
  .object({
    versionId: z.string().uuid(),
    symbol: symbolSchema,
    from: z.string().datetime(),
    to: z.string().datetime(),
    acknowledgeSimulation: z.literal(true),
    allowMissingHistoricalNews: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 90 * 86400e3,
    "Choose a range of at most 90 days",
  );
