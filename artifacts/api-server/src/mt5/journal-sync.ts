import { ScannerStore } from "../market-brain/store";
import {
  getMT5AccountIdentity,
  getMT5TradeHistory,
  MT5BridgeError,
} from "./client";
import { mt5FingerprintsMatch, mt5JournalAccountId } from "./account-identity";

const normalized = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const dateOnly = (epochMs: number) =>
  new Date(epochMs).toISOString().slice(0, 10);

export function requireMT5BridgeOwner(userId: string) {
  const owner = process.env.MT5_BRIDGE_USER_ID;
  if (!owner)
    throw new MT5BridgeError("MT5 bridge owner is not configured", 503);
  if (owner !== userId)
    throw new MT5BridgeError(
      "This MT5 bridge is not assigned to this user",
      403,
    );
}

export async function syncMT5JournalUser(userId: string, days = 30) {
  requireMT5BridgeOwner(userId);
  const service = ScannerStore.service();
  const account = await getMT5AccountIdentity();
  const history = await getMT5TradeHistory(days);
  const accountAfterRead = await getMT5AccountIdentity();
  if (
    !mt5FingerprintsMatch(
      account.accountFingerprint,
      accountAfterRead.accountFingerprint,
    )
  )
    throw new MT5BridgeError(
      "Connected MT5 account changed during reconciliation; retry sync before enabling AUTO.",
      409,
    );
  const accountId = mt5JournalAccountId(account.accountFingerprint);
  const journalAccount = {
    id: accountId,
    name: `MT5 ${account.account}`,
    alias: `${account.broker} ${account.accountType}`,
    accountNumber: account.account,
    platform: "MT5",
    broker: account.broker,
    type: account.accountType,
    accountType: account.accountType === "DEMO" ? "Demo" : "Live",
    currency: account.currency,
    startingBalance: String(account.balance),
    balance: String(account.balance),
    server: account.server,
    source: "MT5",
  };
  const trades = history.map((trade) => {
    // The bridge resolves this under the current account-scoped mapping while
    // holding its terminal lock. Never derive journal symbols from the older
    // browser-facing mapping cache, which may belong to a prior login.
    const symbol = normalized(trade.symbol || trade.brokerSymbol);
    const closed = trade.status === "Closed" && trade.exitTime !== null;
    const pnl = closed && trade.profitLoss !== null ? trade.profitLoss : null;
    return {
      id: `${accountId}-${trade.positionTicket}`,
      accountId,
      date: dateOnly(trade.entryTime),
      exitDate: trade.exitTime ? dateOnly(trade.exitTime) : "",
      symbol,
      market: symbol.startsWith("XAU") ? "Gold" : "Forex",
      side: trade.direction === "SELL" ? "Sell" : "Buy",
      status: closed ? "Closed" : "Open",
      entry: String(trade.entryPrice),
      exit: trade.exitPrice === null ? "" : String(trade.exitPrice),
      positionSize: String(trade.volume),
      pnl: pnl === null ? "" : String(pnl),
      netPnl: pnl === null ? "" : String(pnl),
      result:
        pnl === null ? "" : pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Break Even",
      broker: account.broker,
      mt5Ticket: String(trade.positionTicket),
      source: "MT5",
      executionProvider: "MT5",
      marketDataProvider: "MT5",
      notes: "Imported from connected MT5 account.",
    };
  });
  await service.rpc<void>("sync_mt5_journal_trades", {
    p_user: userId,
    p_account: journalAccount,
    p_trades: trades,
  });
  // Persist the opaque bridge identity in a service-role-only table. The
  // browser receives accountId and the masked login, never this fingerprint.
  await service.request(
    "mt5_account_bindings",
    { on_conflict: "user_id,selected_account_id" },
    "POST",
    {
      user_id: userId,
      selected_account_id: accountId,
      account_fingerprint: account.accountFingerprint,
      broker: account.broker,
      server: account.server,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    "resolution=merge-duplicates,return=minimal",
  );
  return {
    accountId,
    imported: trades.length,
    closed: trades.filter((trade) => trade.status === "Closed").length,
    checkedAt: new Date().toISOString(),
  };
}

export async function syncConfiguredMT5Journal() {
  const owner = process.env.MT5_BRIDGE_USER_ID;
  if (!owner || !process.env.MT5_BRIDGE_URL || !process.env.MT5_BRIDGE_API_KEY)
    return { skipped: true, reason: "MT5 bridge is not configured" };
  return syncMT5JournalUser(owner);
}
