import { useCallback, useEffect, useState } from "react";
import type { MT5Account, MT5Position } from "@workspace/api-zod";
import { getAccessToken } from "../api";

export async function mt5Request<T>(
  path: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to inspect MT5.");
  const response = await fetch(`/api/mt5${path}`, {
    ...init,
    signal: signal ?? AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "MT5 bridge unavailable");
  return body as T;
}

export function MT5StatusPanel() {
  type PendingOrder = {
    ticket: number;
    symbol: string;
    type: number;
    volume_current: number;
    price_open: number;
  };
  type SymbolMapping = {
    internal: string;
    broker: string | null;
    confidence: number;
    manual?: boolean;
  };
  const [account, setAccount] = useState<MT5Account | null>(null);
  const [positions, setPositions] = useState<MT5Position[]>([]);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [mappings, setMappings] = useState<SymbolMapping[]>([]);
  const [error, setError] = useState("");
  const [symbol, setSymbol] = useState("XAU/USD");
  const [action, setAction] = useState("MARKET_BUY");
  const [volume, setVolume] = useState("0.01");
  const [price, setPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [positionTicket, setPositionTicket] = useState("");
  const [orderTicket, setOrderTicket] = useState("");
  const [mappingInternal, setMappingInternal] = useState("XAU/USD");
  const [mappingBroker, setMappingBroker] = useState("");
  const [prepared, setPrepared] = useState<{
    requestId: string;
    message: string;
    payload: Record<string, unknown>;
  } | null>(null);
  const [executionNotice, setExecutionNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextAccount, nextPositions, nextOrders, nextSymbols] = await Promise.all([
        mt5Request<MT5Account>("/account", signal),
        mt5Request<{ positions: MT5Position[] }>("/positions", signal),
        mt5Request<{ orders: PendingOrder[] }>("/orders", signal),
        mt5Request<{ watchlist: SymbolMapping[] }>("/symbols", signal),
      ]);
      setAccount(nextAccount);
      setPositions(nextPositions.positions);
      setOrders(nextOrders.orders);
      setMappings(nextSymbols.watchlist);
      setError("");
    } catch (cause) {
      if (!signal?.aborted) {
        setAccount(null);
        setPositions([]);
        setOrders([]);
        setMappings([]);
        setError(cause instanceof Error ? cause.message : "MT5 unavailable");
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

  const orderBody = (confirmed: boolean, requestId: string) => ({
    requestId,
    symbol,
    action,
    volume: Number(volume),
    ...(price ? { price: Number(price) } : {}),
    ...(stopLoss ? { stopLoss: Number(stopLoss) } : {}),
    ...(takeProfit ? { takeProfit: Number(takeProfit) } : {}),
    ...(positionTicket ? { positionTicket: Number(positionTicket) } : {}),
    ...(orderTicket ? { orderTicket: Number(orderTicket) } : {}),
    confirmed,
  });

  const checkOrder = async () => {
    const requestId = crypto.randomUUID();
    const payload = orderBody(false, requestId);
    setBusy(true);
    setExecutionNotice("");
    try {
      const result = await mt5Request<{ ok: boolean; comment?: string }>(
        "/orders/check",
        undefined,
        { method: "POST", body: JSON.stringify(payload) },
      );
      if (!result.ok) throw new Error(result.comment || "Broker check rejected");
      setPrepared({
        requestId,
        message: "Broker validation passed. Review every value before manual confirmation.",
        payload,
      });
    } catch (cause) {
      setPrepared(null);
      setExecutionNotice(
        cause instanceof Error ? cause.message : "Order check failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!prepared) return;
    if (
      !window.confirm(
        `Manually confirm ${action} ${volume} ${symbol}? This sends an order to the connected MT5 account.`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await mt5Request<{
        ok: boolean;
        order?: number;
        deal?: number;
        comment?: string;
      }>("/orders/execute", undefined, {
        method: "POST",
        body: JSON.stringify({ ...prepared.payload, confirmed: true }),
      });
      setExecutionNotice(
        result.ok
          ? `MT5 accepted the manually confirmed order${result.order ? ` · ticket ${result.order}` : ""}.`
          : result.comment || "Broker rejected the order.",
      );
      setPrepared(null);
      await refresh();
    } catch (cause) {
      setExecutionNotice(
        cause instanceof Error ? cause.message : "Execution failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveMapping = async () => {
    if (!mappingBroker.trim()) return;
    setBusy(true);
    try {
      await mt5Request(
        `/symbols/mapping?internal=${encodeURIComponent(mappingInternal)}&broker=${encodeURIComponent(mappingBroker.trim())}`,
        undefined,
        { method: "PUT" },
      );
      setExecutionNotice(`${mappingInternal} now maps to ${mappingBroker.trim()}.`);
      setMappingBroker("");
      await refresh();
    } catch (cause) {
      setExecutionNotice(cause instanceof Error ? cause.message : "Symbol mapping failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-stack" aria-label="MetaTrader 5 connection">
      <div className="mb-row mb-between">
        <div>
          <h3>MetaTrader 5 bridge</h3>
          <p className="mb-muted">
            Official MetaQuotes terminal connection · broker detected dynamically
          </p>
        </div>
        <strong className="mb-value mb-status">
          {account?.connection ?? "DISCONNECTED"}
        </strong>
      </div>
      {account ? (
        <div className="mb-grid">
          {[
            ["Broker", account.broker],
            ["Server", account.server],
            ["Account", `${account.accountType} · ${account.account}`],
            ["Currency", account.currency],
            ["Balance", account.balance.toFixed(2)],
            ["Equity", account.equity.toFixed(2)],
            ["Open positions", String(positions.length)],
            ["Pending orders", String(orders.length)],
            [
              "Execution",
              !account.tradingEnabled
                ? "DISABLED"
                : account.accountType === "LIVE" && !account.liveTradingAllowed
                  ? "LIVE TRADING DISABLED"
                  : "MANUAL CONFIRMATION",
            ],
          ].map(([label, value]) => (
            <div className="mb-panel" key={label}>
              <span className="mb-muted">{label}</span>
              <strong className="mb-value">{value}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-panel">
          <strong>DISCONNECTED</strong>
          <p className="mb-muted">
            {error || "Configure the Windows bridge to use the broker feed."}
          </p>
        </div>
      )}
      <button onClick={() => void refresh()}>Refresh MT5 status</button>
      {mappings.length ? (
        <div className="mb-panel">
          <h3>Broker symbol mapping</h3>
          <p className="mb-muted">
            Auto-detected from this terminal. Correct only uncertain or missing matches.
          </p>
          <div className="mb-grid">
            {mappings.map((item) => (
              <div key={item.internal}>
                <span className="mb-muted">{item.internal}</span>
                <strong className="mb-value">
                  {item.broker || "UNMAPPED"} · {Math.round(item.confidence * 100)}%
                  {item.manual ? " · MANUAL" : ""}
                </strong>
              </div>
            ))}
          </div>
          <div className="mb-row mb-wrap">
            <select value={mappingInternal} onChange={(event) => setMappingInternal(event.target.value)}>
              {mappings.map((item) => <option key={item.internal}>{item.internal}</option>)}
            </select>
            <input
              aria-label="Exact MT5 broker symbol"
              placeholder="Exact broker symbol, e.g. XAUUSDm"
              value={mappingBroker}
              onChange={(event) => setMappingBroker(event.target.value)}
            />
            <button disabled={busy || !mappingBroker.trim()} onClick={() => void saveMapping()}>
              Verify and save mapping
            </button>
          </div>
        </div>
      ) : null}
      <div className="mb-panel">
        <h3>Manual MT5 order</h3>
        <p className="mb-muted">
          Execution AI prepares only. The broker check and a separate manual
          confirmation are required before order_send.
        </p>
        <div className="mb-grid">
          <label>
            Symbol
            <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setPrepared(null); }}>
              {["EUR/USD", "GBP/USD", "USD/JPY", "GBP/JPY", "EUR/JPY", "AUD/USD", "USD/CAD", "NZD/USD", "EUR/GBP", "XAU/USD"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Order type
            <select value={action} onChange={(event) => { setAction(event.target.value); setPrepared(null); }}>
              <option value="MARKET_BUY">Market BUY</option>
              <option value="MARKET_SELL">Market SELL</option>
              <option value="BUY_LIMIT">Buy Limit</option>
              <option value="SELL_LIMIT">Sell Limit</option>
              <option value="BUY_STOP">Buy Stop</option>
              <option value="SELL_STOP">Sell Stop</option>
              <option value="CLOSE">Close position</option>
              <option value="PARTIAL_CLOSE">Partial close</option>
              <option value="MODIFY">Modify SL / TP</option>
              <option value="CANCEL">Cancel pending order</option>
            </select>
          </label>
          <label>
            Volume
            <input type="number" min="0" step="any" value={volume} onChange={(event) => { setVolume(event.target.value); setPrepared(null); }} />
          </label>
          <label>
            Pending price (pending orders only)
            <input type="number" min="0" step="any" value={price} onChange={(event) => { setPrice(event.target.value); setPrepared(null); }} />
          </label>
          <label>
            Stop loss
            <input type="number" min="0" step="any" value={stopLoss} onChange={(event) => { setStopLoss(event.target.value); setPrepared(null); }} />
          </label>
          <label>
            Take profit
            <input type="number" min="0" step="any" value={takeProfit} onChange={(event) => { setTakeProfit(event.target.value); setPrepared(null); }} />
          </label>
          {action === "CLOSE" || action === "PARTIAL_CLOSE" || action === "MODIFY" ? (
            <label>
              Position
              <select value={positionTicket} onChange={(event) => {
                const next = positions.find((item) => String(item.ticket) === event.target.value);
                setPositionTicket(event.target.value);
                if (next) {
                  setSymbol(next.symbol);
                  setVolume(String(next.volume));
                }
                setPrepared(null);
              }}>
                <option value="">Choose an open position</option>
                {positions.map((item) => (
                  <option key={item.ticket} value={item.ticket}>
                    #{item.ticket} · {item.symbol} · {item.direction} · {item.volume}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {action === "CANCEL" ? (
            <label>
              Pending order
              <select value={orderTicket} onChange={(event) => {
                const next = orders.find((item) => String(item.ticket) === event.target.value);
                setOrderTicket(event.target.value);
                if (next) {
                  setSymbol(next.symbol);
                  setVolume(String(next.volume_current));
                }
                setPrepared(null);
              }}>
                <option value="">Choose a pending order</option>
                {orders.map((item) => (
                  <option key={item.ticket} value={item.ticket}>
                    #{item.ticket} · {item.symbol} · {item.volume_current} @ {item.price_open}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="mb-row mb-wrap">
          <button disabled={busy || !account?.tradingEnabled} onClick={() => void checkOrder()}>
            Check with broker
          </button>
          <button disabled={busy || !prepared} onClick={() => void execute()}>
            Execute after confirmation
          </button>
        </div>
        {prepared ? <p className="mb-notice">{prepared.message}</p> : null}
        {executionNotice ? <p role="status">{executionNotice}</p> : null}
      </div>
      <p className="mb-muted">
        Orders always use the connected MT5 broker. Chart fallback data is never
        used for execution.
      </p>
    </section>
  );
}
