from pathlib import Path
from types import SimpleNamespace
import time
import pytest
from pydantic import SecretStr
from mt5_bridge.config import Settings
from mt5_bridge.models import OrderRequest
from mt5_bridge.terminal import MT5Unavailable, TerminalGateway


class Record(SimpleNamespace):
    def _asdict(self):
        return vars(self)


class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_REAL = 2
    TIMEFRAME_M15 = 15
    TIMEFRAME_M30 = 30
    TIMEFRAME_H1 = 60
    TIMEFRAME_H4 = 240
    POSITION_TYPE_BUY = 0
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_TYPE_BUY_LIMIT = 2
    ORDER_TYPE_SELL_LIMIT = 3
    ORDER_TYPE_BUY_STOP = 4
    ORDER_TYPE_SELL_STOP = 5
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_PENDING = 5
    TRADE_ACTION_SLTP = 6
    TRADE_ACTION_REMOVE = 8
    ORDER_TIME_GTC = 0
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    ORDER_FILLING_RETURN = 2
    SYMBOL_FILLING_FOK = 1
    SYMBOL_FILLING_IOC = 2
    SYMBOL_TRADE_EXECUTION_MARKET = 2
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_PLACED = 10008
    TRADE_RETCODE_DONE_PARTIAL = 10010
    ORDER_STATE_CANCELED = 2
    ORDER_STATE_PARTIAL = 3
    ORDER_STATE_FILLED = 4
    ORDER_STATE_REJECTED = 5
    ORDER_STATE_EXPIRED = 6
    DEAL_ENTRY_IN = 0
    DEAL_ENTRY_OUT = 1
    DEAL_ENTRY_INOUT = 2
    DEAL_ENTRY_OUT_BY = 3
    DEAL_TYPE_BUY = 0

    def __init__(self, live=False, tick_time=None, login=12345678, company="Dynamic Broker", server="Demo-1"):
        self.live = live
        self.tick_time = int(time.time()) if tick_time is None else tick_time
        self.login = login
        self.company = company
        self.server = server
        self.send_count = 0
        self.sent_requests = []

    def initialize(self, *args, **kwargs): return True
    def shutdown(self): return True
    def last_error(self): return (0, "ok")
    def version(self): return (500, 9999, "1 Jan 2026")
    def terminal_info(self): return Record(connected=True, trade_allowed=True, tradeapi_disabled=False)
    def account_info(self):
        return Record(login=self.login, company=self.company, server=self.server, trade_mode=2 if self.live else 0, currency="EUR", balance=10000, equity=10010, margin=100, margin_free=9910, margin_level=10010, trade_allowed=True)
    def symbols_get(self): return [Record(name="XAUUSDm"), Record(name="GBPJPY.pro")]
    def symbol_select(self, symbol, selected): return True
    def symbol_info(self, symbol): return Record(visible=True, trade_mode=1, volume_min=.01, volume_max=100, volume_step=.01, filling_mode=2, digits=2, point=.01, trade_tick_size=.01, trade_tick_value=1, trade_tick_value_profit=1, trade_tick_value_loss=1, trade_contract_size=100, trade_stops_level=10, trade_exemode=2)
    def symbol_info_tick(self, symbol): return Record(time=self.tick_time, time_msc=self.tick_time * 1000, bid=2000, ask=2000.2, last=0, volume=2, volume_real=0)
    def copy_rates_from_pos(self, symbol, timeframe, start, count):
        return (
            Record(time=self.tick_time - 3600, open=1999, high=2001, low=1998, close=2000, tick_volume=10, spread=2, real_volume=0),
        )
    def positions_get(self, **kwargs): return ()
    def orders_get(self, **kwargs): return ()
    def history_orders_get(self, start, end): return ()
    def history_deals_get(self, start=None, end=None, position=None):
        return (
            Record(ticket=1, position_id=99, entry=0, type=0, symbol="XAUUSDm", volume=.2, price=2000, time=10, time_msc=10000, profit=0, commission=-1, swap=0, fee=0),
            Record(ticket=2, position_id=99, entry=1, type=1, symbol="XAUUSDm", volume=.1, price=2010, time=20, time_msc=20000, profit=100, commission=-1, swap=0, fee=0),
            Record(ticket=3, position_id=99, entry=1, type=1, symbol="XAUUSDm", volume=.1, price=2020, time=30, time_msc=30000, profit=200, commission=-1, swap=0, fee=0),
        )
    def order_check(self, request): return Record(retcode=0, comment="ok")
    def order_send(self, request):
        self.send_count += 1
        self.sent_requests.append(request)
        return Record(retcode=10009, comment="done", order=10, deal=20)


def settings(tmp_path: Path, **updates):
    data = dict(
        bridge_api_key=SecretStr(
            "OtxBridge_9vN2!qR7#kL4$wP8@mC5-zX3_D6hJ1fB8"
        ),
        mt5_state_db=tmp_path / "state.db",
        enable_mt5_trading=True,
        allow_live_trading=False,
    )
    data.update(updates)
    return Settings(**data)


def request(request_id="request-123", volume=.1):
    return OrderRequest(requestId=request_id, symbol="XAU/USD", action="MARKET_BUY", volume=volume, confirmed=True)


