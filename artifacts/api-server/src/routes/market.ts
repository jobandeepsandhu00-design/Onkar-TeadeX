import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface PriceResult {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  change: number;
  changePct: number;
  currency: string;
  name: string;
  fetchedAt: number;
}

const priceCache = new Map<string, { data: PriceResult; at: number }>();
const CACHE_TTL = 15_000; // 15 seconds — fresh enough for entry price suggestions

function toYahooSymbol(raw: string): string {
  const s = raw.toUpperCase().replace(/[/\s]/g, "");

  // Crypto: BTCUSD → BTC-USD, ETHUSD → ETH-USD
  const cryptoMatch = s.match(/^([A-Z]{2,6})(USDT?|EUR|GBP|BTC|ETH)$/);
  if (cryptoMatch && s.length <= 10) {
    const base = cryptoMatch[1];
    const quote = cryptoMatch[2].replace("USDT", "USD");
    if (["BTC","ETH","SOL","XRP","LTC","DOGE","ADA","DOT","LINK","AVAX","MATIC","BNB"].includes(base)) {
      return `${base}-${quote}`;
    }
  }

  // Known indices
  const indices: Record<string, string> = {
    US30: "^DJI", DJI: "^DJI",
    NAS100: "^NDX", NASDAQ: "^NDX", NDX: "^NDX",
    SPX: "^GSPC", SP500: "^GSPC", SPX500: "^GSPC",
    DAX: "^GDAXI", DAX40: "^GDAXI",
    FTSE100: "^FTSE", FTSE: "^FTSE",
    NIKKEI: "^N225", NI225: "^N225",
    ASX200: "^AXJO",
    VIX: "^VIX",
    XAUUSD: "GC=F", GOLD: "GC=F", XAGUSD: "SI=F", SILVER: "SI=F",
    WTIUSD: "CL=F", OIL: "CL=F", CRUDE: "CL=F",
    NATGAS: "NG=F",
  };
  if (indices[s]) return indices[s];

  // Forex pairs 6 chars: EURUSD → EURUSD=X
  if (/^[A-Z]{6}$/.test(s)) return `${s}=X`;

  // Already has suffix or is a stock ticker
  return s;
}

router.get("/market/price/:symbol", async (req, res) => {
  const raw = (req.params.symbol || "").trim();
  if (!raw || raw.length < 3 || raw.length > 20) {
    return void res.status(400).json({ error: "Invalid symbol" });
  }

  const yahooSym = toYahooSymbol(raw);
  const cached = priceCache.get(yahooSym);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return void res.json(cached.data);
  }

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1m&range=1d`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OTX/1.0)",
        "Accept": "application/json",
      },
    });

    if (!r.ok) {
      return void res.status(502).json({ error: `Yahoo returned ${r.status}` });
    }

    const json: any = await r.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) {
      return void res.status(502).json({ error: "No price data" });
    }

    const price: number = meta.regularMarketPrice ?? meta.previousClose ?? 0;
    const result: PriceResult = {
      symbol: raw.toUpperCase(),
      price,
      bid: typeof meta.bid === "number" ? meta.bid : null,
      ask: typeof meta.ask === "number" ? meta.ask : null,
      change: (meta.regularMarketPrice ?? 0) - (meta.chartPreviousClose ?? meta.previousClose ?? 0),
      changePct: meta.regularMarketChangePercent ?? 0,
      currency: meta.currency ?? "USD",
      name: meta.longName ?? meta.shortName ?? raw.toUpperCase(),
      fetchedAt: Date.now(),
    };

    priceCache.set(yahooSym, { data: result, at: Date.now() });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch price" });
  }
});

export default router;
