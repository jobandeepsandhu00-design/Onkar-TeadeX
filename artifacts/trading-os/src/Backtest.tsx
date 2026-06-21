import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play, Pause, SkipForward, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, RefreshCw, BarChart3, Zap,
  CheckCircle2, XCircle, RotateCcw, FlaskConical,
  Minus, Square, Trash2, MousePointer2, Maximize2, Minimize2,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────── */
type Candle = { t: number; o: number; h: number; l: number; c: number };
type RtTrade = {
  id: string; dir: "long" | "short";
  entry: number; sl: number; tp: number; entryIdx: number;
  exitIdx?: number; exitPrice?: number; pnl?: number; result?: "win" | "loss";
};
type BtTrade = { dir: string; entry: number; exit: number; pnl: number; result: "win" | "loss" };
type BtResult = {
  trades: BtTrade[]; netPnl: number; winRate: number;
  profitFactor: number; maxDrawdown: number; equity: number[];
};
type StrategyCfg = {
  indicator: "RSI" | "EMA" | "SMA";
  period: number;
  condition: "CROSS_ABOVE" | "CROSS_BELOW" | "ABOVE" | "BELOW";
  level: number;
  direction: "LONG" | "SHORT" | "BOTH";
  tp: number; sl: number;
  startBalance: number;
};
type ChartView = { vs: number; pLo: number; pRange: number; barW: number; cW: number; cH: number };
type DrawTool = "cursor" | "rect" | "hline" | "tline";
type DrawShape =
  | { id: string; kind: "rect";  i1: number; p1: number; i2: number; p2: number; color: string }
  | { id: string; kind: "hline"; price: number; color: string }
  | { id: string; kind: "tline"; i1: number; p1: number; i2: number; p2: number; color: string };

/* ── Indicators ───────────────────────────────────────── */
function calcSMA(data: number[], n: number): (number | null)[] {
  return data.map((_, i) =>
    i < n - 1 ? null : data.slice(i - n + 1, i + 1).reduce((s, v) => s + v, 0) / n
  );
}
function calcEMA(data: number[], n: number): (number | null)[] {
  const k = 2 / (n + 1);
  const r: (number | null)[] = [];
  let p: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < n - 1) { r.push(null); continue; }
    if (i === n - 1) { p = data.slice(0, n).reduce((s, v) => s + v, 0) / n; r.push(p); continue; }
    p = data[i] * k + p! * (1 - k); r.push(p);
  }
  return r;
}
function calcRSI(data: number[], n = 14): (number | null)[] {
  if (data.length <= n) return data.map(() => null);
  const r: (number | null)[] = Array(n).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) { const d = data[i] - data[i - 1]; d > 0 ? (ag += d) : (al -= d); }
  ag /= n; al /= n;
  r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = n + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    ag = (ag * (n - 1) + (d > 0 ? d : 0)) / n;
    al = (al * (n - 1) + (d < 0 ? -d : 0)) / n;
    r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return r;
}

/* ── Utils ────────────────────────────────────────────── */
function getPip(sym: string) {
  const s = sym.toUpperCase();
  if (s.includes("JPY")) return 0.01;
  if (s === "XAUUSD") return 0.1;
  if (s === "US30" || s === "NAS100") return 1;
  return 0.0001;
}
function dp(pip: number) { return pip >= 1 ? 0 : pip >= 0.1 ? 1 : pip >= 0.01 ? 2 : 4; }
function fmt(p: number, pip: number) { return p.toFixed(dp(pip)); }
function fmtPnl(n: number) { return (n >= 0 ? "+" : "") + n.toFixed(1); }

/* ── Shape painter ─────────────────────────────────────── */
function paintShapes(
  ctx: CanvasRenderingContext2D,
  shapes: DrawShape[],
  toY: (p: number) => number,
  barW: number,
  vs: number,
  cW: number,
  decimals: number,
) {
  shapes.forEach(s => {
    ctx.save();
    if (s.kind === "hline") {
      const y = toY(s.price);
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cW, y); ctx.stroke();
      ctx.setLineDash([]);
      const lbl = s.price.toFixed(decimals);
      const lw = ctx.measureText(lbl).width + 10;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = s.color;
      if (ctx.roundRect) ctx.roundRect(4, y - 9, lw, 14, 3); else ctx.rect(4, y - 9, lw, 14);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000"; ctx.font = "bold 8px monospace";
      ctx.fillText(lbl, 8, y + 3);
    } else if (s.kind === "rect") {
      const x1 = (s.i1 - vs + 0.5) * barW;
      const x2 = (s.i2 - vs + 0.5) * barW;
      const y1 = toY(s.p1), y2 = toY(s.p2);
      const left = Math.min(x1, x2), top = Math.min(y1, y2);
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      if (w > 1 && h > 1) {
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = s.color; ctx.fillRect(left, top, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.strokeRect(left, top, w, h);
      }
    } else if (s.kind === "tline") {
      const x1 = (s.i1 - vs + 0.5) * barW;
      const x2 = (s.i2 - vs + 0.5) * barW;
      const y1 = toY(s.p1), y2 = toY(s.p2);
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(pt => {
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#05091a";
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.restore();
  });
}

/* ── Canvas chart ─────────────────────────────────────── */
function drawChart(
  canvas: HTMLCanvasElement,
  candles: Candle[],
  viewEnd: number,
  visCount: number,
  overlay: { vals: (number | null)[]; color: string } | null,
  markers: { idx: number; type: "buy" | "sell" | "exit"; price: number }[],
  openTrades: RtTrade[],
  pip: number,
  shapes: DrawShape[],
  preview: DrawShape | null,
  viewOut: React.MutableRefObject<ChartView | null>,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !candles.length) return;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * DPR || canvas.height !== H * DPR) {
    canvas.width = W * DPR; canvas.height = H * DPR;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const MR = 58, MB = 22, cW = W - MR, cH = H - MB;
  ctx.fillStyle = "#05091a"; ctx.fillRect(0, 0, W, H);

  const vs = Math.max(0, viewEnd - visCount + 1);
  const visible = candles.slice(vs, viewEnd + 1);
  if (!visible.length) return;

  const mn = Math.min(...visible.map(c => c.l));
  const mx = Math.max(...visible.map(c => c.h));
  const pad = Math.max((mx - mn) * 0.1, pip * 5);
  const pLo = mn - pad, pHi = mx + pad, pRng = pHi - pLo;
  if (pRng <= 0) return;

  const toY = (p: number) => cH - ((p - pLo) / pRng) * cH;
  const barW = cW / visCount;
  const bW = Math.max(2, barW * 0.65);
  const decimals = dp(pip);

  // Export view params for pointer-coordinate conversion
  viewOut.current = { vs, pLo, pRange: pRng, barW, cW, cH };

  // Grid
  for (let g = 0; g <= 5; g++) {
    const y = (g / 5) * cH;
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cW, y); ctx.stroke();
    ctx.fillStyle = "#374151"; ctx.font = "9px monospace";
    ctx.fillText((pHi - (g / 5) * pRng).toFixed(decimals), cW + 3, y + 4);
  }

  // Time labels
  ctx.fillStyle = "#374151"; ctx.font = "8px monospace";
  const step = Math.max(1, Math.floor(visCount / 5));
  visible.forEach((_, i) => {
    if (i % step !== 0) return;
    const d = new Date(candles[vs + i].t);
    const label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    ctx.fillText(label, (i + 0.5) * barW - 20, cH + 18);
  });

  // TP/SL dashed lines for open trades
  openTrades.forEach(t => {
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(34,197,94,0.45)";
    ctx.beginPath(); ctx.moveTo(0, toY(t.tp)); ctx.lineTo(cW, toY(t.tp)); ctx.stroke();
    ctx.strokeStyle = "rgba(239,68,68,0.45)";
    ctx.beginPath(); ctx.moveTo(0, toY(t.sl)); ctx.lineTo(cW, toY(t.sl)); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Overlay line
  if (overlay) {
    ctx.strokeStyle = overlay.color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); let st = false;
    visible.forEach((_, i) => {
      const v = overlay.vals[vs + i];
      if (v === null || v === undefined) return;
      const x = (i + 0.5) * barW, y = toY(v);
      !st ? (ctx.moveTo(x, y), st = true) : ctx.lineTo(x, y);
    });
    if (st) ctx.stroke();
  }

  // Candles
  visible.forEach((c, i) => {
    const bull = c.c >= c.o;
    const col = bull ? "#22c55e" : "#ef4444";
    const x = (i + 0.5) * barW;
    const bT = toY(Math.max(c.o, c.c)), bB = toY(Math.min(c.o, c.c));
    const bH = Math.max(1, bB - bT);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, toY(c.h)); ctx.lineTo(x, toY(c.l)); ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(x - bW / 2, bT, bW, bH);
    if (bull) { ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(x - bW / 2, bT, bW, bH); }
    if (vs + i === viewEnd) {
      ctx.strokeStyle = "rgba(251,191,36,0.7)"; ctx.lineWidth = 1.5;
      ctx.strokeRect(x - bW / 2 - 1, bT - 1, bW + 2, bH + 2);
    }
  });

  // Markers (buy/sell triangles, exit dots)
  markers.forEach(m => {
    const i = m.idx - vs;
    if (i < 0 || i >= visible.length) return;
    const x = (i + 0.5) * barW;
    if (m.type === "exit") {
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.arc(x, toY(m.price), 5, 0, Math.PI * 2); ctx.fill();
    } else {
      const isBuy = m.type === "buy";
      const base = isBuy ? toY(visible[i].l) + 16 : toY(visible[i].h) - 16;
      ctx.fillStyle = isBuy ? "#22c55e" : "#ef4444";
      ctx.beginPath();
      isBuy
        ? (ctx.moveTo(x, base - 10), ctx.lineTo(x + 6, base), ctx.lineTo(x - 6, base))
        : (ctx.moveTo(x, base + 10), ctx.lineTo(x + 6, base), ctx.lineTo(x - 6, base));
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(x - 11, isBuy ? base - 22 : base - 2, 22, 11);
      ctx.fillStyle = isBuy ? "#4ade80" : "#f87171"; ctx.font = "bold 8px monospace";
      ctx.fillText(isBuy ? "BUY" : "SELL", x - 10, isBuy ? base - 13 : base + 7);
    }
  });

  // Current price line + label
  const last = visible[visible.length - 1];
  const py = toY(last.c);
  ctx.strokeStyle = "rgba(245,158,11,0.6)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(cW, py); ctx.stroke();
  ctx.setLineDash([]);
  const lbl = last.c.toFixed(decimals);
  ctx.fillStyle = "#f59e0b";
  if (ctx.roundRect) ctx.roundRect(cW + 2, py - 9, MR - 4, 18, 3); else ctx.rect(cW + 2, py - 9, MR - 4, 18);
  ctx.fill();
  ctx.fillStyle = "#000"; ctx.font = "bold 9px monospace";
  ctx.fillText(lbl, cW + 5, py + 4);

  // Draw shapes + live preview on top of everything
  paintShapes(ctx, preview ? [...shapes, preview] : shapes, toY, barW, vs, cW, decimals);
}

/* ── Backtest engine ──────────────────────────────────── */
function runBacktest(candles: Candle[], cfg: StrategyCfg, pip: number): BtResult {
  const closes = candles.map(c => c.c);
  let ind: (number | null)[] = [];
  if (cfg.indicator === "RSI") ind = calcRSI(closes, cfg.period);
  else if (cfg.indicator === "EMA") ind = calcEMA(closes, cfg.period);
  else ind = calcSMA(closes, cfg.period);

  const trades: BtTrade[] = [];
  let balance = cfg.startBalance;
  const equity = [balance];
  let open: { dir: "LONG" | "SHORT"; entry: number; tp: number; sl: number } | null = null;
  const tpD = cfg.tp * pip, slD = cfg.sl * pip;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pv = ind[i - 1], cv = ind[i];
    if (pv === null || cv === null) continue;

    if (open) {
      let ep: number | null = null, win = false;
      if (open.dir === "LONG") {
        if (c.l <= open.sl) { ep = open.sl; win = false; }
        else if (c.h >= open.tp) { ep = open.tp; win = true; }
      } else {
        if (c.h >= open.sl) { ep = open.sl; win = false; }
        else if (c.l <= open.tp) { ep = open.tp; win = true; }
      }
      if (ep !== null) {
        const risk = balance * 0.01;
        const pnl = win ? risk * (cfg.tp / Math.max(1, cfg.sl)) : -risk;
        balance += pnl;
        trades.push({ dir: open.dir, entry: open.entry, exit: ep, pnl, result: win ? "win" : "loss" });
        equity.push(balance);
        open = null;
      }
    }

    if (!open) {
      let sig: "LONG" | "SHORT" | null = null;
      if (cfg.indicator === "RSI") {
        const lvl = cfg.level;
        if (cfg.condition === "CROSS_ABOVE" && pv <= lvl && cv > lvl) sig = "LONG";
        else if (cfg.condition === "CROSS_BELOW" && pv >= lvl && cv < lvl) sig = "SHORT";
        else if (cfg.condition === "ABOVE" && cv > lvl) sig = "LONG";
        else if (cfg.condition === "BELOW" && cv < lvl) sig = "SHORT";
      } else {
        const pc = closes[i - 1], cc = closes[i];
        if (cfg.condition === "CROSS_ABOVE" && pc <= pv && cc > cv) sig = "LONG";
        else if (cfg.condition === "CROSS_BELOW" && pc >= pv && cc < cv) sig = "SHORT";
        else if (cfg.condition === "ABOVE" && cc > cv) sig = "LONG";
        else if (cfg.condition === "BELOW" && cc < cv) sig = "SHORT";
      }
      if (sig && (cfg.direction === "BOTH" || cfg.direction === sig)) {
        const entry = c.o;
        open = {
          dir: sig, entry,
          tp: sig === "LONG" ? entry + tpD : entry - tpD,
          sl: sig === "LONG" ? entry - slD : entry + slD,
        };
      }
    }
  }

  const wins = trades.filter(t => t.result === "win").length;
  const gw = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  let peak = equity[0] || cfg.startBalance, maxDD = 0;
  equity.forEach(e => { if (e > peak) peak = e; const dd = (peak - e) / peak * 100; if (dd > maxDD) maxDD = dd; });

  return {
    trades, netPnl: balance - cfg.startBalance,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    maxDrawdown: maxDD, equity,
  };
}

