import {
  timeframeMs,
  type Candle,
  type Timeframe,
} from "@workspace/api-zod";
import type {
  MarketDataProvider,
  ProviderHealth,
  SymbolInfo,
} from "./providers";
import { mt5BridgeRequest } from "../mt5/client";

type BridgeCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume: number;
  isClosed: boolean;
};
type Tick = {
  symbol: string;
  brokerSymbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: number;
  spread: number;
  tickVolume: number;
  state: "CONNECTED" | "STALE" | "MARKET_CLOSED" | "DISCONNECTED";
  approximateLatencyMs: number;
};

const internalSymbol = (symbol: string) => {
  const raw = symbol.replace(/[/-]/g, "").toUpperCase();
  return raw === "XAUUSD" ? "XAU/USD" : `${raw.slice(0, 3)}/${raw.slice(3)}`;
};

export class MT5Provider implements MarketDataProvider {
  name = "mt5";
  capabilities = { quotes: true, websocket: true, historical: true };

  async getSymbols(): Promise<SymbolInfo[]> {
    const result = await mt5BridgeRequest<{
      watchlist: Array<{
        internal: string;
        broker: string | null;
        confidence: number;
      }>;
    }>("/symbols");
    return result.watchlist
      .filter((item) => item.broker)
      .map((item) => ({
        symbol: item.internal.replace("/", ""),
        providerSymbol: item.broker!,
        assetClass: item.internal === "XAU/USD" ? "commodity" : "forex",
        volumeType: "tick",
      }));
  }

  private async bars(symbol: string, timeframe: Timeframe) {
    if (!["15m", "30m", "1h", "4h"].includes(timeframe))
      throw new Error(`MT5 bridge timeframe ${timeframe} is not enabled`);
    const result = await mt5BridgeRequest<{ candles: BridgeCandle[] }>(
      `/candles/${encodeURIComponent(internalSymbol(symbol))}?timeframe=${timeframe}&count=300`,
    );
    return result.candles
      .map((bar) => ({
        t: bar.time * 1000,
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        v: bar.tick_volume,
        closed: bar.isClosed,
      }))
      .sort((a, b) => a.t - b.t);
  }

  async getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]> {
    return (await this.bars(symbol, timeframe))
      .filter((bar) => bar.closed && bar.t >= from && bar.t + timeframeMs[timeframe] <= to)
      .map(({ closed: _closed, ...bar }) => bar);
  }

  async getBarsIncludingOpen(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]> {
    return (await this.bars(symbol, timeframe)).filter(
      (bar) => bar.t >= from && bar.t <= to,
    );
  }

  async getQuote(symbol: string) {
    const tick = await mt5BridgeRequest<Tick>(
      `/tick/${encodeURIComponent(internalSymbol(symbol))}`,
    );
    const price = tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2;
    return {
      price,
      timestamp: new Date(tick.timestamp).toISOString(),
      bid: tick.bid,
      ask: tick.ask,
      spread: tick.spread,
      brokerSymbol: tick.brokerSymbol,
      state: tick.state,
      approximateLatencyMs: tick.approximateLatencyMs,
    };
  }

  async getMarketStatus(symbol: string) {
    const tick = await this.getQuote(symbol);
    return tick.state === "MARKET_CLOSED"
      ? ("closed" as const)
      : tick.state === "CONNECTED"
        ? ("open" as const)
        : ("unknown" as const);
  }

  async reconnect() {
    await mt5BridgeRequest("/health");
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const result = await mt5BridgeRequest<{ status: string; broker?: string }>(
        "/health",
      );
      return {
        status: result.status === "CONNECTED" ? "connected" : "offline",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        message:
          result.status === "CONNECTED"
            ? `Connected to ${result.broker || "MT5 broker"}`
            : "MT5 terminal disconnected",
      };
    } catch (error) {
      return {
        status:
          process.env.MT5_BRIDGE_URL && process.env.MT5_BRIDGE_API_KEY
            ? "offline"
            : "unconfigured",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : "MT5 unavailable",
      };
    }
  }
}
