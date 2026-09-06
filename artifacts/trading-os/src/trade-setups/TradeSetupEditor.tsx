import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowDown, ArrowUp, Check, Copy, GripVertical, ImagePlus, Loader2, Plus, Save, Star, Trash2, X } from "lucide-react";
import { removeAttachment, uploadAttachment } from "../api";
import { createSetupId, normalizeTradeSetup, slugifySetup } from "./defaults";
import type { SetupDirection, SetupQuality, SetupRuleType, SetupSession, SetupTimeframe, TradeSetup, TradeSetupImage, TradeSetupRule } from "./types";
import { boardButton, primaryButton, ResolvedImage } from "./shared";

const RULE_SECTIONS: Array<[SetupRuleType, string, string]> = [
  ["condition", "Conditions", "Add condition"], ["entry", "Entry Rules", "Add entry rule"],
  ["stop_loss", "Stop Loss Rules", "Add stop-loss rule"], ["take_profit", "Take Profit Rules", "Add take-profit rule"],
  ["invalidation", "Exit / Invalidation", "Add invalidation rule"], ["risk", "Risk Management", "Add risk rule"],
  ["no_trade", "No Trade Conditions", "Add no-trade condition"], ["note", "Notes", "Add note"],
];

const inputClass = "w-full rounded-xl border border-white/10 bg-[#080f1b] px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-amber-300/45 focus:ring-2 focus:ring-amber-400/10";
const labelClass = "mb-1.5 block text-[10px] font-bold uppercase tracking-[.15em] text-slate-500";

function emptySetup(): TradeSetup {
  return {
    ...normalizeTradeSetup({ id: createSetupId(), name: "Draft Setup", direction: "Both", category: "Breakout", quality: "A", timeframe: "M30", session: "London", status: "active", isFavorite: false, rules: [], images: [], coverImage: null, sortOrder: 999 }),
    name: "",
    slug: "",
    description: "",
  };
}

interface ImageManagerProps {
  cover: TradeSetupImage | null;
  images: TradeSetupImage[];
  onCoverChange: (image: TradeSetupImage | null) => void;
  onImagesChange: (images: TradeSetupImage[]) => void;
  onError: (message: string) => void;
}

