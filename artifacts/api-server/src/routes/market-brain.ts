import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  scannerConfigSchema,
  strategyVersionSchema,
  scannerChatSchema,
  backtestRequestSchema,
  masterAIRequestSchema,
  sharedChartSymbolSchema,
  sharedChartTimeframeSchema,
  scannerRuntimeSchema,
  scannerRuntimeUpdateSchema,
  scannerControlSchema,
  notificationPreferencesSchema,
  timeframeMs,
  type Candle,
  type Timeframe,
} from "@workspace/api-zod";
import { requireSupabaseUser } from "../lib/supabase-auth";
import {
  ScannerStore,
  ScannerError,
  records,
  type ConfigRow,
  type CandidateRow,
  type VersionRow,
} from "../market-brain/store";
import {
  fingerprint,
  analysisFingerprint,
  effectiveScannerFrequencySeconds,
  runNextJob,
} from "../market-brain/scanner";
import { getMarketProvider } from "../market-brain/providers";
import { secretHash, verifyWebhook } from "../market-brain/webhook";
import { journalSummary } from "../market-brain/journal";
import { accountContext } from "../market-brain/journal";
import { backtest } from "../market-brain/backtest";
import { ScannerTools } from "../market-brain/tools";
import { OpenAIExplanationProvider } from "../market-brain/ai";
import { openAIConfigured, openAIHealth } from "../lib/openai";
import { runMasterAI } from "../onkar-ai/orchestrator";
import { runNextLearningJob } from "../onkar-ai/learning-worker";
import { runNextKnowledgeJob } from "../onkar-ai/knowledge-service";
import { getSharedMarketSnapshot } from "../market-brain/shared-market";
import { compileLibrarySetup } from "../market-brain/strategy-compiler";
import { latestApprovedVersions } from "../market-brain/strategy-selection";
import { syncConfiguredMT5Journal } from "../mt5/journal-sync";
import {
  getExecutionCapability,
  reconcileExecution,
  runNextExecution,
} from "../market-brain/execution-router";
import { selectScannerMarketProvider } from "../market-brain/provider-selection";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const requestTimes = new Map<string, number[]>();
function rateLimit(key: string, maximum: number) {
  const now = Date.now();
  if (requestTimes.size > 5000)
    for (const [k, times] of requestTimes)
      if (times.at(-1)! < now - 60_000) requestTimes.delete(k);
  if (requestTimes.size >= 5000 && !requestTimes.has(key))
    throw new ScannerError("Server is busy. Retry in one minute.", 429);
  const recent = (requestTimes.get(key) ?? []).filter((t) => t > now - 60_000);
  if (recent.length >= maximum)
    throw new ScannerError("Rate limit reached. Try again in one minute.", 429);
  requestTimes.set(key, [...recent, now]);
}
const uuid = (input: unknown) => {
  const id = String(input);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new ScannerError("Invalid identifier", 400);
  return id;
};
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (e) {
      const status = e instanceof ScannerError ? e.status : 500;
      if (status >= 500)
        logger.error(
          {
            err: e,
            method: req.method,
            path: req.path,
            status,
          },
          "Market Brain request failed",
        );
      res.status(status).json({
        error:
          e instanceof ScannerError
            ? e.message
            : "Scanner request failed. Retry shortly; existing app data is unaffected.",
      });
    }
  };
}

async function validCronAuthorization(header: string | undefined) {
  const secret = process.env.CRON_SECRET;
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  if (secret && secret.length >= 32) {
    const expectedBytes = Buffer.from(secret);
    const suppliedBytes = Buffer.from(supplied);
    if (
      expectedBytes.length === suppliedBytes.length &&
      timingSafeEqual(expectedBytes, suppliedBytes)
    )
      return true;
  }
  try {
    return await ScannerStore.service().rpc<boolean>(
      "verify_onkar_scanner_cron_secret",
      { candidate: supplied },
    );
  } catch {
    return false;
  }
}

async function requireCronAuthorization(req: Request) {
  const schedulerSecret =
    typeof req.headers["x-onkar-cron-secret"] === "string"
      ? req.headers["x-onkar-cron-secret"]
      : req.headers.authorization;
  const authorization = schedulerSecret?.startsWith("Bearer ")
    ? schedulerSecret
    : schedulerSecret
      ? `Bearer ${schedulerSecret}`
      : undefined;
  if (!(await validCronAuthorization(authorization)))
    throw new ScannerError("Unauthorized", 401);
}

const cronHandler = route(async (req, res) => {
  await requireCronAuthorization(req);
  if (process.env.SCANNER_ENABLED !== "true")
    throw new ScannerError("Scanner background processing is disabled", 503);
  const [result, mt5Journal] = await Promise.all([
    runNextJob(undefined, { budgetMs: 48_000 }),
    syncConfiguredMT5Journal().catch((error) => ({
      skipped: true,
      reason:
        error instanceof Error ? error.message : "MT5 journal sync failed",
    })),
  ]);
  const learning = await runNextLearningJob();
  const knowledge = await runNextKnowledgeJob();
  const execution = await runNextExecution().catch((error) => ({
    skipped: true,
    reason:
      error instanceof Error
        ? error.message
        : "AUTO execution worker failed safely",
  }));
  res.json({
    ok: true,
    result,
    mt5Journal,
    learning,
    knowledge,
    execution,
    checkedAt: new Date().toISOString(),
  });
});

