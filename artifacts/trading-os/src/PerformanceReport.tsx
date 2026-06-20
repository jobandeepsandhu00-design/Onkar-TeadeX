import React, { useEffect, useMemo, useRef } from "react";
import { X, Download, TrendingUp, TrendingDown, Target, BarChart3, Activity, Clock } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ─── Micro helpers (duplicated from App.tsx to stay self-contained) ──────── */
const fmt2 = (n: number | null | undefined) =>
  n === null || n === undefined || isNaN(n) ? "—" : n.toFixed(2);
const fmtPct = (n: number | null | undefined) =>
  n === null || n === undefined || isNaN(n) ? "—" : n.toFixed(1) + "%";
const fmtSigned = (n: number | null | undefined, cur = "") => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n) >= 1000
    ? Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.abs(n).toFixed(2);
  return (n >= 0 ? "+" : "-") + cur + abs;
};
const fmtMins = (m: number | null | undefined) => {
  if (m === null || m === undefined || isNaN(m)) return "—";
  const total = Math.round(m);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60), r = total % 60;
  return `${h}h ${r}m`;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function monthLabel(key: string) {
  if (key === "unknown") return "—";
  const [y, mStr] = key.split("-");
  const d = new Date(parseInt(y), parseInt(mStr) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

/* ─── Print-style injection ───────────────────────────────────────────────── */
const PRINT_STYLE = `
@media print {
  body > * { display: none !important; }
  #src-perf-report { display: block !important; position: fixed; inset: 0; background: #fff; color: #111; z-index: 99999; overflow: visible; }
  #src-perf-report .no-print { display: none !important; }
  #src-perf-report .print-break { page-break-before: always; }
  #src-perf-report * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;

/* ─── Stat box ────────────────────────────────────────────────────────────── */
function StatBox({ label, value, sub, color = "text-slate-900" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-50 print:bg-gray-50 border border-slate-200 rounded-xl p-3 text-center">
      <div className={`text-lg font-bold leading-tight ${color}`} style={{ fontFamily: "'Sora', sans-serif" }}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
      <div className="text-[10px] text-slate-500 mt-1 font-medium uppercase tracking-wide">{label}</div>
    </div>
  );
}

/* ─── Section header ──────────────────────────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{title}</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>
      {children}
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────────────── */
interface Props {
  data: {
    account?: { name?: string; currency?: string; startingBalance?: string };
    trades?: Record<string, string>[];
    setups?: { id: string; name: string }[];
    strategies?: { id: string; name: string }[];
  };
  onClose: () => void;
}

function computeTrade(t: Record<string, string>) {
  const dir = t.side === "Sell" ? -1 : 1;
  const entry = parseFloat(t.entry), exit = parseFloat(t.exit), sl = parseFloat(t.sl), tp = parseFloat(t.tp);
  const size = parseFloat(t.positionSize) || 1;
  let pnl: number | null = null, rMultiple: number | null = null, plannedRR: number | null = null, result: string | null = null;
  const riskPerUnit = !isNaN(entry) && !isNaN(sl) ? Math.abs(entry - sl) : null;
  if (!isNaN(entry) && !isNaN(tp) && riskPerUnit) plannedRR = Math.abs(tp - entry) / riskPerUnit;
  if (!isNaN(entry) && !isNaN(exit)) {
    pnl = (exit - entry) * dir * size;
    if (riskPerUnit) rMultiple = ((exit - entry) * dir) / riskPerUnit;
    if (pnl > 1e-7) result = "Win";
    else if (pnl < -1e-7) result = "Loss";
    else result = "Breakeven";
  }
  let holdMinutes: number | null = null;
  if (t.entryTime && t.exitTime && t.date) {
    const exitDate = t.exitDate?.trim() ? t.exitDate : t.date;
    const edt = new Date(`${t.date}T${t.entryTime}:00`);
    const xdt = new Date(`${exitDate}T${t.exitTime}:00`);
    if (!isNaN(edt.getTime()) && !isNaN(xdt.getTime()) && xdt >= edt) holdMinutes = (xdt.getTime() - edt.getTime()) / 60000;
  }
  return { pnl, rMultiple, plannedRR, result, holdMinutes };
}

export default function PerformanceReport({ data, onClose }: Props) {
  const reportRef = useRef<HTMLDivElement>(null);
  const cur = data.account?.currency || "€";
  const acctName = data.account?.name || "Trading Account";
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  /* ── Inject print styles on mount, remove on unmount ── */
  useEffect(() => {
    const tag = document.createElement("style");
    tag.id = "src-report-print-style";
    tag.textContent = PRINT_STYLE;
    document.head.appendChild(tag);
    return () => { document.getElementById("src-report-print-style")?.remove(); };
  }, []);

  const handlePrint = () => window.print();

  /* ── Computed analytics ── */
  const {
    stats, equityData, monthlyData, dayData, sessionData, setupData, marketData, topWins, topLosses,
  } = useMemo(() => {
    const trades = (data.trades || []) as Record<string, string>[];
    const computed = trades.map((t) => ({ ...t, _c: computeTrade(t) }));
    const closed = computed.filter((t) => t._c.result);
    const wins = closed.filter((t) => t._c.result === "Win");
    const losses = closed.filter((t) => t._c.result === "Loss");

    const grossProfit = wins.reduce((s, t) => s + (t._c.pnl || 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t._c.pnl || 0), 0));
    const netProfit = closed.reduce((s, t) => s + (t._c.pnl || 0), 0);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;
    const winRate = closed.length ? (wins.length / closed.length) * 100 : null;
    const avgRMultiple = closed.length
      ? closed.map((t) => t._c.rMultiple).filter((v): v is number => v !== null && !isNaN(v)).reduce((s, v, _, a) => s + v / a.length, 0)
      : null;
    const holdVals = closed.map((t) => t._c.holdMinutes).filter((v): v is number => v !== null);
    const avgHold = holdVals.length ? holdVals.reduce((s, v) => s + v, 0) / holdVals.length : null;
    const maxDD = (() => {
      const sorted = [...closed].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      let peak = 0, dd = 0, running = 0;
      for (const t of sorted) { running += t._c.pnl || 0; if (running > peak) peak = running; if (peak - running > dd) dd = peak - running; }
      return dd;
    })();

    const stats = {
      total: trades.length, closed: closed.length, wins: wins.length, losses: losses.length,
      winRate, profitFactor, netProfit, grossProfit, grossLoss, avgRMultiple, avgHold, maxDD,
    };

    /* Equity curve */
    const equityData = (() => {
      const sorted = [...closed].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      let running = 0;
      return sorted.map((t, i) => { running += t._c.pnl || 0; return { i: i + 1, pnl: Math.round(running * 100) / 100, date: t.date }; });
    })();

    /* Monthly */
    const monthMap: Record<string, { pnl: number; wins: number; losses: number; count: number }> = {};
    closed.forEach((t) => {
      const k = t.date ? t.date.slice(0, 7) : "unknown";
      if (!monthMap[k]) monthMap[k] = { pnl: 0, wins: 0, losses: 0, count: 0 };
      monthMap[k].pnl += t._c.pnl || 0;
      monthMap[k].count++;
      if (t._c.result === "Win") monthMap[k].wins++; else if (t._c.result === "Loss") monthMap[k].losses++;
    });
    const monthlyData = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: monthLabel(k), pnl: Math.round(v.pnl * 100) / 100, wins: v.wins, losses: v.losses, count: v.count, wr: v.count ? (v.wins / v.count) * 100 : 0 }));

    /* Day of week */
    const dayMap: Record<number, { pnl: number; wins: number; count: number }> = {};
    closed.filter((t) => t.date).forEach((t) => {
      const d = new Date(t.date + "T12:00:00").getDay();
      if (!dayMap[d]) dayMap[d] = { pnl: 0, wins: 0, count: 0 };
      dayMap[d].pnl += t._c.pnl || 0;
      dayMap[d].count++;
      if (t._c.result === "Win") dayMap[d].wins++;
    });
    const dayData = [1, 2, 3, 4, 5].map((d) => ({
      label: DAY_NAMES[d].slice(0, 3),
      pnl: Math.round((dayMap[d]?.pnl || 0) * 100) / 100,
      count: dayMap[d]?.count || 0,
      wr: dayMap[d]?.count ? (dayMap[d].wins / dayMap[d].count) * 100 : 0,
    }));

    /* Session */
    const sessMap: Record<string, { pnl: number; wins: number; count: number }> = {};
    closed.filter((t) => t.session).forEach((t) => {
      const k = t.session as string;
      if (!sessMap[k]) sessMap[k] = { pnl: 0, wins: 0, count: 0 };
      sessMap[k].pnl += t._c.pnl || 0;
      sessMap[k].count++;
      if (t._c.result === "Win") sessMap[k].wins++;
    });
    const sessionData = Object.entries(sessMap)
      .sort(([, a], [, b]) => b.pnl - a.pnl)
      .map(([k, v]) => ({ label: k, pnl: Math.round(v.pnl * 100) / 100, count: v.count, wr: v.count ? (v.wins / v.count) * 100 : 0 }));

    /* Setup performance */
    const setupMap: Record<string, { pnl: number; wins: number; count: number }> = {};
    closed.filter((t) => t.setupId).forEach((t) => {
      const k = t.setupId as string;
      if (!setupMap[k]) setupMap[k] = { pnl: 0, wins: 0, count: 0 };
      setupMap[k].pnl += t._c.pnl || 0;
      setupMap[k].count++;
      if (t._c.result === "Win") setupMap[k].wins++;
    });
    const setupData = Object.entries(setupMap)
      .sort(([, a], [, b]) => b.pnl - a.pnl)
      .map(([k, v]) => {
        const setup = (data.setups || []).find((s) => s.id === k);
        return { label: setup?.name || "Unknown", pnl: Math.round(v.pnl * 100) / 100, count: v.count, wr: v.count ? (v.wins / v.count) * 100 : 0 };
      });

    /* Market breakdown */
    const mktMap: Record<string, { pnl: number; wins: number; count: number }> = {};
    closed.forEach((t) => {
      const k = (t.market as string) || "Other";
      if (!mktMap[k]) mktMap[k] = { pnl: 0, wins: 0, count: 0 };
      mktMap[k].pnl += t._c.pnl || 0;
      mktMap[k].count++;
      if (t._c.result === "Win") mktMap[k].wins++;
    });
    const marketData = Object.entries(mktMap)
      .sort(([, a], [, b]) => b.pnl - a.pnl)
      .map(([k, v]) => ({ label: k, pnl: Math.round(v.pnl * 100) / 100, count: v.count, wr: v.count ? (v.wins / v.count) * 100 : 0 }));

    /* Top wins/losses */
    const byPnl = [...closed].sort((a, b) => (b._c.pnl || 0) - (a._c.pnl || 0));
    const topWins = byPnl.slice(0, 3);
    const topLosses = byPnl.slice(-3).reverse();

    return { stats, equityData, monthlyData, dayData, sessionData, setupData, marketData, topWins, topLosses };
  }, [data]);

  const isGreen = equityData.length && equityData[equityData.length - 1].pnl >= 0;

  /* ── Shared table styles ── */
  const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-xs text-slate-700";
  const trCls = "border-b border-slate-100 last:border-0";

  return (
    <div id="src-perf-report" ref={reportRef}
      className="fixed inset-0 z-50 bg-white overflow-y-auto"
      style={{ fontFamily: "'Inter', sans-serif", color: "#111827" }}>

      {/* ── Top bar ── */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 flex items-center justify-between px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
          <span className="font-semibold text-slate-800 text-sm">Performance Report — {acctName}</span>
        </div>
        <button onClick={handlePrint}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm px-4 py-2 rounded-xl shadow transition">
          <Download size={15} /> Export PDF
        </button>
      </div>

      {/* ── Report body ── */}
      <div className="max-w-4xl mx-auto px-6 py-6 pb-16">

        {/* Title block */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "'Sora', sans-serif" }}>Performance Report</h1>
            <p className="text-sm text-slate-500 mt-0.5">{acctName} · Generated {today}</p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <div className="font-semibold text-slate-700 text-base">{stats.closed} closed trades</div>
            <div>{stats.total} total</div>
          </div>
        </div>

        <div className="h-px bg-slate-200 mt-4 mb-5" />

        {/* ── Key Stats ── */}
        <Section title="Key Metrics">
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            <StatBox label="Net P/L" value={`${cur}${Math.abs(stats.netProfit).toFixed(2)}`}
              sub={stats.netProfit >= 0 ? "profit" : "loss"}
              color={stats.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"} />
            <StatBox label="Win Rate" value={fmtPct(stats.winRate)}
              sub={`${stats.wins}W / ${stats.losses}L`}
              color={stats.winRate !== null && stats.winRate >= 50 ? "text-emerald-600" : "text-rose-600"} />
            <StatBox label="Profit Factor"
              value={stats.profitFactor === null ? "—" : stats.profitFactor === Infinity ? "∞" : fmt2(stats.profitFactor)}
              sub={`${cur}${stats.grossProfit.toFixed(0)} gross`}
              color={stats.profitFactor !== null && stats.profitFactor >= 1 ? "text-emerald-600" : "text-rose-600"} />
            <StatBox label="Avg R-Multiple" value={stats.avgRMultiple !== null ? fmt2(stats.avgRMultiple) + "R" : "—"}
              color={stats.avgRMultiple !== null && stats.avgRMultiple >= 0 ? "text-emerald-600" : "text-rose-600"} />
            <StatBox label="Avg Hold Time" value={fmtMins(stats.avgHold)} color="text-slate-700" />
            <StatBox label="Max Drawdown" value={`${cur}${stats.maxDD.toFixed(2)}`}
              sub="from peak" color="text-rose-600" />
          </div>
        </Section>

        {/* ── Equity Curve ── */}
        {equityData.length > 0 && (
          <Section title="Equity Curve">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wide font-semibold">Cumulative Net P/L — All Time</p>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={equityData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} width={45}
                      tickFormatter={(v) => `${cur}${v >= 0 ? "" : "-"}${Math.abs(v)}`} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: number) => [`${cur}${Math.abs(v).toFixed(2)}`, "Cumulative P/L"]} />
                    <Line type="monotone" dataKey="pnl" stroke={isGreen ? "#10b981" : "#f43f5e"} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Section>
        )}

        {/* ── Monthly P&L + Day breakdown ── */}
        {monthlyData.length > 0 && (
          <Section title="Monthly Breakdown">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Monthly bar chart */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wide font-semibold">Monthly P/L</p>
                <div style={{ width: "100%", height: 160 }}>
                  <ResponsiveContainer>
                    <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} width={40}
                        tickFormatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}`} />
                      <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
                        formatter={(v: number) => [fmtSigned(v, cur), "P/L"]} />
                      <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                        {monthlyData.map((m, i) => <Cell key={i} fill={m.pnl >= 0 ? "#10b981" : "#f43f5e"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Monthly table */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead><tr className="border-b border-slate-200 bg-slate-100">
                    <th className={th}>Month</th>
                    <th className={th + " text-right"}>P/L</th>
                    <th className={th + " text-right"}>Trades</th>
                    <th className={th + " text-right"}>WR</th>
                  </tr></thead>
                  <tbody>
                    {monthlyData.map((m, i) => (
                      <tr key={i} className={trCls}>
                        <td className={td + " font-medium"}>{m.label}</td>
                        <td className={`${td} text-right font-semibold ${m.pnl >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{fmtSigned(m.pnl, cur)}</td>
                        <td className={td + " text-right text-slate-500"}>{m.count}</td>
                        <td className={td + " text-right"}>{fmtPct(m.wr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>
        )}

        {/* ── Day of week + Session ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-5">
          {/* Day of week */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Day of Week</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead><tr className="border-b border-slate-200 bg-slate-100">
                  <th className={th}>Day</th>
                  <th className={th + " text-right"}>P/L</th>
                  <th className={th + " text-right"}>Trades</th>
                  <th className={th + " text-right"}>WR</th>
                </tr></thead>
                <tbody>
                  {dayData.map((d, i) => (
                    <tr key={i} className={trCls}>
                      <td className={td + " font-medium"}>{d.label}</td>
                      <td className={`${td} text-right font-semibold ${d.pnl >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{d.count ? fmtSigned(d.pnl, cur) : "—"}</td>
                      <td className={td + " text-right text-slate-500"}>{d.count || "—"}</td>
                      <td className={td + " text-right"}>{d.count ? fmtPct(d.wr) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Session breakdown */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">By Session</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            {sessionData.length > 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead><tr className="border-b border-slate-200 bg-slate-100">
                    <th className={th}>Session</th>
                    <th className={th + " text-right"}>P/L</th>
                    <th className={th + " text-right"}>Trades</th>
                    <th className={th + " text-right"}>WR</th>
                  </tr></thead>
                  <tbody>
                    {sessionData.map((s, i) => (
                      <tr key={i} className={trCls}>
                        <td className={td + " font-medium"}>{s.label}</td>
                        <td className={`${td} text-right font-semibold ${s.pnl >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{fmtSigned(s.pnl, cur)}</td>
                        <td className={td + " text-right text-slate-500"}>{s.count}</td>
                        <td className={td + " text-right"}>{fmtPct(s.wr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-xs text-slate-400">
                Log session names on your trades to see a breakdown here.
              </div>
            )}
          </div>
        </div>

        {/* ── Market + Setup breakdown ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-5">
          {/* Market */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">By Market</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            {marketData.length > 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead><tr className="border-b border-slate-200 bg-slate-100">
                    <th className={th}>Market</th>
                    <th className={th + " text-right"}>P/L</th>
                    <th className={th + " text-right"}>Trades</th>
                    <th className={th + " text-right"}>WR</th>
                  </tr></thead>
                  <tbody>
                    {marketData.map((m, i) => (
                      <tr key={i} className={trCls}>
                        <td className={td + " font-medium"}>{m.label}</td>
                        <td className={`${td} text-right font-semibold ${m.pnl >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{fmtSigned(m.pnl, cur)}</td>
                        <td className={td + " text-right text-slate-500"}>{m.count}</td>
                        <td className={td + " text-right"}>{fmtPct(m.wr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {/* Setup performance */}
          {setupData.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">By Setup</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead><tr className="border-b border-slate-200 bg-slate-100">
                    <th className={th}>Setup</th>
                    <th className={th + " text-right"}>P/L</th>
                    <th className={th + " text-right"}>Trades</th>
                    <th className={th + " text-right"}>WR</th>
                  </tr></thead>
                  <tbody>
                    {setupData.map((s, i) => (
                      <tr key={i} className={trCls}>
                        <td className={`${td} font-medium max-w-[140px] truncate`} title={s.label}>{s.label}</td>
                        <td className={`${td} text-right font-semibold ${s.pnl >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{fmtSigned(s.pnl, cur)}</td>
                        <td className={td + " text-right text-slate-500"}>{s.count}</td>
                        <td className={td + " text-right"}>{fmtPct(s.wr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Best / Worst trades ── */}
        {(topWins.length > 0 || topLosses.length > 0) && (
          <Section title="Notable Trades">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Best */}
              {topWins.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp size={13} className="text-emerald-500" />
                    <span className="text-xs font-semibold text-slate-600">Top Winners</span>
                  </div>
                  <div className="space-y-1.5">
                    {topWins.map((t, i) => (
                      <div key={i} className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                        <div>
                          <span className="text-xs font-semibold text-slate-800">{t.symbol || "—"}</span>
                          <span className="text-[10px] text-slate-500 ml-2">{t.date}</span>
                        </div>
                        <span className="text-sm font-bold text-emerald-600">{fmtSigned(t._c.pnl, cur)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Worst */}
              {topLosses.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingDown size={13} className="text-rose-500" />
                    <span className="text-xs font-semibold text-slate-600">Worst Losses</span>
                  </div>
                  <div className="space-y-1.5">
                    {topLosses.map((t, i) => (
                      <div key={i} className="flex items-center justify-between bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                        <div>
                          <span className="text-xs font-semibold text-slate-800">{t.symbol || "—"}</span>
                          <span className="text-[10px] text-slate-500 ml-2">{t.date}</span>
                        </div>
                        <span className="text-sm font-bold text-rose-600">{fmtSigned(t._c.pnl, cur)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Footer ── */}
        <div className="mt-10 pt-4 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-400">
          <span>Onkar TradeX · {acctName}</span>
          <span>Generated {today}</span>
        </div>
      </div>
    </div>
  );
}
