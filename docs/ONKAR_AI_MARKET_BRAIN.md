# ONKAR AI Market Brain — implementation and activation

## Status

This is an additive, analysis-only production foundation, not unrestricted automated trading and not completion of every advanced capability in the original specification.

Implemented: authenticated API; real Coinbase/Twelve Data candle adapters; UTC candle cache; deterministic indicators, confirmed swings, zones, candle patterns, multi-timeframe rule evaluation, weighted confluence, account-specific risk/news gates; immutable rule versions; leased background worker; candidates, timelines and deduplicated in-app alerts; Gemini structured explanations and private read-only tools; journal comparisons/linking; TradingView webhook evidence; dashboard UI, rule/settings editor, chart/detail view and bounded historical replay.

**Production scanning is not activated by installing this code.** It requires server credentials, a running worker, an explicit market/account selection and user-approved rules. No production scanner settings, fake candles, sample trades or approved strategies were seeded. Missing provider/news/AI status is displayed honestly.

## Existing architecture reused

- React 19 / TypeScript / Vite / Tailwind dashboard in `artifacts/trading-os`.
- Existing Supabase authentication/client, workspace membership and `app_state` journal.
- Existing Setup Library: scanner versions reference its source IDs; no duplicate strategy library.
- Existing trading accounts, prop challenges, trades, P&L and review fields.
- Express API and existing Gemini provider in `artifacts/api-server`.
- Existing calendar source, R2 media system, TradingView dashboard chart and Vercel deployment.
- Existing dialog primitive and dashboard visibility/reordering. New scanner is inserted after account overview while preserving customized section order.

Important discovery: `sync_trading_state_for_user` deletes/recreates normalized journal/setup records on save. Scanner history therefore keeps source IDs and immutable definition snapshots, not cascading foreign keys to those ephemeral rows.

## Modules and files

| Location                                             | Responsibility                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `lib/api-zod/src/market-brain.ts`                    | Shared validation contracts, configuration, rule schemas and UI types                          |
| `artifacts/api-server/src/market-brain/providers.ts` | Interchangeable real-data and optional integration interfaces                                  |
| `calculations.ts` in that folder                     | EMA/SMA/RSI/MACD/ATR/Bollinger, volume/wicks, confirmed structure/zones/patterns, DST sessions |
| `evaluation.ts`                                      | Weighted rules, risk gating, lifecycle, exact journal matching                                 |
| `journal.ts`, `news.ts`, `ai.ts`, `tools.ts`         | Account history, fail-closed calendar, Gemini explanations, controlled read-only tools         |
| `store.ts`, `scanner.ts`, `worker.ts`                | Supabase REST boundary, bounded orchestration, independent Node worker                         |
| `webhook.ts`, `backtest.ts`                          | TradingView authentication/replay-window checks; no-look-ahead replay                          |
| `artifacts/api-server/src/routes/market-brain.ts`    | Authenticated scanner/configuration/analysis/chat/replay APIs and webhook                      |
| `artifacts/trading-os/src/market-brain/`             | Dashboard, rule builder, settings, detail/chart, replay, styles and API                        |
| `scripts/scanner-preview.mjs`                        | Development-only UI harness; writes disabled; not bundled in production                        |
| `supabase/tests/market_brain_rls.sql`                | Rollback-only RLS/atomicity/lease/budget regression test                                       |

Modified existing files: API route registry/build/package/env example, shared-schema export, frontend package/App dashboard integration, pnpm lock/workspace settings. Windows x64 native build binaries were restored; Linux deployment support is retained. No new external application library or duplicate Supabase client was introduced.

## Database changes

Applied additive migrations:

1. `20260910170314_onkar_market_brain.sql`
2. `20260910185749_scanner_safety.sql`

New tables: `market_candles`, `scanner_configs`, `scanner_strategy_versions`, `setup_candidates`, `setup_events`, `scanner_ai_runs`, `scanner_alerts`, `scanner_webhook_keys`, `tradingview_webhook_events`, `scanner_trade_links`.

New service-only RPCs: `claim_scanner_job`, `commit_scanner_candidate`, `reserve_scanner_ai`, `configure_scanner`, `cleanup_scanner_cache`.

All tables have RLS. Anonymous access is revoked. Authenticated users can only read their own scanner records. Frontend clients cannot directly insert scores, approvals, alerts or worker jobs. Candle-cache and webhook-key tables are server-only. API writes validate the Supabase session, ownership, workspace, source setup/account and shared schemas before using the privileged server connection.

Candidate + event + alert writes are transactional. Worker leases use `FOR UPDATE SKIP LOCKED` and fencing tokens. AI budgets reserve under a config-row lock. Rule versions are insert-only through the API. Configuration changes atomically expire active plans, record the reason and invalidate in-flight worker leases.

No existing journal/media tables were changed or deleted. R2 remains the media store; the scanner does not move or duplicate uploaded lessons.