def prepare(gateway, order, broker_symbol="XAUUSDm"):
    fingerprint = gateway.account_identity()["accountFingerprint"]
    gateway.execute(
        order,
        check_only=True,
        expected_account_fingerprint=fingerprint,
        expected_broker_symbol=broker_symbol,
    )
    gateway.claim_execution(
        order,
        expected_account_fingerprint=fingerprint,
        expected_broker_symbol=broker_symbol,
    )
    return fingerprint


def reserve_without_send(gateway, order, broker_request, broker_symbol="XAUUSDm"):
    fingerprint = gateway.account_identity()["accountFingerprint"]
    token, comment = gateway._execution_comment(order.requestId, order.comment)
    request_payload = {**broker_request, "comment": comment}
    gateway.idempotency.arm(
        order.requestId,
        {
            "ok": True,
            "stage": "check",
            "requestId": order.requestId,
            "brokerSymbol": broker_symbol,
        },
        request_payload,
        token,
        gateway._order_intent_digest(order),
        fingerprint,
        broker_symbol,
    )
    gateway.idempotency.claim(
        order.requestId,
        gateway._order_intent_digest(order),
        fingerprint,
        broker_symbol,
    )
    gateway.idempotency.reserve(
        order.requestId,
        request_payload,
        token,
        gateway._order_intent_digest(order),
        fingerprint,
        broker_symbol,
    )
    return fingerprint


def test_live_account_is_blocked_by_bridge(tmp_path):
    gateway = TerminalGateway(settings(tmp_path), FakeMT5(live=True))
    gateway.connect()
    with pytest.raises(PermissionError, match="LIVE TRADING DISABLED"):
        gateway.execute(request())


def test_volume_step_is_validated(tmp_path):
    gateway = TerminalGateway(settings(tmp_path), FakeMT5())
    gateway.connect()
    with pytest.raises(ValueError, match="step"):
        gateway.execute(request(volume=.105))


