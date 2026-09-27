import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, BookMarked, BookOpen, ChevronLeft, ChevronRight, Code2, Copy,
  Database, ExternalLink, Filter, Gauge, Layers3, Maximize2, RefreshCw, Save,
  Search, Settings2, ShieldCheck, Sparkles, Square, TriangleAlert, Wifi, WifiOff, X,
} from "lucide-react";
import { luxRequest } from "./api";
import "./luxalgo.css";

type Json = Record<string, any>;
type Tab = "OVERVIEW" | "LIBRARY" | "PRICE ACTION" | "MARKET STRUCTURE" | "LIQUIDITY" | "SUPPORT & RESISTANCE" | "FVG / IMBALANCE" | "ORDER BLOCKS" | "INDICATORS" | "SOURCE CODE" | "EDGE STATS" | "SAVED RESEARCH" | "SYNC STATUS" | "SETTINGS";
const tabs: Tab[] = ["OVERVIEW", "LIBRARY", "PRICE ACTION", "MARKET STRUCTURE", "LIQUIDITY", "SUPPORT & RESISTANCE", "FVG / IMBALANCE", "ORDER BLOCKS", "INDICATORS", "SOURCE CODE", "EDGE STATS", "SAVED RESEARCH", "SYNC STATUS", "SETTINGS"];
const quick = ["Liquidity Sweep", "BOS", "CHoCH", "MSS", "Fair Value Gap", "Order Block", "Breakout", "Fakeout", "Support Resistance", "ATR", "Volatility"];
const tabQuery: Partial<Record<Tab, string>> = { "PRICE ACTION": "price action", "MARKET STRUCTURE": "market structure", LIQUIDITY: "liquidity sweep", "SUPPORT & RESISTANCE": "support resistance", "FVG / IMBALANCE": "fair value gap imbalance", "ORDER BLOCKS": "order blocks" };
const asArray = (value: unknown) => Array.isArray(value) ? value : [];
const officialUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && /(^|\.)luxalgo\.com$/i.test(url.hostname) ? url.toString() : null; }
  catch { return null; }
};
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function MarkdownText({ value }: { value?: string }) {
  if (!value) return <p className="lux-muted">This section was not included in the imported MCP response.</p>;
  return <div className="lux-markdown">{value.split(/\n/).map((line, index) => {
    const clean = line.trim();
    if (!clean) return <br key={index} />;
    const heading = clean.match(/^(#{1,4})\s+(.+)/);
    if (heading) {
      if (heading[1].length === 1) return <h2 key={index}>{heading[2]}</h2>;
      if (heading[1].length === 2) return <h3 key={index}>{heading[2]}</h3>;
      return <h4 key={index}>{heading[2]}</h4>;
    }
    if (/^[-*]\s/.test(clean)) return <li key={index}>{clean.replace(/^[-*]\s*/, "")}</li>;
    return <p key={index}>{clean}</p>;
  })}</div>;
}

function PineLine({ line }: { line: string }) {
  const parts = line.split(/(\/\/.*$|"(?:[^"\\]|\\.)*"|\b(?:indicator|strategy|input|if|else|var|float|int|bool|string|for|to|and|or|not|true|false|na)\b|\b\d+(?:\.\d+)?\b)/g);
  return <>{parts.map((part, index) => {
    const tone = part.startsWith("//") ? "comment" : part.startsWith('"') ? "string" : /^(?:indicator|strategy|input|if|else|var|float|int|bool|string|for|to|and|or|not|true|false|na)$/.test(part) ? "keyword" : /^\d/.test(part) ? "number" : "";
    return tone ? <span className={`lux-code-${tone}`} key={index}>{part}</span> : part;
  })}</>;
}

export default function LuxAlgoResearchCenter({ onBack, onAskMaster }: { onBack: () => void; onAskMaster: (prompt?: string) => void }) {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [overview, setOverview] = useState<Json | null>(null);
  const [health, setHealth] = useState<Json | null>(null);
  const [sync, setSync] = useState<Json | null>(null);
  const [database, setDatabase] = useState<Json>({});
  const [results, setResults] = useState<Json[]>([]);
  const [families, setFamilies] = useState<Json[]>([]);
  const [tags, setTags] = useState<Json[]>([]);
  const [selected, setSelected] = useState<Json | null>(null);
  const [selectedType, setSelectedType] = useState<"concept" | "indicator" | null>(null);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState<"concepts" | "indicators">("concepts");
  const [sourceOnly, setSourceOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [platform, setPlatform] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("name");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [source, setSource] = useState<Json | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceFullscreen, setSourceFullscreen] = useState(false);
  const [saved, setSaved] = useState<Json[]>([]);
  const [history, setHistory] = useState<Json[]>([]);
  const [edge, setEdge] = useState<Json>({ symbols: [], presets: [], report: null });
  const syncLoop = useRef(false);
  const [settings, setSettings] = useState<Json>({ enabled: true, cache_enabled: true, manual_sync_enabled: true, cache_duration_minutes: 360, allow_master_ai: true, allow_trend_ai: true, allow_zone_ai: true, allow_setup_ai: true, allow_backtest_ai: true, allow_insight_ai: true, edge_stats_enabled: true, saved_research_enabled: true, save_raw_responses: true, save_public_source_code: true, preserve_attribution: true, preserve_license_metadata: true });

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | null> => {
    setLoading(true); setError("");
    try { return await task(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "LuxAlgo Research Temporarily Unavailable"); return null; }
    finally { setLoading(false); }
  }, []);
  const loadShell = useCallback(async () => {
    const bundle = await run(() => Promise.all([
      luxRequest<Json>("/local/overview"), luxRequest<Json>("/local/taxonomy"),
      luxRequest<Json>("/saved").catch(() => ({ items: [] })),
      luxRequest<Json>("/history").catch(() => ({ searches: [] })),
      luxRequest<Json>("/settings").catch(() => ({ settings: null })),
    ]));
    if (!bundle) return;
    const [data, taxonomy, saveData, historyData, settingsData] = bundle;
    setOverview(data); setHealth(data.health); setSync(data.state); setDatabase(data.database ?? {});
    setFamilies(asArray(taxonomy.families)); setTags(asArray(taxonomy.tags));
    setSaved(asArray(saveData.items)); setHistory(asArray(historyData.searches));
    if (settingsData.settings) setSettings(settingsData.settings);
  }, [run]);
  useEffect(() => { void loadShell(); return () => { syncLoop.current = false; }; }, [loadShell]);

  const search = useCallback(async (term = query, forcedType: "all" | "concepts" | "indicators" = "all", moveToLibrary = true) => {
    if (!term.trim()) return;
    const params = new URLSearchParams({ q: term.trim(), type: forcedType, family, tag });
    if (sourceOnly) params.set("source_code", "true");
    if (savedOnly) params.set("saved", "true");
    const data = await run(() => luxRequest<Json>(`/local/search?${params}`));
    if (data) { setResults(asArray(data.results).map((item) => ({ ...item, kind: item.source_code_available !== undefined ? "indicator" : "concept" }))); setPage(0); setHasMore(false); if (moveToLibrary) setTab("LIBRARY"); }
  }, [family, query, run, savedOnly, sourceOnly, tag]);
  const browse = useCallback(async (nextPage = 0, kindOverride?: "concepts" | "indicators") => {
    const activeKind = kindOverride ?? kind;
    const params = new URLSearchParams({ page: String(nextPage), page_size: "24", family, tag, platform, tier, sort });
    if (query.trim()) params.set("q", query.trim());
    if (sourceOnly) params.set("source_code", "true");
    if (savedOnly) params.set("saved", "true");
    const data = await run(() => luxRequest<Json>(`/local/${activeKind}?${params}`));
    if (data) { setResults(asArray(data.items).map((item) => ({ ...item, kind: activeKind === "indicators" ? "indicator" : "concept" }))); setPage(data.page ?? nextPage); setHasMore(Boolean(data.hasMore)); }
  }, [family, kind, platform, query, run, savedOnly, sort, sourceOnly, tag, tier]);
  useEffect(() => {
    const preset = tabQuery[tab];
    if (preset) { setQuery(preset); void search(preset, "concepts", false); }
    else if (tab === "INDICATORS") { setKind("indicators"); void browse(0, "indicators"); }
    else if (tab === "LIBRARY" && !results.length) void browse(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const openItem = async (item: Json) => {
    const type = item.kind === "indicator" || item.source_code_available !== undefined ? "indicator" : "concept";
    const data = await run(() => luxRequest<Json>(`/local/${type}s/${encodeURIComponent(item.slug)}`));
    if (data) { setSelected(data.data); setSelectedType(type); setSource(null); }
  };
  const saveItem = async (item: Json, type = selectedType) => {
    if (!type) return;
    const response = await run(() => luxRequest<Json>("/saved", { method: "POST", body: JSON.stringify({ itemType: type.toUpperCase(), externalId: item.slug, name: item.name || item.slug, family: item.family, officialUrl: item.official_url, attribution: item.attribution, licenseUrl: item.license_url, licenseMetadata: item.license_metadata, lastSyncedAt: item.last_synced_at, snapshot: item }) }));
    if (response?.item) setSaved((current) => [response.item, ...current.filter((row) => row.id !== response.item.id)]);
  };
  const loadSource = async (slug: string) => { const data = await run(() => luxRequest<Json>(`/local/source/${encodeURIComponent(slug)}`)); if (data) { setSource(data.data); setTab("SOURCE CODE"); } };
  const compare = async () => { if (!selected) return; const data = await run(() => luxRequest<Json>("/compare", { method: "POST", body: JSON.stringify({ concept: selected }) })); if (data) setSelected({ ...selected, comparison: data }); };
  const updateSettings = async (next: Json) => { setSettings(next); const data = await run(() => luxRequest<Json>("/settings", { method: "PUT", body: JSON.stringify(next) })); if (data?.settings) setSettings(data.settings); };

  const continueSync = useCallback(async (initial: Json) => {
    if (!initial?.job_id) return;
    syncLoop.current = true; setSyncing(true); let current = initial;
    try {
      while (syncLoop.current && current.status === "RUNNING") {
        const result = await luxRequest<Json>("/sync/step", { method: "POST", body: JSON.stringify({ jobId: current.job_id }) });
        current = result.state; setSync(current);
        if (current.status === "RUNNING") await wait(300);
      }
      if (current.status === "COMPLETED") await loadShell();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "LuxAlgo sync stopped unexpectedly. It can be resumed safely."); }
    finally { syncLoop.current = false; setSyncing(false); }
  }, [loadShell]);
  const startSync = async (mode: "FULL" | "CHANGES") => { const data = await run(() => luxRequest<Json>("/sync/start", { method: "POST", body: JSON.stringify({ mode }) })); if (data?.state) { setTab("SYNC STATUS"); setSync(data.state); void continueSync(data.state); } };
  const resumeSync = async () => { const data = await run(() => luxRequest<Json>("/sync/resume", { method: "POST", body: "{}" })); if (data?.state) { setSync(data.state); void continueSync(data.state); } };
  const retrySync = async () => { const data = await run(() => luxRequest<Json>("/sync/retry", { method: "POST", body: "{}" })); if (data?.state) { setSync(data.state); void continueSync(data.state); } };
  const cancelSync = async () => { syncLoop.current = false; const data = await run(() => luxRequest<Json>("/sync/cancel", { method: "POST", body: "{}" })); if (data?.state) setSync(data.state); };

  const loadEdge = async () => { const [symbols, presets] = await Promise.all([luxRequest<Json>("/edge/symbols"), luxRequest<Json>("/edge/presets")]); setEdge({ symbols: asArray(symbols.data?.symbols), presets: asArray(presets.data?.presets), report: null }); };
  useEffect(() => { if (tab === "EDGE STATS" && !edge.symbols.length) void run(loadEdge); }, [tab]);
  const edgeReport = async (preset: string, symbol: string) => { const data = await run(() => luxRequest<Json>(`/edge/report?preset=${encodeURIComponent(preset)}&symbol=${encodeURIComponent(symbol)}`)); if (data) setEdge((current: Json) => ({ ...current, report: data.data })); };

  const status = health?.status || "DISCONNECTED";
  const code = String(source?.source ?? source?.source_code ?? "");
  const codeLines = useMemo(() => code.split("\n"), [code]);
  const matchingLines = useMemo(() => sourceSearch ? codeLines.filter((line) => line.toLowerCase().includes(sourceSearch.toLowerCase())).length : 0, [codeLines, sourceSearch]);
  const syncCounters = sync?.counters ?? {};
  const syncRunning = sync?.status === "RUNNING" || syncing;
  const importedCount = (databaseKey: string, counterKey: string) => Math.max(Number(database[databaseKey] ?? 0), Number(syncCounters[counterKey] ?? 0));

  return <section className="lux-shell">
    <header className="lux-header"><button className="lux-icon" onClick={onBack} aria-label="Back to Onkar AI"><ChevronLeft /></button><div><span>ONKARTRADEX / EXTERNAL RESEARCH</span><h1>LUXALGO RESEARCH CENTER</h1><p>Synchronized official MCP research, isolated from live signals and execution.</p></div><button className={`lux-health ${status.toLowerCase()}`} onClick={() => void loadShell()}>{status === "CONNECTED" ? <Wifi /> : <WifiOff />}<span>{status}</span></button></header>
    <div className="lux-safety"><ShieldCheck /><span><strong>Research only.</strong> Imported LuxAlgo content cannot override Onkar setup rules, risk checks, Emergency Stop, or execute trades.</span></div>
    <nav className="lux-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); setSelected(null); }}>{item}</button>)}</nav>
    {error && <div className="lux-error"><TriangleAlert /><span><strong>LuxAlgo Research Temporarily Unavailable</strong>{error}</span><button onClick={() => setError("")}><X /></button></div>}
    {loading && <div className="lux-loader"><i /><span>Loading synchronized LuxAlgo research…</span></div>}

    {tab === "OVERVIEW" && <div className="lux-stack">
      <div className="lux-metrics">{[["MCP Status", status, Wifi], ["Concepts", importedCount("concepts", "conceptsListed"), BookOpen], ["Indicators", importedCount("indicators", "indicatorsListed"), Gauge], ["Families", importedCount("families", "families"), Layers3], ["Tags", importedCount("tags", "tags"), Filter], ["Public Source", importedCount("sourceFiles", "sourceFiles"), Code2], ["Saved Research", saved.length, BookMarked], ["Sync", sync?.status ?? "IDLE", RefreshCw]].map(([label, value, Icon]: any) => <article key={label}><Icon /><span>{label}</span><strong>{value}</strong></article>)}</div>
      <div className="lux-panel"><div className="lux-panel-head"><div><span>QUICK RESEARCH · SUPABASE LIBRARY</span><h2>Explore imported official concepts</h2></div><Search /></div><div className="lux-quick">{quick.map((item) => <button key={item} onClick={() => { setQuery(item); void search(item); }}>{item}</button>)}</div></div>
      <div className="lux-grid-two"><div className="lux-panel"><div className="lux-panel-head"><div><span>LOCAL TAXONOMY</span><h2>Families</h2></div><Database /></div><div className="lux-family-list">{families.map((item) => <button key={item.key} onClick={() => { setFamily(item.key); setTab("LIBRARY"); void browse(0); }}><span>{item.name}</span><strong>{item.concept_count}</strong></button>)}</div>{!families.length && <p className="lux-muted">Start a Full Sync to import the LuxAlgo Library.</p>}</div><div className="lux-panel"><div className="lux-panel-head"><div><span>SYNC HEALTH</span><h2>{sync?.status ?? "IDLE"}</h2></div><RefreshCw /></div><p>Last completed: {sync?.last_successful_sync_at ? new Date(sync.last_successful_sync_at).toLocaleString() : "Never"}</p><p>Stage: {sync?.stage ?? "READY"} · Changes: {sync?.content_changes ?? 0}</p><div className="lux-quick"><button disabled={syncRunning} onClick={() => void startSync("FULL")}>Start Full Sync</button><button disabled={syncRunning} onClick={() => void startSync("CHANGES")}>Sync Changes Only</button><button onClick={() => setTab("SYNC STATUS")}>Open Sync Status</button></div></div></div>
    </div>}

    {(tab === "LIBRARY" || tab === "INDICATORS" || Boolean(tabQuery[tab])) && <div className="lux-browser">
      <aside className="lux-filters"><h3><Filter /> Filters</h3><label>Content<select value={kind} onChange={(event) => setKind(event.target.value as "concepts" | "indicators")}><option value="concepts">Concepts</option><option value="indicators">Indicators</option></select></label><label>Family<select value={family} onChange={(event) => setFamily(event.target.value)}><option value="">All families</option>{families.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label><label>Tag<select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">All tags</option>{tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{kind === "indicators" && <><label>Platform<input value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="e.g. metatrader" /></label><label>Tier<select value={tier} onChange={(event) => setTier(event.target.value)}><option value="">All tiers</option>{["essential", "premium", "ultimate", "ultra"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="lux-check"><input type="checkbox" checked={sourceOnly} onChange={(event) => setSourceOnly(event.target.checked)} />Public source available</label></>}<label className="lux-check"><input type="checkbox" checked={savedOnly} onChange={(event) => setSavedOnly(event.target.checked)} />Saved only</label><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Name</option><option value="family">Family</option><option value="last_synced_at">Last synced</option></select></label><button onClick={() => void browse(0)}>Apply filters</button><small>Results are read from the private synchronized Supabase database.</small></aside>
      <div className="lux-library"><form className="lux-search" onSubmit={(event) => { event.preventDefault(); void search(query, kind); }}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search imported concepts and indicators…" /><button>Search</button></form><div className="lux-result-meta"><span>Page {page + 1} · {results.length} shown</span><span>Source: LuxAlgo MCP → Supabase</span></div><div className="lux-cards">{results.map((item) => { const relations = asArray(item.relationships); const itemType = item.kind || (item.source_code_available !== undefined ? "indicator" : "concept"); return <article key={`${itemType}-${item.slug}`}><div><span>{itemType}</span><em>{item.family || "Library"}</em></div><h3>{item.name || item.slug}</h3><p>{item.short_description || item.description || "Open the imported MCP record for available details."}</p><small>{relations.filter((row) => row.target_type === "CONCEPT").length} linked concepts · {item.source_code_available ? "Source available" : "Research record"}</small><footer><button onClick={() => void openItem(item)}>Open Details <ChevronRight /></button><button className="lux-icon" onClick={() => void saveItem(item, itemType === "indicator" ? "indicator" : "concept")} aria-label="Save research"><Save /></button></footer></article>; })}</div><div className="lux-pagination"><button disabled={page === 0} onClick={() => void browse(page - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={!hasMore} onClick={() => void browse(page + 1)}>Next</button></div>{!results.length && <div className="lux-empty"><Database /><h3>No imported records match</h3><p>Run Full Sync first, or change the current filters.</p></div>}</div>
      {selected && <aside className="lux-detail"><button className="lux-detail-close" onClick={() => setSelected(null)}><X /></button><span className="lux-source">SOURCE_TYPE · LUXALGO_REFERENCE</span><h2>{selected.name || selected.slug}</h2>{selected.family && <em>{selected.family}</em>}<MarkdownText value={selected.content_markdown || selected.body_markdown || selected.description} /><dl className="lux-provenance"><div><dt>Attribution</dt><dd>{selected.attribution || "Not supplied"}</dd></div><div><dt>License</dt><dd>{selected.license_url || "Not supplied"}</dd></div><div><dt>Last synced</dt><dd>{selected.last_synced_at ? new Date(selected.last_synced_at).toLocaleString() : "Not available"}</dd></div></dl><div className="lux-actions"><button onClick={() => void saveItem(selected)}><Save /> Save Research</button>{selectedType === "concept" && <button onClick={() => void compare()}><Layers3 /> Compare With Onkar Rules</button>}{selectedType === "indicator" && selected.source_code_available && <button onClick={() => void loadSource(selected.slug)}><Code2 /> View Source</button>}<button onClick={() => onAskMaster(`Use this LUXALGO_REFERENCE for research only: ${selected.name || selected.slug}`)}><Sparkles /> Ask Master AI</button></div>{officialUrl(selected.official_url) && <a href={officialUrl(selected.official_url)!} target="_blank" rel="noreferrer">Open Official Source <ExternalLink /></a>}{selected.comparison?.comparisons?.length > 0 && <div className="lux-comparison"><h3>Onkar rule comparison</h3>{selected.comparison.comparisons.map((row: Json) => <article key={row.id}><strong>{row.name}</strong><p>Matching conditions: {row.commonTerms?.join(", ") || "No strong textual overlap found"}</p><small>{row.note}</small></article>)}</div>}</aside>}
    </div>}

    {tab === "SOURCE CODE" && <div className={`lux-panel lux-source-view ${sourceFullscreen ? "fullscreen" : ""}`}><div className="lux-panel-head"><div><span>UNTRUSTED REFERENCE · NEVER EXECUTED</span><h2>{source?.name || "Pine source viewer"}</h2></div><div className="lux-source-tools"><button onClick={() => setSourceFullscreen((value) => !value)}>{sourceFullscreen ? <Square /> : <Maximize2 />} {sourceFullscreen ? "Exit" : "Fullscreen"}</button>{code && <button onClick={() => void navigator.clipboard.writeText(code)}><Copy /> Copy</button>}</div></div>{code ? <><div className="lux-code-search"><Search /><input value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="Search inside source…" /><span>{sourceSearch ? `${matchingLines} lines` : `${codeLines.length} lines`}</span></div><pre>{codeLines.map((line, index) => <code className={sourceSearch && line.toLowerCase().includes(sourceSearch.toLowerCase()) ? "match" : ""} key={index}><i>{index + 1}</i><PineLine line={line} />{"\n"}</code>)}</pre><dl className="lux-provenance"><div><dt>Attribution</dt><dd>{source?.attribution || "Not supplied"}</dd></div><div><dt>License</dt><dd>{source?.license_identifier || source?.license_url || "Not supplied"}</dd></div><div><dt>Last synced</dt><dd>{source?.last_synced_at ? new Date(source.last_synced_at).toLocaleString() : "Not available"}</dd></div></dl></> : <p className="lux-muted">Open an imported indicator with public source code, then choose View Source.</p>}</div>}

    {tab === "EDGE STATS" && <div className="lux-stack"><div className="lux-panel"><div className="lux-panel-head"><div><span>HISTORICAL CONDITIONAL FREQUENCIES · NOT SIGNALS</span><h2>Edge Stats</h2></div><Activity /></div><p>Official MCP Edge Stats remain separate from synchronized research and never become a live signal.</p><div className="lux-edge-grid">{edge.presets.slice(0, 20).map((preset: Json) => <article key={preset.id}><span>{preset.category}</span><h3>{preset.title}</h3><p>{preset.summary}</p><select defaultValue="" onChange={(event) => event.target.value && void edgeReport(preset.id, event.target.value)}><option value="">Choose covered symbol…</option>{edge.symbols.map((symbol: Json) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol}</option>)}</select></article>)}</div></div>{edge.report && <div className="lux-panel"><span className="lux-source">LUXALGO HISTORICAL STATISTICS</span><h2>Official report</h2><pre className="lux-json">{JSON.stringify(edge.report, null, 2)}</pre></div>}</div>}
    {tab === "SAVED RESEARCH" && <div className="lux-panel"><div className="lux-panel-head"><div><span>PRIVATE ATTRIBUTED BOOKMARKS</span><h2>Saved Research</h2></div><BookMarked /></div><div className="lux-saved">{saved.map((item) => <article key={item.id}><span>Source: LuxAlgo · {item.item_type}</span><h3>{item.name}</h3><p>{item.notes || "No private notes yet."}</p><p>Last synchronized {item.last_synced_at ? new Date(item.last_synced_at).toLocaleString() : "not recorded"}</p>{officialUrl(item.official_url) && <a href={officialUrl(item.official_url)!} target="_blank" rel="noreferrer">Official URL <ExternalLink /></a>}<button onClick={async () => { await run(() => luxRequest(`/saved/${item.id}`, { method: "DELETE" })); setSaved((rows) => rows.filter((row) => row.id !== item.id)); }}>Remove</button></article>)}</div>{!saved.length && <p className="lux-muted">No LuxAlgo research saved yet.</p>}</div>}

    {tab === "SYNC STATUS" && <div className="lux-stack"><div className="lux-panel lux-sync-panel"><div className="lux-panel-head"><div><span>RESUMABLE DATABASE IMPORT</span><h2>{sync?.status ?? "IDLE"} · {sync?.stage ?? "READY"}</h2></div><RefreshCw className={syncRunning ? "lux-spin-icon" : ""} /></div><div className="lux-sync-actions"><button disabled={syncRunning} onClick={() => void startSync("FULL")}>Start Full Sync</button><button disabled={syncRunning} onClick={() => void startSync("CHANGES")}>Sync Changes Only</button><button disabled={syncRunning || !sync?.job_id || sync?.stage === "COMPLETE"} onClick={() => void resumeSync()}>Resume Sync</button><button disabled={syncRunning || !sync?.retry_queue?.length} onClick={() => void retrySync()}>Retry Failed Items</button><button className="danger" disabled={!syncRunning} onClick={() => void cancelSync()}>Cancel Current Sync</button></div><div className="lux-sync-grid">{[["Families", database.families ?? 0, syncCounters.families], ["Concepts", database.concepts ?? 0, syncCounters.conceptDetails], ["Indicators", database.indicators ?? 0, syncCounters.indicatorDetails], ["Tags", database.tags ?? 0, syncCounters.tags], ["Source files", database.sourceFiles ?? 0, syncCounters.sourceFiles], ["Content changes", sync?.content_changes ?? 0, null], ["Failed items", sync?.failed_items?.length ?? 0, null], ["Retry queue", sync?.retry_queue?.length ?? 0, null]].map(([label, value, processed]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong>{processed !== null && <small>{processed ?? 0} processed this run</small>}</article>)}</div><dl className="lux-sync-meta"><div><dt>Last completed</dt><dd>{sync?.last_successful_sync_at ? new Date(sync.last_successful_sync_at).toLocaleString() : "Never"}</dd></div><div><dt>Duration</dt><dd>{sync?.last_duration_ms ? `${Math.round(sync.last_duration_ms / 1000)} seconds` : "—"}</dd></div><div><dt>MCP connection</dt><dd>{status}</dd></div><div><dt>Database/cache</dt><dd>{overview ? "AVAILABLE" : "UNAVAILABLE"}</dd></div></dl>{sync?.last_error && <div className="lux-error"><TriangleAlert /><span><strong>Latest sync message</strong>{sync.last_error}</span></div>}{sync?.failed_items?.length > 0 && <div className="lux-failures">{(sync?.failed_items ?? []).slice(0, 50).map((item: Json, index: number) => <article key={`${item.type}-${item.id}-${index}`}><strong>{item.type} · {item.id}</strong><span>{item.error}</span></article>)}</div>}<p className="lux-muted">The browser advances small server-side batches. If this page closes, progress remains saved and Resume Sync continues from the last completed stage.</p></div></div>}

    {tab === "SETTINGS" && <div className="lux-panel lux-settings"><div className="lux-panel-head"><div><span>ISOLATED RESEARCH CONTROLS</span><h2>LuxAlgo settings</h2></div><Settings2 /></div>{[["enabled", "Enable LuxAlgo MCP"], ["cache_enabled", "Enable local Supabase cache"], ["manual_sync_enabled", "Enable manual sync"], ["allow_master_ai", "Allow Master AI access"], ["allow_trend_ai", "Allow Trend AI access"], ["allow_zone_ai", "Allow Zone AI access"], ["allow_setup_ai", "Allow Setup AI access"], ["allow_backtest_ai", "Allow Backtest AI access"], ["allow_insight_ai", "Allow Insight AI access"], ["edge_stats_enabled", "Edge Stats enabled"], ["saved_research_enabled", "Saved Research enabled"], ["save_raw_responses", "Save raw MCP responses"], ["save_public_source_code", "Save public source code"], ["preserve_attribution", "Preserve attribution"], ["preserve_license_metadata", "Preserve license metadata"]].map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={settings[key] !== false} onChange={(event) => void updateSettings({ ...settings, [key]: event.target.checked })} /></label>)}<label><span>Cache duration (minutes)</span><input type="number" min={5} max={10080} value={settings.cache_duration_minutes || 360} onChange={(event) => setSettings({ ...settings, cache_duration_minutes: Number(event.target.value) })} onBlur={() => void updateSettings(settings)} /></label><div className="lux-connection"><Database /><span><strong>Official MCP endpoint</strong>https://mcp.luxalgo.com/mcp</span><button onClick={() => void loadShell()}><RefreshCw /> Test Connection</button></div></div>}
  </section>;
}
