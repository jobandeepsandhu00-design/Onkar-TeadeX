import { scannerConfigSchema } from "@workspace/api-zod";
import {
  autoExecutionWorkerEnabled,
  getAutoExecutionCapability,
  reconcileAutoExecution,
  runNextAutoExecution as runNextMT5Execution,
  type AutoExecutionCapability,
} from "./auto-execution";
import { manageNextPaperTrade, runNextPaperExecution } from "./paper-execution";
import { getMarketProvider } from "./providers";
import { ScannerStore, type ConfigRow } from "./store";

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
): Promise<AutoExecutionCapability> {
  if (source === "MT5") return getAutoExecutionCapability(userId);
  if (!autoExecutionWorkerEnabled())
    return {
      ready: false,
      state: "DISABLED",
      reason: "AUTO execution worker is disabled on the server.",
      accountType: null,
      broker: null,
    };
  const health = await getMarketProvider("twelvedata").healthCheck();
  return health.status === "connected"
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
          health.status === "unconfigured" ? "NOT_CONFIGURED" : "DISCONNECTED",
        reason: health.message,
        accountType: null,
        broker: null,
      };
}

export async function reconcileExecution(
  userId: string,
  source: "MT5" | "TWELVE_DATA",
) {
  return source === "MT5"
    ? reconcileAutoExecution(userId)
    : getExecutionCapability(userId, source);
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
      await reconcileAutoExecution(runtime.user_id);
      await switchSource(store, runtime, "MT5", false);
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
    return "ANALYSIS_ONLY";
  }
  return "MT5_LOCKED";
}

/**
 * The only automatic execution destination switch. Setup detection remains
 * provider-neutral; persisted runtime state chooses the execution provider.
 */
export async function runNextExecution() {
  if (!autoExecutionWorkerEnabled())
    return { skipped: true, reason: "AUTO execution worker is disabled." };
  const store = ScannerStore.service();
  const management = await manageNextPaperTrade(store).catch((error) => ({
    skipped: true,
    reason:
      error instanceof Error
        ? error.message
        : "Paper trade management failed safely.",
  }));
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
      sourcePolicy,
      reason: "No automatic execution runtime is armed.",
    };
  if (runtime.trading_source === "TWELVE_DATA") {
    const paper = await runNextPaperExecution(store);
    return { provider: "PAPER", management, sourcePolicy, execution: paper };
  }
  const mt5 = await runNextMT5Execution();
  return { provider: "MT5", management, sourcePolicy, execution: mt5 };
}