def test_idempotency_prevents_duplicate_order_send(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request()
    prepare(gateway, order)
    first = gateway.execute(order)
    second = gateway.execute(order)
    assert first["ok"] is True
    assert second["duplicate"] is True
    assert fake.send_count == 1
    assert fake.sent_requests[0]["comment"].startswith("OTX:")
    assert fake.sent_requests[0]["type_filling"] == fake.ORDER_FILLING_IOC
    assert "price" not in fake.sent_requests[0]


def test_modify_preserves_unspecified_existing_take_profit(tmp_path):
    class PositionMT5(FakeMT5):
        def positions_get(self, **kwargs):
            return (
                Record(
                    ticket=77,
                    symbol="XAUUSDm",
                    type=self.POSITION_TYPE_BUY,
                    volume=.5,
                    sl=1980.0,
                    tp=2020.0,
                ),
            )

    fake = PositionMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = OrderRequest(
        requestId="modify-protection-123",
        symbol="XAU/USD",
        action="MODIFY",
        volume=.1,
        stopLoss=1990.0,
        positionTicket=77,
        confirmed=True,
    )
    prepare(gateway, order)
    result = gateway.execute(
        order,
        expected_account_fingerprint=gateway.account_identity()["accountFingerprint"],
        expected_broker_symbol="XAUUSDm",
    )
    assert result["ok"] is True
    assert fake.sent_requests[0]["sl"] == 1990.0
    assert fake.sent_requests[0]["tp"] == 2020.0


def test_close_uses_full_position_volume_and_rejects_symbol_mismatch(tmp_path):
    class PositionMT5(FakeMT5):
        def __init__(self):
            super().__init__()
            self.position_symbol = "XAUUSDm"

        def positions_get(self, **kwargs):
            return (
                Record(
                    ticket=88,
                    symbol=self.position_symbol,
                    type=self.POSITION_TYPE_BUY,
                    volume=.5,
                    sl=1980.0,
                    tp=2020.0,
                ),
            )

    fake = PositionMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    close = OrderRequest(
        requestId="full-close-123",
        symbol="XAU/USD",
        action="CLOSE",
        volume=.1,
        positionTicket=88,
        confirmed=True,
    )
    prepare(gateway, close)
    result = gateway.execute(
        close,
        expected_account_fingerprint=gateway.account_identity()["accountFingerprint"],
        expected_broker_symbol="XAUUSDm",
    )
    assert result["ok"] is True
    assert fake.sent_requests[0]["volume"] == .5
    assert "price" not in fake.sent_requests[0]

    fake.position_symbol = "GBPJPY.pro"
    mismatch = OrderRequest(
        requestId="wrong-position-symbol-123",
        symbol="XAU/USD",
        action="CLOSE",
        volume=.1,
        positionTicket=88,
        confirmed=True,
    )
    with pytest.raises(ValueError, match="Position symbol"):
        gateway.execute(
            mismatch,
            expected_account_fingerprint=gateway.account_identity()["accountFingerprint"],
            expected_broker_symbol="XAUUSDm",
        )


@pytest.mark.parametrize(
    ("action", "expected_type"),
    [
        ("BUY_LIMIT", FakeMT5.ORDER_TYPE_BUY_LIMIT),
        ("SELL_LIMIT", FakeMT5.ORDER_TYPE_SELL_LIMIT),
        ("BUY_STOP", FakeMT5.ORDER_TYPE_BUY_STOP),
        ("SELL_STOP", FakeMT5.ORDER_TYPE_SELL_STOP),
    ],
)
def test_pending_order_actions_are_checked_claimed_and_sent(
    tmp_path, action, expected_type
):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    prices = {
        "BUY_LIMIT": 1990.0,
        "SELL_LIMIT": 2010.0,
        "BUY_STOP": 2010.0,
        "SELL_STOP": 1990.0,
    }
    buy = action.startswith("BUY")
    order = OrderRequest(
        requestId=f"pending-{action.lower()}-123",
        symbol="XAU/USD",
        action=action,
        volume=.1,
        price=prices[action],
        stopLoss=1980.0 if buy else 2020.0,
        takeProfit=2020.0 if buy else 1980.0,
        confirmed=True,
    )
    fingerprint = prepare(gateway, order)
    result = gateway.execute(
        order,
        expected_account_fingerprint=fingerprint,
        expected_broker_symbol="XAUUSDm",
    )
    assert result["ok"] is True
    assert fake.sent_requests[0]["action"] == fake.TRADE_ACTION_PENDING
    assert fake.sent_requests[0]["type"] == expected_type
    assert fake.sent_requests[0]["price"] == order.price
    assert fake.sent_requests[0]["type_filling"] == fake.ORDER_FILLING_RETURN


def test_cancel_pending_order_is_checked_claimed_and_sent(tmp_path):
    class PendingOrderMT5(FakeMT5):
        def orders_get(self, **kwargs):
            return (
                Record(
                    ticket=55,
                    symbol="XAUUSDm",
                    type=self.ORDER_TYPE_BUY_LIMIT,
                    volume_current=.1,
                    price_open=1990,
                    sl=1980,
                    tp=2020,
                    time_setup=1,
                    comment="",
                    magic=260919,
                ),
            )

    fake = PendingOrderMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    order = OrderRequest(
        requestId="cancel-pending-send-123",
        symbol="XAU/USD",
        action="CANCEL",
        volume=.1,
        orderTicket=55,
        confirmed=True,
    )
    fingerprint = prepare(gateway, order)
    result = gateway.execute(
        order,
        expected_account_fingerprint=fingerprint,
        expected_broker_symbol="XAUUSDm",
    )
    assert result["ok"] is True
    assert fake.sent_requests[0]["action"] == fake.TRADE_ACTION_REMOVE
    assert fake.sent_requests[0]["order"] == 55


def test_partial_close_is_checked_claimed_and_sent(tmp_path):
    class OpenPositionMT5(FakeMT5):
        def positions_get(self, **kwargs):
            return (
                Record(
                    ticket=88,
                    symbol="XAUUSDm",
                    type=self.POSITION_TYPE_BUY,
                    volume=.5,
                    price_open=1990,
                    price_current=2000,
                    sl=1980,
                    tp=2020,
                    profit=50,
                    time=1,
                ),
            )

    fake = OpenPositionMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    order = OrderRequest(
        requestId="partial-close-send-123",
        symbol="XAU/USD",
        action="PARTIAL_CLOSE",
        volume=.2,
        positionTicket=88,
        confirmed=True,
    )
    fingerprint = prepare(gateway, order)
    result = gateway.execute(
        order,
        expected_account_fingerprint=fingerprint,
        expected_broker_symbol="XAUUSDm",
    )
    assert result["ok"] is True
    assert fake.sent_requests[0]["action"] == fake.TRADE_ACTION_DEAL
    assert fake.sent_requests[0]["position"] == 88
    assert fake.sent_requests[0]["type"] == fake.ORDER_TYPE_SELL
    assert fake.sent_requests[0]["volume"] == .2


def test_idempotency_rejects_same_id_with_changed_order_content(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    first = request("content-bound-123", volume=.1)
    prepare(gateway, first)
    gateway.execute(first)
    with pytest.raises(ValueError, match="different order content"):
        gateway.execute(request("content-bound-123", volume=.2))
    assert fake.send_count == 1


def test_reserved_request_is_reconciled_from_broker_history_without_resend(tmp_path):
    class ReconcileMT5(FakeMT5):
        def __init__(self):
            super().__init__()
            self.token = ""

        def history_deals_get(self, start, end):
            return (
                Record(
                    ticket=20,
                    order=10,
                    position_id=10,
                    entry=0,
                    type=0,
                    symbol="XAUUSDm",
                    volume=.1,
                    price=2000,
                    time=int(time.time()),
                    time_msc=int(time.time() * 1000),
                    profit=0,
                    commission=0,
                    swap=0,
                    fee=0,
                    magic=260919,
                    comment=f"OTX:{self.token}",
                ),
            )

    fake = ReconcileMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("restart-safe-123")
    token, comment = gateway._execution_comment(order.requestId, order.comment)
    fake.token = token
    gateway.idempotency.arm(
        order.requestId,
        {"ok": True, "stage": "check", "requestId": order.requestId, "brokerSymbol": "XAUUSDm"},
        {"symbol": "XAUUSDm", "comment": comment},
        token,
        gateway._order_intent_digest(order),
        gateway.account_identity()["accountFingerprint"],
        "XAUUSDm",
    )
    gateway.idempotency.claim(
        order.requestId,
        gateway._order_intent_digest(order),
        gateway.account_identity()["accountFingerprint"],
        "XAUUSDm",
    )
    gateway.idempotency.reserve(
        order.requestId,
        {"symbol": "XAUUSDm", "comment": comment},
        token,
        gateway._order_intent_digest(order),
        gateway.account_identity()["accountFingerprint"],
        "XAUUSDm",
    )
    result = gateway.reconcile()
    duplicate = gateway.execute(order)
    assert len(result["resolvedRequests"]) == 1
    assert duplicate["duplicate"] is True
    assert duplicate["reconciled"] is True
    assert fake.send_count == 0


def test_reserved_modify_reconciles_from_exact_position_state_without_resend(tmp_path):
    class ModifiedPositionMT5(FakeMT5):
        def positions_get(self, **kwargs):
            return (
                Record(
                    ticket=77,
                    symbol="XAUUSDm",
                    type=self.POSITION_TYPE_BUY,
                    volume=.5,
                    sl=1990.0,
                    tp=2020.0,
                ),
            )

    fake = ModifiedPositionMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = OrderRequest(
        requestId="modify-reconcile-123",
        symbol="XAU/USD",
        action="MODIFY",
        volume=.1,
        stopLoss=1990.0,
        takeProfit=2020.0,
        positionTicket=77,
        confirmed=True,
    )
    reserve_without_send(
        gateway,
        order,
        {
            "action": fake.TRADE_ACTION_SLTP,
            "position": 77,
            "symbol": "XAUUSDm",
            "sl": 1990.0,
            "tp": 2020.0,
        },
    )

    result = gateway.reconcile()
    lookup = gateway.execution_result(order.requestId)

    assert len(result["resolvedRequests"]) == 1
    assert lookup["resolved"] is True
    assert lookup["result"]["stage"] == "reconciled_management"
    assert lookup["result"]["position"] == 77
    assert fake.send_count == 0


def test_reserved_cancel_requires_exact_terminal_broker_history(tmp_path):
    class CancelledOrderMT5(FakeMT5):
        def history_orders_get(self, start, end):
            return (
                Record(
                    ticket=55,
                    symbol="XAUUSDm",
                    state=self.ORDER_STATE_CANCELED,
                    magic=0,
                    comment="broker cancellation record",
                ),
            )

    fake = CancelledOrderMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = OrderRequest(
        requestId="cancel-reconcile-123",
        symbol="XAU/USD",
        action="CANCEL",
        volume=.1,
        orderTicket=55,
        confirmed=True,
    )
    reserve_without_send(
        gateway,
        order,
        {
            "action": fake.TRADE_ACTION_REMOVE,
            "order": 55,
            "symbol": "XAUUSDm",
        },
    )

    result = gateway.reconcile()
    lookup = gateway.execution_result(order.requestId)

    assert len(result["resolvedRequests"]) == 1
    assert lookup["resolved"] is True
    assert lookup["result"]["ok"] is True
    assert lookup["result"]["order"] == 55
    assert fake.send_count == 0


def test_reserved_cancel_without_exact_history_stays_manual_review(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(
        settings(tmp_path, mt5_reconcile_grace_seconds=5), fake
    )
    gateway.connect()
    order = OrderRequest(
        requestId="cancel-unproven-123",
        symbol="XAU/USD",
        action="CANCEL",
        volume=.1,
        orderTicket=56,
        confirmed=True,
    )
    reserve_without_send(
        gateway,
        order,
        {
            "action": fake.TRADE_ACTION_REMOVE,
            "order": 56,
            "symbol": "XAUUSDm",
        },
    )

    result = gateway.reconcile()

    assert result["resolvedRequests"] == []
    assert result["unresolvedRequests"][0]["state"] == "MANUAL_REVIEW"
    assert fake.send_count == 0


def test_reserved_request_never_reconciles_against_another_mt5_account(tmp_path):
    class SwitchedAccountMT5(FakeMT5):
        def __init__(self):
            super().__init__()
            self.token = ""

        def history_deals_get(self, start, end):
            return (
                Record(
                    ticket=90,
                    order=80,
                    position_id=80,
                    symbol="XAUUSDm",
                    magic=260919,
                    comment=f"OTX:{self.token}",
                ),
            )

    fake = SwitchedAccountMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("account-switch-reconcile-123")
    token, _ = gateway._execution_comment(order.requestId, order.comment)
    fake.token = token
    reserve_without_send(
        gateway,
        order,
        {
            "action": fake.TRADE_ACTION_DEAL,
            "symbol": "XAUUSDm",
            "type": fake.ORDER_TYPE_BUY,
            "volume": .1,
        },
    )
    fake.login = 87654321

    result = gateway.reconcile()

    assert result["resolvedRequests"] == []
    assert result["unresolvedRequests"][0]["state"] == "ACCOUNT_MISMATCH"
    assert fake.send_count == 0


def test_broker_check_arms_exact_request_without_sending(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("armed-check-123")
    result = gateway.execute(order, check_only=True)
    lookup = gateway.idempotency.lookup(order.requestId)
    assert result["ok"] is True
    assert lookup["state"] == "ARMED"
    assert fake.send_count == 0


def test_reconciliation_cancels_armed_preflight_before_delayed_claim(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("armed-cancel-123")
    gateway.execute(order, check_only=True)
    lookup = gateway.execution_result(order.requestId)
    repeated_lookup = gateway.execution_result(order.requestId)
    assert lookup["state"] == "CANCELLED"
    assert lookup["resolved"] is True
    assert lookup["result"]["stage"] == "preflight_cancelled"
    assert lookup["result"]["notSent"] is True
    assert repeated_lookup["state"] == "CANCELLED"
    assert repeated_lookup["resolved"] is True
    with pytest.raises(ValueError, match="exact broker preflight"):
        gateway.claim_execution(order)
    assert fake.send_count == 0


def test_execute_transitions_armed_request_and_remains_idempotent(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("armed-send-123")
    gateway.execute(order, check_only=True)
    gateway.claim_execution(order)
    first = gateway.execute(order)
    second = gateway.execute(order)
    lookup = gateway.execution_result(order.requestId)
    assert first["ok"] is True
    assert second["duplicate"] is True
    assert lookup["state"] == "COMPLETED"
    assert lookup["result"]["order"] == 10
    assert fake.send_count == 1


def test_execute_requires_durable_broker_preflight_and_claim(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    with pytest.raises(ValueError, match="preflight and execution claim"):
        gateway.execute(request("no-preflight-123"))
    order = request("armed-not-claimed-123")
    gateway.execute(order, check_only=True)
    with pytest.raises(ValueError, match="execution claim is required"):
        gateway.execute(order)
    assert fake.send_count == 0


def test_reconciliation_cancels_claim_before_delayed_execute_can_send(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("claimed-cancel-123")
    prepare(gateway, order)
    lookup = gateway.execution_result(order.requestId)
    repeated_lookup = gateway.execution_result(order.requestId)
    delayed = gateway.execute(order)
    assert lookup["state"] == "CANCELLED"
    assert lookup["resolved"] is True
    assert lookup["result"]["notSent"] is True
    assert repeated_lookup["state"] == "CANCELLED"
    assert repeated_lookup["resolved"] is True
    assert repeated_lookup["result"]["notSent"] is True
    assert delayed["duplicate"] is True
    assert delayed["notSent"] is True
    assert fake.send_count == 0


def test_missing_execution_state_stays_fail_closed(tmp_path):
    gateway = TerminalGateway(settings(tmp_path), FakeMT5())
    gateway.connect()
    lookup = gateway.execution_result("missing-request-123")
    assert lookup["state"] == "NOT_FOUND"
    assert lookup["resolved"] is False
    assert lookup["reconciliationState"] == "MANUAL_REVIEW"


def test_stale_tick_is_not_reported_connected(tmp_path, monkeypatch):
    fake = FakeMT5(tick_time=1)
    gateway = TerminalGateway(settings(tmp_path, mt5_stale_after_seconds=5), fake)
    gateway.connect()
    assert gateway.tick("XAU/USD")["state"] == "STALE"


def test_stale_tick_blocks_order_send(tmp_path):
    fake = FakeMT5(tick_time=1)
    gateway = TerminalGateway(settings(tmp_path, mt5_stale_after_seconds=5), fake)
    gateway.connect()
    with pytest.raises(ValueError, match="stale"):
        gateway.execute(request())
    assert fake.send_count == 0


def test_reconnect_after_disconnected_flag(tmp_path):
    gateway = TerminalGateway(settings(tmp_path), FakeMT5())
    gateway.connected = False
    assert gateway.account()["connection"] == "CONNECTED"


def test_trade_history_groups_partial_closes_without_duplicating_trade(tmp_path):
    gateway = TerminalGateway(settings(tmp_path), FakeMT5())
    gateway.connect()
    history = gateway.trade_history()
    assert len(history) == 1
    assert history[0]["positionTicket"] == 99
    assert history[0]["symbol"] == "XAU/USD"
    assert history[0]["brokerSymbol"] == "XAUUSDm"
    assert history[0]["status"] == "Closed"
    assert history[0]["exitPrice"] == 2015
    assert history[0]["profitLoss"] == 297


def test_trade_history_fetches_opening_leg_outside_requested_window(tmp_path):
    class LongHeldTradeMT5(FakeMT5):
        def history_deals_get(self, start=None, end=None, position=None):
            opening = Record(
                ticket=101,
                position_id=777,
                entry=self.DEAL_ENTRY_IN,
                type=self.DEAL_TYPE_BUY,
                symbol="XAUUSDm",
                volume=.2,
                price=1900,
                time=1,
                time_msc=1000,
                profit=0,
                commission=-1,
                swap=0,
                fee=0,
            )
            closing = Record(
                ticket=102,
                position_id=777,
                entry=self.DEAL_ENTRY_OUT,
                type=self.ORDER_TYPE_SELL,
                symbol="XAUUSDm",
                volume=.2,
                price=2000,
                time=2,
                time_msc=2000,
                profit=200,
                commission=-1,
                swap=0,
                fee=0,
            )
            return (opening, closing) if position == 777 else (closing,)

    gateway = TerminalGateway(settings(tmp_path), LongHeldTradeMT5())
    assert gateway.connect() is True
    history = gateway.trade_history(30)
    assert len(history) == 1
    assert history[0]["positionTicket"] == 777
    assert history[0]["direction"] == "BUY"
    assert history[0]["entryPrice"] == 1900
    assert history[0]["entryTime"] == 1000
    assert history[0]["exitPrice"] == 2000
    assert history[0]["status"] == "Closed"


def test_trade_history_rejects_incomplete_position_chain(tmp_path):
    class IncompleteHistoryMT5(FakeMT5):
        def history_deals_get(self, start=None, end=None, position=None):
            return (
                Record(
                    ticket=202,
                    position_id=888,
                    entry=self.DEAL_ENTRY_OUT,
                    type=self.ORDER_TYPE_SELL,
                    symbol="XAUUSDm",
                    volume=.1,
                    price=2000,
                    time=2,
                    time_msc=2000,
                    profit=10,
                    commission=0,
                    swap=0,
                    fee=0,
                ),
            )

    gateway = TerminalGateway(settings(tmp_path), IncompleteHistoryMT5())
    assert gateway.connect() is True
    with pytest.raises(MT5Unavailable, match="history for position 888 is incomplete"):
        gateway.trade_history(30)


def test_manual_symbol_mapping_survives_bridge_restart(tmp_path):
    config = settings(tmp_path)
    first = TerminalGateway(config, FakeMT5())
    first.connect()
    first.set_mapping(
        "XAU/USD",
        "XAUUSDm",
        first.account_identity()["accountFingerprint"],
    )
    second = TerminalGateway(config, FakeMT5())
    second.connect()
    assert second.resolve("XAU/USD") == "XAUUSDm"
    assert "XAU/USD" in second.manual_mappings


def test_manual_symbol_mapping_does_not_cross_mt5_accounts(tmp_path):
    config = settings(tmp_path)
    first = TerminalGateway(config, FakeMT5(login=12345678))
    first.connect()
    first.set_mapping(
        "XAU/USD",
        "XAUUSDm",
        first.account_identity()["accountFingerprint"],
    )
    switched = TerminalGateway(config, FakeMT5(login=87654321))
    switched.connect()
    assert "XAU/USD" not in switched.manual_mappings
    assert first.account_scope != switched.account_scope


def test_symbol_mapping_rejects_account_switch_and_refreshes_scope(tmp_path):
    fake = FakeMT5(login=12345678)
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    first_fingerprint = gateway.account_identity()["accountFingerprint"]
    gateway.set_mapping("XAU/USD", "XAUUSDm", first_fingerprint)

    fake.login = 87654321
    with pytest.raises(PermissionError, match="account changed"):
        gateway.set_mapping("GBP/JPY", "GBPJPY.pro", first_fingerprint)

    second_fingerprint = gateway.account_identity()["accountFingerprint"]
    gateway.set_mapping("GBP/JPY", "GBPJPY.pro", second_fingerprint)
    assert gateway.account_scope == second_fingerprint
    assert gateway.manual_mappings == {"GBP/JPY"}


def test_candle_id_never_contains_login_or_account_fingerprint(tmp_path):
    fake = FakeMT5(login=12345678)
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    fingerprint = gateway.account_identity()["accountFingerprint"]
    candle = gateway.candles("XAU/USD", "1h", 10)[0]
    assert "12345678" not in candle.candleId
    assert fingerprint not in candle.candleId


def test_symbol_spec_uses_broker_values(tmp_path):
    gateway = TerminalGateway(settings(tmp_path), FakeMT5())
    gateway.connect()
    spec = gateway.symbol_spec("XAU/USD")
    assert spec["brokerSymbol"] == "XAUUSDm"
    assert spec["tickSize"] == .01
    assert spec["tickValueLoss"] == 1
    assert spec["volumeStep"] == .01


def test_account_fingerprint_is_stable_opaque_and_server_only(tmp_path):
    gateway = TerminalGateway(settings(tmp_path), FakeMT5())
    gateway.connect()
    public = gateway.account()
    first = gateway.account_identity()
    second = gateway.account_identity()
    assert "accountFingerprint" not in public
    assert public["account"] == "****5678"
    assert first["accountFingerprint"] == second["accountFingerprint"]
    assert len(first["accountFingerprint"]) == 64
    assert "12345678" not in first["accountFingerprint"]


def test_account_fingerprint_uses_full_login_broker_and_server(tmp_path):
    base = TerminalGateway(settings(tmp_path / "base"), FakeMT5())
    same_last_four = TerminalGateway(
        settings(tmp_path / "login"), FakeMT5(login=87655678)
    )
    other_broker = TerminalGateway(
        settings(tmp_path / "broker"), FakeMT5(company="Other Broker")
    )
    other_server = TerminalGateway(
        settings(tmp_path / "server"), FakeMT5(server="Demo-2")
    )
    fingerprints = []
    for gateway in (base, same_last_four, other_broker, other_server):
        gateway.connect()
        fingerprints.append(gateway.account_identity()["accountFingerprint"])
    assert len(set(fingerprints)) == 4


def test_auto_expected_fingerprint_blocks_same_last_four_account_switch(tmp_path):
    first = TerminalGateway(settings(tmp_path / "first"), FakeMT5())
    switched_module = FakeMT5(login=87655678)
    switched = TerminalGateway(settings(tmp_path / "switched"), switched_module)
    first.connect()
    switched.connect()
    expected = first.account_identity()["accountFingerprint"]
    with pytest.raises(PermissionError, match="account changed"):
        switched.execute(
            request("account-switch-123"),
            expected_account_fingerprint=expected,
        )
    assert switched_module.send_count == 0


def test_expected_broker_symbol_blocks_mapping_change_before_send(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    with pytest.raises(PermissionError, match="symbol mapping changed"):
        gateway.execute(
            request("mapping-switch-123"),
            expected_account_fingerprint=gateway.account_identity()["accountFingerprint"],
            expected_broker_symbol="XAUUSD.pro",
        )
    assert fake.send_count == 0


def test_expected_broker_symbol_allows_exact_resolved_symbol(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("mapping-exact-123")
    fingerprint = prepare(gateway, order)
    result = gateway.execute(
        order,
        expected_account_fingerprint=fingerprint,
        expected_broker_symbol="XAUUSDm",
    )
    assert result["ok"] is True
    assert result["brokerSymbol"] == "XAUUSDm"
    assert fake.send_count == 1


def test_partial_fill_is_irreversible_success_and_remains_idempotent(tmp_path):
    fake = FakeMT5()
    fake.order_send = lambda request: Record(
        retcode=fake.TRADE_RETCODE_DONE_PARTIAL,
        comment="partial fill",
        order=10,
        deal=20,
        price=2000.0,
        volume=0.04,
    )
    gateway = TerminalGateway(settings(tmp_path), fake)
    gateway.connect()
    order = request("partial-fill-123")
    fingerprint = prepare(gateway, order)
    first = gateway.execute(
        order,
        expected_account_fingerprint=fingerprint,
        expected_broker_symbol="XAUUSDm",
    )
    second = gateway.execute(
        order,
        expected_account_fingerprint=gateway.account_identity()["accountFingerprint"],
        expected_broker_symbol="XAUUSDm",
    )
    assert first["ok"] is True
    assert first["retcode"] == fake.TRADE_RETCODE_DONE_PARTIAL
    assert second["ok"] is True
    assert second["duplicate"] is True


@pytest.mark.parametrize(
    ("operation", "invoke"),
    [
        ("positions_get", lambda gateway: gateway.positions()),
        ("orders_get", lambda gateway: gateway.orders()),
        (
            "copy_rates_from_pos",
            lambda gateway: gateway.candles("XAU/USD", "30m", 20),
        ),
        ("history_deals_get", lambda gateway: gateway.trade_history()),
    ],
)
def test_none_market_and_portfolio_results_fail_closed(
    tmp_path, operation, invoke
):
    class NoneResultMT5(FakeMT5):
        def positions_get(self, **kwargs):
            return None if operation == "positions_get" else super().positions_get(**kwargs)

        def orders_get(self, **kwargs):
            return None if operation == "orders_get" else super().orders_get(**kwargs)

        def copy_rates_from_pos(self, symbol, timeframe, start, count):
            if operation == "copy_rates_from_pos":
                return None
            return super().copy_rates_from_pos(symbol, timeframe, start, count)

        def history_deals_get(self, start=None, end=None, position=None):
            if operation == "history_deals_get":
                return None
            return super().history_deals_get(start, end, position)

    gateway = TerminalGateway(settings(tmp_path), NoneResultMT5())
    assert gateway.connect() is True
    with pytest.raises(MT5Unavailable, match="broker data is unavailable"):
        invoke(gateway)
    assert operation in (gateway.last_error or "")


def test_none_reconciliation_snapshot_never_means_zero_exposure(tmp_path):
    class FailedPositionsMT5(FakeMT5):
        def positions_get(self, **kwargs):
            return None

    gateway = TerminalGateway(settings(tmp_path), FailedPositionsMT5())
    assert gateway.connect() is True
    with pytest.raises(MT5Unavailable, match="positions_get"):
        gateway.reconcile()


def test_none_symbol_inventory_prevents_ready_connection(tmp_path):
    class FailedSymbolsMT5(FakeMT5):
        def symbols_get(self):
            return None

    gateway = TerminalGateway(settings(tmp_path), FailedSymbolsMT5())
    assert gateway.connect() is False
    assert "symbols_get" in (gateway.last_error or "")


def test_unresolved_bridge_request_blocks_every_different_order(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    first = request("global-ledger-lock-1")
    gateway.execute(
        first,
        check_only=True,
        expected_account_fingerprint=gateway.account_identity()[
            "accountFingerprint"
        ],
        expected_broker_symbol="XAUUSDm",
    )

    with pytest.raises(PermissionError, match="Another MT5 execution is unresolved"):
        gateway.execute(
            request("global-ledger-lock-2"),
            check_only=True,
            expected_account_fingerprint=gateway.account_identity()[
                "accountFingerprint"
            ],
            expected_broker_symbol="XAUUSDm",
        )
    assert fake.send_count == 0


def test_reconcile_terminalizes_abandoned_unsent_preflight(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(
        settings(tmp_path, mt5_preflight_grace_seconds=5), fake
    )
    assert gateway.connect() is True
    order = request("abandoned-preflight-1")
    gateway.execute(
        order,
        check_only=True,
        expected_account_fingerprint=gateway.account_identity()[
            "accountFingerprint"
        ],
        expected_broker_symbol="XAUUSDm",
    )
    with gateway.idempotency.connection:
        gateway.idempotency.connection.execute(
            "update execution_requests set created_at=datetime('now','-1 minute') where request_id=?",
            (order.requestId,),
        )

    reconciled = gateway.reconcile()
    assert any(
        item.get("requestId") == order.requestId and item.get("notSent") is True
        for item in reconciled["resolvedRequests"]
    )
    assert gateway.idempotency.lookup(order.requestId)["state"] == "CANCELLED"
    assert fake.send_count == 0


def test_reconcile_preserves_fresh_manual_preflight_window(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(
        settings(tmp_path, mt5_preflight_grace_seconds=90), fake
    )
    assert gateway.connect() is True
    order = request("fresh-preflight-window-1")
    gateway.execute(
        order,
        check_only=True,
        expected_account_fingerprint=gateway.account_identity()[
            "accountFingerprint"
        ],
        expected_broker_symbol="XAUUSDm",
    )

    reconciled = gateway.reconcile()
    assert gateway.idempotency.lookup(order.requestId)["state"] == "ARMED"
    assert any(
        item.get("requestId") == order.requestId
        for item in reconciled["unresolvedRequests"]
    )
    assert fake.send_count == 0


def test_account_snapshot_returns_one_exact_account_scoped_broker_view(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    fingerprint = gateway.account_identity()["accountFingerprint"]

    snapshot = gateway.account_snapshot(fingerprint, "XAU/USD")

    assert snapshot["account"]["accountFingerprint"] == fingerprint
    assert snapshot["positions"] == []
    assert snapshot["orders"] == []
    assert snapshot["symbol"]["tick"]["brokerSymbol"] == "XAUUSDm"
    assert snapshot["symbol"]["spec"]["brokerSymbol"] == "XAUUSDm"
    assert snapshot["capturedAt"] > 0


def test_account_snapshot_discards_a_to_b_to_a_mixed_portfolio(tmp_path):
    class AccountSwitchMT5(FakeMT5):
        def __init__(self):
            super().__init__(login=11111111)
            self.orders_reads = 0

        def positions_get(self, **kwargs):
            # Simulate an external terminal login switch during the first
            # broker read. A later orders read would switch back to A, but the
            # identity checkpoint must fail before that mixed view is built.
            self.login = 22222222
            return ()

        def orders_get(self, **kwargs):
            self.orders_reads += 1
            self.login = 11111111
            return ()

    fake = AccountSwitchMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    fingerprint = gateway.account_identity()["accountFingerprint"]

    with pytest.raises(MT5Unavailable, match="mixed account data was discarded"):
        gateway.account_snapshot(fingerprint, "XAU/USD")

    assert fake.orders_reads == 0


def test_account_snapshot_rejects_wrong_expected_account_before_data_reads(tmp_path):
    class CountingMT5(FakeMT5):
        def __init__(self):
            super().__init__()
            self.positions_reads = 0

        def positions_get(self, **kwargs):
            self.positions_reads += 1
            return ()

    fake = CountingMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True

    with pytest.raises(PermissionError, match="does not match"):
        gateway.account_snapshot("b" * 64, "XAU/USD")

    assert fake.positions_reads == 0


def test_candle_bundle_returns_one_exact_symbol_multi_timeframe_view(tmp_path):
    fake = FakeMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    fingerprint = gateway.account_identity()["accountFingerprint"]

    bundle = gateway.candle_bundle(
        fingerprint,
        "XAU/USD",
        ["30m", "1h", "4h"],
        20,
    )

    assert bundle["account"]["accountFingerprint"] == fingerprint
    assert bundle["symbol"]["brokerSymbol"] == "XAUUSDm"
    assert bundle["symbol"]["tick"]["brokerSymbol"] == "XAUUSDm"
    assert bundle["symbol"]["spec"]["brokerSymbol"] == "XAUUSDm"
    assert bundle["requestedTimeframes"] == ["30m", "1h", "4h"]
    assert set(bundle["timeframes"]) == {"30m", "1h", "4h"}
    for candles in bundle["timeframes"].values():
        assert [candle.time for candle in candles] == sorted(
            candle.time for candle in candles
        )
        assert all(candle.candleId.startswith("12345678") is False for candle in candles)


def test_candle_bundle_discards_a_to_b_to_a_mixed_timeframes(tmp_path):
    class AccountSwitchMT5(FakeMT5):
        def __init__(self):
            super().__init__(login=11111111)
            self.rate_reads = 0

        def copy_rates_from_pos(self, symbol, timeframe, start, count):
            self.rate_reads += 1
            if self.rate_reads == 1:
                # A later read would switch back to A. The checkpoint after
                # this first timeframe must reject the bundle before it can
                # combine A/B/A data.
                self.login = 22222222
            else:
                self.login = 11111111
            return super().copy_rates_from_pos(symbol, timeframe, start, count)

    fake = AccountSwitchMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True
    fingerprint = gateway.account_identity()["accountFingerprint"]

    with pytest.raises(MT5Unavailable, match="mixed account data was discarded"):
        gateway.candle_bundle(
            fingerprint,
            "XAU/USD",
            ["30m", "1h", "4h"],
            20,
        )

    assert fake.rate_reads == 1


def test_candle_bundle_rejects_wrong_account_before_market_reads(tmp_path):
    class CountingMT5(FakeMT5):
        def __init__(self):
            super().__init__()
            self.tick_reads = 0
            self.rate_reads = 0

        def symbol_info_tick(self, symbol):
            self.tick_reads += 1
            return super().symbol_info_tick(symbol)

        def copy_rates_from_pos(self, symbol, timeframe, start, count):
            self.rate_reads += 1
            return super().copy_rates_from_pos(symbol, timeframe, start, count)

    fake = CountingMT5()
    gateway = TerminalGateway(settings(tmp_path), fake)
    assert gateway.connect() is True

    with pytest.raises(PermissionError, match="does not match"):
        gateway.candle_bundle(
            "b" * 64,
            "XAU/USD",
            ["30m", "1h", "4h"],
            20,
        )

    assert fake.tick_reads == 0
    assert fake.rate_reads == 0
