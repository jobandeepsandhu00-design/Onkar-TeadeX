import { Clock3, Heart, Maximize2, Pencil, Star } from "lucide-react";
import type { TradeSetup } from "./types";
import { DirectionBadge, MetaBadge, RulePreview, SetupImage } from "./shared";

interface Props {
  setup: TradeSetup;
  onOpen: (setup: TradeSetup) => void;
  onFavorite?: (setup: TradeSetup) => void;
  onEdit?: (setup: TradeSetup) => void;
  compact?: boolean;
}

export function TradeSetupCard({ setup, onOpen, onFavorite, onEdit, compact = false }: Props) {
  return (
    <article className="group flex h-full min-h-[520px] flex-col overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0a1220]/95 shadow-[0_24px_70px_rgba(0,0,0,.34)] transition duration-300 hover:-translate-y-1 hover:border-amber-300/25 hover:shadow-[0_28px_80px_rgba(0,0,0,.48)]">
      <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2"><DirectionBadge direction={setup.direction} /><MetaBadge gold>{setup.quality}</MetaBadge><MetaBadge>{setup.category}</MetaBadge></div>
          <button type="button" onClick={() => onOpen(setup)} className="line-clamp-2 text-left font-[Sora] text-xl font-extrabold leading-tight text-white transition hover:text-amber-200">{setup.name}</button>
          <div className="mt-2 flex items-center gap-3 text-[11px] font-medium text-slate-500"><span>{setup.timeframe === "Custom" ? setup.customTimeframe || "Custom" : setup.timeframe}</span><span className="h-1 w-1 rounded-full bg-slate-700" /><span className="inline-flex items-center gap-1"><Clock3 size={11} />{setup.session}</span></div>
        </div>
        <div className="flex shrink-0 gap-1">
          {onFavorite && <button type="button" aria-label={setup.isFavorite ? "Remove favorite" : "Add favorite"} onClick={() => onFavorite(setup)} className="rounded-xl border border-white/10 bg-black/20 p-2 text-slate-500 transition hover:text-amber-300">{setup.isFavorite ? <Star size={15} className="fill-amber-300 text-amber-300" /> : <Heart size={15} />}</button>}
          {onEdit && <button type="button" aria-label="Edit setup" onClick={() => onEdit(setup)} className="rounded-xl border border-white/10 bg-black/20 p-2 text-slate-500 transition hover:text-white"><Pencil size={15} /></button>}
        </div>
      </div>

      <SetupImage setup={setup} onZoom={() => onOpen(setup)} className={compact ? "h-52" : "aspect-video min-h-[230px]"} />

      <div className="flex flex-1 flex-col p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <RulePreview setup={setup} type="entry" label="Entry" tone="emerald" />
          <RulePreview setup={setup} type="stop_loss" label="Stop Loss" tone="rose" />
        </div>
        {!compact && <div className="mt-4 border-t border-white/[0.06] pt-4"><RulePreview setup={setup} type="condition" label="Conditions" /></div>}
        <button type="button" onClick={() => onOpen(setup)} className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs font-bold text-slate-400 transition hover:text-amber-300"><span>Study full playbook</span><Maximize2 size={14} /></button>
      </div>
    </article>
  );
}

