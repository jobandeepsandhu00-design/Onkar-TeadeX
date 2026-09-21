import test from "node:test";
import assert from "node:assert/strict";
import { scannerConfigSchema, strategyVersionSchema } from "@workspace/api-zod";
import { ScannerStore, type ConfigRow, type CandidateRow } from "./store";
import { analysisFingerprint, effectiveScannerFrequencySeconds, runScannerJob } from "./scanner";

test("Twelve Data scanner cycles are never scheduled faster than 15 minutes", () => {
  assert.equal(
    effectiveScannerFrequencySeconds({ provider: "twelvedata", frequencySeconds: 300 }),
    900,
  );
  assert.equal(
    effectiveScannerFrequencySeconds({ provider: "mt5", frequencySeconds: 300 }),
    300,
  );
});

// Isolated persistence fixture; never connects to production Supabase or a broker.
test("worker pipeline persists READY, deduplicates alerts and monitors frozen invalidation", async (t) => {
  let now = Math.floor(Date.now() / 300_000) * 300_000 + 5000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify([
          {
            title: "Test-only calendar",
            country: "USD",
            date: new Date(now).toISOString(),
            impact: "Low",
          },
        ]),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  const config = scannerConfigSchema.parse({
    enabled: true,
    provider: "coinbase",
    symbols: ["BTC-USD"],
    timeframes: ["1m", "5m"],
    accountId: "a",
    maxAiCallsPerDay: 0,
    strategyVersionIds: ["11111111-1111-4111-8111-111111111111"],
    risk: { valuePerPriceUnit: { "BTC-USD": 1 } },
  });
  const definition = strategyVersionSchema.parse({
    sourceSetupId: "test",
    name: "Test fixture",
    direction: "long",
    timeframe: "1m",
    higherTimeframe: "5m",
    approval: "approved",
    rules: [
      {
        id: "test",
        feature: "close",
        timeframe: "1m",
        operator: "gt",
        expected: 0,
        weight: 100,
        required: true,
      },
    ],
  });
  const job: ConfigRow = {
    id: "cfg",
    user_id: "owner",
    workspace_id: "workspace",
    config,
    enabled: true,
    cursor: 0,
    lease_token: "lease",
    last_run_at: null,
    last_duration_ms: null,
    health: {},
    last_error: null,
  };
  const history = (step: number) =>
    Array.from({ length: 240 }, (_, i) => ({
      open_time: Math.floor(now / step) * step - (240 - i) * step,
      o: 100 + i,
      h: 102 + i,
      l: 99 + i,
      c: 101 + i,
      v: 100,
    }));
  const data = { "1m": history(60_000), "5m": history(300_000) };
  class MemoryStore extends ScannerStore {
    candidate: CandidateRow | null = null;
    lastHealth: Record<string, unknown> | null = null;
    events = new Set<string>();
    alerts = new Set<string>();
    versionQuery: Record<string, string> | null = null;
    constructor() {
      super("http://test.invalid", "not-a-real-key");
    }
    override async source() {
      return {
        tradingAccounts: [{ id: "a", currency: "USD", balance: 100_000 }],
        trades: [],
      };
    }
    override async request<T>(
      table: string,
      query: Record<string, string> = {},
      method = "GET",
      _body?: unknown,
    ): Promise<T> {
      let result: unknown = [];
      if (table === "market_candles")
        result = [
          ...data[query.timeframe.slice(3) as keyof typeof data],
        ].reverse();
      if (table === "scanner_strategy_versions") {
        this.versionQuery = query;
        result = [
          {
            id: config.strategyVersionIds[0],
            name: definition.name,
            definition,
            source_setup_id: "test",
          },
        ];
      }
      if (table === "setup_candidates" && !query.expires_at && this.candidate)
        result = [this.candidate];
      if (table === "scanner_configs" && method === "PATCH") {
        this.lastHealth = (_body as { health?: Record<string, unknown> })?.health ?? null;
        result = [];
      }
      return result as T;
    }
    override async rpc<T>(name: string, body: unknown): Promise<T> {
      assert.equal(name, "commit_scanner_candidate");
      const p = body as {
        p_candidate: CandidateRow;
        p_event: Array<{ key: string }>;
        p_alert: { key: string } | null;
      };
      this.candidate = structuredClone(p.p_candidate);
      for (const e of p.p_event) this.events.add(e.key);
      if (p.p_alert) this.alerts.add(p.p_alert.key);
      return p.p_candidate.id as T;
    }
  }
  const store = new MemoryStore();
  assert.equal((await runScannerJob(store, job)).success, true);
  assert.equal(
    store.versionQuery?.id,
    undefined,
    "automatic setup activation must query every approved version",
  );
  assert.equal(store.candidate?.state, "READY");
  assert.equal(store.candidate?.score, 100);
  const coverage = store.lastHealth?.setupCoverage as Record<
    string,
    { evaluated: number; eligible: number; complete: boolean }
  >;
  assert.equal(coverage["BTC-USD"].evaluated, 1);
  assert.equal(coverage["BTC-USD"].eligible, 1);
  assert.equal(coverage["BTC-USD"].complete, true);
  assert.equal(store.alerts.size, 1);
  const originalId = store.candidate!.id,
    plan = store.candidate!.plan!;
  const originalFingerprint = analysisFingerprint(store.candidate!);
  const newEvidence = structuredClone(store.candidate!);
  newEvidence.payload.tradingViewEvidence = [
    {
      payload: { event: "support_retest", symbol: "BTC-USD" },
      created_at: new Date(now).toISOString(),
    },
  ];
  assert.notEqual(analysisFingerprint(newEvidence), originalFingerprint);
  const newNews = structuredClone(store.candidate!);
  newNews.payload.news.events = [
    {
      title: "Changed calendar evidence",
      currency: "USD",
      time: now + 60_000,
    },
  ];
  assert.notEqual(analysisFingerprint(newNews), originalFingerprint);
  const heartbeatOnly = structuredClone(store.candidate!);
  heartbeatOnly.payload.news.checkedAt = new Date(now + 1000).toISOString();
  assert.equal(analysisFingerprint(heartbeatOnly), originalFingerprint);
  assert.equal((await runScannerJob(store, job)).success, true);
  assert.equal(store.candidate!.id, originalId);
  assert.equal(store.alerts.size, 1);
  now += 60_000;
  data["1m"].push({
    open_time: data["1m"].at(-1)!.open_time + 60_000,
    o: plan.entry,
    h: plan.entry + 1,
    l: plan.stop - 1,
    c: plan.stop - 0.5,
    v: 100,
  });
  assert.equal((await runScannerJob(store, job)).success, true);
  assert.equal(store.candidate!.state, "INVALIDATED");
  assert.equal(store.candidate!.plan!.stop, plan.stop);
  assert.ok(store.events.size >= 3);
});
