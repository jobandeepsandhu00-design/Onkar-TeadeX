import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MT5Account,
  MT5Position,
  ScannerSnapshot,
} from "@workspace/api-zod";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChartNoAxesCombined,
  CircleCheck,
  RadioTower,
  ShieldCheck,
} from "lucide-react";
import { mt5Request } from "./MT5StatusPanel";

type JournalTrade = Record<string, unknown> & {
  id: string;
  symbol?: string;
  date?: string;
};
type AccountCard = ScannerSnapshot["accounts"][number] & {
  broker?: string;
  accountNumber?: string;
  balance?: number | null;
  source?: string;
  mt5: boolean;
};
export type AccountCarouselSource = {
  id: string;
  name: string;
  currency: string;
  type: string;
  broker?: string;
  accountNumber?: string;
  balance?: number | null;
  source?: string;
};

const number = (value: unknown) => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  )
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const tradePnl = (trade: JournalTrade) =>
  number(trade.netPnl) ?? number(trade.manualPnl) ?? number(trade.pnl);
const money = (value: number | null, currency = "USD", signed = false) => {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      maximumFractionDigits: 2,
      signDisplay: signed ? "exceptZero" : "auto",
    }).format(value);
  } catch {
    return `${signed && value > 0 ? "+" : ""}${value.toFixed(2)} ${currency}`;
  }
};

