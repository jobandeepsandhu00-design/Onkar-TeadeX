/** Preserve customized section order while inserting newly shipped sections near their default anchor. */
export function mergeDashboardSections(
  stored: unknown,
  all: string[],
): string[] {
  if (!Array.isArray(stored)) return [...all];
  const result = [
    ...new Set(
      stored.filter(
        (k): k is string => typeof k === "string" && all.includes(k),
      ),
    ),
  ];
  for (const key of all) {
    if (result.includes(key)) continue;
    const anchor = all
      .slice(0, all.indexOf(key))
      .reverse()
      .find((k) => result.includes(k));
    result.splice(anchor ? result.indexOf(anchor) + 1 : 0, 0, key);
  }
  return result;
}

export function moveDashboardSection(
  stored: unknown,
  all: string[],
  key: string,
  direction: -1 | 1,
): string[] {
  const order = mergeDashboardSections(stored, all);
  const index = order.indexOf(key);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return order;
  const next = [...order];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

/** Keep the live research/data cards immediately below Video Strategy Learning. */
export function groupLearningDashboardCards(order: string[]): string[] {
  const anchor = "videoLearning";
  const grouped = ["luxAlgoResearch", "candleClosures", "marketCandles"];
  if (!order.includes(anchor)) return [...order];
  const present = grouped.filter((key) => order.includes(key));
  const next = order.filter((key) => !present.includes(key));
  next.splice(next.indexOf(anchor) + 1, 0, ...present);
  return next;
}
