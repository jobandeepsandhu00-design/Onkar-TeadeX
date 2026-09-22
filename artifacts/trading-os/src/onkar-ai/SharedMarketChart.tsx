import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type {
  SharedChartSymbol,
  SharedChartTimeframe,
  SharedMarketSnapshot,
  SetupDetection,
} from "@workspace/api-zod";
import { fetchSharedMarket } from "../market-brain/shared-market";
import { LIVE_REFRESH_EVENT } from "../live-refresh";
import { getJarvisChart, subscribeJarvisChart } from "../jarvis/app-bridge";

const SYMBOLS: Array<{ value: SharedChartSymbol; label: string }> = [
  { value: "EURUSD", label: "EUR/USD" },
  { value: "GBPUSD", label: "GBP/USD" },
  { value: "USDJPY", label: "USD/JPY" },
  { value: "GBPJPY", label: "GBP/JPY" },
  { value: "EURJPY", label: "EUR/JPY" },
  { value: "AUDUSD", label: "AUD/USD" },
  { value: "USDCAD", label: "USD/CAD" },
  { value: "NZDUSD", label: "NZD/USD" },
  { value: "EURGBP", label: "EUR/GBP" },
  { value: "XAUUSD", label: "XAU/USD" },
];
const TIMEFRAMES: Array<{ value: SharedChartTimeframe; label: string }> = [
  { value: "15m", label: "15M" },
  { value: "30m", label: "30M" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
];
const detectionColors: Record<SetupDetection["status"], string> = {
  WATCHING: "#54b8ff",
  PARTIAL: "#f5bb55",
  CONFIRMED: "#2ee6a6",
  INVALID: "#ff647c",
};
const TWELVE_DATA_CHART_REFRESH_MS = 15 * 60_000;
type ChartTimezone = "local" | "utc";
const LOCAL_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function chartTimeDate(time: Time) {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") return new Date(`${time}T00:00:00Z`);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

function chartTimeZone(timezone: ChartTimezone) {
  return timezone === "utc" ? "UTC" : LOCAL_TIMEZONE;
}

function formatChartTick(
  time: Time,
  tickMarkType: TickMarkType,
  locale: string,
  timezone: ChartTimezone,
) {
  const date = chartTimeDate(time);
  const timeZone = chartTimeZone(timezone);
  if (tickMarkType === TickMarkType.Year)
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
    }).format(date);
  if (tickMarkType === TickMarkType.Month)
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      month: "short",
    }).format(date);
  if (tickMarkType === TickMarkType.DayOfMonth)
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      day: "2-digit",
      month: "short",
    }).format(date);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second:
      tickMarkType === TickMarkType.TimeWithSeconds ? "2-digit" : undefined,
    hourCycle: "h23",
  }).format(date);
}

function formatChartCrosshair(time: Time, timezone: ChartTimezone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: chartTimeZone(timezone),
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(chartTimeDate(time));
}

type Workflow = NonNullable<SharedMarketSnapshot["workflow"]>;
type WorkflowZone = NonNullable<Workflow["fourHour"]["support"]>;

type ZoneOverlay = {
  low: number;
  high: number;
  labels: string[];
  color: string;
};

type StructureOverlay = {
  price: number;
  labels: string[];
  color: string;
};

const zoneKey = (low: number, high: number) =>
  `${low.toPrecision(12)}:${high.toPrecision(12)}`;

const priceKey = (price: number) => price.toPrecision(12);

function zoneDescription(
  timeframe: "4H" | "1H" | "30M",
  zone: WorkflowZone,
  suffix = "",
) {
  const type = zone.type.replaceAll("_", " ").toUpperCase();
  const touches = `${zone.touches} TOUCH${zone.touches === 1 ? "" : "ES"}`;
  return `${timeframe} ${type}${suffix} · FRESHNESS ${Math.round(zone.freshness)}% · ${touches}`;
}

