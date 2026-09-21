import type { ScannerSnapshot } from "@workspace/api-zod";

export type SetupCoverageEvaluation = {
  versionId: string;
  setupId: string;
  name: string;
  symbol: string;
  timeframe: string;
  higherTimeframe: string;
  direction: string;
  score: number;
  status: string;
  passed: number;
  total: number;
  requiredMissing: string[];
  lastCandleAt: string;
  analyzedAt: string;
  stale: boolean;
};

type SymbolCoverage = {
  symbol: string;
  evaluated: number;
  eligible: number;
  complete: boolean;
  scannedAt: string;
  evaluations: SetupCoverageEvaluation[];
};

export function setupCoverage(snapshot: ScannerSnapshot | null) {
  const value = snapshot?.config?.health.setupCoverage;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, SymbolCoverage>)
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        Array.isArray(entry.evaluations),
    )
    .flatMap((entry) => entry.evaluations)
    .filter(
      (entry) =>
        typeof entry?.versionId === "string" &&
        typeof entry?.symbol === "string" &&
        Number.isFinite(entry?.score),
    );
}