// Vercel Cron uses GET; Supabase Cron/pg_net uses POST. Both require the same
// dedicated CRON_SECRET and execute one lease-protected bounded job.
router.get("/market-brain/cron", cronHandler);
router.post("/market-brain/cron", cronHandler);
router.post(
  "/market-brain/provider-health/cron",
  route(async (req, res) => {
    await requireCronAuthorization(req);
    const selection = await selectScannerMarketProvider("twelvedata");
    res.json({
      ...selection.activeHealth,
      activeProvider: selection.active,
      requestedProvider: selection.requested,
      fallback: selection.fallback,
      warning: selection.warning,
    });
  }),
);
async function context(req: Request) {
  let identity;
  try {
    identity = await requireSupabaseUser(req.headers.authorization);
  } catch {
    throw new ScannerError("Please log in again to access your scanner.", 401);
  }
  rateLimit(`user:${identity.userId}`, 45);
  const user = ScannerStore.user(identity);
  const [config] = await user.request<ConfigRow[]>("scanner_configs", {
    user_id: `eq.${identity.userId}`,
    limit: "1",
  });
  return {
    identity,
    user,
    config: config
      ? { ...config, config: scannerConfigSchema.parse(config.config) }
      : undefined,
  };
}
type RuntimeRow = {
  scanner_state: "RUNNING" | "PAUSED" | "STOPPED";
  trading_mode: "ANALYSIS" | "CONFIRM" | "AUTO";
  auto_start: boolean;
  auto_execution_enabled: boolean;
  emergency_stop: boolean;
  trading_source: "MT5" | "TWELVE_DATA";
  mt5_disconnect_behavior: "LOCK" | "PAPER" | "ANALYSIS";
  auto_return_mt5: boolean;
  fallback_from_mt5: boolean;
  source_activated_at: string;
  reconciled_at: string | null;
  updated_at: string;
};
const runtimeValue = (row?: RuntimeRow) =>
  scannerRuntimeSchema.parse({
    scannerState: row?.scanner_state,
    tradingMode: row?.trading_mode,
    tradingSource: row?.trading_source,
    mt5DisconnectBehavior: row?.mt5_disconnect_behavior,
    autoReturnMt5: row?.auto_return_mt5,
    autoStart: row?.auto_start,
    autoExecutionEnabled: row?.auto_execution_enabled,
    emergencyStop: row?.emergency_stop,
    reconciledAt: row?.reconciled_at,
    sourceActivatedAt: row?.source_activated_at,
    updatedAt: row?.updated_at ?? null,
  });