function workflowZoneOverlays(workflow: Workflow): ZoneOverlay[] {
  const rows: Array<{
    zone: WorkflowZone | null;
    label: string;
    color: string;
  }> = [
    {
      zone: workflow.fourHour.support,
      label: workflow.fourHour.support
        ? zoneDescription("4H", workflow.fourHour.support)
        : "",
      color: "#31d9a8",
    },
    {
      zone: workflow.fourHour.resistance,
      label: workflow.fourHour.resistance
        ? zoneDescription("4H", workflow.fourHour.resistance)
        : "",
      color: "#ff7187",
    },
    {
      zone: workflow.oneHour.support,
      label: workflow.oneHour.support
        ? zoneDescription("1H", workflow.oneHour.support)
        : "",
      color: "#45cbb1",
    },
    {
      zone: workflow.oneHour.resistance,
      label: workflow.oneHour.resistance
        ? zoneDescription("1H", workflow.oneHour.resistance)
        : "",
      color: "#f08b9a",
    },
    {
      zone: workflow.oneHour.setupZone,
      label: workflow.oneHour.setupZone
        ? zoneDescription("1H", workflow.oneHour.setupZone, " · SETUP AREA")
        : "",
      color: "#9f8cff",
    },
    {
      zone: workflow.thirtyMinute.support,
      label: workflow.thirtyMinute.support
        ? zoneDescription("30M", workflow.thirtyMinute.support)
        : "",
      color: "#35bfa4",
    },
    {
      zone: workflow.thirtyMinute.resistance,
      label: workflow.thirtyMinute.resistance
        ? zoneDescription("30M", workflow.thirtyMinute.resistance)
        : "",
      color: "#dd8090",
    },
  ];
  const overlays = new Map<string, ZoneOverlay>();
  for (const row of rows) {
    if (!row.zone) continue;
    const key = zoneKey(row.zone.low, row.zone.high);
    const current = overlays.get(key);
    if (current) {
      if (!current.labels.includes(row.label)) current.labels.push(row.label);
      continue;
    }
    overlays.set(key, {
      low: row.zone.low,
      high: row.zone.high,
      labels: [row.label],
      color: row.color,
    });
  }
  return [...overlays.values()];
}

function workflowStructureOverlays(workflow: Workflow): StructureOverlay[] {
  const fourHigh = workflow.fourHour.structure.includes("HH")
    ? "4H HH"
    : workflow.fourHour.structure.includes("LH")
      ? "4H LH"
      : "4H SWING HIGH";
  const fourLow = workflow.fourHour.structure.includes("HL")
    ? "4H HL"
    : workflow.fourHour.structure.includes("LL")
      ? "4H LL"
      : "4H SWING LOW";
  const rows: Array<{
    price: number | null;
    label: string;
    color: string;
  }> = [
    {
      price: workflow.fourHour.swingHigh,
      label: `${fourHigh}${workflow.fourHour.brokenStructure === "bullish" ? " · BULLISH BOS LEVEL" : ""}`,
      color: "#d8a9ff",
    },
    {
      price: workflow.fourHour.swingLow,
      label: `${fourLow}${workflow.fourHour.brokenStructure === "bearish" ? " · BEARISH BOS LEVEL" : ""}`,
      color: "#c58cff",
    },
    {
      price: workflow.oneHour.swingHigh,
      label: `1H SWING HIGH${workflow.oneHour.brokenStructure === "bullish" ? " · BULLISH BOS LEVEL" : ""}`,
      color: "#6baeff",
    },
    {
      price: workflow.oneHour.swingLow,
      label: `1H SWING LOW${workflow.oneHour.brokenStructure === "bearish" ? " · BEARISH BOS LEVEL" : ""}`,
      color: "#4e91ed",
    },
    {
      price: workflow.thirtyMinute.swingHigh,
      label: `30M SWING HIGH${workflow.thirtyMinute.brokenStructure === "bullish" ? " · BULLISH BOS LEVEL" : ""}`,
      color: "#55d7ef",
    },
    {
      price: workflow.thirtyMinute.swingLow,
      label: `30M SWING LOW${workflow.thirtyMinute.brokenStructure === "bearish" ? " · BEARISH BOS LEVEL" : ""}`,
      color: "#32b4d1",
    },
  ];
  const overlays = new Map<string, StructureOverlay>();
  for (const row of rows) {
    if (row.price === null) continue;
    const key = priceKey(row.price);
    const current = overlays.get(key);
    if (current) {
      if (!current.labels.includes(row.label)) current.labels.push(row.label);
      continue;
    }
    overlays.set(key, {
      price: row.price,
      labels: [row.label],
      color: row.color,
    });
  }
  return [...overlays.values()];
}

