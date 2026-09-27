import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, BookMarked, BookOpen, Check, ChevronLeft, ChevronRight,
  Code2, Copy, Database, ExternalLink, Filter, Gauge, Layers3, RefreshCw,
  Save, Search, Settings2, ShieldCheck, Sparkles, TriangleAlert, Wifi, WifiOff,
} from "lucide-react";
import { luxRequest } from "./api";
import "./luxalgo.css";

type Json = Record<string, any>;
type Tab = "OVERVIEW" | "LIBRARY" | "PRICE ACTION" | "MARKET STRUCTURE" | "LIQUIDITY" | "SUPPORT & RESISTANCE" | "FVG / IMBALANCE" | "ORDER BLOCKS" | "INDICATORS" | "SOURCE CODE" | "EDGE STATS" | "SAVED RESEARCH" | "SETTINGS";
const tabs: Tab[] = ["OVERVIEW", "LIBRARY", "PRICE ACTION", "MARKET STRUCTURE", "LIQUIDITY", "SUPPORT & RESISTANCE", "FVG / IMBALANCE", "ORDER BLOCKS", "INDICATORS", "SOURCE CODE", "EDGE STATS", "SAVED RESEARCH", "SETTINGS"];
const quick = ["Liquidity Sweep", "BOS", "CHoCH", "Market Structure Shift", "Fair Value Gap", "Order Block", "Support Resistance", "Breakout", "Fakeout", "Pullback", "ATR", "Volatility", "Sessions"];
const tabQuery: Partial<Record<Tab, string>> = { "PRICE ACTION": "price action", "MARKET STRUCTURE": "market structure", LIQUIDITY: "liquidity sweep", "SUPPORT & RESISTANCE": "support resistance", "FVG / IMBALANCE": "fair value gap imbalance", "ORDER BLOCKS": "order blocks" };
const unwrap = (value: Json) => value?.data ?? value;
const asArray = (value: unknown) => Array.isArray(value) ? value : [];
const officialUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)luxalgo\.com$/i.test(url.hostname) ? url.toString() : null;
  } catch { return null; }
};

