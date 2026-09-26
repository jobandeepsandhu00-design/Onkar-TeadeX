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
- The Python bridge binds to `127.0.0.1` by default. It is not exposed to the
  LAN or public internet unless an administrator explicitly changes
  `BRIDGE_HOST`.
- The backend refuses cleartext non-loopback `MT5_BRIDGE_URL` values. Use an
  authenticated private tunnel or an HTTPS reverse proxy for VPS traffic.
- The dedicated `/onkar-ai/charts/mt5` terminal fails closed and never falls back to Twelve Data. `/onkar-ai/charts/twelve-data` remains the isolated Paper feed. Fallback prices are never used for MT5 execution.

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

   `requirements.txt` deliberately pins `MetaTrader5==5.0.6180`, the exact
   Windows package used by this workspace's bridge tests. Do not loosen this
   to a range during routine deployment. To upgrade, change the pin in a
   reviewed release, rebuild a clean virtual environment, run the complete
   Python and API suites, and repeat read-only plus demo-account broker checks
   before enabling execution.

4. Edit `.env` locally. Never commit it:

   ```dotenv
   MT5_LOGIN=your_account_number
   MT5_PASSWORD=your_terminal_password
   MT5_SERVER=the_exact_server_name_shown_by_MT5
   MT5_PATH=C:\Program Files\Your MT5 Terminal\terminal64.exe
   # Generate this locally; placeholder and low-entropy values are rejected.
   BRIDGE_API_KEY=
   BRIDGE_HOST=127.0.0.1
   BRIDGE_PORT=8765
   ENABLE_MT5_TRADING=false
   ALLOW_LIVE_TRADING=false
   ```

   Generate the key instead of typing a memorable value:

   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(48))"
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
   MT5_BRIDGE_ALLOW_INSECURE_PRIVATE_DEVELOPMENT=false
   MT5_BRIDGE_USER_ID=the_supabase_auth_user_uuid_that_owns_this_terminal
   MARKET_DATA_FALLBACK_ENABLED=false
   TWELVE_DATA_API_KEY=existing_optional_fallback_key
   ```

Keep trading disabled until account, symbols, candles and order checks have been verified on demo.

`MT5_BRIDGE_USER_ID` is mandatory for the OnkarTradex MT5 routes. It binds the single account configured in that Windows terminal to one authenticated user, preventing another application user from reading or operating that terminal.

AUTO execution also requires an exact account identity binding. The bridge
creates an HMAC-SHA256 fingerprint from the broker, server and complete MT5
login using `BRIDGE_API_KEY`; the complete login is never returned. During an
authenticated MT5 journal sync, the backend stores that fingerprint in the
service-role-only `mt5_account_bindings` table and creates a separate opaque
journal account id. Select that imported MT5 account in Scanner Settings. AUTO
fails closed when the binding is missing, malformed, belongs to another
selected account, or differs from the terminal's current login. Matching only
the masked last four digits is never sufficient. The fingerprint is not
included in `/api/mt5/account`, status, sync, reconcile, or other browser
responses. For AUTO, the backend also sends the expected fingerprint to the
bridge in a server-only header; the bridge verifies it during `order_check` and
again immediately before `order_send`, so a terminal login switch fails closed.

The scanner and dedicated MT5 chart apply the same binding before they trust
broker candles. One server-only `/market/snapshot/{symbol}` bridge operation
captures account identity, the exact broker symbol, Bid/Ask, symbol
specification, and every requested 15M/30M/1H/4H series under the same terminal
lock. Identity and symbol checkpoints run after every MT5 read. The complete
bundle is discarded, AUTO is paused, and no candidate provenance is created if
the selected account or broker symbol changes. For every
accepted MT5 candidate the backend upserts an `mt5_candidate_provenance` row
containing the candidate's latest candle, opaque account fingerprint and
verification timestamps. This table has RLS enabled, grants only the service
role, and is never joined into a browser response. AUTO requires that row to
match the candidate id, latest candle, selected account binding, and current
terminal identity before broker risk checks begin.
Candidates made from Twelve Data never receive MT5 provenance and cannot route
to MT5 execution.

## Symbol mapping

The bridge lists every symbol exposed by MT5 and ranks exact, prefixed, suffixed and known-metal aliases for the OnkarTradex watchlist. For example, `XAU/USD` may resolve to `XAUUSD`, `XAUUSDm`, `XAUUSD.a` or `GOLD`. Low-confidence matches remain unmapped rather than guessing. `PUT /symbols/mapping` allows the authenticated backend to select an exact broker symbol only when its server-only expected-account fingerprint still matches the terminal. Manual aliases are stored under that exact account fingerprint in both the bridge ledger and the service-role-only `mt5_symbol_mapping_bindings` table. An alias is never restored from the browser-facing cache or carried to another login/broker.

## Data and candle behavior

- `/tick/{symbol}` uses `symbol_info_tick()` and returns bid, ask, last, spread, broker symbol, broker timestamp, approximate bridge latency and feed state.
- `/candles/{symbol}` uses `copy_rates_from_pos()` for 15M, 30M, 1H and 4H.
- `/market/snapshot/{symbol}` is the account-atomic multi-timeframe source used
  by both the MT5 chart and the scanner; neither can combine different MT5
  accounts or substitute Twelve Data candles.
- Candles are de-duplicated and returned oldest to newest.
- The candle whose close time is later than the latest broker tick remains `isClosed=false`.
- Only closed candles are persisted/scanned. The forming candle is only displayed.
- Candle IDs contain a separate domain-scoped opaque HMAC, broker symbol, timeframe and open time, preventing duplicate close scans without exposing the login or the execution/account fingerprint.
- Strict MT5 terminal reads are not merged into the account-unscoped Twelve Data/shared candle cache.
- The authenticated `/api/mt5/portfolio` response obtains account, positions,
  and pending orders in one bridge-locked snapshot bound to the server-selected
  account. It returns only the browser-safe account schema; the bridge account
  fingerprint is stripped before serialization. The MT5 status panel uses this
  endpoint rather than combining three independently timed reads.
- All stored timestamps are UTC epoch values. Europe/Vienna is a display preference only.

## Windows VPS / 24×7

Use a Windows VPS close to the broker, install the same MT5 terminal, sign into the intended account, and run the bridge as a restricted Windows service. NSSM, WinSW, or a Task Scheduler task configured for startup/restart can supervise `python -m mt5_bridge`.

The repository includes a Task Scheduler launcher for the Windows user that owns the MT5 terminal session:

```powershell
cd mt5-bridge
.\scripts\install-startup-task.ps1
Start-ScheduledTask -TaskName "OnkarTradeX MT5 Bridge"
```

The task restarts the bridge after a crash without putting MT5 credentials in the task command. It uses the local `.env` and starts at that Windows user's next sign-in. Because the official MetaQuotes Python package communicates with the desktop terminal in the same Windows session, keep the VPS user signed in and disconnect RDP instead of signing out. Your phone can be off; the VPS, MT5 terminal, bridge task and secure network route must remain running.

Recommended production controls:

- keep `BRIDGE_HOST=127.0.0.1` when an HTTPS reverse proxy or private-tunnel
  agent runs on the same VPS; let that protected service reach the loopback
  bridge;
- if a protected network listener is required, set `BRIDGE_HOST` explicitly to
  the private interface (or `0.0.0.0` only when Windows Firewall is already
  restricted), and terminate HTTPS before traffic reaches the backend;
- expose the bridge only through HTTPS (reverse proxy or private tunnel);
- firewall it to the OnkarTradex backend egress/private network;
- use a unique 32+ byte key and rotate it from both environments;
- run under a non-administrator Windows user;
- prevent the `.env`, terminal data directory and SQLite state database from being publicly readable;
- enable Windows/VPS restart recovery and MT5 auto-login;
- monitor `/health`, last tick age and rejected execution results;
- never put the bridge URL/key in `VITE_*` variables.

The backend accepts `http://` automatically only for `localhost`, `127.0.0.0/8`
or `[::1]`. For a short-lived isolated development network with no TLS, the
administrator may explicitly set
`MT5_BRIDGE_ALLOW_INSECURE_PRIVATE_DEVELOPMENT=true`. This escape hatch sends
the bridge key and trading payloads in cleartext, so never enable it across the
public internet or in normal production. Prefer a private tunnel with an HTTPS
endpoint instead.

