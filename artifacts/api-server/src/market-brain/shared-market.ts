import {
  candleClosureSnapshotSchema,
  sharedMarketSnapshotSchema,
  timeframeMs,
  TWELVE_DATA_MIN_CYCLE_SECONDS,
  type Candle,
  type CandleClosureSnapshot,
  type MT5Account,
  type MT5CandleBundle,
  type MT5CandleBundleTimeframe,
  type SharedChartSymbol,
  type SharedChartTimeframe,
  type SharedChartProvider,
  type SharedMarketSnapshot,
  type SetupDetection,
  type Timeframe,
} from "@workspace/api-zod";
import { getMarketProvider } from "./providers";
import { getMT5CandleBundle } from "../mt5/client";
import {
  mt5AccountBindingMatches,
  mt5CandidateProvenanceMatches,
  mt5ScanAccountMatches,
  type MT5AccountBinding,
  type MT5CandidateProvenance,
} from "../mt5/account-identity";
import {
  ScannerError,
  ScannerStore,
  type CandidateRow,
  type ConfigRow,
} from "./store";
import {
  buildGlobalTradingWorkflow,
  GLOBAL_WORKFLOW_TIMEFRAMES,
} from "./global-workflow";

type StoredBar = {
  open_time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
};

const DISPLAY_SYMBOLS: Record<SharedChartSymbol, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  GBPJPY: "GBP/JPY",
  EURJPY: "EUR/JPY",
  AUDUSD: "AUD/USD",
  USDCAD: "USD/CAD",
  NZDUSD: "NZD/USD",
  EURGBP: "EUR/GBP",
  XAUUSD: "XAU/USD",
};
const snapshotPromises = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<{
      candles: Array<Candle & { closed: boolean }>;
      dataStatus: SharedMarketSnapshot["dataStatus"];
      warnings: string[];
    }>;
  }
>();

/** Read the scanner/chart's persisted CLOSED candles without contacting a provider. */
export async function getCandleClosureSnapshot(args: {
  config?: ConfigRow;
  symbol: SharedChartSymbol;
  store?: Pick<ScannerStore, "request">;
}): Promise<CandleClosureSnapshot> {
  const now = Date.now();
  const timeframes = ["15m", "30m", "1h", "4h"] as const;
  const service = args.store ?? ScannerStore.service();
  const requestedProvider =
    args.config?.config.provider === "mt5" ? "mt5" : "twelvedata";
  const read = (provider: "mt5" | "twelvedata") =>
    Promise.all(
      timeframes.map(async (timeframe) => {
        const [row] = await service.request<
          Array<{ open_time: number; ingested_at: string }>
        >("market_candles", {
          select: "open_time,ingested_at",
          provider: `eq.${provider}`,
          symbol: `eq.${args.symbol}`,
          timeframe: `eq.${timeframe}`,
          open_time: `lte.${now - timeframeMs[timeframe]}`,
          order: "open_time.desc",
          limit: "1",
        });
        return {
          timeframe,
          lastClosedOpenTime: row ? Number(row.open_time) : null,
          storedAt: row?.ingested_at ?? null,
        };
      }),
    );
  // Candle-clock cards must describe the configured provider only. An empty
  // MT5 clock is an MT5 availability warning, never permission to display a
  // Twelve Data timestamp under an MT5 label.
  const provider = requestedProvider;
  const candles = await read(provider);
  return candleClosureSnapshotSchema.parse({
    symbol: args.symbol,
    provider,
    fetchedAt: new Date(now).toISOString(),
    candles,
  });
}

type ProviderBar = Candle & { closed?: boolean };

export type SharedMarketCacheMode = "live" | "closed-candle";

export function closedCandleCacheMs(timeframe: Timeframe, now: number) {
  const interval = timeframeMs[timeframe];
  const nextClose = (Math.floor(now / interval) + 1) * interval;
  // Give the provider a short grace period after the boundary so the newly
  // closed candle is available. A failed fetch is shortened below for retry.
  return Math.max(55_000, nextClose - now + 15_000);
}

export function latestClosedCandleOpenTime(
  timeframe: Timeframe,
  now: number,
  providerGraceMs = 15_000,
) {
  const interval = timeframeMs[timeframe];
  const effectiveNow = now - providerGraceMs;
  return Math.floor(effectiveNow / interval) * interval - interval;
}

function uniqueBars(rows: ProviderBar[]) {
  return [...new Map(rows.map((row) => [row.t, row])).values()].sort(
    (a, b) => a.t - b.t,
  );
}

