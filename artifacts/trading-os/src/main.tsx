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
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, Move3d } from "lucide-react";
import "./index.css";
import "./auth/login.css";
import { useLoginMotion } from "./auth/use-login-motion";
import { NotificationCenterProvider } from "./notifications/NotificationCenter";
import Jarvis from "./jarvis/Jarvis";
import { JARVIS_ENABLED } from "./jarvis/app-bridge";
import { installAutomaticRefresh } from "./live-refresh";

// Keep one coherent application version when a freshly deployed service
// worker takes control of an already-open PWA/browser tab. Without this, the
// old shell can request lazy chunks from the new deployment and briefly show
// an outdated or incomplete Onkar AI workspace.
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const replacingExistingWorker = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!replacingExistingWorker || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
}

// Keep server-backed screens fresh after mobile suspension, reconnects and
// ordinary foreground use. The service worker is checked separately so a new
// deployment replaces the app shell automatically without clearing auth.
installAutomaticRefresh();

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
   Decorative Candlestick + Moving Average Canvas Background
───────────────────────────────────────────────────────────── */
function CandlestickBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;
    let resizeFrame = 0;

    const draw = () => {
      const width = window.innerWidth * 1.1;
      const height = window.innerHeight * 1.1;
      // Keep even large desktop textures within a four-megapixel budget.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(4_000_000 / (width * height)));
      canvas.width = Math.ceil(width * ratio);
      canvas.height = Math.ceil(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = "rgba(133, 162, 198, 0.13)";
      for (let x = 0; x < width; x += 70) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += 70) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Decorative geometry, never presented as a live price feed. The
      // bounded canvas is painted only on resize; CSS moves its texture.
      const count = Math.min(96, Math.ceil(width / 18) + 4);
      const gap = width / (count - 1);
      const candles = Array.from({ length: count }, (_, i) => {
        const open = 0.52 + Math.sin(i * 0.15) * 0.15 + Math.sin(i * 0.47) * 0.065;
        const close = open + Math.sin(i * 1.83 + 0.7) * 0.036;
        return {
          open, close,
          high: Math.max(open, close) + 0.019 + (i % 3) * 0.008,
          low: Math.min(open, close) - 0.018 - (i % 4) * 0.004,
        };
      });
      const toY = (price: number) => height * (1 - price);
      candles.forEach((candle, i) => {
        const x = i * gap;
        const rising = candle.close >= candle.open;
        const top = toY(Math.max(candle.open, candle.close));
        const bodyHeight = Math.max(2, Math.abs(candle.close - candle.open) * height);
        ctx.strokeStyle = rising ? "rgba(117, 194, 184, 0.7)" : "rgba(158, 170, 198, 0.46)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, toY(candle.high)); ctx.lineTo(x, toY(candle.low)); ctx.stroke();
        ctx.fillStyle = rising ? "rgba(117, 194, 184, 0.42)" : "rgba(158, 170, 198, 0.25)";
        ctx.fillRect(x - 3.5, top, 7, bodyHeight);
      });
      const movingAverage = (period: number, color: string) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        for (let i = period - 1; i < candles.length; i++) {
          const average = candles.slice(i - period + 1, i + 1)
            .reduce((sum, candle) => sum + candle.close, 0) / period;
          if (i === period - 1) ctx.moveTo(i * gap, toY(average));
          else ctx.lineTo(i * gap, toY(average));
        }
        ctx.stroke();
      };
      movingAverage(9, "rgba(233, 188, 103, 0.65)");
      movingAverage(20, "rgba(136, 163, 195, 0.3)");
    };
    const resize = () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("resize", resize, { passive: true });
    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="otx-login-atmosphere" aria-hidden="true">
      <div className="otx-login-hologram-depth">
        <canvas ref={canvasRef} className="otx-login-hologram" />
      </div>
      <div className="otx-login-vignette" />
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="otx-login-particle" style={{
          "--particle-x": `${8 + ((i * 29) % 84)}%`,
          "--particle-y": `${10 + ((i * 17) % 78)}%`,
          "--particle-duration": `${14 + (i % 5) * 3}s`,
          "--particle-delay": `${-i * 2.4}s`,
        } as React.CSSProperties} />
      ))}
    </div>
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
  const sceneRef = useRef<HTMLDivElement>(null);
  const { deviceMotion, toggleDeviceMotion } = useLoginMotion(sceneRef);
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
    <div ref={sceneRef} className="otx-login">
      <CandlestickBackground />

      <div className="otx-login-corner otx-login-corner--left" aria-hidden="true">
        <strong>ONKAR TRADEX</strong><br />TRADE SMARTER<br />GROW FURTHER<i />
      </div>
      <div className="otx-login-corner otx-login-corner--right" aria-hidden="true">
        DISCIPLINE<br />BUILDS WEALTH<i />
      </div>
      <div className="otx-login-corner otx-login-corner--left otx-login-corner--bottom" aria-hidden="true">
        MARKETS · IDEAS<br />EXECUTION · RESULTS
      </div>
      <div className="otx-login-corner otx-login-corner--right otx-login-corner--bottom" aria-hidden="true">
        A BETTER TRADER<br />TOMORROW
      </div>

      <main className="otx-login-content">
        <div className="otx-login-card-reveal">
          <section className="otx-login-card" aria-labelledby="otx-login-title">
            <div className="otx-login-lighting" aria-hidden="true">
              <span className="otx-login-edge" />
              <span className="otx-login-edge otx-login-edge--bottom" />
              <span className="otx-login-sweep" />
            </div>
            <header className="otx-login-heading">
              <span className="otx-login-eyebrow">Your personal trading OS</span>
              <div className="otx-login-logo-depth" aria-hidden="true">
                <div className="otx-login-aura" />
                <div className="otx-login-logo-shadow" />
                <div className="otx-login-logo-float">
                  <div className="otx-login-logo-face">
                    <img src="/onkar-tradex-logo.png" alt="" width="102" height="102" fetchPriority="high" />
                    <span className="otx-login-sweep" />
                  </div>
                </div>
              </div>
              <div className="otx-login-brand">Onkar <span>TradeX</span></div>
              <div className="otx-login-tagline">Trade smarter · Grow further</div>
              <h1 id="otx-login-title">
                {mode === "login" ? "Welcome back." : "Your next chapter."}
              </h1>
              <p>{mode === "login" ? "Sign in to your private trading workspace." : "Create your private trading workspace."}</p>
            </header>

            <form className="otx-login-form" onSubmit={(event) => { event.preventDefault(); submit(); }} aria-busy={busy}>
              <div className="otx-login-tabs" role="group" aria-label="Account access">
                {(["login", "register"] as const).map((m) => (
                  <button type="button" key={m} aria-pressed={mode === m}
                    onClick={() => { setMode(m); setErr(null); }}>
                    {m === "login" ? "Log in" : "Sign up"}
                  </button>
                ))}
              </div>

              <div className="otx-login-field">
                <label htmlFor="otx-login-email">Email</label>
                <div className="otx-login-input-wrap">
                  <span className="otx-login-input-icon" aria-hidden="true"><Mail size={17} strokeWidth={1.7} /></span>
                  <input id="otx-login-email" name="email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                    autoComplete="email" autoCapitalize="none" spellCheck={false}
                    aria-invalid={Boolean(err)} aria-describedby={err ? "otx-auth-error" : undefined} />
                </div>
              </div>

              <div className="otx-login-field">
                <label htmlFor="otx-login-password">Password</label>
                <div className="otx-login-input-wrap otx-login-input-wrap--password">
                  <span className="otx-login-input-icon" aria-hidden="true"><Lock size={17} strokeWidth={1.7} /></span>
                  <input id="otx-login-password" name="password" type={showPassword ? "text" : "password"}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    aria-invalid={Boolean(err)} aria-describedby={err ? "otx-auth-error" : undefined} />
                  <button type="button" className="otx-login-password-toggle" onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff size={17} strokeWidth={1.7} /> : <Eye size={17} strokeWidth={1.7} />}
                  </button>
                </div>
              </div>

              <div className="otx-login-options">
                <label className="otx-login-remember">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span>Remember me</span>
                </label>
                {mode === "login" && (
                  <button type="button" className="otx-login-text-button" onClick={forgotPassword} disabled={busy}>
                    Forgot password?
                  </button>
                )}
              </div>

              {err && <div id="otx-auth-error" className="otx-login-message otx-login-message--error" role="alert">{err}</div>}
              {notice && <div className="otx-login-message otx-login-message--notice" role="status">{notice}</div>}

              <button type="submit" disabled={busy} className="otx-login-button otx-login-button--primary">
                {busy ? "Please wait…" : (mode === "login" ? "Log In" : "Sign Up")}
                {!busy && <ArrowRight size={17} strokeWidth={2} aria-hidden="true" />}
              </button>
              {mode === "login" && (
                <button type="button" className="otx-login-button otx-login-button--secondary"
                  onClick={() => { setMode("register"); setErr(null); }} disabled={busy}>
                  Create Account
                </button>
              )}
            </form>

            <div className="otx-login-security">
              <ShieldCheck size={14} strokeWidth={1.7} aria-hidden="true" />
              <span>Secure<span>·</span>Fast<span>·</span>Reliable</span>
            </div>
          </section>
        </div>
        <footer className="otx-login-footer">
          <span>Built for focus. Designed for your next move.</span>
          {deviceMotion !== "unavailable" && deviceMotion !== "denied" && (
            <button type="button" className="otx-login-motion-control"
              onClick={() => void toggleDeviceMotion()} aria-pressed={deviceMotion === "enabled"}
              aria-label={deviceMotion === "enabled" ? "Disable device tilt" : "Enable device tilt"}>
              <Move3d size={12} aria-hidden="true" /> Device tilt
            </button>
          )}
        </footer>
      </main>
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
  const previousStatus = useRef(status);
  const [loginArrival, setLoginArrival] = useState(false);

  // Presentation follows the existing auth listener. It never waits for an
  // animation before accepting a session or mounting the dashboard.
  useEffect(() => {
    const fromLogin = previousStatus.current === "out" && status === "in";
    previousStatus.current = status;
    if (status !== "in") { setLoginArrival(false); return; }
    if (!fromLogin) return;
    setLoginArrival(true);
    const timer = window.setTimeout(() => setLoginArrival(false), 700);
    return () => window.clearTimeout(timer);
  }, [status]);

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
  return <div className={loginArrival ? "otx-dashboard-arrival" : undefined}><App onLogout={async () => {
    try {
      await logout();
    } catch {
      // Local auth data is cleared by logout even if the remote revoke fails.
    } finally {
      setStatus("out");
    }
  }} />{JARVIS_ENABLED && <Jarvis />}{loginArrival && (
    <div className="otx-login-arrival" aria-hidden="true">
      <img src="/onkar-tradex-logo.png" alt="" width="80" height="80" />
    </div>
  )}</div>;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NotificationCenterProvider><Root /></NotificationCenterProvider>
  </React.StrictMode>
);