The bridge runs a connection supervisor with capped exponential backoff after MT5, VPS or network interruptions. Every successful reconnect triggers broker reconciliation before the bridge is treated as ready. A process supervisor should still restart the service after a Python crash. Before `order_send`, the bridge persists the full broker request and a deterministic `OTX:` token in its SQLite ledger. At startup and reconnect it reconciles reserved requests against current positions, pending orders, order history and deal history; it never resends an uncertain request automatically. The ledger also binds each request id to the immutable order payload, exact account and broker symbol. MT5 `DONE_PARTIAL` is treated as irreversible broker activity, so it is journaled and cannot be retried as a second order.

## Guarded AUTO execution rollout

AUTO is unavailable until every server-side prerequisite is healthy. This is
intentional; the browser cannot override these gates.

1. Complete the read-only bridge setup and verify a **demo** account.
2. On the Windows bridge set `ENABLE_MT5_TRADING=true` and keep
   `ALLOW_LIVE_TRADING=false`, then restart the bridge.
3. On the trusted OnkarTradex backend set:

   ```dotenv
   PRIMARY_MARKET_PROVIDER=mt5
   MT5_BRIDGE_URL=https://your-windows-bridge.example.com
   MT5_BRIDGE_API_KEY=the_same_32_plus_character_secret
   MT5_BRIDGE_ALLOW_INSECURE_PRIVATE_DEVELOPMENT=false
   MT5_BRIDGE_USER_ID=the_supabase_user_uuid_that_owns_the_terminal
   AUTO_EXECUTION_WORKER_ENABLED=true
   ```

