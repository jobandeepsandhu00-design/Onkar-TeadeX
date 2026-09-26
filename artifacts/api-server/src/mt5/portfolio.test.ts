import assert from "node:assert/strict";
import test from "node:test";
import {
  mt5AccountIdentitySchema,
  mt5BrokerSnapshotSchema,
  mt5PortfolioMatchesSelectedAccount,
  scannerConfigSchema,
  type MT5AccountIdentity,
} from "@workspace/api-zod";
import type { ScannerStore } from "../market-brain/store";
import {
  getVerifiedMT5Portfolio,
  mt5PortfolioIdentityMatches,
  type MT5PortfolioDependencies,
} from "./portfolio";

const fingerprintA = "a".repeat(64);
const fingerprintB = "b".repeat(64);

function identity(accountFingerprint = fingerprintA): MT5AccountIdentity {
  return mt5AccountIdentitySchema.parse({
    connection: "CONNECTED",
    broker: "Broker",
    server: "Broker-Demo",
    account: "***1234",
    accountType: "DEMO",
    currency: "USD",
    balance: 100_000,
    equity: 100_000,
    margin: 0,
    freeMargin: 100_000,
    marginLevel: null,
    tradeAllowed: true,
    terminalConnected: true,
    tradingEnabled: true,
    liveTradingAllowed: false,
    accountFingerprint,
  });
}

function dependencies(options: {
  accountId?: string | null;
  bindingFingerprint?: string;
  snapshotFingerprint?: string;
}) {
  const accountId =
    options.accountId === undefined ? "account-a" : options.accountId;
  let snapshotReads = 0;
  const expectedFingerprints: string[] = [];
  const store = {
    request: async <T>(table: string): Promise<T> => {
      if (table === "scanner_configs")
        return [{ config: scannerConfigSchema.parse({ accountId }) }] as T;
      if (table === "mt5_account_bindings")
        return [
          {
            selected_account_id: "account-a",
            account_fingerprint: options.bindingFingerprint ?? fingerprintA,
          },
        ] as T;
      return [] as T;
    },
  } as unknown as Pick<ScannerStore, "request">;
  const deps: MT5PortfolioDependencies = {
    store,
    getSnapshot: async (expectedFingerprint) => {
      snapshotReads += 1;
      expectedFingerprints.push(expectedFingerprint);
      return mt5BrokerSnapshotSchema.parse({
        account: identity(options.snapshotFingerprint ?? fingerprintA),
        positions: [],
        orders: [],
        symbol: null,
        capturedAt: Date.now(),
      });
    },
  };
  return {
    deps,
    snapshotReads: () => snapshotReads,
    expectedFingerprints,
  };
}

test("combined MT5 portfolio is bound to the server-selected account", async () => {
  const fixture = dependencies({});
  const portfolio = await getVerifiedMT5Portfolio("user-a", fixture.deps);
  assert.equal(portfolio.scopeAccountId, "account-a");
  assert.equal(portfolio.accountIdentityVerified, true);
  assert.equal(portfolio.account.account, "***1234");
  assert.equal("accountFingerprint" in portfolio.account, false);
  assert.deepEqual(portfolio.positions, []);
  assert.deepEqual(portfolio.orders, []);
  assert.equal(fixture.snapshotReads(), 1);
  assert.deepEqual(fixture.expectedFingerprints, [fingerprintA]);
  assert.equal(
    mt5PortfolioMatchesSelectedAccount(portfolio, "account-a", "account-a"),
    true,
  );
  assert.equal(
    mt5PortfolioMatchesSelectedAccount(portfolio, "account-b", "account-a"),
    false,
  );
  assert.equal(
    mt5PortfolioMatchesSelectedAccount(portfolio, "account-a", "account-b"),
    false,
  );
});

test("portfolio read fails before broker snapshot when selected binding is malformed", async () => {
  const fixture = dependencies({ bindingFingerprint: "not-a-fingerprint" });
  await assert.rejects(
    getVerifiedMT5Portfolio("user-a", fixture.deps),
    /binding is missing or invalid/,
  );
  assert.equal(fixture.snapshotReads(), 0);
});

test("portfolio response is discarded if the atomic broker identity mismatches", async () => {
  const fixture = dependencies({
    snapshotFingerprint: fingerprintB,
  });
  await assert.rejects(
    getVerifiedMT5Portfolio("user-a", fixture.deps),
    /does not match the selected account/,
  );
  assert.equal(fixture.snapshotReads(), 1);
});

test("portfolio uses one account-atomic bridge call instead of mixable concurrent calls", async () => {
  const fixture = dependencies({});
  await getVerifiedMT5Portfolio("user-a", fixture.deps);
  assert.equal(fixture.snapshotReads(), 1);
  assert.deepEqual(fixture.expectedFingerprints, [fingerprintA]);
});

test("portfolio identity comparison requires a stable exact fingerprint", () => {
  const binding = {
    selected_account_id: "account-a",
    account_fingerprint: fingerprintA,
  };
  assert.equal(
    mt5PortfolioIdentityMatches({
      binding,
      selectedAccountId: "account-a",
      beforeFingerprint: fingerprintA,
      afterFingerprint: fingerprintA,
    }),
    true,
  );
  assert.equal(
    mt5PortfolioIdentityMatches({
      binding,
      selectedAccountId: "account-a",
      beforeFingerprint: fingerprintA,
      afterFingerprint: fingerprintB,
    }),
    false,
  );
});
