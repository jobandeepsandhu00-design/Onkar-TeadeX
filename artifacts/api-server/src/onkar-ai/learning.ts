import { numeric, records } from "../market-brain/store";

export type LearnedTrade = {
  id: string;
  closed: boolean;
  outcome: "WIN" | "LOSS" | "BE" | "PARTIAL" | "UNKNOWN";
  pnl: number | null;
  rMultiple: number | null;
  symbol: string;
  direction: string;
  setupId: string;
  setupName: string;
  strategyVersionId: string | null;
  timeframe: string;
  session: string;
  mistakes: string[];
  strengths: string[];
  rulesPassed: string[];
  rulesFailed: string[];
  date: string;
  raw: Record<string, unknown>;
};

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 30)
    : [];

export function normalizeTrades(source: Record<string, unknown>): LearnedTrade[] {
  const setups = new Map(
    records(source.setups).map((setup) => [String(setup.id), String(setup.name || "Unassigned")]),
  );
  return records(source.trades).map((trade, index) => {
    const entry = numeric(trade.entry), exit = numeric(trade.exit), stop = numeric(trade.sl);
    const importedPnl = numeric(trade.netPnl) ?? numeric(trade.manualPnl) ?? numeric(trade.pnl);
    const direction = /sell|short/i.test(String(trade.side || trade.direction || "buy")) ? "short" : "long";
    const move = entry !== null && exit !== null ? (exit - entry) * (direction === "short" ? -1 : 1) : null;
    const risk = entry !== null && stop !== null ? Math.abs(entry - stop) : null;
    const rMultiple = numeric(trade.rMultiple) ?? (move !== null && risk ? move / risk : null);
    const rawResult = String(trade.result || trade.outcome || "").toLowerCase();
    const closed = exit !== null || importedPnl !== null || /win|loss|break|partial|closed/.test(rawResult);
    const basis = importedPnl ?? move;
    const outcome = !closed ? "UNKNOWN"
      : rawResult.includes("partial") ? "PARTIAL"
      : rawResult.includes("break") || rawResult === "be" || basis === 0 ? "BE"
      : rawResult.includes("win") || (basis !== null && basis > 0) ? "WIN"
      : rawResult.includes("loss") || (basis !== null && basis < 0) ? "LOSS" : "UNKNOWN";
    const checks = Array.isArray(trade.ruleChecks) ? trade.ruleChecks : [];
    const passed = checks.filter((item) => item === true || (item && typeof item === "object" && (item as { passed?: boolean }).passed === true));
    const failed = checks.filter((item) => item === false || (item && typeof item === "object" && (item as { passed?: boolean }).passed === false));
    const label = (item: unknown, position: number) =>
      item && typeof item === "object" ? String((item as { name?: string; id?: string }).name || (item as { id?: string }).id || `Rule ${position + 1}`) : `Rule ${position + 1}`;
    const setupId = String(trade.setupId || "");
    return {
      id: String(trade.id || `trade-${index}`), closed, outcome, pnl: importedPnl,
      rMultiple, symbol: String(trade.symbol || "").toUpperCase(), direction,
      setupId, setupName: String(trade.setupName || setups.get(setupId) || "Unassigned"),
      strategyVersionId: trade.strategyVersionId ? String(trade.strategyVersionId) : null,
      timeframe: String(trade.timeframe || "Unspecified"), session: String(trade.session || "Unspecified"),
      mistakes: strings(trade.mistakes), strengths: strings(trade.strengths),
      rulesPassed: passed.map(label), rulesFailed: failed.map(label),
      date: String(trade.exitDate || trade.date || ""), raw: trade,
    };
  });
}

export function sampleConfidence(sample: number) {
  if (sample < 5) return { level: "insufficient", label: "Insufficient sample" } as const;
  if (sample < 10) return { level: "very_low", label: "Very low confidence" } as const;
  if (sample < 20) return { level: "early", label: "Early pattern" } as const;
  if (sample < 50) return { level: "moderate", label: "Moderate evidence" } as const;
  return { level: "stronger", label: "Stronger historical evidence" } as const;
}

