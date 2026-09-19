from mt5_bridge.symbols import discover_symbol, discover_watchlist


def test_exact_and_suffixed_symbols_are_broker_independent():
    symbols = ["EURUSD.pro", "GBPJPYm", "GOLD", "XAUUSD.a", "RANDOM"]
    assert discover_symbol("EUR/USD", symbols).broker == "EURUSD.pro"
    assert discover_symbol("GBP/JPY", symbols).broker == "GBPJPYm"
    assert discover_symbol("XAU/USD", symbols).broker in {"GOLD", "XAUUSD.a"}


def test_uncertain_symbol_is_not_invented():
    match = discover_symbol("USD/CAD", ["BTCUSD", "ETHUSD"])
    assert match.broker is None
    assert match.confidence == 0


def test_watchlist_discovers_each_symbol_independently():
    result = discover_watchlist(["EURUSD", "GBPUSDx", "USDJPYm", "GOLD"])
    assert result["EUR/USD"].broker == "EURUSD"
    assert result["XAU/USD"].broker == "GOLD"

