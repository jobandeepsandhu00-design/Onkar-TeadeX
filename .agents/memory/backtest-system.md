---
name: Backtest system
description: Architecture of the full candlestick replay + rule-based strategy tester feature
---

## Files
- `artifacts/api-server/src/routes/backtest.ts` — GET /api/backtest/candles endpoint
- `artifacts/trading-os/src/Backtest.tsx` — full self-contained UI component
- Registered in `artifacts/api-server/src/routes/index.ts`
- Wired as "backtest" tab in `artifacts/trading-os/src/App.tsx` (NAV_ITEMS + render)

## Tab mounting
BacktestTab is rendered inside a `position:fixed; inset:0; z-index:30` wrapper, so it escapes the parent's `overflow-y-auto` container and takes full screen. The bottom nav stays visible on top at z-40.

**Why:** The parent scroll container clips fixed-height canvas charts and makes replay controls inaccessible. Fixed overlay is the only reliable escape.

## Data source
- `TWELVE_DATA_API_KEY` env var → real OHLCV from Twelve Data API (free tier, 800 req/day)
- No key → generates realistic synthetic candles on the server (seeded random walk with per-symbol vol)
- 1-hour server-side cache keyed by `symbol:interval:outputsize`

## Candle format
`{ t: number (ms epoch), o, h, l, c: number }`

## Canvas chart
- Custom HTML5 Canvas renderer in `drawChart()` — no chart library
- DPR-aware (retina), ResizeObserver-driven redraws
- Shows EMA (amber) or SMA (indigo) overlay; buy/sell triangles; TP/SL dashed lines; exit dots
- Zoom via +/− buttons that adjust `visCount` (20–120 candles visible)

## Replay mode
- `idx` state = current candle index; `playing` + `setInterval` auto-advance at `speed` ms/step
- TP/SL checked per candle advance; trades closed automatically with win/loss
- Session stats: trade count, win rate, net pips

## Strategy mode
- Indicators: RSI (vs fixed level), EMA/SMA (close price vs indicator value)
- Conditions: CROSS_ABOVE / CROSS_BELOW / ABOVE / BELOW
- 1% fixed risk per trade; R:R = tp/sl
- Quick presets: RSI Bounce, RSI Short, EMA Breakout, SMA Trend
- Results: net P&L, win rate, profit factor, max drawdown, equity curve, last 15 trades
