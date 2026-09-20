# Design QA — Onkar AI Rules Control Center

- Source visual truth: `C:\Users\joban\.codex\codex-remote-attachments\01a07180-c785-7692-9b30-a7c170f1481f\5F79469D-D6F2-4FA2-8ABD-14322E252AA4\3-Photo-3.jpg`
- Implementation screenshot: unavailable because the Rules route requires the user's authenticated Supabase session and the verification browser is signed out.
- Intended viewport: mobile-first, approximately 589 × 1280 source pixels; responsive desktop layout retained.
- State: Rules tab with existing approved Setup Library versions and scanner configuration.

## Full-view comparison evidence

The source was opened at original resolution. Its main P1 usability issue is that immutable-version authoring fields appear immediately after the Rules tab, forcing users through direction, timeframe, R:R, symbols, sessions, and execution permission before they can manage which setups are active.

The implementation changes the information hierarchy in code to: automatic rule summary, three bulk setup actions, compact newest-version setup rows, bulk market selection, and a collapsed advanced editor. A browser-rendered authenticated screenshot was not available, so an actual combined visual comparison could not be completed.

## Focused-region comparison evidence

Source evidence confirms the lengthy setup form and simple/advanced rule cards occupy multiple mobile screens. The corresponding rendered implementation region could not be captured without an authenticated session.

## Findings

- [P1] Authenticated implementation capture unavailable.
  - Location: Onkar AI → AI Scanner → Rules.
  - Evidence: the verification browser displays the login screen; no credentials were used or requested.
  - Impact: final typography, fold position, and touch-density cannot be visually signed off.
  - Fix: after deployment, capture the signed-in Rules tab at the user's iPhone viewport and compare it with the source screenshot.

## Required fidelity surfaces

- Fonts and typography: existing Onkar typography and token hierarchy are reused; runtime visual verification blocked.
- Spacing and layout rhythm: bulk cards use the existing scanner grid, radius, and mobile breakpoints; runtime visual verification blocked.
- Colors and visual tokens: existing navy, cyan, teal, border, and glass tokens are reused.
- Image quality and asset fidelity: no new imagery or replacement assets are introduced.
- Copy and content: bulk actions are explicit; detailed rule language remains in the optional editor.
- Accessibility and interaction: semantic buttons, labelled switches, disabled/loading states, and reduced-motion behavior are retained; authenticated interaction verification blocked.

## Comparison history

- Pass 1: source inspected; implementation build and typechecks passed. Visual comparison blocked by authenticated state.

## Implementation checklist

1. Deploy the verified build.
2. Open the authenticated Rules tab on iPhone.
3. Verify Select all approved, Custom selection, Pause all setups, setup Edit, market chips, and advanced-editor expansion.
4. Capture and perform final visual comparison.

final result: blocked
