# Onkar AI UI workspace

## Scope

This is the requested **UI/UX-only** extension to the existing React/TypeScript app, not a new AI backend. No database migrations, provider credentials, storage changes, or new dependencies were introduced. Production release was authorized on 2026-09-11 through the existing `onkar-tradex` Vercel project and GitHub main branch.

The normal dashboard has a blue-glow Onkar AI entry and a recent-intelligence carousel. The existing `marketBrain` dashboard layout key is retained, so the user's dashboard visibility/order preferences remain intact. The existing connected MarketBrain component is accessible at `/onkar-ai/connected`; it was not rewritten. Journal, strategy library and backtesting actions link back to their existing app tabs. The outer authentication/session boundary remains in place. Existing risk-limit alerts and notification toasts also remain visible inside the workspace.

## Routes and modules

`/onkar-ai` opens the dashboard. Its views include `/scanner`, `/markets`, `/watchlist`, `/charts`, `/setups`, `/strategies`, `/journal`, `/backtesting`, `/analytics`, `/assistant`, `/news`, `/risk`, `/integrations`, `/settings`, and `/setup/:id` under the same prefix. Unknown routes and setup IDs have a recovery view. The app's existing History API pattern handles deep links and back/forward navigation.

New files under `artifacts/trading-os/src/onkar-ai/`:

- `OnkarAIWorkspace.tsx`: workspace shell, navigation, routes and session-only UI state.
- `WorkspacePages.tsx`: scanner, markets/watchlist, strategy, journal, backtest, analytics, assistant, risk and preferences views.
- `DashboardPanels.tsx`: reusable watchlist, setup analysis, sessions, news, alerts, integrations and performance panels.
- `RecentSlider.tsx`: typed insight cards and an Embla carousel using the existing carousel primitive.
- `charts.tsx`: illustrative candlesticks, zones, miniature charts and performance graphics using existing Recharts.
- `ui.tsx`: shared card/button/badge wrappers and dashboard entry action.
- `demo-data.ts`: explicitly isolated presentation fixtures, never used by server or journal persistence.
- `onkar-ai.css`: scoped visual tokens, responsive layouts, focus states and reduced motion.

Existing files changed: `App.tsx` and `tsconfig.scanner.json`. Added local tools: `scripts/onkar-ai-preview.mjs` and `scripts/onkar-ai-typecheck.mjs`. Visual evidence lives in `docs/onkar-ai-qa/`; the latest review is in root `design-qa.md`.

## Working interactions

- Sidebar/mobile dialog, routes, setup deep links and exit back to the app.
- Scanner search, asset/status/direction/score filters, sort and empty state.
- Dashboard category filters and selected market; chart timeframe, grid, zones and expand controls.
- Session-only watchlist add/remove and setup analysis actions.
- Carousel touch/mouse dragging via Embla, arrows, keyboard navigation and pagination. No distracting auto-rotation.
- Preview alert form with validation and explicit non-live feedback.
- Scripted assistant conversation, sample backtest report, expandable journal notes, news filters and manual risk calculator.
- Applied preferences retain compact tables, dashboard news visibility and reduced motion for the open workspace session.

Watchlist, alerts, chat and preferences in this design workspace do **not** persist to the server. They reset on reload or exiting the workspace. Assistant responses are scripted. Backtest reports are fixed presentation examples, not calculations for the selected date range. Prices, news times, session states and performance figures are labeled examples. Connection cards do not claim a successful health check. Real connection checks remain in the existing scanner.

## Local preview

From the repository root:

```sh
node scripts/onkar-ai-preview.mjs
```

Open `http://127.0.0.1:5188/onkar-ai`. The root URL shows only the new normal-dashboard entry/slider in an isolated preview shell. This harness does not replace production authentication and rejects `/api/*` calls; it is not deployed by the normal Vite build. Testing authenticated production persistence is outside this isolated preview.

## Verification

- `pnpm --filter @workspace/trading-os typecheck:scanner`: passed, including the new UI modules.
- `pnpm --filter @workspace/trading-os build`: passed. Existing large-bundle and mixed static/dynamic API-import warnings remain.
- Full frontend TypeScript: still fails on existing code. `node scripts/onkar-ai-typecheck.mjs` compares the committed App.tsx in-memory against current code: 911 baseline errors, 911 current errors, **zero introduced diagnostics**. It does not change the checkout or suppress errors.
- Prettier checks for the new UI and preview harness passed; `git diff --check` passed. No lint script is configured in this repository.
- Browser verification: desktop 1280×720, tablet 820×1180, mobile 390×844; all workspace routes; scanner filtering/empty state; category filtering; watchlist removal; chart timeframes/zones; preview alert submission; scripted chat; preferences; sample backtest; risk input update; carousel arrows/dots and setup deep link; mobile navigation and Escape dismissal.
- No new browser runtime errors after the initial preview-harness JSX fix. Native physical-device gestures, Safari/iPhone rendering, authenticated production login and real provider access have not been retested for this UI pass.

## Hero artwork

Built-in image generation produced `artifacts/trading-os/public/onkar-ai/market-globe.png` (2172×724), used as decorative background only. Charts, text, controls and navigation remain real components.

Art direction/prompt: wide 3:1 cinematic near-black/navy Earth hemisphere, Europe and Africa visible, cyan communications arcs and golden city lights; globe centered around 63% horizontally and cropped at the bottom; left 35% quiet negative space for the heading, right side dark for actions; subtle distant mountains; no words, logos or dashboard controls. The style follows the supplied blue globe reference, with the compact layout informed by Photos 5 and 9.

## Deployment

The existing Vercel workflow builds both the API and frontend and serves deep routes through the existing SPA fallback. This release requires no new environment variables. After deployment, verify `/onkar-ai` through the normal authenticated app and confirm the preserved connected scanner/journal/library links with a real account. The local release gate passed both builds, the scoped UI typecheck and scanner tests (26 passed, 1 live-provider test skipped, no failures).
