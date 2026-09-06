import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { refreshAttachmentUrl } from "../api";
import type { SetupDirection, SetupRuleType, TradeSetup, TradeSetupImage } from "./types";

export const boardButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-amber-400/30 hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60";
export const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300";

export function DirectionBadge({ direction }: { direction: SetupDirection }) {
  const tone = direction === "Buy" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : direction === "Sell" ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300";
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${tone}`}>{direction}</span>;
}

export function MetaBadge({ children, gold = false }: { children: React.ReactNode; gold?: boolean }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${gold ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>{children}</span>;
}

export function useResolvedImage(image: TradeSetupImage | null | undefined) {
  const [url, setUrl] = useState(image?.url ?? "");
  useEffect(() => {
    let active = true;
    setUrl(image?.url ?? "");
    if (image?.storagePath) {
      refreshAttachmentUrl(image.storagePath).then((next) => { if (active && next) setUrl(next); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [image?.storagePath, image?.url]);
  return url;
}

export function ResolvedImage({ image, alt, className = "" }: { image: TradeSetupImage | null | undefined; alt: string; className?: string }) {
  const url = useResolvedImage(image);
  return url
    ? <img src={url} alt={alt} className={className} />
    : <div role="img" aria-label={alt || "No setup image"} className={`flex items-center justify-center bg-[#050a13] text-slate-700 ${className}`}><ImageIcon size={18} /></div>;
}

export function SetupImage({ setup, className = "", onZoom }: { setup: TradeSetup; className?: string; onZoom?: () => void }) {
  const image = setup.coverImage ?? setup.images[0];
  const url = useResolvedImage(image);
  return (
    <button type="button" onClick={onZoom} disabled={!url || !onZoom} className={`relative block w-full overflow-hidden bg-[#050a13] text-left ${className}`}>
      {url ? <img src={url} alt={`${setup.name} chart example`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.015]" /> : (
        <div className="flex h-full min-h-52 flex-col items-center justify-center gap-2 text-slate-600"><ImageIcon size={28} /><span className="text-xs">Add a chart example</span></div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060b13]/45 via-transparent to-transparent" />
    </button>
  );
}

export function getRules(setup: TradeSetup, type: SetupRuleType, limit?: number) {
  const rules = setup.rules.filter((rule) => rule.type === type).sort((a, b) => a.sortOrder - b.sortOrder);
  return typeof limit === "number" ? rules.slice(0, limit) : rules;
}

export function RulePreview({ setup, type, label, tone = "amber" }: { setup: TradeSetup; type: SetupRuleType; label: string; tone?: "amber" | "emerald" | "rose" }) {
  const rules = getRules(setup, type, 2);
  if (!rules.length) return null;
  const dot = tone === "emerald" ? "bg-emerald-400" : tone === "rose" ? "bg-rose-400" : "bg-amber-400";
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <ul className="space-y-1.5">
        {rules.map((rule) => <li key={rule.id} className="flex gap-2 text-xs leading-5 text-slate-300"><span className={`mt-2 h-1 w-1 shrink-0 rounded-full ${dot}`} />{rule.content}</li>)}
      </ul>
    </div>
  );
}
