/** Presentation-only fixtures. Never imported by APIs, scanner workers or journal persistence. */
export type AISection =
  | "dashboard"
  | "scanner"
  | "markets"
  | "watchlist"
  | "charts"
  | "setups"
  | "strategies"
  | "journal"
  | "backtesting"
  | "analytics"
  | "knowledge"
  | "evolution"
  | "assistant"
  | "news"
  | "risk"
  | "integrations"
  | "settings"
  | "connected";
export type SetupPreview = {
  id: string;
  symbol: string;
  name: string;
  asset: string;
  score: number;
  status:
    | "High quality"
    | "Confirmed"
    | "Watching"
    | "Partial match"
    | "Developing"
    | "Weak"
    | "Invalidated"
    | "Awaiting data";
  direction: "Long" | "Short";
  timeframe: string;
  price: number;
  change: string;
  entry: [number, number];
  stop: number;
  targets: [number, number];
  rr: number;
  rules: number;
  totalRules?: number;
  source?: "sample" | "verified";
  validation?: string;
  conditionsMatched?: string[];
  conditionsMissing?: string[];
  reason?: string;
  waitFor?: string;
  learningInsight?: string;
  candleClosed?: boolean;
  updatedAt?: string;
};
export const demoSetups: SetupPreview[] = [
  {
    id: "gold-rejection",
    symbol: "XAUUSD",
    name: "SRC Support Rejection",
    asset: "Gold",
    score: 91,
    status: "High quality",
    direction: "Long",
    timeframe: "15m",
    price: 2410.4,
    change: "+0.84%",
    entry: [2404, 2408],
    stop: 2395,
    targets: [2425, 2440],
    rr: 2.6,
    rules: 9,
  },
  {
    id: "nas-retest",
    symbol: "NAS100",
    name: "Breakout Retest",
    asset: "Indices",
    score: 84,
    status: "Watching",
    direction: "Long",
    timeframe: "5m",
    price: 19432.8,
    change: "+1.12%",
    entry: [19405, 19420],
    stop: 19370,
    targets: [19500, 19550],
    rr: 2.8,
    rules: 8,
  },
  {
    id: "eur-retest",
    symbol: "EURUSD",
    name: "Support Retest",
    asset: "Forex",
    score: 76,
    status: "Developing",
    direction: "Long",
    timeframe: "15m",
    price: 1.0842,
    change: "+0.21%",
    entry: [1.0825, 1.083],
    stop: 1.0812,
    targets: [1.0864, 1.088],
    rr: 2.4,
    rules: 7,
  },
  {
    id: "gbp-range",
    symbol: "GBPUSD",
    name: "Range Rejection",
    asset: "Forex",
    score: 54,
    status: "Weak",
    direction: "Short",
    timeframe: "1h",
    price: 1.2734,
    change: "−0.16%",
    entry: [1.275, 1.2755],
    stop: 1.277,
    targets: [1.271, 1.269],
    rr: 2.1,
    rules: 5,
  },
  {
    id: "btc-pullback",
    symbol: "BTCUSD",
    name: "Trend Continuation",
    asset: "Crypto",
    score: 82,
    status: "Watching",
    direction: "Long",
    timeframe: "1h",
    price: 67420,
    change: "+2.34%",
    entry: [67000, 67200],
    stop: 66600,
    targets: [68400, 69000],
    rr: 2.7,
    rules: 8,
  },
  {
    id: "us30-breakout",
    symbol: "US30",
    name: "Breakout Continuation",
    asset: "Indices",
    score: 72,
    status: "Developing",
    direction: "Long",
    timeframe: "30m",
    price: 39750,
    change: "+0.62%",
    entry: [39680, 39700],
    stop: 39600,
    targets: [39900, 40000],
    rr: 2.5,
    rules: 7,
  },
  {
    id: "ger40-retest",
    symbol: "GER40",
    name: "Resistance Retest",
    asset: "Indices",
    score: 68,
    status: "Watching",
    direction: "Short",
    timeframe: "15m",
    price: 18410,
    change: "−0.35%",
    entry: [18430, 18450],
    stop: 18490,
    targets: [18290, 18220],
    rr: 2.5,
    rules: 7,
  },
  {
    id: "aud-invalid",
    symbol: "AUDUSD",
    name: "Support Retest",
    asset: "Forex",
    score: 48,
    status: "Invalidated",
    direction: "Long",
    timeframe: "15m",
    price: 0.6612,
    change: "−0.28%",
    entry: [0.662, 0.6625],
    stop: 0.6615,
    targets: [0.6645, 0.666],
    rr: 2.2,
    rules: 4,
  },
];
export type InsightPreview = {
  id: string;
  kind:
    | "setup"
    | "entry"
    | "news"
    | "developing"
    | "invalidated"
    | "performance";
  setup?: SetupPreview;
  priority: number;
};
export const demoInsights: InsightPreview[] = [
  { id: "top", kind: "setup", setup: demoSetups[0], priority: 1 },
  { id: "approaching", kind: "entry", setup: demoSetups[1], priority: 2 },
  { id: "cpi", kind: "news", priority: 3 },
  { id: "developing", kind: "developing", setup: demoSetups[2], priority: 4 },
  { id: "invalidated", kind: "invalidated", setup: demoSetups[7], priority: 5 },
  { id: "performance", kind: "performance", priority: 6 },
];
export const demoEvents = [
  {
    time: "14:30",
    currency: "USD",
    title: "Consumer Price Index",
    impact: "High",
    forecast: "3.1%",
    previous: "3.2%",
  },
  {
    time: "14:30",
    currency: "USD",
    title: "Core CPI m/m",
    impact: "High",
    forecast: "0.3%",
    previous: "0.4%",
  },
  {
    time: "15:00",
    currency: "EUR",
    title: "ECB Economic Bulletin",
    impact: "Medium",
    forecast: "—",
    previous: "—",
  },
  {
    time: "16:00",
    currency: "USD",
    title: "Consumer Sentiment",
    impact: "Medium",
    forecast: "67.5",
    previous: "66.8",
  },
  {
    time: "18:00",
    currency: "GBP",
    title: "BoE Member Speech",
    impact: "Low",
    forecast: "—",
    previous: "—",
  },
];
export const demoTrades = [
  {
    symbol: "XAUUSD",
    setup: "SRC Support Rejection",
    session: "London",
    result: "Win",
    pnl: 520,
    r: 2.6,
    note: "Waited for the rejection close.",
  },
  {
    symbol: "NAS100",
    setup: "Breakout Retest",
    session: "New York",
    result: "Win",
    pnl: 340,
    r: 1.7,
    note: "Retest held the previous high.",
  },
  {
    symbol: "EURUSD",
    setup: "Support Retest",
    session: "London",
    result: "Loss",
    pnl: -200,
    r: -1,
    note: "Entered before confirmation.",
  },
  {
    symbol: "BTCUSD",
    setup: "Trend Continuation",
    session: "Asian",
    result: "Win",
    pnl: 420,
    r: 2.1,
    note: "Followed the higher-timeframe bias.",
  },
  {
    symbol: "GBPUSD",
    setup: "Range Rejection",
    session: "New York",
    result: "Loss",
    pnl: -200,
    r: -1,
    note: "Insufficient range to target.",
  },
];
export const performanceSeries = [
  0, 200, 120, 340, 520, 410, 680, 590, 850, 790, 1030, 880,
].map((value, i) => ({ label: `${i + 1}`, value }));
export const price = (value: number) =>
  value < 10
    ? value.toFixed(4)
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const sectionPath = (section: string) =>
  `/onkar-ai${section === "dashboard" ? "" : `/${section}`}`;
export const setupPath = (id: string) =>
  `/onkar-ai/setup/${encodeURIComponent(id)}`;