export function mt5BundleMarketEntries(
  bundle: MT5CandleBundle,
  requestedTimeframes: ReadonlySet<Timeframe>,
) {
  return [...requestedTimeframes].map((timeframe) => {
    if (!["15m", "30m", "1h", "4h"].includes(timeframe))
      throw new ScannerError(
        `MT5 does not support chart timeframe ${timeframe}.`,
        400,
      );
    const rows =
      bundle.timeframes[timeframe as MT5CandleBundleTimeframe] ?? [];
    if (!rows.length)
      throw new ScannerError(
        `MT5 returned no ${timeframe} candles for ${bundle.symbol.internalSymbol}.`,
        503,
      );
    const candles = rows.map((bar) => ({
      t: bar.time * 1000,
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.tick_volume,
      closed: bar.isClosed,
    }));
    const hasForming = candles.some((bar) => !bar.closed);
    return [
      timeframe,
      {
        candles,
        dataStatus: hasForming ? ("live" as const) : ("delayed" as const),
        warnings: hasForming
          ? []
          : [
              "MT5 did not return a forming candle; the broker's latest closed candles are shown.",
            ],
      },
    ] as const;
  });
}

export async function sharedProviderCandles(
  service: ScannerStore,
  providerName: "mt5" | "twelvedata",
  symbol: string,
  timeframe: Timeframe,
  now = Date.now(),
  options: {
    cacheMode?: SharedMarketCacheMode;
    strictSource?: boolean;
    providerFactory?: typeof getMarketProvider;
  } = {},
) {
  const cacheMode = options.cacheMode ?? "live";
  const strictSource = options.strictSource === true;
  // A strict MT5 request represents the terminal/account that is connected at
  // the instant of the request. Reusing even a short-lived promise after the
  // operator changes account or broker server can surface candles from the
  // previous session. Keep the shared cache for Twelve Data and non-strict
  // callers, but always ask the bridge again for explicit MT5 reads.
  const bypassSnapshotCache = strictSource && providerName === "mt5";
  const cacheKey = `${providerName}:${symbol}:${timeframe}:${cacheMode}:${strictSource ? "strict" : "shared"}`;
  if (!bypassSnapshotCache) {
    const cachedPromise = snapshotPromises.get(cacheKey);
    if (cachedPromise && cachedPromise.expiresAt > now)
      return cachedPromise.promise;
  }

  const promise = (async () => {
    // A dedicated MT5 chart must show the currently connected broker's exact
    // series. It must not merge rows left by another terminal/account or use a
    // Twelve Data fallback. The normal scanner path keeps its durable closed
    // candle cache; strict MT5 reads come directly from the bridge.
    const stored =
      strictSource && providerName === "mt5"
        ? []
        : await service.request<StoredBar[]>("market_candles", {
            provider: `eq.${providerName}`,
            symbol: `eq.${symbol}`,
            timeframe: `eq.${timeframe}`,
            order: "open_time.desc",
            limit: "300",
          });
    const storedCandles = stored.reverse().map((row) => ({
      t: Number(row.open_time),
      o: row.o,
      h: row.h,
      l: row.l,
      c: row.c,
      v: row.v,
    }));
    const latestStored = storedCandles.at(-1)?.t ?? 0;
    if (
      cacheMode === "closed-candle" &&
      storedCandles.length >= 200 &&
      latestStored >= latestClosedCandleOpenTime(timeframe, now)
    ) {
      return {
        candles: storedCandles
          .slice(-300)
          .map((bar) => ({ ...bar, closed: true })),
        dataStatus: "live" as SharedMarketSnapshot["dataStatus"],
        warnings: [],
      };
    }
    const provider = (options.providerFactory ?? getMarketProvider)(
      providerName,
    );
    const from = storedCandles.at(-1)?.t
      ? Math.max(
          storedCandles.at(-1)!.t - timeframeMs[timeframe],
          now - 300 * timeframeMs[timeframe],
        )
      : now - 300 * timeframeMs[timeframe];
    try {
      const fetched = provider.getBarsIncludingOpen
        ? await provider.getBarsIncludingOpen(symbol, timeframe, from, now)
        : await provider.getHistoricalBars(symbol, timeframe, from, now);
      const all = uniqueBars(
        strictSource && providerName === "mt5"
          ? fetched
          : [...storedCandles, ...fetched],
      ).slice(-300);
      const isClosed = (bar: ProviderBar) =>
        bar.closed ?? bar.t + timeframeMs[timeframe] <= now;
      const closed = all.filter(isClosed);
      if (closed.length && !(strictSource && providerName === "mt5")) {
        await service.request(
          "market_candles",
          { on_conflict: "provider,symbol,timeframe,open_time" },
          "POST",
          closed.map((bar) => ({
            provider: providerName,
            symbol,
            timeframe,
            open_time: bar.t,
            o: bar.o,
            h: bar.h,
            l: bar.l,
            c: bar.c,
            v: bar.v,
          })),
          "resolution=merge-duplicates,return=minimal",
        );
      }
      const hasForming = all.some((bar) => !isClosed(bar));
      return {
        candles: all.map((bar) => ({
          ...bar,
          closed: isClosed(bar),
        })),
        dataStatus: (hasForming
          ? "live"
          : "delayed") as SharedMarketSnapshot["dataStatus"],
        warnings: hasForming
          ? []
          : [
              "The provider did not return a forming candle; the latest closed candles are shown.",
            ],
      };
    } catch {
      return {
        candles: storedCandles
          .slice(-300)
          .map((bar) => ({ ...bar, closed: true })),
        dataStatus: (storedCandles.length
          ? "cached"
          : "unavailable") as SharedMarketSnapshot["dataStatus"],
        warnings: [
          storedCandles.length
            ? `${providerName === "mt5" ? "MT5" : "Twelve Data"} is temporarily unavailable; showing the last stored closed candles.`
            : `${providerName === "mt5" ? "MT5" : "Twelve Data"} returned no candles for this symbol and timeframe.`,
        ],
      };
    }
  })();
  // One provider fetch is shared by every chart and agent. Higher-timeframe
  // context cannot change faster than its candle, so keep it longer and avoid
  // multiplying Twelve Data requests across the ten specialists.
  const cacheMs =
    providerName === "mt5"
      ? 10_000
      : cacheMode === "closed-candle"
        ? closedCandleCacheMs(timeframe, now)
        : TWELVE_DATA_MIN_CYCLE_SECONDS * 1000;
  if (bypassSnapshotCache) return promise;

  snapshotPromises.set(cacheKey, { expiresAt: now + cacheMs, promise });
  void promise.then((result) => {
    if (result.dataStatus !== "cached" && result.dataStatus !== "unavailable")
      return;
    const current = snapshotPromises.get(cacheKey);
    if (current?.promise === promise)
      snapshotPromises.set(cacheKey, {
        ...current,
        expiresAt:
          Date.now() +
          (strictSource && providerName === "mt5" ? 5_000 : 60_000),
      });
  });
  promise.catch(() => snapshotPromises.delete(cacheKey));
  return promise;
}