function markerTime(
  candles: SharedMarketSnapshot["candles"],
  timestamp: string,
): UTCTimestamp | null {
  const analyzedAt = Date.parse(timestamp);
  if (!Number.isFinite(analyzedAt)) return null;
  let match: number | null = null;
  for (const candle of candles) {
    if (candle.t > analyzedAt) break;
    match = candle.t;
  }
  return match === null ? null : (Math.floor(match / 1000) as UTCTimestamp);
}

export type SharedChartTradeOverlay = {
  id: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: "OPEN" | "CLOSED" | "INVALIDATED";
  openedAt?: string | null;
  closedAt?: string | null;
  source: "PAPER" | "MT5";
};

const EMPTY_TRADE_OVERLAYS: SharedChartTradeOverlay[] = [];

export type SharedMarketChartProps = {
  compact?: boolean;
  initialSymbol?: SharedChartSymbol;
  initialTimeframe?: SharedChartTimeframe;
  tradeOverlays?: SharedChartTradeOverlay[];
  onSnapshot?: (snapshot: SharedMarketSnapshot) => void;
  onUnavailable?: (message: string) => void;
  onContextChange?: (
    symbol: SharedChartSymbol,
    timeframe: SharedChartTimeframe,
  ) => void;
};

export function SharedMarketChart({
  compact = false,
  initialSymbol = "XAUUSD",
  initialTimeframe = "15m",
  tradeOverlays = EMPTY_TRADE_OVERLAYS,
  onSnapshot,
  onUnavailable,
  onContextChange,
}: SharedMarketChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastKey = useRef("");
  const onSnapshotRef = useRef(onSnapshot);
  const onUnavailableRef = useRef(onUnavailable);
  const onContextChangeRef = useRef(onContextChange);
  const [symbol, setSymbol] = useState<SharedChartSymbol>(
    () => (getJarvisChart()?.symbol as SharedChartSymbol) || initialSymbol,
  );
  const [timeframe, setTimeframe] = useState<SharedChartTimeframe>(
    () => getJarvisChart()?.timeframe || initialTimeframe,
  );
  const [snapshot, setSnapshot] = useState<SharedMarketSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState<ChartTimezone>("local");
  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);
  useEffect(() => {
    onContextChangeRef.current = onContextChange;
  }, [onContextChange]);
  useEffect(() => {
    onContextChangeRef.current?.(symbol, timeframe);
  }, [symbol, timeframe]);
  useEffect(
    () =>
      subscribeJarvisChart((command) => {
        if (
          command.symbol &&
          SYMBOLS.some((item) => item.value === command.symbol)
        )
          setSymbol(command.symbol as SharedChartSymbol);
        if (command.timeframe) setTimeframe(command.timeframe);
        const scale = chart.current?.timeScale();
        if (command.zoom === "reset") scale?.fitContent();
        else if (command.zoom && scale) {
          const range = scale.getVisibleLogicalRange();
          if (range) {
            const center = (range.from + range.to) / 2,
              half =
                (range.to - range.from) * (command.zoom === "in" ? 0.4 : 0.625);
            scale.setVisibleLogicalRange({
              from: center - half,
              to: center + half,
            });
          }
        }
      }),
    [],
  );

  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#07101f" },
        textColor: "#8fa7c3",
        fontFamily: "Inter, ui-sans-serif, system-ui",
      },
      grid: {
        vertLines: { color: "rgba(105, 139, 179, .09)" },
        horzLines: { color: "rgba(105, 139, 179, .09)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(78, 170, 255, .55)",
          labelBackgroundColor: "#1677d2",
        },
        horzLine: {
          color: "rgba(78, 170, 255, .55)",
          labelBackgroundColor: "#1677d2",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(121, 151, 187, .2)",
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "rgba(121, 151, 187, .2)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 7,
        barSpacing: compact ? 5 : 7,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });
    const candleSeries = api.addSeries(CandlestickSeries, {
      upColor: "#19d3a2",
      downColor: "#ef5d78",
      wickUpColor: "#31e5b7",
      wickDownColor: "#ff748b",
      borderVisible: false,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    chart.current = api;
    series.current = candleSeries;
    markers.current = createSeriesMarkers(candleSeries, []);
    return () => {
      api.remove();
      chart.current = null;
      series.current = null;
      markers.current = null;
      lines.current = [];
      lastKey.current = "";
    };
  }, [compact]);

  useEffect(() => {
    chart.current?.applyOptions({
      localization: {
        timeFormatter: (time: Time) => formatChartCrosshair(time, timezone),
      },
      timeScale: {
        tickMarkFormatter: (
          time: Time,
          tickMarkType: TickMarkType,
          locale: string,
        ) => formatChartTick(time, tickMarkType, locale, timezone),
      },
    });
  }, [compact, timezone]);

  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    let timer: number | undefined;
    let inFlight = false;
    const load = async (initial = false) => {
      if (inFlight) return;
      inFlight = true;
      if (timer) window.clearTimeout(timer);
      if (initial) setLoading(true);
      try {
        const next = await fetchSharedMarket(symbol, timeframe, abort.signal);
        if (!active) return;
        setSnapshot(next);
        onSnapshotRef.current?.(next);
        setError("");
        timer = window.setTimeout(
          () => void load(),
          next.provider === "mt5" ? 15_000 : TWELVE_DATA_CHART_REFRESH_MS,
        );
      } catch (cause) {
        if (!active || abort.signal.aborted) return;
        const message =
          cause instanceof Error ? cause.message : "Market data unavailable.";
        setError(message);
        onUnavailableRef.current?.(message);
        timer = window.setTimeout(() => void load(), 60_000);
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };
    const refreshNow = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load(true);
    window.addEventListener(LIVE_REFRESH_EVENT, refreshNow);
    return () => {
      active = false;
      abort.abort();
      if (timer) window.clearTimeout(timer);
      window.removeEventListener(LIVE_REFRESH_EVENT, refreshNow);
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    const candleSeries = series.current;
    if (!snapshot || !candleSeries) return;
    const data = snapshot.candles.map((candle) => ({
      time: Math.floor(candle.t / 1000) as UTCTimestamp,
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
    }));
    const key = `${snapshot.symbol}:${snapshot.timeframe}`;
    // Reconcile the whole bounded series. Updating only the newest bar leaves
    // the previous forming candle with stale OHLC after it closes.
    candleSeries.setData(data);
    if (lastKey.current !== key) {
      chart.current?.timeScale().fitContent();
      lastKey.current = key;
    }
    for (const line of lines.current) candleSeries.removePriceLine(line);
    lines.current = [];
    if (snapshot.workflow) {
      for (const zone of workflowZoneOverlays(snapshot.workflow)) {
        const title = zone.labels.join(" / ");
        lines.current.push(
          candleSeries.createPriceLine({
            price: zone.low,
            color: zone.color,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `${title} · LOW`,
          }),
        );
        if (zone.high !== zone.low) {
          lines.current.push(
            candleSeries.createPriceLine({
              price: zone.high,
              color: zone.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title,
            }),
          );
        }
      }
      for (const level of workflowStructureOverlays(snapshot.workflow)) {
        lines.current.push(
          candleSeries.createPriceLine({
            price: level.price,
            color: level.color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: level.labels.join(" / "),
          }),
        );
      }
    }
    for (const detection of snapshot.detections.slice(0, 4)) {
      const color = detectionColors[detection.status];
      const setupLabel = `${detection.timeframe.toUpperCase()} ${detection.setup}`;
      if (detection.status === "CONFIRMED" && detection.candleClosed) {
        const levels = [
          [detection.entry, `${setupLabel} · Entry`],
          [
            detection.stopLoss,
            `${detection.timeframe.toUpperCase()} SL / invalidation`,
          ],
          [detection.takeProfit, `${detection.timeframe.toUpperCase()} TP`],
        ] as const;
        for (const [value, title] of levels) {
          if (value === null) continue;
          lines.current.push(
            candleSeries.createPriceLine({
              price: value,
              color: title.includes("SL / invalidation")
                ? "#ff647c"
                : title.endsWith(" TP")
                  ? "#2ee6a6"
                  : color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title,
            }),
          );
        }
      }
      // Workflow zones are rendered once above. Candidate entry evidence is
      // retained here without duplicating every 4H/1H/30M boundary.
      for (const zone of detection.zones.filter(
        (item) => item.kind === "entry",
      )) {
        lines.current.push(
          candleSeries.createPriceLine({
            price: zone.low,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `${setupLabel} · entry evidence low`,
          }),
        );
        lines.current.push(
          candleSeries.createPriceLine({
            price: zone.high,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `${setupLabel} · entry evidence high`,
          }),
        );
      }
    }
    for (const trade of tradeOverlays.filter(
      (item) => item.status === "OPEN",
    )) {
      const atBreakEven =
        trade.stopLoss !== null &&
        Math.abs(trade.stopLoss - trade.entry) <=
          Math.max(Math.abs(trade.entry) * 0.000001, Number.EPSILON);
      const levels = [
        [trade.entry, `${trade.source} ${trade.direction} · Entry`, "#54b8ff"],
        [
          trade.stopLoss,
          atBreakEven ? "Break-even" : "Active trade SL",
          atBreakEven ? "#f5bb55" : "#ff647c",
        ],
        [trade.takeProfit, "Active trade TP", "#2ee6a6"],
      ] as const;
      for (const [value, title, color] of levels) {
        if (value === null) continue;
        lines.current.push(
          candleSeries.createPriceLine({
            price: value,
            color,
            lineWidth: title.includes("Entry") ? 2 : 1,
            lineStyle: title.includes("Entry")
              ? LineStyle.Solid
              : LineStyle.Dashed,
            axisLabelVisible: true,
            title,
          }),
        );
      }
    }
    const detectionMarkers: SeriesMarker<Time>[] = snapshot.detections
      .slice(0, 12)
      .flatMap((item) => {
        const time = markerTime(snapshot.candles, item.decisionCandleAt);
        return time === null
          ? []
          : [
              {
                time,
                position: item.direction === "SELL" ? "aboveBar" : "belowBar",
                color: detectionColors[item.status],
                shape:
                  item.direction === "SELL"
                    ? "arrowDown"
                    : item.direction === "BUY"
                      ? "arrowUp"
                      : "circle",
                text: `${item.timeframe.toUpperCase()} ${item.setup} · ${item.status}`,
              } satisfies SeriesMarker<Time>,
            ];
      })
      .sort((left, right) => Number(left.time) - Number(right.time));
    const tradeMarkers: SeriesMarker<Time>[] = tradeOverlays.flatMap(
      (trade) => {
        const openTime = trade.openedAt
          ? markerTime(snapshot.candles, trade.openedAt)
          : null;
        const closeTime = trade.closedAt
          ? markerTime(snapshot.candles, trade.closedAt)
          : null;
        const rows: SeriesMarker<Time>[] = [];
        if (openTime !== null)
          rows.push({
            time: openTime,
            position: trade.direction === "SELL" ? "aboveBar" : "belowBar",
            color: "#54b8ff",
            shape: trade.direction === "SELL" ? "arrowDown" : "arrowUp",
            text: `${trade.source} ${trade.direction} · OPEN`,
          });
        if (closeTime !== null)
          rows.push({
            time: closeTime,
            position: trade.direction === "SELL" ? "belowBar" : "aboveBar",
            color: trade.status === "INVALIDATED" ? "#ff647c" : "#f5bb55",
            shape: "circle",
            text: `${trade.source} · ${trade.status}`,
          });
        return rows;
      },
    );
    markers.current?.setMarkers(
      [...detectionMarkers, ...tradeMarkers].sort(
        (left, right) => Number(left.time) - Number(right.time),
      ),
    );
  }, [compact, snapshot, tradeOverlays]);

  const latest = snapshot?.candles.at(-1);
  return (
    <section className={`oai-live-chart ${compact ? "is-compact" : ""}`}>
      <div className="oai-live-chart-head">
        <div>
          <small>
            {snapshot?.provider === "mt5"
              ? "MT5 BROKER FEED · SHARED MARKET CONTEXT"
              : `DATA SOURCE: ${snapshot?.dataSource === "fallback" ? "FALLBACK" : "PRIMARY"} · TWELVE DATA`}
          </small>
          <h3>
            {snapshot?.displaySymbol ||
              SYMBOLS.find((item) => item.value === symbol)?.label}
          </h3>
          <span
            className={`oai-market-state is-${snapshot?.dataStatus || "loading"}`}
          >
            <i />{" "}
            {loading
              ? "Loading"
              : snapshot?.provider === "twelvedata" &&
                  snapshot?.dataStatus === "live"
                ? "FORMING · 15M REFRESH"
                : snapshot?.dataStatus || "Unavailable"}
          </span>
          {snapshot?.provider === "mt5" && snapshot.broker && (
            <small className="oai-market-broker">
              {snapshot.broker} · {snapshot.accountType} ·{" "}
              {snapshot.quote?.brokerSymbol}
            </small>
          )}
        </div>
        <div className="oai-live-chart-controls">
          <select
            aria-label="Chart symbol"
            value={symbol}
            onChange={(event) =>
              setSymbol(event.target.value as SharedChartSymbol)
            }
          >
            {SYMBOLS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <div role="group" aria-label="Chart timeframe">
            {TIMEFRAMES.map((item) => (
              <button
                key={item.value}
                className={timeframe === item.value ? "active" : ""}
                onClick={() => setTimeframe(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Chart timezone"
            value={timezone}
            onChange={(event) =>
              setTimezone(event.target.value as ChartTimezone)
            }
          >
            <option value="local">{LOCAL_TIMEZONE} · Local</option>
            <option value="utc">UTC</option>
          </select>
        </div>
      </div>
      {snapshot?.quote && (
        <div className="oai-live-ohlc" aria-label="MT5 live quote">
          <span>
            Bid <b>{snapshot.quote.bid}</b>
          </span>
          <span>
            Ask <b>{snapshot.quote.ask}</b>
          </span>
          <span>
            Spread <b>{snapshot.quote.spread}</b>
          </span>
          <span>
            Latency <b>{snapshot.quote.approximateLatencyMs ?? "—"} ms</b>
          </span>
          <span
            className={
              snapshot.quote.state === "CONNECTED" ? "is-closed" : "is-forming"
            }
          >
            {snapshot.quote.state}
          </span>
          <span>
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: timezone === "utc" ? "UTC" : LOCAL_TIMEZONE,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(new Date(snapshot.quote.timestamp))}
          </span>
        </div>
      )}
      {latest && (
        <div className="oai-live-ohlc" aria-label="Latest candle OHLC">
          <span>
            O <b>{latest.o}</b>
          </span>
          <span>
            H <b>{latest.h}</b>
          </span>
          <span>
            L <b>{latest.l}</b>
          </span>
          <span>
            C <b>{latest.c}</b>
          </span>
          <span className={latest.closed ? "is-closed" : "is-forming"}>
            {latest.closed ? (
              <CheckCircle2 size={12} />
            ) : (
              <RefreshCw size={12} />
            )}{" "}
            {latest.closed ? "Closed" : "Forming"}
          </span>
        </div>
      )}
      {snapshot?.workflow && (
        <div
          className={`oai-workflow-strip is-${snapshot.workflow.gate.status.toLowerCase()}`}
          aria-label="Official 4H 1H 30M trading workflow"
        >
          <div>
            <small>4H BIAS</small>
            <strong>{snapshot.workflow.fourHour.bias}</strong>
          </div>
          <div>
            <small>1H ALIGNMENT</small>
            <strong>
              {snapshot.workflow.oneHour.alignment.replaceAll("_", " ")}
            </strong>
          </div>
          <div>
            <small>30M CONFIRMATION</small>
            <strong>
              {snapshot.workflow.thirtyMinute.reaction.replaceAll("_", " ")}
            </strong>
          </div>
          <div>
            <small>SETUP AI</small>
            <strong>EVALUATING</strong>
          </div>
          <div>
            <small>TRADE GATE</small>
            <strong>{snapshot.workflow.gate.status}</strong>
          </div>
          {!compact && (
            <div>
              <small>MASTER STATUS</small>
              <strong>
                {snapshot.workflow.masterStatus.replaceAll("_", " ")}
              </strong>
            </div>
          )}
        </div>
      )}
      {snapshot?.workflow && (
        <details className="oai-workflow-audit">
          <summary>How Twelve Data becomes a trade decision</summary>
          <p>
            The selected {timeframe.toUpperCase()} chart may contain a forming
            candle. Setup AI evaluates every approved setup against shared,
            fully closed 4H, 1H and 30M candles.
          </p>
          <ol>
            <li>
              Twelve Data candles are normalized and checked for freshness.
            </li>
            <li>4H bias and major structure are calculated.</li>
            <li>1H alignment, price location and setup zone are calculated.</li>
            <li>Every approved setup is scored from its own machine rules.</li>
            <li>A closed 30M trigger must confirm the matching setup.</li>
            <li>Risk, news and automation permissions decide execution.</li>
          </ol>
          <div className="oai-workflow-audit__status">
            <strong>
              Parent gate: {snapshot.workflow.gate.passed.length}/
              {snapshot.workflow.gate.passed.length +
                snapshot.workflow.gate.missing.length}{" "}
              conditions passed
            </strong>
            <span>
              {snapshot.detections.length
                ? `${snapshot.detections.length} setup candidates above the configured candidate threshold`
                : "No setup is currently above the configured candidate threshold"}
            </span>
          </div>
          {snapshot.workflow.gate.missing.length > 0 && (
            <div className="oai-workflow-audit__missing">
              <b>Execution waiting for:</b>
              {snapshot.workflow.gate.missing.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          )}
          <p>
            A score is rule confluence, not win probability. Even 100/100 does
            not bypass stale-data, closed-candle, Risk AI, news or execution
            permission checks.
          </p>
        </details>
      )}
      <div
        ref={container}
        className="oai-lightweight-chart"
        aria-label={`${symbol} ${timeframe} candlestick chart`}
      />
      {error && (
        <div className="oai-chart-message" role="alert">
          <AlertTriangle size={15} /> {error}
        </div>
      )}
      {snapshot?.warnings.map((warning) => (
        <div className="oai-chart-message" key={warning}>
          <AlertTriangle size={14} /> {warning}
        </div>
      ))}
      {!!snapshot?.detections.length && (
        <div className="oai-chart-detections">
          {snapshot.detections.slice(0, 4).map((item) => (
            <article
              key={item.id}
              style={
                {
                  "--detection-color": detectionColors[item.status],
                } as CSSProperties
              }
            >
              <span>
                {item.status} · {item.timeframe.toUpperCase()}
              </span>
              <strong>{item.setup}</strong>
              <small>
                {item.direction} · {item.reason}
              </small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
