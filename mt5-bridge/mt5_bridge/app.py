import asyncio
import hmac
import logging
import time
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from .config import Settings
from .models import OrderRequest, Timeframe
from .symbols import WATCHLIST
from .terminal import MT5Unavailable, TerminalGateway

settings = Settings()
logging.basicConfig(level=getattr(logging, settings.mt5_log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(message)s")
gateway = TerminalGateway(settings)
websocket_clients = 0


def authorize(x_bridge_api_key: str = Header(default="")):
    expected = settings.bridge_api_key.get_secret_value()
    if not hmac.compare_digest(x_bridge_api_key, expected):
        raise HTTPException(401, "Unauthorized")


def safe(call):
    try:
        return call()
    except MT5Unavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@asynccontextmanager
async def lifespan(_: FastAPI):
    gateway.connect()
    yield
    if gateway.connected:
        gateway.mt5.shutdown()


app = FastAPI(title="OnkarTradex MT5 Bridge", version="1.0.0", lifespan=lifespan)


@app.get("/health", dependencies=[Depends(authorize)])
def health():
    try:
        account = gateway.account()
        return {
            "status": "CONNECTED", "checkedAt": int(time.time() * 1000), **account,
            "diagnostics": {
                "lastTickAt": gateway.last_tick_at_ms,
                "lastClosedCandle": gateway.last_closed_candle,
                "lastExecutionAt": gateway.last_execution_at_ms,
                "webSocketClients": websocket_clients,
                "symbolsSubscribed": len(gateway.mapping),
            },
        }
    except Exception as exc:
        return {"status": "DISCONNECTED", "checkedAt": int(time.time() * 1000), "message": str(exc)}


@app.get("/account", dependencies=[Depends(authorize)])
def account():
    return safe(gateway.account)


@app.get("/symbols", dependencies=[Depends(authorize)])
def symbols():
    def load():
        discovered = gateway.refresh_mapping()
        return {
            "watchlist": [
                {
                    "internal": key,
                    "broker": gateway.mapping.get(key),
                    "confidence": 1.0 if key in gateway.manual_mappings else match.confidence,
                    "manual": key in gateway.manual_mappings,
                    "candidates": match.candidates,
                }
                for key, match in discovered.items()
            ],
            "available": gateway.broker_symbols(),
        }
    return safe(load)


@app.put("/symbols/mapping", dependencies=[Depends(authorize)])
def mapping(internal: str, broker: str):
    safe(lambda: gateway.set_mapping(internal, broker))
    return {"internal": internal, "broker": broker}


@app.get("/tick/{symbol:path}", dependencies=[Depends(authorize)])
def tick(symbol: str):
    return safe(lambda: gateway.tick(symbol))


@app.get("/candles/{symbol:path}", dependencies=[Depends(authorize)])
def candles(symbol: str, timeframe: Timeframe, count: int = Query(default=300, ge=2, le=2000)):
    return {"symbol": symbol, "timeframe": timeframe, "candles": safe(lambda: gateway.candles(symbol, timeframe, count))}


@app.get("/positions", dependencies=[Depends(authorize)])
def positions():
    return {"positions": safe(gateway.positions)}


@app.get("/orders", dependencies=[Depends(authorize)])
def orders():
    return {"orders": safe(gateway.orders)}


@app.get("/history/deals", dependencies=[Depends(authorize)])
def history(days: int = Query(default=30, ge=1, le=365)):
    return {"trades": safe(lambda: gateway.trade_history(days))}


@app.post("/trade/check", dependencies=[Depends(authorize)])
def order_check(order: OrderRequest):
    return safe(lambda: gateway.execute(order, check_only=True))


@app.post("/trade/execute", dependencies=[Depends(authorize)])
def order_execute(order: OrderRequest):
    return safe(lambda: gateway.execute(order, check_only=False))


@app.websocket("/ws/market")
async def market_socket(websocket: WebSocket):
    global websocket_clients
    supplied = websocket.headers.get("x-bridge-api-key", "")
    if not hmac.compare_digest(supplied, settings.bridge_api_key.get_secret_value()):
        await websocket.close(code=4401)
        return
    requested = [item for item in websocket.query_params.get("symbols", ",".join(WATCHLIST)).split(",") if item]
    await websocket.accept()
    websocket_clients += 1
    try:
        while True:
            payload = []
            for symbol in requested[:32]:
                try:
                    payload.append(gateway.tick(symbol))
                except Exception:
                    payload.append({"symbol": symbol, "state": "DISCONNECTED"})
            await websocket.send_json({"type": "ticks", "ticks": payload, "sentAt": int(time.time() * 1000)})
            await asyncio.sleep(settings.mt5_poll_seconds)
    except WebSocketDisconnect:
        return
    finally:
        websocket_clients = max(0, websocket_clients - 1)
