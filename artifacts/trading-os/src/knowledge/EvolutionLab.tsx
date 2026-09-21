import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BookOpen, BrainCircuit, Check, ChevronRight,
  Database, FileSearch, FlaskConical, GitBranch, History, Link2, LoaderCircle,
  RefreshCw, Search, ShieldCheck, Sparkles, TestTube2, Video, X,
} from "lucide-react";
import { AIButton, Panel } from "../onkar-ai/ui";
import {
  getKnowledgeDashboard, getKnowledgeDetail, retryKnowledgeJob, reviewKnowledge,
  saveLearningPreferences, searchKnowledge, syncKnowledge,
  type KnowledgeDashboard, type KnowledgeDetail, type KnowledgeItem,
} from "./api";
import "./knowledge.css";

type Props = { mode: "knowledge" | "evolution"; onOpenLibrary: () => void };
const safeText = (value: unknown, fallback = "—") => typeof value === "string" && value.trim() ? value : fallback;
const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const formatTime = (value: unknown) => typeof value === "string" && value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const labels: Record<string, string> = {
  libraryItems: "Library items learned", videosAnalyzed: "Videos analyzed", setupsUnderstood: "Setups understood",
  strategiesKnown: "Strategies known", rulesExtracted: "Rules extracted", verifiedRules: "Verified rules",
  needsReview: "Needs review", conflicts: "Conflicts", tradesLearnedFrom: "Trades learned from",
  mistakesDetected: "Mistakes detected", candidatesTesting: "Candidates testing", candidatesApproved: "Candidates approved",
  learningErrors: "Learning errors",
};
const preferenceLabels: Record<string, string> = {
  auto_analysis: "Automatic analysis", auto_library_learning: "Library learning", auto_video_analysis: "Video learning",
  auto_trade_learning: "Trade learning", auto_pattern_discovery: "Pattern discovery", auto_backtest: "Automatic backtesting",
  auto_replay: "Automatic replay", auto_shadow: "Automatic shadow testing", auto_forward: "Automatic forward testing",
};
const pipeline = ["Library", "Content analysis", "Knowledge extraction", "Knowledge graph", "Shared AI knowledge", "Market evidence", "Trade autopsy", "Pattern discovery", "Candidate", "Backtest", "Replay", "Shadow", "Forward", "Master AI review", "Human approval"];

function StatusPill({ value }: { value: unknown }) {
  const text = safeText(value, "UNKNOWN");
  const tone = /ERROR|FAILED|REJECT|CONFLICT/i.test(text) ? "danger" : /READY|VERIFIED|APPROVED|PASSED|ACTIVE/i.test(text) ? "success" : /REVIEW|TEST|PROCESS|RUNNING|QUEUE/i.test(text) ? "warning" : "neutral";
  return <span className={`ok-status ok-status-${tone}`}>{text.replaceAll("_", " ")}</span>;
}