function detectionStatus(candidate: CandidateRow): SetupDetection["status"] {
  if (["INVALIDATED", "EXPIRED"].includes(candidate.state)) return "INVALID";
  if (["READY", "TRIGGERED", "COMPLETED"].includes(candidate.state))
    return "CONFIRMED";
  if (candidate.state === "WATCH") return "WATCHING";
  return "PARTIAL";
}

export function mapDetection(candidate: CandidateRow): SetupDetection {
  const rules = candidate.payload.rules ?? [];
  const interval = timeframeMs[candidate.timeframe as SharedChartTimeframe];
  const closed =
    !candidate.payload.stale &&
    Number.isFinite(Date.parse(candidate.payload.lastCandleAt)) &&
    Date.parse(candidate.payload.lastCandleAt) + interval <= Date.now();
  const computedStatus = detectionStatus(candidate);
  const workflow = candidate.payload.globalWorkflow;
  const setupWorkflow = candidate.payload.setupWorkflow;
  const status =
    computedStatus === "CONFIRMED" &&
    (!closed ||
      (candidate.payload.globalWorkflowRequired &&
        workflow?.masterStatus !== "ENTRY_READY"))
      ? "PARTIAL"
      : computedStatus;
  const historical = candidate.payload.historical as
    | { sample?: number; averageR?: number | null }
    | undefined;
  const learningInsight = historical?.sample
    ? `${historical.sample} similar personal trades; ${historical.averageR == null ? "average R unavailable" : `${historical.averageR.toFixed(2)}R average`}.`
    : "No sufficient similar closed-trade sample yet.";
  return {
    id: candidate.id,
    symbol: candidate.symbol.replace(/[/-]/g, "") as SharedChartSymbol,
    timeframe: candidate.timeframe as SharedChartTimeframe,
    setup: String(candidate.payload.strategyName || "Approved setup"),
    status,
    direction:
      candidate.payload.direction === "long"
        ? "BUY"
        : candidate.payload.direction === "short"
          ? "SELL"
          : "NONE",
    conditionsMatched:
      setupWorkflow?.conditionsMatched ??
      rules
        .filter((rule) => rule.passed)
        .map((rule) => rule.explanation || rule.id),
    conditionsMissing:
      setupWorkflow?.conditionsMissing ??
      rules
        .filter((rule) => !rule.passed)
        .map((rule) => rule.explanation || rule.id),
    // Only a confirmed server-approved risk plan may be labelled Entry/SL/TP.
    // Partial detections still expose evidence zones below, but never
    // masquerade as executable trade levels on the chart.
    entry: candidate.plan?.entry ?? null,
    stopLoss: candidate.plan?.stop ?? null,
    takeProfit: candidate.plan?.target ?? null,
    riskReward: candidate.plan?.rr ?? null,
    learningInsight,
    reason: `${candidate.payload.passed}/${candidate.payload.total} deterministic rules matched; confluence ${candidate.score}/100.${workflow ? ` Parent workflow: ${workflow.masterStatus.replaceAll("_", " ")}.` : ""}`,
    waitFor:
      status === "CONFIRMED"
        ? "All required confirmation must remain valid on closed candles."
        : setupWorkflow?.waitFor ||
          workflow?.gate.missing[0] ||
          candidate.payload.warnings?.[0] ||
          "Next required rule confirmation on a closed candle.",
    candleClosed: closed,
    decisionCandleAt: candidate.last_candle_at,
    timestamp: candidate.payload.analyzedAt,
    zones: [
      ...(candidate.payload.entryZone
        ? [
            {
              low: candidate.payload.entryZone.low,
              high: candidate.payload.entryZone.high,
              kind: "entry",
            },
          ]
        : []),
      ...[
        workflow?.fourHour.support,
        workflow?.fourHour.resistance,
        workflow?.oneHour.setupZone,
        workflow?.thirtyMinute.support,
        workflow?.thirtyMinute.resistance,
      ]
        .filter((zone): zone is NonNullable<typeof zone> => Boolean(zone))
        .map((zone) => ({
          low: zone.low,
          high: zone.high,
          kind: `${zone.timeframe}:${zone.type}`,
        })),
    ],
  };
}

