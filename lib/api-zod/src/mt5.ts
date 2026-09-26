import { z } from "zod";

export const mt5ConnectionStateSchema = z.enum([
  "CONNECTED",
  "CONNECTING",
  "RECONNECTING",
  "DISCONNECTED",
  "STALE",
  "MARKET_CLOSED",
  "ERROR",
]);
export const mt5AccountSchema = z.object({
  connection: mt5ConnectionStateSchema,
  broker: z.string(),
  server: z.string(),
  account: z.string(),
  accountType: z.enum(["DEMO", "LIVE", "CONTEST"]),
  currency: z.string(),
  balance: z.number().finite(),
  equity: z.number().finite(),
  margin: z.number().finite(),
  freeMargin: z.number().finite(),
  marginLevel: z.number().finite().nullable(),
  tradeAllowed: z.boolean(),
  terminalConnected: z.boolean(),
  tradeApiDisabled: z.boolean().default(false),
  tradingEnabled: z.boolean(),
  liveTradingAllowed: z.boolean(),
});
export type MT5Account = z.infer<typeof mt5AccountSchema>;

/** Server-to-server bridge contract. Never serialize this through browser routes. */
export const mt5AccountIdentitySchema = mt5AccountSchema.extend({
  accountFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type MT5AccountIdentity = z.infer<typeof mt5AccountIdentitySchema>;

export const mt5PositionSchema = z.object({
  ticket: z.number().int().nonnegative(),
  symbol: z.string(),
  brokerSymbol: z.string(),
  direction: z.enum(["BUY", "SELL"]),
  volume: z.number().positive(),
  entryPrice: z.number().positive(),
  currentPrice: z.number().positive(),
  stopLoss: z.number().positive().nullable(),
  takeProfit: z.number().positive().nullable(),
  profitLoss: z.number().finite(),
  openTime: z.number().int().nonnegative(),
});
export type MT5Position = z.infer<typeof mt5PositionSchema>;

export const mt5PendingOrderSchema = z.object({
  ticket: z.number().int().nonnegative(),
  symbol: z.string(),
  brokerSymbol: z.string(),
  type: z.number().int(),
  volume: z.number().positive(),
  price: z.number().positive(),
  stopLoss: z.number().positive().nullable(),
  takeProfit: z.number().positive().nullable(),
  createdAt: z.number().int().nonnegative(),
  comment: z.string(),
  magic: z.number().int().nullable(),
});
export type MT5PendingOrder = z.infer<typeof mt5PendingOrderSchema>;

export const mt5TickSchema = z.object({
  symbol: z.string(),
  brokerSymbol: z.string(),
  bid: z.number().finite().nonnegative(),
  ask: z.number().finite().nonnegative(),
  last: z.number().finite().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  spread: z.number().finite().nonnegative(),
  tickVolume: z.number().finite().nonnegative(),
  state: z.enum(["CONNECTED", "STALE", "MARKET_CLOSED", "DISCONNECTED"]),
  approximateLatencyMs: z.number().finite().nonnegative(),
});
export type MT5Tick = z.infer<typeof mt5TickSchema>;

export const mt5SymbolSpecSchema = z.object({
  symbol: z.string(),
  brokerSymbol: z.string(),
  digits: z.number().int().nonnegative(),
  point: z.number().finite().nonnegative(),
  tickSize: z.number().finite().nonnegative(),
  tickValue: z.number().finite().nonnegative(),
  tickValueProfit: z.number().finite().nonnegative(),
  tickValueLoss: z.number().finite().nonnegative(),
  contractSize: z.number().finite().nonnegative(),
  volumeMin: z.number().finite().nonnegative(),
  volumeMax: z.number().finite().nonnegative(),
  volumeStep: z.number().finite().nonnegative(),
  stopsLevel: z.number().int().nonnegative(),
  fillingMode: z.number().int(),
  executionMode: z.number().int(),
  tradeMode: z.number().int(),
});
export type MT5SymbolSpec = z.infer<typeof mt5SymbolSpecSchema>;

/**
 * Server-to-server contract for one bridge-locked broker read. The opaque
 * fingerprint must be removed before any browser response is serialized.
 */
export const mt5BrokerSnapshotSchema = z.object({
  account: mt5AccountIdentitySchema,
  positions: z.array(mt5PositionSchema),
  orders: z.array(mt5PendingOrderSchema),
  symbol: z
    .object({
      tick: mt5TickSchema,
      spec: mt5SymbolSpecSchema,
    })
    .nullable(),
  capturedAt: z.number().int().nonnegative(),
});
export type MT5BrokerSnapshot = z.infer<typeof mt5BrokerSnapshotSchema>;

export const mt5CandleBundleTimeframeSchema = z.enum([
  "15m",
  "30m",
  "1h",
  "4h",
]);
export type MT5CandleBundleTimeframe = z.infer<
  typeof mt5CandleBundleTimeframeSchema
>;

export const mt5BridgeCandleSchema = z
  .object({
    time: z.number().int().nonnegative(),
    open: z.number().positive().finite(),
    high: z.number().positive().finite(),
    low: z.number().positive().finite(),
    close: z.number().positive().finite(),
    tick_volume: z.number().nonnegative().finite(),
    spread: z.number().int().nonnegative(),
    real_volume: z.number().nonnegative().finite(),
    isClosed: z.boolean(),
    candleId: z.string().min(1),
  })
  .strict()
  .refine(
    (candle) =>
      candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close) &&
      candle.high >= candle.low,
    "Invalid MT5 candle OHLC range",
  );
export type MT5BridgeCandle = z.infer<typeof mt5BridgeCandleSchema>;

const mt5BridgeCandleSeriesSchema = z
  .array(mt5BridgeCandleSchema)
  .min(1)
  .superRefine((candles, context) => {
    for (let index = 1; index < candles.length; index += 1) {
      if (candles[index - 1].time >= candles[index].time) {
        context.addIssue({
          code: "custom",
          path: [index, "time"],
          message: "MT5 candle series must be unique and oldest to newest",
        });
      }
    }
  });

/**
 * Server-only account/symbol-atomic market snapshot. The opaque account
 * fingerprint must never be projected into a browser response.
 */
export const mt5CandleBundleSchema = z
  .object({
    account: mt5AccountIdentitySchema,
    symbol: z
      .object({
        internalSymbol: z.string().min(3).max(24),
        brokerSymbol: z.string().min(1).max(64),
        tick: mt5TickSchema,
        spec: mt5SymbolSpecSchema,
      })
      .strict(),
    requestedTimeframes: z
      .array(mt5CandleBundleTimeframeSchema)
      .min(1)
      .max(4),
    timeframes: z
      .object({
        "15m": mt5BridgeCandleSeriesSchema.optional(),
        "30m": mt5BridgeCandleSeriesSchema.optional(),
        "1h": mt5BridgeCandleSeriesSchema.optional(),
        "4h": mt5BridgeCandleSeriesSchema.optional(),
      })
      .strict(),
    capturedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      bundle.symbol.brokerSymbol !== bundle.symbol.tick.brokerSymbol ||
      bundle.symbol.brokerSymbol !== bundle.symbol.spec.brokerSymbol
    )
      context.addIssue({
        code: "custom",
        path: ["symbol", "brokerSymbol"],
        message: "MT5 candle bundle contains mixed broker symbols",
      });
    if (new Set(bundle.requestedTimeframes).size !== bundle.requestedTimeframes.length)
      context.addIssue({
        code: "custom",
        path: ["requestedTimeframes"],
        message: "MT5 candle bundle contains duplicate timeframes",
      });
    for (const timeframe of bundle.requestedTimeframes)
      if (!bundle.timeframes[timeframe]?.length)
        context.addIssue({
          code: "custom",
          path: ["timeframes", timeframe],
          message: `MT5 candle bundle is missing ${timeframe} candles`,
        });
  });
