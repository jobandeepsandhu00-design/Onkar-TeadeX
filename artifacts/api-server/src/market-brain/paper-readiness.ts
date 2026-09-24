import { confirmationAfterSourceActivation } from "./execution-candle";

type PaperCandidateEvidence = {
  last_candle_at: string;
  timeframe: string;
  payload: {
    stale: boolean;
    risk: { allowed: boolean; warnings: string[] };
    paperFastEntryApplied?: boolean;
    news: { status: string };
  };
};

/** Read-only explanation of the same pre-selection gates used by Paper AUTO. */
export function paperCandidateBlockers(
  candidate: PaperCandidateEvidence,
  sourceActivatedAt: string,
  paperFastEntry: boolean,
  requireNews: boolean,
) {
  const blockers: string[] = [];
  if (
    !confirmationAfterSourceActivation(
      candidate.last_candle_at,
      candidate.timeframe,
      sourceActivatedAt,
    )
  )
    blockers.push(
      "Confirmation candle closed before the Paper source was activated",
    );
  if (candidate.payload.stale)
    blockers.push("Scanner candle evidence is stale");
  if (!candidate.payload.risk.allowed)
    blockers.push("Risk approval is missing");
  blockers.push(...candidate.payload.risk.warnings);
  if (candidate.payload.paperFastEntryApplied && !paperFastEntry)
    blockers.push("Paper Fast Entry was switched off after confirmation");
  if (requireNews && candidate.payload.news.status !== "safe")
    blockers.push(`News clearance is ${candidate.payload.news.status}`);
  return [...new Set(blockers)];
}
