import { useEffect, useState } from "react";
import { ArrowUpRight, CandlestickChart, RefreshCw } from "lucide-react";
import type {
  GlobalTradingWorkflow,
  SharedChartSymbol,
  SharedChartTimeframe,
  SharedMarketSnapshot,
} from "@workspace/api-zod";
import { LIVE_REFRESH_EVENT } from "../live-refresh";
import { publishJarvisChart } from "../jarvis/app-bridge";
import { fetchSharedMarket } from "./shared-market";

const SYMBOLS: SharedChartSymbol[] = ["XAUUSD", "GBPJPY"];
const TIMEFRAMES: SharedChartTimeframe[] = ["15m", "30m", "1h", "4h"];

type Zone = NonNullable<GlobalTradingWorkflow["fourHour"]["support"]>;

function relevantLevels(workflow: GlobalTradingWorkflow | null, timeframe: SharedChartTimeframe) {
  if (!workflow) return { support: null, resistance: null };
  const levels = timeframe === "4h"
    ? [workflow.fourHour, workflow.oneHour, workflow.thirtyMinute]
    : timeframe === "1h"
      ? [workflow.oneHour, workflow.fourHour, workflow.thirtyMinute]
      : [workflow.thirtyMinute, workflow.oneHour, workflow.fourHour];
  return {
    support: levels.find((level) => level.support)?.support ?? null,
    resistance: levels.find((level) => level.resistance)?.resistance ?? null,
  };
}

function price(value: number | null | undefined, symbol: SharedChartSymbol) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toFixed(symbol === "GBPJPY" ? 3 : 2);
}

function zoneLabel(zone: Zone | null, symbol: SharedChartSymbol) {
  if (!zone) return "Awaiting verified level";
  return `${price(zone.low, symbol)}–${price(zone.high, symbol)}`;
}

