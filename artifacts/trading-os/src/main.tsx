import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getToken, login, register, logout, me } from "./api";
import "./index.css";

// Suppress the harmless "ResizeObserver loop limit exceeded" browser error.
// It fires when a ResizeObserver callback causes a resize in the same frame
// (e.g. canvas redraw) and is caught by Vite's error overlay unnecessarily.
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

function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!email.trim() || !password) {
      setErr("Email and password are required.");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
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

  const input =
    "w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50";

  return (
    <div className="h-screen w-full bg-slate-950 flex items-center justify-center p-6" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src="/onkar-tradex-logo.png" alt="Onkar TradeX" className="w-20 h-20 object-contain drop-shadow-[0_0_18px_rgba(245,158,11,0.5)]" />
          <span className="font-bold text-xl text-slate-100 tracking-wide" style={{ fontFamily: "'Sora', sans-serif" }}>Onkar TradeX</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 mb-4">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setErr(null); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === m ? "bg-amber-500 text-slate-950" : "text-slate-400"}`}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
          <input className={input + " mb-3"} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />

          <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
          <input
            className={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

          {err && <p className="text-rose-400 text-xs mt-3">{err}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-semibold text-sm transition"
          >
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </div>
        <p className="text-center text-[11px] text-slate-600 mt-4">Your journal is private to your account.</p>
      </div>
    </div>
  );
}

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

        {/* ── Chart ── */}
        <div style={{ position:"relative", width:240, height:130, marginBottom:36,
          animation:"otx-float 4s ease-in-out 1.2s infinite" }}>

          {/* grid lines */}
          {[0,33,66,100].map((p) => (
            <div key={p} style={{ position:"absolute", left:0, right:0, top:`${p}%`,
              height:1, background:"rgba(255,255,255,0.04)" }} />
          ))}

          {/* ambient glow */}
          <div style={{ position:"absolute", left:"20%", right:"20%", top:"10%", bottom:"10%",
            background:"radial-gradient(ellipse,rgba(245,158,11,0.07) 0%,transparent 70%)",
            pointerEvents:"none" }} />

          {/* scanning line */}
          <div style={{ position:"absolute", top:0, bottom:0, width:1,
            background:"linear-gradient(180deg,transparent,rgba(245,158,11,0.9),transparent)",
            animation:"otx-scan 2.4s ease-in-out 0.8s infinite", zIndex:10 }} />

          {/* candles */}
          {candles.map((c, i) => (
            <div key={i} style={{ position:"absolute", left:i*33+8, width:18, top:0, bottom:0,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {/* top wick */}
              <div style={{ position:"absolute", width:2, borderRadius:1,
                background: c.bull ? "#22c55e" : "#ef4444",
                height:c.wTop, bottom:c.bodyBot+c.bodyH,
                transformOrigin:"bottom center",
                animation:`otx-wick .45s ease-out ${c.delay} both` }} />
              {/* body */}
              <div style={{ position:"absolute", width:14, borderRadius:3,
                height:c.bodyH, bottom:c.bodyBot,
                background: c.bull
                  ? "linear-gradient(180deg,#4ade80,#16a34a)"
                  : "linear-gradient(180deg,#f87171,#dc2626)",
                boxShadow: c.bull
                  ? "0 0 10px rgba(34,197,94,0.45)"
                  : "0 0 10px rgba(239,68,68,0.45)",
                transformOrigin: c.bull ? "bottom center" : "top center",
                animation:`${c.bull?"otx-cup":"otx-cdown"} .6s cubic-bezier(.34,1.56,.64,1) ${c.delay} both` }} />
              {/* bottom wick */}
              <div style={{ position:"absolute", width:2, borderRadius:1,
                background: c.bull ? "#22c55e" : "#ef4444",
                height:c.wBot, bottom:c.bodyBot-c.wBot,
                transformOrigin:"top center",
                animation:`otx-wick .45s ease-out ${c.delay} both` }} />
            </div>
          ))}

          {/* dashed price line */}
          <div style={{ position:"absolute", left:0, right:0, bottom:50,
            borderTop:"1px dashed rgba(245,158,11,0.4)",
            transformOrigin:"left center", animation:"otx-pl 1s ease-out 1s both" }} />

          {/* price tag */}
          <div style={{ position:"absolute", right:0, bottom:42,
            background:"rgba(245,158,11,0.15)", border:"1px solid rgba(245,158,11,0.4)",
            borderRadius:4, padding:"1px 5px",
            fontSize:9, fontWeight:700, color:"#fbbf24", fontFamily:"monospace",
            animation:"otx-rise .5s ease-out 1.5s both" }}>1.2847</div>
        </div>

        {/* ── Logo + brand ── */}
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

          {/* bouncing dots */}
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
