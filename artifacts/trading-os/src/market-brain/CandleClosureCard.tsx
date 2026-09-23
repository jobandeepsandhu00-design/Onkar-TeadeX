import { useEffect, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import type {
  CandleClosureSnapshot,
  SharedChartSymbol,
  SharedChartTimeframe,
} from "@workspace/api-zod";
import { brainRequest } from "./api";
import { candleClosureClock, formatCandleCountdown } from "./candle-closure";
import { LIVE_REFRESH_EVENT } from "../live-refresh";

const TIMEFRAMES = ["15m", "30m", "1h", "4h"] as const;
const LABELS: Record<SharedChartTimeframe, string> = {
  "15m": "15 MIN",
  "30m": "30 MIN",
  "1h": "1 HOUR",
  "4h": "4 HOURS",
};
const STATUS = {
  verified: "Closed candle verified",
  awaiting: "Awaiting closed data",
  stale: "Stored data stale",
  unavailable: "No verified candle",
} as const;

function closeTime(value: number | null) {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export function CandleClosureReadout({
  timeframe,
  lastClosedOpenTime,
  sourceAvailable = true,
  now,
}: {
  timeframe: SharedChartTimeframe;
  lastClosedOpenTime: number | null;
  sourceAvailable?: boolean;
  now: number;
}) {
  const clock = candleClosureClock(timeframe, lastClosedOpenTime, now, sourceAvailable);
  return (
    <div className={`mb-candle-clock is-${clock.state}`}>
      <div className="mb-candle-clock__top">
        <strong>{LABELS[timeframe]}</strong>
        <span>{formatCandleCountdown(clock.remainingMs)}</span>
      </div>
      <div className="mb-candle-clock__times">
        <span>Next {closeTime(clock.nextScheduledCloseAt)} Vienna</span>
        <span>Last closed {closeTime(clock.lastClosedAt)}</span>
      </div>
      <small>{STATUS[clock.state]}</small>
    </div>
  );
}

export function CandleClosureCard({
  initialSymbol = "XAUUSD",
  onOpenChart,
}: {
  initialSymbol?: SharedChartSymbol;
  onOpenChart?: () => void;
}) {
  const [symbol, setSymbol] = useState<SharedChartSymbol>(initialSymbol);
  const [snapshot, setSnapshot] = useState<CandleClosureSnapshot | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const next = await brainRequest<CandleClosureSnapshot>(
          `/candle-closures?symbol=${encodeURIComponent(symbol)}`,
        );
        if (!active) return;
        setSnapshot(next);
        setError("");
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "Candle data unavailable.");
      } finally {
        inFlight = false;
      }
    };
    setSnapshot(null);
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(LIVE_REFRESH_EVENT, refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(LIVE_REFRESH_EVENT, refresh);
    };
  }, [symbol, refreshKey]);

  return (
    <section className="mb-candle-closure-card" aria-label="Verified candle close times">
      <div className="mb-candle-closure-card__header">
        <div>
          <small>CLOSED-CANDLE MONITOR · SHARED MARKET DATA</small>
          <h3><Clock3 size={21} /> Candle close times</h3>
          <p>UTC-aligned boundaries, shown in Vienna time. Setups use provider-verified closed candles, not this countdown.</p>
        </div>
        <div className="mb-candle-closure-card__actions">
          <select
            aria-label="Candle close symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value as SharedChartSymbol)}
          >
            <option value="XAUUSD">XAU/USD</option>
            <option value="GBPJPY">GBP/JPY</option>
          </select>
          <button type="button" aria-label="Refresh stored candle times" onClick={() => setRefreshKey((value) => value + 1)}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="mb-candle-closure-card__grid">
        {TIMEFRAMES.map((timeframe) => {
          const candle = snapshot?.symbol === symbol
            ? snapshot.candles.find((row) => row.timeframe === timeframe)
            : undefined;
          return <CandleClosureReadout
            key={timeframe}
            timeframe={timeframe}
            lastClosedOpenTime={candle?.lastClosedOpenTime ?? null}
            now={now}
            sourceAvailable={!error}
          />;
        })}
      </div>
      <div className="mb-candle-closure-card__footer">
        <span>{error || (snapshot
          ? `${snapshot.provider === "mt5" ? "MT5" : "Twelve Data"} · Stored scanner/chart candles · No extra provider call`
          : "Loading stored candle evidence…")}</span>
        {onOpenChart && <button type="button" onClick={onOpenChart}>Open live chart →</button>}
      </div>
    </section>
  );
}
