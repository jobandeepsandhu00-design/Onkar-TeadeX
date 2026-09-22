# Jarvis: safe voice interface to Onkar AI

Jarvis is mounted once inside the authenticated app root, above either dashboard.
It uses the existing Master AI orchestrator, specialist activity store, local Kokoro
speaker, scanner settings/control handlers, Library knowledge service, charts and
notification drawer. It is not a second scanner, trading engine or chatbot backend.

## First use

Open **JARVIS** at bottom-right. Microphone capture starts **off** on every session.

1. Open **Voice settings**. On-device wake availability is checked, not assumed.
2. Where supported, tap **Enable local wake**, allow the microphone, then say
   “Jarvis, open the scanner.” “Hey Jarvis” works too. The optional “Jar” alias
   matches recognized text only when enabled; no custom acoustic model is claimed.
3. If local recognition/language pack is unavailable, explicitly allow the separate
   one-shot browser-recognition option, then tap **Talk**. This may send a single
   utterance to the browser vendor. It is never used for ambient wake listening.
4. Optionally enable spoken replies. Existing Kokoro runs on-device; its first use
   downloads the model. Unsupported playback remains captioned, not falsely speaking.

Examples: “Open TradeX dashboard”, “Open the other dashboard”, “Go back”,
“Show gold on thirty minutes”, “Switch to one hour”, “Zoom out”,
“Read my scanner settings”, “Set API calls every 15 minutes”,
“Set risk to zero point five percent”, “Show only gold and pound-yen”,
“Disable alerts”, “Learn my Library”, “What does my Library say about wick rejection?”

Changing risk, the scanner interval, watchlist, alerts/analysis settings, starting
Library processing, and resuming analysis require an **exact on-screen confirmation**.
A generic “yes” is not accepted. Uploaded media still requires the browser's file picker.

## Capability inventory

All server capabilities require a verified Supabase identity and owner-scoped reads.
No command grants permissions, reads credentials or executes generated code.

| Capability / example | Existing integration | Permission / confirmation | Release status | Verification |
|---|---|---|---|---|
| Both dashboards / “Open TradeX dashboard” | App `goTo`, Onkar workspace | Signed-in UI; draft/save guard | Implemented | Isolated browser navigation, single avatar |
| Command Center / “Open AI Command Center” | Existing `/onkar-ai/assistant` | Signed-in UI | Implemented | Registry/parser tests |
| Scanner, risk, connections, news, knowledge, evolution | Existing workspace routes | Signed-in UI | Implemented | Route allowlist |
| Journal, setup/media Library, performance, backtests/simulation | Existing App tabs, `SetupLibrary`, `VideoLearningHub`, `BacktestTab`, `PerformanceLearning` | Signed-in UI; drafts protected | Navigation implemented | Route inspection; browser nav tests |
| Notifications / “Open notifications” | Existing `NotificationCenterBell` event adapter | Signed-in inbox, existing RLS | Opens existing drawer | No duplicate inbox/service |
| Symbol/timeframe/zoom | `SharedMarketChart`, shared market service | Supported symbols and 15M/30M/1H/4H | Implemented | Parser; typed chart adapter |
| Contextual questions | `masterAIRequest`, `runMasterAI`, shared Library retrieval | Existing model config, auth and read tools | Implemented; read-only | Existing orchestration tests |
| Scanner status / “Read my scanner settings” | Stored config/runtime/health | Owner read | Implemented; reports timestamps, not fresh broker certification | Mock store + API authentication |
| Risk %, scan frequency, gold/GBPJPY watchlist, alerts, AI analysis | Shared `saveScannerConfig` → `configure_scanner` | Owner; exact value, 2-minute single-use confirmation | Implemented, typed bounded subset | Validation, context drift, permission preservation |
| “Stop trading” / physical emergency pause | Shared `applyScannerControl` → existing runtime | Protective immediate action | Implemented: entry pause, NOT broker-order cancellation | Runtime tests + final pre-submission guards |
| “Resume analysis” | Same runtime handler | Confirmation; runtime version CAS | Analysis only, never enables entries | Race/one-use tests |
| “Disable automatic execution” | Existing DISABLE_AUTO control | Immediate protective action | Implemented | Shared handler; schema |
| “Learn my Library” | Existing `syncLibraryKnowledge` and ingestion jobs | Owner; confirmation of processing | Implemented; returns actual counts | Existing knowledge tests; command registry |
| Local wake / Jarvis / Jar | Browser local SpeechRecognition capability and language pack | Explicit mic consent, exclusive Web Lock | Runtime-dependent; no cloud wake fallback | Stubbed recognition/locks/echo gate tests |
| One-shot speech | Browser recognition | Separate disclosure/consent, tap, max 20 seconds | Runtime-dependent | UI disabled until opted in; no ambient fallback |
| Speech output/volume/stop | Existing singleton `agentVoice` / Kokoro | Device preference | Implemented; specialists silent | Existing voice regression tests |
| Alerts speech expiry | Existing priority/dedup queue | Existing notification preferences | Extended: queued alerts expire after freshness window | Existing voice tests, expiry test |
| Command history and recovery | Existing private `onkar_agent_runs`, `scanner_execution_events` | Owner read, service-only write | Implemented; request IDs and explicit unknown outcomes | Mock persistence, ownership, dedup, cancel |
| Setup create/edit/version approval | Existing setup editor and scanner strategy API | Existing approval workflow | **Open existing screen only; voice CRUD not implemented** | No fabricated draft or approval |
| Video file selection/upload/retry/segments | Existing R2 and video/knowledge APIs | Existing upload access; file picker touch | **Navigation + existing Library sync only** | No invented upload/job ID |
| Replay/backtest/shadow run creation or control | Existing backtest/replay/evolution screens | Exact data/range/version/cost inputs required | **Open existing screen only; job dispatch by voice not implemented** | No simulated results |
| Order prepare/place/cancel/close/SL/BE | Existing MT5 and Paper handlers | Exact account, positions, risk and broker confirmation | **Not callable by voice in this release** | No such tool in allowlist; trade-like commands clarify |
| All other settings/layout/providers/learning schedules | Existing controls | Existing secure forms | **Not all settings exposed by voice** | Unsupported mutations do not reach LLM tools |
| Wake with phone locked/app closed | Browser lifecycle | Not available in normal PWA | **Unsupported** | Capture stops on hide/pagehide/logout |
| Acoustic barge-in while speakers play | Requires verified echo cancellation | Not safely verified | **Touch interruption only** | Capture gated during voice/media; no self-confirmation |

