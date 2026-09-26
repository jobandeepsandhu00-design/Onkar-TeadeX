import { useCallback, useEffect, useRef, useState } from "react";
import {
  mt5PortfolioSnapshotSchema,
  type MT5Account,
  type MT5PendingOrder,
  type MT5PortfolioSnapshot,
  type MT5Position,
} from "@workspace/api-zod";
import { getAccessToken } from "../api";

type SymbolMapping = {
  internal: string;
  broker: string | null;
  confidence: number;
  manual?: boolean;
};

type PreparedManualOrder = {
  requestId: string;
  message: string;
  payload: Record<string, unknown>;
  brokerSymbol: string;
  expiresAt: string;
  connectionSignature: string;
};

type ManualOrderState = {
  state: "CLEAR" | "UNCERTAIN" | "RECONCILING" | "RESOLVED";
  requestId: string | null;
  message: string;
  canReconcile: boolean;
  outcome?: "SENT" | "REJECTED" | "FAILED";
  reconciliationState?: "AWAITING_BROKER_HISTORY" | "MANUAL_REVIEW";
};

function connectionSignature(
  account: MT5Account | null,
  mappings: SymbolMapping[],
) {
  if (!account) return "DISCONNECTED";
  return JSON.stringify({
    broker: account.broker,
    server: account.server,
    account: account.account,
    accountType: account.accountType,
    connection: account.connection,
    tradingEnabled: account.tradingEnabled,
    tradeApiDisabled: account.tradeApiDisabled,
    mappings: mappings
      .map(({ internal, broker }) => [internal, broker])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  });
}

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
  const [account, setAccount] = useState<MT5Account | null>(null);
  const [positions, setPositions] = useState<MT5Position[]>([]);
  const [orders, setOrders] = useState<MT5PendingOrder[]>([]);
  const [mappings, setMappings] = useState<SymbolMapping[]>([]);
  const [error, setError] = useState("");
  const [symbol, setSymbol] = useState("XAU/USD");
  const [action, setAction] = useState("CLOSE");
  const [volume, setVolume] = useState("0.01");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [positionTicket, setPositionTicket] = useState("");
  const [orderTicket, setOrderTicket] = useState("");
  const [mappingInternal, setMappingInternal] = useState("XAU/USD");
  const [mappingBroker, setMappingBroker] = useState("");
  const [prepared, setPrepared] = useState<PreparedManualOrder | null>(null);
  const preparedRef = useRef<PreparedManualOrder | null>(null);
  const [executionNotice, setExecutionNotice] = useState("");
  const [manualState, setManualState] = useState<ManualOrderState>({
    state: "CLEAR",
    requestId: null,
    message: "No unresolved manual MT5 order.",
    canReconcile: false,
  });
  const [busy, setBusy] = useState(false);
  const refreshManualState = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await mt5Request<ManualOrderState>(
        "/orders/manual/state",
        signal,
      );
      setManualState(next);
      if (next.state !== "CLEAR") {
        preparedRef.current = null;
        setPrepared(null);
        setExecutionNotice(next.message);
      }
      return next;
    } catch (cause) {
      if (!signal?.aborted)
        setExecutionNotice(
          cause instanceof Error
            ? cause.message
            : "Manual order reconciliation status is unavailable.",
        );
      return null;
    }
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [rawPortfolio, nextSymbols] = await Promise.all([
        mt5Request<MT5PortfolioSnapshot>("/portfolio", signal),
        mt5Request<{ watchlist: SymbolMapping[] }>("/symbols", signal),
      ]);
      const nextPortfolio = mt5PortfolioSnapshotSchema.parse(rawPortfolio);
      setAccount(nextPortfolio.account);
      setPositions(nextPortfolio.positions);
      setOrders(nextPortfolio.orders);
      setMappings(nextSymbols.watchlist);
      const nextSignature = connectionSignature(
        nextPortfolio.account,
        nextSymbols.watchlist,
      );
      if (
        preparedRef.current &&
        preparedRef.current.connectionSignature !== nextSignature
      ) {
        preparedRef.current = null;
        setPrepared(null);
        setExecutionNotice(
          "MT5 account or broker symbol mapping changed. Check the order again.",
        );
      }
      setError("");
    } catch (cause) {
      if (!signal?.aborted) {
        setAccount(null);
        setPositions([]);
        setOrders([]);
        setMappings([]);
        if (preparedRef.current) {
          preparedRef.current = null;
          setPrepared(null);
          setExecutionNotice(
            "MT5 connection changed. Check the order again after reconnecting.",
          );
        }
        setError(cause instanceof Error ? cause.message : "MT5 unavailable");
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    void refreshManualState(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
        void refreshManualState();
      }
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh, refreshManualState]);

  const orderBody = (confirmed: boolean, requestId: string) => ({
    requestId,
    symbol,
    action,
    volume: Number(volume),
    ...(stopLoss ? { stopLoss: Number(stopLoss) } : {}),
    ...(takeProfit ? { takeProfit: Number(takeProfit) } : {}),
    ...(positionTicket ? { positionTicket: Number(positionTicket) } : {}),
    ...(orderTicket ? { orderTicket: Number(orderTicket) } : {}),
    confirmed,
  });

  const checkOrder = async () => {
    if (manualState.state !== "CLEAR") {
      setExecutionNotice(manualState.message);
      return;
    }
    const requestId = crypto.randomUUID();
    const payload = orderBody(false, requestId);
    setBusy(true);
    setExecutionNotice("");
    try {
      const result = await mt5Request<{
        ok: boolean;
        comment?: string;
        brokerSymbol?: string;
        expiresAt?: string;
      }>("/orders/check", undefined, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result.ok)
        throw new Error(result.comment || "Broker check rejected");
      if (!result.brokerSymbol || !result.expiresAt)
        throw new Error("Broker check did not return an executable binding");
      const nextPrepared = {
        requestId,
        message: `Broker validation passed for ${result.brokerSymbol}. Confirm within 60 seconds; account, mapping, or value changes require a new check.`,
        payload,
        brokerSymbol: result.brokerSymbol,
        expiresAt: result.expiresAt,
        connectionSignature: connectionSignature(account, mappings),
      };
      preparedRef.current = nextPrepared;
      setPrepared(nextPrepared);
    } catch (cause) {
      preparedRef.current = null;
      setPrepared(null);
      setExecutionNotice(
        cause instanceof Error ? cause.message : "Order check failed",
      );
      await refreshManualState();
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!prepared) return;
    if (Date.parse(prepared.expiresAt) <= Date.now()) {
      preparedRef.current = null;
      setPrepared(null);
      setExecutionNotice("Broker check expired. Check the order again.");
      return;
    }
    if (
      prepared.connectionSignature !== connectionSignature(account, mappings)
    ) {
      preparedRef.current = null;
      setPrepared(null);
      setExecutionNotice(
        "MT5 account or broker symbol mapping changed. Check the order again.",
      );
      return;
    }
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
      preparedRef.current = null;
      setPrepared(null);
      await refresh();
    } catch (cause) {
      preparedRef.current = null;
      setPrepared(null);
      setExecutionNotice(
        cause instanceof Error ? cause.message : "Execution failed",
      );
      await refreshManualState();
    } finally {
      setBusy(false);
    }
  };

  const reconcileManualOrder = async () => {
    if (!manualState.requestId || !manualState.canReconcile) return;
    setBusy(true);
    setExecutionNotice(
      "Reconciling the original request with MT5 broker history. No order will be resent.",
    );
    try {
      const result = await mt5Request<ManualOrderState>(
        "/orders/manual/reconcile",
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ requestId: manualState.requestId }),
        },
      );
      setManualState(
        result.state === "RESOLVED"
          ? {
              state: "CLEAR",
              requestId: null,
              message: result.message,
              canReconcile: false,
              outcome: result.outcome,
            }
          : result,
      );
      setExecutionNotice(result.message);
      await refresh();
    } catch (cause) {
      setExecutionNotice(
        cause instanceof Error ? cause.message : "Reconciliation failed",
      );
      await refreshManualState();
    } finally {
      setBusy(false);
    }
  };

  const saveMapping = async () => {
    if (!mappingBroker.trim()) return;
    preparedRef.current = null;
    setPrepared(null);
    setBusy(true);
    try {
      await mt5Request("/symbols/mapping", undefined, {
        method: "PUT",
        body: JSON.stringify({
          internal: mappingInternal,
          broker: mappingBroker.trim(),
        }),
      });
      setExecutionNotice(
        `${mappingInternal} now maps to ${mappingBroker.trim()}.`,
      );
      setMappingBroker("");
      await refresh();
    } catch (cause) {
      setExecutionNotice(
        cause instanceof Error ? cause.message : "Symbol mapping failed",
      );
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
            Official MetaQuotes terminal connection · broker detected
            dynamically
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
                : account.tradeApiDisabled
                  ? "PYTHON TRADING DISABLED IN MT5"
                  : account.accountType === "LIVE" &&
                      !account.liveTradingAllowed
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
            Auto-detected from this terminal. Correct only uncertain or missing
            matches.
          </p>
          <div className="mb-grid">
            {mappings.map((item) => (
              <div key={item.internal}>
                <span className="mb-muted">{item.internal}</span>
                <strong className="mb-value">
                  {item.broker || "UNMAPPED"} ·{" "}
                  {Math.round(item.confidence * 100)}%
                  {item.manual ? " · MANUAL" : ""}
                </strong>
              </div>
            ))}
          </div>
          <div className="mb-row mb-wrap">
            <select
              value={mappingInternal}
              onChange={(event) => setMappingInternal(event.target.value)}
            >
              {mappings.map((item) => (
                <option key={item.internal}>{item.internal}</option>
              ))}
            </select>
            <input
              aria-label="Exact MT5 broker symbol"
              placeholder="Exact broker symbol, e.g. XAUUSDm"
              value={mappingBroker}
              onChange={(event) => setMappingBroker(event.target.value)}
            />
            <button
              disabled={busy || !mappingBroker.trim()}
              onClick={() => void saveMapping()}
            >
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
        {manualState.state !== "CLEAR" ? (
          <div className="mb-panel" role="alert">
            <strong>
              {manualState.state === "RECONCILING"
                ? "RECONCILING ORIGINAL REQUEST"
                : "EXECUTION OUTCOME UNCERTAIN"}
            </strong>
            <p className="mb-muted">{manualState.message}</p>
            {manualState.requestId ? (
              <p className="mb-muted">Request: {manualState.requestId}</p>
            ) : null}
            <p className="mb-muted">
              New manual checks and executions are locked. Reconciliation only
              reads durable bridge state and broker history; it never resends.
            </p>
            <button
              disabled={busy || !manualState.canReconcile}
              onClick={() => void reconcileManualOrder()}
            >
              Reconcile original request
            </button>
          </div>
        ) : null}
        <div className="mb-grid">
          <label>
            Symbol
            <select
              value={symbol}
              onChange={(event) => {
                setSymbol(event.target.value);
                preparedRef.current = null;
                setPrepared(null);
              }}
            >
              {[
                "EUR/USD",
                "GBP/USD",
                "USD/JPY",
                "GBP/JPY",
                "EUR/JPY",
                "AUD/USD",
                "USD/CAD",
                "NZD/USD",
                "EUR/GBP",
                "XAU/USD",
              ].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Order type
            <select
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                preparedRef.current = null;
                setPrepared(null);
              }}
            >
              <option value="CLOSE">Close position</option>
              <option value="PARTIAL_CLOSE">Partial close</option>
              <option value="MODIFY">Modify SL / TP</option>
              <option value="CANCEL">Cancel pending order</option>
            </select>
          </label>
          <label>
            Volume
            <input
              type="number"
              min="0"
              step="any"
              value={volume}
              onChange={(event) => {
                setVolume(event.target.value);
                preparedRef.current = null;
                setPrepared(null);
              }}
            />
          </label>
          <label>
            Stop loss
            <input
              type="number"
              min="0"
              step="any"
              value={stopLoss}
              onChange={(event) => {
                setStopLoss(event.target.value);
                preparedRef.current = null;
                setPrepared(null);
              }}
            />
          </label>
          <label>
            Take profit
            <input
              type="number"
              min="0"
              step="any"
              value={takeProfit}
              onChange={(event) => {
                setTakeProfit(event.target.value);
                preparedRef.current = null;
                setPrepared(null);
              }}
            />
          </label>
          {action === "CLOSE" ||
          action === "PARTIAL_CLOSE" ||
          action === "MODIFY" ? (
            <label>
              Position
              <select
                value={positionTicket}
                onChange={(event) => {
                  const next = positions.find(
                    (item) => String(item.ticket) === event.target.value,
                  );
                  setPositionTicket(event.target.value);
                  if (next) {
                    setSymbol(next.symbol);
                    setVolume(String(next.volume));
                  }
                  preparedRef.current = null;
                  setPrepared(null);
                }}
              >
                <option value="">Choose an open position</option>
                {positions.map((item) => (
                  <option key={item.ticket} value={item.ticket}>
                    #{item.ticket} · {item.symbol} · {item.direction} ·{" "}
                    {item.volume}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {action === "CANCEL" ? (
            <label>
              Pending order
              <select
                value={orderTicket}
                onChange={(event) => {
                  const next = orders.find(
                    (item) => String(item.ticket) === event.target.value,
                  );
                  setOrderTicket(event.target.value);
                  if (next) {
                    setSymbol(next.symbol);
                    setVolume(String(next.volume));
                  }
                  preparedRef.current = null;
                  setPrepared(null);
                }}
              >
                <option value="">Choose a pending order</option>
                {orders.map((item) => (
                  <option key={item.ticket} value={item.ticket}>
                    #{item.ticket} · {item.symbol} · {item.volume} @{" "}
                    {item.price}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="mb-row mb-wrap">
          <button
            disabled={
              busy || !account?.tradingEnabled || manualState.state !== "CLEAR"
            }
            onClick={() => void checkOrder()}
          >
            Check with broker
          </button>
          <button
            disabled={busy || !prepared || manualState.state !== "CLEAR"}
            onClick={() => void execute()}
          >
            Execute after confirmation
          </button>
        </div>
        {prepared ? <p className="mb-notice">{prepared.message}</p> : null}
        {executionNotice ? <p role="status">{executionNotice}</p> : null}
      </div>
      <p className="mb-muted">
        New BUY/SELL and pending exposure must come from a READY setup through
        Setup AI, News AI, Risk AI and Execution AI. This manual panel is only
        for managing an existing broker position or pending order. Chart
        fallback data is never used for execution.
      </p>
    </section>
  );
}
