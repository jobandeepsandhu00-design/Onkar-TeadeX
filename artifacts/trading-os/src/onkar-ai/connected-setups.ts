import {
  timeframeMs,
  type ScannerCandidate,
  type ScannerSnapshot,
} from "@workspace/api-zod";
import type { SetupPreview } from "./demo-data";

function status(candidate: ScannerCandidate): SetupPreview["status"] {
  if (candidate.staleNow || candidate.payload.stale) return "Awaiting data";
  if (["READY", "TRIGGERED", "COMPLETED"].includes(candidate.state))
    return "Confirmed";
  if (["INVALIDATED", "EXPIRED"].includes(candidate.state))
    return "Invalidated";
  if (candidate.state === "WATCH") return "Watching";
  return candidate.score >= 50 ? "Partial match" : "Weak";
}

export function candidateToSetup(candidate: ScannerCandidate): SetupPreview {
  const entry = candidate.payload.entryZone;
  const target = candidate.payload.targets?.[0] ?? candidate.plan?.target ?? 0;
  const matched = candidate.payload.rules.filter((rule) => rule.passed);
  const missing = candidate.payload.rules.filter((rule) => !rule.passed);
  const historical = candidate.payload.historical;
  const duration = timeframeMs[candidate.timeframe as keyof typeof timeframeMs];
  const candleClosed = Boolean(
    duration &&
    Date.parse(candidate.last_candle_at) + duration <= Date.now() &&
    !candidate.staleNow &&
    !candidate.payload.stale,
  );
  return {
    id: candidate.id,
    symbol: candidate.symbol,
    name: candidate.payload.strategyName || "Approved setup",
    asset:
      candidate.symbol.replace(/[/-]/g, "") === "XAUUSD" ? "Gold" : "Forex",
    score: candidate.score,
    status: status(candidate),
    direction: candidate.payload.direction === "short" ? "Short" : "Long",
    timeframe: candidate.timeframe,
    price: (entry.low + entry.high) / 2,
    change: "",
    entry: [entry.low, entry.high],
    stop: candidate.payload.invalidation,
    targets: [target, target],
    rr: candidate.payload.risk?.rr ?? candidate.plan?.rr ?? 0,
    rules: candidate.payload.passed,
    totalRules: candidate.payload.total,
    source: "verified",
    validation: candidate.staleNow ? "Stale data" : candidate.state,
    conditionsMatched: matched.map((rule) => rule.explanation || rule.id),
    conditionsMissing: missing.map((rule) => rule.explanation || rule.id),
    reason: `${candidate.payload.passed}/${candidate.payload.total} deterministic rules matched. Confluence score ${candidate.score}/100.`,
    waitFor:
      candidate.state === "READY"
        ? "Required confirmations must remain valid on closed candles."
        : candidate.payload.warnings?.[0] ||
          "The next required rule must confirm on a closed candle.",
    learningInsight: historical?.sample
      ? `${historical.sample} matching journal trades · ${historical.averageR == null ? "average R unavailable" : `${historical.averageR.toFixed(2)}R average`}.`
      : "No sufficient matching closed-trade sample yet.",
    candleClosed,
    updatedAt: candidate.payload.analyzedAt,
  };
}

export function connectedSetups(snapshot: ScannerSnapshot | null) {
  if (!snapshot) return [];
  const latest = new Map<string, ScannerCandidate>();
  for (const candidate of [...snapshot.candidates].sort(
    (a, b) =>
      Date.parse(b.updated_at ?? b.created_at ?? b.payload.analyzedAt) -
      Date.parse(a.updated_at ?? a.created_at ?? a.payload.analyzedAt),
  )) {
    const key = `${candidate.version_id}:${candidate.symbol}:${candidate.timeframe}`;
    if (!latest.has(key)) latest.set(key, candidate);
  }
  return [...latest.values()]
    .map(candidateToSetup)
    .sort((a, b) => b.score - a.score);
}

export function scannerIsLive(snapshot: ScannerSnapshot | null) {
  return Boolean(
    snapshot?.config?.enabled &&
    snapshot.connection.market === "connected" &&
    snapshot.connection.worker === "recent_heartbeat",
  );
}