4. In Scanner Rules, create an approved immutable rule version and explicitly
   enable **Allow this approved version to be used by AUTO execution**.
5. Select the same stored trading account as the connected terminal and use
   MT5 as the scanner's primary provider.
6. The server reconciles account, positions and pending orders before arming.

The worker processes only closed-candle `READY` candidates. It rechecks feed
freshness, entry zone, news gate, spread, open-position limit, broker symbol
specification, volume step, stop geometry and `order_check` before
`order_send`. The bridge remains the final authority and keeps a durable
idempotency ledger. Live AUTO remains blocked unless the bridge administrator
separately enables `ALLOW_LIVE_TRADING`.

The frozen candidate entry and the same account-atomic Bid/Ask determine the
order type. Entries inside Bid–Ask plus one broker tick remain market orders;
entries materially below/above the quote become the corresponding
`BUY_LIMIT`, `BUY_STOP`, `SELL_LIMIT`, or `SELL_STOP`. There is no browser
order-type override. The server rechecks action, price geometry, risk/reward,
spread, volume, exposure, account, symbol and permissions immediately before
the final one-use execution handoff.

An MT5 `READY` candidate is also account scoped: its provider, selected account
id, service-only scan provenance and the terminal's current identity must all
match. Switching the MT5 login or selected account requires a new sync and a
fresh scan; an older candidate is not reused for the new account.

## Manual demo position/order management rollout

The browser manual endpoint is deliberately **management-only**. It permits
`CLOSE`, `PARTIAL_CLOSE`, `MODIFY`, and `CANCEL`; it rejects market BUY/SELL and
all new pending-order actions. New exposure must originate from a closed-candle
`READY` candidate and pass the shared Setup, Risk, News and Execution pipeline.
This prevents the manual ticket from becoming a second trading engine that
bypasses the scanner's frozen risk plan.

1. Keep both flags false and verify read-only account, symbols, quotes, candles, positions and pending orders.
2. Set `ENABLE_MT5_TRADING=true`, keep `ALLOW_LIVE_TRADING=false`, and restart the bridge.
3. Submit a management action to `/trade/check` before showing the confirmation
   UI.
4. A successful browser check creates a one-time, 60-second preflight. Its
   exact account fingerprint, internal symbol, resolved broker symbol and
   payload digest are stored only in the service-role-only
   `mt5_manual_preflight_bindings` table. The fingerprint is never returned to
   the browser.
