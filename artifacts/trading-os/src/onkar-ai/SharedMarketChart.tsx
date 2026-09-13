import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
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

const SYMBOLS: Array<{ value: SharedChartSymbol; label: string }> = [
  { value: "GBPJPY", label: "GBP/JPY" },
  { value: "XAUUSD", label: "XAU/USD" },
];
const TIMEFRAMES: Array<{ value: SharedChartTimeframe; label: string }> = [
  { value: "15m", label: "15M" },
  { value: "30m", label: "30M" },
  { value: "1h", label: "1H" },
];
const detectionColors: Record<SetupDetection["status"], string> = {
  WATCHING: "#54b8ff",
  PARTIAL: "#f5bb55",
  CONFIRMED: "#2ee6a6",
  INVALID: "#ff647c",
};

export function SharedMarketChart({ compact = false }: { compact?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const markers = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const lastKey = useRef("");
  const [symbol, setSymbol] = useState<SharedChartSymbol>("XAUUSD");
  const [timeframe, setTimeframe] = useState<SharedChartTimeframe>("15m");
  const [snapshot, setSnapshot] = useState<SharedMarketSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
        vertLine: { color: "rgba(78, 170, 255, .55)", labelBackgroundColor: "#1677d2" },
        horzLine: { color: "rgba(78, 170, 255, .55)", labelBackgroundColor: "#1677d2" },
      },
      rightPriceScale: { borderColor: "rgba(121, 151, 187, .2)", scaleMargins: { top: 0.08, bottom: 0.12 } },
      timeScale: { borderColor: "rgba(121, 151, 187, .2)", timeVisible: true, secondsVisible: false, rightOffset: 7, barSpacing: compact ? 5 : 7 },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
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
    };
  }, [compact]);

  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    const load = async (initial = false) => {
      if (initial) setLoading(true);
      try {
        const next = await fetchSharedMarket(symbol, timeframe, abort.signal);
        if (!active) return;
        setSnapshot(next);
        setError("");
      } catch (cause) {
        if (!active || abort.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Market data unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load(true);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      abort.abort();
      window.clearInterval(interval);
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
    if (lastKey.current !== key) {
      candleSeries.setData(data);
      chart.current?.timeScale().fitContent();
      lastKey.current = key;
    } else if (data.length) {
      candleSeries.update(data[data.length - 1]);
    }
    for (const line of lines.current) candleSeries.removePriceLine(line);
    lines.current = [];
    for (const detection of snapshot.detections.slice(0, 4)) {
      const color = detectionColors[detection.status];
      const levels = [
        [detection.entry, `${detection.setup} · Entry`],
        [detection.stopLoss, "SL / invalidation"],
        [detection.takeProfit, "TP"],
      ] as const;
      for (const [value, title] of levels) {
        if (value === null) continue;
        lines.current.push(candleSeries.createPriceLine({
          price: value,
          color: title.startsWith("SL") ? "#ff647c" : title === "TP" ? "#2ee6a6" : color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        }));
      }
      for (const zone of detection.zones) {
        lines.current.push(candleSeries.createPriceLine({ price: zone.low, color, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: `${zone.kind} low` }));
        lines.current.push(candleSeries.createPriceLine({ price: zone.high, color, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: `${zone.kind} high` }));
      }
    }
    const markerRows: SeriesMarker<Time>[] = snapshot.detections
      .filter((item) => snapshot.candles.some((candle) => Math.floor(candle.t / 1000) === Math.floor(Date.parse(item.timestamp) / 1000)))
      .slice(0, 12)
      .map((item) => ({
        time: Math.floor(Date.parse(item.timestamp) / 1000) as UTCTimestamp,
        position: item.direction === "SELL" ? "aboveBar" : "belowBar",
        color: detectionColors[item.status],
        shape: item.direction === "SELL" ? "arrowDown" : item.direction === "BUY" ? "arrowUp" : "circle",
        text: `${item.setup} · ${item.status}`,
      }));
    markers.current?.setMarkers(markerRows);
  }, [snapshot]);

  const latest = snapshot?.candles.at(-1);
  return (
    <section className={`oai-live-chart ${compact ? "is-compact" : ""}`}>
      <div className="oai-live-chart-head">
        <div>
          <small>TWELVE DATA · SHARED MARKET CONTEXT</small>
          <h3>{snapshot?.displaySymbol || SYMBOLS.find((item) => item.value === symbol)?.label}</h3>
          <span className={`oai-market-state is-${snapshot?.dataStatus || "loading"}`}>
            <i /> {loading ? "Loading" : snapshot?.dataStatus || "Unavailable"}
          </span>
        </div>
        <div className="oai-live-chart-controls">
          <select aria-label="Chart symbol" value={symbol} onChange={(event) => setSymbol(event.target.value as SharedChartSymbol)}>
            {SYMBOLS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <div role="group" aria-label="Chart timeframe">
            {TIMEFRAMES.map((item) => <button key={item.value} className={timeframe === item.value ? "active" : ""} onClick={() => setTimeframe(item.value)}>{item.label}</button>)}
          </div>
        </div>
      </div>
      {latest && <div className="oai-live-ohlc" aria-label="Latest candle OHLC">
        <span>O <b>{latest.o}</b></span><span>H <b>{latest.h}</b></span><span>L <b>{latest.l}</b></span><span>C <b>{latest.c}</b></span>
        <span className={latest.closed ? "is-closed" : "is-forming"}>{latest.closed ? <CheckCircle2 size={12} /> : <RefreshCw size={12} />} {latest.closed ? "Closed" : "Forming"}</span>
      </div>}
      <div ref={container} className="oai-lightweight-chart" aria-label={`${symbol} ${timeframe} candlestick chart`} />
      {error && <div className="oai-chart-message" role="alert"><AlertTriangle size={15} /> {error}</div>}
      {snapshot?.warnings.map((warning) => <div className="oai-chart-message" key={warning}><AlertTriangle size={14} /> {warning}</div>)}
      {!!snapshot?.detections.length && <div className="oai-chart-detections">
        {snapshot.detections.slice(0, 4).map((item) => <article key={item.id} style={{ "--detection-color": detectionColors[item.status] } as CSSProperties}>
          <span>{item.status}</span><strong>{item.setup}</strong><small>{item.direction} · {item.reason}</small>
        </article>)}
      </div>}
    </section>
  );
}