export type MT5CandleBundle = z.infer<typeof mt5CandleBundleSchema>;

export const mt5PortfolioSnapshotSchema = z.object({
  scopeAccountId: z.string().min(1),
  accountIdentityVerified: z.literal(true),
  fetchedAt: z.string().datetime(),
  // Browser-safe account data only. Parsing through mt5AccountSchema strips
  // the bridge-only accountFingerprint from the atomic broker snapshot.
  account: mt5AccountSchema,
  positions: z.array(mt5PositionSchema),
  orders: z.array(mt5PendingOrderSchema),
});
export type MT5PortfolioSnapshot = z.infer<typeof mt5PortfolioSnapshotSchema>;

/** Browser defense-in-depth; the authoritative fingerprint check is server-side. */
export function mt5PortfolioMatchesSelectedAccount(
  portfolio: MT5PortfolioSnapshot | null | undefined,
  selectedAccountId: string | null | undefined,
  verifiedChartScopeAccountId: string | null | undefined,
) {
  return Boolean(
    portfolio?.accountIdentityVerified &&
    selectedAccountId &&
    portfolio.scopeAccountId === selectedAccountId &&
    portfolio.scopeAccountId === verifiedChartScopeAccountId,
  );
}

export const mt5HistoryTradeSchema = z.object({
  positionTicket: z.number().int().nonnegative(),
  symbol: z.string(),
  brokerSymbol: z.string(),
  direction: z.enum(["BUY", "SELL"]),
  volume: z.number().positive(),
  entryPrice: z.number().positive(),
  entryTime: z.number().int().nonnegative(),
  exitPrice: z.number().positive().nullable(),
  exitTime: z.number().int().nonnegative().nullable(),
  profitLoss: z.number().finite().nullable(),
  status: z.enum(["Open", "Closed"]),
});
export type MT5HistoryTrade = z.infer<typeof mt5HistoryTradeSchema>;

export const mt5OrderRequestSchema = z
  .object({
    requestId: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[A-Za-z0-9:_-]+$/),
    symbol: z.string().min(3).max(24),
    action: z.enum([
      "MARKET_BUY",
      "MARKET_SELL",
      "BUY_LIMIT",
      "SELL_LIMIT",
      "BUY_STOP",
      "SELL_STOP",
      "CLOSE",
      "PARTIAL_CLOSE",
      "MODIFY",
      "CANCEL",
    ]),
    volume: z.number().positive(),
    price: z.number().positive().optional(),
    stopLoss: z.number().positive().optional(),
    takeProfit: z.number().positive().optional(),
    positionTicket: z.number().int().positive().optional(),
    orderTicket: z.number().int().positive().optional(),
    deviation: z.number().int().min(0).max(500).default(20),
    comment: z.string().max(31).default("OnkarTradex manual"),
    confirmed: z.boolean().default(false),
  })
  .strict();
export type MT5OrderRequest = z.infer<typeof mt5OrderRequestSchema>;
