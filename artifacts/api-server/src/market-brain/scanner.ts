import { createHash, randomUUID } from "node:crypto";
import {
  scannerConfigWithCurrentScorePolicy,
  strategyVersionSchema,
  timeframeMs,
  TWELVE_DATA_MIN_CYCLE_SECONDS,
  type Candle,
  type Timeframe,
  type CandidateState,
} from "@workspace/api-zod";
import { getMarketProvider } from "./providers";
import {
  analyzeCandidate,
  historicalMatches,
  nextLifecycle,
} from "./evaluation";
import { accountContext, journalPnl } from "./journal";
import {
  ScannerStore,
  records,
  type CandidateRow,
  type ConfigRow,
  type VersionRow,
} from "./store";
import { latestApprovedVersions } from "./strategy-selection";
import { newsCheck } from "./news";
import { OpenAIExplanationProvider } from "./ai";
import { openAIConfigured } from "../lib/openai";
import { logger } from "../lib/logger";
import {
  GLOBAL_WORKFLOW_TIMEFRAMES,
  globalWorkflowRequired,
} from "./global-workflow";
import { selectScannerMarketProvider } from "./provider-selection";
import { sharedProviderCandles } from "./shared-market";
import {
  paperInstrumentSizingFromRate,
  resolveInstrumentSizing,
} from "./risk-sizing";
import { NotificationService } from "../notifications/service";

export function effectiveScannerFrequencySeconds(
  config: Pick<ConfigRow["config"], "provider" | "frequencySeconds">,
) {
  return config.provider === "twelvedata"
    ? Math.max(TWELVE_DATA_MIN_CYCLE_SECONDS, config.frequencySeconds)
    : config.frequencySeconds;
}

export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const analysisFingerprint = (candidate: CandidateRow) =>
  fingerprint([
    candidate.id,
    candidate.last_candle_at,
    candidate.score,
    candidate.payload.rules.map((r) => [r.id, r.actual, r.passed]),
    candidate.payload.risk,
    candidate.payload.paperFastEntryApplied,
    candidate.state,
    candidate.plan,
    candidate.payload.news.status,
    candidate.payload.news.events,
    candidate.payload.tradingViewEvidence,
  ]);
const terminal = (state: CandidateState) =>
  ["INVALIDATED", "EXPIRED", "COMPLETED"].includes(state);
type StoredBar = {
  open_time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
};
export async function loadCandles(
  store: ScannerStore,
  providerName: string,
  symbol: string,
  tf: Timeframe,
  now: number,
): Promise<Candle[]> {
  const query = {
    provider: `eq.${providerName}`,
    symbol: `eq.${symbol}`,
    timeframe: `eq.${tf}`,
  };
  const stored = await store.request<StoredBar[]>("market_candles", {
    ...query,
    order: "open_time.desc",
    limit: "260",
  });
  const bars = stored.reverse().map((c) => ({
    t: Number(c.open_time),
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
    v: c.v,
  }));
  const last = bars.at(-1);
  if (last && last.t + 2 * timeframeMs[tf] > now && bars.length >= 220)
    return bars;
  const from =
    bars.length >= 220 && last
      ? last.t - timeframeMs[tf]
      : now - 260 * timeframeMs[tf];
  const fetched = await getMarketProvider(providerName).getHistoricalBars(
    symbol,
    tf,
    from,
    now,
  );
  if (fetched.length)
    await store.request(
      "market_candles",
      { on_conflict: "provider,symbol,timeframe,open_time" },
      "POST",
      fetched.map((c) => ({
        provider: providerName,
        symbol,
        timeframe: tf,
        open_time: c.t,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v,
      })),
      "resolution=merge-duplicates,return=minimal",
    );
  return [...new Map([...bars, ...fetched].map((c) => [c.t, c])).values()]
    .sort((a, b) => a.t - b.t)
    .slice(-260);
}

