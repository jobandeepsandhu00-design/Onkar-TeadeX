import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  parseJarvisIntent,
  stripJarvisWake,
  jarvisRequestSchema,
  scannerConfigSchema,
  type JarvisAction,
} from "@workspace/api-zod";
import { ScannerStore, type ConfigRow } from "../market-brain/store";
import {
  applyScannerControl,
  automaticEntryStillAllowed,
} from "../market-brain/controls";
import {
  canConfirmJarvis,
  changedJarvisConfig,
  createJarvisCommand,
  decideJarvisCommand,
  getJarvisCommand,
} from "./jarvis-service";

test("wake phrase preserves the command and Jar alias requires explicit enable", () => {
  assert.equal(stripJarvisWake("Hey Jarvis, open scanner"), "open scanner");
  assert.equal(stripJarvisWake("Jar open scanner"), null);
  assert.equal(stripJarvisWake("Jar open scanner", true), "open scanner");
  assert.equal(stripJarvisWake("I heard Jarvis open scanner on TV"), null);
});
test("negation and ambiguous financial actions never become mutations", () => {
  for (const text of [
    "Don't buy gold",
    "Do not stop trading",
    "No, cancel",
    "cancel that",
  ])
    assert.equal(parseJarvisIntent(text).kind, "LOCAL");
  for (const text of [
    "Buy gold",
    "Close all positions",
    "Set risk to five maybe fifty",
    "yes",
    "confirm",
    "execute rm -rf",
  ])
    assert.equal(parseJarvisIntent(text).kind, "CLARIFY");
});
test("wake assistant, microphone off, speech stop and system pause remain distinct", () => {
  assert.deepEqual(parseJarvisIntent("wake up"), {
    kind: "LOCAL",
    action: "WAKE",
  });
  assert.deepEqual(parseJarvisIntent("stop speaking"), {
    kind: "LOCAL",
    action: "STOP_SPEECH",
  });
  assert.deepEqual(parseJarvisIntent("turn off the microphone"), {
    kind: "LOCAL",
    action: "MIC_OFF",
  });
  assert.deepEqual(parseJarvisIntent("turn off the system"), {
    kind: "COMMAND",
    action: { kind: "SAFE_PAUSE" },
  });
});
test("dashboard and chart aliases map precisely", () => {
  assert.deepEqual(parseJarvisIntent("Open the TradeX dashboard"), {
    kind: "NAVIGATE",
    destination: "tradex",
  });
  assert.deepEqual(parseJarvisIntent("Go to Onkar AI"), {
    kind: "NAVIGATE",
    destination: "onkar",
  });
  assert.deepEqual(parseJarvisIntent("Jarvis, show gold on thirty minutes"), {
    kind: "CHART",
    symbol: "XAUUSD",
    timeframe: "30m",
  });
  assert.deepEqual(parseJarvisIntent("Show pound-yen on one hour"), {
    kind: "CHART",
    symbol: "GBPJPY",
    timeframe: "1h",
  });
});
test("exact numeric settings validate ranges and preserve zero point five", () => {
  assert.deepEqual(parseJarvisIntent("Set risk to zero point five percent"), {
    kind: "COMMAND",
    action: { kind: "SETTING", setting: { key: "riskPercent", value: 0.5 } },
  });
  assert.equal(parseJarvisIntent("Set risk to 50 percent").kind, "CLARIFY");
  assert.equal(
    parseJarvisIntent("Set scanner interval to 5 minutes").kind,
    "CLARIFY",
  );
  assert.deepEqual(parseJarvisIntent("Set api calls every 15 minutes"), {
    kind: "COMMAND",
    action: {
      kind: "SETTING",
      setting: { key: "frequencySeconds", value: 900 },
    },
  });
});
test("schemas reject arbitrary commands, permissions, secrets and extra arguments", () => {
  for (const action of [
    { kind: "BUY" },
    { kind: "SETTING", setting: { key: "mt5LiveExecution", value: true } },
    { kind: "SETTING", setting: { key: "riskPercent", value: -1 } },
    { kind: "STATUS", sql: "select secret" },
  ])
    assert.equal(
      jarvisRequestSchema.safeParse({ requestId: randomUUID(), action })
        .success,
      false,
    );
});
test("setting change preserves all execution permissions and management rules", () => {
  const config = scannerConfigSchema.parse({});
  const next = changedJarvisConfig(config, {
    kind: "SETTING",
    setting: { key: "riskPercent", value: 0.5 },
  });
  assert.equal(next.risk.riskPercent, 0.5);
  assert.equal(config.risk.riskPercent, 1);
  assert.deepEqual(next.permissions, config.permissions);
  assert.deepEqual(next.tradeManagement, config.tradeManagement);
});
test("confirmation is action-bound, session-bound, one-use and expires", () => {
  const nonce = randomUUID(),
    output = {
      id: randomUUID(),
      state: "AWAITING_CONFIRMATION" as const,
      nonce,
      expiresAt: new Date(2000).toISOString(),
      message: "exact change",
    };
  const row = { request: { session: "session-a" }, output };
  assert.equal(canConfirmJarvis(row, "session-a", nonce, 1000), true);
  assert.equal(canConfirmJarvis(row, "session-b", nonce, 1000), false);
  assert.equal(canConfirmJarvis(row, "session-a", randomUUID(), 1000), false);
  assert.equal(canConfirmJarvis(row, "session-a", nonce, 2000), false);
  assert.equal(
    canConfirmJarvis(
      { ...row, output: { ...output, state: "RUNNING" } },
      "session-a",
      nonce,
      1000,
    ),
    false,
  );
});

