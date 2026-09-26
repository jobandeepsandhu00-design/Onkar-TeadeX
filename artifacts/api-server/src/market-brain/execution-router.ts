import { scannerConfigSchema } from "@workspace/api-zod";
import {
  autoExecutionWorkerEnabled,
  getAutoExecutionCapability,
  reconcileAutoExecution,
  reconcilePendingAutoExecution,
  runNextAutoExecution as runNextMT5Execution,
  type AutoExecutionCapability,
} from "./auto-execution";
import { manageNextPaperTrade, runNextPaperExecution } from "./paper-execution";
import { getMarketProvider } from "./providers";
import { ScannerStore, type ConfigRow } from "./store";
import { NotificationService } from "../notifications/service";

export function storedTwelveDataCapability(
  config: ConfigRow,
  now = Date.now(),
): AutoExecutionCapability {
  if (!autoExecutionWorkerEnabled())
    return {
      ready: false,
      state: "DISABLED",
      reason: "AUTO execution worker is disabled on the server.",
      accountType: null,
      broker: null,
    };
  const checkedAt = Date.parse(String(config.health.checkedAt || ""));
  const maxAgeMs = Math.max(20 * 60_000, config.config.frequencySeconds * 2000);
  const fresh =
    Number.isFinite(checkedAt) &&
    now - checkedAt <= maxAgeMs &&
    config.health.status === "connected" &&
    !config.last_error;
  return fresh
    ? {
        ready: true,
        state: "READY",
        reason:
          "Fresh Twelve Data scanner candles are ready for Paper execution.",
        accountType: "DEMO",
        broker: "Onkar Paper",
      }
    : {
        ready: false,
        state: "DISCONNECTED",
        reason: config.last_error
          ? `Market data is paused: ${config.last_error}`
          : "Waiting for a successful fresh Twelve Data scanner cycle.",
        accountType: null,
        broker: null,
      };
}

const TWELVE_DATA_HEALTH_TTL_MS = 15 * 60_000;
let twelveDataCapabilityCache:
  | { expiresAt: number; value: AutoExecutionCapability }
  | undefined;
let twelveDataCapabilityRequest: Promise<AutoExecutionCapability> | undefined;

async function getTwelveDataCapability() {
  const now = Date.now();
  if (twelveDataCapabilityCache && twelveDataCapabilityCache.expiresAt > now)
    return twelveDataCapabilityCache.value;
  if (twelveDataCapabilityRequest) return twelveDataCapabilityRequest;
  twelveDataCapabilityRequest = (async () => {
    const health = await getMarketProvider("twelvedata").healthCheck();
    const value: AutoExecutionCapability =
      health.status === "connected"
        ? {
            ready: true,
            state: "READY",
            reason: "Twelve Data Paper execution is ready.",
            accountType: "DEMO",
            broker: "Onkar Paper",
          }
        : {
            ready: false,
            state:
              health.status === "unconfigured"
                ? "NOT_CONFIGURED"
                : "DISCONNECTED",
            reason: health.message,
            accountType: null,
            broker: null,
          };
    twelveDataCapabilityCache = {
      expiresAt: Date.now() + TWELVE_DATA_HEALTH_TTL_MS,
      value,
    };
    return value;
  })().finally(() => {
    twelveDataCapabilityRequest = undefined;
  });
  return twelveDataCapabilityRequest;
}

type SourceRuntime = {
  user_id: string;
  workspace_id: string;
  scanner_config_id: string;
  trading_source: "MT5" | "TWELVE_DATA";
  mt5_disconnect_behavior: "LOCK" | "PAPER" | "ANALYSIS";
  auto_return_mt5: boolean;
  fallback_from_mt5: boolean;
};

export async function getExecutionCapability(
  userId: string,
  source: "MT5" | "TWELVE_DATA",
  config?: ConfigRow,
): Promise<AutoExecutionCapability> {
  if (source === "MT5") return getAutoExecutionCapability(userId);
  if (config) return storedTwelveDataCapability(config);
  if (!autoExecutionWorkerEnabled())
    return {
      ready: false,
      state: "DISABLED",
      reason: "AUTO execution worker is disabled on the server.",
      accountType: null,
      broker: null,
    };
  return getTwelveDataCapability();
}

