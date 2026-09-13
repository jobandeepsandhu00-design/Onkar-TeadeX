import {
  sharedMarketSnapshotSchema,
  timeframeMs,
  type Candle,
  type SharedChartSymbol,
  type SharedChartTimeframe,
  type SharedMarketSnapshot,
  type SetupDetection,
} from "@workspace/api-zod";
import { getMarketProvider } from "./providers";
import { ScannerStore, type CandidateRow, type ConfigRow } from "./store";

type StoredBar = {
  open_time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
};

const DISPLAY_SYMBOLS: Record<SharedChartSymbol, string> = {
  GBPJPY: "GBP/JPY",
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

function uniqueBars(rows: Candle[]) {
  return [...new Map(rows.map((row) => [row.t, row])).values()].sort(
    (a, b) => a.t - b.t,
  );
}

async function sharedProviderCandles(
  service: ScannerStore,
  symbol: SharedChartSymbol,
  timeframe: SharedChartTimeframe,
  now = Date.now(),
) {
  const cacheKey = `${symbol}:${timeframe}`;
  const cachedPromise = snapshotPromises.get(cacheKey);
  if (cachedPromise && cachedPromise.expiresAt > now)
    return cachedPromise.promise;

  const promise = (async () => {
    const stored = await service.request<StoredBar[]>("market_candles", {
      provider: "eq.twelvedata",
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
    const provider = getMarketProvider("twelvedata");
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
      const closed = all.filter((bar) => bar.t + timeframeMs[timeframe] <= now);
      if (closed.length) {
        await service.request(
          "market_candles",
          { on_conflict: "provider,symbol,timeframe,open_time" },
          "POST",
          closed.map((bar) => ({
            provider: "twelvedata",
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
      const hasForming = all.some(
        (bar) => bar.t <= now && bar.t + timeframeMs[timeframe] > now,
      );
      return {
        candles: all.map((bar) => ({
          ...bar,
          closed: bar.t + timeframeMs[timeframe] <= now,
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
            ? "Twelve Data is temporarily unavailable; showing the last stored closed candles."
            : "Twelve Data returned no candles for this symbol, timeframe, or subscription.",
        ],
      };
    }
  })();
  snapshotPromises.set(cacheKey, { expiresAt: now + 12_000, promise });
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

function mapDetection(candidate: CandidateRow): SetupDetection {
  const rules = candidate.payload.rules ?? [];
  const interval = timeframeMs[candidate.timeframe as SharedChartTimeframe];
  const closed =
    !candidate.payload.stale &&
    Number.isFinite(Date.parse(candidate.payload.lastCandleAt)) &&
    Date.parse(candidate.payload.lastCandleAt) + interval <= Date.now();
  const computedStatus = detectionStatus(candidate);
  const status =
    computedStatus === "CONFIRMED" && !closed ? "PARTIAL" : computedStatus;
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
    conditionsMatched: rules
      .filter((rule) => rule.passed)
      .map((rule) => rule.explanation || rule.id),
    conditionsMissing: rules
      .filter((rule) => !rule.passed)
      .map((rule) => rule.explanation || rule.id),
    entry: candidate.plan?.entry ?? candidate.payload.entryZone?.low ?? null,
    stopLoss: candidate.plan?.stop ?? candidate.payload.invalidation ?? null,
    takeProfit:
      candidate.plan?.target ?? candidate.payload.targets?.[0] ?? null,
    riskReward: candidate.plan?.rr ?? candidate.payload.risk?.rr ?? null,
    learningInsight,
    reason: `${candidate.payload.passed}/${candidate.payload.total} deterministic rules matched; confluence ${candidate.score}/100.`,
    waitFor:
      status === "CONFIRMED"
        ? "All required confirmation must remain valid on closed candles."
        : candidate.payload.warnings?.[0] ||
          "Next required rule confirmation on a closed candle.",
    candleClosed: closed,
    timestamp: candidate.payload.analyzedAt,
    zones: candidate.payload.entryZone
      ? [
          {
            low: candidate.payload.entryZone.low,
            high: candidate.payload.entryZone.high,
            kind: "entry",
          },
        ]
      : [],
  };
}

export async function getSharedMarketSnapshot(args: {
  user: ScannerStore;
  config?: ConfigRow;
  symbol: SharedChartSymbol;
  timeframe: SharedChartTimeframe;
}): Promise<SharedMarketSnapshot> {
  const service = ScannerStore.service();
  const [{ candles, dataStatus, warnings }, candidates] = await Promise.all([
    sharedProviderCandles(service, args.symbol, args.timeframe),
    args.user.request<CandidateRow[]>("setup_candidates", {
      ...(args.config ? { config_id: `eq.${args.config.id}` } : {}),
      symbol: `eq.${args.symbol}`,
      timeframe: `eq.${args.timeframe}`,
      order: "updated_at.desc",
      limit: "30",
    }),
  ]);
  const detections = candidates.map(mapDetection);
  return sharedMarketSnapshotSchema.parse({
    symbol: args.symbol,
    displaySymbol: DISPLAY_SYMBOLS[args.symbol],
    timeframe: args.timeframe,
    provider: "twelvedata",
    dataStatus,
    fetchedAt: new Date().toISOString(),
    candles,
    detections,
    warnings: [
      ...warnings,
      ...(!args.config?.enabled
        ? [
            "Continuous scanner is not enabled; chart candles can still refresh on demand.",
          ]
        : []),
    ],
    source: [
      "Twelve Data",
      "market_candles",
      "approved strategy versions",
      "trade journal learning",
    ],
  });
}
