import { scannerConfigSchema, type ScannerConfig } from "@workspace/api-zod";
import type { SupabaseIdentity } from "../lib/supabase-auth";
import { latestApprovedVersions } from "./strategy-selection";
import {
  ScannerError,
  ScannerStore,
  records,
  type ConfigRow,
  type VersionRow,
} from "./store";

/** Shared by manual controls and Jarvis. Does not shut down protective management. */
export async function applyScannerControl(
  userId: string,
  config: ConfigRow,
  action: string,
  store = ScannerStore.service(),
  expectedVersion?: string | null,
): Promise<Record<string, unknown> & { controlAuditRecorded: boolean }> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (action === "PAUSE") patch.scanner_state = "PAUSED";
  else if (action === "RESUME") patch.scanner_state = "RUNNING";
  else if (action === "STOP") patch.scanner_state = "STOPPED";
  else if (action === "DISABLE_AUTO")
    Object.assign(patch, {
      trading_mode: "CONFIRM",
      auto_execution_enabled: false,
    });
  else if (action === "EMERGENCY_STOP")
    Object.assign(patch, {
      scanner_state: "PAUSED",
      trading_mode: "ANALYSIS",
      auto_execution_enabled: false,
      emergency_stop: true,
    });
  else if (action === "RESUME_ANALYSIS")
    Object.assign(patch, {
      scanner_state: "RUNNING",
      trading_mode: "ANALYSIS",
      auto_execution_enabled: false,
      emergency_stop: false,
      auto_start: true,
    });
  else throw new ScannerError("Unknown control action.", 400);
  const existing = await store.request<Array<Record<string, unknown>>>(
    "scanner_runtime_controls",
    { user_id: `eq.${userId}`, limit: "1" },
  );
  if (existing[0]) {
    const filter: Record<string, string> = { user_id: `eq.${userId}` };
    if (expectedVersion !== undefined) {
      if (existing[0].updated_at !== expectedVersion)
        throw new ScannerError(
          "Runtime changed. Request a new confirmation.",
          409,
        );
      filter.updated_at = `eq.${expectedVersion}`;
    }
    const changed = await store.request<unknown[]>(
      "scanner_runtime_controls",
      filter,
      "PATCH",
      patch,
    );
    if (!changed.length)
      throw new ScannerError(
        "Runtime changed while applying this control. No success is assumed.",
        409,
      );
  } else
    await store.request("scanner_runtime_controls", {}, "POST", {
      user_id: userId,
      workspace_id: config.workspace_id,
      scanner_config_id: config.id,
      scanner_state: "STOPPED",
      trading_mode: "ANALYSIS",
      auto_execution_enabled: false,
      emergency_stop: false,
      auto_start: false,
      ...patch,
    });
  const [observed] = await store.request<Array<Record<string, unknown>>>(
    "scanner_runtime_controls",
    { user_id: `eq.${userId}`, limit: "1" },
  );
  if (
    !observed ||
    Object.entries(patch).some(
      ([key, value]) => key !== "updated_at" && observed[key] !== value,
    )
  )
    throw new ScannerError(
      "Control result is uncertain. Refresh system status before retrying.",
      409,
    );
  let controlAuditRecorded = true;
  try {
    await store.request("scanner_execution_events", {}, "POST", {
      user_id: userId,
      workspace_id: config.workspace_id,
      state: action.startsWith("RESUME") ? "RISK_CHECK" : "BLOCKED",
      reason: `System control: ${action}`,
      detail: {
        action,
        observedRuntime: observed,
        protectiveManagementUnchanged: true,
      },
    });
  } catch {
    controlAuditRecorded = false; /* Audit outage must not prevent protective pause. */
  }
  return { ...observed, controlAuditRecorded };
}

/** Final fail-closed check after sizing/AI/broker preflight, before entry submission. */
export async function automaticEntryStillAllowed(
  store: ScannerStore,
  userId: string,
  configId: string,
  source: "MT5" | "TWELVE_DATA",
) {
  const [runtime] = await store.request<Array<Record<string, unknown>>>(
    "scanner_runtime_controls",
    {
      user_id: `eq.${userId}`,
      scanner_config_id: `eq.${configId}`,
      trading_source: `eq.${source}`,
      scanner_state: "eq.RUNNING",
      trading_mode: "eq.AUTO",
      auto_execution_enabled: "eq.true",
      emergency_stop: "eq.false",
      limit: "1",
    },
  );
  return Boolean(runtime);
}

/** Existing ownership, approved-version and lease-fencing rules, reused by both interfaces. */
export async function saveScannerConfig(
  identity: SupabaseIdentity,
  value: ScannerConfig,
  config?: ConfigRow,
) {
  const parsed = scannerConfigSchema.parse(value),
    user = ScannerStore.user(identity);
  const source = await user.source(identity.userId);
  if (
    parsed.accountId &&
    !records(source.tradingAccounts).some((a) => a.id === parsed.accountId)
  )
    throw new ScannerError("Select one of your existing accounts.", 400);
  const versions = latestApprovedVersions(
    await user.request<VersionRow[]>("scanner_strategy_versions"),
  );
  if (
    parsed.strategyVersionIds.some(
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
  if (
    parsed.enabled &&
    !parsed.autoActivateApprovedSetups &&
    !parsed.strategyVersionIds.length
  )
    throw new ScannerError(
      "Approve a rule version before enabling scanning.",
      400,
    );
  const [membership] = await user.request<Array<{ workspace_id: string }>>(
    "workspace_members",
    { user_id: `eq.${identity.userId}`, limit: "1" },
  );
  if (!membership)
    throw new ScannerError(
      "No existing workspace found. Open your journal once, then retry.",
      409,
    );
  const store = ScannerStore.service();
  if (parsed.paperFastEntry !== Boolean(config?.config.paperFastEntry)) {
    const activatedAt = new Date().toISOString();
    // A policy change fences old Paper confirmations before configuration
    // changes. A failed config write leaves entries more restricted, not less.
    await store.request(
      "scanner_runtime_controls",
      {
        user_id: `eq.${identity.userId}`,
        trading_source: "eq.TWELVE_DATA",
      },
      "PATCH",
      { source_activated_at: activatedAt, updated_at: activatedAt },
    );
  }
  await store.rpc("configure_scanner", {
    p_user: identity.userId,
    p_workspace: config?.workspace_id ?? membership.workspace_id,
    p_config: parsed,
  });
}
