# Design QA — Scanner Settings and Connected Intelligence

## Reference review

- Scanner settings reference: replace the long numeric form with a guided 4H → 1H → 30M workflow, simple cadence choices, a visible Twelve Data load guard, and progressive disclosure for advanced limits.
- Recent Intelligence reference: remove every sample/demo opportunity and render only verified scanner candidates.
- Multi-Agent Command Center reference: replace sample agent tasks and conclusions with the shared Market Brain snapshot.

## Implementation checks

- [x] Mobile-first controls use large card/button targets and wrap below 760px.
- [x] Required 4H, 1H and 30M stages are always visible; optional timeframes remain behind disclosure.
- [x] Provider and risk account remain editable without exposing API secrets.
- [x] The settings surface identifies missing instrument sizing as an execution blocker.
- [x] Dashboard intelligence widgets share one authenticated snapshot request and refresh only while the page is visible.
- [x] Sample cards, sample AI tasks and sample Master AI conclusions were removed from production rendering.
- [x] Empty and offline states are explicit and do not invent prices, scores, news or performance.
- [x] Reduced-motion behavior remains inherited from the existing Onkar AI motion system.
- [x] Frontend production build and focused scanner TypeScript checks pass.
- [x] API production build and all active scanner tests pass.

## Browser verification

The local production UI opened successfully at `http://127.0.0.1:4173`, but protected dashboard and scanner routes require an authenticated user session. No credentials were supplied or entered, so visual comparison of those protected routes could not be completed safely. The browser reached the expected OnkarTradex login screen without a runtime crash.

## Remaining visual check

After deployment, sign in normally and verify the Settings tab at iPhone width and desktop width, then confirm the dashboard shows either verified live candidates or the honest empty state. No sample card should appear.

## Risk AI correction — 2026-09-21

- Source visual truth: `C:\Users\joban\.codex\codex-remote-attachments\01a07180-c785-7692-9b30-a7c170f1481f\FFD8E2DE-0021-43C2-AC4C-BB77C200BA38\1-Photo-1.jpg` and `2-Photo-2.jpg`.
- Intended viewport: iPhone portrait; supplied screenshot is 589 × 1280 pixels. CSS viewport and device pixel ratio are unavailable from the screenshot metadata.
- Implementation route: `/onkar-ai/risk` in the local Vite production build.
- Implementation screenshot: unavailable because the route redirects to the authenticated OnkarTradex login screen in the isolated in-app browser.
- State: connected Risk AI profile and execution-readiness state after login.
- Full-view comparison: blocked by authentication; the browser reached the login screen without a runtime crash.
- Focused comparison: not possible because the protected Risk AI component was not rendered.
- Primary interaction checks: TypeScript and production build verify the save and Paper AUTO handlers compile; authenticated clicks were not performed.
- Console errors: not available on the protected route in the isolated session.

### Code-level findings addressed

- [P0 fixed] The visible `Order execution: Disabled` value was hardcoded and unrelated to the real runtime.
- [P1 fixed] Example balance, entry, stop and contract values were presented beside a real Risk AI page.
- [P1 fixed] The page did not identify missing per-symbol sizing, execution permission, account or worker readiness.
- [P2 fixed] Mobile inputs did not provide an operational path from risk configuration to safe Paper AUTO activation.

### Fidelity surfaces

- Typography: existing Onkar AI font stack, weights and hierarchy retained.
- Spacing/layout: existing two-panel structure retained; mobile fields stack below 620px with full-width controls.
- Colors/tokens: existing navy glass surfaces and blue/teal/orange semantic states reused.
- Image quality: no image assets exist in the source Risk AI screen; existing Lucide system icons are retained.
- Copy/content: preview/sample language and hardcoded disabled state are removed; all status copy now derives from scanner runtime data.

final result: blocked

Blocker: authenticated browser state is required to capture and compare the rendered Risk AI page.
