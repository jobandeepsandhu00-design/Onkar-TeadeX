import {
  mt5AccountSchema,
  mt5AccountIdentitySchema,
  mt5BrokerSnapshotSchema,
  mt5CandleBundleSchema,
  mt5HistoryTradeSchema,
  mt5OrderRequestSchema,
  mt5PendingOrderSchema,
  mt5PositionSchema,
  type MT5BrokerSnapshot,
  type MT5CandleBundle,
  type MT5CandleBundleTimeframe,
  type MT5OrderRequest,
  type MT5SymbolSpec as MT5SymbolSpecContract,
  type MT5Tick as MT5TickContract,
} from "@workspace/api-zod";

export class MT5BridgeError extends Error {
  constructor(
    message: string,
    public status = 503,
    /** True only when a trade POST may have reached MT5 without a response. */
    public deliveryUncertain = false,
  ) {
    super(message);
  }
}

const PLACEHOLDER_KEY_MARKERS = [
  "replacewith",
  "changeme",
  "placeholder",
  "example",
  "sample",
  "dummy",
  "samebridgekey",
  "randomsecretofatleast",
] as const;

function shannonEntropy(value: string) {
  const counts = new Map<string, number>();
  for (const character of value)
    counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function isRepeatedPattern(value: string) {
  for (let width = 1; width <= Math.floor(value.length / 2); width += 1) {
    if (
      value.length % width === 0 &&
      value === value.slice(0, width).repeat(value.length / width)
    )
      return true;
  }
  return false;
}

function isSecureBridgeKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    Buffer.byteLength(key, "utf8") >= 32 &&
    !PLACEHOLDER_KEY_MARKERS.some((marker) => normalized.includes(marker)) &&
    new Set(key).size >= 10 &&
    shannonEntropy(key) >= 3.0 &&
    !isRepeatedPattern(key)
  );
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function resolveMT5BridgeConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawUrl = env.MT5_BRIDGE_URL?.trim();
  const key = env.MT5_BRIDGE_API_KEY?.trim();
  if (!rawUrl || !key)
    throw new MT5BridgeError("MT5 bridge is not configured", 503);
  if (!isSecureBridgeKey(key))
    throw new MT5BridgeError(
      "MT5 bridge API key must be a high-entropy, non-placeholder secret",
      503,
    );

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new MT5BridgeError("MT5 bridge URL is invalid", 503);
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new MT5BridgeError("MT5 bridge URL must use HTTP or HTTPS", 503);
  if (parsed.username || parsed.password)
    throw new MT5BridgeError(
      "MT5 bridge URL must not contain embedded credentials",
      503,
    );

  const cleartextAllowed =
    isLoopbackHostname(parsed.hostname) ||
    env.MT5_BRIDGE_ALLOW_INSECURE_PRIVATE_DEVELOPMENT === "true";
  if (parsed.protocol === "http:" && !cleartextAllowed)
    throw new MT5BridgeError(
      "MT5 bridge URL must use HTTPS outside loopback",
      503,
    );

  return { url: parsed.toString().replace(/\/$/, ""), key };
}

const configured = () => resolveMT5BridgeConfig();

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
    throw new MT5BridgeError(
      "MT5 bridge is unreachable",
      503,
      path === "/trade/execute",
    );
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new MT5BridgeError(
      String(body.detail || "MT5 bridge request failed"),
      response.status >= 400 && response.status < 500 ? response.status : 503,
      // Any execute-endpoint error is conservatively ambiguous: order_send
      // may have succeeded before an internal audit or response failure.
      path === "/trade/execute",
    );
  return body as T;
}

export async function getMT5Account(signal?: AbortSignal) {
  return mt5AccountSchema.parse(await mt5BridgeRequest("/account", { signal }));
}

/** Server-only identity. Do not return this value from an HTTP browser route. */
export async function getMT5AccountIdentity(signal?: AbortSignal) {
  return mt5AccountIdentitySchema.parse(
    await mt5BridgeRequest("/account/identity", { signal }),
  );
}

/**
 * Read account, exposure, and optional symbol market state in one serialized
 * bridge operation. This contract is server-only because it carries the
 * opaque account fingerprint used for exact selected-account binding.
 */
export async function getMT5BrokerSnapshot(
  expectedAccountFingerprint: string,
  symbol?: string,
  signal?: AbortSignal,
): Promise<MT5BrokerSnapshot> {
  if (!/^[a-f0-9]{64}$/.test(expectedAccountFingerprint))
    throw new MT5BridgeError("Invalid expected MT5 account fingerprint", 400);
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return mt5BrokerSnapshotSchema.parse(
    await mt5BridgeRequest(`/snapshot${query}`, {
      signal,
      headers: {
        "X-Expected-Account-Fingerprint": expectedAccountFingerprint,
      },
    }),
  );
}

/**
 * Fetch every MT5 timeframe needed by one scanner/chart decision in a single
 * account- and symbol-locked bridge operation.
 */