export function summarizeTrades(trades: LearnedTrade[]) {
  const closed = trades.filter((trade) => trade.closed && trade.outcome !== "UNKNOWN");
  const wins = closed.filter((trade) => trade.outcome === "WIN").length;
  const losses = closed.filter((trade) => trade.outcome === "LOSS").length;
  const pnlRows = closed.filter((trade) => trade.pnl !== null);
  const rRows = closed.filter((trade) => trade.rMultiple !== null);
  const grossWin = pnlRows.reduce((sum, trade) => sum + Math.max(0, trade.pnl!), 0);
  const grossLoss = Math.abs(pnlRows.reduce((sum, trade) => sum + Math.min(0, trade.pnl!), 0));
  const group = (key: keyof Pick<LearnedTrade, "setupName" | "symbol" | "session" | "timeframe">) =>
    [...new Set(closed.map((trade) => trade[key] || "Unspecified"))].map((name) => {
      const rows = closed.filter((trade) => (trade[key] || "Unspecified") === name);
      const knownR = rows.filter((trade) => trade.rMultiple !== null);
      const knownPnl = rows.filter((trade) => trade.pnl !== null);
      return { key: name, sample: rows.length, wins: rows.filter((trade) => trade.outcome === "WIN").length,
        winRate: rows.length ? rows.filter((trade) => trade.outcome === "WIN").length / rows.length * 100 : null,
        averageR: knownR.length ? knownR.reduce((sum, trade) => sum + trade.rMultiple!, 0) / knownR.length : null,
        pnl: knownPnl.length ? knownPnl.reduce((sum, trade) => sum + trade.pnl!, 0) : null,
        confidence: sampleConfidence(rows.length) };
    }).sort((a, b) => (b.averageR ?? -Infinity) - (a.averageR ?? -Infinity) || b.sample - a.sample);
  const mistakes = new Map<string, { occurrences: number; losses: number }>();
  for (const trade of closed) for (const mistake of trade.mistakes) {
    const value = mistakes.get(mistake) ?? { occurrences: 0, losses: 0 };
    value.occurrences += 1; if (trade.outcome === "LOSS") value.losses += 1; mistakes.set(mistake, value);
  }
  return { sample: closed.length, confidence: sampleConfidence(closed.length), wins, losses,
    winRate: closed.length ? wins / closed.length * 100 : null,
    averageR: rRows.length ? rRows.reduce((sum, trade) => sum + trade.rMultiple!, 0) / rRows.length : null,
    pnl: pnlRows.length ? pnlRows.reduce((sum, trade) => sum + trade.pnl!, 0) : null,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? null : null,
    bySetup: group("setupName"), bySymbol: group("symbol"), bySession: group("session"), byTimeframe: group("timeframe"),
    mistakes: [...mistakes.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.occurrences - a.occurrences),
    caution: "Only closed, recorded trades are used. Behavioral tags come only from user-saved evidence.",
  };
}

export function similarTrades(trades: LearnedTrade[], query: Partial<LearnedTrade>, limit = 5) {
  return trades.filter((trade) => trade.closed).map((trade) => {
    let score = 0; const matches: string[] = [];
    const add = (ok: boolean, points: number, label: string) => { if (ok) { score += points; matches.push(label); } };
    add(Boolean(query.setupId && trade.setupId === query.setupId), 35, "same setup");
    add(Boolean(query.setupName && trade.setupName.toLowerCase() === query.setupName.toLowerCase()), 30, "same setup name");
    add(Boolean(query.symbol && trade.symbol === query.symbol), 25, "same symbol");
    add(Boolean(query.timeframe && trade.timeframe === query.timeframe), 15, "same timeframe");
    add(Boolean(query.session && trade.session === query.session), 10, "same session");
    add(Boolean(query.direction && trade.direction === query.direction), 10, "same direction");
    return { trade, score, matches };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || b.trade.date.localeCompare(a.trade.date)).slice(0, limit);
}

export function deriveLearningInsights(summary: ReturnType<typeof summarizeTrades>) {
  const insights: Array<Record<string, unknown>> = [];
  const bestSetup = summary.bySetup.find((row) => row.sample >= 5 && row.averageR !== null);
  if (bestSetup) insights.push({ insight_key: `strategy:${bestSetup.key}:performance`, scope: "STRATEGY", type: "SETUP_PERFORMANCE", title: `${bestSetup.key} recorded performance`,
    description: `${bestSetup.averageR!.toFixed(2)}R average across ${bestSetup.sample} recorded trades.`, evidence_json: bestSetup,
    sample_size: bestSetup.sample, confidence: bestSetup.confidence.level, strategy_id: bestSetup.key });
  const bestSession = summary.bySession.find((row) => row.sample >= 5 && row.averageR !== null);
  if (bestSession) insights.push({ insight_key: `session:${bestSession.key}:performance`, scope: "SESSION", type: "SESSION_PERFORMANCE", title: `${bestSession.key} session evidence`,
    description: `${bestSession.averageR!.toFixed(2)}R average across ${bestSession.sample} recorded trades.`, evidence_json: bestSession,
    sample_size: bestSession.sample, confidence: bestSession.confidence.level, session: bestSession.key });
  const mistake = summary.mistakes.find((row) => row.occurrences >= 5);
  if (mistake) insights.push({ insight_key: `behavior:${mistake.name}:frequency`, scope: "BEHAVIOR", type: "MISTAKE_FREQUENCY", title: `${mistake.name} repeats`,
    description: `${mistake.occurrences} user-tagged occurrences, including ${mistake.losses} losing trades.`, evidence_json: mistake,
    sample_size: mistake.occurrences, confidence: sampleConfidence(mistake.occurrences).level });
  return insights;
}
