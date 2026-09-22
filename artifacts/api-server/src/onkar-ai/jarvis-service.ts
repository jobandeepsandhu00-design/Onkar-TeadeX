import { createHash, randomUUID } from "node:crypto";
import {
  scannerConfigSchema,
  type JarvisAction,
  type JarvisResult,
  type ScannerConfig,
} from "@workspace/api-zod";
import type { SupabaseIdentity } from "../lib/supabase-auth";
import {
  ScannerError,
  ScannerStore,
  type ConfigRow,
} from "../market-brain/store";
import {
  applyScannerControl,
  saveScannerConfig,
} from "../market-brain/controls";
import { syncLibraryKnowledge } from "./knowledge-service";

export const jarvisCapabilities = [
  {
    id: "STATUS",
    risk: "read",
    confirmation: false,
    handler: "scanner_configs + scanner_runtime_controls",
    example: "Read my scanner settings",
  },
  {
    id: "SAFE_PAUSE",
    risk: "protective",
    confirmation: false,
    handler: "applyScannerControl/EMERGENCY_STOP",
    example: "Stop trading",
  },
  {
    id: "RESUME_ANALYSIS",
    risk: "configuration",
    confirmation: true,
    handler: "applyScannerControl/RESUME_ANALYSIS",
    example: "Resume analysis",
  },
  {
    id: "DISABLE_AUTO",
    risk: "protective",
    confirmation: false,
    handler: "applyScannerControl/DISABLE_AUTO",
    example: "Disable automatic execution",
  },
  {
    id: "SETTING",
    risk: "configuration",
    confirmation: true,
    handler: "saveScannerConfig/configure_scanner",
    example: "Set risk to 0.5 percent",
  },
  {
    id: "LEARN_LIBRARY",
    risk: "background processing",
    confirmation: true,
    handler: "syncLibraryKnowledge",
    example: "Learn my Library",
  },
].map((c) => ({
  ...c,
  role: "authenticated owner",
  available: true,
  cancellation: "pending confirmation only; running results must be reconciled",
}));

type CommandRow = {
  id: string;
  user_id: string;
  request: {
    action: JarvisAction;
    session: string;
    configHash: string;
    runtimeHash: string;
    runtimeVersion: string | null;
  };
  output: JarvisResult;
  status: string;
  created_at: string;
  command_log: Array<Record<string, unknown>>;
};
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(v ?? null))
    .digest("hex");
