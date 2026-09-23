export type OptionalCronStage = "deferred" | "learning" | "knowledge";

export function chooseOptionalCronStage(
  startedAt: number,
  checkedAt: number,
  scannerBusy: boolean,
): OptionalCronStage {
  if (scannerBusy || checkedAt - startedAt > 40_000) return "deferred";
  return Math.floor(startedAt / 60_000) % 2 === 0
    ? "learning"
    : "knowledge";
}
