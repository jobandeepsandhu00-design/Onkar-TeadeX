import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Library,
  Pencil,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { removeAttachment } from "../api";
import { useToast } from "../hooks/use-toast";
import { EntryChecklist, RiskManagementBoard, RulesBoard } from "./TradingProcessBoards";
import { TradeSetupDetail } from "./TradeSetupDetail";
import { TradeSetupEditor } from "./TradeSetupEditor";
import { createDefaultTradeSetups } from "./defaults";
import { DirectionBadge, MetaBadge, useResolvedImage } from "./shared";
import type { TradeSetup } from "./types";

interface BoardProps {
  setups: TradeSetup[];
  onChange: (setups: TradeSetup[]) => void;
  tradingRules?: string[];
  onTradingRulesChange?: (rules: string[]) => void;
  onViewLibrary: () => void;
}

function firstRule(setup: TradeSetup, type: TradeSetup["rules"][number]["type"], fallback: string) {
  return setup.rules.find((rule) => rule.type === type)?.content || fallback;
}

export function TradeSetupDashboard({
  setups,
  onChange,
  tradingRules,
  onTradingRulesChange,
  onViewLibrary,
}: BoardProps) {
  const { toast } = useToast();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef(false);
  const touchStartRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<TradeSetup | null>(null);
  const [editing, setEditing] = useState<TradeSetup | "new" | null>(null);
  const [showProcess, setShowProcess] = useState(false);

  const active = useMemo(
    () => setups.filter((setup) => setup.status === "active"),
    [setups],
  );

  useEffect(() => {
    if (activeIndex >= active.length) setActiveIndex(Math.max(0, active.length - 1));
  }, [active.length, activeIndex]);

  const scrollTo = (index: number) => {
    if (!active.length) return;
    const next = (index + active.length) % active.length;
    setActiveIndex(next);
    trackRef.current?.scrollTo({ left: trackRef.current.clientWidth * next, behavior: "smooth" });
  };

  useEffect(() => {
    if (active.length < 2) return;
    const timer = window.setInterval(() => {
      if (!interactionRef.current && !selected && !editing && !showProcess) scrollTo(activeIndex + 1);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [active.length, activeIndex, editing, selected, showProcess]);

  const replaceSetup = (next: TradeSetup) => {
    onChange(setups.map((setup) => (setup.id === next.id ? next : setup)));
    setEditing(null);
    setSelected((current) => (current?.id === next.id ? next : current));
    toast({ title: "Setup saved", description: `${next.name} is updated.` });
  };

  const createSetup = (next: TradeSetup) => {
    onChange([...setups, next]);
    setEditing(null);
    toast({ title: "Setup created", description: `${next.name} was added to the board.` });
  };

  const toggleFavorite = (setup: TradeSetup) => {
    replaceSetup({ ...setup, isFavorite: !setup.isFavorite, updatedAt: new Date().toISOString() });
  };

  const deleteCover = async (setup: TradeSetup) => {
    if (!setup.coverImage || !window.confirm(`Remove the cover image from “${setup.name}”?`)) return;

    const storagePath = setup.coverImage.storagePath;
    const isShared = Boolean(
      storagePath &&
        setups.some(
          (other) =>
            other.id !== setup.id &&
            (other.coverImage?.storagePath === storagePath ||
              other.images.some((image) => image.storagePath === storagePath)),
        ),
    );

    try {
      if (storagePath && !isShared) await removeAttachment(storagePath);
      const next = {
        ...setup,
        coverImage: null,
        image: null,
        updatedAt: new Date().toISOString(),
      };
      onChange(setups.map((item) => (item.id === setup.id ? next : item)));
      setSelected((current) => (current?.id === setup.id ? next : current));
      toast({ title: "Image removed", description: "The setup now uses a clean upload placeholder." });
    } catch (error) {
      toast({
        title: "Image could not be removed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const restoreDefaults = () => {
    const existing = new Set(setups.map((setup) => setup.name.toLowerCase()));
    const missing = createDefaultTradeSetups().filter((setup) => !existing.has(setup.name.toLowerCase()));
    onChange([...setups, ...missing]);
    toast({ title: "Library restored", description: `${missing.length} missing setup templates were added.` });
  };

  return (
    <>
      <section
        className="relative overflow-hidden rounded-[24px] border border-slate-700/70 bg-[#07101f]/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:p-4"
        aria-labelledby="trade-setup-board-title"
        onMouseEnter={() => { interactionRef.current = true; }}
        onMouseLeave={() => { interactionRef.current = false; }}
        onFocusCapture={() => { interactionRef.current = true; }}
        onBlurCapture={() => { interactionRef.current = false; }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-400">Smart Raja Concepts</p>
            <div className="flex items-baseline gap-2">
              <h2 id="trade-setup-board-title" className="truncate text-lg font-black tracking-tight text-white sm:text-xl">
                Trade Setup Board
              </h2>
              <span className="hidden text-xs text-slate-500 md:inline">Visual playbook</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-400 px-3 text-xs font-black text-slate-950 transition hover:bg-amber-300"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
            <button
              type="button"
              onClick={() => setShowProcess(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 px-2.5 text-xs font-bold text-slate-200 transition hover:border-amber-400/45"
              aria-label="Open trading rules, checklist and risk management"
            >
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              <span className="hidden sm:inline">Rules & Risk</span>
            </button>
            <button
              type="button"
              onClick={onViewLibrary}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 text-slate-300 transition hover:border-amber-400/45 hover:text-white"
              aria-label="Open setup library"
            >
              <Library className="h-4 w-4" />
            </button>
          </div>
        </div>

        {active.length ? (
          <>
            <div
              ref={trackRef}
              className="setup-board-track flex snap-x snap-mandatory overflow-x-auto"
              onScroll={(event) => {
                const element = event.currentTarget;
                if (!element.clientWidth) return;
                setActiveIndex(Math.round(element.scrollLeft / element.clientWidth));
              }}
              onTouchStart={(event) => { touchStartRef.current = event.touches[0]?.clientX ?? null; }}
              onTouchEnd={(event) => {
                if (touchStartRef.current === null) return;
                const distance = touchStartRef.current - (event.changedTouches[0]?.clientX ?? touchStartRef.current);
                if (Math.abs(distance) > 36) scrollTo(activeIndex + (distance > 0 ? 1 : -1));
                touchStartRef.current = null;
              }}
            >
              {active.map((setup, index) => {
                const distance = Math.abs(index - activeIndex);
                const isNearby = distance <= 1 || active.length - distance <= 1;
                return isNearby ? (
                  <CompactSetupSlide
                    key={setup.id}
                    setup={setup}
                    onOpen={() => setSelected(setup)}
                    onEdit={() => setEditing(setup)}
                    onDeleteImage={() => void deleteCover(setup)}
                    onFavorite={() => toggleFavorite(setup)}
                  />
                ) : (
                  <div key={setup.id} className="setup-board-slide min-w-full snap-center" aria-hidden="true" />
                );
              })}
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => scrollTo(activeIndex - 1)} className="board-nav-button" aria-label="Previous setup">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => scrollTo(activeIndex + 1)} className="board-nav-button" aria-label="Next setup">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="ml-1 text-[11px] font-bold tabular-nums text-slate-500">
                  {String(activeIndex + 1).padStart(2, "0")} / {String(active.length).padStart(2, "0")}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1" aria-label="Setup pagination">
                {active.map((setup, index) => (
                  <button
                    key={setup.id}
                    type="button"
                    onClick={() => scrollTo(index)}
                    className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-6 bg-amber-400" : "w-1.5 bg-slate-700 hover:bg-slate-500"}`}
                    aria-label={`Go to ${setup.name}`}
                  />
                )).slice(Math.max(0, Math.min(activeIndex - 2, active.length - 5)), Math.max(5, activeIndex + 3))}
              </div>
              <button type="button" onClick={onViewLibrary} className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 transition hover:text-amber-300">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/35 p-6 text-center">
            <ImagePlus className="mb-3 h-8 w-8 text-amber-400" />
            <h3 className="font-bold text-white">Your board is ready</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-400">Add a setup and upload your own chart. The board does not use fixed demo images.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setEditing("new")} className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-black text-slate-950">Add setup</button>
              <button type="button" onClick={restoreDefaults} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">Restore names</button>
            </div>
          </div>
        )}
      </section>

      {selected ? (
        <TradeSetupDetail
          setup={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onFavorite={() => toggleFavorite(selected)}
        />
      ) : null}

      {editing ? (
        <TradeSetupEditor
          setup={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={editing === "new" ? createSetup : replaceSetup}
        />
      ) : null}

      {showProcess ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Trading process tools">
          <section className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-[26px] border border-slate-700 bg-[#07101f] shadow-2xl sm:max-h-[90vh] sm:rounded-[26px]">
            <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3 sm:px-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">Execution discipline</p>
                <h2 className="text-lg font-black text-white">Rules, Checklist & Risk</h2>
              </div>
              <button type="button" onClick={() => setShowProcess(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-300 hover:text-white" aria-label="Close trading process tools">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="overflow-y-auto p-4 sm:p-6">
              <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
                <EntryChecklist />
                <RulesBoard rules={tradingRules} onChange={onTradingRulesChange} />
              </div>
              <div className="mt-4">
                <RiskManagementBoard />
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CompactSetupSlide({
  setup,
  onOpen,
  onEdit,
  onDeleteImage,
  onFavorite,
}: {
  setup: TradeSetup;
  onOpen: () => void;
  onEdit: () => void;
  onDeleteImage: () => void;
  onFavorite: () => void;
}) {
  const imageUrl = useResolvedImage(setup.coverImage ?? setup.images[0] ?? null);
  const entry = firstRule(setup, "entry", "Add your entry confirmation rule.");
  const stop = firstRule(setup, "stop_loss", "Add your stop-loss placement rule.");

  return (
    <article className="setup-board-slide min-w-full snap-center overflow-hidden rounded-[19px] border border-slate-700/70 bg-[#0a1425] shadow-[0_10px_28px_rgba(0,0,0,0.24)]">
      <div className="grid grid-cols-[118px_minmax(0,1fr)] sm:grid-cols-[minmax(210px,0.8fr)_minmax(0,1.2fr)]">
        <div className="group relative min-h-[178px] overflow-hidden border-r border-slate-800 bg-[#050c17] sm:min-h-[210px]">
          {imageUrl ? (
            <button type="button" onClick={onOpen} className="h-full w-full text-left" aria-label={`View ${setup.name} details`}>
              <img src={imageUrl} alt={`${setup.name} chart`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
            </button>
          ) : (
            <button type="button" onClick={onEdit} className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-slate-500 transition hover:bg-slate-900/60 hover:text-amber-300">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-900/75"><ImagePlus className="h-5 w-5" /></span>
              <span className="text-[10px] font-bold uppercase tracking-wider">Add chart</span>
            </button>
          )}

          <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1">
            <button type="button" onClick={onEdit} className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border border-white/10 bg-slate-950/85 px-2 text-[10px] font-bold text-white backdrop-blur transition hover:border-amber-400/50">
              {imageUrl ? <Pencil className="h-3 w-3" /> : <ImagePlus className="h-3 w-3" />}
              {imageUrl ? "Replace" : "Upload"}
            </button>
            {setup.coverImage ? (
              <button type="button" onClick={onDeleteImage} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-400/20 bg-slate-950/85 text-red-300 backdrop-blur transition hover:bg-red-400/15" aria-label="Delete cover image">
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-col p-3 sm:p-4">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap gap-1">
              <DirectionBadge direction={setup.direction} />
              <MetaBadge gold>{setup.quality}</MetaBadge>
              <span className="max-w-24 truncate rounded-full border border-slate-700 bg-slate-900/80 px-2 py-1 text-[9px] font-bold text-slate-400">{setup.category}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={onFavorite} className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition ${setup.isFavorite ? "border-amber-400/35 bg-amber-400/10 text-amber-300" : "border-slate-700 text-slate-500 hover:text-amber-300"}`} aria-label="Toggle favorite">
                <Star className={`h-3.5 w-3.5 ${setup.isFavorite ? "fill-current" : ""}`} />
              </button>
              <button type="button" onClick={onEdit} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-500 transition hover:text-white" aria-label="Edit setup">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <button type="button" onClick={onOpen} className="mt-2 min-w-0 text-left">
            <h3 className="truncate text-lg font-black leading-tight text-white sm:text-2xl">{setup.name}</h3>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">{setup.timeframe} · {setup.session}</p>
          </button>

          <div className="mt-auto hidden gap-2 pt-3 sm:grid sm:grid-cols-2">
            <RuleSummary label="Entry" text={entry} accent="emerald" />
            <RuleSummary label="Stop" text={stop} accent="red" />
          </div>

          <button type="button" onClick={onOpen} className="mt-auto inline-flex items-center gap-1 pt-2 text-[11px] font-black text-amber-300 sm:mt-2">
            View details <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 border-t border-slate-800 sm:hidden">
        <RuleSummary label="Entry" text={entry} accent="emerald" compact />
        <RuleSummary label="Stop" text={stop} accent="red" compact />
      </div>
    </article>
  );
}

function RuleSummary({ label, text, accent, compact = false }: { label: string; text: string; accent: "emerald" | "red"; compact?: boolean }) {
  return (
    <div className={`${compact ? "min-w-0 px-3 py-2.5 first:border-r first:border-slate-800" : "rounded-xl border border-slate-800 bg-slate-950/45 p-2.5"}`}>
      <p className={`text-[9px] font-black uppercase tracking-[0.17em] ${accent === "emerald" ? "text-emerald-400" : "text-red-400"}`}>{label}</p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-400 sm:text-[11px]">{text}</p>
    </div>
  );
}