## Required server configuration

Keep secrets out of frontend variables, Git and chat messages. Configure securely in the hosting provider's environment settings.

| Variable                        | API server                              | Separate worker                                                            |
| ------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Existing setting                        | Or use `SUPABASE_URL`                                                      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Existing session-validation setting     | Not required for service-only worker                                       |
| `SUPABASE_SERVICE_ROLE_KEY`     | Required for validated scanner writes   | Required                                                                   |
| `TWELVE_DATA_API_KEY`           | Provider health checks for Twelve Data  | Required when scanning Twelve Data markets                                 |
| `MARKET_DATA_API_KEY`           | Optional alias                          | Optional alias                                                             |
| `GEMINI_API_KEY`                | Existing AI provider; required for chat | Required for automatic AI explanation, optional for deterministic scanning |
| `SCANNER_AI_MODEL`              | Defaults to `gemini-2.5-flash`          | Same                                                                       |
| `MARKET_SYMBOL_MAP`             | Optional JSON of exact symbol aliases   | Same                                                                       |
| `SCANNER_ENABLED`               | Does not start a Vercel worker          | Set `true` only on the deployed worker                                     |
| `ENABLE_LIVE_EXECUTION`         | Keep `false`                            | Keep `false`; there is no order-transmission implementation                |
| `NODE_ENV`                      | `production`                            | `production`                                                               |

Coinbase public crypto data needs no API key. It is a deliberate provider choice, not a fallback for unavailable Forex data. Verify Twelve Data instrument coverage, quotas and redistribution permissions. Do not silently replace spot markets with futures. Missing contract size / account-currency conversion blocks position sizing and READY.

## Background deployment

Vercel retains the existing frontend/API. Do **not** start the worker from a request handler or browser effect. Its batches can outlast the current 60-second Vercel function limit.

Deploy a separate persistent Node service from this repository (for example a separate Railway worker service; the repository already has Railway configuration). Do not replace the existing web/API service.

