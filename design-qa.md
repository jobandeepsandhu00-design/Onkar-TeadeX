# Design QA — Onkar AI Setup Selection

- Source visual truth: `C:\Users\joban\.codex\codex-remote-attachments\01a07180-c785-7692-9b30-a7c170f1481f\D9EA4D36-200C-4891-AED6-B6920AC4C542\3-Photo-3.jpg`
- Implementation URL: `https://onkartradex.com/onkar-ai/strategies`
- Implementation screenshot: unavailable because the route requires an authenticated Supabase session and the verification browser is signed out.
- Source pixels: 589 × 1280. Intended CSS viewport: iPhone/mobile responsive. Density normalization: not applicable because an implementation capture could not be obtained.
- State: Onkar AI → AI Scanner → Rules, setup activation list.

## Full-view comparison evidence

The source was opened at original resolution. It shows the requested bulk activation panel and setup cards, but the Edit action opens the unwanted Advanced Setup Editor and only scanner-ready versions appear. The implementation removes that editor from the scanner, keeps bulk activation, lists every Setup Library item, and routes Edit to the existing Setup Library editor.

A combined source/implementation comparison could not be created because the in-app verification browser displayed the login screen at the production route.

## Focused-region comparison evidence

The source confirms the setup cards, switches, Edit buttons, and Advanced Setup Editor behavior. The authenticated implementation region could not be captured, so typography, spacing, and touch density remain unverified visually.

## Findings

- [P1] Authenticated implementation capture unavailable.
  - Location: Onkar AI → AI Scanner → Rules.
  - Evidence: production opens the Onkar TradeX login screen in the verification browser.
  - Impact: final mobile visual fidelity and the authenticated Edit transition cannot be signed off from browser evidence.
  - Fix: capture the signed-in Rules tab on the user's iPhone after refresh and compare it with the source.

## Required fidelity surfaces

- Fonts and typography: existing Onkar typography is retained; authenticated runtime verification is blocked.
- Spacing and layout rhythm: existing glass cards and mobile breakpoints are retained; a search row and unavailable-state rows were added.
- Colors and visual tokens: existing navy, cyan, teal, amber, border, and glass tokens are reused.
- Image quality and asset fidelity: no images or visual identity assets were replaced.
- Copy and content: setup activation is now the primary task; the advanced editor and historical version cards are removed from the scanner.
- Accessibility and interaction: labelled switches, disabled not-ready states, search, bulk actions, and direct edit navigation are implemented; authenticated interaction verification is blocked.

## Comparison history

- Pass 1: source inspected; production build, focused TypeScript check, and scanner tests passed. Production returned HTTP 200. Visual comparison blocked by authentication.

## Implementation checklist

1. Sign in on an iPhone and refresh the Rules tab.
2. Verify Activate all approved setups and individual setup switches.
3. Verify every Setup Library setup appears, including items that still need approved rules.
4. Verify Edit opens the selected item in the existing Setup Library.

final result: blocked
