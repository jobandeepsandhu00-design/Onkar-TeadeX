import { useCallback, useEffect, useRef, useState } from "react";
import type { ScannerSnapshot } from "@workspace/api-zod";
import {
  Brain,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { brainRequest } from "./api";
import { RulesControlCenter } from "./RulesControlCenter";
import { ScannerSettings } from "./ScannerSettings";
import { CandidateDetail } from "./CandidateDetail";
import { MT5StatusPanel } from "./MT5StatusPanel";
import { ScannerReplay } from "./ScannerReplay";
import { AccountCommandCarousel } from "./AccountCommandCarousel";
import { AutomationControlBar } from "./AutomationControlBar";
import {
  BossBriefing,
  CommandCenterHero,
  DataProviderManager,
  JournalLearningPanel,
  LiveCandidateCarousel,
  MarketSessionTimeline,
  MasterAIOrbitalHub,
  PermissionCenter,
  SetupActivationPanel,
  SystemActivityTimeline,
  TradeCommandCenter,
  TradingLifecycle,
} from "./CommandCenterVisuals";
import type { AgentId } from "../onkar-ai/agent-data";
import { latestApprovedVersions } from "./strategy-versions";
import "./market-brain.css";

export type MarketBrainTab =
  | "Watchlist"
  | "Rules"
  | "Settings"
  | "Connections"
  | "Journal insights"
  | "Replay";
export default function MarketBrain({
  onJournal,
  journalTrades = [],
  initialTab = "Watchlist",
  onOpenAgent,
  onEditSetup,
}: {
  onJournal: () => void;
  journalTrades?: Array<
    Record<string, unknown> & { id: string; symbol?: string; date?: string }
  >;
  initialTab?: MarketBrainTab;
  onOpenAgent?: (agentId: AgentId) => void;
  onEditSetup?: (setupId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<ScannerSnapshot | null>(null),
    [tab, setTab] = useState<MarketBrainTab>(initialTab),
    [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [filter, setFilter] = useState(""),
    [status, setStatus] = useState("All"),
    [direction, setDirection] = useState("All");
  const root = useRef<HTMLElement>(null),
    visible = useRef(false),
    request = useRef<AbortController | null>(null),
    strategySyncAttempted = useRef(false);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const data = await brainRequest<ScannerSnapshot>(
        "",
        "GET",
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setSnapshot(data);
        setError("");
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Scanner unavailable");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
        if (entry.isIntersecting && !request.current) void refresh();
      },
      { rootMargin: "250px" },
    );
    if (root.current) observer.observe(root.current);
    const timer = setInterval(() => {
      if (visible.current && document.visibilityState === "visible")
        void refresh();
    }, 30_000);
    return () => {
      observer.disconnect();
      clearInterval(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    if (!snapshot || strategySyncAttempted.current) return;
    const approvedBySetup = new Map(
      latestApprovedVersions(snapshot).map((version) => [
        version.source_setup_id,
        version,
      ]),
    );
    const needsCanonicalSync = snapshot.setups.some(
      (setup) =>
        !approvedBySetup.get(setup.id)?.definition.autoExecutionAllowed,
    );
    if (!needsCanonicalSync) return;
    strategySyncAttempted.current = true;
    setNotice("Preparing approved setups for the shared scanner…");
    void brainRequest<{ synced: number; message: string }>(
      "/strategies/sync-library",
      "POST",
    )
      .then(async (result) => {
        if (snapshot.config) {
          await brainRequest("/config", "PUT", {
            ...snapshot.config.config,
            enabled: true,
            autoActivateApprovedSetups: true,
            strategyVersionIds: [],
          });
        }
        setNotice(result.message);
        await refresh();
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Automatic setup synchronization failed",
        ),
      );
  }, [refresh, snapshot]);
  const changed = () => {
    setNotice("Saved to your account.");
    void refresh();
  };
  const selectAccount = async (accountId: string) => {
    if (!snapshot?.config) return;
    try {
      await brainRequest("/config", "PUT", {
        ...snapshot.config.config,
        accountId,
      });
      setNotice("Trading account selected. Risk and scanner context updated.");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Account selection failed",
      );
    }
  };
  const saveConfig = async (
    patch: Record<string, unknown>,
    message: string,
  ) => {
    if (!snapshot?.config) {
      setError(
        "Save scanner settings before changing command-center controls.",
      );
      return;
    }
    setLoading(true);
    try {
      await brainRequest("/config", "PUT", {
        ...snapshot.config.config,
        ...patch,
      });
      setNotice(message);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Scanner update failed",
      );
    } finally {
      setLoading(false);
    }
  };
  const switchTradingSource = async (source: "MT5" | "TWELVE_DATA") => {
    if (!snapshot) return;
    setLoading(true);
    try {
      await brainRequest("/runtime", "PUT", {
        scannerState: snapshot.runtime.scannerState,
        tradingMode: snapshot.runtime.tradingMode,
        tradingSource: source,
        mt5DisconnectBehavior: snapshot.runtime.mt5DisconnectBehavior,
        autoReturnMt5: snapshot.runtime.autoReturnMt5,
        autoStart: snapshot.runtime.autoStart,
        autoExecutionEnabled: snapshot.runtime.autoExecutionEnabled,
      });
      setNotice(
        source === "MT5"
          ? "MT5 is active for new analysis and broker execution."
          : "Twelve Data is active for new analysis and Paper execution.",
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Trading source switch failed",
      );
    } finally {
      setLoading(false);
    }
  };
  const candidates = snapshot?.candidates ?? [];
  const active = candidates.filter(
    (c) => !["EXPIRED", "INVALIDATED", "COMPLETED"].includes(c.state),
  );
  const approvedRules = snapshot ? latestApprovedVersions(snapshot) : [];
  const activeRuleCount = snapshot?.config?.config.autoActivateApprovedSetups
    ? approvedRules.length
    : approvedRules.filter((version) =>
        snapshot?.config?.config.strategyVersionIds.includes(version.id),
      ).length;
  const ranked = [...(status === "History" ? candidates : active)]
    .filter(
      (c) =>
        (status === "All" || status === "History" || c.state === status) &&
        (direction === "All" || c.payload.direction === direction) &&
        `${c.symbol} ${c.payload.strategyName} ${c.timeframe} ${c.payload.session}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    )
    .sort((a, b) => b.score - a.score);
  const current = candidates.find((c) => c.id === selected);
  const live =
    snapshot?.config?.enabled &&
    snapshot.connection.market === "connected" &&
    snapshot.connection.worker === "recent_heartbeat";
  return (
    <section
      className="market-brain"
      ref={root}
      aria-label="Onkar AI Market Brain"
    >
      <header className="mb-header">
        <div>
          <div className="mb-eyebrow">
            <Brain size={18} />
            ONKAR AI · MARKET BRAIN
          </div>
          <h2>
            Market Scanner{" "}
            <span
              className={live ? "mb-badge mb-positive" : "mb-badge mb-warning"}
            >
              {live ? "● DATA FRESH" : "● NOT LIVE"}
            </span>
          </h2>
          <p className="mb-muted">
            Real data. Explainable rules. Account-aware risk.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh scanner"
        >
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
        </button>
      </header>
      <div className="mb-safety">
        <ShieldCheck size={16} />
        {snapshot?.runtime.emergencyStop
          ? "Emergency Stop active · new execution locked"
          : snapshot?.runtime.tradingMode === "AUTO" &&
              snapshot.runtime.autoExecutionEnabled
            ? "AUTO armed by server · approved rules and risk checks remain mandatory"
            : snapshot?.runtime.tradingMode === "CONFIRM"
              ? "Confirmation required before every execution"
              : "Analysis-only · execution disabled"}
        {" · "}score is confluence, not win probability
      </div>
      <nav className="mb-tabs" aria-label="Scanner views">
        {(
          [
            "Watchlist",
            "Rules",
            "Settings",
            "Connections",
            "Journal insights",
            "Replay",
          ] as MarketBrainTab[]
        ).map((t) => (
          <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="mb-body">
        {error && (
          <div className="mb-notice" role="alert">
            {error}
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {notice && (
          <p className="mb-success" role="status">
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              ×
            </button>
          </p>
        )}
        {!snapshot && !error && (
          <div
            className="mb-skeleton"
            aria-label="Loading scanner connection"
          />
        )}
        {snapshot && (
          <>
            {snapshot.connection.backend === "unconfigured" && (
              <p className="mb-notice">
                Scanner backend configuration is incomplete. Your existing
                journal, analytics and videos remain available. A server-only
                Supabase key and running worker are required to save settings
                and scan.
              </p>
            )}
            {tab === "Watchlist" && (
              <div className="mb-stack">
                <CommandCenterHero
                  snapshot={snapshot}
                  activeSetups={activeRuleCount}
                  onOpenScanner={() => root.current?.scrollIntoView({ behavior: "smooth" })}
                  onRefresh={() => void refresh()}
                />
                <AutomationControlBar
                  runtime={snapshot.runtime}
                  mt5Status={snapshot.connection.mt5 ?? "NOT CONFIGURED"}
                  executionAvailable={
                    snapshot.connection.executionWorker === "ready"
                  }
                  executionReason={
                    snapshot.connection.executionReason ??
                    "Windows MT5 Bridge and execution worker are required."
                  }
                  markets={snapshot.config?.config.symbols.length ?? 0}
                  onChanged={(message) => {
                    setNotice(message);
                    void refresh();
                  }}
                />
                <DataProviderManager
                  snapshot={snapshot}
                  busy={loading}
                  onSelect={(provider) => void switchTradingSource(provider)}
                  onTest={async () => {
                    try {
                      const health = await brainRequest<{
                        status: string;
                        message: string;
                      }>("/provider-health");
                      setNotice(`${health.status}: ${health.message}`);
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Provider test failed",
                      );
                    }
                  }}
                />
                <AccountCommandCarousel
                  snapshot={snapshot}
                  journalTrades={journalTrades}
                  onSelect={(accountId) => void selectAccount(accountId)}
                  onOpenTrade={onJournal}
                />
                <TradingLifecycle
                  candidate={ranked[0] ?? active[0] ?? null}
                  monitoringCount={activeRuleCount}
                  candidates={snapshot.candidates}
                  onStageSelect={(stage) =>
                    setStatus(stage === "SCANNING" ? "All" : stage)
                  }
                />
                <div className="mb-kpis">
                  {[
                    [
                      "Configured markets",
                      snapshot.config?.config.symbols.length ?? 0,
                    ],
                    ["Active setups", activeRuleCount],
                    [
                      "Ready · fresh",
                      active.filter((c) => c.state === "READY" && !c.staleNow)
                        .length,
                    ],
                    ["Alerts shown", snapshot.alerts.length],
                    ["AI calls today", snapshot.runs.length],
                  ].map(([label, count]) => (
                    <div className="mb-panel" key={label}>
                      <span className="mb-muted">{label}</span>
                      <strong className="mb-value">{count}</strong>
                    </div>
                  ))}
                </div>
                <div className="mb-row mb-wrap">
                  <label className="mb-search">
                    Search markets, setups or sessions
                    <input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Search watchlist…"
                    />
                  </label>
                  <label>
                    Status
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {[
                        "All",
                        "READY",
                        "WATCH",
                        "DEVELOPING",
                        "TRIGGERED",
                        "History",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Direction
                    <select
                      value={direction}
                      onChange={(e) => setDirection(e.target.value)}
                    >
                      {["All", "long", "short"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <SetupActivationPanel
                  snapshot={snapshot}
                  busy={loading}
                  onToggle={(versionId, enabled) => {
                    const ids = snapshot.config?.config
                      .autoActivateApprovedSetups
                      ? latestApprovedVersions(snapshot).map(
                          (version) => version.id,
                        )
                      : (snapshot.config?.config.strategyVersionIds ?? []);
                    void saveConfig(
                      {
                        autoActivateApprovedSetups: false,
                        strategyVersionIds: enabled
                          ? [...new Set([...ids, versionId])]
                          : ids.filter((id) => id !== versionId),
                      },
                      enabled
                        ? "Approved setup enabled for automatic detection."
                        : "Setup detection disabled. The approved version remains in your Library.",
                    );
                  }}
                />
                <LiveCandidateCarousel
                  snapshot={snapshot}
                  onOpen={setSelected}
                />
                {!ranked.length ? (
                  <div className="mb-empty">
                    <ScanLine size={32} />
                    <h3>
                      {active.length
                        ? "No setups match these filters"
                        : "Your scanner is waiting for evidence"}
                    </h3>
                    <p className="mb-muted">
                      Approve rules from your Setup Library, choose your markets
                      and account, then enable the background scanner. Only
                      real, qualified candidates appear here.
                    </p>
                    <button onClick={() => setTab("Rules")}>
                      Configure strategy rules
                    </button>
                  </div>
                ) : (
                  <div className="mb-candidates">
                    {ranked.map((c) => (
                      <button
                        className="mb-candidate"
                        key={c.id}
                        onClick={() => setSelected(c.id)}
                      >
                        <div className="mb-candidate-topline">
                          <span className="mb-market-pulse" />
                          <strong>{c.symbol}</strong>
                          <span
                            className={`mb-direction is-${c.payload.direction}`}
                          >
                            {c.payload.direction.toUpperCase()}
                          </span>
                          <span className="mb-score">
                            {c.score}
                            <small>/100</small>
                          </span>
                        </div>
                        <h3>{c.payload.strategyName}</h3>
                        <p className="mb-muted">
                          {c.timeframe} · HTF {c.payload.marketBias}
                        </p>
                        <div className="mb-row mb-between">
                          <span
                            className={`mb-badge ${c.staleNow ? "mb-warning" : c.state === "READY" ? "mb-positive" : ""}`}
                          >
                            {c.staleNow ? "STALE DATA" : c.state}
                          </span>
                          <span>
                            {c.payload.passed}/{c.payload.total} rules
                          </span>
                        </div>
                        <p className="mb-muted">
                          {c.payload.session} · News {c.payload.news.status}
                        </p>
                        <div className="mb-trade-plan">
                          <span>
                            <small>ENTRY</small>
                            {c.plan?.entry ?? "—"}
                          </span>
                          <span>
                            <small>SL</small>
                            {c.plan?.stop ?? "—"}
                          </span>
                          <span>
                            <small>TP</small>
                            {c.plan?.target ?? "—"}
                          </span>
                          <span>
                            <small>R:R</small>
                            {c.plan?.rr?.toFixed(2) ?? "—"}
                          </span>
                        </div>
                        <div className="mb-meter">
                          <span style={{ width: `${c.score}%` }} />
                        </div>
                        <p className="mb-candidate-time">
                          Data {new Date(c.last_candle_at).toLocaleString()}
                        </p>
                        <span className="mb-open-analysis">
                          Open full analysis →
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <MasterAIOrbitalHub onOpen={onOpenAgent} />
                <BossBriefing snapshot={snapshot} />
                <TradeCommandCenter
                  snapshot={snapshot}
                  onOpenJournal={onJournal}
                />
                {snapshot.config?.config ? (
                  <PermissionCenter
                    config={snapshot.config.config}
                    busy={loading}
                    onChange={(permissions) =>
                      void saveConfig(
                        { permissions },
                        "Permission Center updated for the shared scanner and execution router.",
                      )
                    }
                  />
                ) : null}
                <MarketSessionTimeline snapshot={snapshot} />
                <div className="mb-os-two-column">
                  <SystemActivityTimeline snapshot={snapshot} />
                  <JournalLearningPanel snapshot={snapshot} />
                </div>
                <div className="mb-row mb-wrap">
                  <button
                    disabled={!snapshot.config?.enabled}
                    onClick={async () => {
                      try {
                        const result = await brainRequest<{ message: string }>(
                          "/scan",
                          "POST",
                        );
                        setNotice(result.message);
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not queue scan",
                        );
                      }
                    }}
                  >
                    <ScanLine size={16} />
                    Queue scan
                  </button>
                  <button onClick={() => setTab("Settings")}>
                    <Settings2 size={16} />
                    Scanner settings
                  </button>
                </div>
                {snapshot.alerts.length > 0 && (
                  <section>
                    <h3>AI scanner alerts</h3>
                    {snapshot.alerts.slice(0, 8).map((a) => (
                      <div className="mb-panel" key={a.id}>
                        <button
                          className="mb-alert-link"
                          onClick={() => setSelected(a.candidate_id)}
                        >
                          {a.message}
                        </button>
                        <div className="mb-row mb-between">
                          <span className="mb-muted">
                            {new Date(a.created_at).toLocaleString()}
                          </span>
                          {!a.read_at && (
                            <button
                              onClick={async () => {
                                try {
                                  await brainRequest(
                                    `/alerts/${a.id}/read`,
                                    "POST",
                                  );
                                  void refresh();
                                } catch (e) {
                                  setError(
                                    e instanceof Error
                                      ? e.message
                                      : "Could not mark read",
                                  );
                                }
                              }}
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            )}
            {tab === "Rules" && (
              <RulesControlCenter
                snapshot={snapshot}
                onSaved={changed}
                onEditSetup={onEditSetup}
              />
            )}
            {tab === "Replay" && <ScannerReplay snapshot={snapshot} />}
            {tab === "Settings" && (
              <ScannerSettings snapshot={snapshot} onSaved={changed} />
            )}
            {tab === "Connections" && (
              <div className="mb-stack">
                <DataProviderManager
                  snapshot={snapshot}
                  busy={loading}
                  onSelect={(provider) =>
                    void saveConfig(
                      { provider },
                      "Primary market provider updated.",
                    )
                  }
                  onTest={() =>
                    void brainRequest<{ status: string; message: string }>(
                      "/provider-health",
                    )
                      .then((health) =>
                        setNotice(`${health.status}: ${health.message}`),
                      )
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Provider test failed",
                        ),
                      )
                  }
                />
                <MT5StatusPanel />
                <h3>Data & integrations</h3>
                <div className="mb-connection-grid">
                  {Object.entries(snapshot.connection).map(([label, value]) => (
                    <div className="mb-connection-card" key={label}>
                      <span className="mb-connection-orb" />
                      <span className="mb-muted">{label}</span>
                      <strong className="mb-value mb-status">
                        {value.replaceAll("_", " ")}
                      </strong>
                    </div>
                  ))}
                </div>
                <button
                  onClick={async () => {
                    try {
                      const health = await brainRequest<{
                        status: string;
                        message: string;
                      }>("/provider-health");
                      setNotice(`${health.status}: ${health.message}`);
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Health check failed",
                      );
                    }
                  }}
                >
                  Run real market-provider health check
                </button>
                <button
                  onClick={async () => {
                    try {
                      const health = await brainRequest<{
                        status: string;
                        model: string;
                        message: string;
                      }>("/openai-health");
                      setNotice(
                        `${health.status}: ${health.message} (${health.model})`,
                      );
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "OpenAI health check failed",
                      );
                    }
                  }}
                >
                  Verify OpenAI connection
                </button>
                <p>
                  Last scanner run:{" "}
                  {snapshot.config?.last_run_at
                    ? new Date(snapshot.config.last_run_at).toLocaleString()
                    : "Never"}
                </p>
                <p>
                  Last duration:{" "}
                  {snapshot.config?.last_duration_ms ?? "Unavailable"} ms
                </p>
                <p className="mb-warning">{snapshot.config?.last_error}</p>
                <p className="mb-muted">
                  Shared candle-close scanning; the Windows MT5 bridge owns the
                  terminal WebSocket/tick stream. MCP and vision are optional
                  adapters, not connected services. R2/video playback and the
                  existing chart remain unchanged. No “connected” badge is
                  inferred from an API key alone.
                </p>
              </div>
            )}
            {tab === "Journal insights" && (
              <div className="mb-stack">
                <h3>Your recorded performance</h3>
                {snapshot.journal ? (
                  <>
                    <p>
                      {snapshot.journal.trades} account trades ·{" "}
                      {snapshot.journal.knownPnl} with known P&L ·{" "}
                      {snapshot.journal.wins} wins / {snapshot.journal.losses}{" "}
                      losses
                    </p>
                    <p className="mb-notice">{snapshot.journal.caution}</p>
                    {(
                      [
                        ["By setup", snapshot.journal.bySetup],
                        ["By session", snapshot.journal.bySession],
                        ["By timeframe", snapshot.journal.byTimeframe],
                      ] as const
                    ).map(([title, rows]) => (
                      <section key={title}>
                        <h3>{title}</h3>
                        {rows.map((r) => (
                          <div
                            className="mb-panel mb-row mb-between"
                            key={r.key}
                          >
                            <span>
                              {snapshot.setups.find((s) => s.id === r.key)
                                ?.name ?? r.key}
                            </span>
                            <span>
                              {r.count} trades · {r.wins} wins ·{" "}
                              {r.pnl.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </section>
                    ))}
                  </>
                ) : (
                  <p className="mb-muted">
                    Select an account in scanner settings to compare real
                    journal history.
                  </p>
                )}
                <button onClick={onJournal}>Open existing journal</button>
              </div>
            )}
          </>
        )}
      </div>
      {current && (
        <CandidateDetail
          key={current.id}
          candidate={current}
          onClose={() => setSelected(null)}
          onJournal={onJournal}
          journalTrades={journalTrades}
        />
      )}
    </section>
  );
}