export async function reconcileExecution(
  userId: string,
  source: "MT5" | "TWELVE_DATA",
  config?: ConfigRow,
) {
  return source === "MT5"
    ? reconcileAutoExecution(userId)
    : getExecutionCapability(userId, source, config);
}

async function switchSource(
  store: ScannerStore,
  runtime: SourceRuntime,
  source: "MT5" | "TWELVE_DATA",
  fallbackFromMt5: boolean,
) {
  const [config] = await store.request<ConfigRow[]>("scanner_configs", {
    id: `eq.${runtime.scanner_config_id}`,
    user_id: `eq.${runtime.user_id}`,
    limit: "1",
  });
  if (!config) return false;
  const parsed = scannerConfigSchema.parse(config.config);
  await store.rpc("configure_scanner", {
    p_user: runtime.user_id,
    p_workspace: runtime.workspace_id,
    p_config: {
      ...parsed,
      provider: source === "MT5" ? "mt5" : "twelvedata",
    },
  });
  await store.request(
    "scanner_runtime_controls",
    { user_id: `eq.${runtime.user_id}` },
    "PATCH",
    {
      trading_source: source,
      fallback_from_mt5: fallbackFromMt5,
      source_activated_at: new Date().toISOString(),
      reconciled_at: source === "MT5" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
  );
  return true;
}

async function applyAutomaticSourcePolicy(store: ScannerStore) {
  const [runtime] = await store.request<SourceRuntime[]>(
    "scanner_runtime_controls",
    {
      scanner_state: "eq.RUNNING",
      trading_mode: "eq.AUTO",
      auto_execution_enabled: "eq.true",
      emergency_stop: "eq.false",
      order: "updated_at.asc",
      limit: "1",
    },
  );
  if (!runtime) return null;
  if (
    runtime.trading_source === "TWELVE_DATA" &&
    runtime.fallback_from_mt5 &&
    runtime.auto_return_mt5
  ) {
    const mt5 = await getAutoExecutionCapability(runtime.user_id);
    if (mt5.ready) {
      const reconciliation = await reconcileAutoExecution(runtime.user_id);
      if (!reconciliation.ready) return "MT5_RECONCILIATION_BLOCKED";
      await switchSource(store, runtime, "MT5", false);
      await new NotificationService(store)
        .systemHealth({
          userId: runtime.user_id,
          component: "MT5",
          healthy: true,
          message:
            "MT5 recovered, positions were reconciled, and new eligible setups can route to MT5 again.",
        })
        .catch(() => undefined);
      return "MT5_RESTORED";
    }
  }
  if (runtime.trading_source !== "MT5") return null;
  const mt5 = await getAutoExecutionCapability(runtime.user_id);
  if (mt5.ready) return null;
  if (runtime.mt5_disconnect_behavior === "PAPER") {
    const paper = await getExecutionCapability(runtime.user_id, "TWELVE_DATA");
    if (paper.ready) {
      await switchSource(store, runtime, "TWELVE_DATA", true);
      await new NotificationService(store)
        .systemHealth({
          userId: runtime.user_id,
          component: "MT5",
          healthy: false,
          message: `MT5 is unavailable: ${mt5.reason} New broker orders are blocked; the explicitly configured Twelve Data Paper fallback is active. Existing MT5 positions retain MT5 ownership.`,
          metadata: { fallback: "TWELVE_DATA_PAPER" },
        })
        .catch(() => undefined);
      return "PAPER_FALLBACK";
    }
  }
  if (runtime.mt5_disconnect_behavior === "ANALYSIS") {
    await store.request(
      "scanner_runtime_controls",
      { user_id: `eq.${runtime.user_id}` },
      "PATCH",
      {
        trading_mode: "ANALYSIS",
        auto_execution_enabled: false,
        updated_at: new Date().toISOString(),
      },
    );
    await new NotificationService(store)
      .systemHealth({
        userId: runtime.user_id,
        component: "MT5",
        healthy: false,
        message: `MT5 is unavailable: ${mt5.reason} New execution is paused and analysis-only mode is active.`,
        metadata: { fallback: "ANALYSIS_ONLY" },
      })
      .catch(() => undefined);
    return "ANALYSIS_ONLY";
  }
  await new NotificationService(store)
    .systemHealth({
      userId: runtime.user_id,
      component: "MT5",
      healthy: false,
      message: `MT5 is unavailable: ${mt5.reason} New MT5 orders are locked. No silent provider switch was made.`,
      metadata: { fallback: "LOCKED" },
    })
    .catch(() => undefined);
  return "MT5_LOCKED";
}

/**
 * The only automatic execution destination switch. Setup detection remains
 * provider-neutral; persisted runtime state chooses the execution provider.
 */
export async function runNextExecution() {
  const enabled = autoExecutionWorkerEnabled();
  const store = ScannerStore.service();
  const management = enabled
    ? await manageNextPaperTrade(store).catch((error) => ({
        skipped: true,
        reason:
          error instanceof Error
            ? error.message
            : "Paper trade management failed safely.",
      }))
    : { skipped: true, reason: "AUTO execution worker is disabled." };
  // Exact-request recovery remains active even while new AUTO submission is
  // disabled. Otherwise a configuration change could strand a global manual
  // and AUTO execution lock indefinitely.
  const autoReconciliation = await reconcilePendingAutoExecution(store).catch(
    (error) => ({
      blocking: true,
      state: "UNCERTAIN" as const,
      reason:
        error instanceof Error
          ? `MT5 AUTO reconciliation is unavailable: ${error.message}`
          : "MT5 AUTO reconciliation is unavailable.",
    }),
  );
  if (autoReconciliation.blocking)
    return {
      skipped: true,
      management,
      autoReconciliation,
      reason: autoReconciliation.reason,
    };
  if (!enabled)
    return {
      skipped: true,
      management,
      autoReconciliation,
      reason: "AUTO execution worker is disabled.",
    };
  const sourcePolicy = await applyAutomaticSourcePolicy(store);
  const [runtime] = await store.request<SourceRuntime[]>(
    "scanner_runtime_controls",
    {
      scanner_state: "eq.RUNNING",
      trading_mode: "eq.AUTO",
      auto_execution_enabled: "eq.true",
      emergency_stop: "eq.false",
      order: "updated_at.asc",
      limit: "1",
    },
  );
  if (!runtime)
    return {
      skipped: true,
      management,
      autoReconciliation,
      sourcePolicy,
      reason: "No automatic execution runtime is armed.",
    };
  if (runtime.trading_source === "TWELVE_DATA") {
    const [config] = await store.request<ConfigRow[]>("scanner_configs", {
      id: `eq.${runtime.scanner_config_id}`,
      user_id: `eq.${runtime.user_id}`,
      limit: "1",
    });
    const capability = config
      ? storedTwelveDataCapability(config)
      : {
          ready: false,
          state: "DISCONNECTED" as const,
          reason: "Scanner configuration is unavailable.",
          accountType: null,
          broker: null,
        };
    await new NotificationService(store)
      .systemHealth({
        userId: runtime.user_id,
        component: "Twelve Data",
        healthy: capability.ready,
        message: capability.ready
          ? "Twelve Data is fresh and available to the shared market engine."
          : `${capability.reason} New Paper entries remain blocked until fresh data returns.`,
        metadata: { executionProvider: "PAPER" },
      })
      .catch(() => undefined);
    if (!capability.ready)
      return {
        provider: "PAPER",
        management,
        autoReconciliation,
        sourcePolicy,
        execution: { blocked: true, reason: capability.reason },
      };
    const paper = await runNextPaperExecution(store);
    return {
      provider: "PAPER",
      management,
      autoReconciliation,
      sourcePolicy,
      execution: paper,
    };
  }
  const mt5 = await runNextMT5Execution();
  return {
    provider: "MT5",
    management,
    autoReconciliation,
    sourcePolicy,
    execution: mt5,
  };
}