function sessionKey(identity: SupabaseIdentity) {
  // JWT was verified by requireSupabaseUser; this is a binding, not an authorization claim.
  try {
    const claims = JSON.parse(
      Buffer.from(identity.authorization.split(".")[1], "base64url").toString(),
    );
    return hash(claims.session_id || identity.authorization);
  } catch {
    return hash(identity.authorization);
  }
}
export function changedJarvisConfig(
  config: ScannerConfig,
  action: Extract<JarvisAction, { kind: "SETTING" }>,
): ScannerConfig {
  const next = structuredClone(config),
    setting = action.setting;
  if (setting.key === "riskPercent") next.risk.riskPercent = setting.value;
  else if (setting.key === "automaticAlerts" || setting.key === "aiAnalysis")
    next.permissions[setting.key] = setting.value;
  else if (setting.key === "symbols")
    next.symbols = [...new Set(setting.value)];
  else next.frequencySeconds = setting.value;
  return scannerConfigSchema.parse(next);
}
export function canConfirmJarvis(
  row: { request: { session: string }; output: JarvisResult },
  session: string,
  nonce: string,
  now = Date.now(),
) {
  return (
    row.request.session === session &&
    row.output.state === "AWAITING_CONFIRMATION" &&
    row.output.nonce === nonce &&
    Date.parse(row.output.expiresAt || "") > now
  );
}
async function context(identity: SupabaseIdentity) {
  const user = ScannerStore.user(identity);
  const [configs, runtimes] = await Promise.all([
    user.request<ConfigRow[]>("scanner_configs", {
      user_id: `eq.${identity.userId}`,
      limit: "1",
    }),
    user.request<Array<Record<string, unknown>>>("scanner_runtime_controls", {
      user_id: `eq.${identity.userId}`,
      limit: "1",
    }),
  ]);
  const config = configs[0]
    ? { ...configs[0], config: scannerConfigSchema.parse(configs[0].config) }
    : undefined;
  return { config, runtime: runtimes[0] ?? null };
}
function statusMessage(
  config: ConfigRow | undefined,
  runtime: Record<string, unknown> | null,
) {
  if (!config)
    return "Scanner settings are not saved yet. Open Scanner Settings.";
  return `Scanner ${runtime?.scanner_state ?? "unknown"}; scanning configured ${config.config.enabled ? "ON" : "OFF"}. Mode ${runtime?.trading_mode ?? "unknown"}. Auto execution ${runtime?.auto_execution_enabled ? "enabled" : "disabled"}. Provider ${config.config.provider}; last recorded health ${typeof config.health.status === "string" ? config.health.status : "unavailable"}. Last scanner data ${config.last_run_at ?? "not available"}. Watchlist ${config.config.symbols.join(", ")}. Full cycle ${config.config.frequencySeconds / 60} minutes. Risk per trade ${config.config.risk.riskPercent} percent. Account ID ${config.config.accountId ?? "not selected"}. This is stored status, not a fresh broker health check.`;
}
export async function createJarvisCommand(
  identity: SupabaseIdentity,
  id: string,
  action: JarvisAction,
): Promise<JarvisResult> {
  const store = ScannerStore.service();
  const [existing] = await store.request<CommandRow[]>("onkar_agent_runs", {
    id: `eq.${id}`,
    user_id: `eq.${identity.userId}`,
    intent: "eq.JARVIS_COMMAND",
    limit: "1",
  });
  if (existing) {
    if (hash(existing.request.action) !== hash(action))
      throw new ScannerError(
        "This request ID already belongs to a different command.",
        409,
      );
    return publicResult(existing);
  }
  const { config, runtime } = await context(identity);
  if (!["SAFE_PAUSE", "DISABLE_AUTO"].includes(action.kind)) {
    const recent = await store.request<Array<{ id: string }>>(
      "onkar_agent_runs",
      {
        user_id: `eq.${identity.userId}`,
        intent: "eq.JARVIS_COMMAND",
        created_at: `gte.${new Date(Date.now() - 60_000).toISOString()}`,
        select: "id",
        limit: "20",
      },
    );
    if (recent.length >= 20)
      throw new ScannerError(
        "Jarvis command limit reached. Wait one minute. Emergency pause remains available.",
        429,
      );
  }
  if (action.kind !== "STATUS" && action.kind !== "LEARN_LIBRARY" && !config)
    throw new ScannerError("Save your scanner settings first.", 409);
  const confirmation = ["SETTING", "RESUME_ANALYSIS", "LEARN_LIBRARY"].includes(
    action.kind,
  );
  const after =
    action.kind === "SETTING"
      ? changedJarvisConfig(config!.config, action)
      : undefined;
  const settingValue = (value: ScannerConfig) =>
    action.kind !== "SETTING"
      ? undefined
      : action.setting.key === "riskPercent"
        ? value.risk.riskPercent
        : action.setting.key === "automaticAlerts" ||
            action.setting.key === "aiAnalysis"
          ? value.permissions[action.setting.key]
          : value[action.setting.key];
  const message =
    action.kind === "SETTING"
      ? `${action.setting.key}: ${JSON.stringify(settingValue(config!.config))} → ${JSON.stringify(settingValue(after!))}. Applies to scanner account ${config!.config.accountId ?? "not selected"}. Confirm this exact change within 2 minutes. Trading gates and permissions are unchanged.`
      : action.kind === "RESUME_ANALYSIS"
        ? `Resume scanner runtime in ANALYSIS ONLY. Scanner configuration is ${config?.config.enabled ? "enabled" : "disabled — enabling it still requires Scanner Settings"}. Automatic entries remain OFF. Last provider health: ${config?.health.status ?? "unavailable"}; data timestamp: ${config?.last_run_at ?? "unavailable"}. This does not reconnect a provider or authorize trading.`
        : action.kind === "LEARN_LIBRARY"
          ? "Synchronize your existing Library into the shared knowledge service. Existing ingestion jobs may use configured analysis services. No strategy will be approved or traded by this command."
          : action.kind === "STATUS"
            ? statusMessage(config, runtime)
            : "Request received; verifying the protective control.";
  const output: JarvisResult = {
    id,
    state: confirmation ? "AWAITING_CONFIRMATION" : "RUNNING",
    message,
    ...(confirmation
      ? {
          nonce: randomUUID(),
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        }
      : {}),
    ...(after
      ? { before: settingValue(config!.config), after: settingValue(after) }
      : {}),
    observedAt: new Date().toISOString(),
  };
  const row = {
    id,
    user_id: identity.userId,
    workspace_id: config?.workspace_id ?? null,
    request: {
      action,
      session: sessionKey(identity),
      configHash: hash(config?.config),
      runtimeHash: hash(runtime),
      runtimeVersion:
        typeof runtime?.updated_at === "string" ? runtime.updated_at : null,
    },
    intent: "JARVIS_COMMAND",
    agents_called: ["master"],
    data_status: "verified",
    status: "pending",
    output,
    command_log: [
      {
        timestamp: new Date().toISOString(),
        state: "RECEIVED",
        action: action.kind,
      },
      { timestamp: new Date().toISOString(), state: output.state },
    ],
  };
  const inserted = await store.request<CommandRow[]>(
    "onkar_agent_runs",
    { on_conflict: "id" },
    "POST",
    row,
    "resolution=ignore-duplicates,return=representation",
  );
  if (!inserted.length) {
    const [prior] = await store.request<CommandRow[]>("onkar_agent_runs", {
      id: `eq.${id}`,
      user_id: `eq.${identity.userId}`,
      intent: "eq.JARVIS_COMMAND",
    });
    if (!prior || hash(prior.request.action) !== hash(action))
      throw new ScannerError(
        "Command ID conflict. No action was submitted.",
        409,
      );
    return publicResult(prior);
  }
  return confirmation ? output : executeJarvis(identity, inserted[0], config);
}
function publicResult(row: CommandRow): JarvisResult {
  if (
    row.output.state === "RUNNING" &&
    Date.now() - Date.parse(row.output.observedAt || row.created_at) > 90_000
  )
    return {
      ...row.output,
      state: "UNKNOWN",
      message:
        "Completion is unverified. Check system status before submitting another command. A timed-out command is never automatically retried.",
    };
  if (
    row.output.state === "AWAITING_CONFIRMATION" &&
    Date.parse(row.output.expiresAt || "") <= Date.now()
  )
    return {
      ...row.output,
      state: "EXPIRED",
      message: "Confirmation expired. Request a fresh preview.",
    };
  return row.output;
}
async function finish(
  identity: SupabaseIdentity,
  row: CommandRow,
  output: JarvisResult,
) {
  await ScannerStore.service().request(
    "onkar_agent_runs",
    { id: `eq.${row.id}`, user_id: `eq.${identity.userId}` },
    "PATCH",
    {
      output,
      status: output.state === "SUCCEEDED" ? "succeeded" : "failed",
      command_log: [
        ...row.command_log,
        {
          timestamp: new Date().toISOString(),
          state: output.state,
          message: output.message,
        },
      ],
    },
  );
  return output;
}
async function executeJarvis(
  identity: SupabaseIdentity,
  row: CommandRow,
  config?: ConfigRow,
): Promise<JarvisResult> {
  const action = row.request.action;
  try {
    let message: string;
    if (action.kind === "STATUS") message = row.output.message;
    else if (action.kind === "SETTING") {
      await saveScannerConfig(
        identity,
        changedJarvisConfig(config!.config, action),
        config,
      );
      const fresh = await context(identity);
      if (
        hash(fresh.config?.config) !==
        hash(changedJarvisConfig(config!.config, action))
      )
        throw new Error("Saved setting could not be verified.");
      message = `Saved and read back ${action.setting.key} = ${JSON.stringify(action.setting.value)}. Existing execution permissions are unchanged.`;
    } else if (action.kind === "LEARN_LIBRARY") {
      const result = await syncLibraryKnowledge(identity.userId);
      message = `Library synchronization completed: ${JSON.stringify(result)}. Processing results remain in Knowledge Center; no live strategy changes were made.`;
    } else {
      const observed = await applyScannerControl(
        identity.userId,
        config!,
        action.kind === "SAFE_PAUSE" ? "EMERGENCY_STOP" : action.kind,
        ScannerStore.service(),
        action.kind === "RESUME_ANALYSIS"
          ? row.request.runtimeVersion
          : undefined,
      );
      message =
        action.kind === "SAFE_PAUSE"
          ? "Emergency pause verified: new automatic entries OFF; scanner PAUSED. Protective management, required data, reconciliation and audit remain enabled. Already submitted broker orders have NOT been canceled; broker status is unverified. Learning/backtest jobs are not stopped by this control. Check Connections and active orders."
          : `Verified scanner ${observed.scanner_state}, mode ${observed.trading_mode}, automatic execution ${observed.auto_execution_enabled ? "ON" : "OFF"}. No positions were closed.`;
    }
    return await finish(identity, row, {
      id: row.id,
      state: "SUCCEEDED",
      message,
      observedAt: new Date().toISOString(),
    });
  } catch (cause) {
    const message =
      cause instanceof ScannerError
        ? cause.message
        : "Action outcome could not be verified. Check the affected screen before retrying; no automatic retry was sent.";
    try {
      return await finish(identity, row, {
        id: row.id,
        state: "UNKNOWN",
        message,
      });
    } catch {
      return {
        id: row.id,
        state: "UNKNOWN",
        message: `${message} Command audit update also failed.`,
      };
    }
  }
}
export async function getJarvisCommand(identity: SupabaseIdentity, id: string) {
  const [row] = await ScannerStore.user(identity).request<CommandRow[]>(
    "onkar_agent_runs",
    {
      id: `eq.${id}`,
      user_id: `eq.${identity.userId}`,
      intent: "eq.JARVIS_COMMAND",
      limit: "1",
    },
  );
  if (!row) throw new ScannerError("Command not found.", 404);
  return publicResult(row);
}
export async function decideJarvisCommand(
  identity: SupabaseIdentity,
  id: string,
  decision: "CONFIRM" | "CANCEL",
  nonce: string,
) {
  const store = ScannerStore.service();
  const [row] = await store.request<CommandRow[]>("onkar_agent_runs", {
    id: `eq.${id}`,
    user_id: `eq.${identity.userId}`,
    intent: "eq.JARVIS_COMMAND",
    limit: "1",
  });
  if (!row) throw new ScannerError("Command not found.", 404);
  if (!canConfirmJarvis(row, sessionKey(identity), nonce))
    throw new ScannerError(
      "Confirmation expired, was already used, or belongs to another session. Request a fresh preview.",
      409,
    );
  const { config, runtime } = await context(identity);
  if (
    decision === "CONFIRM" &&
    (hash(config?.config) !== row.request.configHash ||
      hash(runtime) !== row.request.runtimeHash)
  )
    throw new ScannerError(
      "Settings or runtime changed since this preview. Request a fresh confirmation.",
      409,
    );
  const output: JarvisResult = {
    ...row.output,
    observedAt: new Date().toISOString(),
    state: decision === "CANCEL" ? "CANCELED" : "RUNNING",
    message:
      decision === "CANCEL"
        ? "Pending action canceled; nothing was changed."
        : "Confirmed. Verifying result.",
  };
  const claimed = await store.request<CommandRow[]>(
    "onkar_agent_runs",
    {
      id: `eq.${id}`,
      user_id: `eq.${identity.userId}`,
      "output->>state": "eq.AWAITING_CONFIRMATION",
      "output->>nonce": `eq.${nonce}`,
      "output->>expiresAt": `gt.${new Date().toISOString()}`,
    },
    "PATCH",
    {
      output,
      status: decision === "CANCEL" ? "failed" : "pending",
      command_log: [
        ...row.command_log,
        { timestamp: new Date().toISOString(), state: output.state },
      ],
    },
  );
  if (!claimed.length)
    throw new ScannerError(
      "This confirmation has already been used or expired.",
      409,
    );
  return decision === "CANCEL"
    ? output
    : executeJarvis(identity, claimed[0], config);
}
