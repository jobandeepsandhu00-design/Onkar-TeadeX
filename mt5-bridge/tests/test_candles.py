from mt5_bridge.candles import normalize_rates


def row(time, open_, high, low, close):
    return {
        "time": time,
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "tick_volume": 10,
        "spread": 2,
        "real_volume": 0,
    }


def test_candles_are_unique_oldest_first_and_closed_by_broker_time():
    rows = [row(1800, 2, 3, 1, 2.5), row(0, 1, 2, .5, 1.5), row(1800, 2, 4, 1, 3)]
    candles = normalize_rates("1234", "XAUUSDm", "30m", rows, 2000)
    assert [c.time for c in candles] == [0, 1800]
    assert candles[0].isClosed is True
    assert candles[1].isClosed is False
    assert candles[1].high == 4
    assert candles[1].candleId == "1234:XAUUSDm:30m:1800"