router.get(
  "/market-brain",
  route(async (req, res) => {
    const { identity, user, config } = await context(req);
    const [
      candidates,
      alerts,
      setupEvents,
      executionEvents,
      paperTrades,
      versions,
      runs,
      source,
      runtimeRows,
    ] = await Promise.all([
      user.request<CandidateRow[]>("setup_candidates", {
        order: "updated_at.desc",
        limit: "100",
      }),
      user.request("scanner_alerts", {
        order: "created_at.desc",
        limit: "50",
      }),
      user.request<
        Array<{
          id: string;
          candidate_id: string;
          kind: string;
          detail: Record<string, unknown>;
          created_at: string;
        }>
      >("setup_events", {
        order: "created_at.desc",
        limit: "100",
      }),
      user
        .request<
          Array<{
            id: string;
            candidate_id: string | null;
            state: string;
            reason: string | null;
            detail: Record<string, unknown>;
            created_at: string;
          }>
        >("scanner_execution_events", {
          order: "created_at.desc",
          limit: "100",
        })
        .catch(() => []),
      user.request("paper_trades", {
        order: "opened_at.desc",
        limit: "100",
      }),
      user.request<VersionRow[]>("scanner_strategy_versions", {
        order: "created_at.desc",
        limit: "100",
      }),
      user.request<Array<{ status: string; created_at: string }>>(
        "scanner_ai_runs",
        {
          select: "id,status,model,latency_ms,created_at",
          created_at: `gte.${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
          order: "created_at.desc",
          limit: "100",
        },
      ),
      user.source(identity.userId),
      user
        .request<RuntimeRow[]>("scanner_runtime_controls", { limit: "1" })
        .catch(() => []),
    ]);
    const runtime = runtimeValue(runtimeRows[0]);
    const executionCapability = await getExecutionCapability(
      identity.userId,
      runtime.tradingSource,
      runtime.tradingSource === "TWELVE_DATA" ? config : undefined,
    );
    const age = config?.last_run_at
      ? Date.now() - Date.parse(config.last_run_at)
      : Infinity;
    const effectiveFrequency = config
      ? effectiveScannerFrequencySeconds(config.config)
      : scannerConfigSchema.parse({}).frequencySeconds;
    const fresh =
      config && age < Math.max(180_000, effectiveFrequency * 2000);
    let backendReady = false;
    try {
      ScannerStore.service();
      backendReady = true;
    } catch {
      /* honest unconfigured status */
    }
    res.json({
      config: config
        ? { ...config, lease_token: undefined, lease_until: undefined }
        : null,
      defaults: scannerConfigSchema.parse({}),
      candidates: candidates
        .filter(
          (c) =>
            c.payload.scopeAccountId === (config?.config.accountId ?? null),
        )
        .map((c) => {
          const { contexts: _contexts, ...payload } = c.payload;
          return {
            ...c,
            payload,
            staleNow:
              !fresh ||
              c.payload.stale ||
              Date.now() - Date.parse(c.payload.analyzedAt) >
                effectiveFrequency * 2000,
          };
        }),
      alerts,
      activity: [
        ...setupEvents.map((event) => ({
          id: event.id,
          candidate_id: event.candidate_id,
          kind: event.kind,
          source: "SCANNER" as const,
          reason: null,
          detail: event.detail,
          created_at: event.created_at,
        })),
        ...executionEvents.map((event) => ({
          id: event.id,
          candidate_id: event.candidate_id,
          kind: event.state,
          source: "EXECUTION" as const,
          reason: event.reason,
          detail: event.detail,
          created_at: event.created_at,
        })),
      ]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 100),
      paperTrades,
      versions,
      runs,
      accounts: records(source.tradingAccounts).map((a) => ({
        id: a.id,
        name: a.alias || a.accountNumber,
        currency: a.currency,
        type: a.accountType,
        broker: a.broker,
        accountNumber: a.accountNumber,
        source: a.source,
        balance: Number.isFinite(Number(a.balance ?? a.startingBalance))
          ? Number(a.balance ?? a.startingBalance)
          : null,
      })),
      setups: records(source.setups).map((s) => ({
        id: s.id,
        name: s.name,
        direction: s.direction,
        timeframe: s.timeframe,
        rules: s.rules,
        description: s.description,
      })),
      journal: config ? journalSummary(source, config.config) : null,
      connection: {
        database: "connected",
        backend: backendReady ? "configured" : "unconfigured",
        market: fresh ? (config?.health.status ?? "unconfigured") : "offline",
        worker: fresh ? "recent_heartbeat" : "not_running_or_stale",
        mcp: "optional_not_configured",
        vision: "optional_not_configured",
        execution: runtimeRows[0]?.emergency_stop
          ? "emergency_stopped"
          : runtimeRows[0]?.auto_execution_enabled
            ? "auto_enabled"
            : runtimeRows[0]?.trading_mode === "CONFIRM"
              ? "confirmation_required"
              : "analysis_only",
        mt5:
          runtime.tradingSource === "MT5"
            ? executionCapability.state === "READY"
              ? "connected"
              : executionCapability.state.toLowerCase()
            : String(config?.health.mt5 ?? "standby"),
        twelveData:
          runtime.tradingSource === "TWELVE_DATA"
            ? executionCapability.state === "READY"
              ? "connected"
              : executionCapability.state.toLowerCase()
            : String(config?.health.twelveData ?? "standby"),
        tradingSource: runtime.tradingSource.toLowerCase(),
        executionProvider: runtime.tradingSource === "MT5" ? "mt5" : "paper",
        executionBroker: executionCapability.broker ?? "not connected",
        executionAccountType: executionCapability.accountType ?? "unknown",
        executionWorker: executionCapability.ready ? "ready" : "unavailable",
        executionReason: executionCapability.reason,
        ai:
          runs[0] && Date.now() - Date.parse(runs[0].created_at) < 300_000
            ? runs[0].status === "succeeded"
              ? "connected"
              : runs[0].status
            : openAIConfigured()
              ? "configured_not_checked"
              : "unconfigured",
        economicCalendar:
          fresh && config?.health.news !== "unavailable"
            ? String(config?.health.news || "not_checked")
            : "unavailable",
        storage: "existing_R2_not_checked_by_scanner",
      },
      runtime,
    });
  }),
);
router.put(
  "/market-brain/runtime",
  route(async (req, res) => {
    const { identity, user, config } = await context(req);
    if (!config) throw new ScannerError("Save scanner settings first.", 409);
    const parsed = scannerRuntimeUpdateSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError(
        parsed.error.issues.map((issue) => issue.message).join("; "),
        400,
      );
    const store = ScannerStore.service();
    const currentRuntime = await store.request<RuntimeRow[]>(
      "scanner_runtime_controls",
      { user_id: `eq.${identity.userId}`, limit: "1" },
    );
    if (currentRuntime[0]?.emergency_stop && parsed.data.autoExecutionEnabled)
      throw new ScannerError(
        "Emergency Stop is active. Reconciliation is required before AUTO can be armed again.",
        409,
      );
    const sourceChanged =
      currentRuntime[0]?.trading_source !== parsed.data.tradingSource;
    const appSource = await user.source(identity.userId);
    if (
      parsed.data.tradingSource === "TWELVE_DATA" &&
      !records(appSource.tradingAccounts).some(
        (account) => account.id === config.config.accountId,
      )
    )
      throw new ScannerError(
        "Select an Onkar Paper account before using Twelve Data Paper trading.",
        409,
      );
    if (
      parsed.data.autoExecutionEnabled ||
      parsed.data.tradingMode === "AUTO"
    ) {
      const permissions = config.config.permissions;
      if (
        !permissions.automaticScanning ||
        !permissions.automaticSetupDetection ||
        !permissions.automaticCandidateCreation ||
        !permissions.automaticRiskCalculation ||
        !permissions.automaticOrderPreparation
      )
        throw new ScannerError(
          "Enable scanning, setup detection, candidate creation, risk calculation and order preparation in Permission Center before arming AUTO.",
          409,
        );
      if (
        parsed.data.tradingSource === "TWELVE_DATA" &&
        !permissions.paperTradeExecution
      )
        throw new ScannerError(
          "Enable Paper-trade execution in Permission Center before arming Twelve Data AUTO.",
          409,
        );
      if (
        parsed.data.tradingSource === "MT5" &&
        !permissions.mt5LiveExecution
      )
        throw new ScannerError(
          "Enable MT5 live execution in Permission Center before arming MT5 AUTO.",
          409,
        );
      const versions = await store.request<VersionRow[]>(
        "scanner_strategy_versions",
        { user_id: `eq.${identity.userId}` },
      );
      if (
        !latestApprovedVersions(versions).some(
          (version) =>
            (config.config.autoActivateApprovedSetups ||
              config.config.strategyVersionIds.includes(version.id)) &&
            version.definition.approval === "approved" &&
            version.definition.autoExecutionAllowed === true,
        )
      )
        throw new ScannerError(
          "Approve at least one active rule version with AUTO execution permission.",
          409,
        );
    }
    if (sourceChanged) {
      const provider = getMarketProvider(
        parsed.data.tradingSource === "MT5" ? "mt5" : "twelvedata",
      );
      const health = await provider.healthCheck();
      if (health.status !== "connected")
        throw new ScannerError(health.message, 409);
    }
    if (
      parsed.data.autoExecutionEnabled ||
      parsed.data.tradingMode === "AUTO"
    ) {
      const capability = await reconcileExecution(
        identity.userId,
        parsed.data.tradingSource,
        parsed.data.tradingSource === "TWELVE_DATA" ? config : undefined,
      );
      if (!capability.ready) throw new ScannerError(capability.reason, 409);
    }
    if (sourceChanged) {
      await store.rpc("configure_scanner", {
        p_user: identity.userId,
        p_workspace: config.workspace_id,
        p_config: {
          ...config.config,
          provider: parsed.data.tradingSource === "MT5" ? "mt5" : "twelvedata",
        },
      });
    }
    await store.request(
      "scanner_runtime_controls",
      { on_conflict: "user_id" },
      "POST",
      {
        user_id: identity.userId,
        workspace_id: config.workspace_id,
        scanner_config_id: config.id,
        scanner_state: parsed.data.scannerState,
        trading_mode: parsed.data.tradingMode,
        trading_source: parsed.data.tradingSource,
        mt5_disconnect_behavior: parsed.data.mt5DisconnectBehavior,
        auto_return_mt5: parsed.data.autoReturnMt5,
        fallback_from_mt5: false,
        auto_start: parsed.data.autoStart,
        auto_execution_enabled: parsed.data.autoExecutionEnabled,
        emergency_stop: currentRuntime[0]?.emergency_stop ?? false,
        reconciled_at:
          parsed.data.tradingMode === "AUTO" ? new Date().toISOString() : null,
        source_activated_at: sourceChanged
          ? new Date().toISOString()
          : (currentRuntime[0]?.source_activated_at ??
            new Date().toISOString()),
        updated_at: new Date().toISOString(),
      },
      "resolution=merge-duplicates,return=minimal",
    );
    res.json({ saved: true });
  }),
);
router.post(
  "/market-brain/control",
  route(async (req, res) => {
    const { identity, config } = await context(req);
    if (!config) throw new ScannerError("Save scanner settings first.", 409);
    const parsed = scannerControlSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError("Invalid scanner control action.", 400);
    const action = parsed.data.action;
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (action === "PAUSE") patch.scanner_state = "PAUSED";
    if (action === "RESUME") patch.scanner_state = "RUNNING";
    if (action === "STOP") patch.scanner_state = "STOPPED";
    if (action === "DISABLE_AUTO") {
      patch.trading_mode = "CONFIRM";
      patch.auto_execution_enabled = false;
    }
    if (action === "EMERGENCY_STOP") {
      patch.scanner_state = "PAUSED";
      patch.trading_mode = "ANALYSIS";
      patch.auto_execution_enabled = false;
      patch.emergency_stop = true;
    }
    const existing = await ScannerStore.service().request<RuntimeRow[]>(
      "scanner_runtime_controls",
      { user_id: `eq.${identity.userId}`, limit: "1" },
    );
    if (existing[0])
      await ScannerStore.service().request(
        "scanner_runtime_controls",
        { user_id: `eq.${identity.userId}` },
        "PATCH",
        patch,
      );
    else
      await ScannerStore.service().request(
        "scanner_runtime_controls",
        {},
        "POST",
        {
          user_id: identity.userId,
          workspace_id: config.workspace_id,
          scanner_config_id: config.id,
          scanner_state: patch.scanner_state ?? "STOPPED",
          trading_mode: patch.trading_mode ?? "ANALYSIS",
          auto_execution_enabled: patch.auto_execution_enabled ?? false,
          emergency_stop: patch.emergency_stop ?? false,
          auto_start: false,
        },
      );
    res.json({ saved: true, action });
  }),
);
router.get(
  "/market-brain/shared-market",
  route(async (req, res) => {
    const { user, config } = await context(req);
    const symbol = sharedChartSymbolSchema.safeParse(
      String(req.query.symbol || "")
        .toUpperCase()
        .replace(/[/-]/g, ""),
    );
    const timeframe = sharedChartTimeframeSchema.safeParse(
      String(req.query.timeframe || "").toLowerCase(),
    );
    if (!symbol.success || !timeframe.success)
      throw new ScannerError(
        "Choose a supported watchlist symbol and a 15M, 30M, 1H or 4H timeframe.",
        400,
      );
    rateLimit(`chart:${config?.user_id || "user"}`, 20);
    res.json(
      await getSharedMarketSnapshot({
        user,
        config,
        symbol: symbol.data,
        timeframe: timeframe.data,
      }),
    );
  }),
);
router.put(
  "/market-brain/config",
  route(async (req, res) => {
    const { identity, user, config } = await context(req);
    const parsed = scannerConfigSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .slice(0, 4)
          .join("; "),
        400,
      );
    const source = await user.source(identity.userId);
    if (
      parsed.data.accountId &&
      !records(source.tradingAccounts).some(
        (a) => a.id === parsed.data.accountId,
      )
    )
      throw new ScannerError("Select one of your existing accounts.", 400);
    const versions = await user.request<VersionRow[]>(
      "scanner_strategy_versions",
    );
    const selectableVersions = latestApprovedVersions(versions);
    if (
      parsed.data.strategyVersionIds.some(
        (id) =>
          !selectableVersions.some(
            (v) => v.id === id && v.definition.approval === "approved",
          ),
      )
    )
      throw new ScannerError(
        "Only your approved rule versions can be scanned.",
        400,
      );
    if (
      parsed.data.enabled &&
      !parsed.data.autoActivateApprovedSetups &&
      !parsed.data.strategyVersionIds.length
    )
      throw new ScannerError(
        "Approve a rule version before enabling scanning.",
        400,
      );
    const memberships = await user.request<Array<{ workspace_id: string }>>(
      "workspace_members",
      { user_id: `eq.${identity.userId}`, limit: "1" },
    );
    if (!memberships[0])
      throw new ScannerError(
        "No existing workspace found. Open your journal once, then retry.",
        409,
      );
    const store = ScannerStore.service();
    // Cancel/fence any in-flight job when risk, account or strategy selection changes.
    await store.rpc("configure_scanner", {
      p_user: identity.userId,
      p_workspace: config?.workspace_id ?? memberships[0].workspace_id,
      p_config: parsed.data,
    });
    res.json({ saved: true });
  }),
);
router.post(
  "/market-brain/strategies",
  route(async (req, res) => {
    const { identity, user, config } = await context(req);
    const result = strategyVersionSchema.safeParse(req.body);
    if (!result.success)
      throw new ScannerError(
        result.error.issues
          .map((i) => i.message)
          .slice(0, 4)
          .join("; "),
        400,
      );
    const source = await user.source(identity.userId);
    if (!records(source.setups).some((s) => s.id === result.data.sourceSetupId))
      throw new ScannerError(
        "Choose a setup from your existing Setup Library.",
        400,
      );
    const memberships = await user.request<Array<{ workspace_id: string }>>(
      "workspace_members",
      { user_id: `eq.${identity.userId}`, limit: "1" },
    );
    if (!memberships[0])
      throw new ScannerError("Existing workspace not found.", 409);
    const row = await ScannerStore.service().request(
      "scanner_strategy_versions",
      {},
      "POST",
      {
        user_id: identity.userId,
        workspace_id: config?.workspace_id ?? memberships[0].workspace_id,
        source_setup_id: result.data.sourceSetupId,
        name: result.data.name,
        definition: result.data,
        fingerprint: fingerprint(result.data),
      },
    );
    res.status(201).json(row);
  }),
);
router.post(
  "/market-brain/strategies/sync-library",
  route(async (req, res) => {
    const { identity, user, config } = await context(req);
    const [source, memberships] = await Promise.all([
      user.source(identity.userId),
      user.request<Array<{ workspace_id: string }>>("workspace_members", {
        user_id: `eq.${identity.userId}`,
        limit: "1",
      }),
    ]);
    if (!memberships[0])
      throw new ScannerError("Existing workspace not found.", 409);
    const compiled = records(source.setups)
      .map((setup) =>
        compileLibrarySetup(setup, { approveCanonical: true }),
      )
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (!compiled.length) {
      res.json({
        synced: 0,
        message: "No setup with explicit rules was available to compile.",
      });
      return;
    }
    await ScannerStore.service().request(
      "scanner_strategy_versions",
      { on_conflict: "user_id,source_setup_id,fingerprint" },
      "POST",
      compiled.map((definition) => ({
        user_id: identity.userId,
        workspace_id: config?.workspace_id ?? memberships[0].workspace_id,
        source_setup_id: definition.sourceSetupId,
        name: definition.name,
        definition,
        fingerprint: fingerprint(definition),
      })),
      "resolution=ignore-duplicates,return=minimal",
    );
    res.json({
      synced: compiled.length,
      approval: "approved_canonical",
      message:
        "Canonical Onkar workflows are approved and scanner-ready. Custom extracted rules still require explicit approval.",
    });
  }),
);
router.post(
  "/market-brain/scan",
  route(async (req, res) => {
    const { identity, config } = await context(req);
    if (!config?.enabled)
      throw new ScannerError("Enable the scanner in settings first.", 400);
    if (
      config.last_run_at &&
      Date.now() - Date.parse(config.last_run_at) < 60_000
    )
      throw new ScannerError("Scanner cooldown: please wait one minute.", 429);
    await ScannerStore.service().request(
      "scanner_configs",
      { id: `eq.${config.id}`, user_id: `eq.${identity.userId}` },
      "PATCH",
      { next_run_at: new Date().toISOString() },
    );
    res.status(202).json({
      queued: true,
      message:
        "Queued for the background worker. This does not start a browser-dependent scanner.",
    });
  }),
);
router.get(
  "/market-brain/candidates/:id",
  route(async (req, res) => {
    const { user } = await context(req),
      id = uuid(req.params.id);
    const [candidate] = await user.request<CandidateRow[]>("setup_candidates", {
      id: `eq.${id}`,
      limit: "1",
    });
    if (!candidate) throw new ScannerError("Setup not found", 404);
    const [events, analysis, links, bars] = await Promise.all([
      user.request("setup_events", {
        candidate_id: `eq.${id}`,
        order: "created_at.asc",
        limit: "300",
      }),
      user.request("scanner_ai_runs", {
        candidate_id: `eq.${id}`,
        fingerprint: `eq.${analysisFingerprint(candidate)}`,
        purpose: "eq.explanation",
        order: "created_at.desc",
        limit: "1",
      }),
      user.request("scanner_trade_links", { candidate_id: `eq.${id}` }),
      ScannerStore.service().request("market_candles", {
        provider: `eq.${candidate.payload.provider}`,
        symbol: `eq.${candidate.symbol}`,
        timeframe: `eq.${candidate.timeframe}`,
        order: "open_time.desc",
        limit: "100",
      }),
    ]);
    res.json({ candidate, events, analysis, links, bars });
  }),
);
router.post(
  "/market-brain/candidates/:id/journal",
  route(async (req, res) => {
    const { identity, user } = await context(req),
      id = uuid(req.params.id),
      tradeId = String(req.body?.tradeId || "");
    const note = String(req.body?.note || "").slice(0, 2000);
    if (
      !(
        await user.request<CandidateRow[]>("setup_candidates", {
          id: `eq.${id}`,
        })
      ).length
    )
      throw new ScannerError("Setup not found", 404);
    const source = await user.source(identity.userId);
    if (!records(source.trades).some((t) => t.id === tradeId))
      throw new ScannerError(
        "Choose an existing trade from your journal.",
        400,
      );
    await ScannerStore.service().request(
      "scanner_trade_links",
      { on_conflict: "candidate_id,source_trade_id" },
      "POST",
      {
        candidate_id: id,
        user_id: identity.userId,
        source_trade_id: tradeId,
        note,
      },
      "resolution=merge-duplicates,return=minimal",
    );
    res.json({ linked: true });
  }),
);
router.post(
  "/market-brain/alerts/:id/read",
  route(async (req, res) => {
    const { identity } = await context(req);
    await ScannerStore.service().request(
      "scanner_alerts",
      { id: `eq.${uuid(req.params.id)}`, user_id: `eq.${identity.userId}` },
      "PATCH",
      { read_at: new Date().toISOString() },
    );
    res.json({ saved: true });
  }),
);
router.get(
  "/market-brain/notifications",
  route(async (req, res) => {
    const { identity, user } = await context(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const category = String(req.query.category || "").toUpperCase();
    const priority = String(req.query.priority || "").toUpperCase();
    const safeValue = (value: unknown) => String(value || "").trim().replace(/[^a-zA-Z0-9_\-/.: ]/g, "").slice(0, 80);
    const query: Record<string, string> = {
      order: "updated_at.desc",
      limit: String(limit),
      offset: String(offset),
    };
    if (["TRADING", "SETUPS", "AI", "RISK", "NEWS", "SYSTEM"].includes(category)) query.category = `eq.${category}`;
    if (["INFO", "IMPORTANT", "HIGH", "CRITICAL"].includes(priority)) query.priority = `eq.${priority}`;
    const symbol = safeValue(req.query.symbol);
    const timeframe = safeValue(req.query.timeframe);
    const agent = safeValue(req.query.agent);
    if (symbol) query.symbol = `eq.${symbol}`;
    if (timeframe) query.timeframe = `eq.${timeframe}`;
    if (agent) query.agent_source = `eq.${agent}`;
    if (req.query.unread === "true") query.read_at = "is.null";
    if (req.query.before) query.updated_at = `lt.${new Date(String(req.query.before)).toISOString()}`;
    const [items, preferenceRows] = await Promise.all([
      user.request("notifications", query),
      user.request<Array<Record<string, unknown>>>("notification_preferences", { user_id: `eq.${identity.userId}`, limit: "1" }),
    ]);
    res.json({ items, preferences: preferenceRows[0] ?? notificationPreferencesSchema.parse({}), page: { limit, offset } });
  }),
);
router.get(
  "/market-brain/notifications/:id/events",
  route(async (req, res) => {
    const { identity, user } = await context(req);
    const id = uuid(req.params.id);
    const [owned] = await user.request<Array<{ id: string }>>("notifications", { id: `eq.${id}`, user_id: `eq.${identity.userId}`, select: "id", limit: "1" });
    if (!owned) throw new ScannerError("Notification not found", 404);
    const items = await user.request("notification_events", { notification_id: `eq.${id}`, order: "created_at.desc", limit: "200" });
    res.json({ items });
  }),
);
router.post(
  "/market-brain/notifications/:id/state",
  route(async (req, res) => {
    const { identity } = await context(req);
    const action = String(req.body?.action || "");
    const patch = action === "READ" ? { read_at: new Date().toISOString() }
      : action === "ACKNOWLEDGE" ? { read_at: new Date().toISOString(), acknowledged_at: new Date().toISOString() }
        : action === "VOICE_SPOKEN" ? { voice_spoken_at: new Date().toISOString() }
          : action === "PUSH_SENT" ? { push_sent_at: new Date().toISOString() }
            : null;
    if (!patch) throw new ScannerError("Unsupported notification action", 400);
    await ScannerStore.service().request("notifications", { id: `eq.${uuid(req.params.id)}`, user_id: `eq.${identity.userId}` }, "PATCH", patch, "return=minimal");
    res.json({ saved: true });
  }),
);
router.post(
  "/market-brain/notifications/actions/read-all",
  route(async (req, res) => {
    const { identity } = await context(req);
    await ScannerStore.service().request("notifications", { user_id: `eq.${identity.userId}`, read_at: "is.null" }, "PATCH", { read_at: new Date().toISOString() }, "return=minimal");
    res.json({ saved: true });
  }),
);
router.delete(
  "/market-brain/notifications",
  route(async (req, res) => {
    const { identity } = await context(req);
    await ScannerStore.service().request(
      "notifications",
      { user_id: `eq.${identity.userId}` },
      "DELETE",
      undefined,
      "return=minimal",
    );
    res.json({ deleted: true });
  }),
);
router.delete(
  "/market-brain/notifications/read",
  route(async (req, res) => {
    const { identity } = await context(req);
    await ScannerStore.service().request("notifications", {
      user_id: `eq.${identity.userId}`,
      read_at: "not.is.null",
      or: "(priority.neq.CRITICAL,acknowledged_at.not.is.null)",
    }, "DELETE", undefined, "return=minimal");
    res.json({ cleared: true });
  }),
);
router.put(
  "/market-brain/notification-preferences",
  route(async (req, res) => {
    const { identity } = await context(req);
    const preferences = notificationPreferencesSchema.parse(req.body);
    const [saved] = await ScannerStore.service().request<Array<Record<string, unknown>>>(
      "notification_preferences",
      { on_conflict: "user_id" },
      "POST",
      { user_id: identity.userId, ...preferences, updated_at: new Date().toISOString() },
      "resolution=merge-duplicates,return=representation",
    );
    res.json(saved);
  }),
);
router.post(
  "/market-brain/webhook-key",
  route(async (req, res) => {
    const { config } = await context(req);
    if (!config) throw new ScannerError("Save scanner settings first", 400);
    const secret = randomBytes(32).toString("hex");
    await ScannerStore.service().request(
      "scanner_webhook_keys",
      { on_conflict: "config_id" },
      "POST",
      { config_id: config.id, secret_hash: secretHash(secret) },
      "resolution=merge-duplicates,return=minimal",
    );
    res.json({
      secret,
      path: `/api/tradingview/webhook/${config.id}`,
      notice:
        "Shown once. Keep private; generating a new key revokes the old key.",
    });
  }),
);
router.post(
  "/tradingview/webhook/:id",
  route(async (req, res) => {
    rateLimit(`webhook:${req.ip}`, 60);
    const id = uuid(req.params.id),
      store = ScannerStore.service();
    const [key] = await store.request<Array<{ secret_hash: string }>>(
      "scanner_webhook_keys",
      { config_id: `eq.${id}`, limit: "1" },
    );
    const event = key && verifyWebhook(req.body, key.secret_hash, Date.now());
    if (!event)
      throw new ScannerError(
        "Webhook rejected: invalid authentication, payload, or timestamp.",
        401,
      );
    const [config] = await store.request<ConfigRow[]>("scanner_configs", {
      id: `eq.${id}`,
      limit: "1",
    });
    if (
      !config?.enabled ||
      !config.config.symbols.includes(event.symbol) ||
      !config.config.timeframes.includes(event.timeframe)
    )
      throw new ScannerError(
        "Symbol/timeframe is not enabled for this scanner",
        400,
      );
    const [duplicate] = await store.request<Array<{ id: string }>>(
      "tradingview_webhook_events",
      {
        config_id: `eq.${id}`,
        event_id: `eq.${event.eventId}`,
        limit: "1",
        select: "id",
      },
    );
    if (duplicate) return void res.json({ accepted: true, duplicate: true });
    await store.request(
      "tradingview_webhook_events",
      { on_conflict: "config_id,event_id" },
      "POST",
      {
        config_id: id,
        user_id: config.user_id,
        event_id: event.eventId,
        payload: event,
      },
      "resolution=ignore-duplicates,return=minimal",
    );
    // Evidence only: never approve a setup or create an order from a Pine alert.
    const afterCooldown = Math.max(
      Date.now(),
      Date.parse(config.last_run_at || "1970-01-01") + 60_000,
    );
    await store.request("scanner_configs", { id: `eq.${id}` }, "PATCH", {
      next_run_at: new Date(afterCooldown).toISOString(),
    });
    res.status(202).json({ accepted: true, approvedTrade: false });
  }),
);
router.get(
  "/market-brain/provider-health",
  route(async (req, res) => {
    const { config } = await context(req);
    if (!config) throw new ScannerError("Save scanner settings first", 400);
    rateLimit(`health:${config.id}`, 3);
    const selection = await selectScannerMarketProvider(config.config.provider);
    res.json({
      ...selection.activeHealth,
      activeProvider: selection.active,
      requestedProvider: selection.requested,
      fallback: selection.fallback,
      warning: selection.warning,
    });
  }),
);
router.get(
  "/market-brain/openai-health",
  route(async (req, res) => {
    const { identity } = await context(req);
    rateLimit(`ai-health:${identity.userId}`, 3);
    res.json(await openAIHealth(true));
  }),
);
router.post(
  "/onkar-ai/master",
  route(async (req, res) => {
    const { identity, user, config } = await context(req);
    rateLimit(`master:${identity.userId}`, 12);
    const parsed = masterAIRequestSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError(
        parsed.error.issues
          .map((issue) => issue.message)
          .slice(0, 3)
          .join("; "),
        400,
      );
    if (
      !req.accepts("text/event-stream") ||
      !req.get("accept")?.includes("text/event-stream")
    ) {
      res.json(
        await runMasterAI({ identity, user, config, input: parsed.data }),
      );
      return;
    }
    // Same authenticated endpoint, with optional operational progress for robot animation.
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const write = (event: unknown) => {
      if (!res.destroyed && !res.writableEnded)
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const result = await runMasterAI({
        identity,
        user,
        config,
        input: parsed.data,
        onProgress: write,
      });
      write({ type: "result", data: result });
    } catch {
      write({
        type: "error",
        error: "Analysis could not finish. Please retry.",
      });
    } finally {
      res.end();
    }
  }),
);
router.post(
  "/market-brain/chat",
  route(async (req, res) => {
    const { user, config } = await context(req);
    if (!config) throw new ScannerError("Save scanner settings first", 400);
    const parsed = scannerChatSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError(
        "Choose a candidate and enter a question of 4–800 characters.",
        400,
      );
    if (!openAIConfigured())
      throw new ScannerError(
        "AI explanations need OPENAI_API_KEY on the server.",
      );
    const toolset = new ScannerTools(user, config),
      id = parsed.data.candidateId;
    const evidence = await Promise.all(
      [
        "get_market_context",
        "evaluate_setup_rules",
        "calculate_risk",
        "get_historical_matches",
        "get_journal_statistics",
        "get_economic_events",
      ].map((name) => toolset.execute({ name, candidateId: id })),
    );
    const store = ScannerStore.service();
    const run = await store.rpc<string | null>("reserve_scanner_ai", {
      p_config: config.id,
      p_candidate: id,
      p_fingerprint: fingerprint([
        id,
        parsed.data.question,
        Math.floor(Date.now() / 60_000),
      ]),
      p_purpose: "user_question",
    });
    if (!run)
      throw new ScannerError(
        "Daily AI budget reached, or this question was already submitted this minute.",
        429,
      );
    const start = Date.now();
    try {
      const result = await new OpenAIExplanationProvider().explain({
        userQuestion: parsed.data.question,
        evidence,
      });
      await store.request("scanner_ai_runs", { id: `eq.${run}` }, "PATCH", {
        status: "succeeded",
        output: result.output,
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        latency_ms: Date.now() - start,
        tool_calls: toolset.executions,
      });
      res.json({ ...result, runId: run, sources: toolset.executions });
    } catch {
      await store.request("scanner_ai_runs", { id: `eq.${run}` }, "PATCH", {
        status: "failed",
        error: "AI response failed validation or provider unavailable",
        tool_calls: toolset.executions,
      });
      throw new ScannerError(
        "AI could not provide a validated explanation. Your calculated analysis is unchanged.",
      );
    }
  }),
);
router.post(
  "/market-brain/backtest",
  route(async (req, res) => {
    const { user, config, identity } = await context(req);
    if (!config) throw new ScannerError("Save scanner settings first", 400);
    rateLimit(`backtest:${identity.userId}`, 2);
    const parsed = backtestRequestSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError(
        "Choose a rule version, symbol and ISO date range (maximum 90 days), and acknowledge simulation.",
        400,
      );
    const [version] = await user.request<VersionRow[]>(
      "scanner_strategy_versions",
      { id: `eq.${parsed.data.versionId}`, limit: "1" },
    );
    if (!version || version.definition.approval !== "approved")
      throw new ScannerError("Approved rule version not found", 404);
    const from = Date.parse(parsed.data.from),
      to = Date.parse(parsed.data.to);
    const needed = new Set([
      version.definition.timeframe,
      version.definition.higherTimeframe,
      ...version.definition.rules.map((r) => r.timeframe),
    ]);
    const store = ScannerStore.service(),
      history: Partial<Record<Timeframe, Candle[]>> = {};
    for (const tf of needed) {
      const rows = await store.request<
        Array<{
          open_time: number;
          o: number;
          h: number;
          l: number;
          c: number;
          v: number | null;
        }>
      >("market_candles", {
        provider: `eq.${config.config.provider}`,
        symbol: `eq.${parsed.data.symbol}`,
        timeframe: `eq.${tf}`,
        and: `(open_time.gte.${from - timeframeMs[tf] * 260},open_time.lte.${to})`,
        order: "open_time.asc",
        limit: "1000",
      });
      if (rows.length === 1000)
        throw new ScannerError(
          "Choose a shorter date range; this synchronous replay is limited to 999 candles per timeframe.",
          422,
        );
      history[tf] = rows.map((c) => ({
        t: Number(c.open_time),
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v,
      }));
    }
    if (!history[version.definition.timeframe]?.length)
      throw new ScannerError(
        "No stored candles for that range. The scanner must ingest real history first.",
        422,
      );
    const source = await user.source(identity.userId);
    const account = accountContext(
      source,
      config.config,
      parsed.data.symbol,
      Date.now(),
    );
    const replay = backtest(
      version.definition,
      history,
      {
        ...config.config,
        requireNews: !parsed.data.allowMissingHistoricalNews,
      },
      account,
      from,
      to,
      undefined,
      parsed.data.symbol,
    );
    res.json({
      ...replay,
      requestedFrom: parsed.data.from,
      requestedTo: parsed.data.to,
      versionId: version.id,
      provider: config.config.provider,
    });
  }),
);
export default router;
