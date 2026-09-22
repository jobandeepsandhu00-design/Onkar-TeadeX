import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, Bell, Bot, Check, ChevronDown, ChevronRight, CircleAlert,
  Search, Settings2, ShieldAlert, Trash2, Volume2, X,
} from "lucide-react";
import type { NotificationPreferences, OnkarNotification } from "@workspace/api-zod";
import { brainRequest } from "../market-brain/api";
import { supabase } from "../api";
import { agentVoice } from "../onkar-ai/agent-voice";

type InboxResponse = { items: OnkarNotification[]; preferences: NotificationPreferences };
type Props = { onNavigate?: (path: string) => void; compact?: boolean };
const categories = ["ALL", "CRITICAL", "TRADING", "SETUPS", "AI", "RISK", "NEWS", "SYSTEM"] as const;
const priorityStyle: Record<string, string> = {
  INFO: "border-sky-400/20 bg-sky-400/[0.05] text-sky-300",
  IMPORTANT: "border-amber-400/25 bg-amber-400/[0.06] text-amber-300",
  HIGH: "border-orange-400/30 bg-orange-400/[0.07] text-orange-300",
  CRITICAL: "border-rose-400/35 bg-rose-400/[0.09] text-rose-300",
};
const defaultPreferences: NotificationPreferences = {
  channels: {}, category_overrides: {}, voice_enabled: true, voice_volume: 0.8,
  push_enabled: false, sound_enabled: true,
};

function age(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Date(value).toLocaleDateString();
}

async function state(id: string, action: "READ" | "ACKNOWLEDGE" | "VOICE_SPOKEN" | "PUSH_SENT") {
  return brainRequest(`/notifications/${id}/state`, "POST", { action });
}

async function browserNotify(item: OnkarNotification) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const options: NotificationOptions = {
    body: item.message,
    tag: item.event_key,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { href: item.actions[0]?.href || "/onkar-ai/scanner" },
  };
  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  if (registration) await registration.showNotification(item.title, options);
  else new Notification(item.title, options);
  return true;
}

