import asyncio
import hmac
import logging
import time
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Header, HTTPException, Path, Query, WebSocket, WebSocketDisconnect
from .config import Settings
from .models import OrderRequest, Timeframe
from .symbols import WATCHLIST
from .terminal import MT5Unavailable, TerminalGateway

settings = Settings()
logging.basicConfig(level=getattr(logging, settings.mt5_log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(message)s")
gateway = TerminalGateway(settings)
websocket_clients = 0


async def connection_supervisor(stop: asyncio.Event):
    while not stop.is_set():
        try:
            connected_at_before = gateway.last_connected_at
            await asyncio.to_thread(gateway.heartbeat)
            if gateway.last_connected_at != connected_at_before:
                # A recovered terminal must reconcile crash-window reservations
                # before any caller can treat the bridge as execution-ready.
                await asyncio.to_thread(gateway.reconcile)
        except Exception:
            # TerminalGateway records the sanitized reason and applies backoff.
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.mt5_healthcheck_seconds)
        except asyncio.TimeoutError:
            continue


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
    except Exception as exc:
        logging.getLogger("mt5_bridge").exception("Unhandled MT5 bridge request failure")
        raise HTTPException(500, "MT5 bridge request failed") from exc


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = asyncio.Event()
    if gateway.connect():
        try:
            await asyncio.to_thread(gateway.reconcile)
        except Exception:
            logging.getLogger("mt5_bridge").exception("Initial MT5 reconciliation failed")
    supervisor = asyncio.create_task(connection_supervisor(stop))
    try:
        yield
    finally:
        stop.set()
        await supervisor
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
                **gateway.health_snapshot(),
            },
        }
    except Exception as exc:
        return {"status": "DISCONNECTED", "checkedAt": int(time.time() * 1000), "message": str(exc)}


@app.get("/account", dependencies=[Depends(authorize)])
def account():
    return safe(gateway.account)


@app.get(
    "/snapshot",
    dependencies=[Depends(authorize)],
    include_in_schema=False,
)
def account_snapshot(
    x_expected_account_fingerprint: str = Header(...),
    symbol: str | None = Query(default=None, min_length=3, max_length=24),
):
    # Server-to-server only. The response includes the opaque fingerprint so
    # the backend can verify its selected-account binding; browser routes must
    # project it out before responding.
    return safe(
        lambda: gateway.account_snapshot(
            x_expected_account_fingerprint,
            symbol,
        )
    )


@app.get(
    "/account/identity",
    dependencies=[Depends(authorize)],
    include_in_schema=False,
)
def account_identity():
    # This endpoint is bridge-to-backend only. The OnkarTradeX browser routes
    # deliberately strip and never return accountFingerprint.
    return safe(gateway.account_identity)


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
def mapping(
    internal: str,
    broker: str,
    x_expected_account_fingerprint: str = Header(...),
):
    safe(
        lambda: gateway.set_mapping(
            internal,
            broker,
            x_expected_account_fingerprint,
        )
    )
    return {"internal": internal, "broker": broker}


@app.get("/tick/{symbol:path}", dependencies=[Depends(authorize)])
def tick(symbol: str):
    return safe(lambda: gateway.tick(symbol))


@app.get("/symbols/{symbol:path}/spec", dependencies=[Depends(authorize)])
def symbol_spec(symbol: str):
    return safe(lambda: gateway.symbol_spec(symbol))


@app.get("/candles/{symbol:path}", dependencies=[Depends(authorize)])
def candles(symbol: str, timeframe: Timeframe, count: int = Query(default=300, ge=2, le=2000)):
    return {"symbol": symbol, "timeframe": timeframe, "candles": safe(lambda: gateway.candles(symbol, timeframe, count))}


@app.get(
    "/market/snapshot/{symbol:path}",
    dependencies=[Depends(authorize)],
    include_in_schema=False,
)
def candle_bundle(
    symbol: str,
    x_expected_account_fingerprint: str = Header(...),
    timeframes: str = Query(default="30m,1h,4h", min_length=2, max_length=32),
    count: int = Query(default=300, ge=2, le=2000),
):
    # Server-to-server only. One locked bridge operation supplies every
    # timeframe used by the chart/scanner so callers cannot accidentally mix
    # candles from different terminal logins or broker symbol mappings.
    requested = [item.strip().lower() for item in timeframes.split(",") if item.strip()]
    return safe(
        lambda: gateway.candle_bundle(
            x_expected_account_fingerprint,
            symbol,
            requested,
            count,
        )
    )


@app.get("/positions", dependencies=[Depends(authorize)])
def positions():
    return {"positions": safe(gateway.positions)}


@app.get("/orders", dependencies=[Depends(authorize)])
def orders():
    return {"orders": safe(gateway.orders)}


@app.get("/history/deals", dependencies=[Depends(authorize)])
def history(days: int = Query(default=30, ge=1, le=365)):
    return {"trades": safe(lambda: gateway.trade_history(days))}


@app.post("/reconcile", dependencies=[Depends(authorize)])
def reconcile():
    return safe(gateway.reconcile)


@app.get("/trade/result/{request_id}", dependencies=[Depends(authorize)])
def trade_result(
    request_id: str = Path(
        min_length=8,
        max_length=120,
        pattern=r"^[A-Za-z0-9:_-]+$",
    ),
):
    # This recovery endpoint reads durable idempotency state and broker
    # history, but can never submit or retry an order.
    return safe(lambda: gateway.execution_result(request_id))


@app.post("/trade/check", dependencies=[Depends(authorize)])
def order_check(
    order: OrderRequest,
    x_expected_account_fingerprint: str = Header(...),
    x_expected_broker_symbol: str = Header(...),
):
    return safe(
        lambda: gateway.execute(
            order,
            check_only=True,
            expected_account_fingerprint=x_expected_account_fingerprint,
            expected_broker_symbol=x_expected_broker_symbol,
        )
    )


@app.post("/trade/claim", dependencies=[Depends(authorize)])
def order_claim(
    order: OrderRequest,
    x_expected_account_fingerprint: str = Header(...),
    x_expected_broker_symbol: str = Header(...),
):
    # Acknowledges durable intent before the backend makes the potentially
    # ambiguous execute POST. This endpoint never calls order_send.
    return safe(
        lambda: gateway.claim_execution(
            order,
            expected_account_fingerprint=x_expected_account_fingerprint,
            expected_broker_symbol=x_expected_broker_symbol,
        )
    )


@app.post("/trade/execute", dependencies=[Depends(authorize)])
def order_execute(
    order: OrderRequest,
    x_expected_account_fingerprint: str = Header(...),
    x_expected_broker_symbol: str = Header(...),
):
    return safe(
        lambda: gateway.execute(
            order,
            check_only=False,
            expected_account_fingerprint=x_expected_account_fingerprint,
            expected_broker_symbol=x_expected_broker_symbol,
        )
    )


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
