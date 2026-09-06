import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
  getAuthPersistence,
  login,
  logout,
  me,
  register,
  requestPasswordReset,
  setAuthPersistence,
  supabase,
  updatePassword,
} from "./api";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, Check } from "lucide-react";
import "./index.css";

// Suppress the harmless "ResizeObserver loop limit exceeded" browser error.
if (typeof window !== "undefined") {
  const _onerror = window.onerror;
  window.onerror = (msg, ...rest) => {
    if (typeof msg === "string" && msg.includes("ResizeObserver")) return true;
    return _onerror ? _onerror(msg, ...rest) : false;
  };
  window.addEventListener("error", (e) => {
    if (e.message && e.message.includes("ResizeObserver")) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
}

/* ─────────────────────────────────────────────────────────────
   Live Candlestick + Moving Average Canvas Background
───────────────────────────────────────────────────────────── */
function CandlestickBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CANDLE_W = 10;
    const CANDLE_GAP = 5;
    const TOTAL_W = CANDLE_W + CANDLE_GAP;
    const MA_PERIOD = 20;
    const EMA_PERIOD = 9;
    const SCROLL_SPEED = 0.35;

    // Resize canvas to fill window
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Generate initial candle series (random walk)
    let price = 1.2800;
    const candles: Array<{ o: number; h: number; l: number; c: number }> = [];

    const addCandle = () => {
      const last = candles.length ? candles[candles.length - 1].c : price;
      const drift = (Math.random() - 0.485) * 0.0028;
      const o = last;
      const c = o + drift;
      const wick = Math.random() * 0.0014;
      const h = Math.max(o, c) + wick + Math.random() * 0.0006;
      const l = Math.min(o, c) - wick - Math.random() * 0.0006;
      candles.push({ o, h, l, c });
    };

    const initCount = Math.ceil(window.innerWidth / TOTAL_W) + MA_PERIOD + 10;
    for (let i = 0; i < initCount; i++) addCandle();

    let offset = 0;
    let animId: number;

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      // Background
      const bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
      bg.addColorStop(0, "#050b17");
      bg.addColorStop(0.5, "#080f1e");
      bg.addColorStop(1, "#03080f");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.025)";
      ctx.lineWidth = 1;
      const gridRows = 8;
      for (let r = 0; r <= gridRows; r++) {
        const y = (H / gridRows) * r;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      const gridCols = Math.ceil(W / 80);
      for (let c = 0; c <= gridCols; c++) {
        const x = (W / gridCols) * c;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }

      // Which candles are visible
      const startIdx = Math.max(0, Math.floor(offset / TOTAL_W) - 1);
      const visCount = Math.ceil(W / TOTAL_W) + 3;
      const visible = candles.slice(startIdx, startIdx + visCount);
      if (visible.length < 2) { animId = requestAnimationFrame(draw); return; }

      // Price range from visible candles (plus context for MA)
      const contextStart = Math.max(0, startIdx - MA_PERIOD);
      const contextCandles = candles.slice(contextStart, startIdx + visCount);
      const prices = contextCandles.flatMap(c => [c.h, c.l]);
      const maxP = Math.max(...prices);
      const minP = Math.min(...prices);
      const range = maxP - minP || 0.001;
      const PAD_TOP = H * 0.12;
      const PAD_BOT = H * 0.12;
      const chartH = H - PAD_TOP - PAD_BOT;

      const toY = (p: number) => PAD_TOP + ((maxP - p) / range) * chartH;

      // Helper: candle screen X
      const candleX = (idx: number) => (idx - startIdx) * TOTAL_W - (offset % TOTAL_W);

      // ── Draw 20-period SMA ──
      const smaPoints: { x: number; y: number }[] = [];
      for (let i = 0; i < visible.length; i++) {
        const ci = startIdx + i;
        if (ci < MA_PERIOD - 1) continue;
        const slice = candles.slice(ci - MA_PERIOD + 1, ci + 1);
        const sma = slice.reduce((s, c) => s + c.c, 0) / MA_PERIOD;
        smaPoints.push({ x: candleX(ci) + CANDLE_W / 2, y: toY(sma) });
      }

      if (smaPoints.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(245,158,11,0.75)";
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.moveTo(smaPoints[0].x, smaPoints[0].y);
        for (let i = 1; i < smaPoints.length; i++) {
          const prev = smaPoints[i - 1];
          const curr = smaPoints[i];
          const mx = (prev.x + curr.x) / 2;
          ctx.bezierCurveTo(mx, prev.y, mx, curr.y, curr.x, curr.y);
        }
        ctx.stroke();

        // Glow under MA line
        ctx.beginPath();
        ctx.strokeStyle = "rgba(245,158,11,0.2)";
        ctx.lineWidth = 5;
        ctx.lineJoin = "round";
        ctx.moveTo(smaPoints[0].x, smaPoints[0].y);
        for (let i = 1; i < smaPoints.length; i++) {
          const prev = smaPoints[i - 1];
          const curr = smaPoints[i];
          const mx = (prev.x + curr.x) / 2;
          ctx.bezierCurveTo(mx, prev.y, mx, curr.y, curr.x, curr.y);
        }
        ctx.stroke();
      }

      // ── Draw 9-period EMA ──
      const emaPoints: { x: number; y: number }[] = [];
      const k = 2 / (EMA_PERIOD + 1);
      let ema = candles[0].c;
      for (let i = 1; i < startIdx + visCount && i < candles.length; i++) {
        ema = candles[i].c * k + ema * (1 - k);
        if (i >= startIdx) {
          emaPoints.push({ x: candleX(i) + CANDLE_W / 2, y: toY(ema) });
        }
      }

      if (emaPoints.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(99,102,241,0.65)";
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.moveTo(emaPoints[0].x, emaPoints[0].y);
        for (let i = 1; i < emaPoints.length; i++) {
          const prev = emaPoints[i - 1];
          const curr = emaPoints[i];
          const mx = (prev.x + curr.x) / 2;
          ctx.bezierCurveTo(mx, prev.y, mx, curr.y, curr.x, curr.y);
        }
        ctx.stroke();
      }

      // ── Draw candles ──
      visible.forEach((c, i) => {
        const ci = startIdx + i;
        const x = candleX(ci);
        const bull = c.c >= c.o;
        const bullColor = "rgba(34,197,94,";
        const bearColor = "rgba(239,68,68,";
        const baseColor = bull ? bullColor : bearColor;

        const bodyTop = toY(Math.max(c.o, c.c));
        const bodyBot = toY(Math.min(c.o, c.c));
        const bodyH = Math.max(1.5, bodyBot - bodyTop);
        const cx = x + CANDLE_W / 2;

        // Wick
        ctx.strokeStyle = baseColor + "0.55)";
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx, toY(c.h));
        ctx.lineTo(cx, toY(c.l));
        ctx.stroke();

        // Body
        const grad = ctx.createLinearGradient(x, bodyTop, x, bodyBot);
        if (bull) {
          grad.addColorStop(0, "rgba(74,222,128,0.95)");
          grad.addColorStop(1, "rgba(22,163,74,0.95)");
        } else {
          grad.addColorStop(0, "rgba(248,113,113,0.95)");
          grad.addColorStop(1, "rgba(220,38,38,0.95)");
        }
        ctx.fillStyle = grad;

        // Glow
        ctx.shadowColor = bull ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)";
        ctx.shadowBlur = 6;

        const radius = Math.min(2, bodyH / 2);
        ctx.beginPath();
        ctx.roundRect(x, bodyTop, CANDLE_W, bodyH, radius);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // ── Price label on last candle ──
      const lastCandle = candles[candles.length - 1];
      const lastX = candleX(candles.length - 1);
      if (lastX > 0 && lastX < W) {
        const ly = toY(lastCandle.c);
        // dashed line
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(245,158,11,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, ly);
        ctx.lineTo(lastX, ly);
        ctx.stroke();
        ctx.setLineDash([]);
        // pill
        const label = lastCandle.c.toFixed(4);
        ctx.font = "bold 10px monospace";
        const tw = ctx.measureText(label).width;
        const pw = tw + 10;
        ctx.fillStyle = "rgba(245,158,11,0.18)";
        ctx.strokeStyle = "rgba(245,158,11,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(4, ly - 9, pw, 18, 4);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fbbf24";
        ctx.fillText(label, 9, ly + 3.5);
      }

      // ── Edge vignettes ──
      const vigL = ctx.createLinearGradient(0, 0, W * 0.12, 0);
      vigL.addColorStop(0, "rgba(5,11,23,0.95)");
      vigL.addColorStop(1, "rgba(5,11,23,0)");
      ctx.fillStyle = vigL;
      ctx.fillRect(0, 0, W * 0.12, H);

      const vigR = ctx.createLinearGradient(W * 0.88, 0, W, 0);
      vigR.addColorStop(0, "rgba(5,11,23,0)");
      vigR.addColorStop(1, "rgba(5,11,23,0.95)");
      ctx.fillStyle = vigR;
      ctx.fillRect(W * 0.88, 0, W * 0.12, H);

      // ── Top & bottom darkening (for readability) ──
      const vigTop = ctx.createLinearGradient(0, 0, 0, H * 0.2);
      vigTop.addColorStop(0, "rgba(5,11,23,0.7)");
      vigTop.addColorStop(1, "rgba(5,11,23,0)");
      ctx.fillStyle = vigTop;
      ctx.fillRect(0, 0, W, H * 0.2);

      const vigBot = ctx.createLinearGradient(0, H * 0.8, 0, H);
      vigBot.addColorStop(0, "rgba(5,11,23,0)");
      vigBot.addColorStop(1, "rgba(5,11,23,0.7)");
      ctx.fillStyle = vigBot;
      ctx.fillRect(0, H * 0.8, W, H * 0.2);

      // Advance scroll
      offset += SCROLL_SPEED;

      // Generate new candles ahead of scroll
      while ((candles.length * TOTAL_W) - offset < W + TOTAL_W * 5) {
        addCandle();
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, display: "block" }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────
   Legacy owner panel (owner access now uses the authenticated profile role)
───────────────────────────────────────────────────────────── */
function OwnerLoginPanel({ onAuthed, onClose }: { onAuthed: () => void; onClose: () => void }) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  useEffect(() => {
    inputRefs[0].current?.focus();
  }, []);

  const handleDigit = (i: number, val: string) => {
    const d = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setErr(null);
    if (d && i < 3) inputRefs[i + 1].current?.focus();
    if (next.every((x) => x !== "") && d) {
      attemptOwnerLogin(next.join(""));
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputRefs[i - 1].current?.focus();
    }
  };

  const attemptOwnerLogin = async (code: string) => {
    setBusy(true);
    setErr(null);
    try {
      void code;
      throw new Error("Owner access now uses your email account and protected profile role.");
    } catch {
      setErr("Incorrect code. Try again.");
      setDigits(["", "", "", ""]);
      setTimeout(() => inputRefs[0].current?.focus(), 50);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 16px",
      background: "rgba(0,0,0,0.75)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", maxWidth: 340,
        background: "rgba(10,14,26,0.97)",
        border: "1px solid rgba(245,158,11,0.25)",
        borderRadius: 24,
        boxShadow: "0 30px 80px rgba(0,0,0,0.7), 0 0 40px rgba(245,158,11,0.08)",
        padding: "32px 28px",
        textAlign: "center",
      }}>
        {/* Crown icon */}
        <div style={{
          width: 64, height: 64, borderRadius: "50%", margin: "0 auto 16px",
          background: "linear-gradient(135deg,rgba(245,158,11,0.2),rgba(251,191,36,0.1))",
          border: "2px solid rgba(245,158,11,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fbbf24",
          boxShadow: "0 0 24px rgba(245,158,11,0.2)",
        }}>
          <ShieldCheck size={32} strokeWidth={1.5} />
        </div>

        <div style={{
          fontFamily: "'Sora', sans-serif", fontSize: 18, fontWeight: 900,
          background: "linear-gradient(90deg,#fbbf24,#f59e0b,#fbbf24)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          marginBottom: 4,
        }}>Owner Access</div>
        <div style={{ color: "#475569", fontSize: 12, marginBottom: 28 }}>
          Enter your 4-digit owner code
        </div>

        {/* 4-digit boxes */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={inputRefs[i]}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={busy || success}
              style={{
                width: 52, height: 60, borderRadius: 14,
                background: d
                  ? "rgba(245,158,11,0.12)"
                  : "rgba(255,255,255,0.04)",
                border: err
                  ? "2px solid rgba(239,68,68,0.6)"
                  : d
                    ? "2px solid rgba(245,158,11,0.55)"
                    : "2px solid rgba(255,255,255,0.1)",
                color: "#fbbf24",
                fontSize: 24, fontWeight: 900, textAlign: "center",
                outline: "none", cursor: "pointer",
                transition: "all 0.15s",
                boxShadow: d ? "0 0 16px rgba(245,158,11,0.2)" : "none",
              }}
            />
          ))}
        </div>

        {/* Status */}
        {success && (
          <div style={{
            padding: "10px 16px", borderRadius: 12, marginBottom: 16,
            background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)",
            color: "#34d399", fontSize: 13, fontWeight: 600,
          }}>
            ✓ Welcome back, Owner!
          </div>
        )}
        {err && (
          <div style={{
            padding: "10px 16px", borderRadius: 12, marginBottom: 16,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
            color: "#f87171", fontSize: 12,
          }}>{err}</div>
        )}

        {busy && !success && (
          <div style={{ color: "#64748b", fontSize: 12, marginBottom: 16 }}>Verifying…</div>
        )}

        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#334155", fontSize: 12, marginTop: 4,
          }}
        >
          ← Back to login
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Auth Screen
───────────────────────────────────────────────────────────── */
function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => getAuthPersistence());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const remembered = localStorage.getItem("tradex_remembered_email");
    if (remembered) {
      setEmail(remembered);
    }
  }, []);

  const submit = async () => {
    setErr(null);
    if (!email.trim() || !password) { setErr("Email and password are required."); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      setAuthPersistence(rememberMe);
      if (mode === "login") {
        await login(email.trim().toLowerCase(), password);
        if (rememberMe) {
          localStorage.setItem("tradex_remembered_email", email.trim().toLowerCase());
        } else {
          localStorage.removeItem("tradex_remembered_email");
        }
      } else {
        await register(email.trim().toLowerCase(), password);
      }
      onAuthed();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setErr(msg === "unauthorized" ? "Invalid email or password." : msg);
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    setErr(null);
    setNotice(null);
    if (!email.trim()) { setErr("Enter your email address first."); return; }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setNotice("Password reset email sent. Check your inbox.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "relative", minHeight: "100dvh", width: "100%", fontFamily: "'Inter', sans-serif" }}>
      {/* Live chart background */}
      <CandlestickBackground />

      {/* Dark overlay so the form pops */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1,
        background: "radial-gradient(ellipse at 50% 50%, rgba(5,11,23,0.65) 0%, rgba(5,11,23,0.9) 100%)",
      }} />

      {/* Background Typography Deco */}
      <div className="hidden md:flex flex-col gap-4 pointer-events-none" style={{
        position: "fixed", top: 40, left: 32, zIndex: 1,
        color: "rgba(251,191,36,0.2)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em",
        lineHeight: 1.8
      }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span>TRADE</span>
          <span>SMARTER</span>
          <span>GROW</span>
          <span>FURTHER</span>
        </div>
        <div style={{ width: 24, height: 2, background: "rgba(251,191,36,0.3)" }} />
      </div>

      <div className="hidden md:flex flex-col gap-4 pointer-events-none items-end text-right" style={{
        position: "fixed", top: 40, right: 32, zIndex: 1,
        color: "rgba(251,191,36,0.2)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em",
        lineHeight: 1.8
      }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span>DISCIPLINE</span>
          <span>BUILDS</span>
          <span>WEALTH</span>
        </div>
        <div style={{ width: 24, height: 2, background: "rgba(251,191,36,0.3)" }} />
      </div>

      <div className="hidden md:flex flex-col pointer-events-none" style={{
        position: "fixed", bottom: 40, left: 32, zIndex: 1,
        color: "rgba(148,163,184,0.3)", fontSize: 9, fontWeight: 600, letterSpacing: "0.25em",
        lineHeight: 1.8
      }}>
        <span>MARKETS</span>
        <span>IDEAS</span>
        <span>EXECUTION</span>
        <span>RESULTS</span>
      </div>

      <div className="hidden md:flex flex-col pointer-events-none text-right" style={{
        position: "fixed", bottom: 40, right: 32, zIndex: 1,
        color: "rgba(148,163,184,0.3)", fontSize: 9, fontWeight: 600, letterSpacing: "0.25em",
        lineHeight: 1.8
      }}>
        <span>A BETTER</span>
        <span>TRADER</span>
        <span>TOMORROW</span>
      </div>

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 2,
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "24px 16px",
      }}>

        {/* Card */}
        <div style={{
          width: "100%", maxWidth: 420,
          background: "linear-gradient(180deg, rgba(10,18,35,0.7) 0%, rgba(5,11,23,0.85) 100%)",
          borderTop: "1px solid rgba(251, 191, 36, 0.4)",
          borderBottom: "1px solid rgba(251, 191, 36, 0.4)",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 24,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.8), 0 0 30px rgba(251, 191, 36, 0.1) inset",
          padding: "40px 32px 32px",
          position: "relative",
          overflow: "hidden"
        }}>

          {/* Subtle top glow */}
          <div style={{
            position: "absolute", top: 0, left: "20%", right: "20%", height: 1,
            background: "linear-gradient(90deg, transparent, #fbbf24, transparent)",
            boxShadow: "0 0 20px 2px rgba(251,191,36,0.5)"
          }} />

          {/* Logo + title */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginBottom: 32 }}>
            <div style={{ position: "relative" }}>
              <div style={{
                position: "absolute", inset: -12, borderRadius: "50%",
                background: "rgba(245,158,11,0.15)", filter: "blur(16px)",
              }} />
              <img src="/onkar-tradex-lockup.webp" alt="Onkar TradeX — Trade smarter, grow further"
                style={{ width: 210, height: 145, objectFit: "contain", position: "relative",
                  filter: "drop-shadow(0 0 20px rgba(245,158,11,0.5))" }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4, letterSpacing: "0.02em" }}>
                {mode === "login" ? "Welcome back to your trading workspace" : "Create your private trading workspace"}
              </div>
            </div>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          {/* Mode tabs */}
          <div style={{
            display: "flex", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14, padding: 4, marginBottom: 28,
          }}>
            {(["login", "register"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => { setMode(m); setErr(null); }}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer",
                  transition: "all 0.2s ease-in-out",
                  background: mode === m ? "linear-gradient(135deg, #fbbf24, #f59e0b)" : "transparent",
                  color: mode === m ? "#020617" : "#64748b",
                  boxShadow: mode === m ? "0 2px 12px rgba(245,158,11,0.3)" : "none",
                }}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#cbd5e1", marginBottom: 8 }}>
              Email
            </label>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#64748b" }}>
                <Mail size={18} strokeWidth={2} />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                style={{
                  width: "100%", background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12,
                  padding: "12px 16px 12px 42px", fontSize: 14, color: "#f1f5f9",
                  outline: "none", transition: "all 0.2s"
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(251,191,36,0.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 2px rgba(251,191,36,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#cbd5e1", marginBottom: 8 }}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#64748b" }}>
                <Lock size={18} strokeWidth={2} />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Enter your password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                style={{
                  width: "100%", background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12,
                  padding: "12px 42px 12px 42px", fontSize: 14, color: "#f1f5f9",
                  outline: "none", transition: "all 0.2s"
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(251,191,36,0.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 2px rgba(251,191,36,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                  color: "#64748b", background: "none", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 4
                }}
              >
                {showPassword ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <div style={{
                width: 18, height: 18, borderRadius: 4,
                border: rememberMe ? "none" : "1px solid rgba(255,255,255,0.2)",
                background: rememberMe ? "#fbbf24" : "rgba(0,0,0,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s"
              }}>
                {rememberMe && <Check size={12} strokeWidth={3} color="#020617" />}
              </div>
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="sr-only" />
              <span style={{ fontSize: 13, color: "#e2e8f0" }}>Remember me</span>
            </label>

            {mode === "login" && (
              <button type="button" onClick={forgotPassword} disabled={busy}
                style={{ background: "none", border: "none", color: "#fbbf24", fontSize: 13, cursor: "pointer", transition: "color 0.2s" }}
                onMouseEnter={(e) => e.currentTarget.style.color = "#fcd34d"}
                onMouseLeave={(e) => e.currentTarget.style.color = "#fbbf24"}
              >
                Forgot password?
              </button>
            )}
          </div>

          {err && (
            <div style={{
              marginBottom: 20, padding: "12px 16px", borderRadius: 12,
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
              color: "#fca5a5", fontSize: 13, display: "flex", alignItems: "center", gap: 8
            }}>
              {err}
            </div>
          )}
          {notice && (
            <div style={{
              marginBottom: 20, padding: "12px 16px", borderRadius: 12,
              background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)",
              color: "#6ee7b7", fontSize: 13
            }}>
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%", padding: "14px 0", borderRadius: 12,
              background: busy ? "rgba(245,158,11,0.4)" : "linear-gradient(135deg, #fbbf24, #f59e0b)",
              border: "none", cursor: busy ? "not-allowed" : "pointer",
              color: "#020617", fontWeight: 700, fontSize: 15,
              boxShadow: busy ? "none" : "0 4px 20px rgba(245,158,11,0.4)",
              transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8
            }}
            onMouseEnter={(e) => !busy && (e.currentTarget.style.transform = "translateY(-1px)")}
            onMouseLeave={(e) => !busy && (e.currentTarget.style.transform = "translateY(0)")}
          >
            {busy ? "Please wait…" : (mode === "login" ? "Log In" : "Sign Up")}
            {!busy && <ArrowRight size={18} strokeWidth={2.5} />}
          </button>

          {mode === "login" && (
            <button
              type="button"
              onClick={() => { setMode("register"); setErr(null); }}
              disabled={busy}
              style={{
                width: "100%", marginTop: 16, padding: "14px 0", borderRadius: 12,
                background: "transparent",
                border: "1px solid rgba(251,191,36,0.3)", cursor: busy ? "not-allowed" : "pointer",
                color: "#fbbf24", fontWeight: 600, fontSize: 15,
                transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8
              }}
              onMouseEnter={(e) => !busy && (e.currentTarget.style.background = "rgba(251,191,36,0.05)")}
              onMouseLeave={(e) => !busy && (e.currentTarget.style.background = "transparent")}
            >
              Create Account
            </button>
          )}

          </form>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 28 }}>
            <ShieldCheck size={16} color="#fbbf24" strokeWidth={2} />
            <div style={{ color: "#64748b", fontSize: 12, letterSpacing: "0.05em", fontWeight: 500 }}>
              Secure <span style={{ margin: "0 6px", color: "#475569" }}>•</span> Fast <span style={{ margin: "0 6px", color: "#475569" }}>•</span> Reliable
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordRecoveryScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    setBusy(true); setError("");
    try { await updatePassword(password); onDone(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not update password."); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-slate-100">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h1 className="text-xl font-bold">Set a new password</h1>
        <p className="text-sm text-slate-400 mt-1 mb-5">Choose a new password to finish recovering your account.</p>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="New password"
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3" />
        {error && <p className="text-rose-400 text-xs mt-2">{error}</p>}
        <button onClick={submit} disabled={busy} className="w-full mt-4 py-3 rounded-xl bg-amber-500 text-slate-950 font-bold">
          {busy ? "Updating…" : "Update password"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Root / Splash
───────────────────────────────────────────────────────────── */
function Root() {
  const [status, setStatus] = useState<"checking" | "out" | "in" | "recovery">("checking");

  useEffect(() => {
    let active = true;
    // Restore the persisted session without making startup depend on a network
    // round-trip. The auth listener then owns all later session transitions.
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) setStatus(!error && data.session ? "in" : "out");
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setStatus("recovery");
      else setStatus(session ? "in" : "out");
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  if (status === "checking") {
    const candles = [
      { bull: true,  bodyH: 55, bodyBot: 30, wTop: 20, wBot: 15, delay: "0s"   },
      { bull: false, bodyH: 35, bodyBot: 55, wTop: 15, wBot: 12, delay: "0.1s" },
      { bull: true,  bodyH: 65, bodyBot: 15, wTop: 12, wBot: 12, delay: "0.2s" },
      { bull: true,  bodyH: 40, bodyBot: 40, wTop: 22, wBot: 14, delay: "0.3s" },
      { bull: false, bodyH: 50, bodyBot: 35, wTop: 15, wBot: 18, delay: "0.4s" },
      { bull: true,  bodyH: 70, bodyBot: 12, wTop: 8,  wBot: 10, delay: "0.5s" },
      { bull: true,  bodyH: 45, bodyBot: 32, wTop: 16, wBot: 14, delay: "0.6s" },
    ];
    return (
      <div style={{
        height: "100dvh", width: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", overflow: "hidden",
        background: "linear-gradient(160deg,#060c1a 0%,#0a0f1e 60%,#030810 100%)",
        fontFamily: "'Inter', sans-serif",
      }}>
        <style>{`
          @keyframes otx-cup  { 0%{transform:scaleY(0.1);opacity:.3} 60%{transform:scaleY(1.12)} 100%{transform:scaleY(1);opacity:1} }
          @keyframes otx-cdown{ 0%{transform:scaleY(0.1);opacity:.3} 60%{transform:scaleY(1.08)} 100%{transform:scaleY(1);opacity:1} }
          @keyframes otx-wick { 0%{transform:scaleY(0);opacity:0} 100%{transform:scaleY(1);opacity:.65} }
          @keyframes otx-scan { 0%{transform:translateX(0);opacity:0} 5%{opacity:1} 90%{opacity:1} 100%{transform:translateX(240px);opacity:0} }
          @keyframes otx-pl   { 0%{transform:scaleX(0);opacity:0} 100%{transform:scaleX(1);opacity:1} }
          @keyframes otx-rise { 0%{opacity:0;transform:translateY(14px)} 100%{opacity:1;transform:translateY(0)} }
          @keyframes otx-glow { 0%,100%{opacity:.55;transform:scale(1)} 50%{opacity:1;transform:scale(1.1)} }
          @keyframes otx-dot  { 0%,100%{opacity:.15;transform:scale(.8)} 50%{opacity:1;transform:scale(1.2)} }
          @keyframes otx-float{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        `}</style>

        <div style={{ position:"relative", width:240, height:130, marginBottom:36,
          animation:"otx-float 4s ease-in-out 1.2s infinite" }}>
          {[0,33,66,100].map((p) => (
            <div key={p} style={{ position:"absolute", left:0, right:0, top:`${p}%`,
              height:1, background:"rgba(255,255,255,0.04)" }} />
          ))}
          <div style={{ position:"absolute", left:"20%", right:"20%", top:"10%", bottom:"10%",
            background:"radial-gradient(ellipse,rgba(245,158,11,0.07) 0%,transparent 70%)",
            pointerEvents:"none" }} />
          <div style={{ position:"absolute", top:0, bottom:0, width:1,
            background:"linear-gradient(180deg,transparent,rgba(245,158,11,0.9),transparent)",
            animation:"otx-scan 2.4s ease-in-out 0.8s infinite", zIndex:10 }} />
          {candles.map((c, i) => (
            <div key={i} style={{ position:"absolute", left:i*33+8, width:18, top:0, bottom:0,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ position:"absolute", width:2, borderRadius:1,
                background: c.bull ? "#22c55e" : "#ef4444",
                height:c.wTop, bottom:c.bodyBot+c.bodyH,
                transformOrigin:"bottom center",
                animation:`otx-wick .45s ease-out ${c.delay} both` }} />
              <div style={{ position:"absolute", width:14, borderRadius:3,
                height:c.bodyH, bottom:c.bodyBot,
                background: c.bull ? "linear-gradient(180deg,#4ade80,#16a34a)" : "linear-gradient(180deg,#f87171,#dc2626)",
                boxShadow: c.bull ? "0 0 10px rgba(34,197,94,0.45)" : "0 0 10px rgba(239,68,68,0.45)",
                transformOrigin: c.bull ? "bottom center" : "top center",
                animation:`${c.bull?"otx-cup":"otx-cdown"} .6s cubic-bezier(.34,1.56,.64,1) ${c.delay} both` }} />
              <div style={{ position:"absolute", width:2, borderRadius:1,
                background: c.bull ? "#22c55e" : "#ef4444",
                height:c.wBot, bottom:c.bodyBot-c.wBot,
                transformOrigin:"top center",
                animation:`otx-wick .45s ease-out ${c.delay} both` }} />
            </div>
          ))}
          <div style={{ position:"absolute", left:0, right:0, bottom:50,
            borderTop:"1px dashed rgba(245,158,11,0.4)",
            transformOrigin:"left center", animation:"otx-pl 1s ease-out 1s both" }} />
          <div style={{ position:"absolute", right:0, bottom:42,
            background:"rgba(245,158,11,0.15)", border:"1px solid rgba(245,158,11,0.4)",
            borderRadius:4, padding:"1px 5px",
            fontSize:9, fontWeight:700, color:"#fbbf24", fontFamily:"monospace",
            animation:"otx-rise .5s ease-out 1.5s both" }}>1.2847</div>
        </div>

        <div style={{ animation:"otx-rise .6s ease-out .85s both", display:"flex",
          flexDirection:"column", alignItems:"center", gap:10 }}>
          <div style={{ position:"relative", width:64, height:64 }}>
            <div style={{ position:"absolute", inset:-6, borderRadius:"50%",
              background:"rgba(245,158,11,0.25)", filter:"blur(14px)",
              animation:"otx-glow 2.5s ease-in-out infinite" }} />
            <img src="/onkar-tradex-logo.png" alt="Onkar TradeX" style={{
              width:64, height:64, objectFit:"contain", position:"relative",
              filter:"drop-shadow(0 0 16px rgba(245,158,11,0.75))" }} />
          </div>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:900,
              letterSpacing:-0.5,
              background:"linear-gradient(90deg,#fbbf24 0%,#f59e0b 45%,#ffffff 100%)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              Onkar TradeX
            </div>
            <div style={{ color:"#334155", fontSize:11, marginTop:3,
              letterSpacing:"0.08em", textTransform:"uppercase" }}>
              Your Personal Trading OS
            </div>
          </div>
          <div style={{ display:"flex", gap:7, marginTop:4 }}>
            {[0,1,2].map((i) => (
              <div key={i} style={{ width:7, height:7, borderRadius:"50%",
                background:"linear-gradient(135deg,#f59e0b,#fbbf24)",
                animation:`otx-dot 1.4s ease-in-out ${i*0.22}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (status === "out") return <AuthScreen onAuthed={() => setStatus("in")} />;
  if (status === "recovery") return <PasswordRecoveryScreen onDone={() => setStatus("in")} />;
  return <App onLogout={() => { void logout(); setStatus("out"); }} />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