function CandleCard({ snapshot, symbol, loading, error, onOpenChart }: {
  snapshot: SharedMarketSnapshot | null;
  symbol: SharedChartSymbol;
  loading: boolean;
  error: string;
  onOpenChart?: () => void;
}) {
  const candle = snapshot?.candles.at(-1);
  const levels = relevantLevels(snapshot?.workflow ?? null, snapshot?.timeframe ?? "30m");
  const quote = snapshot?.quote?.state === "CONNECTED" ? snapshot.quote : null;
  const lastPrice = quote?.last ?? candle?.c;
  const usable = !error && snapshot?.dataStatus === "live";
  const source = snapshot?.provider === "twelvedata" ? "Twelve Data" : "MT5";
  const status = error ? "Last known" : !snapshot ? "Unavailable" : snapshot.dataStatus === "live" ? "Provider live" : snapshot.dataStatus;
  const detection = snapshot?.detections.find((item) => item.status === "CONFIRMED")
    ?? snapshot?.detections.find((item) => item.status === "WATCHING" || item.status === "PARTIAL");

  return (
    <article className="rounded-2xl border border-cyan-400/20 bg-[#0d1b2b] p-4 shadow-[inset_0_1px_0_rgba(125,211,252,0.08)] min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/80">Shared market candle</div>
          <h3 className="mt-1 text-lg font-bold text-slate-100">{symbol === "XAUUSD" ? "XAU/USD" : "GBP/JPY"}</h3>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${usable ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"}`}>
          {status}
        </span>
      </div>
      {error ? <p role="status" className="mt-2 text-xs text-amber-300">{error}</p> : null}
      <div className="mt-3 flex items-end justify-between gap-2 border-b border-slate-700/60 pb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400">{quote ? "MT5 quote" : "Last candle price"}</div>
          <div className="font-mono text-2xl font-bold tabular-nums text-white">{price(lastPrice, symbol)}</div>
        </div>
        <div className="text-right text-[11px] text-slate-400">
          <div>{snapshot ? source : loading ? "Loading shared data…" : "No market data"}</div>
          <div>{candle ? `${candle.closed ? "Closed" : "Forming"} · ${new Date(candle.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "No verified candle"}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([ ["Open", candle?.o], ["High", candle?.h], ["Low", candle?.l], ["Close", candle?.c] ] as const).map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl border border-slate-700/60 bg-[#101e30] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-slate-100">{price(value, symbol)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-300">Support {levels.support ? `· ${levels.support.timeframe.toUpperCase()}` : ""}</div>
          <div className="mt-0.5 truncate font-mono text-sm text-slate-100" title={zoneLabel(levels.support, symbol)}>{zoneLabel(levels.support, symbol)}</div>
        </div>
        <div className="min-w-0 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-rose-300">Resistance {levels.resistance ? `· ${levels.resistance.timeframe.toUpperCase()}` : ""}</div>
          <div className="mt-0.5 truncate font-mono text-sm text-slate-100" title={zoneLabel(levels.resistance, symbol)}>{zoneLabel(levels.resistance, symbol)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>Setup AI: {detection ? `${detection.setup} · ${detection.status.toLowerCase()}` : "No active match"}</span>
        <span>Master AI: {snapshot?.workflow?.masterStatus.replaceAll("_", " ").toLowerCase() ?? "Awaiting analysis"}</span>
      </div>
      {onOpenChart ? <button type="button" onClick={onOpenChart} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-100">Open {symbol === "XAUUSD" ? "XAU/USD" : "GBP/JPY"} chart <ArrowUpRight size={13} /></button> : null}
    </article>
  );
}

/** Reads the same snapshot used by the Lightweight Chart, scanner and AI agents. */
export function MarketCandleCards({ onOpenChart }: { onOpenChart?: () => void }) {
  const [timeframe, setTimeframe] = useState<SharedChartTimeframe>("15m");
  const [snapshots, setSnapshots] = useState<Partial<Record<SharedChartSymbol, SharedMarketSnapshot>>>({});
  const [errors, setErrors] = useState<Partial<Record<SharedChartSymbol, string>>>({});
  const [loading, setLoading] = useState(true);
  const openChart = (symbol: SharedChartSymbol) => {
    publishJarvisChart({ kind: "CHART", symbol, timeframe });
    onOpenChart?.();
  };

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      setLoading(true);
      const results = await Promise.allSettled(SYMBOLS.map((symbol) => fetchSharedMarket(symbol, timeframe)));
      if (active) {
        results.forEach((result, index) => {
          const symbol = SYMBOLS[index];
          if (result.status === "fulfilled") {
            setSnapshots((current) => ({ ...current, [symbol]: result.value }));
            setErrors((current) => ({ ...current, [symbol]: "" }));
          } else {
            setErrors((current) => ({ ...current, [symbol]: result.reason instanceof Error ? result.reason.message : "Shared market data unavailable." }));
          }
        });
        setLoading(false);
        timer = window.setTimeout(
          () => void load(),
          results.some((result) => result.status === "rejected")
            ? 60_000
            : results.some((result) => result.status === "fulfilled" && result.value.provider === "mt5")
              ? 15_000
              : 15 * 60_000,
        );
      }
      inFlight = false;
    };
    const refresh = () => { if (timer) window.clearTimeout(timer); void load(); };
    void load();
    window.addEventListener(LIVE_REFRESH_EVENT, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener(LIVE_REFRESH_EVENT, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [timeframe]);

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-[#0b1727] p-3 sm:p-4" aria-label="XAU/USD and GBP/JPY market candles">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-100">
          <CandlestickChart size={18} className="text-cyan-300" />
          <div><h2 className="text-base font-bold">Market candles & key levels</h2><p className="text-[11px] text-slate-400">Same verified candles and levels as TradingView chart, scanner and AI</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-700 bg-[#0e1b2c] p-0.5" aria-label="Candle timeframe">
            {TIMEFRAMES.map((item) => <button key={item} type="button" aria-pressed={timeframe === item} onClick={() => setTimeframe(item)} className={`rounded-lg px-2 py-1 text-xs font-semibold ${timeframe === item ? "bg-cyan-500/25 text-cyan-200" : "text-slate-400"}`}>{item.toUpperCase()}</button>)}
          </div>
          {onOpenChart ? <button type="button" onClick={() => openChart("XAUUSD")} className="inline-flex items-center gap-1 rounded-xl border border-cyan-400/25 px-2.5 py-1.5 text-xs font-semibold text-cyan-200">Chart <ArrowUpRight size={13} /></button> : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {SYMBOLS.map((symbol) => <CandleCard key={symbol} symbol={symbol} snapshot={snapshots[symbol]?.timeframe === timeframe ? snapshots[symbol]! : null} loading={loading} error={errors[symbol] ?? ""} onOpenChart={onOpenChart ? () => openChart(symbol) : undefined} />)}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500"><RefreshCw size={11} /> Twelve Data REST uses the existing 15-minute quota guard; MT5 uses its broker feed. Levels come from the shared closed-candle 4H/1H/30M workflow; cached data is labelled.</p>
    </section>
  );
}
