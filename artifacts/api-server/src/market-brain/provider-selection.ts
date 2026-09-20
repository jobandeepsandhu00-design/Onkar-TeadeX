import type { ProviderHealth } from "./providers";
import { getMarketProvider } from "./providers";

export type ScannerMarketProvider = "mt5" | "twelvedata" | "coinbase";

export type ProviderSelection = {
  requested: ScannerMarketProvider;
  active: ScannerMarketProvider;
  fallback: boolean;
  requestedHealth: ProviderHealth;
  activeHealth: ProviderHealth;
  warning: string | null;
};

/** The environment value is a boot default; an explicit saved profile wins. */
export const configuredPrimary = (saved?: string): ScannerMarketProvider =>
  saved === "mt5" || saved === "twelvedata" || saved === "coinbase"
    ? saved
    : process.env.PRIMARY_MARKET_PROVIDER === "mt5" ||
        process.env.PRIMARY_MARKET_PROVIDER === "twelvedata" ||
        process.env.PRIMARY_MARKET_PROVIDER === "coinbase"
      ? process.env.PRIMARY_MARKET_PROVIDER
      : "twelvedata";

const fallbackEnabled = () =>
  process.env.MARKET_DATA_FALLBACK_ENABLED === "true";

/**
 * Resolve the feed once per scanner run. Every chart, deterministic agent and
 * setup evaluation consumes candles stored under the returned provider name.
 * This prevents ten agents from independently calling either upstream.
 */
export async function selectScannerMarketProvider(
  savedProvider: string,
): Promise<ProviderSelection> {
  const requested = configuredPrimary(savedProvider);
  // Non-broker feeds are verified by the actual candle request immediately
  // after selection. Avoid an extra quote request on every worker cycle.
  if (requested !== "mt5") {
    const health: ProviderHealth = {
      status: "connected",
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      message: `${requested} selected; candle access is verified during ingestion.`,
    };
    return {
      requested,
      active: requested,
      fallback: false,
      requestedHealth: health,
      activeHealth: health,
      warning: null,
    };
  }
  const requestedHealth = await getMarketProvider(requested).healthCheck();
  if (requestedHealth.status === "connected")
    return {
      requested,
      active: requested,
      fallback: false,
      requestedHealth,
      activeHealth: requestedHealth,
      warning: null,
    };

  if (requested === "mt5" && fallbackEnabled()) {
    const activeHealth = await getMarketProvider("twelvedata").healthCheck();
    if (activeHealth.status === "connected")
      return {
        requested,
        active: "twelvedata",
        fallback: true,
        requestedHealth,
        activeHealth,
        warning:
          "MT5 is unavailable. Scanner is using Twelve Data fallback; broker execution remains locked.",
      };
  }

  throw new Error(
    requested === "mt5"
      ? `MT5 market feed is ${requestedHealth.status}; Twelve Data fallback is unavailable or disabled.`
      : `Twelve Data market feed is ${requestedHealth.status}.`,
  );
}