export async function getMT5CandleBundle(
  expectedAccountFingerprint: string,
  symbol: string,
  timeframes: readonly MT5CandleBundleTimeframe[],
  count = 300,
  signal?: AbortSignal,
): Promise<MT5CandleBundle> {
  if (!/^[a-f0-9]{64}$/.test(expectedAccountFingerprint))
    throw new MT5BridgeError("Invalid expected MT5 account fingerprint", 400);
  const requested = [...new Set(timeframes)];
  if (!requested.length)
    throw new MT5BridgeError("Choose at least one MT5 timeframe", 400);
  const compactSymbol = symbol.toUpperCase().replace(/[\/:.^_-]/g, "");
  const bridgeSymbol =
    compactSymbol.length === 6
      ? `${compactSymbol.slice(0, 3)}/${compactSymbol.slice(3)}`
      : symbol;
  const safeCount = Math.max(2, Math.min(2_000, Math.trunc(count)));
  const query = new URLSearchParams({
    timeframes: requested.join(","),
    count: String(safeCount),
  });
  return mt5CandleBundleSchema.parse(
    await mt5BridgeRequest(
      `/market/snapshot/${encodeURIComponent(bridgeSymbol)}?${query.toString()}`,
      {
        signal,
        headers: {
          "X-Expected-Account-Fingerprint": expectedAccountFingerprint,
        },
      },
    ),
  );
}

export async function getMT5Positions() {
  const result = await mt5BridgeRequest<{ positions: unknown[] }>("/positions");
  return mt5PositionSchema.array().parse(result.positions);
}

export async function getMT5TradeHistory(days = 30) {
  const safeDays = Math.max(1, Math.min(365, Math.trunc(days)));
  const result = await mt5BridgeRequest<{ trades: unknown[] }>(
    `/history/deals?days=${safeDays}`,
  );
  return mt5HistoryTradeSchema.array().parse(result.trades);
}

export function getMT5Orders() {
  return mt5BridgeRequest<{ orders: unknown[] }>("/orders").then((result) => ({
    orders: mt5PendingOrderSchema.array().parse(result.orders),
  }));
}

export type MT5Reconciliation = {
  positions: number;
  orders: number;
  resolvedRequests: Array<Record<string, unknown>>;
  unresolvedRequests: Array<{
    requestId: string;
    ageSeconds: number;
    state:
      | "AWAITING_BROKER_HISTORY"
      | "MANUAL_REVIEW"
      | "ACCOUNT_CHANGED"
      | "ACCOUNT_MISMATCH";
  }>;
  reconciledAt: number;
};

export function reconcileMT5State() {
  return mt5BridgeRequest<MT5Reconciliation>("/reconcile", {
    method: "POST",
  });
}

export type MT5ExecutionLookup = {
  requestId: string;
  state:
    | "ARMED"
    | "CLAIMED"
    | "CANCELLED"
    | "RESERVED"
    | "COMPLETED"
    | "NOT_FOUND";
  resolved: boolean;
  reconciliationState?:
    | "AWAITING_BROKER_HISTORY"
    | "MANUAL_REVIEW"
    | "ACCOUNT_CHANGED"
    | "ACCOUNT_MISMATCH";
  ageSeconds?: number | null;
  result: Record<string, unknown> | null;
};

export function getMT5ExecutionResult(requestId: string) {
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestId))
    throw new MT5BridgeError("Invalid MT5 execution request id", 400);
  return mt5BridgeRequest<MT5ExecutionLookup>(
    `/trade/result/${encodeURIComponent(requestId)}`,
  );
}

export type MT5SymbolSpec = MT5SymbolSpecContract;

export type MT5Tick = MT5TickContract;

export function getMT5SymbolSpec(symbol: string) {
  return mt5BridgeRequest<MT5SymbolSpec>(
    `/symbols/${encodeURIComponent(symbol)}/spec`,
  );
}

export function getMT5Tick(symbol: string) {
  return mt5BridgeRequest<MT5Tick>(`/tick/${encodeURIComponent(symbol)}`);
}

export async function checkMT5Order(
  input: unknown,
  expectedAccountFingerprint?: string,
  expectedBrokerSymbol?: string,
) {
  const order = mt5OrderRequestSchema.parse(input);
  return mt5BridgeRequest<Record<string, unknown>>("/trade/check", {
    method: "POST",
    headers: {
      ...(expectedAccountFingerprint
        ? { "X-Expected-Account-Fingerprint": expectedAccountFingerprint }
        : {}),
      ...(expectedBrokerSymbol
        ? { "X-Expected-Broker-Symbol": expectedBrokerSymbol }
        : {}),
    },
    body: JSON.stringify(order),
  });
}

export async function executeMT5Order(
  input: unknown,
  expectedAccountFingerprint?: string,
  expectedBrokerSymbol?: string,
) {
  const order: MT5OrderRequest = mt5OrderRequestSchema.parse(input);
  if (!order.confirmed)
    throw new MT5BridgeError("Manual confirmation is required", 400);
  return mt5BridgeRequest<Record<string, unknown>>("/trade/execute", {
    method: "POST",
    headers: {
      ...(expectedAccountFingerprint
        ? { "X-Expected-Account-Fingerprint": expectedAccountFingerprint }
        : {}),
      ...(expectedBrokerSymbol
        ? { "X-Expected-Broker-Symbol": expectedBrokerSymbol }
        : {}),
    },
    body: JSON.stringify(order),
  });
}

export async function claimMT5Order(
  input: unknown,
  expectedAccountFingerprint: string,
  expectedBrokerSymbol: string,
) {
  const order: MT5OrderRequest = mt5OrderRequestSchema.parse(input);
  if (!order.confirmed)
    throw new MT5BridgeError("Manual confirmation is required", 400);
  return mt5BridgeRequest<Record<string, unknown>>("/trade/claim", {
    method: "POST",
    headers: {
      "X-Expected-Account-Fingerprint": expectedAccountFingerprint,
      "X-Expected-Broker-Symbol": expectedBrokerSymbol,
    },
    body: JSON.stringify(order),
  });
}
