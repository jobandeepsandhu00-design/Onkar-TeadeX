from typing import Literal
from pydantic import BaseModel, Field

Timeframe = Literal["15m", "30m", "1h", "4h"]
Direction = Literal["BUY", "SELL"]


class Candle(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    tick_volume: float
    spread: int
    real_volume: float
    isClosed: bool
    candleId: str


class OrderRequest(BaseModel):
    requestId: str = Field(min_length=8, max_length=120, pattern=r"^[A-Za-z0-9:_-]+$")
    symbol: str = Field(min_length=3, max_length=24)
    action: Literal[
        "MARKET_BUY", "MARKET_SELL", "BUY_LIMIT", "SELL_LIMIT",
        "BUY_STOP", "SELL_STOP", "CLOSE", "PARTIAL_CLOSE", "MODIFY", "CANCEL"
    ]
    volume: float = Field(gt=0)
    price: float | None = Field(default=None, gt=0)
    stopLoss: float | None = Field(default=None, gt=0)
    takeProfit: float | None = Field(default=None, gt=0)
    positionTicket: int | None = None
    orderTicket: int | None = None
    deviation: int = Field(default=20, ge=0, le=500)
    comment: str = Field(default="OnkarTradex manual", max_length=31)
    confirmed: bool = False

