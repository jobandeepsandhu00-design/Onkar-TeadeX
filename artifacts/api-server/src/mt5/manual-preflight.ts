import { createHash, timingSafeEqual } from "node:crypto";
import {
  mt5OrderRequestSchema,
  type MT5OrderRequest,
} from "@workspace/api-zod";
import { mt5FingerprintsMatch } from "./account-identity";
import type { MT5ExecutionLookup } from "./client";

export const MANUAL_PREFLIGHT_TTL_MS = 60_000;
// Longer than the bridge HTTP timeout. A fresh CONFIRMED row represents an
// execution handler that may still be between its database claim and the
// durable bridge claim, so recovery must not release it yet.
export const MANUAL_CONFIRM_RECONCILIATION_GRACE_MS = 30_000;
export const MANUAL_UNRESOLVED_STATUSES = [
  "CONFIRMED",
  "UNCERTAIN",
  "RECONCILING",
] as const;

export const MANUAL_NEW_EXPOSURE_ACTIONS = [
  "MARKET_BUY",
  "MARKET_SELL",
  "BUY_LIMIT",
  "SELL_LIMIT",
  "BUY_STOP",
  "SELL_STOP",
] as const;

/**
 * The manual endpoint is a management surface, not an alternate entry engine.
 * New exposure must retain the scanner's frozen candidate, Setup/Risk/News
 * evidence and final execution fences. Management actions remain manual.
 */
export function manualNewExposureBlocker(action: MT5OrderRequest["action"]) {
  return (MANUAL_NEW_EXPOSURE_ACTIONS as readonly string[]).includes(action)
    ? "Manual MT5 entry and pending-order creation is disabled. New exposure must come from a READY setup candidate through the guarded Scanner, Setup AI, Risk AI, News AI, and Execution AI pipeline. Manual CLOSE, PARTIAL_CLOSE, MODIFY, and CANCEL remain available."
    : null;
}

export type ManualUnresolvedStatus =
  (typeof MANUAL_UNRESOLVED_STATUSES)[number];

export type ManualReconciliationDecision =
  | {
      resolved: false;
      status: "UNCERTAIN";
      message: string;
      result: Record<string, unknown> | null;
    }
  | {
      resolved: true;
      status: "SENT" | "REJECTED" | "FAILED";
      message: string;
      result: Record<string, unknown>;
    };

export type ManualPreflightBinding = {
  account_fingerprint: string;
  selected_account_id: string | null;
  internal_symbol: string;
  broker_symbol: string;
  request_digest: string;
  expires_at: string;
  consumed_at: string | null;
};

export function manualConfirmedReconciliationBlocker(
  row: { status: string; updated_at: string },
  now = Date.now(),
) {
  if (row.status !== "CONFIRMED") return null;
  const updatedAt = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedAt))
    return "The confirmed request has no trustworthy execution timestamp. Keep it locked for manual review.";
  const remaining =
    MANUAL_CONFIRM_RECONCILIATION_GRACE_MS - Math.max(0, now - updatedAt);
  if (remaining <= 0) return null;
  return `The original execution handoff may still be in progress. Reconciliation is available in ${Math.max(1, Math.ceil(remaining / 1_000))} seconds.`;
}

export function manualPostClaimCASPassed(rows: Array<{ status: string }>) {
  return rows.length === 1 && rows[0]?.status === "CONFIRMED";
}

export function parseManualMT5Order(
  input: unknown,
  confirmed: boolean,
): MT5OrderRequest {
  const order = mt5OrderRequestSchema.parse(input);
  if (order.confirmed !== confirmed)
    throw new Error(
      confirmed
        ? "Manual confirmation is required"
        : "Broker checks cannot be submitted as confirmed orders",
    );
  return order;
}

/**
 * Bind every executable field while deliberately normalizing only the
 * check/execute confirmation transition. Schema defaults are included so an
 * omitted default cannot change between the two requests.
 */
