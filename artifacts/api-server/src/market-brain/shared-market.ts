import {
  sharedMarketSnapshotSchema,
  timeframeMs,
  TWELVE_DATA_MIN_CYCLE_SECONDS,
  type Candle,
  type SharedChartSymbol,
  type SharedChartTimeframe,
  type SharedMarketSnapshot,
  type SetupDetection,
  type Timeframe,
} from "@workspace/api-zod";
import { getMarketProvider } from "./providers";
import { getMT5Account } from "../mt5/client";
import { ScannerStore, type CandidateRow, type ConfigRow } from "./store";
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

export async function sharedProviderCandles(
  service: ScannerStore,
  providerName: "mt5" | "twelvedata",
  symbol: string,
  timeframe: Timeframe,
  now = Date.now(),
  options: { cacheMode?: SharedMarketCacheMode } = {},
) {
  const cacheMode = options.cacheMode ?? "live";
  const cacheKey = `${providerName}:${symbol}:${timeframe}:${cacheMode}`;
  const cachedPromise = snapshotPromises.get(cacheKey);
  if (cachedPromise && cachedPromise.expiresAt > now)
    return cachedPromise.promise;

  const promise = (async () => {
    const stored = await service.request<StoredBar[]>("market_candles", {
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
    const provider = getMarketProvider(providerName);
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
      const all = uniqueBars([...storedCandles, ...fetched]).slice(-300);
      const isClosed = (bar: ProviderBar) =>
        bar.closed ?? bar.t + timeframeMs[timeframe] <= now;
      const closed = all.filter(isClosed);
      if (closed.length) {
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
  snapshotPromises.set(cacheKey, { expiresAt: now + cacheMs, promise });
  void promise.then((result) => {
    if (result.dataStatus !== "cached" && result.dataStatus !== "unavailable")
      return;
    const current = snapshotPromises.get(cacheKey);
    if (current?.promise === promise)
      snapshotPromises.set(cacheKey, {
        ...current,
        expiresAt: Date.now() + 60_000,
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

export async function getSharedMarketSnapshot(args: {
  user: ScannerStore;
  config?: ConfigRow;
  symbol: SharedChartSymbol;
  timeframe: SharedChartTimeframe;
}): Promise<SharedMarketSnapshot> {
  const service = ScannerStore.service();
  const requestedProvider =
    args.config?.config.provider === "mt5" ? "mt5" : "twelvedata";
  let activeProvider: "mt5" | "twelvedata" = requestedProvider;
  let fallbackWarning: string | null = null;
  const requestedTimeframes = new Set<Timeframe>([
    args.timeframe,
    ...GLOBAL_WORKFLOW_TIMEFRAMES,
  ]);
  let marketEntries = await Promise.all(
    [...requestedTimeframes].map(
      async (timeframe) =>
        [
          timeframe,
          await sharedProviderCandles(
            service,
            requestedProvider,
            args.symbol,
            timeframe,
            Date.now(),
            {
              // The selected chart receives the provider's forming candle.
              // The scanner contexts remain closed-candle-only.
              cacheMode:
                timeframe === args.timeframe ? "live" : "closed-candle",
            },
          ),
        ] as const,
    ),
  );
  if (
    requestedProvider === "mt5" &&
    marketEntries.every(([, market]) => market.dataStatus === "unavailable") &&
    process.env.MARKET_DATA_FALLBACK_ENABLED === "true"
  ) {
    activeProvider = "twelvedata";
    fallbackWarning =
      "MT5 is disconnected. DATA SOURCE: FALLBACK (Twelve Data). Broker execution remains unavailable.";
    marketEntries = await Promise.all(
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
              },
            ),
          ] as const,
      ),
    );
  }
  const [candidates] = await Promise.all([
    args.user.request<CandidateRow[]>("setup_candidates", {
      ...(args.config ? { config_id: `eq.${args.config.id}` } : {}),
      symbol: `eq.${args.symbol}`,
      timeframe: `eq.${args.timeframe}`,
      state: "in.(SCANNING,DEVELOPING,WATCH,READY,TRIGGERED)",
      order: "updated_at.desc",
      limit: "100",
    }),
  ]);
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
  let account: Awaited<ReturnType<typeof getMT5Account>> | null = null;
  let quote: Awaited<ReturnType<ReturnType<typeof getMarketProvider>["getQuote"]>> | null = null;
  if (activeProvider === "mt5") {
    try {
      [account, quote] = await Promise.all([
        getMT5Account(),
        getMarketProvider("mt5").getQuote(args.symbol),
      ]);
    } catch {
      // Candles may still be cached. Never label cached broker data as live.
    }
  }
  const quoteState = quote?.state;
  const dataStatus =
    activeProvider === "mt5" && quoteState !== "CONNECTED"
      ? selected.candles.length
        ? "cached"
        : "unavailable"
      : selected.dataStatus;
  return sharedMarketSnapshotSchema.parse({
    symbol: args.symbol,
    displaySymbol: DISPLAY_SYMBOLS[args.symbol],
    timeframe: args.timeframe,
    provider: activeProvider,
    dataSource:
      activeProvider === "mt5"
        ? "broker"
        : fallbackWarning
          ? "fallback"
          : "primary",
    dataStatus,
    fetchedAt: new Date().toISOString(),
    broker: account?.broker ?? null,
    server: account?.server ?? null,
    accountType: account?.accountType ?? null,
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
      ...(fallbackWarning ? [fallbackWarning] : []),
      ...(requestedProvider === "mt5" && !quote
        ? ["MT5 bridge is disconnected or not configured. No broker price is being invented."]
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
        : fallbackWarning
          ? "Twelve Data fallback"
          : "Twelve Data primary feed",
      "market_candles",
      "approved strategy versions",
      "trade journal learning",
    ],
  });
}
