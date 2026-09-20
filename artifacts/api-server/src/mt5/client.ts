import {
  mt5AccountSchema,
  mt5OrderRequestSchema,
  mt5PositionSchema,
  type MT5OrderRequest,
} from "@workspace/api-zod";

export class MT5BridgeError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}

const configured = () => {
  const url = process.env.MT5_BRIDGE_URL?.replace(/\/$/, "");
  const key = process.env.MT5_BRIDGE_API_KEY;
  if (!url || !key || key.length < 32)
    throw new MT5BridgeError("MT5 bridge is not configured", 503);
  return { url, key };
};

export async function mt5BridgeRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { url, key } = configured();
  const response = await fetch(`${url}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: {
      "X-Bridge-Api-Key": key,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  }).catch(() => {
    throw new MT5BridgeError("MT5 bridge is unreachable");
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new MT5BridgeError(
      String(body.detail || "MT5 bridge request failed"),
      response.status >= 400 && response.status < 500 ? response.status : 503,
    );
  return body as T;
}

export async function getMT5Account(signal?: AbortSignal) {
  return mt5AccountSchema.parse(await mt5BridgeRequest("/account", { signal }));
}

export async function getMT5Positions() {
  const result = await mt5BridgeRequest<{ positions: unknown[] }>("/positions");
  return mt5PositionSchema.array().parse(result.positions);
}

export type MT5HistoryTrade = {
  positionTicket: number;
  symbol: string;
  direction: "BUY" | "SELL";
  volume: number;
  entryPrice: number;
  entryTime: number;
  exitPrice: number | null;
  exitTime: number | null;
  profitLoss: number | null;
  status: "Open" | "Closed";
};

export async function getMT5TradeHistory(days = 30) {
  const safeDays = Math.max(1, Math.min(365, Math.trunc(days)));
  const result = await mt5BridgeRequest<{ trades: MT5HistoryTrade[] }>(
    `/history/deals?days=${safeDays}`,
  );
  return result.trades;
}

export function getMT5Orders() {
  return mt5BridgeRequest<{ orders: unknown[] }>("/orders");
}

export type MT5SymbolSpec = {
  symbol: string;
  brokerSymbol: string;
  digits: number;
  point: number;
  tickSize: number;
  tickValue: number;
  tickValueProfit: number;
  tickValueLoss: number;
  contractSize: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  stopsLevel: number;
  fillingMode: number;
  executionMode: number;
  tradeMode: number;
};

export type MT5Tick = {
  symbol: string;
  brokerSymbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: number;
  spread: number;
  state: "CONNECTED" | "STALE" | "MARKET_CLOSED" | "DISCONNECTED";
  approximateLatencyMs: number;
};

export function getMT5SymbolSpec(symbol: string) {
  return mt5BridgeRequest<MT5SymbolSpec>(
    `/symbols/${encodeURIComponent(symbol)}/spec`,
  );
}

export function getMT5Tick(symbol: string) {
  return mt5BridgeRequest<MT5Tick>(`/tick/${encodeURIComponent(symbol)}`);
}

export async function checkMT5Order(input: unknown) {
  const order = mt5OrderRequestSchema.parse(input);
  return mt5BridgeRequest<Record<string, unknown>>("/trade/check", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export async function executeMT5Order(input: unknown) {
  const order: MT5OrderRequest = mt5OrderRequestSchema.parse(input);
  if (!order.confirmed)
    throw new MT5BridgeError("Manual confirmation is required", 400);
  return mt5BridgeRequest<Record<string, unknown>>("/trade/execute", {
    method: "POST",
    body: JSON.stringify(order),
  });
}
