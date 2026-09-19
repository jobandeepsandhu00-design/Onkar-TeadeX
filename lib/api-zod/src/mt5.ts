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
  tradingEnabled: z.boolean(),
  liveTradingAllowed: z.boolean(),
});
export type MT5Account = z.infer<typeof mt5AccountSchema>;

export const mt5PositionSchema = z.object({
  ticket: z.number().int().nonnegative(),
  symbol: z.string(),
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

export const mt5OrderRequestSchema = z
  .object({
    requestId: z.string().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/),
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

