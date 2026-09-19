from pathlib import Path
from types import SimpleNamespace
import pytest
from pydantic import SecretStr
from mt5_bridge.config import Settings
from mt5_bridge.models import OrderRequest
from mt5_bridge.terminal import TerminalGateway


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
    ORDER_TIME_GTC = 0
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_PLACED = 10008
    DEAL_ENTRY_IN = 0
    DEAL_ENTRY_OUT = 1
    DEAL_ENTRY_INOUT = 2
    DEAL_ENTRY_OUT_BY = 3
    DEAL_TYPE_BUY = 0

    def __init__(self, live=False, tick_time=100):
        self.live = live
        self.tick_time = tick_time
        self.send_count = 0

    def initialize(self, *args, **kwargs): return True
    def shutdown(self): return True
    def last_error(self): return (0, "ok")
    def terminal_info(self): return Record(connected=True, trade_allowed=True)
    def account_info(self):
        return Record(login=12345678, company="Dynamic Broker", server="Demo-1", trade_mode=2 if self.live else 0, currency="EUR", balance=10000, equity=10010, margin=100, margin_free=9910, margin_level=10010, trade_allowed=True)
    def symbols_get(self): return [Record(name="XAUUSDm"), Record(name="GBPJPY.pro")]
    def symbol_select(self, symbol, selected): return True
    def symbol_info(self, symbol): return Record(visible=True, trade_mode=1, volume_min=.01, volume_max=100, volume_step=.01, filling_mode=0)
    def symbol_info_tick(self, symbol): return Record(time=self.tick_time, time_msc=self.tick_time * 1000, bid=2000, ask=2000.2, last=0, volume=2, volume_real=0)
    def positions_get(self): return ()
    def orders_get(self): return ()
    def history_deals_get(self, start, end):
        return (
            Record(ticket=1, position_id=99, entry=0, type=0, symbol="XAUUSDm", volume=.2, price=2000, time=10, time_msc=10000, profit=0, commission=-1, swap=0, fee=0),
            Record(ticket=2, position_id=99, entry=1, type=1, symbol="XAUUSDm", volume=.1, price=2010, time=20, time_msc=20000, profit=100, commission=-1, swap=0, fee=0),
            Record(ticket=3, position_id=99, entry=1, type=1, symbol="XAUUSDm", volume=.1, price=2020, time=30, time_msc=30000, profit=200, commission=-1, swap=0, fee=0),
        )
    def order_check(self, request): return Record(retcode=0, comment="ok")
    def order_send(self, request):
        self.send_count += 1
        return Record(retcode=10009, comment="done", order=10, deal=20)


def settings(tmp_path: Path, **updates):
    data = dict(bridge_api_key=SecretStr("x" * 32), mt5_state_db=tmp_path / "state.db", enable_mt5_trading=True, allow_live_trading=False)
    data.update(updates)
    return Settings(**data)


def request(request_id="request-123", volume=.1):
    return OrderRequest(requestId=request_id, symbol="XAU/USD", action="MARKET_BUY", volume=volume, confirmed=True)


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
    first = gateway.execute(request())
    second = gateway.execute(request())
    assert first["ok"] is True
    assert second["duplicate"] is True
    assert fake.send_count == 1


def test_stale_tick_is_not_reported_connected(tmp_path, monkeypatch):
    fake = FakeMT5(tick_time=1)
    gateway = TerminalGateway(settings(tmp_path, mt5_stale_after_seconds=5), fake)
    gateway.connect()
    assert gateway.tick("XAU/USD")["state"] == "STALE"


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
    assert history[0]["status"] == "Closed"
    assert history[0]["exitPrice"] == 2015
    assert history[0]["profitLoss"] == 297


def test_manual_symbol_mapping_survives_bridge_restart(tmp_path):
    config = settings(tmp_path)
    first = TerminalGateway(config, FakeMT5())
    first.connect()
    first.set_mapping("XAU/USD", "XAUUSDm")
    second = TerminalGateway(config, FakeMT5())
    second.connect()
    assert second.resolve("XAU/USD") == "XAUUSDm"
    assert "XAU/USD" in second.manual_mappings
