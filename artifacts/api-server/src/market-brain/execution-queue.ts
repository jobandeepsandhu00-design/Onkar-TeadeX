/** Prefer never-attempted READY signals, then the one waiting longest since a block. */
export function orderExecutionCandidates<T extends { id: string }>(
  candidates: T[],
  blockedEvents: Array<{ candidate_id: string | null; created_at: string }>,
  executedIds: ReadonlySet<string>,
) {
  const latestBlock = new Map<string, number>();
  for (const event of blockedEvents) {
    if (!event.candidate_id) continue;
    const at = Date.parse(event.created_at);
    if (Number.isFinite(at))
      latestBlock.set(
        event.candidate_id,
        Math.max(at, latestBlock.get(event.candidate_id) ?? 0),
      );
  }
  return candidates
    .filter((candidate) => !executedIds.has(candidate.id))
    .sort(
      (a, b) => (latestBlock.get(a.id) ?? 0) - (latestBlock.get(b.id) ?? 0),
    );
}
