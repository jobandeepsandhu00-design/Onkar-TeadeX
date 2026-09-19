from .models import Candle

TIMEFRAME_SECONDS = {"15m": 900, "30m": 1800, "1h": 3600, "4h": 14400}


def normalize_rates(account: str, broker_symbol: str, timeframe: str, rows, now: int) -> list[Candle]:
    interval = TIMEFRAME_SECONDS[timeframe]
    unique = {}
    for row in rows or []:
        source = row._asdict() if hasattr(row, "_asdict") else dict(row)
        opened = int(source["time"])
        unique[opened] = Candle(
            time=opened,
            open=float(source["open"]),
            high=float(source["high"]),
            low=float(source["low"]),
            close=float(source["close"]),
            tick_volume=float(source.get("tick_volume", 0)),
            spread=int(source.get("spread", 0)),
            real_volume=float(source.get("real_volume", 0)),
            isClosed=opened + interval <= now,
            candleId=f"{account}:{broker_symbol}:{timeframe}:{opened}",
        )
    return [unique[key] for key in sorted(unique)]

