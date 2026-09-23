import { timeframeMs, type Timeframe } from "@workspace/api-zod";

/** Candidate timestamps identify the open of the last evaluated CLOSED bar. */
export function nextCandidateCloseAt(lastCandleAt: string, timeframe: string) {
  const interval = timeframeMs[timeframe as Timeframe];
  const lastOpen = Date.parse(lastCandleAt);
  if (!interval || !Number.isFinite(lastOpen)) return null;
  return lastOpen + interval * 2;
}