function ImageManager({ cover, images, onCoverChange, onImagesChange, onError }: ImageManagerProps) {
  const coverRef = useRef<HTMLInputElement>(null);
  const examplesRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (files: File[], isCover: boolean) => {
    const valid = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (valid.length !== files.length) onError("Only JPG, PNG and WEBP images are supported.");
    if (!valid.length) return;
    setBusy(true);
    try {
      const uploaded: TradeSetupImage[] = [];
      for (const file of valid) {
        const result = await uploadAttachment(file);
        uploaded.push({ id: createSetupId(), url: result.signedUrl, storagePath: result.path, name: file.name, mime: file.type, caption: "", sortOrder: images.length + uploaded.length });
      }
      if (isCover) {
        if (cover?.storagePath) await removeAttachment(cover.storagePath).catch(() => undefined);
        onCoverChange(uploaded[0]);
      } else onImagesChange([...images, ...uploaded]);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Image upload failed.");
    } finally { setBusy(false); }
  };

  const removeImage = async (image: TradeSetupImage, isCover = false) => {
    if (image.storagePath) await removeAttachment(image.storagePath).catch(() => undefined);
    if (isCover) onCoverChange(null); else onImagesChange(images.filter((item) => item.id !== image.id).map((item, index) => ({ ...item, sortOrder: index })));
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= images.length) return;
    const next = [...images]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onImagesChange(next.map((item, order) => ({ ...item, sortOrder: order })));
  };

  const makeCover = (image: TradeSetupImage) => {
    const nextExamples = images.filter((item) => item.id !== image.id);
    if (cover && cover.url !== "/trade-setup-breakout.png") nextExamples.unshift({ ...cover, sortOrder: 0 });
    onCoverChange({ ...image, sortOrder: 0 });
    onImagesChange(nextExamples.map((item, index) => ({ ...item, sortOrder: index })));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
      <div>
        <span className={labelClass}>Main setup image</span>
        {cover ? <div className="group relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-950"><ResolvedImage image={cover} alt="Setup cover preview" className="h-full w-full object-cover" /><div className="absolute inset-x-3 bottom-3 flex justify-end gap-2 opacity-0 transition group-hover:opacity-100"><button type="button" onClick={() => coverRef.current?.click()} className={boardButton}>Replace</button><button type="button" onClick={() => removeImage(cover, true)} className={`${boardButton} hover:text-rose-300`}><Trash2 size={14} /></button></div></div> : <button type="button" onClick={() => coverRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files), true); }} className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] text-slate-500 transition hover:border-amber-300/30 hover:text-amber-200"><ImagePlus size={28} /><span className="text-sm font-semibold">Drop cover or browse</span><span className="text-xs">JPG, PNG, WEBP</span></button>}
        <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { if (event.target.files?.[0]) void upload([event.target.files[0]], true); event.target.value = ""; }} />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><span className={labelClass}>Chart examples</span><button type="button" onClick={() => examplesRef.current?.click()} className={boardButton}><Plus size={13} />Add</button></div>
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {images.map((image, index) => <div key={image.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/setup-image", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const from = Number(event.dataTransfer.getData("text/setup-image")); if (!Number.isInteger(from) || from === index) return; const next = [...images]; const [moved] = next.splice(from, 1); next.splice(index, 0, moved); onImagesChange(next.map((item, order) => ({ ...item, sortOrder: order }))); }} className="flex gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2"><ResolvedImage image={image} alt="" className="h-16 w-24 rounded-lg object-cover" /><div className="min-w-0 flex-1"><input value={image.caption} onChange={(event) => onImagesChange(images.map((item) => item.id === image.id ? { ...item, caption: event.target.value } : item))} placeholder="Example caption" className="w-full bg-transparent text-xs text-slate-300 outline-none placeholder:text-slate-600" /><div className="mt-2 flex gap-1"><button type="button" onClick={() => move(index, -1)} aria-label="Move image up" className="p-1 text-slate-500 hover:text-white"><ArrowUp size={13} /></button><button type="button" onClick={() => move(index, 1)} aria-label="Move image down" className="p-1 text-slate-500 hover:text-amber-300"><ArrowDown size={13} /></button><button type="button" onClick={() => makeCover(image)} aria-label="Make cover image" className="p-1 text-slate-500 hover:text-amber-300"><Star size={13} /></button><button type="button" onClick={() => removeImage(image)} aria-label="Remove image" className="ml-auto p-1 text-slate-500 hover:text-rose-300"><Trash2 size={13} /></button></div></div></div>)}
          {!images.length && <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-white/10 text-center text-xs text-slate-600">Add multiple annotated chart examples</div>}
        </div>
        <input ref={examplesRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { if (event.target.files) void upload(Array.from(event.target.files), false); event.target.value = ""; }} />
      </div>
      {busy && <div className="col-span-full flex items-center gap-2 text-xs text-amber-200"><Loader2 size={14} className="animate-spin" />Uploading securely to Supabase Storage…</div>}
    </div>
  );
}

function RuleEditor({ rules, type, title, placeholder, onChange }: { rules: TradeSetupRule[]; type: SetupRuleType; title: string; placeholder: string; onChange: (rules: TradeSetupRule[]) => void }) {
  const list = rules.filter((rule) => rule.type === type).sort((a, b) => a.sortOrder - b.sortOrder);
  const updateList = (nextList: TradeSetupRule[]) => {
    const others = rules.filter((rule) => rule.type !== type);
    onChange([...others, ...nextList.map((rule, index) => ({ ...rule, sortOrder: index }))]);
  };
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= list.length) return; const next = [...list]; [next[index], next[target]] = [next[target], next[index]]; updateList(next); };
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-100">{title}</h3><span className="text-[10px] font-semibold text-slate-600">{list.length} rules</span></div>
      <div className="space-y-2">{list.map((rule, index) => <div key={rule.id} draggable onDragStart={(event) => event.dataTransfer.setData(`text/setup-rule-${type}`, String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const from = Number(event.dataTransfer.getData(`text/setup-rule-${type}`)); if (!Number.isInteger(from) || from === index) return; const next = [...list]; const [moved] = next.splice(from, 1); next.splice(index, 0, moved); updateList(next); }} className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-[#080f1b] p-2"><GripVertical size={14} className="mt-3 shrink-0 cursor-grab text-slate-700" /><textarea value={rule.content} rows={2} onChange={(event) => updateList(list.map((item) => item.id === rule.id ? { ...item, content: event.target.value } : item))} className="min-h-12 flex-1 resize-y bg-transparent p-1 text-sm leading-5 text-slate-300 outline-none" /><div className="flex flex-col"><button type="button" onClick={() => move(index, -1)} className="p-1 text-slate-600 hover:text-white"><ArrowUp size={12} /></button><button type="button" onClick={() => move(index, 1)} className="p-1 text-slate-600 hover:text-white"><ArrowDown size={12} /></button><button type="button" aria-label="Duplicate rule" onClick={() => updateList([...list.slice(0, index + 1), { ...rule, id: createSetupId() }, ...list.slice(index + 1)])} className="p-1 text-slate-600 hover:text-sky-300"><Copy size={12} /></button><button type="button" onClick={() => updateList(list.filter((item) => item.id !== rule.id))} className="p-1 text-slate-600 hover:text-rose-300"><X size={12} /></button></div></div>)}</div>
      <button type="button" onClick={() => updateList([...list, { id: createSetupId(), type, content: "", sortOrder: list.length }])} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 hover:text-amber-200"><Plus size={13} />{placeholder}</button>
    </section>
  );
}

interface Props { setup?: TradeSetup | null; onSave: (setup: TradeSetup) => void; onClose: () => void; }

export function TradeSetupEditor({ setup, onSave, onClose }: Props) {
  const initial = useMemo(() => setup ? normalizeTradeSetup(setup) : emptySetup(), [setup]);
  const [form, setForm] = useState<TradeSetup>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setForm(initial); setDirty(false); }, [initial]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const patch = <K extends keyof TradeSetup>(key: K, value: TradeSetup[K]) => { setForm((current) => ({ ...current, [key]: value })); setDirty(true); };
  const close = () => { if (!dirty || window.confirm("Discard unsaved setup changes?")) onClose(); };
  const save = () => {
    if (!form.name.trim()) { setError("Setup name is required."); return; }
    const cleanRules = form.rules.filter((rule) => rule.content.trim()).map((rule) => ({ ...rule, content: rule.content.trim() }));
    const first = (type: SetupRuleType) => cleanRules.find((rule) => rule.type === type)?.content ?? "";
    onSave({ ...form, slug: slugifySetup(form.name), rules: cleanRules, updatedAt: new Date().toISOString(), image: form.coverImage?.url ?? null, photos: form.images.map((item) => ({ id: item.id, url: item.url, caption: item.caption, storagePath: item.storagePath })), trend: first("condition"), entry: first("entry"), stop: first("stop_loss"), target: first("take_profit"), midTrade: first("risk"), notes: first("note"), marketBias: form.direction === "Buy" ? "Bullish" : form.direction === "Sell" ? "Bearish" : "Neutral", setupType: form.category, checklist: cleanRules.filter((rule) => rule.type === "condition").map((rule) => ({ id: rule.id, text: rule.content, done: false })) });
    setDirty(false);
  };

  return (
    <div className="fixed inset-0 z-[125] overflow-y-auto bg-black/75 p-0 backdrop-blur-md sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label={setup ? "Edit setup" : "Add new setup"} className="mx-auto min-h-full w-full max-w-6xl border-white/10 bg-[#07101b] shadow-2xl sm:min-h-0 sm:rounded-[28px] sm:border">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/[0.07] bg-[#07101b]/95 px-5 py-4 backdrop-blur sm:rounded-t-[28px] sm:px-7">
          <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-amber-300">Setup Library</div><h2 className="font-[Sora] text-xl font-black text-white">{setup ? "Edit Setup" : "Add New Setup"}</h2></div>
          <div className="flex gap-2"><button type="button" onClick={close} className={boardButton}>Cancel</button><button type="button" onClick={save} className={primaryButton}><Save size={14} />Save Setup</button></div>
        </header>
        <div className="space-y-7 p-5 pb-28 sm:p-7">
          {error && <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
          <ImageManager cover={form.coverImage} images={form.images} onCoverChange={(value) => patch("coverImage", value)} onImagesChange={(value) => patch("images", value)} onError={setError} />
          <section><h3 className="mb-4 text-[11px] font-extrabold uppercase tracking-[.16em] text-slate-400">Basic information</h3><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="lg:col-span-2"><span className={labelClass}>Setup name</span><input className={inputClass} value={form.name} onChange={(event) => patch("name", event.target.value)} placeholder="Breakout A+" /></label>
            <label><span className={labelClass}>Direction</span><select className={inputClass} value={form.direction} onChange={(event) => patch("direction", event.target.value as SetupDirection)}>{["Buy", "Sell", "Both"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span className={labelClass}>Category</span><input className={inputClass} value={form.category} onChange={(event) => patch("category", event.target.value)} /></label>
            <label><span className={labelClass}>Setup quality</span><select className={inputClass} value={form.quality} onChange={(event) => patch("quality", event.target.value as SetupQuality)}>{["A+", "A", "B", "C"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span className={labelClass}>Timeframe</span><select className={inputClass} value={form.timeframe} onChange={(event) => patch("timeframe", event.target.value as SetupTimeframe)}>{["M5", "M15", "M30", "H1", "H4", "Custom"].map((item) => <option key={item}>{item}</option>)}</select></label>
            {form.timeframe === "Custom" && <label><span className={labelClass}>Custom timeframe</span><input className={inputClass} value={form.customTimeframe ?? ""} onChange={(event) => patch("customTimeframe", event.target.value)} /></label>}
            <label><span className={labelClass}>Session</span><select className={inputClass} value={form.session} onChange={(event) => patch("session", event.target.value as SetupSession)}>{["Asian", "London", "New York", "London/NY", "Any"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span className={labelClass}>Status</span><button type="button" onClick={() => patch("status", form.status === "active" ? "archived" : "active")} className={`${inputClass} flex items-center justify-between text-left`}><span>{form.status === "active" ? "Active" : "Archived"}</span>{form.status === "active" ? <Check size={15} className="text-emerald-300" /> : <Archive size={15} />}</button></label>
            <label className="md:col-span-2 lg:col-span-3"><span className={labelClass}>Description / market context</span><textarea className={`${inputClass} min-h-24 resize-y`} value={form.description} onChange={(event) => patch("description", event.target.value)} placeholder="Describe structure, trend requirement, zone, clean range and volume context…" /></label>
          </div></section>
          <section><h3 className="mb-4 text-[11px] font-extrabold uppercase tracking-[.16em] text-slate-400">Execution rules</h3><div className="grid gap-3 lg:grid-cols-2">{RULE_SECTIONS.map(([type, title, placeholder]) => <RuleEditor key={type} rules={form.rules} type={type} title={title} placeholder={placeholder} onChange={(value) => patch("rules", value)} />)}</div></section>
        </div>
      </div>
    </div>
  );
}
