import { timeframeMs, type SharedChartTimeframe } from "@workspace/api-zod";

export type CandleClosureState = "verified" | "awaiting" | "stale" | "unavailable";

/** UTC-aligned market boundaries; a timer never proves that provider data closed. */
export function candleClosureClock(
  timeframe: SharedChartTimeframe,
  lastClosedOpenTime: number | null,
  now: number,
  sourceAvailable = true,
) {
  const interval = timeframeMs[timeframe];
  const mostRecentBoundary = Math.floor(now / interval) * interval;
  const nextScheduledCloseAt = mostRecentBoundary + interval;
  const lastClosedAt =
    lastClosedOpenTime !== null && Number.isFinite(lastClosedOpenTime) &&
    lastClosedOpenTime >= 0 && lastClosedOpenTime + interval <= now
      ? lastClosedOpenTime + interval
      : null;
  let state: CandleClosureState = "unavailable";
  if (lastClosedAt !== null) {
    state = !sourceAvailable || mostRecentBoundary - lastClosedAt > interval
      ? "stale"
      : lastClosedAt < mostRecentBoundary
        ? "awaiting"
        : "verified";
  }
  return {
    state,
    lastClosedAt,
    nextScheduledCloseAt,
    remainingMs: Math.max(0, nextScheduledCloseAt - now),
  };
}

export function formatCandleCountdown(remainingMs: number) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}`
    : `${String(minutes).padStart(2, "0")}:${tail}`;
}
