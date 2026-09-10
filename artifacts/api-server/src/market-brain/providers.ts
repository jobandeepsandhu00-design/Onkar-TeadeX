import {
  timeframeMs,
  type Candle,
  type Timeframe,
  type AIExplanation,
} from "@workspace/api-zod";
import { validClosedBars } from "./calculations";

export type ProviderHealth = {
  status: "connected" | "offline" | "unconfigured" | "degraded" | "optional";
  checkedAt: string;
  latencyMs: number | null;
  message: string;
};
export type SymbolInfo = {
  symbol: string;
  providerSymbol: string;
  assetClass: "forex" | "commodity" | "index" | "crypto" | "stock";
  volumeType: "exchange" | "tick" | "unavailable";
};
export interface MarketDataProvider {
  name: string;
  capabilities: { quotes: boolean; websocket: boolean; historical: boolean };
  getSymbols(): Promise<SymbolInfo[]>;
  getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]>;
  getQuote(symbol: string): Promise<{ price: number; timestamp: string }>;
  getMarketStatus(symbol: string): Promise<"open" | "closed" | "unknown">;
  healthCheck(): Promise<ProviderHealth>;
  subscribeBars?: (
    symbols: string[],
    timeframe: Timeframe,
    callback: (bar: Candle) => void,
  ) => () => void;
  subscribeQuotes?: (
    symbols: string[],
    callback: (quote: {
      symbol: string;
      price: number;
      timestamp: string;
    }) => void,
  ) => () => void;
  reconnect(): Promise<void>;
}
export interface EconomicCalendarProvider {
  getEvents(from: number, to: number): Promise<EconomicEvent[]>;
  healthCheck(): Promise<ProviderHealth>;
}
export type EconomicEvent = {
  title: string;
  currency: string;
  time: number;
  impact: "high" | "medium" | "low";
};
export interface AIProvider {
  explain(context: unknown): Promise<{
    output: AIExplanation;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}
export interface MCPProvider {
  healthCheck(): Promise<ProviderHealth>;
  getChartState(): Promise<unknown>;
}
export interface VisionProvider {
  confirm(
    snapshotKey: string,
    context: unknown,
  ): Promise<{ pass: boolean; reasons: string[] }>;
}
export interface ChartProvider {
  bars(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]>;
}
export interface NotificationProvider {
  deliver(id: string, userId: string, message: string): Promise<void>;
}
export interface StorageProvider {
  signRead(key: string): Promise<string>;
}
export interface BrokerProvider {
  validatePlan(plan: unknown): Promise<boolean>;
}
export async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(12_000),
    });
    if (response.ok) return response.json();
    if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
      const retry = Math.min(
        3000,
        Math.max(
          250,
          Number(response.headers.get("retry-after") || 0) * 1000 ||
            300 * 2 ** attempt,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, retry));
      continue;
    }
    // Never include credential-bearing provider URLs or response bodies in errors.
    throw new Error(`Provider request failed (${response.status})`);
  }
  throw new Error("Provider request failed");
}
const tdIntervals: Record<Timeframe, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1D": "1day",
  "1W": "1week",
};
export class TwelveDataProvider implements MarketDataProvider {
  name = "twelvedata";
  // REST close-of-candle scanner. Streaming is supplied by a separate worker adapter when installed.
  capabilities = { quotes: true, websocket: false, historical: true };
  constructor(
    private key: string | undefined = process.env.TWELVE_DATA_API_KEY ||
      process.env.MARKET_DATA_API_KEY,
  ) {}
  private async request(endpoint: string, params: Record<string, string>) {
    if (!this.key)
      throw new Error(
        "Twelve Data is not configured. Add TWELVE_DATA_API_KEY on the server.",
      );
    const q = new URLSearchParams({
      ...params,
      apikey: this.key,
      timezone: "UTC",
    });
    const data = (await fetchJson(
      `https://api.twelvedata.com/${endpoint}?${q}`,
    )) as Record<string, unknown>;
    if (data.status === "error")
      throw new Error(
        `Twelve Data returned an error (${Number(data.code) || 502}). Check coverage and quota.`,
      );
    return data;
  }
  private symbol(raw: string) {
    const map = JSON.parse(process.env.MARKET_SYMBOL_MAP || "{}") as Record<
      string,
      string
    >;
    if (map[raw]) return map[raw];
    return /^(EUR|USD|GBP|AUD|NZD|CHF|CAD|JPY|XAU|XAG)(EUR|USD|GBP|AUD|NZD|CHF|CAD|JPY)$/.test(
      raw,
    )
      ? `${raw.slice(0, 3)}/${raw.slice(3)}`
      : raw;
  }
  async getSymbols(): Promise<SymbolInfo[]> {
    const data = await this.request("forex_pairs", {});
    if (!Array.isArray(data.data))
      throw new Error("Provider symbol list unavailable");
    return (data.data as Array<{ symbol: string }>).map((s) => ({
      symbol: s.symbol.replace("/", ""),
      providerSymbol: s.symbol,
      assetClass: "forex",
      volumeType: "unavailable",
    }));
  }
  async getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ) {
    const data = await this.request("time_series", {
      symbol: this.symbol(symbol),
      interval: tdIntervals[timeframe],
      start_date: new Date(from).toISOString().slice(0, 19).replace("T", " "),
      end_date: new Date(to).toISOString().slice(0, 19).replace("T", " "),
      outputsize: "300",
      format: "JSON",
    });
    if (!Array.isArray(data.values))
      throw new Error("Provider returned no candle history");
    return validClosedBars(
      (data.values as Array<Record<string, string>>).map((v) => ({
        t: Date.parse(
          v.datetime.length === 10
            ? `${v.datetime}T00:00:00Z`
            : `${v.datetime.replace(" ", "T")}Z`,
        ),
        o: Number(v.open),
        h: Number(v.high),
        l: Number(v.low),
        c: Number(v.close),
        v: v.volume === undefined ? null : Number(v.volume),
      })),
      timeframe,
      to,
    ).filter((c) => c.t >= from);
  }
  async getQuote(symbol: string) {
    const q = await this.request("quote", { symbol: this.symbol(symbol) });
    const price = Number(q.close),
      timestamp = Number(q.timestamp);
    if (!(price > 0) || !Number.isFinite(timestamp))
      throw new Error("Invalid provider quote");
    return { price, timestamp: new Date(timestamp * 1000).toISOString() };
  }
  async getMarketStatus(_symbol: string): Promise<"unknown"> {
    return "unknown";
  }
  async reconnect() {
    /* REST requests reconnect independently. */
  }
  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    if (!this.key)
      return {
        status: "unconfigured",
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        message: "Market-data API key required",
      };
    try {
      await this.getQuote("EURUSD");
      return {
        status: "connected",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        message: "Twelve Data quote verified; symbol entitlement varies",
      };
    } catch (e) {
      return {
        status: "offline",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        message: e instanceof Error ? e.message : "Provider unavailable",
      };
    }
  }
}
export class CoinbaseProvider implements MarketDataProvider {
  name = "coinbase";
  capabilities = { quotes: true, websocket: false, historical: true };
  private symbol(raw: string) {
    return raw.includes("-") ? raw : raw.replace(/(USD|EUR|USDT)$/, "-$1");
  }
  async getSymbols(): Promise<SymbolInfo[]> {
    const rows = (await fetchJson(
      "https://api.exchange.coinbase.com/products",
    )) as Array<{ id: string }>;
    return rows.map((r) => ({
      symbol: r.id,
      providerSymbol: r.id,
      assetClass: "crypto",
      volumeType: "exchange",
    }));
  }
  async getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]> {
    const step =
      timeframe === "30m"
        ? 900
        : timeframe === "4h"
          ? 3600
          : timeframe === "1W"
            ? 86400
            : timeframeMs[timeframe] / 1000;
    const result: Candle[] = [];
    // Bound backfill work; 250 execution bars are sufficient for scanner warmup.
    for (let end = to, page = 0; end > from && page < 8; page++) {
      const start = Math.max(from, end - step * 299 * 1000);
      const q = new URLSearchParams({
        granularity: String(step),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      });
      const rows = await fetchJson(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(this.symbol(symbol))}/candles?${q}`,
      );
      if (!Array.isArray(rows)) throw new Error("Invalid Coinbase candles");
      result.push(
        ...rows.map((r: number[]) => ({
          t: r[0] * 1000,
          l: r[1],
          h: r[2],
          o: r[3],
          c: r[4],
          v: r[5],
        })),
      );
      end = start;
    }
    const unique = [...new Map(result.map((c) => [c.t, c])).values()].sort(
      (a, b) => a.t - b.t,
    );
    if (step * 1000 === timeframeMs[timeframe])
      return validClosedBars(
        unique.filter((c) => c.t >= from),
        timeframe,
        to,
      );
    const groups = new Map<number, Candle[]>();
    const offset = timeframe === "1W" ? 4 * 86400e3 : 0; // Monday UTC, not epoch Thursday.
    for (const c of unique) {
      const t =
        Math.floor((c.t - offset) / timeframeMs[timeframe]) *
          timeframeMs[timeframe] +
        offset;
      groups.set(t, [...(groups.get(t) || []), c]);
    }
    return validClosedBars(
      [...groups.entries()]
        .filter(
          ([t, rows]) =>
            t >= from && rows.length === timeframeMs[timeframe] / (step * 1000),
        )
        .map(([t, rows]) => ({
          t,
          o: rows[0].o,
          h: Math.max(...rows.map((c) => c.h)),
          l: Math.min(...rows.map((c) => c.l)),
          c: rows.at(-1)!.c,
          v: rows.reduce((sum, c) => sum + (c.v || 0), 0),
        })),
      timeframe,
      to,
    );
  }
  async getQuote(symbol: string) {
    const q = (await fetchJson(
      `https://api.exchange.coinbase.com/products/${encodeURIComponent(this.symbol(symbol))}/ticker`,
    )) as { price: string; time: string };
    if (!(Number(q.price) > 0) || !Number.isFinite(Date.parse(q.time)))
      throw new Error("Invalid Coinbase quote");
    return { price: Number(q.price), timestamp: q.time };
  }
  async getMarketStatus(_symbol: string): Promise<"open"> {
    return "open";
  }
  async reconnect() {
    /* REST requests reconnect independently. */
  }
  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.getQuote("BTC-USD");
      return {
        status: "connected",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        message: "Coinbase public crypto data verified",
      };
    } catch {
      return {
        status: "offline",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        message: "Coinbase data unavailable",
      };
    }
  }
}
export const getMarketProvider = (name: string): MarketDataProvider =>
  name === "coinbase" ? new CoinbaseProvider() : new TwelveDataProvider();