/* ── Mini equity curve canvas ─────────────────────────── */
function EqCurve({ equity }: { equity: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || equity.length < 2) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * 2; canvas.height = H * 2; ctx.scale(2, 2);
    const mn = Math.min(...equity), mx = Math.max(...equity), rng = mx - mn || 1;
    const toY = (v: number) => H - ((v - mn) / rng) * (H - 4) - 2;
    const profit = equity[equity.length - 1] >= equity[0];
    ctx.fillStyle = "#07101f"; ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, profit ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    equity.forEach((v, i) => {
      const x = (i / (equity.length - 1)) * W, y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = profit ? "#22c55e" : "#ef4444"; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  }, [equity]);
  return <canvas ref={ref} style={{ width: "100%", height: 64, borderRadius: 6, display: "block" }} />;
}

/* ── Constants ────────────────────────────────────────── */
const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "AUDUSD", "USDCAD", "GBPJPY", "EURJPY", "US30", "NAS100", "USDCHF", "EURGBP"];
const INTERVALS = [
  { label: "M1", value: "1min" }, { label: "M5", value: "5min" },
  { label: "M15", value: "15min" }, { label: "M30", value: "30min" },
  { label: "H1", value: "1h" }, { label: "H4", value: "4h" }, { label: "D1", value: "1day" },
];
// Candles to request per timeframe (backend caps at 5000)
const OUTPUTSIZE: Record<string, number> = {
  "1min": 1500, "5min": 1500, "15min": 2000, "30min": 2000,
  "1h": 2000, "4h": 2000, "1day": 500,
};

/* ═══════════════════════════════════════════════════════
   SMC / SMART RAJA STRATEGY BUILDER
═══════════════════════════════════════════════════════ */
const _uid = () => Math.random().toString(36).slice(2, 10);

type SmcCondition = { id: string; label: string; group: string; desc: string; w: number };
const SMC_CONDS: SmcCondition[] = [
  { id:"bos",       label:"BOS – Break of Structure",       group:"Structure",   desc:"Price breaks a significant swing high/low confirming new trend.",                  w:3 },
  { id:"choch",     label:"CHoCH – Change of Character",    group:"Structure",   desc:"First opposite BOS signalling a potential reversal.",                              w:4 },
  { id:"msb",       label:"MSB – Market Structure Break",   group:"Structure",   desc:"Decisive break invalidating previous structure — higher conviction CHoCH.",        w:4 },
  { id:"hh_hl",     label:"HH/HL Bullish Structure",        group:"Structure",   desc:"Confirmed higher highs and higher lows on the entry timeframe.",                   w:2 },
  { id:"ll_lh",     label:"LL/LH Bearish Structure",        group:"Structure",   desc:"Confirmed lower lows and lower highs on the entry timeframe.",                     w:2 },
  { id:"ob_bull",   label:"Bullish Order Block",            group:"Order Flow",  desc:"Last bearish candle before a bullish impulse — institutional buying origin.",      w:4 },
  { id:"ob_bear",   label:"Bearish Order Block",            group:"Order Flow",  desc:"Last bullish candle before a bearish impulse — institutional selling origin.",     w:4 },
  { id:"fvg_bull",  label:"Bullish FVG (Fair Value Gap)",   group:"Order Flow",  desc:"Gap between candle 1 high and candle 3 low in a bullish impulse.",                w:3 },
  { id:"fvg_bear",  label:"Bearish FVG (Fair Value Gap)",   group:"Order Flow",  desc:"Gap between candle 1 low and candle 3 high in a bearish impulse.",                w:3 },
  { id:"bpr",       label:"BPR – Balanced Price Range",     group:"Order Flow",  desc:"Overlapping bullish + bearish FVG — highest-conviction reversal zone.",            w:5 },
  { id:"breaker",   label:"Breaker Block",                  group:"Order Flow",  desc:"Failed OB that flips to opposite polarity after being swept and reclaimed.",       w:3 },
  { id:"liq_sweep", label:"Liquidity Sweep (Stop Hunt)",    group:"Liquidity",   desc:"Price pierces above EQH or below EQL to collect resting orders, then reverses.",  w:5 },
  { id:"eqh",       label:"Equal Highs (EQH) Target",       group:"Liquidity",   desc:"Visible EQH on chart — likely buy-side liquidity cluster above.",                  w:2 },
  { id:"eql",       label:"Equal Lows (EQL) Target",        group:"Liquidity",   desc:"Visible EQL on chart — likely sell-side liquidity cluster below.",                 w:2 },
  { id:"ssl",       label:"Sell-Side Liquidity Below",      group:"Liquidity",   desc:"Obvious swing lows where retail SL clusters exist.",                               w:3 },
  { id:"bsl",       label:"Buy-Side Liquidity Above",       group:"Liquidity",   desc:"Obvious swing highs where retail SL clusters exist.",                              w:3 },
  { id:"pd_array",  label:"Premium / Discount Zone",        group:"Confluence",  desc:"Trade from discount (<50%) for longs, premium (>50%) for shorts.",                 w:3 },
  { id:"ote",       label:"OTE – Optimal Trade Entry",      group:"Confluence",  desc:"Entry between 61.8–79% Fibonacci retracement of the last impulse leg.",           w:4 },
  { id:"htf_bias",  label:"HTF Bias Aligned (4H/Daily)",    group:"Confluence",  desc:"Trade direction aligns with the bias from the higher timeframe.",                  w:4 },
  { id:"session",   label:"Session Window (London/NY)",     group:"Confluence",  desc:"Entry occurs during London Open or NY Open kill zones.",                           w:3 },
  { id:"multi_tf",  label:"Multi-TF Confluence",            group:"Confluence",  desc:"OB, FVG, or S/R level confluences across 2+ timeframes at same price zone.",       w:5 },
  { id:"inducement",label:"Inducement Taken",               group:"Confluence",  desc:"Minor liquidity pool swept before entry zone — confirms smart money intent.",      w:4 },
  { id:"lte_bos",   label:"LTF Entry BOS/CHoCH",            group:"Trigger",     desc:"Wait for LTF BOS or CHoCH after zone retest before executing.",                   w:3 },
  { id:"engulf",    label:"Engulfing Entry Candle",         group:"Trigger",     desc:"Full-bodied engulfing candle at the zone confirms reversal.",                      w:2 },
  { id:"wick_rej",  label:"Wick Rejection / Pin Bar",       group:"Trigger",     desc:"Long wick rejecting a key level — smart money absorbing supply/demand.",          w:2 },
  { id:"displacement",label:"Strong Displacement Candle",  group:"Trigger",     desc:"Large-bodied decisive candle confirming institutional participation.",              w:3 },
];
const SMC_GROUPS = [...new Set(SMC_CONDS.map(c => c.group))];

const PAIRS_LIST = ["XAUUSD","GBPUSD","EURUSD","GBPJPY","USDJPY","AUDUSD","USDCAD","NZDUSD","EURJPY","GBPAUD"];
const TF_LIST    = ["1m","5m","15m","30m","1H","4H","Daily"];
const SESS_LIST  = ["London Open","New York Open","Asian Session","London Close"];

/* ── Simulation engine ──────────────────────────────── */
function smcSimulate(config: {
  pair:string; timeframe:string; startDate:string; endDate:string;
  accountSize:number; riskPct:number; tpRatio:number; slPips:number; sessions:string[];
}, conditions: string[]) {
  const start = new Date(config.startDate), end = new Date(config.endDate);
  const days = Math.max(1, Math.round((end.getTime()-start.getTime())/86400000));
  let seed = config.pair.charCodeAt(0)+config.pair.charCodeAt(1)+days+Math.floor(config.tpRatio*100);
  const rand = () => { seed=(seed*1664525+1013904223)&0xffffffff; return (seed>>>0)/0xffffffff; };

  const totalW = conditions.reduce((s,id)=>s+(SMC_CONDS.find(x=>x.id===id)?.w??0),0);
  const maxW   = SMC_CONDS.reduce((s,c)=>s+c.w,0);
  const quality= Math.min(1, totalW/(maxW*0.45));
  const spwMap: Record<string,number>={
    "1m":30,"5m":20,"15m":14,"30m":10,"1H":7,"4H":4,"Daily":2,
  };
  const nTrades= Math.max(5,Math.min(250,Math.round((spwMap[config.timeframe]??7)*(days/7))));
  const baseWR = Math.max(0.3, Math.min(0.72, 0.38+quality*0.28 - Math.max(0,(config.tpRatio-2)*0.04)));

  const basePx: Record<string,number>={
    XAUUSD:1920,GBPUSD:1.27,EURUSD:1.085,GBPJPY:182,USDJPY:143,
    AUDUSD:0.645,USDCAD:1.36,NZDUSD:0.598,EURJPY:154,GBPAUD:1.955,
  };
  const bp = basePx[config.pair]??1.2;
  const isJpy = config.pair.includes("JPY")||config.pair==="XAUUSD";
  const pipSz = isJpy?0.01:0.0001;
  const slMove = config.slPips*pipSz;
  const tpMove = slMove*config.tpRatio;
  const dp2 = isJpy?2:5;

  type SimTrade = { n:number;date:string;dir:"Long"|"Short";entry:number;sl:number;tp:number;exit:number;pnl:number;pips:number;outcome:"Win"|"Loss"|"BE";session:string;tags:string[] };
  const trades: SimTrade[] = [];
  let equity = config.accountSize;
  const curve = [equity];
  let date = new Date(start);
  let maxPeak=equity, maxDD=0, maxDDPct=0;
  let wStreak=0, lStreak=0, maxWS=0, maxLS=0;

  for(let i=0;i<nTrades;i++){
    date = new Date(date.getTime()+(days/nTrades)*86400000);
    if(date>end) break;
    const r=rand(), isWin=r<baseWR, isBE=!isWin&&rand()<0.08;
    const dir: "Long"|"Short" = rand()<0.52?"Long":"Short";
    const entry = parseFloat((bp+(rand()-0.5)*bp*0.015).toFixed(dp2));
    const sl = parseFloat((dir==="Long"?entry-slMove:entry+slMove).toFixed(dp2));
    const tp = parseFloat((dir==="Long"?entry+tpMove:entry-tpMove).toFixed(dp2));
    const risk = (equity*config.riskPct)/100;
    let pnl:number, pips:number, outcome: "Win"|"Loss"|"BE", exit:number;
    if(isBE){exit=entry;pnl=-(risk*0.1);pips=0;outcome="BE";}
    else if(isWin){exit=tp;pnl=risk*config.tpRatio*(0.88+rand()*0.2);pips=config.slPips*config.tpRatio;outcome="Win";}
    else{exit=sl;pnl=-risk*(0.9+rand()*0.15);pips=-config.slPips;outcome="Loss";}
    equity+=pnl;
    curve.push(equity);
    if(equity>maxPeak) maxPeak=equity;
    const dd=maxPeak-equity;
    if(dd>maxDD){maxDD=dd;maxDDPct=dd/maxPeak;}
    if(outcome==="Win"){wStreak++;lStreak=0;maxWS=Math.max(maxWS,wStreak);}
    else if(outcome==="Loss"){lStreak++;wStreak=0;maxLS=Math.max(maxLS,lStreak);}
    else{wStreak=0;lStreak=0;}
    const shuffled=[...conditions].sort(()=>rand()-0.5);
    trades.push({
      n:i+1, date:date.toISOString().slice(0,10), dir, entry, sl, tp,
      exit:parseFloat(exit.toFixed(dp2)), pnl:parseFloat(pnl.toFixed(2)),
      pips:parseFloat(pips.toFixed(1)), outcome,
      session:config.sessions[Math.floor(rand()*config.sessions.length)]??"London Open",
      tags:shuffled.slice(0,Math.min(conditions.length,3+Math.floor(rand()*3))).map(id=>SMC_CONDS.find(x=>x.id===id)?.label.split(" – ")[0]??id),
    });
  }
  const wins=trades.filter(t=>t.outcome==="Win");
  const losses=trades.filter(t=>t.outcome==="Loss");
  const gW=wins.reduce((s,t)=>s+t.pnl,0);
  const gL=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  const dailyR=trades.map(t=>t.pnl/config.accountSize);
  const avgR=dailyR.reduce((s,r)=>s+r,0)/(dailyR.length||1);
  const std=Math.sqrt(dailyR.reduce((s,r)=>s+Math.pow(r-avgR,2),0)/(dailyR.length||1));
  const sharpe=std===0?0:(avgR/std)*Math.sqrt(252);
  const avgW=wins.length?gW/wins.length:0;
  const avgL=losses.length?gL/losses.length:0;
  return {
    id:_uid(), runAt:new Date().toISOString(), config, trades, curve,
    stats:{
      total:trades.length, wins:wins.length, losses:losses.length, be:trades.filter(t=>t.outcome==="BE").length,
      wr:trades.length?wins.length/trades.length:0,
      netPnl:parseFloat((equity-config.accountSize).toFixed(2)),
      netPips:parseFloat(trades.reduce((s,t)=>s+t.pips,0).toFixed(1)),
      pf:gL===0?999:parseFloat((gW/gL).toFixed(2)),
      maxDD:parseFloat(maxDD.toFixed(2)), maxDDPct:parseFloat((maxDDPct*100).toFixed(2)),
      sharpe:parseFloat(sharpe.toFixed(2)), avgW:parseFloat(avgW.toFixed(2)), avgL:parseFloat(avgL.toFixed(2)),
      expectancy:parseFloat((wins.length/trades.length*avgW-losses.length/trades.length*avgL).toFixed(2)),
      maxWS, maxLS, rr:config.tpRatio,
    },
  };
}

