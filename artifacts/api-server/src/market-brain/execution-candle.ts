import { timeframeMs, type Timeframe } from "@workspace/api-zod";

/** Scanner candidates store the OPEN timestamp of their last fully closed bar. */
export function confirmationAfterSourceActivation(
  lastCandleAt: string,
  timeframe: string,
  sourceActivatedAt: string,
) {
  const openedAt = Date.parse(lastCandleAt);
  const activatedAt = Date.parse(sourceActivatedAt);
  const duration = timeframeMs[timeframe as Timeframe];
  return Boolean(
    Number.isFinite(openedAt) &&
    Number.isFinite(activatedAt) &&
    duration &&
    openedAt + duration >= activatedAt,
  );
}

/** Broad database prefilter; the exact per-candidate timeframe is checked above. */
export function earliestEligibleCandleOpen(sourceActivatedAt: string) {
  const activatedAt = Date.parse(sourceActivatedAt);
  if (!Number.isFinite(activatedAt)) return null;
  return new Date(activatedAt - timeframeMs["1W"]).toISOString();
}
