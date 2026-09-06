import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Expand, Library, Plus, Settings2, Star } from "lucide-react";
import type { TradeSetup } from "./types";
import { TradeSetupCard } from "./TradeSetupCard";
import { TradeSetupDetail } from "./TradeSetupDetail";
import { TradeSetupEditor } from "./TradeSetupEditor";
import { EntryChecklist, RiskManagementBoard, RulesBoard } from "./TradingProcessBoards";
import { boardButton, DirectionBadge, getRules, MetaBadge, primaryButton, ResolvedImage, SetupImage } from "./shared";

interface BoardProps {
  setups: TradeSetup[];
  onChange: (setups: TradeSetup[]) => void;
  tradingRules?: string[];
  onTradingRulesChange?: (rules: string[]) => void;
  onViewLibrary: () => void;
}

function SelectedSetup({ setup, onOpen }: { setup: TradeSetup; onOpen: () => void }) {
  const entry = getRules(setup, "entry", 2);
  const stop = getRules(setup, "stop_loss", 1);
  const target = getRules(setup, "take_profit", 1);
  return (
    <section className="overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#091321]/95 shadow-2xl shadow-black/20">
      <div className="grid min-h-full lg:grid-cols-[1.2fr_.8fr]">
        <SetupImage setup={setup} onZoom={onOpen} className="aspect-video min-h-[300px] lg:h-full" />
        <div className="flex flex-col p-5 sm:p-6">
          <div className="flex flex-wrap gap-2"><DirectionBadge direction={setup.direction} /><MetaBadge gold>{setup.quality}</MetaBadge><MetaBadge>{setup.timeframe}</MetaBadge></div>
          <h3 className="mt-4 font-[Sora] text-2xl font-black leading-tight text-white">{setup.name}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">{setup.description}</p>
          <div className="mt-5 space-y-4">
            {entry.length > 0 && <div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-emerald-300">Entry</div><p className="mt-1 text-sm leading-6 text-slate-300">{entry[0].content}</p></div>}
            {stop.length > 0 && <div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-rose-300">Stop Loss</div><p className="mt-1 text-sm leading-6 text-slate-300">{stop[0].content}</p></div>}
            {target.length > 0 && <div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-amber-300">Take Profit</div><p className="mt-1 text-sm leading-6 text-slate-300">{target[0].content}</p></div>}
          </div>
          <button type="button" onClick={onOpen} className="mt-auto flex items-center gap-2 pt-6 text-xs font-bold text-amber-300 hover:text-amber-200">Open complete playbook <ArrowRight size={14} /></button>
        </div>
      </div>
    </section>
  );
}

export function TradeSetupDashboard({ setups, onChange, tradingRules, onTradingRulesChange, onViewLibrary }: BoardProps) {
  const active = useMemo(() => setups.filter((setup) => setup.status === "active").sort((a, b) => a.sortOrder - b.sortOrder), [setups]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<TradeSetup | null>(null);
  const [editing, setEditing] = useState<TradeSetup | null | "new">(null);
  const [toast, setToast] = useState("");
  const boardRef = useRef<HTMLElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const selected = active[index] ?? active[0];

  const go = (next: number) => {
    if (!active.length) return;
    const safe = (next + active.length) % active.length;
    setIndex(safe);
    cardRefs.current[safe]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  useEffect(() => {
    if (paused || active.length < 2 || detail || editing) return;
    const timer = window.setInterval(() => go(index + 1), 7000);
    return () => window.clearInterval(timer);
  }, [active.length, detail, editing, index, paused]);

  useEffect(() => { if (index >= active.length) setIndex(0); }, [active.length, index]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2600); return () => window.clearTimeout(timer); }, [toast]);

  const replace = (next: TradeSetup) => onChange(setups.map((item) => item.id === next.id ? next : item));
  const favorite = (setup: TradeSetup) => { replace({ ...setup, isFavorite: !setup.isFavorite, updatedAt: new Date().toISOString() }); setDetail((current) => current?.id === setup.id ? { ...current, isFavorite: !current.isFavorite } : current); };
  const save = (setup: TradeSetup) => {
    const exists = setups.some((item) => item.id === setup.id);
    onChange(exists ? setups.map((item) => item.id === setup.id ? setup : item) : [...setups, { ...setup, sortOrder: setups.length }]);
    setEditing(null); setToast(exists ? "Setup updated" : "Setup added to library");
  };

  if (!active.length) return <section className="rounded-[28px] border border-dashed border-white/10 bg-[#08111e] p-10 text-center"><Library className="mx-auto text-slate-700" size={34} /><h2 className="mt-4 font-[Sora] text-xl font-black text-white">Build your setup playbook</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Add your first visual setup with entry, exit and risk rules.</p><button type="button" onClick={() => setEditing("new")} className={`${primaryButton} mt-5`}><Plus size={14} />Add Setup</button>{editing && <TradeSetupEditor onSave={save} onClose={() => setEditing(null)} />}</section>;

  return (
    <div className="space-y-4">
      <section ref={boardRef} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)} className="relative overflow-hidden rounded-[30px] border border-amber-300/[0.13] bg-[#050b14] p-4 shadow-[0_30px_100px_rgba(0,0,0,.42)] sm:p-6">
        <div className="pointer-events-none absolute left-0 top-0 h-52 w-72 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,.12),transparent_65%)]" />
        <div className="relative mb-5 flex flex-wrap items-end justify-between gap-4">
          <div><div className="text-[10px] font-black uppercase tracking-[.22em] text-amber-300">Smart Raja Concepts</div><h2 className="mt-1 font-[Sora] text-2xl font-black tracking-tight text-white sm:text-3xl">Trade Setup Board</h2><p className="mt-1 text-xs text-slate-500 sm:text-sm">Smart Raja Concepts — Rules, Entries, Risk &amp; Execution</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => go(index - 1)} aria-label="Previous setup" className={boardButton}><ChevronLeft size={15} /></button><button type="button" onClick={() => go(index + 1)} aria-label="Next setup" className={boardButton}><ChevronRight size={15} /></button><button type="button" onClick={() => boardRef.current?.requestFullscreen?.()} className={`${boardButton} hidden sm:inline-flex`}><Expand size={14} />Full Screen</button><button type="button" onClick={onViewLibrary} className={boardButton}><Settings2 size={14} />Manage Library</button><button type="button" onClick={() => setEditing("new")} className={primaryButton}><Plus size={14} />Add Setup</button></div>
        </div>

        <div className="setup-board-track relative flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {active.map((setup, setupIndex) => <div key={setup.id} ref={(node) => { cardRefs.current[setupIndex] = node; }} className="setup-board-slide snap-start"><TradeSetupCard setup={setup} onOpen={setDetail} onFavorite={favorite} onEdit={(value) => setEditing(value)} /></div>)}
        </div>
        <div className="relative mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1.5">{active.map((setup, dotIndex) => <button type="button" key={setup.id} aria-label={`Show ${setup.name}`} onClick={() => go(dotIndex)} className={`h-1.5 rounded-full transition-all ${dotIndex === index ? "w-7 bg-amber-300" : "w-1.5 bg-white/15 hover:bg-white/35"}`} />)}</div><button type="button" onClick={onViewLibrary} className="text-xs font-bold text-slate-500 transition hover:text-amber-300">View All Setups →</button></div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]"><SelectedSetup setup={selected} onOpen={() => setDetail(selected)} /><EntryChecklist /></div>
      <RulesBoard rules={tradingRules} onChange={onTradingRulesChange} />
      <RiskManagementBoard />
      <div className="grid gap-4 lg:grid-cols-2">
        {[{ title: "Recently Added", items: [...active].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4) }, { title: "Favorites", items: active.filter((item) => item.isFavorite).slice(0, 4) }].map((group) => <section key={group.title} className="rounded-[26px] border border-white/[0.08] bg-[#091321]/95 p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-[Sora] text-lg font-black text-white">{group.title}</h3>{group.title === "Favorites" && <Star size={16} className="text-amber-300" />}</div><div className="grid gap-2 sm:grid-cols-2">{group.items.map((setup) => <button type="button" key={setup.id} onClick={() => setDetail(setup)} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-black/20 p-3 text-left transition hover:border-amber-300/25"><ResolvedImage image={setup.coverImage} alt="" className="h-12 w-16 rounded-lg object-cover" /><div className="min-w-0"><div className="truncate text-xs font-bold text-slate-200">{setup.name}</div><div className="mt-1 text-[10px] text-slate-600">{setup.quality} · {setup.timeframe} · {setup.session}</div></div></button>)}{!group.items.length && <p className="col-span-2 py-5 text-center text-xs text-slate-600">No {group.title.toLowerCase()} yet.</p>}</div></section>)}
      </div>

      <div className="sticky bottom-[72px] z-30 -mx-1 flex gap-2 rounded-2xl border border-white/10 bg-[#07101b]/95 p-2 shadow-2xl backdrop-blur sm:hidden"><button type="button" onClick={() => setDetail(selected)} className={`${boardButton} flex-1`}>View Rules</button><button type="button" onClick={() => setEditing("new")} className={`${primaryButton} flex-1`}><Plus size={14} />Add Setup</button></div>
      {detail && <TradeSetupDetail setup={setups.find((item) => item.id === detail.id) ?? detail} onClose={() => setDetail(null)} onFavorite={favorite} onEdit={(setup) => { setDetail(null); setEditing(setup); }} />}
      {editing && <TradeSetupEditor setup={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {toast && <div role="status" className="fixed bottom-24 right-5 z-[150] rounded-2xl border border-emerald-300/20 bg-[#0a1a18] px-4 py-3 text-sm font-semibold text-emerald-200 shadow-2xl">{toast}</div>}
    </div>
  );
}