/* ── Mini equity canvas ─────────────────────────────── */
function MiniEquity({ curve, cur }: { curve: number[]; cur: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const c=ref.current; if(!c||curve.length<2) return;
    const ctx=c.getContext("2d"); if(!ctx) return;
    const W=c.width=c.offsetWidth*devicePixelRatio, H=c.height=c.offsetHeight*devicePixelRatio;
    ctx.scale(devicePixelRatio,devicePixelRatio);
    const w=c.offsetWidth,h=c.offsetHeight;
    ctx.clearRect(0,0,w,h);
    const mn=Math.min(...curve),mx=Math.max(...curve),rng=mx-mn||1;
    const pd={t:16,b:24,l:6,r:6};
    const toX=(i:number)=>pd.l+(i/(curve.length-1))*(w-pd.l-pd.r);
    const toY=(v:number)=>pd.t+(1-(v-mn)/rng)*(h-pd.t-pd.b);
    for(let i=0;i<=4;i++){const y=pd.t+(i/4)*(h-pd.t-pd.b);ctx.beginPath();ctx.moveTo(pd.l,y);ctx.lineTo(w-pd.r,y);ctx.strokeStyle="rgba(255,255,255,0.04)";ctx.lineWidth=1;ctx.stroke();}
    const isP=curve[curve.length-1]>=curve[0];
    const g=ctx.createLinearGradient(0,pd.t,0,h-pd.b);
    g.addColorStop(0,isP?"rgba(52,211,153,0.3)":"rgba(239,68,68,0.3)");
    g.addColorStop(1,isP?"rgba(52,211,153,0.02)":"rgba(239,68,68,0.02)");
    ctx.beginPath();ctx.moveTo(toX(0),toY(curve[0]));
    curve.forEach((v,i)=>ctx.lineTo(toX(i),toY(v)));
    ctx.lineTo(toX(curve.length-1),h-pd.b);ctx.lineTo(toX(0),h-pd.b);ctx.closePath();ctx.fillStyle=g;ctx.fill();
    ctx.beginPath();ctx.moveTo(toX(0),toY(curve[0]));
    curve.forEach((v,i)=>ctx.lineTo(toX(i),toY(v)));
    ctx.strokeStyle=isP?"#34d399":"#f87171";ctx.lineWidth=2;ctx.lineJoin="round";ctx.stroke();
    ctx.fillStyle="#475569";ctx.font=`10px Inter,sans-serif`;
    ctx.fillText(`${cur}${Math.round(curve[curve.length-1]).toLocaleString()}`,pd.l+2,pd.t+12);
  },[curve,cur]);
  return <canvas ref={ref} style={{width:"100%",height:150,display:"block",borderRadius:10,background:"rgba(0,0,0,0.25)"}}/>;
}

/* ── Strategy builder form ──────────────────────────── */
type SmcStrategy = {
  id:string;name:string;description:string;marketType:string;timeframe:string;
  entryConditions:string;exitConditions:string;riskRules:string;notes:string;attachments:any[];
  conditions?:string[];tpRatio?:number;slPips?:number;sessions?:string[];
  backtestResults?: ReturnType<typeof smcSimulate>[];
};

