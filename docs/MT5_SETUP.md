# OnkarTradex MetaTrader 5 Bridge

The official MetaQuotes `MetaTrader5` Python package talks to an installed MetaTrader 5 desktop terminal through local inter-process communication. It cannot run inside Vercel. OnkarTradex therefore uses this boundary:

`browser → authenticated OnkarTradex API → authenticated Windows bridge → MT5 terminal → connected broker`

The bridge is broker-independent. Broker, server, account type, symbols, suffixes, digits, volume limits, stop distance and filling mode are read from the connected terminal. No broker name is embedded in the source.

## Safety defaults

- Start with a demo account.
- `ENABLE_MT5_TRADING=false` prevents every order.
- `ALLOW_LIVE_TRADING=false` blocks a real account even when general trading is enabled.
- Each order needs `confirmed: true` and a unique `requestId`.
- The browser never receives the MT5 password or bridge API key.
- Twelve Data remains available only as a clearly labelled chart/analysis fallback. Fallback prices are never used for MT5 execution.

## Local Windows setup

1. Install the broker's standard MetaTrader 5 desktop terminal and sign into an MT5 **demo** account.
2. Install 64-bit Python compatible with the current MetaQuotes package.
3. Open PowerShell in `mt5-bridge` and run:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   Copy-Item .env.example .env
   ```

4. Edit `.env` locally. Never commit it:

   ```dotenv
   MT5_LOGIN=your_account_number
   MT5_PASSWORD=your_terminal_password
   MT5_SERVER=the_exact_server_name_shown_by_MT5
   MT5_PATH=C:\Program Files\Your MT5 Terminal\terminal64.exe
   BRIDGE_API_KEY=a_random_secret_of_at_least_32_characters
   ENABLE_MT5_TRADING=false
   ALLOW_LIVE_TRADING=false
   ```

5. Start the bridge:

   ```powershell
   python -m mt5_bridge
   ```

6. Test locally without revealing the key in logs:

   ```powershell
   $headers = @{ 'X-Bridge-Api-Key' = $env:BRIDGE_API_KEY }
   Invoke-RestMethod http://127.0.0.1:8765/health -Headers $headers
   ```

7. Configure the trusted OnkarTradex backend (Vercel/server environment, never Vite/browser):

   ```dotenv
   PRIMARY_MARKET_PROVIDER=mt5
   MT5_BRIDGE_URL=https://private-bridge-host.example.com
   MT5_BRIDGE_API_KEY=the_same_bridge_key
   MT5_BRIDGE_USER_ID=the_supabase_auth_user_uuid_that_owns_this_terminal
   MARKET_DATA_FALLBACK_ENABLED=true
   TWELVE_DATA_API_KEY=existing_optional_fallback_key
   ```

Keep trading disabled until account, symbols, candles and order checks have been verified on demo.

`MT5_BRIDGE_USER_ID` is mandatory for the OnkarTradex MT5 routes. It binds the single account configured in that Windows terminal to one authenticated user, preventing another application user from reading or operating that terminal.

## Symbol mapping

The bridge lists every symbol exposed by MT5 and ranks exact, prefixed, suffixed and known-metal aliases for the OnkarTradex watchlist. For example, `XAU/USD` may resolve to `XAUUSD`, `XAUUSDm`, `XAUUSD.a` or `GOLD`. Low-confidence matches remain unmapped rather than guessing. `PUT /symbols/mapping` allows an authenticated administrator/backend to select an exact broker symbol.

## Data and candle behavior

- `/tick/{symbol}` uses `symbol_info_tick()` and returns bid, ask, last, spread, broker symbol, broker timestamp, approximate bridge latency and feed state.
- `/candles/{symbol}` uses `copy_rates_from_pos()` for 15M, 30M, 1H and 4H.
- Candles are de-duplicated and returned oldest to newest.
- The candle whose close time is later than the latest broker tick remains `isClosed=false`.
- Only closed candles are persisted/scanned. The forming candle is only displayed.
- Candle IDs contain masked account scope, broker symbol, timeframe and open time, preventing duplicate close scans.
- All stored timestamps are UTC epoch values. Europe/Vienna is a display preference only.

## Windows VPS / 24×7

Use a Windows VPS close to the broker, install the same MT5 terminal, sign into the intended account, and run the bridge as a restricted Windows service. NSSM, WinSW, or a Task Scheduler task configured for startup/restart can supervise `python -m mt5_bridge`.

Recommended production controls:

- expose the bridge only through HTTPS (reverse proxy or private tunnel);
- firewall it to the OnkarTradex backend egress/private network;
- use a unique 32+ byte key and rotate it from both environments;
- run under a non-administrator Windows user;
- prevent the `.env`, terminal data directory and SQLite state database from being publicly readable;
- enable Windows/VPS restart recovery and MT5 auto-login;
- monitor `/health`, last tick age and rejected execution results;
- never put the bridge URL/key in `VITE_*` variables.

The bridge reconnects on demand with capped exponential backoff after MT5, VPS or network interruptions. A supervisor should restart the process after a crash; the SQLite request ledger preserves order idempotency across restarts.

## Manual demo execution rollout

1. Keep both flags false and verify read-only account, symbols, quotes, candles, positions and pending orders.
2. Set `ENABLE_MT5_TRADING=true`, keep `ALLOW_LIVE_TRADING=false`, and restart the bridge.
3. Submit `/trade/check` before showing the confirmation UI.
4. After the user confirms, submit the same validated order to `/trade/execute` with `confirmed: true` and the original unique request ID.
5. Verify the MT5 ticket and linked OnkarTradex execution record/journal entry.
6. Live accounts remain blocked until the Windows bridge administrator explicitly changes `ALLOW_LIVE_TRADING` and restarts the bridge.

## Diagnostics

Useful endpoints (all require the bridge key):

- `GET /health`
- `GET /account`
- `GET /symbols`
- `GET /tick/{symbol}`
- `GET /candles/{symbol}?timeframe=30m&count=300`
- `GET /positions`
- `GET /orders`
- `GET /history/deals?days=30`
- `WS /ws/market`

The authenticated OnkarTradex backend exposes `POST /api/mt5/sync` to refresh connection metadata, symbol mappings and journal history together. Closed MT5 positions are upserted by MT5 position ticket into the existing journal, which then feeds the existing learning pipeline; repeated syncs do not duplicate them.

Do not log request headers, `.env` contents, passwords or complete account numbers.

## Automated tests

Tests use a mocked MetaTrader module and do not require a broker account:

```powershell
cd mt5-bridge
.\.venv\Scripts\python.exe -m pytest -q
```

They cover suffix/alias mapping, uncertain mappings, candle ordering/closure/de-duplication, volume-step validation, live-account blocking, execution idempotency, stale ticks and reconnect behavior.

## Official references

- [MetaQuotes Python integration](https://www.mql5.com/en/docs/python_metatrader5)
- [`initialize()`](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py)
- [`copy_rates_from_pos()`](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py)
- [`symbol_info_tick()`](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py)
- [`order_send()`](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py)
