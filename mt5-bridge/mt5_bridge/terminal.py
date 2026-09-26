from __future__ import annotations
import hashlib
import hmac
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from .candles import normalize_rates
from .config import Settings
from .idempotency import IdempotencyStore
from .models import Candle, OrderRequest
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
        self.last_connected_at: float | None = None
        self.last_healthcheck_at: float | None = None
        self.connect_attempts = 0
        self.reconnects = 0
        self.last_error: str | None = None
        self._next_connect_attempt = 0.0
        self._connect_backoff = 1.0
        self.idempotency = IdempotencyStore(settings.mt5_state_db)
        self.account_scope: str | None = None
        self.mapping: dict[str, str] = {}
        self.manual_mappings: set[str] = set()
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
            self.connect_attempts += 1
            was_connected = self.connected_at is not None
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
                    log.error("MT5 initialize failed", extra={"mt5_error": self.last_error})
                    self._next_connect_attempt = time.monotonic() + self._connect_backoff
                    self._connect_backoff = min(60.0, self._connect_backoff * 2)
                    return False
                self.connected_at = time.time()
                self.last_connected_at = self.connected_at
                if was_connected:
                    self.reconnects += 1
                self.last_error = None
                self._next_connect_attempt = 0.0
                self._connect_backoff = 1.0
                # Never carry an alias across terminal accounts or brokers.
                # Only mappings stored under this exact opaque identity are
                # restored; automatic discovery then fills remaining symbols.
                self._synchronize_account_scope(force=True)
                log.info("MT5 terminal connected", extra={"reconnect": was_connected})
                return True
            except Exception as exc:
                self.connected = False
                self.last_error = str(exc)
                log.exception("MT5 terminal connection failed")
                self._next_connect_attempt = time.monotonic() + self._connect_backoff
                self._connect_backoff = min(60.0, self._connect_backoff * 2)
                return False

    def ensure(self):
        if self.connected:
            terminal = self.mt5.terminal_info()
            if terminal is not None and bool(getattr(terminal, "connected", False)):
                self.last_healthcheck_at = time.time()
                # MT5 can switch logins without dropping the terminal IPC
                # session. Detect that on every guarded operation and replace
                # the in-memory symbol map before any broker data is read.
                self._synchronize_account_scope()
                return
            self.connected = False
            self.last_error = "MT5 terminal IPC is not connected"
        if not self.connect():
            raise MT5Unavailable(self.last_error or "MT5 terminal is disconnected")

    def _fingerprint(self, login: str, broker: str, server: str) -> str:
        if not login or not broker or not server:
            raise MT5Unavailable("MT5 account identity is incomplete")
        canonical = "\x1f".join(
            ("onkar-mt5-account-v1", broker.casefold(), server.casefold(), login)
        )
        return hmac.new(
            self.settings.bridge_api_key.get_secret_value().encode("utf-8"),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _synchronize_account_scope(self, force: bool = False) -> str:
        account = self.mt5.account_info()
        if account is None:
            raise MT5Unavailable("MT5 account information unavailable")
        row = account._asdict()
        scope = self._fingerprint(
            str(row.get("login") or "").strip(),
            str(row.get("company") or "").strip(),
            str(row.get("server") or self.settings.mt5_server or "").strip(),
        )
        if force or self.account_scope != scope:
            self.account_scope = scope
            self.mapping = self.idempotency.mappings(scope)
            self.manual_mappings = set(self.mapping)
            self.refresh_mapping()
        return scope

    def heartbeat(self) -> dict:
        """Verify terminal IPC and reconnect using the existing capped backoff."""
        with self._lock:
            try:
                self.ensure()
                terminal = self.mt5.terminal_info()
                account = self.mt5.account_info()
                if terminal is None or account is None:
                    raise MT5Unavailable("MT5 account or terminal heartbeat unavailable")
                self.last_healthcheck_at = time.time()
                return self.health_snapshot()
            except Exception as exc:
                self.connected = False
                self.last_error = str(exc)
                log.warning("MT5 heartbeat failed", extra={"mt5_error": self.last_error})
                raise

    def health_snapshot(self) -> dict:
        version = None
        try:
            version = self.mt5.version() if self.connected else None
        except Exception:
            version = None
        return {
            "connected": self.connected,
            "connectedAt": int(self.connected_at * 1000) if self.connected_at else None,
            "lastConnectedAt": int(self.last_connected_at * 1000) if self.last_connected_at else None,
            "lastHealthcheckAt": int(self.last_healthcheck_at * 1000) if self.last_healthcheck_at else None,
            "connectAttempts": self.connect_attempts,
            "reconnects": self.reconnects,
            "lastError": self.last_error,
            "terminalVersion": list(version) if version else None,
            "pendingReconciliation": len(self.idempotency.unresolved()),
        }

    def _required_rows(self, rows, operation: str):
        """Distinguish a legitimate empty MT5 result from a provider error."""
        if rows is not None:
            return rows
        try:
            provider_error = self.mt5.last_error()
        except Exception:
            provider_error = "unavailable"
        self.last_error = f"{operation} failed: {provider_error}"
        log.error(
            "MT5 data request failed",
            extra={"operation": operation, "mt5_error": str(provider_error)},
        )
        raise MT5Unavailable(
            f"MT5 {operation} failed; broker data is unavailable"
        )

    def _account_payload(self, include_fingerprint: bool = False) -> dict:
        self.ensure()
        account = self.mt5.account_info()
        terminal = self.mt5.terminal_info()
        if account is None or terminal is None:
            raise MT5Unavailable("MT5 account or terminal information unavailable")
        a = account._asdict()
        t = terminal._asdict()
        mode = int(a.get("trade_mode", -1))
        account_type = "DEMO" if mode == getattr(self.mt5, "ACCOUNT_TRADE_MODE_DEMO", 0) else "LIVE" if mode == getattr(self.mt5, "ACCOUNT_TRADE_MODE_REAL", 2) else "CONTEST"
        login = str(a.get("login") or "").strip()
        broker = str(a.get("company") or "").strip()
        server = str(a.get("server") or self.settings.mt5_server or "").strip()
        payload = {
            "connection": "CONNECTED",
            "broker": broker or "Unknown MT5 broker",
            "server": server or "Unknown",
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
            "tradeApiDisabled": bool(t.get("tradeapi_disabled", False)),
            "tradingEnabled": self.settings.enable_mt5_trading,
            "liveTradingAllowed": self.settings.allow_live_trading,
        }
        if include_fingerprint:
            payload["accountFingerprint"] = self._fingerprint(
                login, broker, server
            )
        return payload

    def account(self) -> dict:
        """Return browser-safe account metadata with a masked login."""
        with self._lock:
            return self._account_payload(include_fingerprint=False)

    def account_identity(self) -> dict:
        """Return the server-only opaque identity used to bind AUTO execution."""
        with self._lock:
            return self._account_payload(include_fingerprint=True)

    def _candle_scope(self) -> str:
        """A domain-separated opaque id; never expose login or AUTO fingerprint."""
        fingerprint = self._account_payload(include_fingerprint=True)[
            "accountFingerprint"
        ]
        return self._candle_scope_for_fingerprint(fingerprint)

    def _candle_scope_for_fingerprint(self, fingerprint: str) -> str:
        """Derive candle ids without performing another terminal account read."""
        return hmac.new(
            self.settings.bridge_api_key.get_secret_value().encode("utf-8"),
            ("onkar-mt5-candle-scope-v1\x1f" + fingerprint).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:24]

    def broker_symbols(self):
        with self._lock:
            self.ensure()
            return [
                row.name
                for row in self._required_rows(
                    self.mt5.symbols_get(), "symbols_get"
                )
            ]

    def refresh_mapping(self):
        symbols = [
            row.name
            for row in self._required_rows(
                self.mt5.symbols_get(), "symbols_get"
            )
        ]
        discovered = discover_watchlist(symbols)
        for internal, match in discovered.items():
            if match.broker and internal not in self.mapping:
                self.mapping[internal] = match.broker
        return discovered

    def set_mapping(
        self,
        internal: str,
        broker: str,
        expected_account_fingerprint: str,
    ):
        with self._lock:
            self.ensure()
            self._assert_expected_account(expected_account_fingerprint)
            current_scope = self._account_payload(include_fingerprint=True)[
                "accountFingerprint"
            ]
            # The terminal can switch accounts without dropping IPC. Refresh
            # the in-memory aliases before accepting a write so an alias from
            # one broker login can never be carried into another account.
            if self.account_scope != current_scope:
                self.account_scope = current_scope
                self.mapping = self.idempotency.mappings(current_scope)
                self.manual_mappings = set(self.mapping)
                self.refresh_mapping()
            key = internal.upper().replace("-", "/")
            if key not in WATCHLIST:
                raise ValueError("Unsupported internal symbol mapping")
            if broker not in self.broker_symbols():
                raise ValueError("Broker symbol does not exist in the connected terminal")
            self.mapping[key] = broker
            self.manual_mappings.add(key)
            self.idempotency.put_mapping(current_scope, key, broker)

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

    def symbol_spec(self, internal: str) -> dict:
        """Return broker-native sizing and protection constraints."""
        with self._lock:
            self.ensure()
            symbol = self.resolve(internal)
            info = self.mt5.symbol_info(symbol)
            if info is None or not info.visible:
                raise MT5Unavailable("Broker symbol specification unavailable")
            return {
                "symbol": internal,
                "brokerSymbol": symbol,
                "digits": int(getattr(info, "digits", 0)),
                "point": float(getattr(info, "point", 0) or 0),
                "tickSize": float(getattr(info, "trade_tick_size", 0) or 0),
                "tickValue": float(getattr(info, "trade_tick_value", 0) or 0),
                "tickValueProfit": float(getattr(info, "trade_tick_value_profit", 0) or 0),
                "tickValueLoss": float(getattr(info, "trade_tick_value_loss", 0) or 0),
                "contractSize": float(getattr(info, "trade_contract_size", 0) or 0),
                "volumeMin": float(getattr(info, "volume_min", 0) or 0),
                "volumeMax": float(getattr(info, "volume_max", 0) or 0),
                "volumeStep": float(getattr(info, "volume_step", 0) or 0),
                "stopsLevel": int(getattr(info, "trade_stops_level", 0) or 0),
                "fillingMode": int(getattr(info, "filling_mode", 0) or 0),
                "executionMode": int(getattr(info, "trade_exemode", 0) or 0),
                "tradeMode": int(getattr(info, "trade_mode", 0) or 0),
            }

    def candles(self, internal: str, timeframe: str, count: int):
        with self._lock:
            self.ensure()
            symbol = self.resolve(internal)
            constants = {"15m": "TIMEFRAME_M15", "30m": "TIMEFRAME_M30", "1h": "TIMEFRAME_H1", "4h": "TIMEFRAME_H4"}
            rates = self._required_rows(
                self.mt5.copy_rates_from_pos(
                    symbol, getattr(self.mt5, constants[timeframe]), 0, count
                ),
                "copy_rates_from_pos",
            )
            account = self._candle_scope()
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

    def candle_bundle(
        self,
        expected_account_fingerprint: str,
        internal: str,
        timeframes: list[str],
        count: int,
    ) -> dict:
        """Capture one account- and symbol-atomic multi-timeframe market view.

        The official MetaTrader 5 Python package exposes ticks, symbol
        metadata, and each timeframe through separate IPC calls.  Keeping the
        complete sequence under the gateway RLock prevents another bridge
        request from interleaving.  The identity and resolved broker symbol
        are then re-checked immediately after every provider read so a terminal
        login or symbol-map change invalidates the entire bundle instead of
        returning mixed broker data.
        """
        allowed = {"15m", "30m", "1h", "4h"}
        requested = list(dict.fromkeys(timeframes))
        if not requested or any(timeframe not in allowed for timeframe in requested):
            raise ValueError("Choose one or more supported MT5 timeframes")
        if not 2 <= count <= 2000:
            raise ValueError("MT5 candle count must be between 2 and 2000")

        with self._lock:
            self.ensure()
            account = self._account_payload(include_fingerprint=True)
            account_fingerprint = account["accountFingerprint"]
            if not hmac.compare_digest(
                expected_account_fingerprint, account_fingerprint
            ):
                raise PermissionError(
                    "Connected MT5 account does not match the requested candle bundle"
                )
            broker_symbol = self.resolve(internal)

            def checkpoint(stage: str):
                current = self._account_payload(include_fingerprint=True)
                if not hmac.compare_digest(
                    account_fingerprint, current["accountFingerprint"]
                ):
                    self.last_error = (
                        "MT5 account changed during the atomic candle bundle "
                        f"after {stage}"
                    )
                    raise MT5Unavailable(
                        "Connected MT5 account changed during the candle bundle; mixed account data was discarded"
                    )
                current_symbol = self.resolve(internal)
                if current_symbol != broker_symbol:
                    self.last_error = (
                        "MT5 broker symbol changed during the atomic candle bundle "
                        f"after {stage}"
                    )
                    raise MT5Unavailable(
                        "MT5 broker symbol changed during the candle bundle; mixed symbol data was discarded"
                    )

            tick_record = self.mt5.symbol_info_tick(broker_symbol)
            if tick_record is None:
                raise MT5Unavailable("Broker tick unavailable")
            checkpoint("symbol_info_tick")

            info_record = self.mt5.symbol_info(broker_symbol)
            if info_record is None or not bool(getattr(info_record, "visible", False)):
                raise MT5Unavailable("Broker symbol specification unavailable")
            checkpoint("symbol_info")

            tick_row = tick_record._asdict()
            now_ms = int(time.time() * 1000)
            tick_ms = int(
                tick_row.get("time_msc") or int(tick_row.get("time") or 0) * 1000
            )
            self.last_tick_at_ms = tick_ms
            age = max(0, now_ms - tick_ms)
            market_open = bool(getattr(info_record, "trade_mode", 0))
            state = (
                "STALE"
                if age > self.settings.mt5_stale_after_seconds * 1000 and market_open
                else "MARKET_CLOSED"
                if not market_open
                else "CONNECTED"
            )
            tick = {
                "symbol": internal,
                "brokerSymbol": broker_symbol,
                "bid": float(tick_row.get("bid", 0)),
                "ask": float(tick_row.get("ask", 0)),
                "last": float(tick_row.get("last", 0)),
                "timestamp": tick_ms,
                "spread": float(tick_row.get("ask", 0))
                - float(tick_row.get("bid", 0)),
                "tickVolume": float(
                    tick_row.get("volume_real") or tick_row.get("volume") or 0
                ),
                "state": state,
                "approximateLatencyMs": age,
            }
            spec = {
                "symbol": internal,
                "brokerSymbol": broker_symbol,
                "digits": int(getattr(info_record, "digits", 0)),
                "point": float(getattr(info_record, "point", 0) or 0),
                "tickSize": float(
                    getattr(info_record, "trade_tick_size", 0) or 0
                ),
                "tickValue": float(
                    getattr(info_record, "trade_tick_value", 0) or 0
                ),
                "tickValueProfit": float(
                    getattr(info_record, "trade_tick_value_profit", 0) or 0
                ),
                "tickValueLoss": float(
                    getattr(info_record, "trade_tick_value_loss", 0) or 0
                ),
                "contractSize": float(
                    getattr(info_record, "trade_contract_size", 0) or 0
                ),
                "volumeMin": float(getattr(info_record, "volume_min", 0) or 0),
                "volumeMax": float(getattr(info_record, "volume_max", 0) or 0),
                "volumeStep": float(
                    getattr(info_record, "volume_step", 0) or 0
                ),
                "stopsLevel": int(
                    getattr(info_record, "trade_stops_level", 0) or 0
                ),
                "fillingMode": int(getattr(info_record, "filling_mode", 0) or 0),
                "executionMode": int(
                    getattr(info_record, "trade_exemode", 0) or 0
                ),
                "tradeMode": int(getattr(info_record, "trade_mode", 0) or 0),
            }

            constants = {
                "15m": "TIMEFRAME_M15",
                "30m": "TIMEFRAME_M30",
                "1h": "TIMEFRAME_H1",
                "4h": "TIMEFRAME_H4",
            }
            candle_scope = self._candle_scope_for_fingerprint(account_fingerprint)
            broker_now = int(tick_row.get("time") or time.time())
            series: dict[str, list[Candle]] = {}
            for timeframe in requested:
                rates = self._required_rows(
                    self.mt5.copy_rates_from_pos(
                        broker_symbol,
                        getattr(self.mt5, constants[timeframe]),
                        0,
                        count,
                    ),
                    f"copy_rates_from_pos:{timeframe}",
                )
                checkpoint(f"copy_rates_from_pos:{timeframe}")
                candles = normalize_rates(
                    candle_scope,
                    broker_symbol,
                    timeframe,
                    rates,
                    broker_now,
                )
                series[timeframe] = candles
                closed = next(
                    (row for row in reversed(candles) if row.isClosed), None
                )
                if closed:
                    self.last_closed_candle = {
                        "symbol": internal,
                        "brokerSymbol": broker_symbol,
                        "timeframe": timeframe,
                        "time": closed.time * 1000,
                        "candleId": closed.candleId,
                    }

            checkpoint("bundle_finalize")
            return {
                "account": account,
                "symbol": {
                    "internalSymbol": internal,
                    "brokerSymbol": broker_symbol,
                    "tick": tick,
                    "spec": spec,
                },
                "requestedTimeframes": requested,
                "timeframes": series,
                "capturedAt": int(time.time() * 1000),
            }

    def positions(self):
        with self._lock:
            self.ensure()
            return self._positions_payload()

    def _positions_payload(self):
        rows = []
        for p in self._required_rows(
            self.mt5.positions_get(), "positions_get"
        ):
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
            return self._orders_payload()

    def _orders_payload(self):
        rows = []
        for order in self._required_rows(
            self.mt5.orders_get(), "orders_get"
        ):
            x = order._asdict()
            broker_symbol = x.get("symbol")
            internal = next((key for key, value in self.mapping.items() if value == broker_symbol), broker_symbol)
            rows.append({
                "ticket": x.get("ticket"),
                "symbol": internal,
                "brokerSymbol": broker_symbol,
                "type": x.get("type"),
                "volume": x.get("volume_current"),
                "volume_current": x.get("volume_current"),
                "price": x.get("price_open"),
                "price_open": x.get("price_open"),
                "stopLoss": x.get("sl") or None,
                "takeProfit": x.get("tp") or None,
                "createdAt": int(x.get("time_setup", 0)) * 1000,
                "comment": x.get("comment") or "",
                "magic": x.get("magic"),
            })
        return rows

    def account_snapshot(
        self,
        expected_account_fingerprint: str,
        internal: str | None = None,
    ) -> dict:
        """Return one account-atomic broker view for risk and execution.

        MetaTrader 5 exposes account, portfolio, tick, and symbol metadata as
        separate IPC calls.  The outer gateway lock prevents this bridge from
        interleaving requests, while the identity checkpoint after every
        broker read detects a terminal login switch (including an A -> B -> A
        attempt) before any mixed snapshot can leave the bridge.
        """
        with self._lock:
            self.ensure()
            account = self._account_payload(include_fingerprint=True)
            account_fingerprint = account["accountFingerprint"]
            if not hmac.compare_digest(
                expected_account_fingerprint, account_fingerprint
            ):
                raise PermissionError(
                    "Connected MT5 account does not match the requested account snapshot"
                )

            def checkpoint(stage: str):
                current = self._account_payload(include_fingerprint=True)
                if not hmac.compare_digest(
                    account_fingerprint, current["accountFingerprint"]
                ):
                    self.last_error = (
                        "MT5 account changed during the atomic broker snapshot "
                        f"after {stage}"
                    )
                    raise MT5Unavailable(
                        "Connected MT5 account changed during the broker snapshot; mixed account data was discarded"
                    )

            positions = self._positions_payload()
            checkpoint("positions_get")
            orders = self._orders_payload()
            checkpoint("orders_get")

            symbol_snapshot = None
            if internal:
                # These methods re-enter the same RLock; no other bridge
                # request can run between the portfolio and market reads.
                tick = self.tick(internal)
                checkpoint("symbol_info_tick")
                spec = self.symbol_spec(internal)
                checkpoint("symbol_info")
                if tick["brokerSymbol"] != spec["brokerSymbol"]:
                    raise MT5Unavailable(
                        "MT5 broker symbol changed during the broker snapshot"
                    )
                symbol_snapshot = {"tick": tick, "spec": spec}

            # One final checkpoint immediately before returning prevents a
            # switched terminal identity from escaping in the response.
            checkpoint("snapshot_finalize")
            return {
                "account": account,
                "positions": positions,
                "orders": orders,
                "symbol": symbol_snapshot,
                "capturedAt": int(time.time() * 1000),
            }

    @staticmethod
    def _record(row) -> dict:
        return row._asdict() if hasattr(row, "_asdict") else dict(row)

    def _execution_token(self, request_id: str) -> str:
        return hashlib.sha256(request_id.encode("utf-8")).hexdigest()[:16]

    def _assert_no_other_unresolved(self, request_id: str):
        unresolved = [
            row
            for row in self.idempotency.unresolved()
            if row["requestId"] != request_id
        ]
        if unresolved:
            raise PermissionError(
                "Another MT5 execution is unresolved; reconcile the original request before checking or sending a new order"
            )

    @staticmethod
    def _order_intent_digest(order: OrderRequest) -> str:
        canonical = order.model_dump(mode="json")
        # The only allowed transition between check and execute is the manual
        # confirmation bit; every executable field remains bound.
        canonical["confirmed"] = False
        return hashlib.sha256(
            json.dumps(
                canonical,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()

    def _execution_comment(self, request_id: str, requested: str) -> tuple[str, str]:
        token = self._execution_token(request_id)
        prefix = f"OTX:{token}"
        suffix = requested.strip().replace("\n", " ")
        return token, f"{prefix} {suffix}"[:31].rstrip()

    @staticmethod
    def _ticket(row: dict) -> int:
        return int(row.get("ticket") or row.get("order") or 0)

    def _management_reconciliation(
        self,
        pending: dict,
        positions: list,
        orders: list,
        history_orders: list,
        account_scope: str,
    ) -> tuple[dict | None, str | None]:
        """Prove MODIFY/CANCEL state without ever resending the request."""
        if not pending.get("accountScope") or not hmac.compare_digest(
            str(pending["accountScope"]), account_scope
        ):
            return None, "ACCOUNT_MISMATCH"
        request = pending.get("request") or {}
        action = int(request.get("action") or -1)
        expected_symbol = str(pending.get("brokerSymbol") or "")

        if action == getattr(self.mt5, "TRADE_ACTION_SLTP", 6):
            ticket = int(request.get("position") or 0)
            position = next(
                (
                    self._record(row)
                    for row in positions
                    if self._ticket(self._record(row)) == ticket
                ),
                None,
            )
            if not position or str(position.get("symbol") or "") != expected_symbol:
                return None, "MANUAL_REVIEW"
            info = self.mt5.symbol_info(expected_symbol)
            if info is None:
                raise MT5Unavailable(
                    "MT5 symbol_info failed during execution reconciliation"
                )
            tolerance = max(
                float(getattr(info, "point", 0.0) or 0.0) / 2,
                1e-12,
            )
            expected_sl = float(request.get("sl") or 0.0)
            expected_tp = float(request.get("tp") or 0.0)
            actual_sl = float(position.get("sl") or 0.0)
            actual_tp = float(position.get("tp") or 0.0)
            if (
                abs(actual_sl - expected_sl) <= tolerance
                and abs(actual_tp - expected_tp) <= tolerance
            ):
                return {
                    "ok": True,
                    "stage": "reconciled_management",
                    "requestId": pending["requestId"],
                    "order": None,
                    "deal": None,
                    "brokerSymbol": expected_symbol,
                    "position": ticket,
                    "comment": "The exact MT5 position already has the requested SL/TP; duplicate modification prevented.",
                }, None
            return None, "MANUAL_REVIEW"

        if action == getattr(self.mt5, "TRADE_ACTION_REMOVE", 8):
            ticket = int(request.get("order") or 0)
            active = next(
                (
                    self._record(row)
                    for row in orders
                    if self._ticket(self._record(row)) == ticket
                ),
                None,
            )
            if active:
                return None, "AWAITING_BROKER_HISTORY"
            historical = next(
                (
                    self._record(row)
                    for row in history_orders
                    if self._ticket(self._record(row)) == ticket
                    and str(self._record(row).get("symbol") or "")
                    == expected_symbol
                ),
                None,
            )
            if not historical:
                return None, "MANUAL_REVIEW"
            state = int(historical.get("state") or 0)
            cancelled_states = {
                getattr(self.mt5, "ORDER_STATE_CANCELED", 2),
                getattr(self.mt5, "ORDER_STATE_EXPIRED", 6),
            }
            ok = state in cancelled_states
            return {
                "ok": ok,
                "stage": "reconciled_management",
                "requestId": pending["requestId"],
                "order": ticket,
                "deal": None,
                "brokerSymbol": expected_symbol,
                "comment": (
                    "The exact pending order is no longer active and broker history confirms cancellation/expiry; duplicate cancellation prevented."
                    if ok
                    else "The exact pending order is no longer active, but broker history does not show cancellation; no retry was sent."
                ),
            }, None

        return None, None

    def reconcile(self) -> dict:
        """Read broker truth and resolve crash-window reservations without resending."""
        with self._lock:
            self.ensure()
            account_scope_before = self._account_payload(
                include_fingerprint=True
            )["accountFingerprint"]
            positions = list(
                self._required_rows(self.mt5.positions_get(), "positions_get")
            )
            orders = list(
                self._required_rows(self.mt5.orders_get(), "orders_get")
            )
            end = datetime.now(timezone.utc)
            start = end - timedelta(hours=self.settings.mt5_reconcile_lookback_hours)
            history_orders = list(
                self._required_rows(
                    self.mt5.history_orders_get(start, end),
                    "history_orders_get",
                )
            )
            history_deals = list(
                self._required_rows(
                    self.mt5.history_deals_get(start, end),
                    "history_deals_get",
                )
            )
            account_scope_after = self._account_payload(
                include_fingerprint=True
            )["accountFingerprint"]
            account_scope_stable = hmac.compare_digest(
                account_scope_before, account_scope_after
            )
            records = [
                ("position", self._record(row)) for row in positions
            ] + [
                ("order", self._record(row)) for row in orders
            ] + [
                ("history_order", self._record(row)) for row in history_orders
            ] + [
                ("deal", self._record(row)) for row in history_deals
            ]
            resolved = []
            unresolved = []
            # ARMED and CLAIMED are provably before order_send. Keep a short
            # handoff grace for an active backend request, then terminalize
            # them under the gateway lock so a delayed caller can never send.
            for unsent in self.idempotency.unresolved():
                state = str(unsent.get("state") or "")
                if state not in {"ARMED", "CLAIMED"}:
                    continue
                age = self.idempotency.age_seconds(unsent["createdAt"])
                grace_seconds = (
                    self.settings.mt5_preflight_grace_seconds
                    if state == "ARMED"
                    else self.settings.mt5_reconcile_grace_seconds
                )
                if age < grace_seconds:
                    unresolved.append(
                        {
                            "requestId": unsent["requestId"],
                            "ageSeconds": round(age, 3),
                            "state": "AWAITING_BROKER_HISTORY",
                        }
                    )
                    continue
                cancelled = self.idempotency.cancel_unsent(
                    unsent["requestId"], state
                )
                if cancelled:
                    resolved.append(cancelled)
            for pending in self.idempotency.pending():
                if not account_scope_stable:
                    unresolved.append(
                        {
                            "requestId": pending["requestId"],
                            "ageSeconds": round(
                                self.idempotency.age_seconds(
                                    pending["createdAt"]
                                ),
                                3,
                            ),
                            "state": "ACCOUNT_CHANGED",
                        }
                    )
                    continue
                management, management_state = self._management_reconciliation(
                    pending,
                    positions,
                    orders,
                    history_orders,
                    account_scope_after,
                )
                if management:
                    self.idempotency.complete_reconciliation(
                        pending["requestId"], management
                    )
                    resolved.append(management)
                    continue
                if management_state == "ACCOUNT_MISMATCH":
                    unresolved.append(
                        {
                            "requestId": pending["requestId"],
                            "ageSeconds": round(
                                self.idempotency.age_seconds(
                                    pending["createdAt"]
                                ),
                                3,
                            ),
                            "state": "ACCOUNT_MISMATCH",
                        }
                    )
                    continue
                token = str(pending.get("token") or "")
                match = next(
                    (
                        (kind, row)
                        for kind, row in records
                        if token
                        and f"OTX:{token}" in str(row.get("comment") or "")
                        and int(row.get("magic") or 0) == self.settings.mt5_magic
                    ),
                    None,
                )
                if match:
                    kind, row = match
                    response = {
                        "ok": True,
                        "stage": "reconciled",
                        "requestId": pending["requestId"],
                        "order": row.get("order") or row.get("ticket"),
                        "deal": row.get("ticket") if kind == "deal" else None,
                        "brokerSymbol": row.get("symbol"),
                        "comment": "Existing MT5 broker activity matched after restart; duplicate send prevented.",
                    }
                    self.idempotency.complete_reconciliation(pending["requestId"], response)
                    resolved.append(response)
                else:
                    age = self.idempotency.age_seconds(pending["createdAt"])
                    unresolved.append({
                        "requestId": pending["requestId"],
                        "ageSeconds": round(age, 3),
                        "state": (
                            management_state
                            or (
                                "AWAITING_BROKER_HISTORY"
                                if age < self.settings.mt5_reconcile_grace_seconds
                                else "MANUAL_REVIEW"
                            )
                        ),
                    })
            snapshot = {
                "positions": len(positions),
                "orders": len(orders),
                "resolvedRequests": resolved,
                "unresolvedRequests": unresolved,
                "reconciledAt": int(time.time() * 1000),
            }
            log.info(
                "MT5 broker state reconciled",
                extra={
                    "positions": len(positions),
                    "orders": len(orders),
                    "resolved": len(resolved),
                    "unresolved": len(unresolved),
                },
            )
            return snapshot

    def execution_result(self, request_id: str) -> dict:
        """Resolve one request from durable state and broker truth, never by resending."""
        with self._lock:
            stored = self.idempotency.lookup(request_id)
            reconciliation = None
            if stored and stored["state"] == "RESERVED":
                self.ensure()
                reconciliation = self.reconcile()
                stored = self.idempotency.lookup(request_id)
            if not stored:
                return {
                    "requestId": request_id,
                    "state": "NOT_FOUND",
                    # A missing state database cannot prove broker absence.
                    # Keep the backend locked for manual investigation.
                    "resolved": False,
                    "reconciliationState": "MANUAL_REVIEW",
                    "result": None,
                }
            if stored["state"] == "ARMED":
                # Treat result lookup as an explicit recovery action. Merely
                # reporting ARMED would let a delayed claim race the backend's
                # decision to unlock new manual orders. Terminalizing the
                # preflight under the same gateway lock proves no send occurred
                # and prevents any later claim for this request id.
                cancelled = self.idempotency.cancel_unsent(request_id, "ARMED")
                if cancelled:
                    return {
                        "requestId": request_id,
                        "state": "CANCELLED",
                        "resolved": True,
                        "result": cancelled,
                    }
                stored = self.idempotency.lookup(request_id)
                if stored and stored["state"] == "COMPLETED":
                    return {
                        "requestId": request_id,
                        "state": "COMPLETED",
                        "resolved": True,
                        "result": stored["result"],
                    }
                return {
                    "requestId": request_id,
                    "state": stored["state"] if stored else "NOT_FOUND",
                    "resolved": bool(
                        stored and stored["state"] == "CANCELLED"
                    ),
                    "reconciliationState": (
                        None
                        if stored and stored["state"] == "CANCELLED"
                        else "MANUAL_REVIEW"
                    ),
                    "result": stored["result"] if stored else None,
                }
            if stored["state"] == "CLAIMED":
                # The gateway lock serializes this transition against execute.
                # If reconciliation wins, a delayed execute observes the
                # terminal CANCELLED result and cannot reserve/order_send. If
                # execute wins, state is already RESERVED/COMPLETED instead.
                cancelled = self.idempotency.cancel_unsent(
                    request_id, "CLAIMED"
                )
                if not cancelled:
                    stored = self.idempotency.lookup(request_id)
                    if stored and stored["state"] == "COMPLETED":
                        return {
                            "requestId": request_id,
                            "state": "COMPLETED",
                            "resolved": True,
                            "result": stored["result"],
                        }
                    if stored and stored["state"] == "CANCELLED":
                        # Another bridge worker may have won the same durable
                        # SQLite transition. Converge on its terminal result.
                        return {
                            "requestId": request_id,
                            "state": "CANCELLED",
                            "resolved": True,
                            "result": stored["result"],
                        }
                    return {
                        "requestId": request_id,
                        "state": stored["state"] if stored else "NOT_FOUND",
                        "resolved": False,
                        "reconciliationState": "MANUAL_REVIEW",
                        "result": stored["result"] if stored else None,
                    }
                return {
                    "requestId": request_id,
                    "state": "CANCELLED",
                    "resolved": True,
                    "result": cancelled,
                }
            if stored["state"] == "COMPLETED":
                return {
                    "requestId": request_id,
                    "state": "COMPLETED",
                    "resolved": True,
                    "result": stored["result"],
                }
            if stored["state"] == "CANCELLED":
                # Reconciliation of a CLAIMED request is durable and
                # repeatable. A later lookup must keep reporting the explicit
                # not-sent outcome instead of falling through to the RESERVED
                # broker-history path and re-locking the backend.
                return {
                    "requestId": request_id,
                    "state": "CANCELLED",
                    "resolved": True,
                    "result": stored["result"],
                }
            unresolved = next(
                (
                    item
                    for item in (reconciliation or {}).get("unresolvedRequests", [])
                    if item.get("requestId") == request_id
                ),
                None,
            )
            return {
                "requestId": request_id,
                "state": "RESERVED",
                "resolved": False,
                "reconciliationState": (
                    unresolved.get("state") if unresolved else "AWAITING_BROKER_HISTORY"
                ),
                "ageSeconds": unresolved.get("ageSeconds") if unresolved else None,
                "result": stored["result"],
            }

    def claim_execution(
        self,
        order: OrderRequest,
        expected_account_fingerprint: str | None = None,
        expected_broker_symbol: str | None = None,
    ) -> dict:
        """Durably mark that the backend is about to call execute; never sends."""
        with self._lock:
            self.ensure()
            self._assert_no_other_unresolved(order.requestId)
            self._assert_expected_account(expected_account_fingerprint)
            account_scope = self._account_payload(include_fingerprint=True)[
                "accountFingerprint"
            ]
            broker_symbol = self.resolve(order.symbol)
            self._assert_expected_broker_symbol(
                expected_broker_symbol, broker_symbol
            )
            intent_digest = self._order_intent_digest(order)
            stored = self.idempotency.lookup(order.requestId)
            if not stored or stored["state"] not in {"ARMED", "CLAIMED"}:
                raise ValueError(
                    "MT5 request must pass the exact broker preflight before execution"
                )
            # Validate all exact bindings before changing durable state.
            self.idempotency.get(
                order.requestId,
                intent_digest,
                account_scope,
                broker_symbol,
            )
            self.idempotency.claim(
                order.requestId,
                intent_digest,
                account_scope,
                broker_symbol,
            )
            return {
                "ok": True,
                "stage": "claimed",
                "requestId": order.requestId,
                "brokerSymbol": broker_symbol,
            }

    def trade_history(self, days: int = 30):
        with self._lock:
            self.ensure()
            end = datetime.now(timezone.utc)
            start = end - timedelta(days=max(1, min(days, 365)))
            window_deals = self._required_rows(
                self.mt5.history_deals_get(start, end),
                "history_deals_get",
            )
            position_ids = {
                int(self._record(deal).get("position_id") or 0)
                for deal in window_deals
                if int(self._record(deal).get("position_id") or 0)
            }
            groups: dict[int, list[dict]] = {}
            # A date-window response can contain only the closing leg of a
            # long-held position. Fetch the broker's complete chain by
            # position id before deriving direction, entry, P/L, or journal
            # dates. Missing opening evidence fails closed instead of
            # fabricating an entry from an exit deal.
            for position_id in sorted(position_ids):
                chain = self._required_rows(
                    self.mt5.history_deals_get(position=position_id),
                    "history_deals_get(position)",
                )
                groups[position_id] = [
                    self._record(deal)
                    for deal in chain
                    if int(self._record(deal).get("position_id") or 0)
                    == position_id
                ]
            for deal in window_deals:
                row = deal._asdict()
                position_id = int(row.get("position_id") or 0)
                if position_id and position_id not in groups:
                    groups[position_id] = [row]
            output = []
            for ticket, rows in groups.items():
                rows.sort(key=lambda row: (row.get("time_msc", 0), row.get("ticket", 0)))
                entry_types = {getattr(self.mt5, "DEAL_ENTRY_IN", 0), getattr(self.mt5, "DEAL_ENTRY_INOUT", 2)}
                exit_types = {getattr(self.mt5, "DEAL_ENTRY_OUT", 1), getattr(self.mt5, "DEAL_ENTRY_OUT_BY", 3)}
                openings = [row for row in rows if int(row.get("entry", -1)) in entry_types]
                closing = [row for row in rows if int(row.get("entry", -1)) in exit_types]
                if not openings:
                    raise MT5Unavailable(
                        f"MT5 history for position {ticket} is incomplete; journal sync is paused"
                    )
                opening = openings[0]
                broker_symbol = str(opening.get("symbol") or "")
                internal_symbol = next(
                    (
                        key
                        for key, value in self.mapping.items()
                        if value == broker_symbol
                    ),
                    broker_symbol,
                )
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
                    "symbol": internal_symbol,
                    "brokerSymbol": broker_symbol,
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

    def _filling_type(self, info, pending: bool = False) -> int:
        if pending:
            return getattr(self.mt5, "ORDER_FILLING_RETURN", 2)
        execution = int(getattr(info, "trade_exemode", 0) or 0)
        market_execution = getattr(self.mt5, "SYMBOL_TRADE_EXECUTION_MARKET", 2)
        if execution != market_execution:
            return getattr(self.mt5, "ORDER_FILLING_RETURN", 2)
        allowed = int(getattr(info, "filling_mode", 0) or 0)
        ioc_flag = getattr(self.mt5, "SYMBOL_FILLING_IOC", 2)
        fok_flag = getattr(self.mt5, "SYMBOL_FILLING_FOK", 1)
        if allowed & ioc_flag:
            return getattr(self.mt5, "ORDER_FILLING_IOC", 1)
        if allowed & fok_flag:
            return getattr(self.mt5, "ORDER_FILLING_FOK", 0)
        raise ValueError("Broker does not expose a supported market-order filling mode")

    def _assert_fresh_tick(self, tick):
        tick_ms = int(getattr(tick, "time_msc", 0) or int(getattr(tick, "time", 0)) * 1000)
        age = max(0, int(time.time() * 1000) - tick_ms)
        if not tick_ms or age > self.settings.mt5_stale_after_seconds * 1000:
            raise ValueError("Broker tick is stale; execution is paused")

    def _validate_protection(self, order: OrderRequest, price: float, buy: bool, minimum_stop: float):
        if order.stopLoss is not None:
            if (buy and order.stopLoss >= price) or (not buy and order.stopLoss <= price):
                raise ValueError("Stop loss is on the wrong side of the execution price")
            if minimum_stop and abs(price - order.stopLoss) < minimum_stop:
                raise ValueError(f"Stop loss violates broker minimum stop distance {minimum_stop}")
        if order.takeProfit is not None:
            if (buy and order.takeProfit <= price) or (not buy and order.takeProfit >= price):
                raise ValueError("Take profit is on the wrong side of the execution price")
            if minimum_stop and abs(price - order.takeProfit) < minimum_stop:
                raise ValueError(f"Take profit violates broker minimum stop distance {minimum_stop}")

    def _assert_expected_account(self, expected_fingerprint: str | None):
        if not expected_fingerprint:
            return
        current = self._account_payload(include_fingerprint=True)["accountFingerprint"]
        if not hmac.compare_digest(expected_fingerprint, current):
            raise PermissionError(
                "Connected MT5 account changed; execution is blocked until account reconciliation completes"
            )

    @staticmethod
    def _assert_expected_broker_symbol(expected_symbol: str | None, actual_symbol: str):
        if expected_symbol and not hmac.compare_digest(expected_symbol, actual_symbol):
            raise PermissionError(
                "MT5 broker symbol mapping changed; execution is blocked until the order is checked again"
            )

    def execute(
        self,
        order: OrderRequest,
        check_only: bool = False,
        expected_account_fingerprint: str | None = None,
        expected_broker_symbol: str | None = None,
    ):
        with self._lock:
            self.ensure()
            self._assert_no_other_unresolved(order.requestId)
            self._assert_expected_account(expected_account_fingerprint)
            account_scope = self._account_payload(include_fingerprint=True)[
                "accountFingerprint"
            ]
            resolved_intent_symbol = self.resolve(order.symbol)
            self._assert_expected_broker_symbol(
                expected_broker_symbol, resolved_intent_symbol
            )
            intent_digest = self._order_intent_digest(order)
            stored_before = self.idempotency.lookup(order.requestId)
            existing = self.idempotency.get(
                order.requestId,
                intent_digest,
                account_scope,
                resolved_intent_symbol,
            )
            if existing:
                return {**existing, "duplicate": True}
            if not order.confirmed and not check_only:
                raise ValueError("Manual confirmation is required")
            account = self.account()
            if not self.settings.enable_mt5_trading:
                raise PermissionError("MT5 trading is disabled by the bridge")
            if account["accountType"] == "LIVE" and not self.settings.allow_live_trading:
                raise PermissionError("LIVE TRADING DISABLED")
            if account.get("tradeApiDisabled"):
                raise PermissionError("MT5 terminal has external Python trading disabled")
            token, execution_comment = self._execution_comment(order.requestId, order.comment)
            action_types = {
                "MARKET_BUY": self.mt5.ORDER_TYPE_BUY, "MARKET_SELL": self.mt5.ORDER_TYPE_SELL,
                "BUY_LIMIT": self.mt5.ORDER_TYPE_BUY_LIMIT, "SELL_LIMIT": self.mt5.ORDER_TYPE_SELL_LIMIT,
                "BUY_STOP": self.mt5.ORDER_TYPE_BUY_STOP, "SELL_STOP": self.mt5.ORDER_TYPE_SELL_STOP,
            }
            if order.action == "CANCEL":
                if not order.orderTicket:
                    raise ValueError("Pending-order ticket is required")
                pending_orders = self._required_rows(
                    self.mt5.orders_get(ticket=order.orderTicket),
                    "orders_get",
                )
                if not pending_orders:
                    raise ValueError("Pending order was not found")
                pending_order = pending_orders[0]
                symbol = pending_order.symbol
                if self.resolve(order.symbol) != symbol:
                    raise ValueError("Pending order symbol does not match the selected symbol")
                request = {
                    "action": self.mt5.TRADE_ACTION_REMOVE,
                    "order": order.orderTicket,
                    "magic": self.settings.mt5_magic,
                    "comment": execution_comment,
                }
            elif order.action in {"MODIFY", "CLOSE", "PARTIAL_CLOSE"}:
                if not order.positionTicket:
                    raise ValueError("Position ticket is required")
                positions = self._required_rows(
                    self.mt5.positions_get(ticket=order.positionTicket),
                    "positions_get",
                )
                if not positions:
                    raise ValueError("Position was not found")
                position = positions[0]
                symbol = position.symbol
                if resolved_intent_symbol != symbol:
                    raise ValueError(
                        "Position symbol does not match the selected symbol"
                    )
                self.mt5.symbol_select(symbol, True)
                info = self.mt5.symbol_info(symbol)
                tick = self.mt5.symbol_info_tick(symbol)
                if info is None or tick is None or not info.visible:
                    raise ValueError("Position symbol is unavailable or market data is stale")
                if order.action == "MODIFY":
                    if order.stopLoss is None and order.takeProfit is None:
                        raise ValueError("At least one Stop Loss or Take Profit value is required")
                    self._assert_fresh_tick(tick)
                    buy_position = position.type == self.mt5.POSITION_TYPE_BUY
                    current_price = float(tick.bid if buy_position else tick.ask)
                    existing_sl = float(getattr(position, "sl", 0.0) or 0.0)
                    existing_tp = float(getattr(position, "tp", 0.0) or 0.0)
                    final_sl = (
                        float(order.stopLoss)
                        if order.stopLoss is not None
                        else existing_sl
                    )
                    final_tp = (
                        float(order.takeProfit)
                        if order.takeProfit is not None
                        else existing_tp
                    )
                    minimum_stop = float(
                        getattr(info, "trade_stops_level", 0)
                    ) * float(getattr(info, "point", 0))
                    validated = order.model_copy(
                        update={
                            "stopLoss": final_sl or None,
                            "takeProfit": final_tp or None,
                        }
                    )
                    self._validate_protection(
                        validated,
                        current_price,
                        buy_position,
                        minimum_stop,
                    )
                    request = {
                        "action": self.mt5.TRADE_ACTION_SLTP, "position": order.positionTicket,
                        "symbol": symbol, "sl": final_sl, "tp": final_tp,
                        "magic": self.settings.mt5_magic, "comment": execution_comment,
                    }
                else:
                    self._assert_fresh_tick(tick)
                    position_volume = float(position.volume)
                    close_volume = (
                        position_volume if order.action == "CLOSE" else order.volume
                    )
                    self._validate_volume(info, close_volume)
                    if close_volume > position_volume:
                        raise ValueError("Close volume exceeds the open position")
                    if order.action == "PARTIAL_CLOSE" and close_volume >= position_volume:
                        raise ValueError(
                            "Partial close volume must be smaller than the open position"
                        )
                    closing_buy = position.type != self.mt5.POSITION_TYPE_BUY
                    request = {
                        "action": self.mt5.TRADE_ACTION_DEAL, "position": order.positionTicket,
                        "symbol": symbol, "volume": close_volume,
                        "type": self.mt5.ORDER_TYPE_BUY if closing_buy else self.mt5.ORDER_TYPE_SELL,
                        "deviation": order.deviation,
                        "magic": self.settings.mt5_magic, "comment": execution_comment, "type_time": self.mt5.ORDER_TIME_GTC,
                        "type_filling": self._filling_type(info),
                    }
                    if int(getattr(info, "trade_exemode", 0) or 0) != getattr(
                        self.mt5, "SYMBOL_TRADE_EXECUTION_MARKET", 2
                    ):
                        request["price"] = tick.ask if closing_buy else tick.bid
            elif order.action not in action_types:
                raise ValueError("Unsupported MT5 order action")
            else:
                symbol = self.resolve(order.symbol)
                info = self.mt5.symbol_info(symbol)
                tick = self.mt5.symbol_info_tick(symbol)
                if info is None or tick is None or not info.visible:
                    raise ValueError("Symbol is unavailable or not tradable")
                self._assert_fresh_tick(tick)
                self._validate_volume(info, order.volume)
                if not getattr(info, "trade_mode", 0):
                    raise ValueError("Broker reports this symbol as not tradable or market closed")
                market = order.action.startswith("MARKET_")
                if not market and order.price is None:
                    raise ValueError("Pending orders require an explicit broker price")
                buy = order.action in {"MARKET_BUY", "BUY_LIMIT", "BUY_STOP"}
                price = float(order.price or (tick.ask if buy else tick.bid))
                if order.action == "BUY_LIMIT" and price >= float(tick.ask):
                    raise ValueError("Buy Limit price must be below the current Ask")
                if order.action == "SELL_LIMIT" and price <= float(tick.bid):
                    raise ValueError("Sell Limit price must be above the current Bid")
                if order.action == "BUY_STOP" and price <= float(tick.ask):
                    raise ValueError("Buy Stop price must be above the current Ask")
                if order.action == "SELL_STOP" and price >= float(tick.bid):
                    raise ValueError("Sell Stop price must be below the current Bid")
                minimum_stop = float(getattr(info, "trade_stops_level", 0)) * float(getattr(info, "point", 0))
                self._validate_protection(order, price, buy, minimum_stop)
                request = {
                    "action": self.mt5.TRADE_ACTION_DEAL if market else self.mt5.TRADE_ACTION_PENDING,
                    "symbol": symbol, "volume": order.volume, "type": action_types[order.action],
                    "sl": order.stopLoss or 0.0, "tp": order.takeProfit or 0.0,
                    "deviation": order.deviation, "magic": self.settings.mt5_magic, "comment": execution_comment,
                    "type_time": self.mt5.ORDER_TIME_GTC,
                    "type_filling": self._filling_type(info, pending=not market),
                }
                if not market or int(getattr(info, "trade_exemode", 0) or 0) != getattr(
                    self.mt5, "SYMBOL_TRADE_EXECUTION_MARKET", 2
                ):
                    request["price"] = price
            self._assert_expected_broker_symbol(expected_broker_symbol, symbol)
            if not check_only:
                if not stored_before:
                    raise ValueError(
                        "MT5 broker preflight and execution claim are required"
                    )
                if stored_before["state"] == "ARMED":
                    raise ValueError(
                        "MT5 execution claim is required after broker preflight"
                    )
                if stored_before["state"] != "CLAIMED":
                    raise ValueError(
                        "MT5 request is not in an executable claimed state"
                    )
            checked = self.mt5.order_check(request)
            if checked is None or int(checked.retcode) != 0:
                return {"ok": False, "stage": "check", "retcode": getattr(checked, "retcode", None), "comment": getattr(checked, "comment", "order_check failed")}
            if check_only:
                checked_response = {
                    "ok": True,
                    "stage": "check",
                    "requestId": order.requestId,
                    "brokerSymbol": symbol,
                }
                # Persist the exact checked intent before acknowledging the
                # preflight. Reconciliation can now distinguish "never sent"
                # (ARMED) from the crash window after reserve/order_send.
                self.idempotency.arm(
                    order.requestId,
                    checked_response,
                    request,
                    token,
                    intent_digest,
                    account_scope,
                    symbol,
                )
                return checked_response
            # Re-read the terminal identity after order_check and immediately
            # before the irreversible broker send. AUTO supplies this opaque
            # value through a server-only header.
            self._assert_expected_account(expected_account_fingerprint)
            self._assert_expected_broker_symbol(expected_broker_symbol, symbol)
            # Reserve before order_send. If the process dies after the broker
            # receives the request, a retry is blocked pending reconciliation.
            self.idempotency.reserve(
                order.requestId,
                request,
                token,
                intent_digest,
                account_scope,
                resolved_intent_symbol,
            )
            sent = self.mt5.order_send(request)
            self.last_execution_at_ms = int(time.time() * 1000)
            result = {
                "ok": sent is not None and int(sent.retcode) in {
                    getattr(self.mt5, "TRADE_RETCODE_DONE", 10009),
                    getattr(self.mt5, "TRADE_RETCODE_PLACED", 10008),
                    # A partial fill is still irreversible broker activity. It
                    # must be journaled/reconciled as accepted so a retry can
                    # never create a second position.
                    getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010),
                },
                "stage": "send", "requestId": order.requestId,
                "retcode": getattr(sent, "retcode", None), "comment": getattr(sent, "comment", "order_send failed"),
                "order": getattr(sent, "order", None), "deal": getattr(sent, "deal", None), "brokerSymbol": symbol,
                "price": getattr(sent, "price", None), "volume": getattr(sent, "volume", order.volume),
            }
            self.idempotency.put(order.requestId, result)
            if not result["ok"]:
                log.error(
                    "MT5 order rejected",
                    extra={"request_id": order.requestId, "retcode": result["retcode"], "action": order.action},
                )
            else:
                log.info(
                    "MT5 order accepted",
                    extra={"request_id": order.requestId, "order": result["order"], "deal": result["deal"], "action": order.action},
                )
            return result