export function AccountCommandCarousel({
  snapshot,
  accounts: accountSource,
  selectedAccountId,
  journalTrades,
  onSelect,
  onOpenTrade,
}: {
  snapshot?: ScannerSnapshot;
  accounts?: AccountCarouselSource[];
  selectedAccountId?: string | null;
  journalTrades: JournalTrade[];
  onSelect: (accountId: string) => void;
  onOpenTrade: () => void;
}) {
  const [mt5, setMT5] = useState<MT5Account | null>(null);
  const [positions, setPositions] = useState<MT5Position[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const touch = useRef<number | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [account, open] = await Promise.all([
        mt5Request<MT5Account>("/account", signal),
        mt5Request<{ positions: MT5Position[] }>("/positions", signal),
      ]);
      setMT5(account);
      setPositions(open.positions);
      setError("");
    } catch (cause) {
      if (!signal?.aborted) {
        setMT5(null);
        setPositions([]);
        setError(cause instanceof Error ? cause.message : "MT5 disconnected");
      }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);
  const accounts = useMemo(() => {
    const configured: AccountCard[] = (
      snapshot?.accounts ??
      accountSource ??
      []
    ).map((account) => ({
      ...account,
      mt5: false,
    }));
    if (!mt5) return configured;
    const match = configured.findIndex(
      (account) =>
        account.accountNumber === mt5.account || account.broker === mt5.broker,
    );
    const liveAccount = {
      id: match >= 0 ? configured[match].id : "connected-mt5",
      name:
        match >= 0
          ? configured[match].name
          : `${mt5.broker} ${mt5.accountType}`,
      currency: mt5.currency,
      type: mt5.accountType,
      broker: mt5.broker,
      accountNumber: mt5.account,
      balance: mt5.balance,
      source: "MT5",
      mt5: true,
    };
    if (match >= 0) configured.splice(match, 1, liveAccount);
    else configured.unshift(liveAccount);
    return configured;
  }, [accountSource, mt5, snapshot?.accounts]);
  const activeAccountId =
    snapshot?.config?.config.accountId ?? selectedAccountId;
  useEffect(() => {
    const selected = accounts.findIndex(
      (account) => account.id === activeAccountId,
    );
    if (selected >= 0) setIndex(selected);
  }, [accounts, activeAccountId]);
  const move = (direction: number) => {
    if (!accounts.length) return;
    setIndex(
      (current) => (current + direction + accounts.length) % accounts.length,
    );
  };
  const current = accounts[index] ?? null;
  const paperJournalTrades: JournalTrade[] = (snapshot?.paperTrades ?? []).map(
    (trade) => ({
      id: trade.id,
      accountId: trade.account_id,
      symbol: trade.symbol,
      date: trade.opened_at.slice(0, 10),
      exitDate: trade.closed_at?.slice(0, 10),
      status: trade.status,
      netPnl: trade.pnl,
    }),
  );
  const allJournalTrades = [
    ...journalTrades,
    ...paperJournalTrades.filter(
      (paper) => !journalTrades.some((trade) => trade.id === paper.id),
    ),
  ];
  const scopedTrades = current
    ? allJournalTrades.filter(
        (trade) => String(trade.accountId || "") === current.id,
      )
    : [];
  const closed = scopedTrades.filter((trade) =>
    /closed|win|loss|break/i.test(String(trade.status || trade.result || "")),
  );
  const wins = closed.filter(
    (trade) =>
      /win/i.test(String(trade.result || "")) || (tradePnl(trade) ?? 0) > 0,
  ).length;
  const closedPnl = closed.reduce(
    (sum, trade) => sum + (tradePnl(trade) ?? 0),
    0,
  );
  // Stored/manual accounts keep their configured balance as the baseline.
  // Closed journal outcomes update the displayed balance. A connected or
  // synced MT5 account remains broker-authoritative to avoid double counting
  // imported trade history that is already reflected in broker balance.
  const displayedBalance =
    current?.mt5 || String(current?.source || "").toUpperCase() === "MT5"
      ? (current?.balance ?? null)
      : current?.balance == null
        ? null
        : current.balance + closedPnl;
  const dailyPnl = closed
    .filter(
      (trade) =>
        String(trade.exitDate || trade.date || "").slice(0, 10) ===
        new Date().toISOString().slice(0, 10),
    )
    .reduce((sum, trade) => sum + (tradePnl(trade) ?? 0), 0);
  const openPaper = (snapshot?.paperTrades ?? []).find(
    (trade) => trade.account_id === current?.id && trade.status === "OPEN",
  );
  const activeTrade = current?.mt5
    ? (positions[0] ?? null)
    : openPaper
      ? {
          direction: openPaper.direction,
          symbol: openPaper.symbol,
          entryPrice: openPaper.entry,
          currentPrice: openPaper.current_price,
          stopLoss: openPaper.stop_loss,
          takeProfit: openPaper.take_profit,
          profitLoss:
            (openPaper.current_price - openPaper.entry) *
            (openPaper.direction === "BUY" ? 1 : -1) *
            openPaper.position_size *
            Number(openPaper.detail.valuePerPriceUnit || 0),
        }
      : null;
  const progress = activeTrade?.takeProfit
    ? Math.max(
        0,
        Math.min(
          100,
          activeTrade.direction === "BUY"
            ? ((activeTrade.currentPrice - activeTrade.entryPrice) /
                (activeTrade.takeProfit - activeTrade.entryPrice)) *
                100
            : ((activeTrade.entryPrice - activeTrade.currentPrice) /
                (activeTrade.entryPrice - activeTrade.takeProfit)) *
                100,
        ),
      )
    : null;
  const floating = current?.mt5
    ? positions.reduce((sum, position) => sum + position.profitLoss, 0)
    : (activeTrade?.profitLoss ?? null);
  const floatingPct =
    current?.balance && floating !== null
      ? (floating / current.balance) * 100
      : null;

  if (!current)
    return (
      <section className="mb-account-empty">
        <ShieldCheck size={24} />
        <div>
          <strong>No trading account selected</strong>
          <span>Add an account or connect MT5 in Connections.</span>
        </div>
      </section>
    );
  return (
    <section
      className="mb-account-command"
      aria-label="Trading account carousel"
    >
      <div
        className="mb-account-stage"
        onTouchStart={(event) => {
          touch.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touch.current === null) return;
          const distance =
            (event.changedTouches[0]?.clientX ?? touch.current) - touch.current;
          if (Math.abs(distance) > 45) move(distance > 0 ? -1 : 1);
          touch.current = null;
        }}
      >
        {accounts.map((account, position) => {
          let offset = position - index;
          if (offset > accounts.length / 2) offset -= accounts.length;
          if (offset < -accounts.length / 2) offset += accounts.length;
          if (Math.abs(offset) > 1) return null;
          const isActive = offset === 0;
          return (
            <article
              className={`mb-account-card ${isActive ? "is-active" : "is-side"}`}
              data-offset={offset}
              key={account.id}
              aria-hidden={!isActive}
              onClick={() => !isActive && setIndex(position)}
            >
              <div className="mb-account-glow" />
              <div className="mb-account-card-head">
                <div className="mb-account-identity">
                  <span className="mb-account-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <strong>{account.name}</strong>
                    <small>
                      {account.broker || "Stored account"} · {account.type}
                    </small>
                  </div>
                </div>
                <span
                  className={`mb-live-pill ${account.mt5 ? "is-live" : ""}`}
                >
                  <i /> {account.mt5 ? mt5?.connection : "STORED"}
                </span>
              </div>
              <div className="mb-account-balance">
                <strong>
                  {money(
                    account.id === current.id
                      ? displayedBalance
                      : (account.balance ?? null),
                    account.currency,
                  )}
                </strong>
                <span>
                  {account.mt5 ||
                  String(account.source || "").toUpperCase() === "MT5"
                    ? "BROKER BALANCE"
                    : "JOURNAL BALANCE"}
                </span>
              </div>
              {account.mt5 ? (
                <div className="mb-account-finance-grid">
                  <div>
                    <span>Equity</span>
                    <b>{money(mt5?.equity ?? null, account.currency)}</b>
                  </div>
                  <div>
                    <span>Free margin</span>
                    <b>{money(mt5?.freeMargin ?? null, account.currency)}</b>
                  </div>
                  <div>
                    <span>Account</span>
                    <b>{account.accountNumber}</b>
                  </div>
                </div>
              ) : null}
              <button
                className="mb-active-trade"
                disabled={!activeTrade}
                onClick={(event) => {
                  event.stopPropagation();
                  if (activeTrade) onOpenTrade();
                }}
              >
                <span>ACTIVE TRADE</span>
                <strong>
                  {activeTrade
                    ? activeTrade.symbol
                    : current.mt5
                      ? "No open broker position"
                      : "No open Paper position"}
                </strong>
                {activeTrade ? (
                  <em
                    className={
                      activeTrade.direction === "BUY" ? "is-buy" : "is-sell"
                    }
                  >
                    {activeTrade.direction}
                  </em>
                ) : null}
              </button>
              <div className="mb-trade-metrics">
                <div>
                  <span>Floating P/L</span>
                  <b className={(floating ?? 0) >= 0 ? "is-profit" : "is-loss"}>
                    {money(floating, account.currency, true)}
                  </b>
                  <small>
                    {floatingPct === null
                      ? "—"
                      : `${floatingPct >= 0 ? "+" : ""}${floatingPct.toFixed(2)}%`}
                  </small>
                </div>
                <div>
                  <span>Entry</span>
                  <b>{activeTrade?.entryPrice ?? "—"}</b>
                  <small>SL {activeTrade?.stopLoss ?? "—"}</small>
                </div>
                <div>
                  <span>Current</span>
                  <b>{activeTrade?.currentPrice ?? "—"}</b>
                  <small>TP {activeTrade?.takeProfit ?? "—"}</small>
                </div>
              </div>
              <div className="mb-trade-progress">
                <span>
                  <b>TRADE PROGRESS</b>
                  <b>{progress === null ? "—" : `${progress.toFixed(0)}%`}</b>
                </span>
                <div>
                  <i style={{ width: `${progress ?? 0}%` }} />
                </div>
              </div>
              {isActive ? (
                <button
                  className="mb-use-account"
                  disabled={
                    account.id === "connected-mt5" ||
                    activeAccountId === account.id
                  }
                  onClick={() => onSelect(account.id)}
                >
                  {activeAccountId === account.id
                    ? "Selected account"
                    : "Use this account"}
                </button>
              ) : null}
            </article>
          );
        })}
        {accounts.length > 1 ? (
          <>
            <button
              className="mb-carousel-arrow is-left"
              onClick={() => move(-1)}
              aria-label="Previous account"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              className="mb-carousel-arrow is-right"
              onClick={() => move(1)}
              aria-label="Next account"
            >
              <ArrowRight size={18} />
            </button>
          </>
        ) : null}
      </div>
      <div className="mb-carousel-dots" aria-label="Account pages">
        {accounts.map((account, position) => (
          <button
            key={account.id}
            aria-label={`Show ${account.name}`}
            aria-pressed={position === index}
            onClick={() => setIndex(position)}
          />
        ))}
      </div>
      <div className="mb-account-stats">
        <div>
          <Activity size={18} />
          <b>{current.mt5 ? positions.length : openPaper ? 1 : 0}</b>
          <span>Active trades</span>
        </div>
        <div>
          <CircleCheck size={18} />
          <b>{closed.length}</b>
          <span>
            Closed trades ·{" "}
            {closed.length
              ? `${Math.round((wins / closed.length) * 100)}% win`
              : "No result"}
          </span>
        </div>
        <div>
          <ChartNoAxesCombined size={18} />
          <b>{money(dailyPnl, current.currency, true)}</b>
          <span>Daily P/L · {scopedTrades.length} total</span>
        </div>
        <div>
          <RadioTower size={18} />
          <b>
            {current.mt5
              ? mt5?.connection
              : snapshot?.runtime.tradingSource === "TWELVE_DATA"
                ? "PAPER"
                : "STANDBY"}
          </b>
          <span>{current.mt5 ? "Broker system" : "Journal account"}</span>
        </div>
      </div>
      {error ? <p className="mb-muted">MT5: {error}</p> : null}
    </section>
  );
}
