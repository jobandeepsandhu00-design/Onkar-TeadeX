import { runNextJob } from "./scanner";
import { ScannerStore } from "./store";
import { logger } from "../lib/logger";
import { runNextAutoExecution } from "./auto-execution";

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
  let failures = 0,
    lastCleanup = 0;
  do {
    try {
      await runNextJob();
      await runNextAutoExecution();
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