export type VerifiedMT5ChartContext = {
  selectedAccountId: string;
  accountFingerprint: string;
  brokerSymbol: string;
  binding: MT5AccountBinding;
};

/**
 * Validate one complete MT5 chart read. This check intentionally uses the
 * server-only account fingerprint and the resolved broker symbol; neither is
 * exposed to the browser. Any account/server or symbol remap during the
 * multi-timeframe fetch invalidates the entire response.
 */
export function mt5ChartContextMatches(args: {
  binding: MT5AccountBinding | null | undefined;
  selectedAccountId: string | null | undefined;
  beforeFingerprint: string | null | undefined;
  afterFingerprint: string | null | undefined;
  beforeBrokerSymbol: string | null | undefined;
  afterBrokerSymbol: string | null | undefined;
  quoteBrokerSymbol?: string | null | undefined;
}) {
  return Boolean(
    mt5ScanAccountMatches(
      args.binding,
      args.selectedAccountId,
      args.beforeFingerprint,
      args.afterFingerprint,
    ) &&
    args.beforeBrokerSymbol &&
    args.afterBrokerSymbol &&
    args.beforeBrokerSymbol === args.afterBrokerSymbol &&
    (!args.quoteBrokerSymbol ||
      args.quoteBrokerSymbol === args.beforeBrokerSymbol),
  );
}

export function filterVerifiedMT5ChartCandidates(args: {
  candidates: CandidateRow[];
  provenances: MT5CandidateProvenance[];
  context: VerifiedMT5ChartContext;
}) {
  const provenanceByCandidate = new Map(
    args.provenances.map((row) => [row.candidate_id, row]),
  );
  return args.candidates.filter(
    (candidate) =>
      candidate.payload.provider === "mt5" &&
      candidate.payload.scopeAccountId === args.context.selectedAccountId &&
      mt5CandidateProvenanceMatches(
        provenanceByCandidate.get(candidate.id),
        args.context.binding,
        candidate.id,
        candidate.last_candle_at,
        args.context.selectedAccountId,
        args.context.accountFingerprint,
        args.context.brokerSymbol,
      ),
  );
}