function KnowledgeCard({ item, onOpen }: { item: KnowledgeItem; onOpen: (item: KnowledgeItem) => void }) {
  return <button className="ok-knowledge-card" onClick={() => onOpen(item)}>
    <span className="ok-kind">{item.kind === "VIDEO" ? <Video size={15} /> : item.kind === "RULE" ? <ShieldCheck size={15} /> : <BookOpen size={15} />}{item.kind.replaceAll("_", " ")}</span>
    <StatusPill value={item.status} />
    <strong>{item.title}</strong>
    <p>{item.summary}</p>
    <div className="ok-chip-row">{[...item.symbols, ...item.timeframes, ...item.tags].slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
    <footer><span>{Math.round(item.confidence)}% evidence confidence</span><span>{item.source_count} source · {item.evidence_count} evidence</span><ChevronRight size={15} /></footer>
  </button>;
}

export default function EvolutionLab({ mode, onOpenLibrary }: Props) {
  const [data, setData] = useState<KnowledgeDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeItem[] | null>(null);
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const load = useCallback(async () => {
    try { setData(await getKnowledgeDashboard()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Knowledge service unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visibleItems = results ?? data?.items ?? [];
  const learningActive = Boolean(data?.preferences?.auto_analysis && data?.preferences?.auto_library_learning);
  const today = useMemo(() => (data?.activity ?? []).filter((item) => typeof item.created_at === "string" && new Date(item.created_at).toDateString() === new Date().toDateString()), [data?.activity]);
  const sync = async () => {
    setBusy(true);
    try { await syncKnowledge(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Library synchronization failed."); }
    finally { setBusy(false); }
  };
  const search = async () => {
    if (query.trim().length < 2) { setResults(null); return; }
    setBusy(true);
    try { setResults((await searchKnowledge(query)).items); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Search failed."); }
    finally { setBusy(false); }
  };
  const open = async (item: KnowledgeItem) => {
    setDetail({ item, sources: [], links: [] });
    try { setDetail(await getKnowledgeDetail(item.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Knowledge provenance unavailable."); }
  };
  const review = async (action: "APPROVE" | "REJECT" | "TEST_FIRST") => {
    if (!detail) return;
    setBusy(true);
    try { await reviewKnowledge(detail.item.id, action); setDetail(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Review could not be saved."); }
    finally { setBusy(false); }
  };
  const togglePreference = async (key: string, value: boolean) => {
    if (!data) return;
    const next = { ...(data.preferences ?? {}), [key]: value };
    setData({ ...data, preferences: next });
    try { const saved = await saveLearningPreferences(next); setData((current) => current ? { ...current, preferences: saved } : current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Learning preference could not be saved."); await load(); }
  };
  if (loading) return <section className="ok-loading"><LoaderCircle size={28} /><strong>Connecting the Library brain…</strong><span>Loading only your stored knowledge and evidence.</span></section>;
  return <div className="ok-shell">
    <section className="ok-hero">
      <div className="ok-orb"><BrainCircuit size={34} /></div>
      <div><span className="oai-kicker">ONKAR AI / {mode === "knowledge" ? "KNOWLEDGE CENTER" : "EVOLUTION LAB"}</span><h2>{mode === "knowledge" ? "Your Library is the knowledge brain" : "Learning from every market. Improving through evidence."}</h2><p>{mode === "knowledge" ? "One processed source of truth for Master AI and every specialist—with provenance, confidence and review gates." : "Library theory is compared with backtest, replay, shadow, paper and live evidence without silently changing production rules."}</p></div>
      <div className="ok-hero-actions"><StatusPill value={learningActive ? "LEARNING ACTIVE" : "LEARNING PAUSED"} /><AIButton onClick={() => void sync()} disabled={busy}>{busy ? <LoaderCircle className="ok-spin" size={16} /> : <RefreshCw size={16} />}Sync Library</AIButton></div>
    </section>
    {error && <div className="ok-error"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
    <div className="ok-metrics">{Object.entries(data?.metrics ?? {}).map(([key, value]) => <article key={key}><span>{labels[key] ?? key.replaceAll(/([A-Z])/g, " $1")}</span><strong>{value}</strong><i className={/error|conflict/i.test(key) && value ? "danger" : ""} /></article>)}</div>

    {mode === "knowledge" ? <>
      <Panel title="Library Knowledge Search" kicker="VIDEOS · RULES · SETUPS · STRATEGIES · TRADE EVIDENCE" action={<button className="oai-text-button" onClick={onOpenLibrary}>Open original Library <ArrowRight size={14} /></button>}>
        <form className="ok-search" onSubmit={(event) => { event.preventDefault(); void search(); }}><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search 30M confirmation after demand zone…" aria-label="Search Library knowledge" /><button type="submit" disabled={busy}>Search</button>{results && <button type="button" onClick={() => { setResults(null); setQuery(""); }}>Clear</button>}</form>
        <div className="ok-card-grid">{visibleItems.map((item) => <KnowledgeCard key={item.id} item={item} onOpen={(selected) => void open(selected)} />)}</div>
        {!visibleItems.length && <div className="ok-empty"><FileSearch size={28} /><strong>No processed knowledge yet</strong><span>Add material to the Library or run Sync Library. The page never invents placeholder knowledge.</span></div>}
      </Panel>
      <div className="ok-two">
        <Panel title="Processing Queue" kicker="RETRYABLE INGESTION JOBS"><div className="ok-list">{(data?.jobs ?? []).slice(0, 8).map((job) => <article key={String(job.id)}><div><strong>{safeText(job.source_type)} · {safeText(job.source_id)}</strong><span>{safeText(job.last_error, formatTime(job.updated_at))}</span></div><StatusPill value={job.stage} />{job.stage === "PROCESSING_FAILED" && <button onClick={() => void retryKnowledgeJob(String(job.id)).then(load)}>Retry</button>}</article>)}{!data?.jobs.length && <span className="ok-muted">No queued Library jobs.</span>}</div></Panel>
        <Panel title="Knowledge Conflicts" kicker="NEVER SILENTLY MERGED"><div className="ok-list">{(data?.conflicts ?? []).slice(0, 8).map((conflict) => <article key={String(conflict.id)}><div><strong>{safeText(conflict.description)}</strong><span>{safeText(conflict.recommendation)}</span></div><StatusPill value={conflict.status} /></article>)}{!data?.conflicts.length && <span className="ok-muted">No source conflicts detected.</span>}</div></Panel>
      </div>
    </> : <>
      <Panel title="Self-Learning Status" kicker="SAFE AUTOMATION PERMISSIONS"><div className="ok-preferences">{Object.entries(preferenceLabels).map(([key, label]) => <label key={key}><span><strong>{label}</strong><small>{key.includes("backtest") || key.includes("replay") || key.includes("shadow") || key.includes("forward") ? "Evidence generation only" : "Uses shared Library knowledge"}</small></span><input type="checkbox" checked={Boolean(data?.preferences?.[key])} onChange={(event) => void togglePreference(key, event.target.checked)} /></label>)}<label className="locked"><span><strong>Automatic live rule changes</strong><small>Safety lock · human approval required</small></span><input type="checkbox" checked={false} disabled /></label><label className="locked"><span><strong>Automatic strategy promotion</strong><small>Safety lock · human approval required</small></span><input type="checkbox" checked={false} disabled /></label></div></Panel>
      <Panel title="Complete Learning Pipeline" kicker="ONE SHARED KNOWLEDGE AND EVIDENCE FLOW"><div className="ok-pipeline">{pipeline.map((step, index) => <div key={step}><span>{index + 1}</span><strong>{step}</strong>{index < pipeline.length - 1 && <ArrowRight size={14} />}</div>)}</div></Panel>
      <div className="ok-two">
        <Panel title="What Onkar AI learned today" kicker={`${today.length} AUDITED EVENTS`}><div className="ok-timeline">{today.slice(0, 10).map((event) => <article key={String(event.id)}><i /><time>{formatTime(event.created_at)}</time><div><strong>{safeText(event.title)}</strong><span>{safeText(event.agent)} · {safeText(event.event_type)}</span></div></article>)}{!today.length && <span className="ok-muted">No completed learning events today.</span>}</div></Panel>
        <Panel title="Mistake Memory" kicker="BEHAVIORAL EVIDENCE · NOT RULE MUTATION"><div className="ok-list">{(data?.mistakes ?? []).slice(0, 8).map((mistake) => <article key={String(mistake.id)}><div><strong>{safeText(mistake.title)}</strong><span>{asNumber(mistake.occurrences)} occurrences · {asNumber(mistake.total_effect_r).toFixed(2)}R effect · {safeText(mistake.most_common_symbol)}</span></div><StatusPill value={mistake.trend} /></article>)}{!data?.mistakes.length && <span className="ok-muted">No repeated mistakes with stored evidence.</span>}</div></Panel>
      </div>
      <div className="ok-two">
        <Panel title="Strategy Candidates" kicker="ISOLATED FROM LIVE EXECUTION"><div className="ok-list">{(data?.candidates ?? []).map((candidate) => <article key={String(candidate.id)}><div><strong>{safeText(candidate.name)}</strong><span>{safeText(candidate.rationale)} · evidence {safeText(candidate.evidence_strength)}</span></div><StatusPill value={candidate.status} /></article>)}{!data?.candidates.length && <span className="ok-muted">No evidence-qualified candidate has been created. Onkar AI will not generate random strategies.</span>}</div></Panel>
        <Panel title="Trade Autopsies" kicker="LIBRARY THEORY VS REAL RESULTS"><div className="ok-list">{(data?.autopsies ?? []).slice(0, 8).map((autopsy) => <article key={String(autopsy.id)}><div><strong>{safeText(autopsy.trade_id)} · {safeText((autopsy.market_context as Record<string, unknown> | undefined)?.symbol)}</strong><span>{safeText((autopsy.result as Record<string, unknown> | undefined)?.outcome)} · strategy change {safeText(autopsy.strategy_change_needed)}</span></div><StatusPill value={autopsy.classification} /></article>)}{!data?.autopsies.length && <span className="ok-muted">Closed, finalized trades will appear after Journal AI review.</span>}</div></Panel>
      </div>
      <Panel title="Strategy Evolution Tree" kicker="IMMUTABLE VERSIONS · REVERSIBLE DEPLOYMENT"><div className="ok-evolution-empty"><GitBranch size={30} /><div><strong>Current Setup Library versions remain authoritative</strong><span>Candidate branches appear only after source evidence and tests exist. No existing setup is overwritten.</span></div></div></Panel>
    </>}

    {detail && <div className="ok-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><aside className="ok-drawer" role="dialog" aria-modal="true" aria-label="Knowledge provenance"><header><div><span className="oai-kicker">SOURCE PROVENANCE</span><h3>{detail.item.title}</h3></div><button onClick={() => setDetail(null)} aria-label="Close"><X size={19} /></button></header><StatusPill value={detail.item.status} /><p>{detail.item.summary}</p><section><h4>Why Onkar AI knows this</h4>{detail.sources.map((source) => <article key={String(source.id)}><Link2 size={15} /><div><strong>{safeText(source.source_title)}</strong><span>{safeText(source.source_type)}{source.start_seconds != null ? ` · ${Math.floor(asNumber(source.start_seconds) / 60)}:${String(Math.floor(asNumber(source.start_seconds) % 60)).padStart(2, "0")}` : ""} · {Math.round(asNumber(source.confidence))}% confidence</span></div></article>)}{!detail.sources.length && <span className="ok-muted">Loading provenance…</span>}</section><section><h4>Production authority</h4><p>{detail.item.may_influence_production ? "Human verified and eligible to support production decisions." : "Review-only. It cannot unlock or change a live trade."}</p></section>{!detail.item.human_verified && detail.item.status !== "REJECTED" && <footer><button onClick={() => void review("REJECT")} disabled={busy}>Reject</button><button onClick={() => void review("TEST_FIRST")} disabled={busy}>Test first</button><button className="primary" onClick={() => void review("APPROVE")} disabled={busy}><Check size={15} />Approve knowledge</button></footer>}</aside></div>}
  </div>;
}
