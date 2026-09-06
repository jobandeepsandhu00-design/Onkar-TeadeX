import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Pencil, Plus, ShieldCheck, X } from "lucide-react";
import { DEFAULT_TRADING_RULES, ENTRY_CHECKLIST, RISK_CARDS } from "./defaults";
import { boardButton, primaryButton } from "./shared";

export function EntryChecklist() {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const count = checked.size;
  const pct = Math.round((count / ENTRY_CHECKLIST.length) * 100);
  const readiness = pct >= 80 ? { label: "High Quality", tone: "text-emerald-300", bar: "bg-emerald-400" } : pct >= 55 ? { label: "Medium Quality", tone: "text-amber-300", bar: "bg-amber-400" } : { label: "Do Not Trade", tone: "text-rose-300", bar: "bg-rose-400" };
  return (
    <section className="h-full rounded-[26px] border border-white/[0.08] bg-[#091321]/95 p-5 shadow-2xl shadow-black/20">
      <div className="flex items-start justify-between"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-amber-300">Manual checkpoint</div><h3 className="mt-1 font-[Sora] text-xl font-black text-white">Before Entry</h3></div><ShieldCheck size={22} className="text-amber-300" /></div>
      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4"><div className="flex items-end justify-between"><div><div className="text-2xl font-black text-white">{count} <span className="text-sm text-slate-600">/ {ENTRY_CHECKLIST.length}</span></div><div className="text-[10px] font-semibold text-slate-500">conditions passed</div></div><div className={`text-sm font-black ${readiness.tone}`}>{readiness.label}</div></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={`h-full rounded-full transition-all ${readiness.bar}`} style={{ width: `${pct}%` }} /></div></div>
      <div className="mt-4 space-y-1.5">{ENTRY_CHECKLIST.map((item, index) => { const active = checked.has(index); return <button type="button" key={item} onClick={() => setChecked((current) => { const next = new Set(current); active ? next.delete(index) : next.add(index); return next; })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/[0.035]"><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${active ? "border-emerald-300 bg-emerald-400 text-slate-950" : "border-white/15 bg-white/[0.025]"}`}>{active && <Check size={13} strokeWidth={3} />}</span><span className={`text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>{item}</span></button>; })}</div>
      <p className="mt-4 border-t border-white/[0.06] pt-4 text-[10px] leading-5 text-slate-600">Manual process tool only. This score is not an automated trading signal.</p>
    </section>
  );
}

export function RulesBoard({ rules = DEFAULT_TRADING_RULES, onChange }: { rules?: string[]; onChange?: (rules: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rules);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rules : rules.slice(0, 10);
  return (
    <section className="rounded-[26px] border border-white/[0.08] bg-[#091321]/95 p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-amber-300">Process discipline</div><h3 className="mt-1 font-[Sora] text-xl font-black text-white sm:text-2xl">Smart Raja Trading Rules</h3><p className="mt-1 text-xs text-slate-500">Your non-negotiables before execution.</p></div>{onChange && <button type="button" onClick={() => { setDraft(rules); setEditing(true); }} className={boardButton}><Pencil size={13} />Edit rules</button>}</div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{shown.map((rule, index) => <div key={`${rule}-${index}`} className="flex min-h-16 items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-[10px] font-black text-amber-300">{String(index + 1).padStart(2, "0")}</span><p className="text-xs leading-5 text-slate-300">{rule}</p></div>)}</div>
      {rules.length > 10 && <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-amber-300">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded ? "Show less" : `Show all ${rules.length} rules`}</button>}
      {editing && <div className="fixed inset-0 z-[135] flex items-end justify-center bg-black/75 backdrop-blur sm:items-center sm:p-5"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#08111e] p-5 sm:rounded-[28px] sm:p-6"><div className="flex items-center justify-between"><h4 className="font-[Sora] text-xl font-black text-white">Edit Trading Rules</h4><button type="button" onClick={() => setEditing(false)} className={boardButton}><X size={15} /></button></div><div className="mt-5 space-y-2">{draft.map((rule, index) => <div key={index} className="flex gap-2"><span className="mt-3 text-[10px] font-bold text-slate-600">{String(index + 1).padStart(2, "0")}</span><textarea value={rule} rows={2} onChange={(event) => setDraft((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} className="flex-1 resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200 outline-none focus:border-amber-300/40" /><button type="button" onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="p-2 text-slate-600 hover:text-rose-300"><X size={14} /></button></div>)}</div><div className="mt-4 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => setDraft((current) => [...current, ""])} className={boardButton}><Plus size={13} />Add rule</button><button type="button" onClick={() => { onChange?.(draft.filter((rule) => rule.trim()).map((rule) => rule.trim())); setEditing(false); }} className={primaryButton}><Check size={14} />Save rules</button></div></div></div>}
    </section>
  );
}

export function RiskManagementBoard() {
  return (
    <section className="rounded-[26px] border border-white/[0.08] bg-[#091321]/95 p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/10"><AlertTriangle size={18} className="text-rose-300" /></div><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-rose-300">Capital protection</div><h3 className="mt-1 font-[Sora] text-xl font-black text-white sm:text-2xl">Manage Risk</h3></div></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{RISK_CARDS.map(([trigger, response], index) => <article key={trigger} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"><div className="text-[10px] font-black uppercase tracking-[.14em] text-rose-300">{String(index + 1).padStart(2, "0")} · Trigger</div><div className="mt-2 text-sm font-bold text-white">{trigger}</div><div className="my-3 h-px bg-white/[0.06]" /><p className="text-xs leading-5 text-slate-400">{response}</p></article>)}</div>
      <p className="mt-5 border-t border-white/[0.06] pt-4 text-[10px] leading-5 text-slate-600">Rules are user-defined trading process guidelines, not financial advice.</p>
    </section>
  );
}