function MarkdownText({ value }: { value?: string }) {
  if (!value) return <p className="lux-muted">This section was not included in the MCP response.</p>;
  return <div className="lux-markdown">{value.split(/\n{2,}/).map((block, index) => {
    const clean = block.replace(/^#{1,6}\s+/, "").trim();
    if (!clean) return null;
    if (/^[-*]\s/m.test(clean)) return <ul key={index}>{clean.split(/\n/).map((line, i) => <li key={i}>{line.replace(/^[-*]\s*/, "")}</li>)}</ul>;
    return <p key={index}>{clean}</p>;
  })}</div>;
}

export default function LuxAlgoResearchCenter({ onBack, onAskMaster }: { onBack: () => void; onAskMaster: (prompt?: string) => void }) {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [overview, setOverview] = useState<Json | null>(null);
  const [health, setHealth] = useState<Json | null>(null);
  const [results, setResults] = useState<Json[]>([]);
  const [families, setFamilies] = useState<Json[]>([]);
  const [selected, setSelected] = useState<Json | null>(null);
  const [selectedType, setSelectedType] = useState<"concept" | "indicator" | null>(null);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [tags, setTags] = useState<Json[]>([]);
  const [tag, setTag] = useState("");
  const [conceptFilter, setConceptFilter] = useState("");
  const [platform, setPlatform] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("date");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState<Json | null>(null);
  const [saved, setSaved] = useState<Json[]>([]);
  const [history, setHistory] = useState<Json[]>([]);
  const [edge, setEdge] = useState<Json>({ symbols: [], presets: [], report: null });
  const [settings, setSettings] = useState<Json>({ enabled: true, cache_enabled: true, cache_duration_minutes: 360, allow_master_ai: true, allow_trend_ai: true, allow_zone_ai: true, allow_setup_ai: true, allow_backtest_ai: true, allow_insight_ai: true, edge_stats_enabled: true, saved_research_enabled: true });
  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | null> => {
    setLoading(true); setError("");
    try { return await task(); }
    catch (e) { setError(e instanceof Error ? e.message : "LuxAlgo Research Temporarily Unavailable"); return null; }
    finally { setLoading(false); }
  }, []);
  const loadShell = useCallback(async (refresh = false) => {
    const bundle = await run(() => Promise.all([
      luxRequest<Json>(`/overview${refresh ? "?refresh=true" : ""}`),
      luxRequest<Json>("/saved").catch(() => ({ items: [] })),
      luxRequest<Json>("/history").catch(() => ({ searches: [] })),
      luxRequest<Json>("/settings").catch(() => ({ settings: null })),
      luxRequest<Json>("/tags").catch(() => ({ data: { tags: [] } })),
    ]));
    if (!bundle) return;
    const [data, saveData, historyData, settingsData, tagData] = bundle;
    setOverview(data); setHealth(data.health); setFamilies(asArray(data.families));
    setTags(asArray(unwrap(tagData).tags));
    setSaved(asArray(saveData.items)); setHistory(asArray(historyData.searches)); if (settingsData.settings) setSettings(settingsData.settings);
  }, [run]);
  useEffect(() => { void loadShell(); }, [loadShell]);

  const search = useCallback(async (term = query, forcedType = "all", moveToLibrary = true) => {
    if (!term.trim()) return;
    const data = await run(() => luxRequest<Json>(`/search?q=${encodeURIComponent(term.trim())}&type=${forcedType}&limit=30${family ? `&family=${encodeURIComponent(family)}` : ""}`));
    if (data) {
      setResults(asArray(unwrap(data).results));
      setTotal(asArray(unwrap(data).results).length);
      setPage(0);
      if (moveToLibrary) setTab("LIBRARY");
    }
  }, [family, query, run]);
  const browse = useCallback(async (kind: "concepts" | "indicators", nextPage = 0, familyOverride?: string) => {
    const activeFamily = familyOverride ?? family;
    const indicatorFilters = kind === "indicators"
      ? `${conceptFilter ? `&concept=${encodeURIComponent(conceptFilter)}` : ""}${tag ? `&tags=${encodeURIComponent(tag)}` : ""}${platform ? `&platform=${encodeURIComponent(platform)}` : ""}${tier ? `&tier=${encodeURIComponent(tier)}` : ""}&sort=${encodeURIComponent(sort)}&direction=${sort === "name" ? "asc" : "desc"}`
      : "";
    const data = await run(() => luxRequest<Json>(`/${kind}?page=${nextPage}&page_size=24${activeFamily ? `&family=${encodeURIComponent(activeFamily)}` : ""}${indicatorFilters}`));
    if (!data) return;
    const payload = unwrap(data); setResults(asArray(payload[kind]).map((item) => ({ ...item, kind: kind === "concepts" ? "concept" : "indicator" }))); setTotal(Number(payload.total || 0)); setPage(nextPage);
  }, [conceptFilter, family, platform, run, sort, tag, tier]);
  useEffect(() => {
    const preset = tabQuery[tab];
    if (preset) { setQuery(preset); void search(preset, "concepts", false); }
    else if (tab === "INDICATORS") void browse("indicators", 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const openItem = async (item: Json) => {
    const type = item.kind === "indicator" ? "indicator" : "concept";
    const data = await run(() => luxRequest<Json>(`/${type}s/${encodeURIComponent(item.slug)}`));
    if (data) { setSelected(unwrap(data)); setSelectedType(type); setSource(null); }
  };
  const saveItem = async (item: Json, type = selectedType) => {
    if (!type) return;
    const response = await run(() => luxRequest<Json>("/saved", { method: "POST", body: JSON.stringify({ itemType: type.toUpperCase(), externalId: item.slug, name: item.name || item.slug, family: item.family, officialUrl: item.url, snapshot: item }) }));
    if (response?.item) setSaved((current) => [response.item, ...current.filter((row) => row.id !== response.item.id)]);
  };
  const loadSource = async (slug: string) => {
    const data = await run(() => luxRequest<Json>(`/source/${encodeURIComponent(slug)}`));
    if (data) { setSource(unwrap(data)); setTab("SOURCE CODE"); }
  };
  const compare = async () => {
    if (!selected) return;
    const data = await run(() => luxRequest<Json>("/compare", { method: "POST", body: JSON.stringify({ concept: selected }) }));
    if (data) setSelected({ ...selected, comparison: data });
  };
  const loadEdge = async () => {
    const [symbols, presets] = await Promise.all([luxRequest<Json>("/edge/symbols"), luxRequest<Json>("/edge/presets")]);
    setEdge({ symbols: asArray(unwrap(symbols).symbols), presets: asArray(unwrap(presets).presets), report: null });
  };
  useEffect(() => { if (tab === "EDGE STATS" && !edge.symbols.length) void run(loadEdge); }, [tab]);
  const edgeReport = async (preset: string, symbol: string) => {
    const data = await run(() => luxRequest<Json>(`/edge/report?preset=${encodeURIComponent(preset)}&symbol=${encodeURIComponent(symbol)}`));
    if (data) setEdge((current: Json) => ({ ...current, report: unwrap(data) }));
  };
  const updateSettings = async (next: Json) => {
    setSettings(next);
    const data = await run(() => luxRequest<Json>("/settings", { method: "PUT", body: JSON.stringify(next) }));
    if (data?.settings) setSettings(data.settings);
  };
  const status = health?.status || "DISCONNECTED";
  const mainResults = useMemo(() => results.filter((item) => item?.slug), [results]);

  return <section className="lux-shell">
    <header className="lux-header">
      <button className="lux-icon" onClick={onBack} aria-label="Back to Onkar AI"><ChevronLeft /></button>
      <div><span>ONKARTRADEX / EXTERNAL RESEARCH</span><h1>LUXALGO RESEARCH CENTER</h1><p>Official MCP research, clearly separated from live signals and execution.</p></div>
      <button className={`lux-health ${status.toLowerCase()}`} onClick={() => void loadShell(true)}>{status === "CONNECTED" ? <Wifi /> : <WifiOff />}<span>{status}</span></button>
    </header>
    <div className="lux-safety"><ShieldCheck /><span><strong>Research only.</strong> LuxAlgo cannot override Onkar setup rules, risk checks, Emergency Stop, or execute trades.</span></div>
    <nav className="lux-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); setSelected(null); }}>{item}</button>)}</nav>
    {error && <div className="lux-error"><TriangleAlert /> <span><strong>LuxAlgo Research Temporarily Unavailable</strong>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    {loading && <div className="lux-loader"><i /><span>Requesting official LuxAlgo MCP data…</span></div>}

    {tab === "OVERVIEW" && <div className="lux-stack">
      <div className="lux-metrics">
        {[["MCP Status", status, Wifi], ["Trading Concepts", overview?.conceptCount ?? "—", BookOpen], ["Indicators", overview?.indicatorCount ?? "—", Gauge], ["Families", families.length || "—", Layers3], ["Saved Research", saved.length, BookMarked], ["Edge Stats", overview?.edgeAvailable ? "Available" : "Unavailable", BarChart3]].map(([label, value, Icon]: any) => <article key={label}><Icon /><span>{label}</span><strong>{value}</strong></article>)}
      </div>
      <div className="lux-panel"><div className="lux-panel-head"><div><span>QUICK RESEARCH</span><h2>Explore official Library concepts</h2></div><Search /></div><div className="lux-quick">{quick.map((item) => <button key={item} onClick={() => { setQuery(item); void search(item); }}>{item}</button>)}</div></div>
      <div className="lux-grid-two"><div className="lux-panel"><h3>Families</h3><div className="lux-family-list">{families.slice(0, 17).map((item) => <button key={item.key} onClick={() => { setFamily(item.key); setTab("LIBRARY"); void browse("concepts", 0, item.key); }}><span>{item.name}</span><strong>{item.concept_count}</strong></button>)}</div></div><div className="lux-panel"><h3>Recent searches</h3>{history.length ? history.slice(0, 10).map((item) => <button className="lux-history" key={item.id} onClick={() => { setQuery(item.query); void search(item.query); }}><Search />{item.query}<time>{new Date(item.created_at).toLocaleDateString()}</time></button>) : <p className="lux-muted">No saved search history yet.</p>}</div></div>
    </div>}

    {(tab === "LIBRARY" || tab === "INDICATORS" || Boolean(tabQuery[tab])) && <div className="lux-browser">
      <aside className="lux-filters"><h3><Filter /> Filters</h3><label>Family<select value={family} onChange={(e) => setFamily(e.target.value)}><option value="">All families</option>{families.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>{tab === "INDICATORS" && <><label>Concept slug<input value={conceptFilter} onChange={(e) => setConceptFilter(e.target.value.replace(/[^a-z0-9-]/gi, ""))} placeholder="e.g. liquidity-sweep" /></label><label>Tag<select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">All tags</option>{tags.map((item) => { const value = item.id || item.slug || item.key || item.name; return <option key={value} value={value}>{item.name || value}</option>; })}</select></label><label>Platform<input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. metatrader" /></label><label>Tier<select value={tier} onChange={(e) => setTier(e.target.value)}><option value="">All tiers</option>{["essential", "premium", "ultimate", "ultra"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Sort<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="date">Newest</option><option value="name">Name</option><option value="family">Family</option></select></label></>}<button onClick={() => void browse(tab === "INDICATORS" ? "indicators" : "concepts", 0)}>Apply filters</button><small>Results come from the official MCP response and local cache.</small></aside>
      <div className="lux-library"><form className="lux-search" onSubmit={(e) => { e.preventDefault(); void search(); }}><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search concepts and indicators…" /><button>Search</button></form><div className="lux-result-meta"><span>{total} result{total === 1 ? "" : "s"}</span><span>Source: LuxAlgo MCP</span></div><div className="lux-cards">{mainResults.map((item) => <article key={`${item.kind}-${item.slug}`}><div><span>{item.kind || "concept"}</span><em>{item.family || "Library"}</em></div><h3>{item.name || item.slug}</h3><p>{item.description || (item.aliases?.length ? `Also known as ${item.aliases.join(", ")}` : "Open the official result for available details.")}</p><footer><button onClick={() => void openItem(item)}>Open Details <ChevronRight /></button><button className="lux-icon" onClick={() => void saveItem(item, item.kind === "indicator" ? "indicator" : "concept")} aria-label="Save research"><Save /></button></footer></article>)}</div>{total > 24 && <div className="lux-pagination"><button disabled={page === 0} onClick={() => void browse(tab === "INDICATORS" ? "indicators" : "concepts", page - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * 24 >= total} onClick={() => void browse(tab === "INDICATORS" ? "indicators" : "concepts", page + 1)}>Next</button></div>}</div>
      {selected && <aside className="lux-detail"><button className="lux-detail-close" onClick={() => setSelected(null)}>Close</button><span className="lux-source">SOURCE_TYPE · LUXALGO_REFERENCE</span><h2>{selected.name || selected.slug}</h2>{selected.family && <em>{selected.family}</em>}<MarkdownText value={selected.content_markdown || selected.body_markdown || selected.description} /><div className="lux-actions"><button onClick={() => void saveItem(selected)}><Save /> Save Research</button>{selectedType === "concept" && <button onClick={() => void compare()}><Layers3 /> Compare With Onkar Rules</button>}{selectedType === "indicator" && selected.code?.available && <button onClick={() => void loadSource(selected.slug)}><Code2 /> View Source</button>}<button onClick={() => onAskMaster(`Use this LuxAlgo reference for research only: ${selected.name || selected.slug}`)}><Sparkles /> Ask Master AI</button></div>{officialUrl(selected.url) && <a href={officialUrl(selected.url)!} target="_blank" rel="noreferrer">Official Source <ExternalLink /></a>}{selected.comparison?.comparisons?.length > 0 && <div className="lux-comparison"><h3>Onkar rule comparison</h3>{selected.comparison.comparisons.map((row: Json) => <article key={row.id}><strong>{row.name}</strong><p>Common terms: {row.commonTerms?.join(", ") || "No strong textual overlap found"}</p><small>{row.note}</small></article>)}</div>}</aside>}
    </div>}

    {tab === "SOURCE CODE" && <div className="lux-panel lux-source-view"><div className="lux-panel-head"><div><span>UNTRUSTED REFERENCE · NEVER EXECUTED</span><h2>{source?.name || "Pine source viewer"}</h2></div>{source?.source && <button onClick={() => void navigator.clipboard.writeText(source.source)}><Copy /> Copy</button>}</div>{source?.available ? <pre>{String(source.source).split("\n").map((line, index) => <code key={index}><i>{index + 1}</i>{line}{"\n"}</code>)}</pre> : <p className="lux-muted">Open an indicator with public source code, then choose View Source.</p>}</div>}

    {tab === "EDGE STATS" && <div className="lux-stack"><div className="lux-panel"><div className="lux-panel-head"><div><span>HISTORICAL CONDITIONAL FREQUENCIES · NOT SIGNALS</span><h2>Edge Stats</h2></div><Activity /></div><p>Every official report retains its sample size, confidence interval, build information, coverage, and disclaimer.</p><div className="lux-edge-grid">{edge.presets.slice(0, 20).map((preset: Json) => <article key={preset.id}><span>{preset.category}</span><h3>{preset.title}</h3><p>{preset.summary}</p><select defaultValue="" onChange={(e) => e.target.value && void edgeReport(preset.id, e.target.value)}><option value="">Choose covered symbol…</option>{edge.symbols.map((symbol: Json) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol}</option>)}</select></article>)}</div></div>{edge.report && <div className="lux-panel"><span className="lux-source">LUXALGO HISTORICAL STATISTICS</span><h2>Official report</h2><pre className="lux-json">{JSON.stringify(edge.report, null, 2)}</pre></div>}</div>}

    {tab === "SAVED RESEARCH" && <div className="lux-panel"><div className="lux-panel-head"><div><span>ATTRIBUTED LOCAL BOOKMARKS</span><h2>Saved Research</h2></div><BookMarked /></div><div className="lux-saved">{saved.map((item) => <article key={item.id}><span>Source: LuxAlgo · {item.item_type}</span><h3>{item.name}</h3><p>Last synchronized {new Date(item.updated_at).toLocaleString()}</p>{item.official_url && <a href={item.official_url} target="_blank" rel="noreferrer">Official URL <ExternalLink /></a>}<button onClick={async () => { await run(() => luxRequest(`/saved/${item.id}`, { method: "DELETE" })); setSaved((rows) => rows.filter((row) => row.id !== item.id)); }}>Remove</button></article>)}</div>{!saved.length && <p className="lux-muted">No LuxAlgo research saved yet.</p>}</div>}

    {tab === "SETTINGS" && <div className="lux-panel lux-settings"><div className="lux-panel-head"><div><span>ISOLATED RESEARCH CONTROLS</span><h2>LuxAlgo settings</h2></div><Settings2 /></div>{[["enabled", "Enable LuxAlgo MCP"], ["cache_enabled", "Enable local caching"], ["allow_master_ai", "Allow Master AI access"], ["allow_trend_ai", "Allow Trend AI access"], ["allow_zone_ai", "Allow Zone AI access"], ["allow_setup_ai", "Allow Setup AI access"], ["allow_backtest_ai", "Allow Backtest AI access"], ["allow_insight_ai", "Allow Insight AI access"], ["edge_stats_enabled", "Edge Stats enabled"], ["saved_research_enabled", "Saved Research enabled"]].map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={settings[key] !== false} onChange={(e) => void updateSettings({ ...settings, [key]: e.target.checked })} /></label>)}<label><span>Cache duration (minutes)</span><input type="number" min={5} max={10080} value={settings.cache_duration_minutes || 360} onChange={(e) => setSettings({ ...settings, cache_duration_minutes: Number(e.target.value) })} onBlur={() => void updateSettings(settings)} /></label><div className="lux-connection"><Database /><span><strong>Endpoint</strong>https://mcp.luxalgo.com/mcp</span><button onClick={() => void loadShell(true)}><RefreshCw /> Test Connection</button></div></div>}
  </section>;
}