5. After the user confirms, submit the same validated order to
   `/trade/execute` with `confirmed: true` and the original unique request ID.
   Any payload edit, terminal login change, symbol-mapping change, expiry or
   reuse fails closed and requires a fresh broker check. The bridge verifies
   both the expected account and exact broker symbol again immediately before
   `order_send`.
6. If the claim or execute response is lost or ambiguous, the
   request becomes `UNCERTAIN`. Do not generate a new request id. Use the
   dashboard's **Reconcile original request** action; it reads the bridge ledger
   and broker history without resending. All other manual orders remain locked
   until that original request is resolved.
7. Verify the MT5 ticket and linked OnkarTradex execution record/journal entry.
8. Live accounts remain blocked until the Windows bridge administrator explicitly changes `ALLOW_LIVE_TRADING` and restarts the bridge.

Before enabling manual or AUTO MT5 execution, apply all four database migrations
in order:

- `20260925123000_mt5_account_identity_binding.sql`
- `20260925160000_mt5_manual_preflight_bindings.sql`
- `20260925161000_mt5_manual_preflight_selected_account.sql`
- `20260925170000_mt5_auto_execution_audit.sql`

The manual-preflight migrations preserve any pre-existing unresolved manual
rows and bind every preflight to the selected OnkarTradeX account, connected MT5
fingerprint, broker symbol and exact payload. The final audit migration uses
service-role-only advisory-lock functions to serialize manual and AUTO broker
handoffs. An uncertain original request globally locks new execution until exact
bridge reconciliation resolves it; never mark an uncertain broker outcome
failed merely to bypass the lock.

## Diagnostics

Useful endpoints (all require the bridge key):

- `GET /health`
- `GET /account`
- `GET /snapshot?symbol=XAU%2FUSD` (server-only, account-bound atomic account/portfolio/tick/spec read)
- `GET /symbols`
- `GET /tick/{symbol}`
- `GET /candles/{symbol}?timeframe=30m&count=300`
- `GET /market/snapshot/{symbol}?timeframes=30m,1h,4h&count=300` (server-only, account/symbol-atomic candle bundle)
- `GET /positions`
- `GET /orders`
- `GET /history/deals?days=30`
- `POST /reconcile`
- `GET /trade/result/{original-request-id}` (read/reconcile only; never sends)
- `WS /ws/market`

The authenticated OnkarTradex backend exposes `POST /api/mt5/sync` and `POST /api/mt5/reconcile` to refresh broker state, connection metadata, symbol mappings and journal history together. The persistent scanner worker performs the same reconciliation before it begins processing setups. Closed MT5 positions are upserted by MT5 position ticket into the existing journal, which then feeds the existing learning pipeline; repeated syncs do not duplicate them.

If `initialize()` reports `(-6, "Terminal: Authorization failed")`, the terminal is installed but no usable broker session is authenticated. Sign into the intended demo account inside that same Windows user session, confirm the exact broker server, enable algorithmic/external Python trading in MT5, and restart the bridge. Do not send credentials through the browser or chat.

Do not log request headers, `.env` contents, passwords or complete account numbers.

## Automated tests

Tests use a mocked MetaTrader module and do not require a broker account:

```powershell
cd mt5-bridge
.\.venv\Scripts\python.exe -m pytest -q
```

They cover account-scoped suffix/alias mapping, uncertain mappings, candle ordering/closure/de-duplication, volume-step validation, live-account blocking, execution idempotency, changed-payload rejection, partial fills, crash-window reconciliation, stale ticks, broker execution/filling policy, SL/TP preservation, full and partial close validation, reconnect behavior, opaque account fingerprint stability, manual one-time account/symbol/payload preflight binding, stable before/after chart and scan identity, and exact candidate/account/broker-symbol binding for AUTO.

## Official references

- [MetaQuotes Python integration](https://www.mql5.com/en/docs/python_metatrader5)
- [`initialize()`](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py)
- [`copy_rates_from_pos()`](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py)
- [`symbol_info_tick()`](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py)
- [`order_send()`](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py)
