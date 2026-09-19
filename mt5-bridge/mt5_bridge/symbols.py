import re
from dataclasses import dataclass

WATCHLIST = (
    "EUR/USD", "GBP/USD", "USD/JPY", "GBP/JPY", "EUR/JPY",
    "AUD/USD", "USD/CAD", "NZD/USD", "EUR/GBP", "XAU/USD",
)


def canonical(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


ALIASES = {"XAUUSD": ("XAUUSD", "GOLD")}


@dataclass(frozen=True)
class SymbolMatch:
    internal: str
    broker: str | None
    confidence: float
    candidates: tuple[str, ...]


def _score(internal: str, broker: str) -> float:
    target = canonical(internal)
    candidate = canonical(broker)
    aliases = ALIASES.get(target, (target,))
    best = 0.0
    for alias in aliases:
        if candidate == alias:
            best = max(best, 1.0)
        elif candidate.startswith(alias) or candidate.endswith(alias):
            extra = abs(len(candidate) - len(alias))
            best = max(best, max(0.72, 0.96 - extra * 0.035))
        elif alias in candidate:
            best = max(best, 0.68)
    return best


def discover_symbol(internal: str, broker_symbols: list[str]) -> SymbolMatch:
    ranked = sorted(
        ((name, _score(internal, name)) for name in broker_symbols),
        key=lambda row: (-row[1], len(row[0]), row[0]),
    )
    candidates = tuple(name for name, score in ranked if score >= 0.6)[:5]
    if not ranked or ranked[0][1] < 0.6:
        return SymbolMatch(internal, None, 0.0, candidates)
    return SymbolMatch(internal, ranked[0][0], ranked[0][1], candidates)


def discover_watchlist(broker_symbols: list[str]) -> dict[str, SymbolMatch]:
    return {name: discover_symbol(name, broker_symbols) for name in WATCHLIST}

