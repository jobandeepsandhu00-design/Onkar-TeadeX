from __future__ import annotations
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from .candles import normalize_rates
from .config import Settings
from .idempotency import IdempotencyStore
from .models import OrderRequest
from .symbols import WATCHLIST, discover_watchlist

log = logging.getLogger("mt5_bridge")


class MT5Unavailable(RuntimeError):
    pass


class TerminalGateway:
    """Serializes access to the official MetaQuotes terminal IPC module."""

    def __init__(self, settings: Settings, module: Any | None = None):
        self.settings = settings
        self._module = module
        self._lock = threading.RLock()
        self.connected = False
        self.connected_at: float | None = None
        self.last_error: str | None = None
        self._next_connect_attempt = 0.0
        self._connect_backoff = 1.0
        self.idempotency = IdempotencyStore(settings.mt5_state_db)
        self.mapping: dict[str, str] = self.idempotency.mappings()
        self.manual_mappings: set[str] = set(self.mapping)
        self.last_tick_at_ms: int | None = None
        self.last_closed_candle: dict[str, Any] | None = None
        self.last_execution_at_ms: int | None = None

    @property
    def mt5(self):
        if self._module is None:
            try:
                import MetaTrader5 as mt5  # type: ignore
            except ImportError as exc:
                raise MT5Unavailable("Official MetaTrader5 package is unavailable on this host") from exc
            self._module = mt5
        return self._module

    def connect(self) -> bool:
        with self._lock:
            if time.monotonic() < self._next_connect_attempt:
                return False
            kwargs: dict[str, Any] = {"timeout": 60_000}
            if self.settings.mt5_login is not None:
                kwargs["login"] = self.settings.mt5_login
            if self.settings.mt5_password:
                kwargs["password"] = self.settings.mt5_password.get_secret_value()
            if self.settings.mt5_server:
                kwargs["server"] = self.settings.mt5_server
            args = [str(self.settings.mt5_path)] if self.settings.mt5_path else []
            try:
                self.connected = bool(self.mt5.initialize(*args, **kwargs))
                if not self.connected:
                    self.last_error = f"MT5 initialize failed: {self.mt5.last_error()}"
                    self._next_connect_attempt = time.monotonic() + self._connect_backoff
                    self._connect_backoff = min(60.0, self._connect_backoff * 2)
                    return False
                self.connected_at = time.time()
                self.last_error = None
                self._next_connect_attempt = 0.0
                self._connect_backoff = 1.0
                self.refresh_mapping()
                return True
            except Exception as exc:
                self.connected = False
                self.last_error = str(exc)
                self._next_connect_attempt = time.monotonic() + self._connect_backoff
                self._connect_backoff = min(60.0, self._connect_backoff * 2)
                return False

    def ensure(self):
        if self.connected and self.mt5.terminal_info() is not None:
            return
        if not self.connect():
            raise MT5Unavailable(self.last_error or "MT5 terminal is disconnected")

    def account(self) -> dict:
        with self._lock:
            self.ensure()
            account = self.mt5.account_info()
            terminal = self.mt5.terminal_info()
            if account is None or terminal is None:
                raise MT5Unavailable("MT5 account or terminal information unavailable")
            a = account._asdict()
            t = terminal._asdict()
            mode = int(a.get("trade_mode", -1))
            account_type = "DEMO" if mode == getattr(self.mt5, "ACCOUNT_TRADE_MODE_DEMO", 0) else "LIVE" if mode == getattr(self.mt5, "ACCOUNT_TRADE_MODE_REAL", 2) else "CONTEST"
            login = str(a.get("login", ""))
            return {
                "connection": "CONNECTED",
                "broker": a.get("company") or "Unknown MT5 broker",
                "server": a.get("server") or self.settings.mt5_server or "Unknown",
                "account": ("*" * max(0, len(login) - 4)) + login[-4:],
                "accountType": account_type,
                "currency": a.get("currency"),
                "balance": a.get("balance"),
                "equity": a.get("equity"),
                "margin": a.get("margin"),
                "freeMargin": a.get("margin_free"),
                "marginLevel": a.get("margin_level"),
                "tradeAllowed": bool(t.get("trade_allowed")) and bool(a.get("trade_allowed", True)),
                "terminalConnected": bool(t.get("connected")),
                "tradingEnabled": self.settings.enable_mt5_trading,
                "liveTradingAllowed": self.settings.allow_live_trading,
            }

    def broker_symbols(self):
        with self._lock:
            self.ensure()
            return [row.name for row in (self.mt5.symbols_get() or ())]

    def refresh_mapping(self):
        symbols = [row.name for row in (self.mt5.symbols_get() or ())]
        discovered = discover_watchlist(symbols)
        for internal, match in discovered.items():
            if match.broker and internal not in self.mapping:
                self.mapping[internal] = match.broker
        return discovered

    def set_mapping(self, internal: str, broker: str):
        with self._lock:
            self.ensure()
            if broker not in self.broker_symbols():
                raise ValueError("Broker symbol does not exist in the connected terminal")
            self.mapping[internal] = broker
            self.manual_mappings.add(internal)
            self.idempotency.put_mapping(internal, broker)

    def resolve(self, internal: str):
        key = internal.upper().replace("-", "/")
        if key not in self.mapping:
            self.refresh_mapping()
        symbol = self.mapping.get(key)
        if not symbol:
            raise ValueError(f"No verified broker symbol mapping for {internal}")
        if not self.mt5.symbol_select(symbol, True):
            raise ValueError("Broker symbol could not be selected")
        return symbol

    def tick(self, internal: str) -> dict:
        with self._lock:
            self.ensure()
            symbol = self.resolve(internal)
            tick = self.mt5.symbol_info_tick(symbol)
            info = self.mt5.symbol_info(symbol)
            if tick is None or info is None:
                raise MT5Unavailable("Broker tick unavailable")
            row = tick._asdict()
            now_ms = int(time.time() * 1000)
            tick_ms = int(row.get("time_msc") or int(row["time"]) * 1000)
            self.last_tick_at_ms = tick_ms
            age = max(0, now_ms - tick_ms)
            market_open = bool(getattr(info, "trade_mode", 0))
            state = "STALE" if age > self.settings.mt5_stale_after_seconds * 1000 and market_open else "MARKET_CLOSED" if not market_open else "CONNECTED"
            return {
                "symbol": internal,
                "brokerSymbol": symbol,
                "bid": float(row.get("bid", 0)),
                "ask": float(row.get("ask", 0)),
                "last": float(row.get("last", 0)),
                "timestamp": tick_ms,
                "spread": float(row.get("ask", 0)) - float(row.get("bid", 0)),
                "tickVolume": float(row.get("volume_real") or row.get("volume") or 0),
                "state": state,
                "approximateLatencyMs": age,
            }

    def candles(self, internal: str, timeframe: str, count: int):
        with self._lock:
            self.ensure()
            symbol = self.resolve(internal)
            constants = {"15m": "TIMEFRAME_M15", "30m": "TIMEFRAME_M30", "1h": "TIMEFRAME_H1", "4h": "TIMEFRAME_H4"}
            rates = self.mt5.copy_rates_from_pos(symbol, getattr(self.mt5, constants[timeframe]), 0, count)
            account = str(self.mt5.account_info().login)
            tick = self.mt5.symbol_info_tick(symbol)
            now = int(getattr(tick, "time", 0) or time.time())
            candles = normalize_rates(account, symbol, timeframe, rates, now)
            closed = next((row for row in reversed(candles) if row.isClosed), None)
            if closed:
                self.last_closed_candle = {
                    "symbol": internal,
                    "brokerSymbol": symbol,
                    "timeframe": timeframe,
                    "time": closed.time * 1000,
                    "candleId": closed.candleId,
                }
            return candles

    def positions(self):
        with self._lock:
            self.ensure()
            rows = []
            for p in self.mt5.positions_get() or ():
                x = p._asdict()
                internal = next((key for key, value in self.mapping.items() if value == x["symbol"]), x["symbol"])
                rows.append({
                    "ticket": x["ticket"], "symbol": internal, "brokerSymbol": x["symbol"],
                    "direction": "BUY" if x["type"] == self.mt5.POSITION_TYPE_BUY else "SELL",
                    "volume": x["volume"], "entryPrice": x["price_open"],
                    "currentPrice": x["price_current"], "stopLoss": x["sl"] or None,
                    "takeProfit": x["tp"] or None, "profitLoss": x["profit"],
                    "openTime": int(x["time"]) * 1000,
                })
            return rows

    def orders(self):
        with self._lock:
            self.ensure()
            rows = []
            for order in self.mt5.orders_get() or ():
                x = order._asdict()
                rows.append({k: x.get(k) for k in ("ticket", "symbol", "type", "volume_current", "price_open", "sl", "tp", "time_setup")})
            return rows

    def trade_history(self, days: int = 30):
        with self._lock:
            self.ensure()
            end = datetime.now(timezone.utc)
            start = end - timedelta(days=max(1, min(days, 365)))
            deals = self.mt5.history_deals_get(start, end) or ()
            groups: dict[int, list[dict]] = {}
            for deal in deals:
                row = deal._asdict()
                position_id = int(row.get("position_id") or 0)
                if position_id:
                    groups.setdefault(position_id, []).append(row)
            output = []
            for ticket, rows in groups.items():
                rows.sort(key=lambda row: (row.get("time_msc", 0), row.get("ticket", 0)))
                entry_types = {getattr(self.mt5, "DEAL_ENTRY_IN", 0), getattr(self.mt5, "DEAL_ENTRY_INOUT", 2)}
                exit_types = {getattr(self.mt5, "DEAL_ENTRY_OUT", 1), getattr(self.mt5, "DEAL_ENTRY_OUT_BY", 3)}
                openings = [row for row in rows if int(row.get("entry", -1)) in entry_types]
                closing = [row for row in rows if int(row.get("entry", -1)) in exit_types]
                opening = openings[0] if openings else rows[0]
                opened_volume = sum(float(row.get("volume", 0)) for row in openings) or float(opening.get("volume", 0))
                closed_volume = sum(float(row.get("volume", 0)) for row in closing)
                fully_closed = bool(closing) and closed_volume + 1e-9 >= opened_volume
                weighted_exit = (
                    sum(float(row.get("price", 0)) * float(row.get("volume", 0)) for row in closing) / closed_volume
                    if closed_volume else None
                )
                pnl = sum(float(row.get("profit", 0)) + float(row.get("commission", 0)) + float(row.get("swap", 0)) + float(row.get("fee", 0)) for row in rows)
                output.append({
                    "positionTicket": ticket,
                    "symbol": opening.get("symbol"),
                    "direction": "BUY" if int(opening.get("type", 0)) == getattr(self.mt5, "DEAL_TYPE_BUY", 0) else "SELL",
                    "volume": opened_volume,
                    "entryPrice": float(opening.get("price", 0)),
                    "entryTime": int(opening.get("time", 0)) * 1000,
                    "exitPrice": weighted_exit if fully_closed else None,
                    "exitTime": int(closing[-1].get("time", 0)) * 1000 if fully_closed else None,
                    "profitLoss": pnl if fully_closed else None,
                    "status": "Closed" if fully_closed else "Open",
                })
            return sorted(output, key=lambda row: row["entryTime"], reverse=True)

    def _validate_volume(self, info, volume: float):
        minimum, maximum, step = float(info.volume_min), float(info.volume_max), float(info.volume_step)
        if volume < minimum or volume > maximum:
            raise ValueError(f"Volume must be between {minimum} and {maximum}")
        units = round((volume - minimum) / step)
        if abs((minimum + units * step) - volume) > max(1e-9, step / 1000):
            raise ValueError(f"Volume must follow broker step {step}")

    def execute(self, order: OrderRequest, check_only: bool = False):
        with self._lock:
            self.ensure()
            existing = self.idempotency.get(order.requestId)
            if existing:
                return {**existing, "duplicate": True}
            if not order.confirmed and not check_only:
                raise ValueError("Manual confirmation is required")
            account = self.account()
            if not self.settings.enable_mt5_trading:
                raise PermissionError("MT5 trading is disabled by the bridge")
            if account["accountType"] == "LIVE" and not self.settings.allow_live_trading:
                raise PermissionError("LIVE TRADING DISABLED")
            action_types = {
                "MARKET_BUY": self.mt5.ORDER_TYPE_BUY, "MARKET_SELL": self.mt5.ORDER_TYPE_SELL,
                "BUY_LIMIT": self.mt5.ORDER_TYPE_BUY_LIMIT, "SELL_LIMIT": self.mt5.ORDER_TYPE_SELL_LIMIT,
                "BUY_STOP": self.mt5.ORDER_TYPE_BUY_STOP, "SELL_STOP": self.mt5.ORDER_TYPE_SELL_STOP,
            }
            if order.action == "CANCEL":
                if not order.orderTicket:
                    raise ValueError("Pending-order ticket is required")
                request = {"action": self.mt5.TRADE_ACTION_REMOVE, "order": order.orderTicket, "comment": order.comment}
                symbol = order.symbol
            elif order.action in {"MODIFY", "CLOSE", "PARTIAL_CLOSE"}:
                if not order.positionTicket:
                    raise ValueError("Position ticket is required")
                positions = self.mt5.positions_get(ticket=order.positionTicket) or ()
                if not positions:
                    raise ValueError("Position was not found")
                position = positions[0]
                symbol = position.symbol
                self.mt5.symbol_select(symbol, True)
                info = self.mt5.symbol_info(symbol)
                tick = self.mt5.symbol_info_tick(symbol)
                if info is None or tick is None or not info.visible:
                    raise ValueError("Position symbol is unavailable or market data is stale")
                if order.action == "MODIFY":
                    request = {
                        "action": self.mt5.TRADE_ACTION_SLTP, "position": order.positionTicket,
                        "symbol": symbol, "sl": order.stopLoss or 0.0, "tp": order.takeProfit or 0.0,
                        "magic": 260919, "comment": order.comment,
                    }
                else:
                    self._validate_volume(info, order.volume)
                    if order.volume > float(position.volume):
                        raise ValueError("Close volume exceeds the open position")
                    closing_buy = position.type != self.mt5.POSITION_TYPE_BUY
                    request = {
                        "action": self.mt5.TRADE_ACTION_DEAL, "position": order.positionTicket,
                        "symbol": symbol, "volume": order.volume,
                        "type": self.mt5.ORDER_TYPE_BUY if closing_buy else self.mt5.ORDER_TYPE_SELL,
                        "price": tick.ask if closing_buy else tick.bid, "deviation": order.deviation,
                        "magic": 260919, "comment": order.comment, "type_time": self.mt5.ORDER_TIME_GTC,
                        "type_filling": int(info.filling_mode),
                    }
            elif order.action not in action_types:
                raise ValueError("Unsupported MT5 order action")
            else:
                symbol = self.resolve(order.symbol)
                info = self.mt5.symbol_info(symbol)
                tick = self.mt5.symbol_info_tick(symbol)
                if info is None or tick is None or not info.visible:
                    raise ValueError("Symbol is unavailable or not tradable")
                self._validate_volume(info, order.volume)
                if not getattr(info, "trade_mode", 0):
                    raise ValueError("Broker reports this symbol as not tradable or market closed")
                market = order.action.startswith("MARKET_")
                if not market and order.price is None:
                    raise ValueError("Pending orders require an explicit broker price")
                price = float(order.price or (tick.ask if order.action.endswith("BUY") else tick.bid))
                minimum_stop = float(getattr(info, "trade_stops_level", 0)) * float(getattr(info, "point", 0))
                for label, level in (("Stop loss", order.stopLoss), ("Take profit", order.takeProfit)):
                    if level and minimum_stop and abs(price - level) < minimum_stop:
                        raise ValueError(f"{label} violates broker minimum stop distance {minimum_stop}")
                request = {
                    "action": self.mt5.TRADE_ACTION_DEAL if market else self.mt5.TRADE_ACTION_PENDING,
                    "symbol": symbol, "volume": order.volume, "type": action_types[order.action],
                    "price": price, "sl": order.stopLoss or 0.0, "tp": order.takeProfit or 0.0,
                    "deviation": order.deviation, "magic": 260919, "comment": order.comment,
                    "type_time": self.mt5.ORDER_TIME_GTC,
                    "type_filling": int(info.filling_mode),
                }
            checked = self.mt5.order_check(request)
            if checked is None or int(checked.retcode) != 0:
                return {"ok": False, "stage": "check", "retcode": getattr(checked, "retcode", None), "comment": getattr(checked, "comment", "order_check failed")}
            if check_only:
                return {"ok": True, "stage": "check", "requestId": order.requestId, "brokerSymbol": symbol}
            # Reserve before order_send. If the process dies after the broker
            # receives the request, a retry is blocked pending reconciliation.
            self.idempotency.reserve(order.requestId)
            sent = self.mt5.order_send(request)
            self.last_execution_at_ms = int(time.time() * 1000)
            result = {
                "ok": sent is not None and int(sent.retcode) in {getattr(self.mt5, "TRADE_RETCODE_DONE", 10009), getattr(self.mt5, "TRADE_RETCODE_PLACED", 10008)},
                "stage": "send", "requestId": order.requestId,
                "retcode": getattr(sent, "retcode", None), "comment": getattr(sent, "comment", "order_send failed"),
                "order": getattr(sent, "order", None), "deal": getattr(sent, "deal", None), "brokerSymbol": symbol,
                "price": getattr(sent, "price", None), "volume": getattr(sent, "volume", order.volume),
            }
            self.idempotency.put(order.requestId, result)
            return result
