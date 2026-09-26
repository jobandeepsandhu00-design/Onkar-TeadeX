import { runNextJob } from "./scanner";
import { ScannerStore } from "./store";
import { logger } from "../lib/logger";
import { reconcileConfiguredAutoExecution } from "./auto-execution";
import { syncConfiguredMT5Journal } from "../mt5/journal-sync";
import { runNextExecution } from "./execution-router";

let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
async function main() {
  if (process.env.SCANNER_ENABLED !== "true") {
    logger.info(
      "Scanner disabled. Set SCANNER_ENABLED=true on the worker to enable analysis-only processing.",
    );
    return;
  }
  ScannerStore.service(); // fail visibly at startup, not an unbounded configuration retry loop
  const [reconciliation, journal] = await Promise.all([
    reconcileConfiguredAutoExecution().catch((error) => ({
      skipped: true,
      reason: error instanceof Error ? error.message : "MT5 reconciliation failed",
    })),
    syncConfiguredMT5Journal().catch((error) => ({
      skipped: true,
      reason: error instanceof Error ? error.message : "MT5 journal sync failed",
    })),
  ]);
  logger.info(
    { event: "mt5_startup_reconciliation", reconciliation, journal },
    "Existing MT5 broker state reconciled before scanner execution",
  );
  let failures = 0,
    lastCleanup = 0;
  do {
    try {
      await runNextJob();
      await runNextExecution();
      failures = 0;
      if (Date.now() - lastCleanup > 86400e3) {
        await ScannerStore.service().rpc("cleanup_scanner_cache", {});
        lastCleanup = Date.now();
      }
    } catch {
      failures++;
      logger.error(
        { event: "scanner_worker_failure", failures },
        "Scanner backend unavailable; retrying with backoff",
      );
    }
    if (process.argv.includes("--once")) return;
    // Interruptible bounded wait; SIGTERM exits within one second outside an active job.
    for (
      let second = 0;
      !stopped && second < Math.min(60, 5 * 2 ** failures);
      second++
    )
      await new Promise((r) => setTimeout(r, 1000));
  } while (!stopped);
}
main().catch(() => {
  logger.error(
    "Scanner startup failed. Verify server-only Supabase configuration.",
  );
  process.exitCode = 1;
});
