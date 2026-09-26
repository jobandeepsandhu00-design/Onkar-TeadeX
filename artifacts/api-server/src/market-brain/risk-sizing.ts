import {
  getMT5SymbolSpec,
  type MT5SymbolSpec,
} from "../mt5/client";
import { getMarketProvider } from "./providers";

export type InstrumentSizing = {
  symbol: string;
  contractSize: number;
  profitCurrency: string;
  accountCurrency: string;
  conversionRate: number;
  safetyFactor?: number;
  valuePerPriceUnit: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  source:
    | "TWELVE_DATA_PAPER_STANDARD"
    | "ECB_REFERENCE_FALLBACK"
    | "MT5_BROKER_SPEC"
    | "MANUAL";
};

type QuoteLoader = (
  symbol: string,
) => Promise<{ price: number; timestamp: string }>;

const currencies = new Set([
  "AUD",
  "CAD",
  "CHF",
  "EUR",
  "GBP",
  "JPY",
  "NZD",
  "SGD",
  "USD",
]);

const normalize = (symbol: string) =>
  symbol.toUpperCase().replace(/[\/:.^_-]/g, "");

/**
 * Onkar Paper has explicit, deterministic contracts. Twelve Data supplies the
 * price and conversion rate; it is not treated as a broker specification.
 */
export function paperContract(symbol: string) {
  const normalized = normalize(symbol);
  if (normalized === "XAUUSD")
    return {
      contractSize: 100,
      profitCurrency: "USD",
      volumeMin: 0.01,
      volumeMax: 100,
      volumeStep: 0.01,
    };
  if (normalized === "XAGUSD")
    return {
      contractSize: 5_000,
      profitCurrency: "USD",
      volumeMin: 0.01,
      volumeMax: 100,
      volumeStep: 0.01,
    };
  const base = normalized.slice(0, 3);
  const quote = normalized.slice(3, 6);
  if (normalized.length === 6 && currencies.has(base) && currencies.has(quote))
    return {
      contractSize: 100_000,
      profitCurrency: quote,
      volumeMin: 0.01,
      volumeMax: 200,
      volumeStep: 0.01,
    };
  return null;
}

export async function resolveCurrencyConversion(
  from: string,
  to: string,
  loadQuote: QuoteLoader,
) {
  if (from === to) return 1;
  try {
    const direct = await loadQuote(`${from}${to}`);
    if (direct.price > 0) return direct.price;
  } catch {
    // Some feeds expose only the inverse pair. Try it before declaring the
    // account-currency conversion unavailable.
  }
  const inverse = await loadQuote(`${to}${from}`);
  if (!(inverse.price > 0))
    throw new Error(`No ${from}/${to} conversion rate is available.`);
  return 1 / inverse.price;
}

export function conversionFromEcbRates(
  from: string,
  to: string,
  ratesPerEur: Record<string, number>,
) {
  const fromRate = from === "EUR" ? 1 : ratesPerEur[from];
  const toRate = to === "EUR" ? 1 : ratesPerEur[to];
  if (!(fromRate > 0 && toRate > 0)) return null;
  return toRate / fromRate;
}

