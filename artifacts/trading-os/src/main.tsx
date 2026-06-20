import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getToken, login, register, logout, me } from "./api";
import "./index.css";

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
    return (
      <div className="h-screen w-full bg-slate-950 flex items-center justify-center">
        <img src="/onkar-tradex-logo.png" alt="Onkar TradeX" className="w-16 h-16 object-contain animate-pulse drop-shadow-[0_0_20px_rgba(245,158,11,0.6)]" />
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