## Safety and persistence

- Parsed commands use shared Zod schemas and a fixed server registry. LLM answers
  cannot call this router or execute text as code. Specialist agents remain silent.
- Existing `onkar_agent_runs` rows use `intent=JARVIS_COMMAND`, immutable structured
  request, verified session binding, output state, nonce, expiry and command log.
  Its existing RLS allows authenticated owners to read only. Only server service
  credentials write rows. **No new migration or duplicate storage system is needed.**
- POST conflict handling deduplicates request IDs. Reusing an ID with different
  arguments is rejected. Confirmation uses an atomic conditional update of the
  pending state, nonce and expiry. Expired/used/other-session confirmations fail.
- Config/runtime drift invalidates previews. Analysis resume additionally compares
  the runtime version at its write, so an older preview cannot undo a later pause.
- Unknown/time-out outcomes are never retried automatically. Check the saved
  request first. Unverified mutations block additional ordinary mutation commands.
- Emergency pause bypasses recognition and the LLM. Its control is read back;
  an audit write failure does not prevent the protective pause. It keeps protective
  Paper management and broker reconciliation unchanged. Paper and MT5 automatic
  entries recheck persisted runtime immediately before submission.
- This is not a distributed broker transaction: a dispatch already in progress
  cannot be retracted by a pause. Broker orders are **not canceled** by this release.
  Nonessential learning/backtest jobs are also **not paused** by this control.
  These limitations are stated in the result, not reported as success.
- No live-execution permission, risk limit, provider toggle, account selection or
  approved strategy is changed by deployment. The 15-minute Twelve Data minimum
  remains in force. Only shared chart services fetch chart data.
- Raw microphone audio is not stored by Jarvis. Only accepted structured mutations
  and existing Master AI questions are sent to authenticated app APIs. Captions and
  the current dialogue are memory-only and clear with logout/unmount.

## Runtime configuration and rollout

Existing environment only: Supabase public URL/key for auth, server-side
`SUPABASE_SERVICE_ROLE_KEY`, existing optional Master AI configuration, and existing
R2/provider keys. No new paid speech provider or secret is required.

- `VITE_JARVIS_ENABLED=false`: rebuild to restore previous floating AI entry points.
- `ONKAR_JARVIS_ENABLED=false`: disable Jarvis command/history APIs server-side.
  Existing manual emergency pause and trading controls remain operational.
- No always-on microphone is enabled by deployment or localStorage restoration.
- Web Locks prevent microphone ownership in multiple tabs. Missing support fails
  closed. Voice preferences may remain device-local, as they were previously.
- `processLocally` is experimental and must be verified at runtime. See
  [MDN local recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally)
  and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Verification and limitations

Commands:

```text
pnpm exec tsc -b lib/api-zod
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/trading-os typecheck:scanner
pnpm --filter @workspace/api-server test:scanner
pnpm --filter @workspace/api-server exec tsx --test ../trading-os/src/jarvis/speech.test.ts ../trading-os/src/onkar-ai/__tests__/agent-animation.test.ts
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/trading-os build
```

`jarvis-qa.html` + `scripts/verify-jarvis.browser.js` are isolated DEV-only tests,
excluded from the production build. All backend calls are blocked in the fixture.
Checked at 360×740, 390×844 and 1440×900: one avatar, bounded panel, no horizontal
overflow, distinct dashboard navigation, negation, volume and minimize/reopen.

Real-device iPhone/PWA recognition, local language-pack installation, speaker echo
in noisy rooms, real broker actions and authenticated production mutations are
**not certified by these tests**. No real orders are used for QA. The legacy full
frontend typecheck has pre-existing errors outside the targeted modules; report
the targeted check and production builds separately, not as a clean full repo.

Rollback: redeploy the preceding production deployment, or disable the feature
flags and rebuild. Shared schema remains unchanged and all private audit records
are retained. Do not delete history or reset user scanner/trading preferences.
