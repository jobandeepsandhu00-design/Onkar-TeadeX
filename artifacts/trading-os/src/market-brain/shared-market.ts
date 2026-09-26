import {
  sharedMarketSnapshotSchema,
  type SharedChartProvider,
  type SharedChartSymbol,
  type SharedChartTimeframe,
  type SharedMarketSnapshot,
} from "@workspace/api-zod";
import { getAccessToken } from "../api";

const cache = new Map<
  string,
  { expiresAt: number; promise: Promise<SharedMarketSnapshot> }
>();
let cacheSessionToken: string | null = null;

function waitForSharedResult(
  promise: Promise<SharedMarketSnapshot>,
  signal?: AbortSignal,
) {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.reject(
      new DOMException("The request was aborted.", "AbortError"),
    );
  return new Promise<SharedMarketSnapshot>((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("The request was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function fetchSharedMarket(
  symbol: SharedChartSymbol,
  timeframe: SharedChartTimeframe,
  signal?: AbortSignal,
  provider?: SharedChartProvider,
  force = false,
) {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to view verified market data.");
  if (cacheSessionToken !== token) {
    cache.clear();
    cacheSessionToken = token;
  }
  const key = `${provider ?? "configured"}:${symbol}:${timeframe}`;
  // The dedicated MT5 terminal represents whichever broker account is
  // connected at this instant. Never reuse a browser-level snapshot after an
  // account/server switch; the backend applies the same strict isolation.
  const bypassCache = provider === "mt5";
  const current = cache.get(key);
  if (!force && !bypassCache && current && current.expiresAt > Date.now())
    return waitForSharedResult(current.promise, signal);
  const promise = (async () => {
    const response = await fetch(
      `/api/market-brain/shared-market?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`,
      {
        signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        String(body.error || "Shared market data is unavailable."),
      );
    return sharedMarketSnapshotSchema.parse(body);
  })();
  if (!bypassCache) {
    cache.set(key, { expiresAt: Date.now() + 10_000, promise });
    promise.catch(() => cache.delete(key));
  }
  return waitForSharedResult(promise, signal);
}