export async function getSharedMarketSnapshot(args: {
  user: ScannerStore;
  config?: ConfigRow;
  symbol: SharedChartSymbol;
  timeframe: SharedChartTimeframe;
  provider?: SharedChartProvider;
  strictProvider?: boolean;
}): Promise<SharedMarketSnapshot> {
  const service = ScannerStore.service();
  const requestedProvider =
    args.provider ??
    (args.config?.config.provider === "mt5" ? "mt5" : "twelvedata");
  const activeProvider: "mt5" | "twelvedata" = requestedProvider;
  const requestedTimeframes = new Set<Timeframe>([
    args.timeframe,
    ...GLOBAL_WORKFLOW_TIMEFRAMES,
  ]);
  let mt5Context: VerifiedMT5ChartContext | null = null;
  let mt5Bundle: MT5CandleBundle | null = null;
  let account: MT5Account | null = null;
  let quote: Awaited<
    ReturnType<ReturnType<typeof getMarketProvider>["getQuote"]>
  > | null = null;
  if (requestedProvider === "mt5") {
    const selectedAccountId = args.config?.config.accountId;
    if (!args.config?.user_id || !selectedAccountId)
      throw new ScannerError(
        "Select and sync the exact imported MT5 account before opening the MT5 chart.",
        409,
      );
    const bindings = await service.request<MT5AccountBinding[]>(
      "mt5_account_bindings",
      {
        user_id: `eq.${args.config.user_id}`,
        selected_account_id: `eq.${selectedAccountId}`,
        select: "selected_account_id,account_fingerprint",
        limit: "1",
      },
    );
    const binding = bindings[0] ?? null;
    if (!binding)
      throw new ScannerError(
        "The selected account has no verified MT5 identity binding. Sync MT5 again before viewing broker candles.",
        409,
      );
    mt5Bundle = await getMT5CandleBundle(
      binding.account_fingerprint,
      args.symbol,
      [...requestedTimeframes] as MT5CandleBundleTimeframe[],
      300,
    );
    if (
      !mt5AccountBindingMatches(
        binding,
        selectedAccountId,
        mt5Bundle.account.accountFingerprint,
      )
    )
      throw new ScannerError(
        "The selected account does not match the connected MT5 terminal. Sync MT5 again before viewing broker candles.",
        409,
      );
    if (!mt5Bundle.symbol.brokerSymbol)
      throw new ScannerError(
        `${args.symbol} has no verified broker symbol mapping for the connected MT5 terminal.`,
        409,
      );
    mt5Context = {
      selectedAccountId,
      accountFingerprint: mt5Bundle.account.accountFingerprint,
      brokerSymbol: mt5Bundle.symbol.brokerSymbol,
      binding,
    };
    const { accountFingerprint: _serverOnlyFingerprint, ...browserAccount } =
      mt5Bundle.account;
    account = browserAccount;
    const tick = mt5Bundle.symbol.tick;
    quote = {
      price: tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2,
      timestamp: new Date(tick.timestamp).toISOString(),
      bid: tick.bid,
      ask: tick.ask,
      spread: tick.spread,
      brokerSymbol: tick.brokerSymbol,
      state: tick.state,
      approximateLatencyMs: tick.approximateLatencyMs,
    };
  }
  const marketEntries =
    requestedProvider === "mt5"
      ? mt5BundleMarketEntries(mt5Bundle!, requestedTimeframes)
      : await Promise.all(
          [...requestedTimeframes].map(
            async (timeframe) =>
              [
                timeframe,
                await sharedProviderCandles(
                  service,
                  "twelvedata",
                  args.symbol,
                  timeframe,
                  Date.now(),
                  {
                    cacheMode:
                      timeframe === args.timeframe ? "live" : "closed-candle",
                    strictSource: args.strictProvider === true,
                  },
                ),
              ] as const,
          ),
        );

  let candidates = await args.user.request<CandidateRow[]>("setup_candidates", {
    ...(args.config ? { config_id: `eq.${args.config.id}` } : {}),
    symbol: `eq.${args.symbol}`,
    "payload->>provider": `eq.${activeProvider}`,
    ...(activeProvider === "mt5" && mt5Context
      ? {
          "payload->>scopeAccountId": `eq.${mt5Context.selectedAccountId}`,
        }
      : {}),
    state: "in.(SCANNING,DEVELOPING,WATCH,READY,TRIGGERED)",
    order: "updated_at.desc",
    limit: "100",
  });
  const accountScopedCandidateCount = candidates.length;
  if (activeProvider === "mt5" && mt5Context && candidates.length) {
    const provenances = await service.request<MT5CandidateProvenance[]>(
      "mt5_candidate_provenance",
      {
        candidate_id: `in.(${candidates.map((candidate) => candidate.id).join(",")})`,
        selected_account_id: `eq.${mt5Context.selectedAccountId}`,
        select:
          "candidate_id,candidate_last_candle_at,selected_account_id,account_fingerprint,broker_symbol",
      },
    );
    candidates = filterVerifiedMT5ChartCandidates({
      candidates,
      provenances,
      context: mt5Context,
    });
  }
  const marketByTimeframe = new Map(marketEntries);
  const selected = marketByTimeframe.get(args.timeframe)!;
  const histories: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [timeframe, market] of marketEntries)
    histories[timeframe] = market.candles
      .filter((candle) => candle.closed)
      .map(({ closed: _closed, ...candle }) => candle);
  const workflow = buildGlobalTradingWorkflow({
    symbol: args.symbol,
    histories,
    now: Date.now(),
    formingThirtyMinute:
      [...(marketByTimeframe.get("30m")?.candles ?? [])]
        .reverse()
        .find((candle) => !candle.closed) ?? null,
  });
  const priority: Record<SetupDetection["status"], number> = {
    CONFIRMED: 0,
    WATCHING: 1,
    PARTIAL: 2,
    INVALID: 3,
  };
  const detections = candidates
    .map(mapDetection)
    .sort(
      (a, b) =>
        priority[a.status] - priority[b.status] ||
        Date.parse(b.timestamp) - Date.parse(a.timestamp),
    );
  const quoteState = quote?.state;
  const dataStatus =
    activeProvider === "mt5" &&
    (quoteState === "STALE" || quoteState === "DISCONNECTED")
      ? selected.candles.length
        ? "cached"
        : "unavailable"
      : selected.dataStatus;
  return sharedMarketSnapshotSchema.parse({
    symbol: args.symbol,
    displaySymbol: DISPLAY_SYMBOLS[args.symbol],
    timeframe: args.timeframe,
    provider: activeProvider,
    dataSource: activeProvider === "mt5" ? "broker" : "primary",
    dataStatus,
    fetchedAt: new Date().toISOString(),
    broker: account?.broker ?? null,
    server: account?.server ?? null,
    accountType: account?.accountType ?? null,
    scopeAccountId: mt5Context?.selectedAccountId ?? null,
    accountIdentityVerified: Boolean(mt5Context),
    quote: quote
      ? {
          bid: quote.bid ?? quote.price,
          ask: quote.ask ?? quote.price,
          last: quote.price,
          spread: quote.spread ?? 0,
          timestamp: quote.timestamp,
          approximateLatencyMs: quote.approximateLatencyMs ?? null,
          state: quote.state ?? "DISCONNECTED",
          brokerSymbol: quote.brokerSymbol ?? args.symbol,
        }
      : null,
    candles: selected.candles,
    detections,
    workflow,
    warnings: [
      ...selected.warnings,
      ...(requestedProvider === "mt5" && !quote
        ? [
            "MT5 bridge is disconnected or not configured. No broker price is being invented.",
          ]
        : []),
      ...(activeProvider === "mt5" &&
      accountScopedCandidateCount > candidates.length
        ? [
            `${accountScopedCandidateCount - candidates.length} MT5 setup overlay${accountScopedCandidateCount - candidates.length === 1 ? " was" : "s were"} hidden because its account, candle, or broker-symbol provenance did not match this chart snapshot.`,
          ]
        : []),
      ...(!workflow
        ? [
            "Global 4H → 1H → 30M workflow is waiting for sufficient closed candles.",
          ]
        : []),
      ...(!args.config?.enabled
        ? [
            "Continuous scanner is not enabled; chart candles can still refresh on demand.",
          ]
        : []),
      ...(activeProvider === "twelvedata"
        ? [
            `Twelve Data REST chart candles refresh at most every ${TWELVE_DATA_MIN_CYCLE_SECONDS / 60} minutes to protect the provider quota. Scanner decisions use only fully closed candles.`,
          ]
        : []),
    ],
    source: [
      activeProvider === "mt5"
        ? "Connected MT5 broker"
        : "Twelve Data primary feed",
      activeProvider === "mt5"
        ? "official MT5 Python bridge atomic candle bundle"
        : "market_candles",
      "approved strategy versions",
      "trade journal learning",
    ],
  });
}
