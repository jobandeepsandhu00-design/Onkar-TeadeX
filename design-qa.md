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
