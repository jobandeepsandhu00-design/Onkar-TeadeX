import {
  candleSchema,
  timeframeMs,
  type Candle,
  type Timeframe,
  type FeatureValue,
} from "@workspace/api-zod";

export function validClosedBars(
  raw: unknown[],
  timeframe: Timeframe,
  now = Date.now(),
): Candle[] {
  const unique = new Map<number, Candle>();
  for (const item of raw) {
    const parsed = candleSchema.safeParse(item);
    if (!parsed.success)
      throw new Error("Provider returned invalid OHLCV data");
    const c = parsed.data;
    if (c.t + timeframeMs[timeframe] <= now) unique.set(c.t, c);
  }
  return [...unique.values()].sort((a, b) => a.t - b.t);
}
export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export function sma(values: number[], period = 20): number | null {
  return values.length >= period ? mean(values.slice(-period)) : null;
}
export function emaSeries(
  values: number[],
  period: number,
): Array<number | null> {
  let previous = 0;
  return values.map((v, i) => {
    if (i < period - 1) return null;
    previous =
      i === period - 1
        ? mean(values.slice(0, period))
        : v * (2 / (period + 1)) + previous * (1 - 2 / (period + 1));
    return previous;
  });
}
export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gain = 0,
    loss = 0;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (i <= period) {
      gain += Math.max(delta, 0) / period;
      loss += Math.max(-delta, 0) / period;
    } else {
      gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    }
  }
  return gain === 0 && loss === 0
    ? 50
    : loss === 0
      ? 100
      : 100 - 100 / (1 + gain / loss);
}
export function indicators(bars: Candle[]) {
  const closes = bars.map((b) => b.c);
  const last = bars.at(-1);
  if (!last) throw new Error("No completed candles");
  const trs = bars
    .slice(1)
    .map((b, i) =>
      Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)),
    );
  let atr = trs.length >= 14 ? mean(trs.slice(0, 14)) : null;
  if (atr !== null)
    for (const value of trs.slice(14)) atr = (atr * 13 + value) / 14;
  const e12 = emaSeries(closes, 12),
    e26 = emaSeries(closes, 26);
  const macds = closes.flatMap((_, i) =>
    e12[i] !== null && e26[i] !== null ? [e12[i]! - e26[i]!] : [],
  );
  const middle = sma(closes),
    deviation =
      middle === null
        ? null
        : Math.sqrt(mean(closes.slice(-20).map((c) => (c - middle) ** 2)));
  const volumes = bars.slice(-21, -1).map((b) => b.v);
  const volumeAverage =
    volumes.length === 20 && volumes.every((v) => v !== null)
      ? mean(volumes as number[])
      : null;
  const body = Math.abs(last.c - last.o),
    range = last.h - last.l;
  return {
    close: last.c,
    ema20: emaSeries(closes, 20).at(-1) ?? null,
    ema50: emaSeries(closes, 50).at(-1) ?? null,
    ema100: emaSeries(closes, 100).at(-1) ?? null,
    ema200: emaSeries(closes, 200).at(-1) ?? null,
    sma: middle,
    rsi: rsi(closes),
    atr,
    macd: macds.at(-1) ?? null,
    macdSignal: emaSeries(macds, 9).at(-1) ?? null,
    bollinger:
      middle !== null && deviation !== null
        ? {
            middle,
            upper: middle + deviation * 2,
            lower: middle - deviation * 2,
          }
        : null,
    volume: last.v,
    volumeAverage,
    volumeRatio:
      volumeAverage && last.v !== null ? last.v / volumeAverage : null,
    volatility: atr === null ? null : atr / last.c,
    range,
    body,
    upperWick: last.h - Math.max(last.c, last.o),
    lowerWick: Math.min(last.c, last.o) - last.l,
    bodyRatio: range ? body / range : 0,
  };
}
export type Swing = {
  type: "high" | "low";
  price: number;
  t: number;
  confirmedAt: number;
};
export function marketStructure(
  bars: Candle[],
  span = 2,
  timeframe?: Timeframe,
) {
  const duration = timeframe
    ? timeframeMs[timeframe]
    : Math.min(
        ...bars
          .slice(1)
          .map((b, i) => b.t - bars[i].t)
          .filter((t) => t > 0),
      );
  const swings: Swing[] = [];
  // Both right-side candles must already exist in the supplied history.
  for (let i = span; i < bars.length - span; i++) {
    const neighbors = bars
      .slice(i - span, i + span + 1)
      .filter((_, j) => j !== span);
    if (neighbors.every((c) => c.h < bars[i].h))
      swings.push({
        type: "high",
        price: bars[i].h,
        t: bars[i].t,
        confirmedAt: bars[i + span].t + duration,
      });
    if (neighbors.every((c) => c.l > bars[i].l))
      swings.push({
        type: "low",
        price: bars[i].l,
        t: bars[i].t,
        confirmedAt: bars[i + span].t + duration,
      });
  }
  const highs = swings.filter((s) => s.type === "high"),
    lows = swings.filter((s) => s.type === "low");
  const hh = highs.length >= 2 && highs.at(-1)!.price > highs.at(-2)!.price;
  const hl = lows.length >= 2 && lows.at(-1)!.price > lows.at(-2)!.price;
  const lh = highs.length >= 2 && highs.at(-1)!.price < highs.at(-2)!.price;
  const ll = lows.length >= 2 && lows.at(-1)!.price < lows.at(-2)!.price;
  const trend = hh && hl ? "bullish" : lh && ll ? "bearish" : "ranging";
  const last = bars.at(-1),
    previous = bars.at(-2),
    high = highs.at(-1),
    low = lows.at(-1);
  const bos =
    last && previous && high && previous.c <= high.price && last.c > high.price
      ? "bullish"
      : last && previous && low && previous.c >= low.price && last.c < low.price
        ? "bearish"
        : null;
  const window = bars.slice(-20),
    displacement = window.length ? Math.abs(window.at(-1)!.c - window[0].o) : 0;
  const path = window.reduce((sum, c) => sum + c.h - c.l, 0);
  return {
    swings: swings.slice(-40),
    higherHigh: hh,
    higherLow: hl,
    lowerHigh: lh,
    lowerLow: ll,
    trend,
    bos,
    choch: bos && trend !== "ranging" && trend !== bos ? bos : null,
    strength: path ? displacement / path : 0,
  };
}
export type Zone = {
  id: string;
  type: "support" | "resistance" | "equal_highs" | "equal_lows";
  low: number;
  high: number;
  createdAt: number;
  touches: number;
  strength: number;
  freshness: number;
  lastTested: number | null;
  invalidated: boolean;
  method: string;
};
export function detectZones(
  bars: Candle[],
  atr: number | null,
  timeframe?: Timeframe,
): Zone[] {
  if (!atr || bars.length < 10) return [];
  const swings = marketStructure(bars, 2, timeframe).swings;
  const duration = timeframe
    ? timeframeMs[timeframe]
    : Math.min(
        ...bars
          .slice(1)
          .map((b, i) => b.t - bars[i].t)
          .filter((t) => t > 0),
      );
  return swings.slice(-16).map((s) => {
    // Freeze the band's width using only candles available when the swing was confirmed.
    // Recomputing it from today's ATR could resurrect an already invalidated zone.
    const atCreation = bars.filter((c) => c.t + duration <= s.confirmedAt);
    const width =
      (indicators(atCreation).atr ?? mean(atCreation.map((c) => c.h - c.l))) *
      0.15;
    const after = bars.filter((c) => c.t >= s.confirmedAt);
    const tests = after.filter(
      (c) => c.l <= s.price + width && c.h >= s.price - width,
    );
    const equal =
      swings.filter(
        (other) =>
          other.type === s.type && Math.abs(other.price - s.price) < width,
      ).length > 1;
    return {
      id: `${s.type}:${s.t}`,
      type: (equal
        ? s.type === "high"
          ? "equal_highs"
          : "equal_lows"
        : s.type === "high"
          ? "resistance"
          : "support") as Zone["type"],
      low: s.price - width,
      high: s.price + width,
      createdAt: s.confirmedAt,
      touches: tests.length,
      strength: Math.min(100, 40 + tests.length * 10),
      freshness: Math.max(0, 100 - tests.length * 15),
      lastTested: tests.at(-1)?.t ?? null,
      invalidated: after.some((c) =>
        s.type === "high" ? c.c > s.price + width : c.c < s.price - width,
      ),
      method: "confirmed_fractal_atr_band_v1",
    };
  });
}
export function priceAction(bars: Candle[]) {
  const c = bars.at(-1),
    p = bars.at(-2);
  if (!c || !p)
    return {
      rejection: "none",
      engulfing: "none",
      breakout: "none",
      sweep: "none",
      inside: false,
      momentum: "none",
      consolidation: false,
    };
  const range = c.h - c.l,
    body = Math.abs(c.c - c.o),
    upper = c.h - Math.max(c.o, c.c),
    lower = Math.min(c.o, c.c) - c.l;
  const prior = bars.slice(-21, -1),
    high = Math.max(...prior.map((b) => b.h)),
    low = Math.min(...prior.map((b) => b.l));
  return {
    rejection:
      range > 0 && lower / range > 0.55 && c.c > c.o
        ? "bullish"
        : range > 0 && upper / range > 0.55 && c.c < c.o
          ? "bearish"
          : "none",
    engulfing:
      c.c > c.o && p.c < p.o && c.c > p.o && c.o <= p.c
        ? "bullish"
        : c.c < c.o && p.c > p.o && c.c < p.o && c.o >= p.c
          ? "bearish"
          : "none",
    breakout: c.c > high ? "bullish" : c.c < low ? "bearish" : "none",
    sweep:
      c.l < low && c.c > low
        ? "bullish"
        : c.h > high && c.c < high
          ? "bearish"
          : "none",
    inside: c.h <= p.h && c.l >= p.l,
    momentum:
      range > 0 && body / range >= 0.7
        ? c.c > c.o
          ? "bullish"
          : "bearish"
        : "none",
    consolidation:
      prior.length === 20 && high - low < mean(prior.map((b) => b.h - b.l)) * 4,
  };
}
export function marketSession(time: number): string {
  const parts = (zone: string) => {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(time);
    return {
      hour: Number(p.find((v) => v.type === "hour")?.value),
      day: p.find((v) => v.type === "weekday")?.value,
    };
  };
  const london = parts("Europe/London"),
    ny = parts("America/New_York"),
    tokyo = parts("Asia/Tokyo");
  const weekday = (d: string | undefined) => d !== "Sat" && d !== "Sun";
  const l = weekday(london.day) && london.hour >= 8 && london.hour < 17,
    n = weekday(ny.day) && ny.hour >= 8 && ny.hour < 17;
  return l && n
    ? "London/NY"
    : l
      ? "London"
      : n
        ? "New York"
        : weekday(tokyo.day) && tokyo.hour >= 9 && tokyo.hour < 18
          ? "Asia"
          : "Outside sessions";
}
export function timeframeContext(
  bars: Candle[],
  timeframe: Timeframe,
  now: number,
) {
  const stats = indicators(bars),
    structure = marketStructure(bars, 2, timeframe),
    patterns = priceAction(bars),
    last = bars.at(-1)!;
  const gaps = bars
    .slice(1)
    .filter((c, i) => c.t - bars[i].t > timeframeMs[timeframe] * 1.5).length;
  const stale =
    now - (last.t + timeframeMs[timeframe]) > timeframeMs[timeframe] * 1.5;
  const zones = detectZones(bars, stats.atr, timeframe);
  const features: Record<string, FeatureValue> = {
    ...patterns,
    close: stats.close,
    ema20: stats.ema20,
    ema50: stats.ema50,
    ema200: stats.ema200,
    rsi: stats.rsi,
    atr: stats.atr,
    volumeRatio: stats.volumeRatio,
    trend: structure.trend,
    structure: structure.bos || structure.trend,
    session: marketSession(last.t),
  };
  return {
    timeframe,
    lastCandleAt: new Date(last.t).toISOString(),
    stale,
    gaps,
    indicators: stats,
    structure,
    patterns,
    zones,
    features,
  };
}
export type TimeframeContext = ReturnType<typeof timeframeContext>;
