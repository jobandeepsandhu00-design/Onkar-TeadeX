import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, Pencil, Star, X, ZoomIn } from "lucide-react";
import type { SetupRuleType, TradeSetup, TradeSetupImage } from "./types";
import { boardButton, DirectionBadge, getRules, MetaBadge, ResolvedImage, useResolvedImage } from "./shared";

const TABS: Array<{ label: string; types: SetupRuleType[] }> = [
  { label: "Overview", types: ["condition"] },
  { label: "Entry Rules", types: ["entry"] },
  { label: "Exit Rules", types: ["stop_loss", "take_profit", "invalidation"] },
  { label: "Risk Management", types: ["risk", "no_trade"] },
  { label: "Examples", types: [] },
  { label: "Notes", types: ["note"] },
];

const LABELS: Record<SetupRuleType, string> = {
  condition: "Conditions", entry: "Entry Rules", stop_loss: "Stop Loss", take_profit: "Take Profit",
  invalidation: "Invalidation", risk: "Risk Management", no_trade: "No Trade Conditions", note: "Notes",
};

function DetailImage({ image, alt, onZoom }: { image: TradeSetupImage; alt: string; onZoom: () => void }) {
  const url = useResolvedImage(image);
  return (
    <button type="button" onClick={onZoom} className="group relative block aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#050a13]">
      <img src={url} alt={alt} className="h-full w-full object-contain" />
      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/65 px-3 py-2 text-xs font-semibold text-white opacity-0 backdrop-blur transition group-hover:opacity-100"><ZoomIn size={14} />Zoom</span>
    </button>
  );
}

interface Props {
  setup: TradeSetup;
  onClose: () => void;
  onEdit?: (setup: TradeSetup) => void;
  onFavorite?: (setup: TradeSetup) => void;
}

export function TradeSetupDetail({ setup, onClose, onEdit, onFavorite }: Props) {
  const [tab, setTab] = useState("Overview");
  const [imageIndex, setImageIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const images = useMemo(() => [setup.coverImage, ...setup.images.filter((item) => item.id !== setup.coverImage?.id)].filter((item): item is TradeSetupImage => Boolean(item)), [setup]);
  const currentImage = images[imageIndex] ?? null;
  const currentTab = TABS.find((item) => item.label === tab) ?? TABS[0];

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") zoomed ? setZoomed(false) : onClose();
      if (event.key === "ArrowRight" && images.length > 1) setImageIndex((value) => (value + 1) % images.length);
      if (event.key === "ArrowLeft" && images.length > 1) setImageIndex((value) => (value - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [images.length, onClose, zoomed]);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-md" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={`${setup.name} details`} className="absolute inset-y-0 right-0 flex w-full max-w-[760px] flex-col border-l border-white/10 bg-[#07101b] shadow-[-30px_0_100px_rgba(0,0,0,.55)] animate-[setup-panel-in_.24s_ease-out]">
        <header className="border-b border-white/[0.07] bg-[#081321]/95 px-5 py-4 backdrop-blur sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap gap-2"><DirectionBadge direction={setup.direction} /><MetaBadge gold>{setup.quality}</MetaBadge><MetaBadge>{setup.timeframe}</MetaBadge><MetaBadge>{setup.session}</MetaBadge></div>
              <h2 className="font-[Sora] text-2xl font-black tracking-tight text-white sm:text-3xl">{setup.name}</h2>
              <p className="mt-1 text-sm text-slate-400">{setup.description || setup.category}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {onFavorite && <button type="button" onClick={() => onFavorite(setup)} className={boardButton}>{setup.isFavorite ? <Star size={15} className="fill-amber-300 text-amber-300" /> : <Heart size={15} />}</button>}
              {onEdit && <button type="button" onClick={() => onEdit(setup)} className={boardButton}><Pencil size={14} /><span className="hidden sm:inline">Edit</span></button>}
              <button type="button" onClick={onClose} aria-label="Close details" className={boardButton}><X size={16} /></button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {currentImage && (
            <div>
              <DetailImage image={currentImage} alt={`${setup.name} example ${imageIndex + 1}`} onZoom={() => setZoomed(true)} />
              {images.length > 1 && <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">{images.map((image, index) => <button type="button" key={image.id} onClick={() => setImageIndex(index)} className={`h-14 w-24 shrink-0 overflow-hidden rounded-xl border-2 bg-slate-950 ${index === imageIndex ? "border-amber-300" : "border-white/10"}`}><ResolvedImage image={image} alt={`${setup.name} thumbnail ${index + 1}`} className="h-full w-full object-cover" /></button>)}</div>}
            </div>
          )}

          <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-white/[0.07]" aria-label="Setup detail sections">
            {TABS.map((item) => <button type="button" key={item.label} onClick={() => setTab(item.label)} className={`shrink-0 border-b-2 px-3 py-3 text-xs font-bold transition ${tab === item.label ? "border-amber-300 text-amber-200" : "border-transparent text-slate-500 hover:text-slate-300"}`}>{item.label}</button>)}
          </nav>

          <div className="py-6">
            {tab === "Overview" && <div className="mb-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-amber-300">Market context</div><p className="mt-2 text-sm leading-7 text-slate-300">{setup.description || setup.trend || "Add a description and market context for this setup."}</p></div>}
            {tab === "Examples" ? (
              <div className="grid gap-3 sm:grid-cols-2">{images.map((image, index) => <div key={image.id} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]"><button type="button" onClick={() => { setImageIndex(index); setZoomed(true); }} className="aspect-video w-full bg-slate-950"><ResolvedImage image={image} alt={`${setup.name} example ${index + 1}`} className="h-full w-full object-cover" /></button>{image.caption && <p className="px-3 py-2 text-xs text-slate-400">{image.caption}</p>}</div>)}</div>
            ) : currentTab.types.map((type) => {
              const rules = getRules(setup, type);
              if (!rules.length) return null;
              return <section key={type} className="mb-6"><h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-[.16em] text-slate-500">{LABELS[type]}</h3><div className="space-y-2">{rules.map((rule, index) => <div key={rule.id} className="flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-[10px] font-black text-amber-300">{String(index + 1).padStart(2, "0")}</span><p className="text-sm leading-6 text-slate-300">{rule.content}</p></div>)}</div></section>;
            })}
          </div>
        </div>
      </aside>

      {zoomed && currentImage && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/90 p-4" onClick={() => setZoomed(false)}><ResolvedImage image={currentImage} alt={`${setup.name} enlarged chart`} className="max-h-[92vh] max-w-[96vw] rounded-2xl object-contain" />{images.length > 1 && <><button type="button" onClick={(event) => { event.stopPropagation(); setImageIndex((value) => (value - 1 + images.length) % images.length); }} className="absolute left-4 rounded-full border border-white/15 bg-black/60 p-3 text-white"><ChevronLeft /></button><button type="button" onClick={(event) => { event.stopPropagation(); setImageIndex((value) => (value + 1) % images.length); }} className="absolute right-4 rounded-full border border-white/15 bg-black/60 p-3 text-white"><ChevronRight /></button></>}</div>}
    </div>
  );
}
