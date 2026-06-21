import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getToken, login, register, logout, me, ownerLogin } from "./api";
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
   Owner Login Panel (code: 1996)
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
      await ownerLogin(code);
      setSuccess(true);
      setTimeout(() => onAuthed(), 900);
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
          fontSize: 28,
          boxShadow: "0 0 24px rgba(245,158,11,0.2)",
        }}>👑</div>

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showOwner, setShowOwner] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!email.trim() || !password) { setErr("Email and password are required."); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim().toLowerCase(), password);
      else await register(email.trim().toLowerCase(), password);
      onAuthed();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setErr(msg === "unauthorized" ? "Invalid email or password." : msg);
    } finally {
      setBusy(false);
    }
  };

  const inp =
    "w-full bg-slate-900/80 border border-slate-700/80 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 backdrop-blur-sm";

  return (
    <div style={{ position: "relative", minHeight: "100dvh", width: "100%", fontFamily: "'Inter', sans-serif" }}>
      {/* Live chart background */}
      <CandlestickBackground />

      {/* Dark overlay so the form pops */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1,
        background: "radial-gradient(ellipse at 50% 50%, rgba(5,11,23,0.45) 0%, rgba(5,11,23,0.75) 100%)",
      }} />

      {/* Owner panel overlay */}
      {showOwner && (
        <OwnerLoginPanel onAuthed={onAuthed} onClose={() => setShowOwner(false)} />
      )}

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 2,
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "24px 16px",
      }}>
        {/* Legend pills */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
            borderRadius: 20, fontSize: 10, color: "#fbbf24", fontWeight: 700 }}>
            <div style={{ width: 20, height: 2, background: "#f59e0b", borderRadius: 1 }} />
            SMA 20
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)",
            borderRadius: 20, fontSize: 10, color: "#818cf8", fontWeight: 700 }}>
            <div style={{ width: 20, height: 2, background: "#6366f1", borderRadius: 1 }} />
            EMA 9
          </div>
        </div>

        {/* Card */}
        <div style={{
          width: "100%", maxWidth: 360,
          background: "rgba(10,18,35,0.85)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 24,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)",
          padding: "28px 24px 24px",
        }}>
          {/* Logo + title */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 24 }}>
            <div style={{ position: "relative" }}>
              <div style={{
                position: "absolute", inset: -8, borderRadius: "50%",
                background: "rgba(245,158,11,0.2)", filter: "blur(12px)",
              }} />
              <img src="/onkar-tradex-logo.png" alt="Onkar TradeX"
                style={{ width: 56, height: 56, objectFit: "contain", position: "relative",
                  filter: "drop-shadow(0 0 14px rgba(245,158,11,0.65))" }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                fontFamily: "'Sora', sans-serif", fontSize: 20, fontWeight: 900, letterSpacing: -0.5,
                background: "linear-gradient(90deg, #fbbf24 0%, #f59e0b 40%, #ffffff 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>Onkar TradeX</div>
              <div style={{ color: "#475569", fontSize: 11, marginTop: 2, letterSpacing: "0.06em" }}>
                Your Personal Trading OS
              </div>
            </div>
          </div>

          {/* Mode tabs */}
          <div style={{
            display: "flex", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14, padding: 3, marginBottom: 20,
          }}>
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setErr(null); }}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 11,
                  fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                  transition: "all 0.2s",
                  background: mode === m ? "#f59e0b" : "transparent",
                  color: mode === m ? "#0c0a00" : "#64748b",
                  boxShadow: mode === m ? "0 2px 8px rgba(245,158,11,0.35)" : "none",
                }}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>
              Email
            </label>
            <input
              className={inp}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div style={{ marginBottom: 4 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>
              Password
            </label>
            <input
              className={inp}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {err && (
            <div style={{
              marginTop: 10, padding: "8px 12px", borderRadius: 10,
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
              color: "#f87171", fontSize: 12,
            }}>{err}</div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            style={{
              width: "100%", marginTop: 18, padding: "11px 0", borderRadius: 14,
              background: busy ? "rgba(245,158,11,0.4)" : "linear-gradient(135deg,#f59e0b,#d97706)",
              border: "none", cursor: busy ? "not-allowed" : "pointer",
              color: "#0c0a00", fontWeight: 700, fontSize: 14,
              boxShadow: busy ? "none" : "0 4px 16px rgba(245,158,11,0.35)",
              transition: "all 0.2s",
            }}
          >
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>

          {/* Owner access divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 0" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
            <span style={{ color: "#1e293b", fontSize: 11 }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
          </div>

          {/* Owner button */}
          <button
            onClick={() => setShowOwner(true)}
            style={{
              width: "100%", marginTop: 12, padding: "10px 0", borderRadius: 14,
              background: "rgba(245,158,11,0.07)",
              border: "1px solid rgba(245,158,11,0.2)",
              cursor: "pointer", color: "#92400e",
              fontWeight: 600, fontSize: 13, letterSpacing: "0.02em",
              transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.14)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(245,158,11,0.4)";
              (e.currentTarget as HTMLButtonElement).style.color = "#f59e0b";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.07)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(245,158,11,0.2)";
              (e.currentTarget as HTMLButtonElement).style.color = "#92400e";
            }}
          >
            👑 Owner Login
          </button>
        </div>

        <p style={{ color: "#1e293b", fontSize: 11, marginTop: 16, textAlign: "center" }}>
          Your journal is private to your account.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Root / Splash
───────────────────────────────────────────────────────────── */
function Root() {
  const [status, setStatus] = useState<"checking" | "out" | "in">("checking");

  useEffect(() => {
    if (!getToken()) { setStatus("out"); return; }
    me().then(() => setStatus("in")).catch(() => setStatus("out"));
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
  return <App onLogout={() => { logout(); setStatus("out"); }} />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
