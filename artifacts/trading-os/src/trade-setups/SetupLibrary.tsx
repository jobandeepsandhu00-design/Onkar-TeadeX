import { useMemo, useState } from "react";
import { Archive, Copy, Grid2X2, Heart, LayoutGrid, List, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
import { downloadAttachment, removeAttachment, uploadAttachment } from "../api";
import type { SetupDirection, SetupQuality, SetupSession, SetupTimeframe, TradeSetup } from "./types";
import { createSetupId } from "./defaults";
import { TradeSetupCard } from "./TradeSetupCard";
import { TradeSetupDetail } from "./TradeSetupDetail";
import { TradeSetupEditor } from "./TradeSetupEditor";
import { boardButton, DirectionBadge, MetaBadge, primaryButton, ResolvedImage } from "./shared";

type ViewMode = "cards" | "grid" | "list";
type Filters = { direction: "All" | SetupDirection; quality: "All" | SetupQuality; timeframe: "All" | SetupTimeframe; session: "All" | SetupSession; category: string; favorites: boolean; recent: boolean };
const selectClass = "rounded-xl border border-white/10 bg-[#09111e] px-3 py-2 text-xs font-semibold text-slate-300 outline-none focus:border-amber-300/40";

export function SetupLibrary({ setups, onChange }: { setups: TradeSetup[]; onChange: (setups: TradeSetup[]) => void }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("cards");
  const [filters, setFilters] = useState<Filters>({ direction: "All", quality: "All", timeframe: "All", session: "All", category: "All", favorites: false, recent: false });
  const [detail, setDetail] = useState<TradeSetup | null>(null);
  const [editing, setEditing] = useState<TradeSetup | null | "new">(null);
  const [toast, setToast] = useState("");
  const categories = useMemo(() => ["All", ...Array.from(new Set(setups.map((item) => item.category))).sort()], [setups]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    let list = [...setups];
    if (term) list = list.filter((item) => [item.name, item.category, item.description, item.session, item.timeframe].join(" ").toLowerCase().includes(term));
    if (filters.direction !== "All") list = list.filter((item) => item.direction === filters.direction || item.direction === "Both");
    if (filters.quality !== "All") list = list.filter((item) => item.quality === filters.quality);
    if (filters.timeframe !== "All") list = list.filter((item) => item.timeframe === filters.timeframe);
    if (filters.session !== "All") list = list.filter((item) => item.session === filters.session);
    if (filters.category !== "All") list = list.filter((item) => item.category === filters.category);
    if (filters.favorites) list = list.filter((item) => item.isFavorite);
    if (filters.recent) list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); else list.sort((a, b) => a.sortOrder - b.sortOrder);
    return list;
  }, [filters, query, setups]);

  const replace = (next: TradeSetup) => onChange(setups.map((item) => item.id === next.id ? next : item));
  const favorite = (setup: TradeSetup) => { const next = { ...setup, isFavorite: !setup.isFavorite, updatedAt: new Date().toISOString() }; replace(next); setDetail((value) => value?.id === setup.id ? next : value); };
  const save = (setup: TradeSetup) => { const exists = setups.some((item) => item.id === setup.id); onChange(exists ? setups.map((item) => item.id === setup.id ? setup : item) : [...setups, { ...setup, sortOrder: setups.length }]); setEditing(null); setToast(exists ? "Setup updated" : "Setup created"); window.setTimeout(() => setToast(""), 2400); };
  const duplicate = async (setup: TradeSetup) => {
    const copyImage = async (image: TradeSetup["coverImage"]) => {
      if (!image) return null;
      if (!image.storagePath) return { ...image, id: createSetupId() };
      const blob = await downloadAttachment(image.storagePath);
      const file = new File([blob], image.name || "setup-chart.webp", { type: image.mime || blob.type || "image/webp" });
      const uploaded = await uploadAttachment(file);
      return { ...image, id: createSetupId(), url: uploaded.signedUrl, storagePath: uploaded.path };
    };
    try {
      setToast("Duplicating setup…");
      const now = new Date().toISOString();
      const coverImage = await copyImage(setup.coverImage);
      const images = (await Promise.all(setup.images.map(copyImage))).filter((item): item is NonNullable<typeof item> => Boolean(item));
      const copy: TradeSetup = { ...setup, id: createSetupId(), name: `${setup.name} Copy`, slug: `${setup.slug}-copy`, isFavorite: false, sortOrder: setups.length, createdAt: now, updatedAt: now, coverImage, images, rules: setup.rules.map((rule) => ({ ...rule, id: createSetupId() })) };
      onChange([...setups, copy]); setToast("Setup duplicated");
    } catch { setToast("Could not duplicate setup images"); }
  };
  const archive = (setup: TradeSetup) => replace({ ...setup, status: setup.status === "active" ? "archived" : "active", updatedAt: new Date().toISOString() });
  const remove = async (setup: TradeSetup) => { if (!window.confirm(`Delete “${setup.name}” permanently?`)) return; const remaining = setups.filter((item) => item.id !== setup.id); const retainedPaths = new Set(remaining.flatMap((item) => [item.coverImage?.storagePath, ...item.images.map((image) => image.storagePath)].filter(Boolean))); const removedPaths = [setup.coverImage?.storagePath, ...setup.images.map((image) => image.storagePath)].filter((path): path is string => Boolean(path) && !retainedPaths.has(path)); await Promise.all(removedPaths.map((path) => removeAttachment(path).catch(() => undefined))); onChange(remaining.map((item, index) => ({ ...item, sortOrder: index }))); setDetail(null); setToast("Setup deleted"); };
  const reorder = (sourceId: string, targetId: string) => { const sorted = [...setups].sort((a, b) => a.sortOrder - b.sortOrder); const from = sorted.findIndex((item) => item.id === sourceId); const to = sorted.findIndex((item) => item.id === targetId); if (from < 0 || to < 0 || from === to) return; const [moved] = sorted.splice(from, 1); sorted.splice(to, 0, moved); onChange(sorted.map((item, index) => ({ ...item, sortOrder: index }))); };

  const actions = (setup: TradeSetup) => <div className="flex items-center gap-1"><button type="button" onClick={() => favorite(setup)} aria-label="Favorite" className="p-2 text-slate-500 hover:text-amber-300">{setup.isFavorite ? <Star size={14} className="fill-amber-300 text-amber-300" /> : <Heart size={14} />}</button><button type="button" onClick={() => setEditing(setup)} aria-label="Edit" className="p-2 text-slate-500 hover:text-white"><Pencil size={14} /></button><button type="button" onClick={() => void duplicate(setup)} aria-label="Duplicate" className="p-2 text-slate-500 hover:text-sky-300"><Copy size={14} /></button><button type="button" onClick={() => archive(setup)} aria-label="Archive" className="p-2 text-slate-500 hover:text-amber-300"><Archive size={14} /></button><button type="button" onClick={() => void remove(setup)} aria-label="Delete" className="p-2 text-slate-500 hover:text-rose-300"><Trash2 size={14} /></button></div>;

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-[28px] border border-amber-300/[0.12] bg-[#07101b] p-5 shadow-2xl shadow-black/25 sm:p-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-[10px] font-black uppercase tracking-[.2em] text-amber-300">Smart Raja Concepts</div><h1 className="mt-1 font-[Sora] text-2xl font-black text-white sm:text-3xl">Trade Setup Library</h1><p className="mt-2 text-sm text-slate-500">Study, filter and manage your complete visual playbook.</p></div><button type="button" onClick={() => setEditing("new")} className={primaryButton}><Plus size={15} />Add Setup</button></div>
        <div className="mt-6 flex flex-col gap-3 xl:flex-row"><label className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search setups…" className="w-full rounded-xl border border-white/10 bg-[#050b14] py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-amber-300/40" /></label><div className="flex gap-1 rounded-xl border border-white/10 bg-[#050b14] p-1">{([{ key: "cards", Icon: LayoutGrid, label: "Large cards" }, { key: "grid", Icon: Grid2X2, label: "Compact grid" }, { key: "list", Icon: List, label: "List" }] as const).map(({ key, Icon, label }) => <button type="button" key={key} onClick={() => setView(key)} aria-label={label} className={`rounded-lg p-2.5 transition ${view === key ? "bg-amber-300 text-slate-950" : "text-slate-500 hover:text-white"}`}><Icon size={15} /></button>)}</div></div>
        <div className="mt-3 flex flex-wrap gap-2"><select className={selectClass} value={filters.direction} onChange={(event) => setFilters((value) => ({ ...value, direction: event.target.value as Filters["direction"] }))}>{["All", "Buy", "Sell"].map((item) => <option key={item} value={item}>{item === "All" ? "Direction" : item}</option>)}</select><select className={selectClass} value={filters.quality} onChange={(event) => setFilters((value) => ({ ...value, quality: event.target.value as Filters["quality"] }))}>{["All", "A+", "A", "B", "C"].map((item) => <option key={item} value={item}>{item === "All" ? "Quality" : item}</option>)}</select><select className={selectClass} value={filters.timeframe} onChange={(event) => setFilters((value) => ({ ...value, timeframe: event.target.value as Filters["timeframe"] }))}>{["All", "M5", "M15", "M30", "H1", "H4", "Custom"].map((item) => <option key={item} value={item}>{item === "All" ? "Timeframe" : item}</option>)}</select><select className={selectClass} value={filters.session} onChange={(event) => setFilters((value) => ({ ...value, session: event.target.value as Filters["session"] }))}>{["All", "Asian", "London", "New York", "London/NY", "Any"].map((item) => <option key={item} value={item}>{item === "All" ? "Session" : item}</option>)}</select><select className={selectClass} value={filters.category} onChange={(event) => setFilters((value) => ({ ...value, category: event.target.value }))}>{categories.map((item) => <option key={item}>{item}</option>)}</select><button type="button" onClick={() => setFilters((value) => ({ ...value, favorites: !value.favorites }))} className={`${boardButton} ${filters.favorites ? "!border-amber-300/40 !text-amber-200" : ""}`}><Star size={13} />Favorites</button><button type="button" onClick={() => setFilters((value) => ({ ...value, recent: !value.recent }))} className={`${boardButton} ${filters.recent ? "!border-amber-300/40 !text-amber-200" : ""}`}>Recently Updated</button></div>
      </header>

      <div className="flex items-center justify-between text-xs text-slate-600"><span>{filtered.length} of {setups.length} setups</span><span>Drag cards to reorder your board</span></div>
      {view === "cards" && <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">{filtered.map((setup) => <div key={setup.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/setup-id", setup.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => reorder(event.dataTransfer.getData("text/setup-id"), setup.id)}><TradeSetupCard setup={setup} onOpen={setDetail} onFavorite={favorite} onEdit={(value) => setEditing(value)} /></div>)}</div>}
      {view === "grid" && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{filtered.map((setup) => <article key={setup.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/setup-id", setup.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => reorder(event.dataTransfer.getData("text/setup-id"), setup.id)} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#091321]"><button type="button" onClick={() => setDetail(setup)} className="aspect-video w-full bg-slate-950"><ResolvedImage image={setup.coverImage} alt={`${setup.name} chart`} className="h-full w-full object-cover" /></button><div className="p-4"><div className="flex flex-wrap gap-1.5"><DirectionBadge direction={setup.direction} /><MetaBadge gold>{setup.quality}</MetaBadge></div><button type="button" onClick={() => setDetail(setup)} className="mt-3 line-clamp-1 text-left text-sm font-bold text-white">{setup.name}</button><div className="mt-1 text-[10px] text-slate-600">{setup.category} · {setup.timeframe} · {setup.session}</div><div className="mt-3 border-t border-white/[0.06] pt-2">{actions(setup)}</div></div></article>)}</div>}
      {view === "list" && <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#091321]"><table className="w-full min-w-[820px] text-left"><thead><tr className="border-b border-white/[0.07] text-[10px] uppercase tracking-[.14em] text-slate-600">{["Setup", "Direction", "Quality", "Category", "Timeframe", "Session", "Status", ""].map((item) => <th key={item} className="px-4 py-3 font-bold">{item}</th>)}</tr></thead><tbody>{filtered.map((setup) => <tr key={setup.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02]"><td className="px-4 py-3"><button type="button" onClick={() => setDetail(setup)} className="flex items-center gap-3"><ResolvedImage image={setup.coverImage} alt="" className="h-10 w-16 rounded-lg object-cover" /><span className="font-semibold text-slate-200">{setup.name}</span></button></td><td className="px-4 py-3"><DirectionBadge direction={setup.direction} /></td><td className="px-4 py-3 text-xs font-bold text-amber-300">{setup.quality}</td><td className="px-4 py-3 text-xs text-slate-400">{setup.category}</td><td className="px-4 py-3 text-xs text-slate-400">{setup.timeframe}</td><td className="px-4 py-3 text-xs text-slate-400">{setup.session}</td><td className="px-4 py-3 text-xs capitalize text-slate-400">{setup.status}</td><td className="px-4 py-3">{actions(setup)}</td></tr>)}</tbody></table></div>}
      {!filtered.length && <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center"><Search className="mx-auto text-slate-700" /><p className="mt-3 text-sm font-semibold text-slate-400">No setups match these filters</p></div>}
      {detail && <TradeSetupDetail setup={setups.find((item) => item.id === detail.id) ?? detail} onClose={() => setDetail(null)} onFavorite={favorite} onEdit={(setup) => { setDetail(null); setEditing(setup); }} />}
      {editing && <TradeSetupEditor setup={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {toast && <div role="status" className="fixed bottom-24 right-5 z-[150] rounded-2xl border border-emerald-300/20 bg-[#0a1a18] px-4 py-3 text-sm font-semibold text-emerald-200 shadow-2xl">{toast}</div>}
    </div>
  );
}