export async function resolveEcbReferenceConversion(from: string, to: string) {
  if (from === to) return 1;
  const response = await fetch(
    "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok)
    throw new Error(
      `ECB reference rates are unavailable (${response.status}).`,
    );
  const xml = await response.text();
  const rates: Record<string, number> = {};
  for (const match of xml.matchAll(
    /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g,
  ))
    rates[match[1]] = Number(match[2]);
  const rate = conversionFromEcbRates(from, to, rates);
  if (!(rate && rate > 0))
    throw new Error(`ECB has no ${from}/${to} reference conversion.`);
  return rate;
}

export async function resolvePaperInstrumentSizing(
  symbol: string,
  accountCurrency: string,
  loadQuote: QuoteLoader = (pair) =>
    getMarketProvider("twelvedata").getQuote(pair),
): Promise<InstrumentSizing | null> {
  const contract = paperContract(symbol);
  if (!contract) return null;
  const normalizedCurrency = accountCurrency.toUpperCase();
  let conversionRate: number;
  let source: InstrumentSizing["source"] = "TWELVE_DATA_PAPER_STANDARD";
  try {
    conversionRate = await resolveCurrencyConversion(
      contract.profitCurrency,
      normalizedCurrency,
      loadQuote,
    );
  } catch {
    conversionRate = await resolveEcbReferenceConversion(
      contract.profitCurrency,
      normalizedCurrency,
    );
    source = "ECB_REFERENCE_FALLBACK";
  }
  return paperInstrumentSizingFromRate(
    symbol,
    normalizedCurrency,
    conversionRate,
    source,
  );
}

export function paperInstrumentSizingFromRate(
  symbol: string,
  accountCurrency: string,
  conversionRate: number,
  source: InstrumentSizing["source"] = "TWELVE_DATA_PAPER_STANDARD",
): InstrumentSizing | null {
  const contract = paperContract(symbol);
  if (!contract || !(conversionRate > 0)) return null;
  const normalizedCurrency = accountCurrency.toUpperCase();
  const safetyFactor = source === "ECB_REFERENCE_FALLBACK" ? 1.01 : 1;
  return {
    symbol: normalize(symbol),
    ...contract,
    accountCurrency: normalizedCurrency,
    conversionRate,
    safetyFactor,
    valuePerPriceUnit: contract.contractSize * conversionRate * safetyFactor,
    source,
  };
}

export async function resolveMT5InstrumentSizing(
  symbol: string,
  accountCurrency: string,
): Promise<InstrumentSizing> {
  const normalized = normalize(symbol);
  const brokerLookup =
    normalized.length === 6
      ? `${normalized.slice(0, 3)}/${normalized.slice(3)}`
      : symbol;
  const spec = await getMT5SymbolSpec(brokerLookup);
  return mt5InstrumentSizingFromSpec(symbol, accountCurrency, spec);
}

export function mt5InstrumentSizingFromSpec(
  symbol: string,
  accountCurrency: string,
  spec: MT5SymbolSpec,
): InstrumentSizing {
  const normalized = normalize(symbol);
  const tickSize = spec.tickSize || spec.point;
  const tickValue =
    spec.tickValueLoss || spec.tickValue || spec.tickValueProfit;
  if (!(tickSize > 0 && tickValue > 0 && spec.volumeStep > 0))
    throw new Error("MT5 broker symbol sizing is incomplete.");
  return {
    symbol: normalized,
    contractSize: spec.contractSize,
    // MT5 tick value is already returned in the connected account currency.
    profitCurrency: accountCurrency.toUpperCase(),
    accountCurrency: accountCurrency.toUpperCase(),
    conversionRate: 1,
    safetyFactor: 1,
    valuePerPriceUnit: tickValue / tickSize,
    volumeMin: spec.volumeMin,
    volumeMax: spec.volumeMax,
    volumeStep: spec.volumeStep,
    source: "MT5_BROKER_SPEC",
  };
}

export function manualInstrumentSizing(
  symbol: string,
  accountCurrency: string,
  valuePerPriceUnit: number | undefined,
): InstrumentSizing | null {
  if (!(valuePerPriceUnit && valuePerPriceUnit > 0)) return null;
  return {
    symbol: normalize(symbol),
    contractSize: valuePerPriceUnit,
    profitCurrency: accountCurrency.toUpperCase(),
    accountCurrency: accountCurrency.toUpperCase(),
    conversionRate: 1,
    safetyFactor: 1,
    valuePerPriceUnit,
    volumeMin: 0.01,
    volumeMax: 1_000,
    volumeStep: 0.01,
    source: "MANUAL",
  };
}

export async function resolveInstrumentSizing(args: {
  provider: string;
  symbol: string;
  accountCurrency: string;
  manualValue?: number;
}) {
  if (args.provider === "mt5")
    return resolveMT5InstrumentSizing(args.symbol, args.accountCurrency);
  if (args.provider === "twelvedata") {
    const automatic = await resolvePaperInstrumentSizing(
      args.symbol,
      args.accountCurrency,
    );
    if (automatic) return automatic;
  }
  return manualInstrumentSizing(
    args.symbol,
    args.accountCurrency,
    args.manualValue,
  );
}

export function floorVolume(raw: number, step: number) {
  if (!(raw > 0 && step > 0)) return null;
  const precision = Math.min(8, Math.max(0, Math.ceil(-Math.log10(step))));
  return Number((Math.floor((raw + 1e-12) / step) * step).toFixed(precision));
}