async function explain(
  store: ScannerStore,
  candidate: CandidateRow,
  job: ConfigRow,
) {
  const config = job.config;
  if (
    !openAIConfigured() ||
    candidate.score < config.aiThreshold ||
    candidate.payload.stale ||
    !config.maxAiCallsPerDay
  )
    return;
  const key = analysisFingerprint(candidate);
  const existing = await store.request<Array<{ id: string }>>(
    "scanner_ai_runs",
    {
      user_id: `eq.${job.user_id}`,
      created_at: `gte.${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
      select: "id,fingerprint",
      limit: "51",
    },
  );
  if (existing.length >= config.maxAiCallsPerDay) return;
  const duplicate = await store.request<Array<{ id: string }>>(
    "scanner_ai_runs",
    {
      user_id: `eq.${job.user_id}`,
      fingerprint: `eq.${key}`,
      select: "id",
      limit: "1",
    },
  );
  if (duplicate.length) return;
  const start = Date.now();
  // Durable reservation prevents duplicate token spend after request retries/restarts.
  const id = await store.rpc<string | null>("reserve_scanner_ai", {
    p_config: job.id,
    p_candidate: candidate.id,
    p_fingerprint: key,
    p_purpose: "explanation",
  });
  if (!id) return;
  await store.request("scanner_ai_runs", { id: `eq.${id}` }, "PATCH", {
    tool_calls: [
      "get_market_context",
      "evaluate_setup_rules",
      "calculate_risk",
      "get_historical_matches",
      "get_economic_events",
    ].map((name) => ({
      name,
      status: "succeeded",
      source: "server_calculated",
    })),
  });
  const p = candidate.payload;
  try {
    const result = await new OpenAIExplanationProvider().explain({
      symbol: candidate.symbol,
      strategy: p.strategyName,
      deterministicScore: candidate.score,
      state: candidate.state,
      rules: p.rules,
      risk: p.risk,
      bias: p.marketBias,
      session: p.session,
      news: p.news,
      historical: p.historical,
      warning: p.warnings,
      tradingViewEvidence: p.tradingViewEvidence,
      dataAt: p.lastCandleAt,
      instruction:
        "Explain only this evidence. Score is rule confluence, not win probability.",
    });
    await store.request("scanner_ai_runs", { id: `eq.${id}` }, "PATCH", {
      status: "succeeded",
      model: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      latency_ms: Date.now() - start,
      output: result.output,
    });
  } catch {
    await store.request("scanner_ai_runs", { id: `eq.${id}` }, "PATCH", {
      status: "failed",
      latency_ms: Date.now() - start,
      error:
        "AI explanation unavailable or invalid. Deterministic analysis remains available.",
    });
    logger.warn(
      { event: "scanner_ai_failure", runId: id },
      "Scanner explanation failed safely",
    );
  }
}

export async function runScannerJob(
  store: ScannerStore,
  job: ConfigRow,
  options: { budgetMs?: number } = {},
) {
  const started = Date.now(),
    config = scannerConfigWithCurrentScorePolicy(job.config),
    symbol = config.symbols[job.cursor % config.symbols.length],
    budgetMs = Math.max(15_000, options.budgetMs ?? 240_000),
    warmupBudget = Math.min(100_000, budgetMs * 0.42),
    evaluationBudget = Math.min(210_000, budgetMs * 0.72),
    aiBudget = Math.min(130_000, budgetMs * 0.5);
  let advance = false,
    error: string | null = null;
  const priorCoverage =
    job.health.setupCoverage &&
    typeof job.health.setupCoverage === "object" &&
    !Array.isArray(job.health.setupCoverage)
      ? (job.health.setupCoverage as Record<string, unknown>)
      : {};
  const priorSizingBySymbol =
    job.health.riskSizingBySymbol &&
    typeof job.health.riskSizingBySymbol === "object" &&
    !Array.isArray(job.health.riskSizingBySymbol)
      ? (job.health.riskSizingBySymbol as Record<
          string,
          Record<string, unknown>
        >)
      : {};
  let health: Record<string, unknown> = {
    status: "offline",
    checkedAt: new Date(started).toISOString(),
    symbol,
    ai: "unconfigured",
    mcp: "optional",
    vision: "not_configured",
    liveExecution: false,
    setupCoverage: priorCoverage,
  };
  try {
    if (!config.permissions.automaticScanning)
      throw new Error("Automatic scanning is disabled in Permission Center.");
    if (!config.permissions.automaticSetupDetection)
      throw new Error(
        "Automatic setup detection is disabled in Permission Center.",
      );
    // Expiry does not require a working provider. Preserve the last known data timestamp.
    const expired = await store.request<CandidateRow[]>("setup_candidates", {
      config_id: `eq.${job.id}`,
      expires_at: `lte.${new Date(started).toISOString()}`,
      state: "in.(SCANNING,DEVELOPING,WATCH,READY,TRIGGERED)",
      limit: "20",
    });
    for (const old of expired) {
      if (Date.now() - started > warmupBudget)
        throw new Error("Expiry cleanup continues in the next worker cycle.");
      await store.rpc("commit_scanner_candidate", {
        p_config: job.id,
        p_lease: job.lease_token,
        p_candidate: {
          ...old,
          state: "EXPIRED",
          payload: { ...old.payload, status: "EXPIRED", stale: true },
        },
        p_event: {
          key: "expiry",
          kind: "setup_expired",
          detail: { previous: old.state, state: "EXPIRED" },
        },
        p_alert: null,
      });
    }
    const queriedVersions = await store.request<VersionRow[]>(
      "scanner_strategy_versions",
      { user_id: `eq.${job.user_id}` },
    );
    const versions = latestApprovedVersions(queriedVersions).filter(
      (v) =>
        (config.autoActivateApprovedSetups ||
          config.strategyVersionIds.includes(v.id)) &&
        (!v.definition.symbols.length || v.definition.symbols.includes(symbol)),
    );
    if (!versions.length)
      throw new Error(
        "Approve and activate at least one strategy for this symbol.",
      );
    const source = await store.source(job.user_id);
    // Resolve one feed for the entire run. All timeframe histories, setup
    // engines and AI evidence below use this same source.
    const providerSelection = await selectScannerMarketProvider(
      config.provider,
    );
    const activeProvider = providerSelection.active;
    // Resolve account-currency economics before candle warmup. On constrained
    // Twelve Data plans this reserves the conversion credit once, then the
    // closed-candle cache can satisfy most timeframe reads.
    const now = Date.now();
    const accountRecord = records(source.tradingAccounts).find(
      (item) => item.id === config.accountId,
    );
    let sizing = null;
    let sizingError: string | null = null;
    let sizingCached = false;
    if (accountRecord) {
      try {
        sizing = await resolveInstrumentSizing({
          provider: activeProvider,
          symbol,
          accountCurrency: String(accountRecord.currency || "USD"),
          manualValue: config.risk.valuePerPriceUnit[symbol],
        });
        if (!sizing)
          sizingError = `${symbol} has no automatic contract specification; configure an explicit fallback value.`;
      } catch (sizingFailure) {
        const cached = priorSizingBySymbol[symbol];
        const cachedAt = Date.parse(String(cached?.checkedAt || ""));
        if (
          activeProvider === "twelvedata" &&
          Number(cached?.conversionRate) > 0 &&
          Number.isFinite(cachedAt) &&
          now - cachedAt <= 30 * 60_000
        ) {
          sizing = paperInstrumentSizingFromRate(
            symbol,
            String(accountRecord.currency || "USD"),
            Number(cached.conversionRate),
          );
          sizingCached = Boolean(sizing);
        }
        if (!sizing)
          sizingError =
            sizingFailure instanceof Error
              ? sizingFailure.message
              : "Instrument sizing is unavailable.";
      }
    }
    const sizingHealth = sizing
      ? {
          source: sizing.source,
          valuePerPriceUnit: sizing.valuePerPriceUnit,
          accountCurrency: sizing.accountCurrency,
          conversionRate: sizing.conversionRate,
          safetyFactor: sizing.safetyFactor ?? 1,
          volumeStep: sizing.volumeStep,
          checkedAt: new Date(now).toISOString(),
          cached: sizingCached,
        }
      : {
          source: "unavailable",
          reason: sizingError,
          checkedAt: new Date(now).toISOString(),
        };
    health = {
      ...health,
      riskSizing: sizingHealth,
      riskSizingBySymbol: {
        ...priorSizingBySymbol,
        [symbol]: sizingHealth,
      },
    };
    const required = new Set<Timeframe>(config.timeframes);
    if (globalWorkflowRequired(symbol))
      GLOBAL_WORKFLOW_TIMEFRAMES.forEach((timeframe) =>
        required.add(timeframe),
      );
    for (const v of versions) {
      const d = strategyVersionSchema.parse(v.definition);
      required.add(d.timeframe);
      required.add(d.higherTimeframe);
      d.rules.forEach((r) => required.add(r.timeframe));
    }
    const histories: Partial<Record<Timeframe, Candle[]>> = {};
    let sharedMarketCached = false;
    // Bounded resumeable warmup: fetched candles survive if this job exhausts its budget.
    for (const tf of required) {
      if (Date.now() - started > warmupBudget)
        throw new Error("History warmup continues in the next worker cycle.");
      if (activeProvider === "mt5" || activeProvider === "twelvedata") {
        const market = await sharedProviderCandles(
          store,
          activeProvider,
          symbol,
          tf,
          Date.now(),
          { cacheMode: "closed-candle" },
        );
        if (market.dataStatus === "unavailable")
          throw new Error(
            `${activeProvider === "mt5" ? "MT5" : "Twelve Data"} has no verified ${tf} candles for ${symbol}.`,
          );
        if (market.dataStatus === "cached") sharedMarketCached = true;
        histories[tf] = market.candles
          .filter((candle) => candle.closed)
          .map(({ closed: _closed, ...candle }) => candle);
      } else {
        histories[tf] = await loadCandles(
          store,
          activeProvider,
          symbol,
          tf,
          Date.now(),
        );
      }
    }
    const news = await newsCheck(symbol, config, now);
    const account = accountContext(
      source,
      config,
      symbol,
      now,
      sizing,
      sizingError,
    );
    health = {
      ...health,
      status: sharedMarketCached ? "degraded" : "connected",
      checkedAt: new Date(now).toISOString(),
      latencyMs: now - started,
      news: news.status,
      newsAt: news.checkedAt,
      ai: openAIConfigured() ? "configured_not_checked" : "unconfigured",
      requestedProvider: providerSelection.requested,
      marketProvider: activeProvider,
      fallback: providerSelection.fallback,
      providerMessage: providerSelection.warning,
      mt5:
        providerSelection.requested === "mt5"
          ? providerSelection.requestedHealth.status
          : "standby",
      twelveData:
        activeProvider === "twelvedata"
          ? providerSelection.activeHealth.status
          : "standby",
      liveExecution: activeProvider === "mt5",
    };
    const enrichedTrades = records(source.trades).map((t) => ({
      ...t,
      netPnl: journalPnl(t, config.risk.valuePerPriceUnit),
    }));
    const tradingViewEvidence = await store.request<
      Array<{ payload: unknown; created_at: string }>
    >("tradingview_webhook_events", {
      config_id: `eq.${job.id}`,
      "payload->>symbol": `eq.${symbol}`,
      created_at: `gte.${new Date(now - 30 * 60_000).toISOString()}`,
      order: "created_at.desc",
      limit: "10",
    });
    const setupEvaluations: Array<Record<string, unknown>> = [];
    for (const version of versions) {
      // Leave headroom under the five-minute lease for one bounded database write
      // and the finally release. Persisted work is safe to revisit next cycle.
      if (Date.now() - started > evaluationBudget)
        throw new Error(
          "Strategy evaluation continues in the next worker cycle.",
        );
      const previous = (
        await store.request<CandidateRow[]>("setup_candidates", {
          config_id: `eq.${job.id}`,
          version_id: `eq.${version.id}`,
          symbol: `eq.${symbol}`,
          order: "created_at.desc",
          limit: "1",
        })
      )[0];
      const old = previous && !terminal(previous.state) ? previous : undefined;
      // Once a plan exists its direction, like its stop and target, is immutable.
      const analysis = analyzeCandidate(
        old?.plan
          ? { ...version.definition, direction: old.payload.direction }
          : version.definition,
        histories,
        config,
        account,
        news,
        now,
        symbol,
        activeProvider === "twelvedata",
      );
      setupEvaluations.push({
        versionId: version.id,
        setupId: version.source_setup_id,
        name: version.name,
        symbol,
        timeframe: version.definition.timeframe,
        higherTimeframe: version.definition.higherTimeframe,
        direction: version.definition.direction,
        score: analysis.score,
        status: analysis.status,
        passed: analysis.passed,
        total: analysis.total,
        requiredMissing: analysis.rules
          .filter((rule) => rule.required && !rule.passed)
          .map((rule) => rule.id),
        lastCandleAt: analysis.lastCandleAt,
        analyzedAt: analysis.analyzedAt,
        stale: analysis.stale,
        paperFastEntryApplied: analysis.paperFastEntryApplied,
        readinessBlockers: analysis.readinessBlockers,
      });
      health.setupCoverage = {
        ...priorCoverage,
        [symbol]: {
          symbol,
          evaluated: setupEvaluations.length,
          eligible: versions.length,
          complete: setupEvaluations.length === versions.length,
          scannedAt: new Date(now).toISOString(),
          evaluations: setupEvaluations,
        },
      };
      if (analysis.stale) health.status = "degraded";
      health.lastCandleAt = analysis.lastCandleAt;
      // A terminal setup is never resurrected on the same detection candle.
      if (
        previous &&
        terminal(previous.state) &&
        previous.last_candle_at >= analysis.lastCandleAt
      )
        continue;
      if (!old && analysis.score < config.minimumScore) continue;
      let state: CandidateState = analysis.status,
        event = old ? "analysis_updated" : "setup_detected";
      const transitions: Array<{ key: string; kind: string; detail: unknown }> =
        [];
      if (old?.plan) {
        state = old.state;
        for (const bar of histories[version.definition.timeframe] ?? []) {
          if (bar.t <= Date.parse(old.last_candle_at)) continue;
          const next = nextLifecycle(
            state,
            bar,
            old.plan,
            old.payload.direction,
            Date.parse(old.expires_at),
            bar.t + timeframeMs[version.definition.timeframe],
          );
          if (next.event) {
            transitions.push({
              key: `${bar.t}:${next.event}`,
              kind: next.event,
              detail: {
                previous: state,
                state: next.state,
                dataAt: new Date(bar.t).toISOString(),
              },
            });
            state = next.state;
            event = next.event;
          }
          if (terminal(state)) break;
        }
        if (
          !terminal(state) &&
          state !== "TRIGGERED" &&
          analysis.status !== "READY"
        ) {
          state = analysis.status;
          event = state !== old.state ? "conditions_changed" : event;
        }
      }
      if (old && now >= Date.parse(old.expires_at) && !terminal(state)) {
        state = "EXPIRED";
        event = "setup_expired";
      }
      if (state === "READY" && old?.state !== "READY") event = "setup_ready";
      const candidate: CandidateRow = {
        id: old?.id ?? randomUUID(),
        user_id: job.user_id,
        config_id: job.id,
        version_id: version.id,
        symbol,
        timeframe: version.definition.timeframe,
        state,
        score: analysis.score,
        payload: {
          ...analysis,
          status: state,
          provider: activeProvider,
          providerFallback: providerSelection.fallback,
          providerWarning: providerSelection.warning,
          strategyName: version.name,
          scopeAccountId: config.accountId,
          tradingViewEvidence,
          historical: historicalMatches(
            enrichedTrades,
            version.source_setup_id,
            symbol,
            version.definition.timeframe,
            config.accountId,
          ),
        },
        plan: old?.plan ?? (state === "READY" ? analysis.risk : null),
        fingerprint:
          old?.fingerprint ??
          fingerprint([job.id, version.id, symbol, analysis.lastCandleAt]),
        last_candle_at: analysis.lastCandleAt,
        expires_at: old?.expires_at ?? analysis.expiresAt,
      };
      const alertKinds = [
        "setup_ready",
        "setup_invalidated",
        "stop_reached",
        "target_reached",
        "entry_zone_reached",
      ];
      const alert =
        config.permissions.automaticAlerts &&
        alertKinds.includes(event) &&
        !analysis.stale
          ? {
              kind: event,
              key: `${candidate.id}:${event}`,
              message: `${symbol} · ${version.name} · ${event.replaceAll("_", " ")} · rule confluence ${analysis.score}/100. Review risk and news before making any decision.`,
            }
          : null;
      if (!config.permissions.automaticCandidateCreation) continue;
      await store.rpc("commit_scanner_candidate", {
        p_config: job.id,
        p_lease: job.lease_token,
        p_candidate: candidate,
        p_event: [
          ...transitions,
          {
            key: `${analysis.lastCandleAt}:${event}:${analysis.score}`,
            kind: event,
            detail: {
              previous: old?.state ?? null,
              state,
              score: analysis.score,
              dataAt: analysis.lastCandleAt,
              globalWorkflow: analysis.globalWorkflow
                ? {
                    status: analysis.globalWorkflow.masterStatus,
                    gate: analysis.globalWorkflow.gate.status,
                    reaction: analysis.globalWorkflow.thirtyMinute.reaction,
                    candleClosed:
                      analysis.globalWorkflow.thirtyMinute.candle.closed,
                  }
                : null,
            },
          },
        ],
        p_alert: alert,
      });
      await new NotificationService(store)
        .candidate(candidate, event)
        .catch((notificationError) =>
          logger.warn(
            { err: notificationError, candidateId: candidate.id },
            "Notification update failed without interrupting scanning",
          ),
        );
      if (
        config.permissions.aiAnalysis &&
        !terminal(state) &&
        Date.now() - started < aiBudget
      )
        await explain(store, candidate, { ...job, config });
      logger.info(
        { event, candidateId: candidate.id, symbol, score: candidate.score },
        "Scanner candidate saved",
      );
    }
    logger.info(
      {
        event: "scanner_setup_coverage",
        symbol,
        evaluated: setupEvaluations.length,
        eligible: versions.length,
        complete: setupEvaluations.length === versions.length,
        lastCandleAt: health.lastCandleAt,
      },
      "Scanner evaluated every eligible setup against shared market data",
    );
    advance = true;
  } catch (e) {
    error = e instanceof Error ? e.message : "Scanner failed";
    // All upstream modules sanitize errors; no provider URLs or credentials in logs.
    logger.warn(
      { event: "scanner_job_failure", configId: job.id, message: error },
      "Scanner cycle incomplete",
    );
  } finally {
    const delay = advance
      ? Math.max(
          15,
          effectiveScannerFrequencySeconds(config) / config.symbols.length,
        )
      : 60;
    await store.request(
      "scanner_configs",
      { id: `eq.${job.id}`, lease_token: `eq.${job.lease_token}` },
      "PATCH",
      {
        cursor: advance ? (job.cursor + 1) % config.symbols.length : job.cursor,
        lease_until: null,
        lease_token: null,
        last_run_at: new Date().toISOString(),
        last_duration_ms: Date.now() - started,
        last_error: error,
        health,
        next_run_at: new Date(Date.now() + delay * 1000).toISOString(),
      },
    );
    if (error) {
      // Uncertain data must never remain armed for a new automatic entry.
      await store
        .request(
          "scanner_runtime_controls",
          { user_id: `eq.${job.user_id}`, auto_execution_enabled: "eq.true" },
          "PATCH",
          {
            auto_execution_enabled: false,
            updated_at: new Date().toISOString(),
          },
          "return=minimal",
        )
        .catch((pauseError) =>
          logger.error(
            { err: pauseError },
            "Failed to persist automatic execution pause",
          ),
        );
    } else if (
      config.provider === "twelvedata" &&
      health.status === "connected"
    ) {
      // A transient provider failure pauses the execution flag but preserves
      // AUTO as the user's requested mode. Restore it only after a complete,
      // fresh scanner cycle; explicit user disable switches mode to CONFIRM.
      await store
        .request(
          "scanner_runtime_controls",
          {
            user_id: `eq.${job.user_id}`,
            trading_mode: "eq.AUTO",
            auto_execution_enabled: "eq.false",
            emergency_stop: "eq.false",
            scanner_state: "eq.RUNNING",
          },
          "PATCH",
          {
            auto_execution_enabled: true,
            updated_at: new Date().toISOString(),
          },
          "return=minimal",
        )
        .catch((resumeError) =>
          logger.error(
            { err: resumeError },
            "Failed to restore automatic execution after fresh data",
          ),
        );
    }
    await new NotificationService(store)
      .systemHealth({
        userId: job.user_id,
        component: "Market scanner",
        healthy: !error && health.status !== "offline",
        message: error
          ? `${error} New automatic entries were paused; existing positions remain managed by their execution provider.`
          : "Scanner cycle completed with fresh shared market data.",
        metadata: {
          symbol,
          health: health.status,
          checkedAt: health.checkedAt,
        },
      })
      .catch((notificationError) =>
        logger.warn(
          { err: notificationError },
          "System health notification failed",
        ),
      );
  }
  return { symbol, success: !error, error };
}
export async function runNextJob(
  configId?: string,
  options: { budgetMs?: number } = {},
) {
  const store = ScannerStore.service();
  const [job] = await store.rpc<ConfigRow[]>("claim_scanner_job", {
    p_config: configId ?? null,
  });
  return job
    ? runScannerJob(store, job, options)
    : { success: true, idle: true };
}