function BuilderForm({ initial, onSave, onCancel }: { initial:SmcStrategy|null; onSave:(s:SmcStrategy)=>void; onCancel:()=>void }) {
  const [name,setName]=useState(initial?.name??"");
  const [desc,setDesc]=useState(initial?.description??"");
  const [mkt,setMkt]=useState(initial?.marketType??"Forex");
  const [tf,setTf]=useState(initial?.timeframe??"15m");
  const [conds,setConds]=useState<string[]>(initial?.conditions??[]);
  const [exitC,setExitC]=useState(initial?.exitConditions??"");
  const [risk,setRisk]=useState(initial?.riskRules??"1% risk per trade, 2% daily max");
  const [tp,setTp]=useState(initial?.tpRatio??2);
  const [sl,setSl]=useState(initial?.slPips??20);
  const [sess,setSess]=useState<string[]>(initial?.sessions??["London Open"]);
  const [notes,setNotes]=useState(initial?.notes??"");
  const [grp,setGrp]=useState<string|null>("Structure");

  const toggleC=(id:string)=>setConds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const toggleS=(s:string)=>setSess(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const totalW=conds.reduce((s,id)=>s+(SMC_CONDS.find(x=>x.id===id)?.w??0),0);
  const maxW=SMC_CONDS.reduce((s,c)=>s+c.w,0);
  const qPct=Math.min(100,Math.round((totalW/(maxW*0.45))*100));

  const inp: React.CSSProperties={width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"8px 11px",color:"#e2e8f0",fontSize:12,outline:"none",boxSizing:"border-box"};
  const sel=(v:string,onChange:(s:string)=>void,opts:string[])=>(
    <select value={v} onChange={e=>onChange(e.target.value)} style={{...inp,appearance:"none" as any}}>
      {opts.map(o=><option key={o}>{o}</option>)}
    </select>
  );

  const save=()=>{
    if(!name.trim()) return;
    onSave({id:initial?.id??_uid(),name:name.trim(),description:desc,marketType:mkt,timeframe:tf,
      entryConditions:conds.map(id=>SMC_CONDS.find(x=>x.id===id)?.label??id).join(", "),
      exitConditions:exitC,riskRules:risk,notes,attachments:initial?.attachments??[],
      conditions:conds,tpRatio:tp,slPips:sl,sessions:sess,backtestResults:initial?.backtestResults??[]});
  };

  return (
    <div style={{padding:"16px 14px 32px",overflowY:"auto",flex:1}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <button onClick={onCancel} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:9,padding:"5px 11px",color:"#64748b",fontSize:11,cursor:"pointer"}}>← Back</button>
        <span style={{color:"#f1f5f9",fontSize:15,fontWeight:800}}>{initial?"Edit Strategy":"Build New Strategy"}</span>
      </div>

      {conds.length>0&&<div style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"10px 12px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{color:"#64748b",fontSize:11,fontWeight:600}}>Confluence Quality</span><span style={{fontSize:11,fontWeight:700,color:qPct>70?"#34d399":qPct>40?"#fbbf24":"#f87171"}}>{qPct}% · {conds.length} conditions</span></div>
        <div style={{height:5,borderRadius:3,background:"rgba(255,255,255,0.06)"}}><div style={{height:5,borderRadius:3,width:`${qPct}%`,transition:"width 0.3s",background:qPct>70?"#34d399":qPct>40?"#f59e0b":"#ef4444"}}/></div>
      </div>}

      <div style={{marginBottom:10}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>STRATEGY NAME *</div><input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Smart Raja Liquidity Sweep" style={inp}/></div>
      <div style={{marginBottom:10}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>DESCRIPTION</div><textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} placeholder="What is this strategy about?" style={{...inp,resize:"vertical" as any,lineHeight:1.5}}/></div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>MARKET</div>{sel(mkt,setMkt,["Forex","Crypto","Stocks","Indices"])}</div>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>TIMEFRAME</div>{sel(tf,setTf,TF_LIST)}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>TP RATIO (R:R)</div><input type="number" value={tp} min={0.5} max={10} step={0.5} onChange={e=>setTp(parseFloat(e.target.value)||0)} style={inp}/></div>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>SL (PIPS)</div><input type="number" value={sl} min={5} max={200} step={5} onChange={e=>setSl(parseInt(e.target.value)||0)} style={inp}/></div>
      </div>

      <div style={{marginBottom:14}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:7}}>SESSIONS</div>
        <div style={{display:"flex",flexWrap:"wrap" as any,gap:6}}>
          {SESS_LIST.map(s=><button key={s} onClick={()=>toggleS(s)} style={{padding:"5px 10px",borderRadius:8,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",transition:"all 0.12s",background:sess.includes(s)?"rgba(245,158,11,0.2)":"rgba(255,255,255,0.04)",color:sess.includes(s)?"#fbbf24":"#475569",outline:sess.includes(s)?"1px solid rgba(245,158,11,0.4)":"1px solid rgba(255,255,255,0.06)"}}>{s}</button>)}
        </div>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:7}}>SMC / SMART RAJA CONDITIONS</div>
        {SMC_GROUPS.map(g=>(
          <div key={g} style={{marginBottom:6,background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:11,overflow:"hidden"}}>
            <button onClick={()=>setGrp(grp===g?null:g)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:"9px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#94a3b8",fontSize:12,fontWeight:700}}>{g}</span>
              <span style={{color:"#475569",fontSize:10}}>{conds.filter(id=>SMC_CONDS.find(x=>x.id===id&&x.group===g)).length} selected · {grp===g?"▲":"▼"}</span>
            </button>
            {grp===g&&<div style={{padding:"0 12px 12px"}}>
              {SMC_CONDS.filter(c=>c.group===g).map(c=>{
                const on=conds.includes(c.id);
                return(
                  <div key={c.id} onClick={()=>toggleC(c.id)} style={{display:"flex",gap:9,padding:"9px 10px",marginBottom:5,borderRadius:9,cursor:"pointer",transition:"all 0.12s",background:on?"rgba(245,158,11,0.1)":"rgba(255,255,255,0.02)",border:on?"1px solid rgba(245,158,11,0.3)":"1px solid rgba(255,255,255,0.04)"}}>
                    <div style={{width:17,height:17,borderRadius:5,border:on?"2px solid #f59e0b":"2px solid #334155",background:on?"#f59e0b":"transparent",flexShrink:0,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#000"}}>{on&&"✓"}</div>
                    <div><div style={{color:on?"#fbbf24":"#94a3b8",fontSize:11,fontWeight:700,marginBottom:2}}>{c.label}<span style={{marginLeft:5,color:"#334155",fontWeight:400,fontSize:9}}>w:{c.w}</span></div><div style={{color:"#475569",fontSize:10,lineHeight:1.4}}>{c.desc}</div></div>
                  </div>
                );
              })}
            </div>}
          </div>
        ))}
      </div>

      <div style={{marginBottom:10}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>EXIT CONDITIONS</div><textarea value={exitC} onChange={e=>setExitC(e.target.value)} rows={2} placeholder="TP at opposing liquidity, trail after BOS..." style={{...inp,resize:"vertical" as any,lineHeight:1.5}}/></div>
      <div style={{marginBottom:10}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>RISK RULES</div><textarea value={risk} onChange={e=>setRisk(e.target.value)} rows={2} style={{...inp,resize:"vertical" as any,lineHeight:1.5}}/></div>
      <div style={{marginBottom:16}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>NOTES</div><textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Best pairs, session tips..." style={{...inp,resize:"vertical" as any,lineHeight:1.5}}/></div>

      <div style={{display:"flex",gap:8}}>
        <button onClick={save} disabled={!name.trim()} style={{padding:"10px 20px",borderRadius:11,border:"none",cursor:name.trim()?"pointer":"not-allowed",fontWeight:700,fontSize:13,background:name.trim()?"linear-gradient(135deg,#f59e0b,#d97706)":"#1a2840",color:name.trim()?"#0c0a00":"#334155",boxShadow:name.trim()?"0 3px 12px rgba(245,158,11,0.3)":"none"}}>💾 Save Strategy</button>
        <button onClick={onCancel} style={{padding:"10px 16px",borderRadius:11,border:"1px solid rgba(255,255,255,0.08)",cursor:"pointer",fontWeight:600,fontSize:13,background:"rgba(255,255,255,0.05)",color:"#64748b"}}>Cancel</button>
      </div>
    </div>
  );
}

/* ── Runner form ────────────────────────────────────── */
function RunnerForm({ strategy, cur, onResult, onCancel }: { strategy:SmcStrategy; cur:string; onResult:(r:ReturnType<typeof smcSimulate>)=>void; onCancel:()=>void }) {
  const today=new Date().toISOString().slice(0,10);
  const ago3m=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const [pair,setPair]=useState(PAIRS_LIST[0]);
  const [tf,setTf]=useState(strategy.timeframe?.split("–")[0].trim().replace("m","m").replace("H","H")||"15m");
  const [sd,setSd]=useState(ago3m);
  const [ed,setEd]=useState(today);
  const [acc,setAcc]=useState(10000);
  const [rPct,setRPct]=useState(1);
  const [tp,setTp]=useState(strategy.tpRatio??2);
  const [sl,setSl]=useState(strategy.slPips??20);
  const [sess,setSess]=useState<string[]>(strategy.sessions??["London Open"]);
  const [busy,setBusy]=useState(false);
  const inp: React.CSSProperties={width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"8px 11px",color:"#e2e8f0",fontSize:12,outline:"none",boxSizing:"border-box"};

  const run=()=>{
    setBusy(true);
    setTimeout(()=>{
      const r=smcSimulate({pair,timeframe:tf,startDate:sd,endDate:ed,accountSize:acc,riskPct:rPct,tpRatio:tp,slPips:sl,sessions:sess.length?sess:["London Open"]},strategy.conditions??[]);
      setBusy(false); onResult(r);
    },1000);
  };

  return (
    <div style={{padding:"16px 14px 32px",overflowY:"auto",flex:1}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <button onClick={onCancel} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:9,padding:"5px 11px",color:"#64748b",fontSize:11,cursor:"pointer"}}>← Back</button>
        <div><div style={{color:"#f1f5f9",fontSize:15,fontWeight:800}}>Run Backtest</div><div style={{color:"#64748b",fontSize:11}}>{strategy.name}</div></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>PAIR</div><select value={pair} onChange={e=>setPair(e.target.value)} style={{...inp,appearance:"none" as any}}>{PAIRS_LIST.map(p=><option key={p}>{p}</option>)}</select></div>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>TIMEFRAME</div><select value={tf} onChange={e=>setTf(e.target.value)} style={{...inp,appearance:"none" as any}}>{TF_LIST.map(t=><option key={t}>{t}</option>)}</select></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>START DATE</div><input type="date" value={sd} onChange={e=>setSd(e.target.value)} style={inp}/></div>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>END DATE</div><input type="date" value={ed} onChange={e=>setEd(e.target.value)} style={inp}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>ACCOUNT ({cur})</div><input type="number" value={acc} onChange={e=>setAcc(parseFloat(e.target.value)||0)} style={inp}/></div>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>RISK %</div><input type="number" value={rPct} step={0.1} min={0.1} max={10} onChange={e=>setRPct(parseFloat(e.target.value)||0)} style={inp}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>TP RATIO</div><input type="number" value={tp} step={0.5} min={0.5} max={10} onChange={e=>setTp(parseFloat(e.target.value)||0)} style={inp}/></div>
        <div><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:5}}>SL (PIPS)</div><input type="number" value={sl} step={5} min={5} max={200} onChange={e=>setSl(parseInt(e.target.value)||0)} style={inp}/></div>
      </div>
      <div style={{marginBottom:14}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,marginBottom:7}}>SESSIONS</div>
        <div style={{display:"flex",flexWrap:"wrap" as any,gap:6}}>
          {SESS_LIST.map(s=><button key={s} onClick={()=>setSess(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s])} style={{padding:"5px 10px",borderRadius:8,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:sess.includes(s)?"rgba(245,158,11,0.2)":"rgba(255,255,255,0.04)",color:sess.includes(s)?"#fbbf24":"#475569",outline:sess.includes(s)?"1px solid rgba(245,158,11,0.4)":"1px solid rgba(255,255,255,0.06)"}}>{s}</button>)}
        </div>
      </div>
      {(strategy.conditions?.length??0)>0&&(
        <div style={{background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.15)",borderRadius:11,padding:"10px 12px",marginBottom:14}}>
          <div style={{color:"#92400e",fontSize:10,fontWeight:700,marginBottom:5}}>CONDITIONS ({strategy.conditions!.length})</div>
          <div style={{display:"flex",flexWrap:"wrap" as any,gap:4}}>{strategy.conditions!.map(id=>{const c=SMC_CONDS.find(x=>x.id===id);return c?<span key={id} style={{padding:"2px 7px",borderRadius:5,background:"rgba(245,158,11,0.15)",color:"#fbbf24",fontSize:9,fontWeight:600}}>{c.label.split(" – ")[0]}</span>:null;})}</div>
        </div>
      )}
      <button onClick={run} disabled={busy||sess.length===0} style={{padding:"11px 24px",borderRadius:11,border:"none",cursor:busy?"not-allowed":"pointer",fontWeight:700,fontSize:13,background:busy?"#1a2840":"linear-gradient(135deg,#7c3aed,#6d28d9)",color:"#fff",boxShadow:busy?"none":"0 3px 12px rgba(124,58,237,0.35)",opacity:busy||sess.length===0?0.6:1}}>
        {busy?"⏳ Simulating…":"▶ Run Backtest"}
      </button>
    </div>
  );
}

/* ── Results view ───────────────────────────────────── */
function ResultsView({ result, strategy, cur, onBack, onRunAgain }: { result:ReturnType<typeof smcSimulate>; strategy:SmcStrategy; cur:string; onBack:()=>void; onRunAgain:()=>void }) {
  const s=result.stats;
  const isP=s.netPnl>=0;
  const [filter,setFilter]=useState<"All"|"Win"|"Loss"|"BE">("All");
  const [show,setShow]=useState(false);
  const filtered=filter==="All"?result.trades:result.trades.filter(t=>t.outcome===filter);

  return (
    <div style={{padding:"16px 14px 32px",overflowY:"auto",flex:1}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <button onClick={onBack} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:9,padding:"5px 11px",color:"#64748b",fontSize:11,cursor:"pointer"}}>← Back</button>
        <div style={{flex:1}}><div style={{color:"#f1f5f9",fontSize:15,fontWeight:800}}>Backtest Results</div><div style={{color:"#475569",fontSize:10,marginTop:2}}>{strategy.name} · {result.config.pair} {result.config.timeframe} · {result.config.startDate} → {result.config.endDate}</div></div>
        <button onClick={onRunAgain} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:9,padding:"5px 11px",color:"#64748b",fontSize:11,cursor:"pointer"}}>Re-run</button>
      </div>

      <div style={{background:isP?"rgba(16,185,129,0.07)":"rgba(239,68,68,0.07)",border:`1px solid ${isP?"rgba(16,185,129,0.25)":"rgba(239,68,68,0.25)"}`,borderRadius:14,padding:"14px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div><div style={{color:"#475569",fontSize:10,fontWeight:600,marginBottom:2}}>NET P&L</div><div style={{color:isP?"#34d399":"#f87171",fontSize:26,fontWeight:900,lineHeight:1}}>{isP?"+":""}{cur}{Math.abs(s.netPnl).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div style={{color:"#475569",fontSize:10,marginTop:3}}>{isP?"+":""}{((s.netPnl/result.config.accountSize)*100).toFixed(1)}% · {s.netPips>0?"+":""}{s.netPips} pips</div></div>
        <div style={{textAlign:"right" as any}}><div style={{color:"#475569",fontSize:10,marginBottom:2}}>WIN RATE</div><div style={{color:"#fbbf24",fontSize:26,fontWeight:900,lineHeight:1}}>{(s.wr*100).toFixed(1)}%</div><div style={{color:"#475569",fontSize:10,marginTop:3}}>{s.wins}W · {s.losses}L · {s.be}BE</div></div>
      </div>

      <MiniEquity curve={result.curve} cur={cur} />

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,margin:"14px 0"}}>
        {[
          {l:"Profit Factor",v:s.pf>=999?"∞":s.pf.toFixed(2),c:s.pf>=1.5?"#34d399":s.pf>=1?"#fbbf24":"#f87171"},
          {l:"Sharpe Ratio",v:s.sharpe.toFixed(2),c:s.sharpe>=1?"#34d399":s.sharpe>=0?"#fbbf24":"#f87171"},
          {l:"Max Drawdown",v:`${cur}${s.maxDD.toLocaleString("en",{maximumFractionDigits:0})}`,c:"#f87171",sub:`${s.maxDDPct.toFixed(1)}% of peak`},
          {l:"Expectancy",v:`${s.expectancy>=0?"+":""}${cur}${Math.abs(s.expectancy).toFixed(2)}`,c:s.expectancy>=0?"#34d399":"#f87171",sub:"per trade"},
          {l:"Avg Win",v:`+${cur}${s.avgW.toFixed(2)}`,c:"#34d399"},
          {l:"Avg Loss",v:`-${cur}${s.avgL.toFixed(2)}`,c:"#f87171"},
          {l:"Win Streak",v:`${s.maxWS}`,c:"#fbbf24",sub:"trades"},
          {l:"Loss Streak",v:`${s.maxLS}`,c:"#f87171",sub:"trades"},
          {l:"Total Trades",v:`${s.total}`,c:"#94a3b8",sub:result.config.timeframe},
          {l:"R:R Used",v:`1 : ${s.rr}`,c:"#64748b",sub:`${result.config.slPips}pip SL`},
        ].map(x=>(
          <div key={x.l} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"10px 12px"}}>
            <div style={{color:"#475569",fontSize:9,fontWeight:600,textTransform:"uppercase" as any,letterSpacing:"0.05em",marginBottom:3}}>{x.l}</div>
            <div style={{color:x.c,fontSize:16,fontWeight:800,lineHeight:1.1}}>{x.v}</div>
            {x.sub&&<div style={{color:"#334155",fontSize:9,marginTop:2}}>{x.sub}</div>}
          </div>
        ))}
      </div>

      <button onClick={()=>setShow(!show)} style={{width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:11,padding:"9px 12px",color:"#64748b",fontSize:11,fontWeight:600,cursor:"pointer",marginBottom:show?10:0,display:"flex",justifyContent:"space-between"}}>
        <span>Trade Log ({s.total})</span><span>{show?"▲ Hide":"▼ Show"}</span>
      </button>

      {show&&(
        <>
          <div style={{display:"flex",gap:5,marginBottom:8}}>
            {(["All","Win","Loss","BE"] as const).map(f=>(
              <button key={f} onClick={()=>setFilter(f)} style={{padding:"4px 11px",borderRadius:7,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:filter===f?"#f59e0b":"rgba(255,255,255,0.05)",color:filter===f?"#000":"#475569"}}>
                {f} {f==="All"?s.total:f==="Win"?s.wins:f==="Loss"?s.losses:s.be}
              </button>
            ))}
          </div>
          <div style={{maxHeight:300,overflowY:"auto",display:"flex",flexDirection:"column",gap:5}}>
            {filtered.slice(0,100).map(t=>(
              <div key={t.n} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:9,padding:"9px 11px",borderLeft:`3px solid ${t.outcome==="Win"?"#34d399":t.outcome==="Loss"?"#f87171":"#64748b"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{color:"#64748b",fontSize:10,fontWeight:700}}>#{t.n} · {t.date} · {t.session}</span>
                  <span style={{fontSize:11,fontWeight:800,color:t.outcome==="Win"?"#34d399":t.outcome==="Loss"?"#f87171":"#64748b"}}>{t.outcome==="Win"?"+":t.outcome==="Loss"?"-":""}{cur}{Math.abs(t.pnl).toFixed(2)}</span>
                </div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap" as any}}>
                  <span style={{color:t.dir==="Long"?"#34d399":"#f87171",fontSize:10,fontWeight:700}}>{t.dir}</span>
                  <span style={{color:"#334155",fontSize:10}}>{t.pips>0?"+":""}{t.pips}p</span>
                  <span style={{color:"#334155",fontSize:10}}>@{t.entry}</span>
                </div>
                {t.tags.length>0&&<div style={{display:"flex",flexWrap:"wrap" as any,gap:3,marginTop:5}}>{t.tags.slice(0,4).map((tag,i)=><span key={i} style={{padding:"1px 6px",borderRadius:4,background:"rgba(245,158,11,0.1)",color:"#92400e",fontSize:9,fontWeight:600}}>{tag}</span>)}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Strategy card ──────────────────────────────────── */
function SmcStrategyCard({ s, onEdit, onDelete, onRun }: { s:SmcStrategy; onEdit:()=>void; onDelete:()=>void; onRun:()=>void }) {
  const [open,setOpen]=useState(false);
  const nConds=s.conditions?.length??0;
  const results=s.backtestResults??[];
  const last=results[results.length-1];
  const totalW=((s.conditions??[]).reduce((sum,id)=>sum+(SMC_CONDS.find(x=>x.id===id)?.w??0),0));
  const maxW=SMC_CONDS.reduce((x,c)=>x+c.w,0);
  const qPct=Math.min(100,Math.round((totalW/(maxW*0.45))*100));
  return (
    <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,overflow:"hidden"}}>
      <button onClick={()=>setOpen(!open)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:"12px 14px",textAlign:"left" as any,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div style={{flex:1}}>
          <div style={{color:"#f1f5f9",fontSize:13,fontWeight:800,marginBottom:5}}>{s.name}</div>
          <div style={{display:"flex",flexWrap:"wrap" as any,gap:4}}>
            {s.marketType&&<span style={{padding:"2px 7px",borderRadius:5,background:"rgba(56,189,248,0.1)",color:"#38bdf8",fontSize:10,fontWeight:600}}>{s.marketType}</span>}
            {s.timeframe&&<span style={{padding:"2px 7px",borderRadius:5,background:"rgba(100,116,139,0.15)",color:"#64748b",fontSize:10,fontWeight:600}}>{s.timeframe}</span>}
            {nConds>0&&<span style={{padding:"2px 7px",borderRadius:5,background:"rgba(245,158,11,0.1)",color:"#f59e0b",fontSize:10,fontWeight:600}}>{nConds} conditions · {qPct}%</span>}
          </div>
        </div>
        {last&&<div style={{textAlign:"right" as any,marginLeft:8,flexShrink:0}}><div style={{color:last.stats.netPnl>=0?"#34d399":"#f87171",fontSize:13,fontWeight:800}}>{last.stats.netPnl>=0?"+":""}{last.stats.netPnl.toFixed(0)}</div><div style={{color:"#475569",fontSize:9}}>{(last.stats.wr*100).toFixed(0)}% WR</div></div>}
      </button>
      {open&&(
        <div style={{padding:"0 14px 14px"}}>
          {s.description&&<p style={{color:"#475569",fontSize:11,lineHeight:1.5,marginBottom:10}}>{s.description}</p>}
          {s.entryConditions&&<p style={{color:"#94a3b8",fontSize:11,marginBottom:7}}><span style={{color:"#f59e0b",fontWeight:700}}>Entry — </span>{s.entryConditions.length>120?s.entryConditions.slice(0,120)+"…":s.entryConditions}</p>}
          {nConds>0&&<div style={{display:"flex",flexWrap:"wrap" as any,gap:4,marginBottom:12}}>{(s.conditions??[]).map(id=>{const c=SMC_CONDS.find(x=>x.id===id);return c?<span key={id} style={{padding:"2px 7px",borderRadius:5,background:"rgba(245,158,11,0.1)",color:"#92400e",fontSize:9,fontWeight:600}}>{c.label.split(" – ")[0]}</span>:null;})}</div>}
          {results.length>0&&<div style={{marginBottom:12}}>
            <div style={{color:"#475569",fontSize:9,fontWeight:700,marginBottom:5}}>PREVIOUS BACKTESTS</div>
            {results.slice(-3).map(r=>(
              <div key={r.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 9px",borderRadius:7,background:"rgba(255,255,255,0.02)",marginBottom:3}}>
                <span style={{color:"#334155",fontSize:9}}>{r.config.pair} · {r.config.timeframe} · {r.config.startDate}→{r.config.endDate}</span>
                <span style={{color:r.stats.netPnl>=0?"#34d399":"#f87171",fontSize:9,fontWeight:700}}>{r.stats.netPnl>=0?"+":""}{r.stats.netPnl.toFixed(0)} · {(r.stats.wr*100).toFixed(0)}%WR</span>
              </div>
            ))}
          </div>}
          <div style={{display:"flex",gap:7,flexWrap:"wrap" as any}}>
            <button onClick={onRun} style={{padding:"6px 14px",borderRadius:9,border:"none",cursor:"pointer",fontWeight:700,fontSize:11,background:"linear-gradient(135deg,#7c3aed,#6d28d9)",color:"#fff",boxShadow:"0 2px 8px rgba(124,58,237,0.3)"}}>▶ Backtest</button>
            <button onClick={onEdit} style={{padding:"6px 12px",borderRadius:9,border:"1px solid rgba(255,255,255,0.08)",cursor:"pointer",fontWeight:600,fontSize:11,background:"rgba(255,255,255,0.05)",color:"#64748b"}}>✏️ Edit</button>
            <button onClick={onDelete} style={{padding:"6px 12px",borderRadius:9,border:"1px solid rgba(239,68,68,0.2)",cursor:"pointer",fontWeight:600,fontSize:11,background:"rgba(239,68,68,0.08)",color:"#f87171"}}>🗑 Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── SMC presets ────────────────────────────────────── */
const SMC_PRESETS: Partial<SmcStrategy>[] = [
  { name:"Smart Raja — Liquidity Sweep + OB", description:"Wait for SSL/BSL sweep, CHoCH confirmation, then enter at the OB retest with displacement. Core Smart Raja playbook.", marketType:"Forex", timeframe:"15m", conditions:["liq_sweep","ob_bull","ob_bear","choch","htf_bias","session","inducement","displacement"], exitConditions:"TP at opposing liquidity pool. Move BE on LTF structure break in favor.", riskRules:"1% static risk. TP ratio 2–3R. Cut 75% if OB body broken.", tpRatio:2.5, slPips:20, sessions:["London Open","New York Open"] },
  { name:"Smart Raja — CHoCH + FVG Retest",  description:"Catch the first reversal after CHoCH. Enter at the Fair Value Gap left by the impulse that created the CHoCH.",  marketType:"Forex", timeframe:"5m",  conditions:["choch","fvg_bull","fvg_bear","htf_bias","pd_array","ote","lte_bos","multi_tf"],   exitConditions:"TP at previous swept structure H/L. Partial at 1:1, trail the rest.",         riskRules:"0.5% on 1m entries, 1% on 5m. SL beyond full FVG.",           tpRatio:2,   slPips:10, sessions:["London Open"] },
  { name:"Smart Raja — BPR Reversal",         description:"Balanced Price Range (overlapping FVGs) — highest-conviction reversal zones after a CHoCH at premium/discount extreme.", marketType:"Forex", timeframe:"1H",  conditions:["bpr","choch","pd_array","liq_sweep","htf_bias","inducement","displacement","multi_tf"], exitConditions:"TP at Daily opposing POI. Partial at 4H structure, trail to second target.", riskRules:"1% risk. Wide SL beyond full BPR + buffer. Hold 3–5R.",       tpRatio:3,   slPips:30, sessions:["London Open","New York Open"] },
];

/* ── SMCBuilderView ─────────────────────────────────── */
type SBView = {type:"list"}|{type:"build";editing:SmcStrategy|null}|{type:"run";strategy:SmcStrategy}|{type:"results";result:ReturnType<typeof smcSimulate>;strategy:SmcStrategy};

function SMCBuilderView({ data, setData, currency }: { data?:any; setData?:(fn:(d:any)=>any)=>void; currency:string }) {
  const strategies: SmcStrategy[] = data?.strategies??[];
  const [view,setView]=useState<SBView>({type:"list"});
  const [confirmDel,setConfirmDel]=useState<string|null>(null);

  const saveStrategy=(s:SmcStrategy)=>{
    if(!setData) return;
    setData((d:any)=>{
      const exists=(d.strategies??[]).some((x:any)=>x.id===s.id);
      return {...d,strategies:exists?d.strategies.map((x:any)=>x.id===s.id?s:x):[...(d.strategies??[]),s]};
    });
    setView({type:"list"});
  };

  const delStrategy=(id:string)=>{
    if(!setData) return;
    setData((d:any)=>({...d,strategies:(d.strategies??[]).filter((s:any)=>s.id!==id)}));
    setConfirmDel(null);
  };

  const saveResult=(result:ReturnType<typeof smcSimulate>,stratId:string)=>{
    if(!setData) return;
    setData((d:any)=>({...d,strategies:(d.strategies??[]).map((s:any)=>s.id===stratId?{...s,backtestResults:[...(s.backtestResults??[]),result]}:s)}));
  };

  const addPreset=(p:Partial<SmcStrategy>)=>{
    if(!setData) return;
    const s:SmcStrategy={id:_uid(),name:p.name??"Preset",description:p.description??"",marketType:p.marketType??"Forex",timeframe:p.timeframe??"15m",entryConditions:(p.conditions??[]).map(id=>SMC_CONDS.find(x=>x.id===id)?.label??id).join(", "),exitConditions:p.exitConditions??"",riskRules:p.riskRules??"",notes:"",attachments:[],conditions:p.conditions??[],tpRatio:p.tpRatio??2,slPips:p.slPips??20,sessions:p.sessions??["London Open"],backtestResults:[]};
    setData((d:any)=>({...d,strategies:[...(d.strategies??[]),s]}));
  };

  if(view.type==="build") return <BuilderForm initial={view.editing} onSave={saveStrategy} onCancel={()=>setView({type:"list"})}/>;
  if(view.type==="run")   return <RunnerForm  strategy={view.strategy} cur={currency} onCancel={()=>setView({type:"list"})} onResult={r=>{saveResult(r,view.strategy.id);setView({type:"results",result:r,strategy:view.strategy});}}/>;
  if(view.type==="results") return <ResultsView result={view.result} strategy={view.strategy} cur={currency} onBack={()=>setView({type:"list"})} onRunAgain={()=>setView({type:"run",strategy:view.strategy})}/>;

  return (
    <div style={{padding:"14px 14px 32px",overflowY:"auto",flex:1}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
        <div><div style={{color:"#f1f5f9",fontSize:16,fontWeight:900}}>Strategy Backtester</div><div style={{color:"#475569",fontSize:11,marginTop:3}}>Build SMC / Smart Raja strategies and simulate them</div></div>
        <button onClick={()=>setView({type:"build",editing:null})} style={{padding:"8px 14px",borderRadius:10,border:"none",cursor:"pointer",fontWeight:700,fontSize:12,background:"linear-gradient(135deg,#f59e0b,#d97706)",color:"#0c0a00",boxShadow:"0 2px 8px rgba(245,158,11,0.3)"}}>+ Build</button>
      </div>

      {strategies.length===0?(
        <div style={{textAlign:"center" as any,padding:"32px 16px",color:"#334155"}}>
          <div style={{fontSize:36,marginBottom:10}}>📊</div>
          <div style={{fontSize:13,fontWeight:600,color:"#475569",marginBottom:6}}>No strategies yet</div>
          <div style={{fontSize:11,marginBottom:16}}>Build your first or load a Smart Raja preset below</div>
          <button onClick={()=>setView({type:"build",editing:null})} style={{padding:"9px 18px",borderRadius:10,border:"none",cursor:"pointer",fontWeight:700,fontSize:12,background:"linear-gradient(135deg,#f59e0b,#d97706)",color:"#0c0a00"}}>+ Build Strategy</button>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>
          {strategies.map(s=>(
            <SmcStrategyCard key={s.id} s={s}
              onEdit={()=>setView({type:"build",editing:s})}
              onDelete={()=>setConfirmDel(s.id)}
              onRun={()=>setView({type:"run",strategy:s})}
            />
          ))}
        </div>
      )}

      <div style={{marginTop:8}}>
        <div style={{color:"#334155",fontSize:10,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase" as any,marginBottom:9}}>👑 Smart Raja Presets</div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {SMC_PRESETS.map((p,i)=>{
            const added=strategies.some(s=>s.name===p.name);
            return(
              <div key={i} style={{background:"rgba(245,158,11,0.04)",border:"1px solid rgba(245,158,11,0.12)",borderRadius:13,padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{color:"#fbbf24",fontSize:12,fontWeight:800,marginBottom:3}}>{p.name}</div>
                  <div style={{color:"#475569",fontSize:10,lineHeight:1.4,marginBottom:7}}>{(p.description??"").slice(0,100)}…</div>
                  <div style={{display:"flex",flexWrap:"wrap" as any,gap:3}}>{(p.conditions??[]).slice(0,5).map(id=>{const c=SMC_CONDS.find(x=>x.id===id);return c?<span key={id} style={{padding:"1px 5px",borderRadius:4,background:"rgba(245,158,11,0.12)",color:"#92400e",fontSize:9,fontWeight:700}}>{c.label.split(" – ")[0]}</span>:null;})}{(p.conditions?.length??0)>5&&<span style={{padding:"1px 5px",borderRadius:4,background:"rgba(100,116,139,0.12)",color:"#64748b",fontSize:9,fontWeight:700}}>+{(p.conditions!.length)-5}</span>}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column" as any,gap:4,alignItems:"flex-end",flexShrink:0}}>
                  <span style={{color:"#64748b",fontSize:9}}>1:{p.tpRatio} R:R · {p.slPips}pip SL</span>
                  {added?<span style={{padding:"3px 8px",borderRadius:7,background:"rgba(16,185,129,0.1)",color:"#34d399",fontSize:9,fontWeight:700}}>✓ Added</span>:<button onClick={()=>addPreset(p)} style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(255,255,255,0.08)",cursor:"pointer",fontWeight:600,fontSize:10,background:"rgba(255,255,255,0.05)",color:"#64748b"}}>+ Add</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirmDel&&(
        <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)"}}>
          <div style={{background:"#0f172a",border:"1px solid rgba(255,255,255,0.1)",borderRadius:18,padding:"24px 22px",maxWidth:320,width:"100%",margin:"0 16px"}}>
            <div style={{color:"#f1f5f9",fontSize:15,fontWeight:800,marginBottom:7}}>Delete Strategy?</div>
            <div style={{color:"#64748b",fontSize:12,marginBottom:22}}>This permanently removes the strategy and all its backtest results.</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>delStrategy(confirmDel!)} style={{padding:"8px 16px",borderRadius:9,border:"1px solid rgba(239,68,68,0.2)",cursor:"pointer",fontWeight:700,fontSize:12,background:"rgba(239,68,68,0.08)",color:"#f87171"}}>Delete</button>
              <button onClick={()=>setConfirmDel(null)} style={{padding:"8px 14px",borderRadius:9,border:"1px solid rgba(255,255,255,0.08)",cursor:"pointer",fontWeight:600,fontSize:12,background:"rgba(255,255,255,0.05)",color:"#64748b"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────────────── */
export default function BacktestTab({ data, setData }: { data?:any; setData?:(fn:(d:any)=>any)=>void }) {
  const [mainView, setMainView] = useState<"chart" | "builder">("chart");
  const [mode, setMode] = useState<"replay" | "strategy">("replay");
  const [symbol, setSymbol] = useState("EURUSD");
  const [timeframe, setTimeframe] = useState("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("");

  // Replay
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);
  const [trades, setTrades] = useState<RtTrade[]>([]);
  const [slPips, setSlPips] = useState(20);
  const [tpPips, setTpPips] = useState(40);
  const [vis, setVis] = useState(60);

  // Strategy
  const [cfg, setCfg] = useState<StrategyCfg>({
    indicator: "RSI", period: 14, condition: "CROSS_ABOVE",
    level: 30, direction: "LONG", tp: 50, sl: 25, startBalance: 10000,
  });
  const [btResult, setBtResult] = useState<BtResult | null>(null);

  // Drawing tools
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [activeTool, setActiveTool] = useState<DrawTool>("cursor");
  const [drawColor, setDrawColor] = useState("#ef4444");
  const [fullscreen, setFullscreen] = useState(false);
  const chartViewRef = useRef<ChartView | null>(null);
  const drawingRef = useRef<{ startIdx: number; startPrice: number } | null>(null);
  const previewRef = useRef<DrawShape | null>(null);
  const panOffsetRef = useRef(0);
  const panDragRef = useRef<{ startX: number; startOffset: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pip = getPip(symbol);

  const fetchCandles = useCallback(async () => {
    setLoading(true); setPlaying(false); setTrades([]); setBtResult(null); setShapes([]);
    panOffsetRef.current = 0;
    try {
      const size = OUTPUTSIZE[timeframe] ?? 1500;
      const r = await fetch(`/api/backtest/candles?symbol=${symbol}&interval=${timeframe}&outputsize=${size}`);
      const j = await r.json();
      const data: Candle[] = j.candles || [];
      setCandles(data);
      setSource(j.source || "");
      setIdx(Math.min(vis - 1, data.length - 1));
    } catch { setCandles([]); }
    finally { setLoading(false); }
  }, [symbol, timeframe]);

  useEffect(() => { fetchCandles(); }, []);

  // Auto-play
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setIdx(i => { if (i >= candles.length - 1) { setPlaying(false); return i; } return i + 1; });
    }, speed);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, speed, candles.length]);

  // TP/SL check on each candle advance
  useEffect(() => {
    if (!candles.length || idx < 1) return;
    const c = candles[idx];
    setTrades(prev => prev.map(t => {
      if (t.result !== undefined) return t;
      let ep: number | null = null, win = false;
      if (t.dir === "long") {
        if (c.l <= t.sl) { ep = t.sl; win = false; }
        else if (c.h >= t.tp) { ep = t.tp; win = true; }
      } else {
        if (c.h >= t.sl) { ep = t.sl; win = false; }
        else if (c.l <= t.tp) { ep = t.tp; win = true; }
      }
      if (ep === null) return t;
      const pipDiff = t.dir === "long" ? (ep - t.entry) / pip : (t.entry - ep) / pip;
      return { ...t, exitIdx: idx, exitPrice: ep, result: win ? "win" : "loss", pnl: pipDiff };
    }));
  }, [idx]);

  // Compute overlay for canvas
  const getOverlay = useCallback(() => {
    if (!candles.length) return null;
    const closes = candles.map(c => c.c);
    if (cfg.indicator === "EMA") return { vals: calcEMA(closes, cfg.period), color: "#f59e0b" };
    if (cfg.indicator === "SMA") return { vals: calcSMA(closes, cfg.period), color: "#818cf8" };
    return null;
  }, [candles, cfg.indicator, cfg.period]);

  // Reset pan when replay starts playing
  useEffect(() => { if (playing) panOffsetRef.current = 0; }, [playing]);

  // Draw chart — effectiveViewEnd accounts for pan (reads ref, no re-render needed)
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles.length) return;
    const effectiveViewEnd = Math.max(vis - 1, Math.min(candles.length - 1, idx - panOffsetRef.current));
    const openT = trades.filter(t => t.result === undefined);
    const markers: { idx: number; type: "buy" | "sell" | "exit"; price: number }[] = [];
    trades.forEach(t => {
      markers.push({ idx: t.entryIdx, type: t.dir === "long" ? "buy" : "sell", price: t.entry });
      if (t.exitIdx !== undefined && t.exitPrice !== undefined)
        markers.push({ idx: t.exitIdx, type: "exit", price: t.exitPrice });
    });
    drawChart(canvas, candles, effectiveViewEnd, vis, getOverlay(), markers, openT, pip, shapes, previewRef.current, chartViewRef);
  }, [candles, idx, vis, trades, getOverlay, pip, shapes]);

  useEffect(() => { redraw(); }, [redraw]);

  // Resize observer — wrapped in rAF to prevent ResizeObserver loop errors
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => redraw());
    });
    ro.observe(canvas);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [redraw]);

  // Scroll wheel → zoom
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setVis(v => Math.max(10, Math.min(300, v + (e.deltaY > 0 ? 10 : -10))));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Pinch gesture → zoom (two-finger)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastDist = Math.sqrt(dx * dx + dy * dy);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || lastDist === 0) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = lastDist / dist;
      setVis(v => Math.max(10, Math.min(300, Math.round(v * ratio))));
      lastDist = dist;
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // Pointer handlers — cursor mode = pan, tool modes = draw
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    if (activeTool === "cursor") {
      panDragRef.current = { startX: e.clientX, startOffset: panOffsetRef.current };
      return;
    }
    const v = chartViewRef.current; if (!v) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const price = v.pLo + (1 - py / v.cH) * v.pRange;
    const hIdx = v.vs + Math.round(px / v.barW - 0.5);
    if (activeTool === "hline") {
      setShapes(prev => [...prev, { id: Date.now().toString(), kind: "hline", price, color: drawColor }]);
      return;
    }
    drawingRef.current = { startIdx: hIdx, startPrice: price };
  }, [activeTool, drawColor]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === "cursor") {
      if (!panDragRef.current) return;
      const v = chartViewRef.current; if (!v) return;
      const dx = e.clientX - panDragRef.current.startX;
      const shift = Math.round(dx / v.barW);
      panOffsetRef.current = Math.max(0, Math.min(
        Math.max(0, candles.length - vis),
        panDragRef.current.startOffset - shift,
      ));
      redraw();
      return;
    }
    if (!drawingRef.current) return;
    const v = chartViewRef.current; if (!v) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const price = v.pLo + (1 - py / v.cH) * v.pRange;
    const hIdx = v.vs + Math.round(px / v.barW - 0.5);
    previewRef.current = {
      id: "__preview__", kind: activeTool as "rect" | "tline",
      i1: drawingRef.current.startIdx, p1: drawingRef.current.startPrice,
      i2: hIdx, p2: price, color: drawColor,
    };
    redraw();
  }, [activeTool, drawColor, redraw, candles.length, vis]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === "cursor") {
      panDragRef.current = null;
      return;
    }
    if (!drawingRef.current) return;
    const v = chartViewRef.current; if (!v) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const price = v.pLo + (1 - py / v.cH) * v.pRange;
    const hIdx = v.vs + Math.round(px / v.barW - 0.5);
    const start = drawingRef.current;
    setShapes(prev => [...prev, {
      id: Date.now().toString(), kind: activeTool as "rect" | "tline",
      i1: start.startIdx, p1: start.startPrice,
      i2: hIdx, p2: price, color: drawColor,
    }]);
    drawingRef.current = null;
    previewRef.current = null;
  }, [activeTool, drawColor]);

  const onPointerCancel = useCallback(() => {
    panDragRef.current = null;
    drawingRef.current = null;
    previewRef.current = null;
    redraw();
  }, [redraw]);

  // Enter a trade in replay mode
  const enter = (dir: "long" | "short") => {
    if (!candles.length || idx >= candles.length) return;
    const entry = candles[idx].c;
    const slD = slPips * pip, tpD = tpPips * pip;
    setTrades(prev => [...prev, {
      id: Date.now().toString(), dir, entry,
      sl: dir === "long" ? entry - slD : entry + slD,
      tp: dir === "long" ? entry + tpD : entry - tpD,
      entryIdx: idx,
    }]);
  };

  const reset = () => { setPlaying(false); setTrades([]); setIdx(Math.min(vis - 1, candles.length - 1)); };

  const closed = trades.filter(t => t.result !== undefined);
  const open   = trades.filter(t => t.result === undefined);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = closed.filter(t => t.result === "win").length;
  const cur = candles[idx];

  // Styles
  const panel = { background: "#0c1526", border: "1px solid #1a2840", borderRadius: 12, padding: "10px 12px", marginBottom: 8 } as const;
  const inpStyle = { background: "#111f35", border: "1px solid #1e3a5f", borderRadius: 8, padding: "6px 8px", fontSize: 12, color: "#e2e8f0", width: "100%", outline: "none" } as const;
  const selStyle = { ...inpStyle, cursor: "pointer" } as const;
  const statCard = (color?: string) => ({
    background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 8px", textAlign: "center" as const,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#050912", fontFamily: "'Inter',sans-serif", color: "#e2e8f0", overflow: "hidden" }}>
      <style>{`@keyframes bt-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* ── Top tab switcher ── */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a2840", flexShrink: 0 }}>
        {[{ k: "chart", label: "📊 Chart Replay" }, { k: "builder", label: "🏗 Strategy Builder" }].map(t => (
          <button key={t.k} onClick={() => setMainView(t.k as any)}
            style={{ flex: 1, padding: "10px 6px", fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", background: "transparent", transition: "all 0.15s",
              borderBottom: mainView === t.k ? "2px solid #f59e0b" : "2px solid transparent",
              color: mainView === t.k ? "#f59e0b" : "#475569" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Strategy Builder ── */}
      {mainView === "builder" && (
        <SMCBuilderView data={data} setData={setData} currency={data?.account?.currency ?? "$"} />
      )}

      {/* ── Chart (hidden when builder is active, keeps state) ── */}
      <div style={{ flex: 1, display: mainView === "chart" ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ padding: "10px 14px 0", flexShrink: 0 }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <FlaskConical size={16} style={{ color: "#f59e0b" }} />
            <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>Backtester</span>
            {source && (
              <span style={{ fontSize: 10, color: source === "generated" ? "#78716c" : "#22c55e", background: "rgba(255,255,255,0.04)", padding: "1px 7px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.06)" }}>
                {source === "generated" ? "⚡ Simulated" : "🌐 Live data"}
              </span>
            )}
          </div>
          <button onClick={fetchCandles} disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>
            <RefreshCw size={11} style={{ animation: loading ? "bt-spin 1s linear infinite" : undefined }} />
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        {/* Symbol + TF */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
          <select value={symbol} onChange={e => { setSymbol(e.target.value); }} style={{ ...selStyle, width: "auto", paddingRight: 24 }}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {INTERVALS.map(iv => (
              <button key={iv.value} onClick={() => setTimeframe(iv.value)}
                style={{ padding: "3px 7px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "none", transition: "all 0.1s",
                  background: timeframe === iv.value ? "#f59e0b" : "#111f35",
                  color: timeframe === iv.value ? "#1a1a1a" : "#64748b" }}>
                {iv.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 2, background: "#080f1e", border: "1px solid #1a2840", borderRadius: 10, padding: 2, marginBottom: 8 }}>
          {[{ k: "replay", label: "🎬 Replay" }, { k: "strategy", label: "🤖 Strategy" }].map(m => (
            <button key={m.k} onClick={() => setMode(m.k as any)}
              style={{ flex: 1, padding: "6px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
                background: mode === m.k ? "linear-gradient(135deg,#f59e0b,#d97706)" : "transparent",
                color: mode === m.k ? "#1a1a1a" : "#64748b" }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Drawing toolbar ── */}
      <div style={{ padding: "0 14px 6px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3, background: "#080f1e", border: "1px solid #1a2840", borderRadius: 10, padding: "4px 8px" }}>
          {([
            { tool: "cursor" as DrawTool, icon: <MousePointer2 size={12} />, label: "Cursor" },
            { tool: "hline"  as DrawTool, icon: <Minus size={12} />,          label: "H-Line" },
            { tool: "rect"   as DrawTool, icon: <Square size={12} />,          label: "Zone" },
            { tool: "tline"  as DrawTool, icon: <TrendingUp size={12} />,      label: "Trend" },
          ] as const).map(({ tool, icon, label }) => (
            <button key={tool} onClick={() => setActiveTool(tool)} title={label}
              style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "none", transition: "all 0.1s",
                background: activeTool === tool ? "#1e3a5f" : "transparent",
                color: activeTool === tool ? "#f59e0b" : "#475569" }}>
              {icon}{label}
            </button>
          ))}
          <div style={{ width: 1, background: "#1a2840", alignSelf: "stretch", margin: "0 4px" }} />
          {(["#ef4444", "#22c55e", "#3b82f6", "#f59e0b"] as const).map(c => (
            <button key={c} onClick={() => setDrawColor(c)} title={c}
              style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: drawColor === c ? "2px solid #fff" : "2px solid transparent", cursor: "pointer", padding: 0, flexShrink: 0, outline: "none" }} />
          ))}
          <div style={{ flex: 1 }} />
          {shapes.length > 0 && (
            <button onClick={() => { setShapes([]); previewRef.current = null; }} title="Clear all drawings"
              style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 7px", borderRadius: 6, fontSize: 10, color: "#64748b", background: "transparent", border: "none", cursor: "pointer" }}>
              <Trash2 size={11} />Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Canvas chart ── */}
      <div style={fullscreen ? {
        position: "fixed", inset: 0, zIndex: 9998,
        background: "#05091a", display: "flex", flexDirection: "column",
      } : {
        flexShrink: 0, height: 210, padding: "0 10px", position: "relative",
      }}>

        {/* Fullscreen header bar */}
        {fullscreen && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #1e3a5f", flexShrink: 0, gap: 12 }}>
            {/* Symbol + TF + source */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{symbol}</span>
              <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 600 }}>
                {INTERVALS.find(i => i.value === timeframe)?.label}
              </span>
              {source && (
                <span style={{ fontSize: 10, color: "#4b6080", background: "#111f35", borderRadius: 4, padding: "1px 6px" }}>{source}</span>
              )}
              {candles.length > 0 && (
                <span style={{ fontSize: 10, color: "#4b6080" }}>{candles.length} candles</span>
              )}
            </div>
            {/* Drawing toolbar (inline) */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {([
                { tool: "cursor" as DrawTool, icon: <MousePointer2 size={13} /> },
                { tool: "hline" as DrawTool, icon: <Minus size={13} /> },
                { tool: "rect" as DrawTool, icon: <Square size={13} /> },
                { tool: "tline" as DrawTool, icon: <TrendingUp size={13} /> },
              ]).map(({ tool, icon }) => (
                <button key={tool} onClick={() => setActiveTool(tool)} title={tool}
                  style={{ width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer",
                    background: activeTool === tool ? "#f59e0b" : "#111f35",
                    color: activeTool === tool ? "#000" : "#64748b" }}>
                  {icon}
                </button>
              ))}
              {(["#ef4444", "#22c55e", "#f59e0b", "#60a5fa"]).map(c => (
                <button key={c} onClick={() => setDrawColor(c)}
                  style={{ width: 16, height: 16, borderRadius: "50%", background: c, border: drawColor === c ? "2px solid #fff" : "2px solid transparent", cursor: "pointer" }} />
              ))}
              {shapes.length > 0 && (
                <button onClick={() => { setShapes([]); previewRef.current = null; }}
                  style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 6, fontSize: 10, color: "#64748b", background: "#111f35", border: "none", cursor: "pointer" }}>
                  <Trash2 size={11} />Clear
                </button>
              )}
            </div>
            {/* Minimize button */}
            <button onClick={() => setFullscreen(false)}
              style={{ background: "#111f35", border: "1px solid #1e3a5f", borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b", flexShrink: 0 }}>
              <Minimize2 size={16} />
            </button>
          </div>
        )}

        {/* Canvas wrapper */}
        <div style={{ flex: 1, position: "relative", ...(fullscreen ? {} : { height: "100%" }) }}>
          <canvas ref={canvasRef}
            style={{ width: "100%", height: "100%", borderRadius: fullscreen ? 0 : 8, display: "block",
              cursor: activeTool === "cursor" ? "grab" : "crosshair",
              touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
          {loading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(5,9,26,0.75)", borderRadius: 8 }}>
              <span style={{ color: "#f59e0b", fontSize: 12 }}>Loading candles…</span>
            </div>
          )}
          {/* Zoom buttons */}
          <div style={{ position: "absolute", top: 8, right: fullscreen ? 14 : 8, display: "flex", gap: 2 }}>
            {[["−", () => setVis(v => Math.min(300, v + 20))], ["+", () => setVis(v => Math.max(10, v - 20))]].map(([lbl, fn]) => (
              <button key={lbl as string} onClick={fn as any}
                style={{ background: "rgba(15,25,50,0.85)", border: "1px solid #1e3a5f", borderRadius: 5, padding: "2px 8px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>
                {lbl as string}
              </button>
            ))}
          </div>
          {/* Fullscreen toggle button (normal mode only) */}
          {!fullscreen && (
            <button onClick={() => setFullscreen(true)} title="Full screen"
              style={{ position: "absolute", top: 8, left: 8, background: "rgba(15,25,50,0.85)", border: "1px solid #1e3a5f", borderRadius: 5, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b" }}>
              <Maximize2 size={13} />
            </button>
          )}
        </div>

        {/* ── Fullscreen replay / trade controls ── */}
        {fullscreen && mode === "replay" && (
          <div style={{ flexShrink: 0, background: "#060d1f", borderTop: "1px solid #1e3a5f", padding: "8px 14px", paddingBottom: "calc(8px + env(safe-area-inset-bottom,0px))" }}>
            {/* Top row: date + speed */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#4b6080" }}>
                {cur ? `${idx + 1} / ${candles.length} · ${new Date(cur.t).toLocaleDateString("en-GB")}` : "No data"}
              </span>
              <div style={{ display: "flex", gap: 3 }}>
                {([[1000, "1×"], [400, "3×"], [150, "8×"], [60, "20×"]] as [number,string][]).map(([ms, lbl]) => (
                  <button key={lbl} onClick={() => setSpeed(ms)}
                    style={{ padding: "2px 7px", borderRadius: 5, fontSize: 9, fontWeight: 600, cursor: "pointer", border: "none",
                      background: speed === ms ? "#f59e0b" : "#111f35",
                      color: speed === ms ? "#000" : "#64748b" }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 2, background: "#111f35", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ height: "100%", background: "linear-gradient(90deg,#f59e0b,#fbbf24)", width: `${candles.length ? (idx / (candles.length - 1)) * 100 : 0}%`, transition: "width 0.1s" }} />
            </div>

            {/* Transport + trade row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Transport buttons */}
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <button onClick={reset} title="Reset"
                  style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #1e3a5f", background: "#111f35", cursor: "pointer", color: "#64748b" }}>
                  <RotateCcw size={12} />
                </button>
                <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx <= 0}
                  style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #1e3a5f", background: "#111f35", cursor: "pointer", color: "#64748b", opacity: idx <= 0 ? 0.4 : 1 }}>
                  <ChevronLeft size={14} />
                </button>
                <button onClick={() => setPlaying(p => !p)}
                  style={{ width: 42, height: 42, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer",
                    background: playing ? "#ef4444" : "linear-gradient(135deg,#f59e0b,#d97706)", color: "#000" }}>
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button onClick={() => setIdx(i => Math.min(candles.length - 1, i + 1))} disabled={idx >= candles.length - 1}
                  style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #1e3a5f", background: "#111f35", cursor: "pointer", color: "#64748b", opacity: idx >= candles.length - 1 ? 0.4 : 1 }}>
                  <ChevronRight size={14} />
                </button>
                <button onClick={() => { setPlaying(false); setIdx(candles.length - 1); }} title="Jump to end"
                  style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #1e3a5f", background: "#111f35", cursor: "pointer", color: "#64748b" }}>
                  <SkipForward size={12} />
                </button>
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 36, background: "#1e3a5f" }} />

              {/* SL / TP inputs */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 9, color: "#4b6080", marginBottom: 2 }}>SL</div>
                  <input type="number" value={slPips} min={1} onChange={e => setSlPips(+e.target.value)}
                    style={{ ...inpStyle, width: 52, padding: "4px 6px", fontSize: 11 }} />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#4b6080", marginBottom: 2 }}>TP</div>
                  <input type="number" value={tpPips} min={1} onChange={e => setTpPips(+e.target.value)}
                    style={{ ...inpStyle, width: 52, padding: "4px 6px", fontSize: 11 }} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", alignSelf: "flex-end", paddingBottom: 4 }}>
                  {(tpPips / Math.max(1, slPips)).toFixed(1)}R
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 36, background: "#1e3a5f" }} />

              {/* BUY / SELL */}
              <div style={{ display: "flex", gap: 6, flex: 1 }}>
                <button onClick={() => enter("long")}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#16a34a,#15803d)", color: "#fff", fontWeight: 700, fontSize: 12 }}>
                  <TrendingUp size={13} /> BUY
                </button>
                <button onClick={() => enter("short")}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#dc2626,#b91c1c)", color: "#fff", fontWeight: 700, fontSize: 12 }}>
                  <TrendingDown size={13} /> SELL
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Fullscreen strategy controls ── */}
        {fullscreen && mode === "strategy" && (
          <div style={{ flexShrink: 0, background: "#060d1f", borderTop: "1px solid #1e3a5f", padding: "10px 14px", paddingBottom: "calc(10px + env(safe-area-inset-bottom,0px))", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#7a9fc0", fontWeight: 600 }}>Strategy Mode</span>
            <span style={{ fontSize: 10, color: "#4b6080" }}>Configure settings below in normal view</span>
            <button onClick={() => setFullscreen(false)} style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 8, background: "#f59e0b", border: "none", color: "#000", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              Exit Fullscreen
            </button>
          </div>
        )}
      </div>

      {/* ── Scrollable panel ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", paddingBottom: "calc(80px + env(safe-area-inset-bottom,0px))" }}>

        {mode === "replay" ? (
          <>
            {/* Playback controls */}
            <div style={panel}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "#4b6080" }}>
                  {cur ? `${idx + 1} / ${candles.length} · ${new Date(cur.t).toLocaleDateString("en-GB")}` : "No data loaded"}
                </span>
                <div style={{ display: "flex", gap: 3 }}>
                  {[[1000, "1×"], [400, "3×"], [150, "8×"], [60, "20×"]].map(([ms, lbl]) => (
                    <button key={lbl as string} onClick={() => setSpeed(ms as number)}
                      style={{ padding: "2px 6px", borderRadius: 5, fontSize: 9, fontWeight: 600, cursor: "pointer", border: "none",
                        background: speed === ms ? "#f59e0b" : "#111f35",
                        color: speed === ms ? "#000" : "#64748b" }}>
                      {lbl as string}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transport buttons */}
              <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center", marginBottom: 6 }}>
                {[
                  { icon: <RotateCcw size={13} />, onClick: reset, title: "Reset" },
                  { icon: <ChevronLeft size={15} />, onClick: () => setIdx(i => Math.max(0, i - 1)), disabled: idx <= 0 },
                ].map((b, i) => (
                  <button key={i} onClick={b.onClick} disabled={(b as any).disabled} title={(b as any).title}
                    style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #1e3a5f", background: "#111f35", cursor: "pointer", color: "#64748b", opacity: (b as any).disabled ? 0.4 : 1 }}>
                    {b.icon}
                  </button>
                ))}
                <button onClick={() => setPlaying(p => !p)}
                  style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer",
                    background: playing ? "#ef4444" : "linear-gradient(135deg,#f59e0b,#d97706)", color: "#000" }}>
                  {playing ? <Pause size={19} /> : <Play size={19} />}
                </button>
                {[
                  { icon: <ChevronRight size={15} />, onClick: () => setIdx(i => Math.min(candles.length - 1, i + 1)), disabled: idx >= candles.length - 1 },
                  { icon: <SkipForward size={13} />, onClick: () => { setPlaying(false); setIdx(candles.length - 1); }, title: "Jump to end" },
                ].map((b, i) => (
                  <button key={i} onClick={b.onClick} disabled={(b as any).disabled} title={(b as any).title}
                    style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #1e3a5f", background: "#111f35", cursor: "pointer", color: "#64748b", opacity: (b as any).disabled ? 0.4 : 1 }}>
                    {b.icon}
                  </button>
                ))}
              </div>

              {/* Progress bar */}
              <div style={{ height: 3, background: "#111f35", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "linear-gradient(90deg,#f59e0b,#fbbf24)", width: `${candles.length ? (idx / (candles.length - 1)) * 100 : 0}%`, transition: "width 0.1s" }} />
              </div>
            </div>

            {/* Trade entry */}
            <div style={panel}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#7a9fc0", marginBottom: 8 }}>Place Trade</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>SL (pips)</div>
                  <input type="number" value={slPips} min={1} onChange={e => setSlPips(+e.target.value)} style={inpStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>TP (pips)</div>
                  <input type="number" value={tpPips} min={1} onChange={e => setTpPips(+e.target.value)} style={inpStyle} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "flex-end" }}>
                  <div style={{ fontSize: 10, color: "#4b6080" }}>R:R</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>{(tpPips / Math.max(1, slPips)).toFixed(1)}R</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => enter("long")} style={{ flex: 1, padding: "11px", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#16a34a,#15803d)", color: "#fff", fontWeight: 700, fontSize: 13 }}>
                  <TrendingUp size={15} /> BUY
                </button>
                <button onClick={() => enter("short")} style={{ flex: 1, padding: "11px", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#dc2626,#b91c1c)", color: "#fff", fontWeight: 700, fontSize: 13 }}>
                  <TrendingDown size={15} /> SELL
                </button>
              </div>
            </div>

            {/* Open positions */}
            {open.length > 0 && (
              <div style={panel}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#7a9fc0", marginBottom: 6 }}>Open Trades ({open.length})</div>
                {open.map(t => {
                  const live = cur ? (t.dir === "long" ? (cur.c - t.entry) / pip : (t.entry - cur.c) / pip) : 0;
                  return (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #1a2840" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: t.dir === "long" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: t.dir === "long" ? "#4ade80" : "#f87171" }}>{t.dir.toUpperCase()}</span>
                        <span style={{ fontSize: 11, color: "#7a9fc0" }}>{fmt(t.entry, pip)}</span>
                        <span style={{ fontSize: 10, color: "#2d4a6b" }}>SL {fmt(t.sl, pip)} · TP {fmt(t.tp, pip)}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: live >= 0 ? "#22c55e" : "#ef4444" }}>
                        {fmtPnl(live)} pip
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Session stats */}
            {closed.length > 0 && (
              <div style={panel}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#7a9fc0", marginBottom: 8 }}>Session Results</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                  {[
                    { label: "Trades", value: closed.length, color: "#94a3b8" },
                    { label: "Win Rate", value: `${closed.length ? Math.round(wins / closed.length * 100) : 0}%`, color: wins / (closed.length || 1) >= 0.5 ? "#22c55e" : "#ef4444" },
                    { label: "Net (pip)", value: fmtPnl(totalPnl), color: totalPnl >= 0 ? "#22c55e" : "#ef4444" },
                  ].map(s => (
                    <div key={s.label} style={statCard()}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 9, color: "#2d4a6b", marginTop: 1 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ maxHeight: 130, overflowY: "auto" }}>
                  {[...closed].reverse().map(t => (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: t.dir === "long" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: t.dir === "long" ? "#4ade80" : "#f87171" }}>{t.dir === "long" ? "B" : "S"}</span>
                        <span style={{ fontSize: 10, color: "#4b6080" }}>{fmt(t.entry, pip)} → {t.exitPrice ? fmt(t.exitPrice, pip) : "?"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        {t.result === "win" ? <CheckCircle2 size={11} style={{ color: "#22c55e" }} /> : <XCircle size={11} style={{ color: "#ef4444" }} />}
                        <span style={{ fontSize: 11, fontWeight: 600, color: (t.pnl || 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                          {fmtPnl(t.pnl || 0)}p
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Strategy builder */}
            <div style={panel}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#7a9fc0", marginBottom: 10 }}>Strategy Builder</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>Indicator</div>
                  <select value={cfg.indicator} onChange={e => setCfg(c => ({ ...c, indicator: e.target.value as any }))} style={selStyle}>
                    <option value="RSI">RSI</option>
                    <option value="EMA">EMA (close vs)</option>
                    <option value="SMA">SMA (close vs)</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>Period</div>
                  <input type="number" value={cfg.period} min={2} max={200} onChange={e => setCfg(c => ({ ...c, period: +e.target.value }))} style={inpStyle} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: cfg.indicator === "RSI" ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>Condition</div>
                  <select value={cfg.condition} onChange={e => setCfg(c => ({ ...c, condition: e.target.value as any }))} style={selStyle}>
                    <option value="CROSS_ABOVE">Crosses Above</option>
                    <option value="CROSS_BELOW">Crosses Below</option>
                    <option value="ABOVE">Is Above</option>
                    <option value="BELOW">Is Below</option>
                  </select>
                </div>
                {cfg.indicator === "RSI" && (
                  <div>
                    <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>Level (0-100)</div>
                    <input type="number" value={cfg.level} min={0} max={100} onChange={e => setCfg(c => ({ ...c, level: +e.target.value }))} style={inpStyle} />
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>Direction</div>
                  <select value={cfg.direction} onChange={e => setCfg(c => ({ ...c, direction: e.target.value as any }))} style={selStyle}>
                    <option value="LONG">Long</option>
                    <option value="SHORT">Short</option>
                    <option value="BOTH">Both</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>TP (pips)</div>
                  <input type="number" value={cfg.tp} min={1} onChange={e => setCfg(c => ({ ...c, tp: +e.target.value }))} style={inpStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>SL (pips)</div>
                  <input type="number" value={cfg.sl} min={1} onChange={e => setCfg(c => ({ ...c, sl: +e.target.value }))} style={inpStyle} />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#4b6080", marginBottom: 3 }}>Starting Balance ($)</div>
                <input type="number" value={cfg.startBalance} min={100} onChange={e => setCfg(c => ({ ...c, startBalance: +e.target.value }))} style={inpStyle} />
              </div>

              <button onClick={() => setBtResult(runBacktest(candles, cfg, pip))} disabled={!candles.length}
                style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  background: candles.length ? "linear-gradient(135deg,#f59e0b,#d97706)" : "#1a2840",
                  color: candles.length ? "#1a1a1a" : "#4b6080" }}>
                <Zap size={14} /> Run Backtest ({candles.length} candles)
              </button>
            </div>

            {/* Strategy presets */}
            <div style={{ ...panel, padding: "8px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#7a9fc0", marginBottom: 6 }}>Quick Presets</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {[
                  { label: "RSI Bounce", c: { indicator: "RSI", period: 14, condition: "CROSS_ABOVE", level: 30, direction: "LONG", tp: 50, sl: 25 } as Partial<StrategyCfg> },
                  { label: "RSI Short", c: { indicator: "RSI", period: 14, condition: "CROSS_BELOW", level: 70, direction: "SHORT", tp: 50, sl: 25 } as Partial<StrategyCfg> },
                  { label: "EMA Breakout", c: { indicator: "EMA", period: 20, condition: "CROSS_ABOVE", direction: "LONG", tp: 60, sl: 30 } as Partial<StrategyCfg> },
                  { label: "SMA Trend", c: { indicator: "SMA", period: 50, condition: "ABOVE", direction: "LONG", tp: 80, sl: 40 } as Partial<StrategyCfg> },
                ].map(p => (
                  <button key={p.label} onClick={() => setCfg(c => ({ ...c, ...p.c }))}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, cursor: "pointer", border: "1px solid #1e3a5f", background: "#111f35", color: "#94a3b8" }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Results */}
            {btResult && (
              <div style={panel}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#7a9fc0" }}>Results</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: btResult.netPnl >= 0 ? "#22c55e" : "#ef4444", fontFamily: "'Sora',sans-serif" }}>
                    {btResult.netPnl >= 0 ? "+" : ""}{btResult.netPnl.toFixed(0)}$
                  </div>
                </div>

                <EqCurve equity={btResult.equity} />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, margin: "10px 0" }}>
                  {[
                    { label: "Trades", value: btResult.trades.length, color: "#94a3b8" },
                    { label: "Win Rate", value: `${btResult.winRate.toFixed(0)}%`, color: btResult.winRate >= 50 ? "#22c55e" : "#ef4444" },
                    { label: "Profit Factor", value: btResult.profitFactor === Infinity ? "∞" : btResult.profitFactor.toFixed(2), color: btResult.profitFactor >= 1 ? "#22c55e" : "#ef4444" },
                    { label: "Max DD", value: `${btResult.maxDrawdown.toFixed(1)}%`, color: btResult.maxDrawdown < 10 ? "#22c55e" : btResult.maxDrawdown < 20 ? "#f59e0b" : "#ef4444" },
                    { label: "Winners", value: btResult.trades.filter(t => t.result === "win").length, color: "#22c55e" },
                    { label: "Losers", value: btResult.trades.filter(t => t.result === "loss").length, color: "#ef4444" },
                  ].map(s => (
                    <div key={s.label} style={statCard()}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 9, color: "#2d4a6b", marginTop: 1 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {btResult.trades.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: "#2d4a6b", marginBottom: 4 }}>Last {Math.min(15, btResult.trades.length)} trades</div>
                    <div style={{ maxHeight: 150, overflowY: "auto" }}>
                      {[...btResult.trades].slice(-15).reverse().map((t, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: t.dir === "LONG" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: t.dir === "LONG" ? "#4ade80" : "#f87171" }}>{t.dir === "LONG" ? "L" : "S"}</span>
                            <span style={{ fontSize: 10, color: "#4b6080" }}>{fmt(t.entry, pip)} → {fmt(t.exit, pip)}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            {t.result === "win" ? <CheckCircle2 size={11} style={{ color: "#22c55e" }} /> : <XCircle size={11} style={{ color: "#ef4444" }} />}
                            <span style={{ fontSize: 11, fontWeight: 600, color: t.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                              {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(0)}$
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      </div>{/* closes chart wrapper */}
    </div>
  );
}