export function manualMT5OrderDigest(input: unknown) {
  const order = mt5OrderRequestSchema.parse(input);
  const canonical = {
    requestId: order.requestId,
    symbol: order.symbol,
    action: order.action,
    volume: order.volume,
    price: order.price ?? null,
    stopLoss: order.stopLoss ?? null,
    takeProfit: order.takeProfit ?? null,
    positionTicket: order.positionTicket ?? null,
    orderTicket: order.orderTicket ?? null,
    deviation: order.deviation,
    comment: order.comment,
    confirmed: false,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function digestsMatch(expected: string, actual: string) {
  return (
    /^[a-f0-9]{64}$/.test(expected) &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"))
  );
}

export function manualPreflightBlocker(args: {
  binding: ManualPreflightBinding | null | undefined;
  order: unknown;
  accountFingerprint: string;
  selectedAccountId: string;
  brokerSymbol: string;
  now?: number;
}) {
  const { binding } = args;
  if (!binding) return "Broker preflight was not found. Check the order again.";
  if (binding.consumed_at)
    return "Broker preflight was already used. Check the order again.";
  if (
    !Number.isFinite(Date.parse(binding.expires_at)) ||
    Date.parse(binding.expires_at) <= (args.now ?? Date.now())
  )
    return "Broker preflight expired. Check the order again.";
  if (
    !mt5FingerprintsMatch(binding.account_fingerprint, args.accountFingerprint)
  )
    return "Connected MT5 account changed. Check the order again.";
  if (
    !args.selectedAccountId ||
    binding.selected_account_id !== args.selectedAccountId
  )
    return "The selected trading account changed. Check the order again.";
  if (
    binding.internal_symbol !== mt5OrderRequestSchema.parse(args.order).symbol
  )
    return "The internal symbol changed. Check the order again.";
  if (!args.brokerSymbol || binding.broker_symbol !== args.brokerSymbol)
    return "MT5 broker symbol mapping changed. Check the order again.";
  if (!digestsMatch(binding.request_digest, manualMT5OrderDigest(args.order)))
    return "Order values changed after broker preflight. Check the order again.";
  return null;
}

/**
 * Project bridge idempotency/broker truth into the durable application state.
 * No branch asks the bridge to send again.
 */
export function manualReconciliationDecision(
  lookup: MT5ExecutionLookup,
): ManualReconciliationDecision {
  if (lookup.state === "COMPLETED" && lookup.resolved && lookup.result) {
    const accepted = lookup.result.ok === true;
    return {
      resolved: true,
      status: accepted ? "SENT" : "REJECTED",
      message: accepted
        ? "The original MT5 request was found and accepted. No retry was sent."
        : "The original MT5 request was found and rejected. No retry was sent.",
      result: lookup.result,
    };
  }
  if (lookup.state === "ARMED" && lookup.resolved) {
    return {
      resolved: true,
      status: "FAILED",
      message:
        "The original request never advanced beyond broker preflight. It is safe to prepare a new order.",
      result: {
        ok: false,
        stage: "armed",
        requestId: lookup.requestId,
        comment: "No MT5 order attempt was made.",
      },
    };
  }
  if (lookup.state === "CANCELLED" && lookup.resolved) {
    return {
      resolved: true,
      status: "FAILED",
      message:
        "The original execution claim was cancelled before MT5 order_send. It is safe to prepare a new order.",
      result: lookup.result ?? {
        ok: false,
        stage: "claim_cancelled",
        requestId: lookup.requestId,
        notSent: true,
      },
    };
  }
  const manualReview =
    lookup.state === "NOT_FOUND" ||
    lookup.reconciliationState === "MANUAL_REVIEW";
  return {
    resolved: false,
    status: "UNCERTAIN",
    message: manualReview
      ? "The original MT5 outcome is still unresolved. Inspect the broker terminal; new manual orders remain locked."
      : "MT5 is still reconciling the original request with broker history. New manual orders remain locked.",
    result: lookup.result,
  };
}
