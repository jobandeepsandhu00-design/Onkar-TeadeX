import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  scannerConfigSchema,
  strategyVersionSchema,
  scannerChatSchema,
  backtestRequestSchema,
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
  runNextJob,
} from "../market-brain/scanner";
import { getMarketProvider } from "../market-brain/providers";
import { secretHash, verifyWebhook } from "../market-brain/webhook";
import { journalSummary } from "../market-brain/journal";
import { accountContext } from "../market-brain/journal";
import { backtest } from "../market-brain/backtest";
import { ScannerTools } from "../market-brain/tools";
import { OpenAIExplanationProvider } from "../market-brain/ai";
import {
  openAIConfigured,
  openAIHealth,
} from "../lib/openai";

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
  const result = await runNextJob(undefined, { budgetMs: 48_000 });
  res.json({ ok: true, result, checkedAt: new Date().toISOString() });
});

// Vercel Cron uses GET; Supabase Cron/pg_net uses POST. Both require the same
// dedicated CRON_SECRET and execute one lease-protected bounded job.
router.get("/market-brain/cron", cronHandler);
router.post("/market-brain/cron", cronHandler);
router.post(
  "/market-brain/provider-health/cron",
  route(async (req, res) => {
    await requireCronAuthorization(req);
    res.json(await getMarketProvider("twelvedata").healthCheck());
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
  return { identity, user, config };
}
router.get(
  "/market-brain",
  route(async (req, res) => {
    const { identity, user, config } = await context(req);
    const [candidates, alerts, versions, runs, source] = await Promise.all([
      user.request<CandidateRow[]>("setup_candidates", {
        order: "updated_at.desc",
        limit: "100",
      }),
      user.request("scanner_alerts", { order: "created_at.desc", limit: "50" }),
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
    ]);
    const age = config?.last_run_at
      ? Date.now() - Date.parse(config.last_run_at)
      : Infinity;
    const fresh =
      config && age < Math.max(180_000, config.config.frequencySeconds * 2000);
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
                (config?.config.frequencySeconds ?? 300) * 2000,
          };
        }),
      alerts,
      versions,
      runs,
      accounts: records(source.tradingAccounts).map((a) => ({
        id: a.id,
        name: a.alias || a.accountNumber,
        currency: a.currency,
        type: a.accountType,
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
        execution: "disabled",
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
    });
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
    if (
      parsed.data.strategyVersionIds.some(
        (id) =>
          !versions.some(
            (v) => v.id === id && v.definition.approval === "approved",
          ),
      )
    )
      throw new ScannerError(
        "Only your approved rule versions can be scanned.",
        400,
      );
    if (parsed.data.enabled && !parsed.data.strategyVersionIds.length)
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
    res.json(await getMarketProvider(config.config.provider).healthCheck());
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