type Row = Record<string, any>;
class MemoryStore extends ScannerStore {
  tables: Record<string, Row[]> = {};
  writes: Array<{ table: string; body: Row }> = [];
  constructor() {
    super("http://unused", "unused");
  }
  override async request<T>(
    table: string,
    query: Record<string, string> = {},
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const rows = this.tables[table] ?? [];
    const match = (row: Row) =>
      Object.entries(query).every(([key, predicate]) => {
        if (["limit", "select", "order", "on_conflict"].includes(key))
          return true;
        const [field, nested] = key.split("->>"),
          actual = nested ? row[field]?.[nested] : row[field];
        if (predicate.startsWith("eq."))
          return String(actual) === predicate.slice(3);
        if (predicate.startsWith("gte."))
          return String(actual) >= predicate.slice(4);
        if (predicate.startsWith("gt."))
          return String(actual) > predicate.slice(3);
        return true;
      });
    if (method === "GET") return structuredClone(rows.filter(match)) as T;
    if (method === "POST") {
      const data = body as Row;
      if (rows.some((r) => r.id === data.id && data.id)) return [] as T;
      const row = {
        created_at: new Date().toISOString(),
        ...structuredClone(data),
      };
      this.tables[table] = [...rows, row];
      this.writes.push({ table, body: structuredClone(data) });
      return [structuredClone(row)] as T;
    }
    if (method === "PATCH") {
      const matching = rows.filter(match);
      for (const row of matching) Object.assign(row, structuredClone(body));
      this.writes.push({ table, body: body as Row });
      return structuredClone(matching) as T;
    }
    throw new Error("Unexpected test operation");
  }
}
function fixture() {
  const store = new MemoryStore();
  const identity = {
    userId: randomUUID(),
    authorization: `Bearer e30.${Buffer.from(JSON.stringify({ session_id: "test-session" })).toString("base64url")}.verified-by-auth`,
    apiKey: "test",
    supabaseUrl: "http://unused",
  };
  const config = {
    id: randomUUID(),
    workspace_id: randomUUID(),
    user_id: identity.userId,
    config: scannerConfigSchema.parse({}),
    health: {},
    last_run_at: null,
  } as unknown as ConfigRow;
  store.tables.scanner_configs = [config];
  store.tables.scanner_runtime_controls = [
    {
      user_id: identity.userId,
      scanner_state: "RUNNING",
      trading_mode: "AUTO",
      auto_execution_enabled: true,
      emergency_stop: false,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  return { store, identity, config };
}
test("emergency pause changes only runtime flags, not positions/data/protective permissions", async () => {
  const { store, identity, config } = fixture();
  const row = await applyScannerControl(
    identity.userId,
    config,
    "EMERGENCY_STOP",
    store,
  );
  assert.equal(row.emergency_stop, true);
  assert.equal(row.auto_execution_enabled, false);
  assert.equal(row.scanner_state, "PAUSED");
  assert.deepEqual(
    [...new Set(store.writes.map((w) => w.table))],
    ["scanner_runtime_controls", "scanner_execution_events"],
  );
});
test("manual recovery clears only the lock and resumes scanner analysis", async () => {
  const { store, identity, config } = fixture();
  await applyScannerControl(identity.userId, config, "EMERGENCY_STOP", store);
  const row = await applyScannerControl(
    identity.userId,
    config,
    "RESUME_ANALYSIS",
    store,
  );
  assert.equal(row.emergency_stop, false);
  assert.equal(row.scanner_state, "RUNNING");
  assert.equal(row.trading_mode, "ANALYSIS");
  assert.equal(row.auto_execution_enabled, false);
  assert.equal(row.auto_start, true);
});
test("analysis resume cannot override a newer emergency pause", async () => {
  const { store, identity, config } = fixture();
  await applyScannerControl(identity.userId, config, "EMERGENCY_STOP", store);
  await assert.rejects(
    applyScannerControl(
      identity.userId,
      config,
      "RESUME_ANALYSIS",
      store,
      "2026-01-01T00:00:00.000Z",
    ),
    /Runtime changed/,
  );
  assert.equal(store.tables.scanner_runtime_controls[0].emergency_stop, true);
});

test("final entry guard fails closed after pause without blocking protection", async () => {
  const { store, identity, config } = fixture();
  Object.assign(store.tables.scanner_runtime_controls[0], {
    scanner_config_id: config.id,
    trading_source: "TWELVE_DATA",
  });
  assert.equal(
    await automaticEntryStillAllowed(
      store,
      identity.userId,
      config.id,
      "TWELVE_DATA",
    ),
    true,
  );
  assert.equal(
    await automaticEntryStillAllowed(store, identity.userId, config.id, "MT5"),
    false,
  );
  await applyScannerControl(identity.userId, config, "EMERGENCY_STOP", store);
  assert.equal(
    await automaticEntryStillAllowed(
      store,
      identity.userId,
      config.id,
      "TWELVE_DATA",
    ),
    false,
  );
});
test("durable request deduplication, ownership and one-use decisions", async (t) => {
  const { store, identity } = fixture();
  const service = ScannerStore.service,
    user = ScannerStore.user;
  ScannerStore.service = () => store;
  ScannerStore.user = () => store;
  t.after(() => {
    ScannerStore.service = service;
    ScannerStore.user = user;
  });
  const id = randomUUID(),
    action: JarvisAction = { kind: "RESUME_ANALYSIS" };
  const preview = await createJarvisCommand(identity, id, action);
  assert.equal(preview.state, "AWAITING_CONFIRMATION");
  assert.deepEqual(await createJarvisCommand(identity, id, action), preview);
  assert.equal(store.tables.onkar_agent_runs.length, 1);
  await assert.rejects(
    createJarvisCommand(identity, id, { kind: "SAFE_PAUSE" }),
    /different command/,
  );
  await assert.rejects(
    getJarvisCommand({ ...identity, userId: randomUUID() }, id),
    /not found/,
  );
  const result = await decideJarvisCommand(
    identity,
    id,
    "CONFIRM",
    preview.nonce!,
  );
  assert.equal(result.state, "SUCCEEDED");
  assert.equal(
    store.tables.scanner_runtime_controls[0].trading_mode,
    "ANALYSIS",
  );
  assert.equal(
    store.tables.scanner_runtime_controls[0].auto_execution_enabled,
    false,
  );
  await assert.rejects(
    decideJarvisCommand(identity, id, "CONFIRM", preview.nonce!),
    /already used/,
  );
  assert.equal((await getJarvisCommand(identity, id)).state, "SUCCEEDED");
});
test("cancel does not mutate runtime and changed context blocks confirmation", async (t) => {
  const { store, identity } = fixture();
  const service = ScannerStore.service,
    user = ScannerStore.user;
  ScannerStore.service = () => store;
  ScannerStore.user = () => store;
  t.after(() => {
    ScannerStore.service = service;
    ScannerStore.user = user;
  });
  const a = await createJarvisCommand(identity, randomUUID(), {
    kind: "RESUME_ANALYSIS",
  });
  assert.equal(
    (await decideJarvisCommand(identity, a.id, "CANCEL", a.nonce!)).state,
    "CANCELED",
  );
  assert.equal(store.tables.scanner_runtime_controls[0].trading_mode, "AUTO");
  const b = await createJarvisCommand(identity, randomUUID(), {
    kind: "RESUME_ANALYSIS",
  });
  store.tables.scanner_runtime_controls[0].emergency_stop = true;
  await assert.rejects(
    decideJarvisCommand(identity, b.id, "CONFIRM", b.nonce!),
    /changed since/,
  );
});
