import { createHash } from "node:crypto";
import { ScannerStore } from "../market-brain/store";
import { getMT5Account, getMT5TradeHistory, MT5BridgeError } from "./client";

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
  const [account, history, mappings] = await Promise.all([
    getMT5Account(),
    getMT5TradeHistory(days),
    service.request<Array<{ internal_symbol: string; broker_symbol: string }>>(
      "broker_symbol_map",
      { user_id: `eq.${userId}`, select: "internal_symbol,broker_symbol" },
    ),
  ]);
  const internalByBroker = new Map(
    mappings.map((row) => [
      normalized(row.broker_symbol),
      row.internal_symbol.replace("/", ""),
    ]),
  );
  const accountKey = createHash("sha256")
    .update(`${account.server}|${account.account}`)
    .digest("hex")
    .slice(0, 16);
  const accountId = `mt5-${accountKey}`;
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
    const symbol =
      internalByBroker.get(normalized(trade.symbol)) ??
      normalized(trade.symbol);
    const closed = trade.status === "Closed" && trade.exitTime !== null;
    const pnl = closed && trade.profitLoss !== null ? trade.profitLoss : null;
    return {
      id: `mt5-${accountKey}-${trade.positionTicket}`,
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
