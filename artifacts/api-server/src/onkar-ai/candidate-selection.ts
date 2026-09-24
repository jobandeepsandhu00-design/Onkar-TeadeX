import type { CandidateRow } from "../market-brain/store";

const rank: Record<CandidateRow["state"], number> = {
  READY: 5,
  WATCH: 4,
  DEVELOPING: 3,
  SCANNING: 2,
  TRIGGERED: 1,
  INVALIDATED: 0,
  EXPIRED: 0,
  COMPLETED: 0,
};

/** Select relevant scanner evidence, never an expired or terminal setup. */
export function selectLiveCandidate(
  rows: CandidateRow[],
  options: {
    candidateId?: string;
    configId?: string;
    symbol?: string;
    timeframe?: string;
    now?: number;
  },
): CandidateRow | undefined {
  if (options.candidateId)
    return rows.find((row) => row.id === options.candidateId);

  const now = options.now ?? Date.now();
  return rows
    .filter((row) =>
      (!options.configId || row.config_id === options.configId) &&
      (!options.symbol || row.symbol === options.symbol) &&
      rank[row.state] > 0 &&
      Number.isFinite(Date.parse(row.expires_at)) &&
      Date.parse(row.expires_at) > now,
    )
    .sort((left, right) =>
      Number(right.timeframe.toLowerCase() === options.timeframe?.toLowerCase()) -
        Number(left.timeframe.toLowerCase() === options.timeframe?.toLowerCase()) ||
      rank[right.state] - rank[left.state] ||
      right.score - left.score ||
      Date.parse(right.updated_at ?? right.last_candle_at) -
        Date.parse(left.updated_at ?? left.last_candle_at),
    )[0];
}