Build:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server build
```

Worker start, from repository root:

```sh
pnpm --filter @workspace/api-server scanner:worker
```

One bounded cycle, for a scheduler/container that runs independently of Vercel:

```sh
node artifacts/api-server/dist/market-brain-worker.mjs --once
```

The worker honors `SCANNER_ENABLED`, handles SIGTERM, backs off failures, leases one user job and rotates through configured symbols. Requested frequency is a target; actual cadence depends on provider limits, history warmup and worker capacity. Multiple instances coordinate through database leases. Only approved versions run. Stored history makes warmup resumable.

The current adapters are **REST candle-close scanners, not tick streams**. Active WebSocket connections are zero. Future streaming adapters can implement the subscription methods without replacing deterministic analysis. A long-running socket must live in the separate worker, not Vercel.

## Activate in the app

1. Configure the API and worker credentials securely and deploy/start the worker.
2. Dashboard → ONKAR AI → Rules. Choose an existing setup; add explicit conditions and approve a version. No prose/video interpretation is auto-approved.
3. Settings: choose an existing Live, Demo or Prop Challenge account, provider, symbols, timeframes and approved versions.
4. Enter broker contract P&L-per-price-unit values in that account's currency. Confirm the applicable challenge/account limits.
5. Set news/AI/alert budgets, enable scanning and save.
6. Check Connections for a real worker heartbeat, fresh candles and errors. A successful key configuration alone is not a successful health check.
7. Qualified candidates appear and update from saved server data. Users can view rules, frozen plans, historical samples, explanations and lifecycle events, then link an actual journal trade.

`READY` requires fresh data, required-rule passes, score threshold, account risk and session checks, and verified news when enabled. A score is **rule confluence, not statistical win probability**. Plans freeze entry/stop/target/direction. Stop-first handling is conservative when OHLC cannot resolve intrabar ordering. Expiry is processed even if a provider fails.

Journal balance = starting balance + each account's closed P&L exactly once, including known fees. Other accounts and the global fallback account are excluded. Unknown broker P&L or contract conversion does not become invented risk capacity. This is a journal-based risk gate, not a real-time broker-equity/drawdown guarantee.

## TradingView

Settings → Generate/rotate webhook key. The plaintext key is returned once; only its SHA-256 hash is stored. Key rotation revokes the previous key. Example body (replace every placeholder):

```json
{
  "eventId": "unique-alert-id-001",
  "timestamp": "2026-09-10T12:00:00Z",
  "symbol": "EURUSD",
  "timeframe": "15m",
  "event": "support_retest",
  "price": 1.1627,
  "secret": "YOUR_PRIVATE_GENERATED_WEBHOOK_SECRET"
}
```

Send to `/api/tradingview/webhook/{configId}`. Timestamp must be within five minutes; event ID must be unique per scanner; symbol/timeframe must be configured. Use ISO UTC timestamps in Pine and a stable event ID for retries. Payload secret is removed before storage. Incoming events are additional evidence and queue re-evaluation subject to cooldown. They cannot approve trades or place orders.

The existing TradingView chart is unchanged. Candidate detail uses stored OHLC candles with calculated plan overlays. Licensed Advanced Charts custom-datafeed wiring, live drawings and a concrete MCP/vision adapter remain extension work, not claimed connections.

## AI and cost boundaries

Only qualified, fresh candidates above the configured threshold receive automatic explanations. The deterministic scanner continues without Gemini. Daily durable reservations cap calls, including questions. Structured JSON is validated with Zod; malformed responses fail safely. Scores and risk are outside the AI response schema. Current explanations are matched to the candidate/evidence fingerprint; changed evidence does not silently reuse an old automatic explanation.

Read-only tools are fixed and authenticated: market context, active candidates, rules, risk, history, journal statistics, calendar and strategy definitions. No tool accepts raw SQL, arbitrary user IDs, URLs or orders. Tool calls/model/tokens/latency/status are stored. Cost estimates remain null rather than fabricated when no pricing model is configured.

No psychology/intent such as “revenge trading” is inferred from a loss alone. Historical comparison currently uses exact setup/symbol/timeframe/account matches and known journal outcomes, with sample-size cautions—not embeddings or claims of statistical significance.

## Tests and verification

```sh
pnpm exec tsc --build lib/api-zod
pnpm --filter @workspace/api-server typecheck:scanner
pnpm --filter @workspace/trading-os typecheck:scanner
pnpm --filter @workspace/api-server test:scanner
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/trading-os build
```

Set `RUN_MARKET_PROVIDER_TESTS=1` to include the network smoke test. This fetched real Coinbase BTC-USD candles successfully during implementation. Normal test runs skip network access.

Tests cover calculations, confirmed pivots, zone invalidation, missing-data rules, weighted scoring, selected-account balances/risk, lifecycle ambiguity/expiry, historical scoping, DST, webhook validation, strict AI outputs, backtest look-ahead, anonymous API denial, tool impersonation denial, and a complete in-memory worker/candidate/alert/monitoring cycle. In-memory fixtures and the browser harness are explicitly test-only, not production metrics.

Both new-module TypeScript checks and both production bundle builds pass. Full-repository TypeScript checking still reports pre-existing errors in `App.tsx`, `PerformanceReport.tsx` and the legacy auth reader. No lint script/configuration exists; Prettier checks and `git diff --check` are used for the changed modules and must not be described as a full lint pass.

Browser verification: 390×844 mobile and 1440×1000 desktop; content, tabs, rule inputs, settings and error handling render; no page overflow or browser errors. These checks used the isolated no-write harness, not a completed production login→worker→AI run.

RLS grants and service-only RPC permissions were checked against the real Supabase project. The rollback-based SQL regression script could **not** run through the connected SQL tool because it enforces read-only transactions. Run it with a privileged test-database connection; never claim that validation passed without executing it. The two selected owners must not already have scanner configs. All writes roll back.

## Remaining work / honest limits

- Production credentials, persistent worker activation and user-approved strategies are still required. A complete live Supabase-persisted AI/alert cycle has not yet been verified.
- The new SQL transactional isolation/budget test needs a write-capable test connection.
- Concrete WebSocket consumers, licensed TradingView datafeed/drawing integration, MCP/vision capture and confirmation are not implemented connections.
- Current zones cover confirmed swing support/resistance and equal highs/lows. Full supply/demand, prior-day/week/session-level families, advanced SRC patterns and incremental indicator state need further expansion/calibration.
- Automated educational-content extraction/approval workflow, vector similarity, expanded journal mistake inference and comprehensive performance dimensions remain beyond this foundation. Existing education and Performance & Learning features are preserved.
- Notifications are private scanner in-app alerts. Push/email delivery, full integration with the legacy notification drawer and external delivery receipts remain work.
- Replay is bounded, synchronous and uses stored data. Historical news, spread/slippage/commission modeling, walk-forward testing and large queued backfills are not implemented.
- Risk is based on recorded journal data and configured contract values. Broker mark-to-market equity, correlation models, partial fills and execution are not implemented. Broker execution remains disabled regardless of UI state.

## Operational notes

Keep an eye on `last_run_at`, `last_error`, duration, source timestamps and the structured `scanner_*` logs. No requests include secret values in logs. Cache retention is 400 days for intraday candles, two years for daily and ten years for weekly; webhook evidence retention is 90 days. Strategy/candidate/journal-linked history is retained. Alert budgets reset by UTC day.

Supabase's existing advisors also report pre-existing signed-in SECURITY DEFINER helper warnings and disabled leaked-password protection. These were not silently changed in this feature. Review [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) separately. Server-only cache/key tables use explicit deny policies and no frontend grants.

Rollback: disable each scanner config and stop the separate worker, then revert the application commit if necessary. Keep the additive tables so history remains intact. Do not delete journal data or run destructive database rollback migrations.
