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

/* ── Main component ───────────────────────────────────── */
export default function BacktestTab() {
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

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    return () => ro.disconnect();
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
              {(["#ef4444", "#22c55e", "#f59e0b", "#60a5fa"] as const).map(c => (
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
    </div>
  );
}
