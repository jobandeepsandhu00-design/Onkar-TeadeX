import {
  sharedMarketSnapshotSchema,
  type SharedChartSymbol,
  type SharedChartTimeframe,
  type SharedMarketSnapshot,
} from "@workspace/api-zod";
import { getAccessToken } from "../api";

const cache = new Map<string, { expiresAt: number; promise: Promise<SharedMarketSnapshot> }>();

export async function fetchSharedMarket(
  symbol: SharedChartSymbol,
  timeframe: SharedChartTimeframe,
  signal?: AbortSignal,
) {
  const key = `${symbol}:${timeframe}`;
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.promise;
  const promise = (async () => {
    const token = await getAccessToken();
    if (!token) throw new Error("Please sign in to view verified market data.");
    const response = await fetch(
      `/api/market-brain/shared-market?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
      {
        signal: signal ?? AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(String(body.error || "Shared market data is unavailable."));
    return sharedMarketSnapshotSchema.parse(body);
  })();
  cache.set(key, { expiresAt: Date.now() + 10_000, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

