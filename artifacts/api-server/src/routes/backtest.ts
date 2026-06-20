import { Router } from "express";

const router: Router = Router();

type Candle = { t: number; o: number; h: number; l: number; c: number };

const cache = new Map<string, { data: Candle[]; at: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const BASE_PRICES: Record<string, number> = {
  EURUSD: 1.085, GBPUSD: 1.265, USDJPY: 149.5, XAUUSD: 2025, AUDUSD: 0.655,
  USDCAD: 1.355, GBPJPY: 189.5, EURJPY: 162.0, NZDUSD: 0.605, US30: 38200,
  NAS100: 17600, USDCHF: 0.905, GBPCAD: 1.712, EURGBP: 0.858,
};
const VOLATILITY: Record<string, number> = {
  EURUSD: 0.0007, GBPUSD: 0.0009, USDJPY: 0.11, XAUUSD: 2.2,
  AUDUSD: 0.0007, USDCAD: 0.0007, GBPJPY: 0.14, EURJPY: 0.11,
  NZDUSD: 0.0006, US30: 70, NAS100: 110, USDCHF: 0.0006,
  GBPCAD: 0.0010, EURGBP: 0.0005,
};

function intervalMs(iv: string): number {
  const m: Record<string, number> = {
    "1min": 60_000, "5min": 300_000, "15min": 900_000,
    "30min": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1day": 86_400_000,
  };
  return m[iv] ?? 3_600_000;
}

function generateCandles(symbol: string, interval: string, count: number): Candle[] {
  const base = BASE_PRICES[symbol] ?? 1.0;
  const vol  = VOLATILITY[symbol] ?? 0.001;
  const ms   = intervalMs(interval);
  const dp   = symbol.includes("JPY") ? 3 : symbol === "XAUUSD" ? 3 : symbol.includes("30") || symbol.includes("100") ? 1 : 5;
  const now  = Math.floor(Date.now() / ms) * ms;

  let price = base, trend = 0;
  const candles: Candle[] = [];

  for (let i = count - 1; i >= 0; i--) {
    if (Math.random() < 0.03) trend = (Math.random() - 0.5) * 2;
    const t    = now - i * ms;
    const move = (Math.random() - 0.49 + trend * 0.02) * vol;
    const o    = price;
    const c    = Math.max(base * 0.8, Math.min(base * 1.2, o + move));
    const rng  = Math.abs(move) * (1 + Math.random() * 1.5);
    const h    = Math.max(o, c) + rng * Math.random() * 0.8;
    const l    = Math.min(o, c) - rng * Math.random() * 0.8;
    candles.push({ t, o: +o.toFixed(dp), h: +h.toFixed(dp), l: +l.toFixed(dp), c: +c.toFixed(dp) });
    price = c;
  }
  return candles;
}

router.get("/backtest/candles", async (req, res): Promise<void> => {
  const symbol     = ((req.query.symbol as string) || "EURUSD").toUpperCase().replace(/[/\s]/g, "");
  const interval   = (req.query.interval as string) || "1h";
  const outputsize = Math.min(parseInt((req.query.outputsize as string) || "300"), 5000);

  const key    = `${symbol}:${interval}:${outputsize}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    res.json({ symbol, interval, candles: cached.data, source: "cache" });
    return;
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (apiKey) {
    try {
      const FOREX = new Set(["EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","NZDUSD","GBPJPY","EURJPY","USDCHF","GBPCAD","EURGBP"]);
      const tdSym = FOREX.has(symbol) ? `${symbol.slice(0,3)}/${symbol.slice(3)}` : symbol;
      const url   = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&format=JSON`;
      const r     = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const json  = await r.json() as any;

      if (json.status === "error" || !Array.isArray(json.values)) {
        throw new Error(json.message ?? "Invalid response from Twelve Data");
      }

      const candles: Candle[] = json.values.reverse().map((v: any) => ({
        t: new Date(v.datetime.length === 10 ? v.datetime + "T00:00:00Z" : v.datetime + "Z").getTime(),
        o: parseFloat(v.open), h: parseFloat(v.high),
        l: parseFloat(v.low),  c: parseFloat(v.close),
      }));

      cache.set(key, { data: candles, at: Date.now() });
      res.json({ symbol, interval, candles, source: "twelvedata" });
      return;
    } catch (err: any) {
      req.log.warn({ err: err.message }, "Twelve Data fetch failed — using generated data");
    }
  }

  const candles = generateCandles(symbol, interval, outputsize);
  cache.set(key, { data: candles, at: Date.now() });
  res.json({ symbol, interval, candles, source: "generated" });
});

export default router;