function useNotificationInboxInternal() {
  const [items, setItems] = useState<OnkarNotification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const delivered = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    try {
      const result = await brainRequest<InboxResponse>("/notifications?limit=100");
      setItems(result.items);
      setPreferences({ ...defaultPreferences, ...result.preferences });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Notifications unavailable.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const subscribe = (userId: string) => {
      if (channel) void supabase.removeChannel(channel);
      channel = supabase.channel(`notifications:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void refresh())
        .subscribe();
    };
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { setLoading(false); return; }
      void refresh();
      subscribe(data.user.id);
    });
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setItems([]);
        if (channel) void supabase.removeChannel(channel);
        channel = null;
        return;
      }
      void refresh();
      subscribe(session.user.id);
    });
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("online", focus);
    return () => {
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("online", focus);
      if (channel) void supabase.removeChannel(channel);
      auth.subscription.unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    agentVoice.initialize();
    agentVoice.configure({ enabled: preferences.voice_enabled, volume: preferences.voice_volume });
    for (const item of items) {
      if (["INVALIDATED", "EXPIRED", "RESOLVED"].includes(item.status)) {
        if (item.setup_id) agentVoice.cancelAlert(item.setup_id);
        continue;
      }
      if (item.read_at || delivered.current.has(item.id) || Date.now() - Date.parse(item.updated_at) > 120_000) continue;
      delivered.current.add(item.id);
      const voiceEligible = Boolean(item.metadata.voiceEligible) && (item.priority === "HIGH" || item.priority === "CRITICAL");
      const categoryPreference = preferences.category_overrides[item.category] ?? {};
      const priorityPreference = preferences.channels[item.priority] ?? {};
      const voiceAllowed = categoryPreference.voice ?? priorityPreference.voice ?? (item.priority === "HIGH" || item.priority === "CRITICAL");
      const pushAllowed = categoryPreference.push ?? priorityPreference.push ?? (item.priority === "HIGH" || item.priority === "CRITICAL");
      if (voiceEligible && voiceAllowed && preferences.voice_enabled && !item.voice_spoken_at) {
        agentVoice.enqueueAlert({
          key: `${item.event_key}:${item.updated_at}`,
          candidateId: item.setup_id || item.id,
          text: `Boss, ${item.title}. ${item.message}`,
          priority: item.priority === "CRITICAL" ? 100 : 70,
          expiresAt: Math.min(Date.parse(item.updated_at) + 120_000, item.expires_at ? Date.parse(item.expires_at) : Infinity),
          onSpoken: () => { void state(item.id, "VOICE_SPOKEN").catch(() => undefined); },
        });
      }
      if (preferences.push_enabled && pushAllowed && !item.push_sent_at && item.priority !== "INFO") {
        void browserNotify(item).then((sent) => sent && state(item.id, "PUSH_SENT"));
      }
    }
  }, [items, preferences.push_enabled, preferences.voice_enabled, preferences.voice_volume]);

  const savePreferences = useCallback(async (next: NotificationPreferences) => {
    setPreferences(next);
    await brainRequest("/notification-preferences", "PUT", next);
  }, []);
  return { items, setItems, preferences, savePreferences, loading, error, refresh };
}

type Inbox = ReturnType<typeof useNotificationInboxInternal>;
const NotificationContext = createContext<Inbox | null>(null);
export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const inbox = useNotificationInboxInternal();
  return <NotificationContext.Provider value={inbox}>{children}</NotificationContext.Provider>;
}
export function useNotificationInbox() {
  const inbox = useContext(NotificationContext);
  if (!inbox) throw new Error("NotificationCenterProvider is required.");
  return inbox;
}

function Attention({ items, onAsk }: { items: OnkarNotification[]; onAsk(): void }) {
  const active = items.filter((item) => item.status === "ACTIVE");
  const count = (test: (item: OnkarNotification) => boolean) => active.filter(test).length;
  const facts = [
    [count((n) => n.priority === "CRITICAL"), "Critical"],
    [count((n) => n.lifecycle_state === "READY"), "Confirmed"],
    [count((n) => n.lifecycle_state === "WAITING_CLOSE"), "Waiting close"],
    [count((n) => n.lifecycle_state === "ACTIVE"), "Active trades"],
    [count((n) => n.category === "RISK"), "Risk warnings"],
  ].filter(([value]) => Number(value) > 0);
  return <section className="rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.08] via-slate-950 to-violet-500/[0.07] p-4">
    <div className="flex items-center gap-2 text-[10px] font-black tracking-[0.2em] text-cyan-300"><Bot size={15} /> ONKAR AI — NEEDS YOUR ATTENTION</div>
    <div className="mt-3 flex flex-wrap gap-2">{facts.length ? facts.map(([value, label]) => <span key={String(label)} className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-300"><b className="text-white">{value}</b> {label}</span>) : <span className="text-xs text-slate-500">No active issues require action.</span>}</div>
    <button onClick={onAsk} className="mt-3 w-full rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-[11px] font-bold text-cyan-200">Ask Master AI about these alerts</button>
  </section>;
}

function NotificationCard({ item, onNavigate, onRefresh }: { item: OnkarNotification; onNavigate?(path: string): void; onRefresh(): void }) {
  const [expanded, setExpanded] = useState(false);
  const [timeline, setTimeline] = useState<Array<Record<string, unknown>>>([]);
  const open = async () => {
    setExpanded((value) => !value);
    if (!item.read_at) await state(item.id, "READ");
    if (!timeline.length) {
      const response = await brainRequest<{ items: Array<Record<string, unknown>> }>(`/notifications/${item.id}/events`);
      setTimeline(response.items);
    }
    onRefresh();
  };
  return <article className={`rounded-2xl border p-3 transition ${priorityStyle[item.priority]} ${item.read_at ? "opacity-75" : "shadow-[0_0_24px_rgba(34,211,238,0.05)]"}`}>
    <button className="w-full text-left" onClick={() => void open()}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{item.priority === "CRITICAL" ? <CircleAlert size={18} /> : item.category === "RISK" ? <ShieldAlert size={18} /> : <Bell size={18} />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-[9px] font-black tracking-[0.13em]"><b>{item.priority}</b><i className="not-italic text-slate-500">{item.category}</i>{item.lifecycle_state && <i className="rounded bg-black/20 px-1.5 py-0.5 not-italic">{item.lifecycle_state.replaceAll("_", " ")}</i>}</span>
          <strong className="mt-1 block text-sm leading-snug text-slate-100">{item.title}</strong>
          <span className="mt-1 block text-xs leading-relaxed text-slate-400">{item.message}</span>
          <span className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500"><b>{item.agent_source.replaceAll("_", " ")}</b>{item.symbol && <span>{item.symbol}</span>}{item.timeframe && <span>{item.timeframe}</span>}<span>{age(item.updated_at)}</span></span>
        </span>
        <ChevronDown size={16} className={`shrink-0 transition ${expanded ? "rotate-180" : ""}`} />
      </div>
    </button>
    {expanded && <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
      {item.recommended_action && <p className="rounded-xl bg-black/20 p-2.5 text-xs text-slate-300"><b className="text-cyan-300">Next:</b> {item.recommended_action}</p>}
      {item.evidence.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{item.evidence.map((evidence, index) => <div key={index} className="rounded-xl border border-white/5 bg-black/15 p-2 text-[10px] text-slate-400"><b className="text-slate-200">{String(evidence.agent || "SYSTEM").replaceAll("_", " ")}</b><p className="mt-1 break-words">{Object.entries(evidence).filter(([key]) => key !== "agent").map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ")}</p></div>)}</div>}
      {timeline.length > 0 && <div><h4 className="mb-2 text-[10px] font-black tracking-widest text-slate-500">ALERT TIMELINE</h4><div className="space-y-2 border-l border-cyan-400/20 pl-3">{timeline.slice(0, 12).map((event) => <div key={String(event.id)} className="text-[10px] text-slate-400"><b className="text-slate-200">{new Date(String(event.created_at)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b> — {String(event.lifecycle_state || event.title)}</div>)}</div></div>}
      <div className="flex flex-wrap gap-2">{item.actions.map((action) => <button key={action.id} onClick={() => action.href && onNavigate?.(action.href)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-slate-200">{action.label}</button>)}{item.priority === "CRITICAL" && !item.acknowledged_at && <button onClick={() => void state(item.id, "ACKNOWLEDGE").then(onRefresh)} className="rounded-lg bg-rose-500/15 px-3 py-2 text-[11px] font-bold text-rose-200"><Check size={13} className="mr-1 inline" />Acknowledge</button>}</div>
    </div>}
  </article>;
}

export function NotificationCenterBell({ onNavigate, compact = false }: Props) {
  const inbox = useNotificationInbox();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("onkar-open-notifications", show);
    return () => window.removeEventListener("onkar-open-notifications", show);
  }, []);
  const [filter, setFilter] = useState<(typeof categories)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [symbol, setSymbol] = useState("ALL");
  const [timeframe, setTimeframe] = useState("ALL");
  const [agent, setAgent] = useState("ALL");
  const [setup, setSetup] = useState("ALL");
  const [date, setDate] = useState("");
  const [settings, setSettings] = useState(false);
  const unread = inbox.items.filter((item) => !item.read_at).length;
  const critical = inbox.items.some((item) => item.priority === "CRITICAL" && !item.acknowledged_at && item.status === "ACTIVE");
  const symbols = [...new Set(inbox.items.map((item) => item.symbol).filter(Boolean))] as string[];
  const timeframes = [...new Set(inbox.items.map((item) => item.timeframe).filter(Boolean))] as string[];
  const agents = [...new Set(inbox.items.map((item) => item.agent_source).filter(Boolean))];
  const setups = [...new Set(inbox.items.map((item) => item.setup_id).filter(Boolean))] as string[];
  const filtered = inbox.items.filter((item) => {
    if (item.priority !== "CRITICAL" && inbox.preferences.category_overrides[item.category]?.inApp === false) return false;
    if (filter === "CRITICAL" && item.priority !== "CRITICAL") return false;
    if (!["ALL", "CRITICAL"].includes(filter) && item.category !== filter) return false;
    if (symbol !== "ALL" && item.symbol !== symbol) return false;
    if (timeframe !== "ALL" && item.timeframe !== timeframe) return false;
    if (agent !== "ALL" && item.agent_source !== agent) return false;
    if (setup !== "ALL" && item.setup_id !== setup) return false;
    if (date && item.updated_at.slice(0, 10) !== date) return false;
    const haystack = `${item.title} ${item.message} ${item.symbol} ${item.timeframe} ${item.agent_source}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }).sort((a, b) => {
    const pinnedA = a.priority === "CRITICAL" && !a.acknowledged_at && a.status === "ACTIVE" ? 1 : 0;
    const pinnedB = b.priority === "CRITICAL" && !b.acknowledged_at && b.status === "ACTIVE" ? 1 : 0;
    return pinnedB - pinnedA || b.updated_at.localeCompare(a.updated_at);
  });
  const navigate = (path: string) => { setOpen(false); onNavigate?.(path); };
  const ask = () => {
    const ids = inbox.items.filter((item) => item.status === "ACTIVE").slice(0, 10).map((item) => item.id).join(",");
    navigate(`/onkar-ai/assistant?alerts=${encodeURIComponent(ids)}`);
  };
  const updatePreference = async (patch: Partial<NotificationPreferences>) => inbox.savePreferences({ ...inbox.preferences, ...patch });
  const updateCategory = async (category: string, channel: "inApp" | "push" | "voice", enabled: boolean) => updatePreference({
    category_overrides: {
      ...inbox.preferences.category_overrides,
      [category]: { ...(inbox.preferences.category_overrides[category] ?? {}), [channel]: enabled },
    },
  });
  return <>
    <button onClick={() => setOpen(true)} aria-label={`Open notifications, ${unread} unread`} className={`relative grid h-9 w-9 place-items-center rounded-xl border bg-slate-900 text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-200 ${critical ? "animate-pulse border-rose-400/50" : "border-slate-800"}`}>
      <Bell size={compact ? 17 : 18} />{unread > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-cyan-400 px-1 text-center text-[9px] font-black leading-4 text-slate-950">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <div className="fixed inset-0 z-[1200] flex justify-end bg-black/65 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <aside className="flex h-[100dvh] w-full max-w-[520px] flex-col border-l border-cyan-400/15 bg-[#06101f] shadow-[-30px_0_80px_rgba(0,0,0,.6)]">
        <header className="shrink-0 border-b border-white/10 p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
          <div className="flex items-center justify-between"><div><div className="text-[10px] font-black tracking-[0.2em] text-cyan-300">ONKARTRADEX</div><h2 className="text-lg font-black text-white">Notification Center</h2><p className="text-[11px] text-slate-500">{unread} unread · real scanner and execution events</p></div><div className="flex gap-2"><button onClick={() => setSettings(!settings)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-400"><Settings2 size={17} /></button><button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-400"><X size={18} /></button></div></div>
          {settings ? <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
            <label className="flex items-center justify-between text-xs text-slate-300"><span><Volume2 size={15} className="mr-2 inline" />Master AI voice</span><input type="checkbox" checked={inbox.preferences.voice_enabled} onChange={(event) => void updatePreference({ voice_enabled: event.target.checked })} /></label>
            <label className="flex items-center gap-3 text-xs text-slate-300">Volume <input className="flex-1 accent-cyan-400" type="range" min="0" max="1" step="0.1" value={inbox.preferences.voice_volume} onChange={(event) => void updatePreference({ voice_volume: Number(event.target.value) })} /></label>
            <label className="flex items-center justify-between text-xs text-slate-300"><span>Browser / PWA push</span><input type="checkbox" checked={inbox.preferences.push_enabled} onChange={async (event) => { const enable = event.target.checked; if (enable && "Notification" in window && await Notification.requestPermission() !== "granted") return; await updatePreference({ push_enabled: enable }); }} /></label>
            <div className="border-t border-white/10 pt-3"><div className="mb-2 grid grid-cols-[1fr_repeat(3,42px)] gap-2 text-[9px] font-black tracking-wider text-slate-600"><span>CATEGORY</span><span>APP</span><span>PUSH</span><span>VOICE</span></div>{["SETUPS", "TRADING", "RISK", "NEWS", "AI", "SYSTEM"].map((category) => { const value = inbox.preferences.category_overrides[category] ?? {}; return <div key={category} className="grid grid-cols-[1fr_repeat(3,42px)] items-center gap-2 border-t border-white/5 py-2 text-[10px] text-slate-300"><b>{category}</b>{(["inApp", "push", "voice"] as const).map((channel) => <input key={channel} aria-label={`${category} ${channel}`} type="checkbox" checked={value[channel] ?? (channel === "inApp")} onChange={(event) => void updateCategory(category, channel, event.target.checked)} />)}</div>; })}</div>
            <p className="text-[10px] leading-relaxed text-slate-500">Voice is limited to confirmed trades, execution, major invalidation, risk and system failures. Normal scanning remains silent.</p>
          </div> : <>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{categories.map((category) => <button key={category} onClick={() => setFilter(category)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-bold ${filter === category ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-200" : "border-white/10 text-slate-500"}`}>{category}</button>)}</div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3"><Search size={15} className="text-slate-600" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search alerts…" className="min-w-0 flex-1 bg-transparent py-2.5 text-xs text-white outline-none" /></label><select aria-label="Filter by pair" value={symbol} onChange={(event) => setSymbol(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-2 text-xs text-slate-300"><option>ALL</option>{symbols.map((item) => <option key={item}>{item}</option>)}</select></div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><select aria-label="Filter by timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value)} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-2 py-2 text-[10px] text-slate-300"><option value="ALL">All timeframes</option>{timeframes.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter by AI agent" value={agent} onChange={(event) => setAgent(event.target.value)} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-2 py-2 text-[10px] text-slate-300"><option value="ALL">All agents</option>{agents.map((item) => <option key={item}>{item.replaceAll("_", " ")}</option>)}</select><select aria-label="Filter by setup" value={setup} onChange={(event) => setSetup(event.target.value)} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-2 py-2 text-[10px] text-slate-300"><option value="ALL">All setups</option>{setups.map((item) => <option key={item} value={item}>{inbox.items.find((entry) => entry.setup_id === item)?.title.split(" · ")[1] || item.slice(0, 8)}</option>)}</select><input aria-label="Filter by date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-2 py-2 text-[10px] text-slate-300" /></div>
          </>}
        </header>
        <main className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"><Attention items={inbox.items} onAsk={ask} />{inbox.error && <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-300"><AlertTriangle size={15} className="mr-2 inline" />{inbox.error}</div>}{inbox.loading ? <div className="py-16 text-center text-xs text-slate-500">Connecting to notification service…</div> : filtered.length ? filtered.map((item) => <NotificationCard key={item.id} item={item} onNavigate={navigate} onRefresh={inbox.refresh} />) : <div className="py-16 text-center"><Bell size={28} className="mx-auto text-slate-700" /><p className="mt-3 text-sm text-slate-400">No matching real alerts</p></div>}</main>
        <footer className="flex shrink-0 items-center justify-between border-t border-white/10 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] text-[11px]"><button onClick={() => void brainRequest("/notifications/actions/read-all", "POST", {}).then(inbox.refresh)} className="text-cyan-300"><Check size={13} className="mr-1 inline" />Mark all read</button><button onClick={() => { if (window.confirm("Delete every notification and its timeline history? This cannot be undone.")) void brainRequest("/notifications", "DELETE").then(inbox.refresh); }} className="text-rose-300"><Trash2 size={13} className="mr-1 inline" />Delete all</button></footer>
      </aside>
    </div>}
  </>;
}

export function RecentAlertsWidget({ onNavigate }: Props) {
  const inbox = useNotificationInbox();
  const items = inbox.items.filter((item) => item.status === "ACTIVE").slice(0, 5);
  return <section className="rounded-2xl border border-cyan-400/15 bg-[#071426] p-4 shadow-2xl shadow-black/30">
    <div className="mb-3 flex items-center justify-between"><div><span className="text-[9px] font-black tracking-[0.2em] text-cyan-300">LIVE EVENT STREAM</span><h3 className="text-base font-black text-white">Recent Alerts</h3></div><NotificationCenterBell onNavigate={onNavigate} compact /></div>
    <div className="space-y-1">{items.length ? items.map((item) => <button key={item.id} onClick={() => item.actions[0]?.href && onNavigate?.(item.actions[0].href)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.035]"><span className={`h-2 w-2 shrink-0 rounded-full ${item.priority === "CRITICAL" ? "bg-rose-400" : item.priority === "HIGH" ? "bg-orange-400" : "bg-cyan-400"}`} /><span className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-200">{item.title}</b><small className="text-[10px] text-slate-500">{item.lifecycle_state?.replaceAll("_", " ") || item.category} · {age(item.updated_at)}</small></span><ChevronRight size={14} className="text-slate-600" /></button>) : <p className="py-6 text-center text-xs text-slate-500">No real scanner alerts yet.</p>}</div>
  </section>;
}
