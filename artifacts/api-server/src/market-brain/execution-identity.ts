import { createHash } from "node:crypto";

export function executionRequestId(input: {
  accountId: string;
  executionProvider: "MT5" | "PAPER";
  symbol: string;
  versionId: string;
  direction: string;
  confirmationCandle: string;
  entryEvent: string;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.accountId,
        input.executionProvider,
        input.symbol,
        input.versionId,
        input.direction,
        input.confirmationCandle,
        input.entryEvent,
      ].join(":"),
    )
    .digest("hex");
  return `${input.executionProvider.toLowerCase()}_${digest}`;
}
