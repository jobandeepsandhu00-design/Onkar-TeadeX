import {
  mt5PortfolioSnapshotSchema,
  scannerConfigWithCurrentScorePolicy,
  type MT5BrokerSnapshot,
} from "@workspace/api-zod";
import type { ScannerStore } from "../market-brain/store";
import {
  mt5ScanAccountMatches,
  type MT5AccountBinding,
} from "./account-identity";
import { MT5BridgeError, getMT5BrokerSnapshot } from "./client";

type PortfolioStore = Pick<ScannerStore, "request">;

export type MT5PortfolioDependencies = {
  store: PortfolioStore;
  getSnapshot: (
    expectedAccountFingerprint: string,
  ) => Promise<MT5BrokerSnapshot>;
};

export function mt5PortfolioIdentityMatches(args: {
  binding: MT5AccountBinding | null | undefined;
  selectedAccountId: string | null | undefined;
  beforeFingerprint: string | null | undefined;
  afterFingerprint: string | null | undefined;
}) {
  return mt5ScanAccountMatches(
    args.binding,
    args.selectedAccountId,
    args.beforeFingerprint,
    args.afterFingerprint,
  );
}

/**
 * Read positions and pending orders as one account-atomic broker snapshot.
 * The selected account always comes from the authenticated user's saved
 * scanner config; the browser cannot supply or override it.
 */
export async function getVerifiedMT5Portfolio(
  userId: string,
  dependencies: MT5PortfolioDependencies,
) {
  const [configRow] = await dependencies.store.request<
    Array<{ config: unknown }>
  >("scanner_configs", {
    user_id: `eq.${userId}`,
    select: "config",
    limit: "1",
  });
  if (!configRow)
    throw new MT5BridgeError(
      "Save scanner settings and select an MT5 account before loading the broker portfolio.",
      409,
    );
  let selectedAccountId: string | null;
  try {
    selectedAccountId = scannerConfigWithCurrentScorePolicy(
      configRow.config,
    ).accountId;
  } catch {
    throw new MT5BridgeError(
      "The saved scanner account configuration is invalid. Save it again before loading MT5 positions.",
      409,
    );
  }
  if (!selectedAccountId)
    throw new MT5BridgeError(
      "Select and sync the exact imported MT5 account before loading positions and orders.",
      409,
    );

  const bindings = await dependencies.store.request<MT5AccountBinding[]>(
    "mt5_account_bindings",
    {
      user_id: `eq.${userId}`,
      selected_account_id: `eq.${selectedAccountId}`,
      select: "selected_account_id,account_fingerprint",
      limit: "1",
    },
  );
  const binding = bindings[0] ?? null;
  if (
    !mt5PortfolioIdentityMatches({
      binding,
      selectedAccountId,
      beforeFingerprint: binding?.account_fingerprint,
      afterFingerprint: binding?.account_fingerprint,
    })
  )
    throw new MT5BridgeError(
      "The selected MT5 account binding is missing or invalid. Sync MT5 again before loading positions and orders.",
      409,
    );

  // The bridge requires the expected fingerprint and returns account,
  // positions, and orders under one TerminalGateway lock. No concurrent
  // identity/portfolio calls can be combined into a mixed-account response.
  const snapshot = await dependencies.getSnapshot(binding.account_fingerprint);
  if (
    !mt5PortfolioIdentityMatches({
      binding,
      selectedAccountId,
      beforeFingerprint: snapshot.account.accountFingerprint,
      afterFingerprint: snapshot.account.accountFingerprint,
    })
  )
    throw new MT5BridgeError(
      "The connected MT5 account does not match the selected account. The portfolio snapshot was discarded.",
      409,
    );

  return mt5PortfolioSnapshotSchema.parse({
    scopeAccountId: selectedAccountId,
    accountIdentityVerified: true,
    fetchedAt: new Date().toISOString(),
    account: snapshot.account,
    positions: snapshot.positions,
    orders: snapshot.orders,
  });
}

export function defaultMT5PortfolioDependencies(
  store: PortfolioStore,
): MT5PortfolioDependencies {
  return {
    store,
    getSnapshot: (expectedAccountFingerprint) =>
      getMT5BrokerSnapshot(expectedAccountFingerprint),
  };
}
