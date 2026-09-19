# Design QA — Onkar AI account command carousel

- Source visual truth: `C:\Users\joban\.codex\codex-remote-attachments\01a07180-c785-7692-9b30-a7c170f1481f\FCE0C687-907E-4C4C-979F-FEBFE64E49F6\1-Photo-1.jpg`
- Implementation screenshot: unavailable — the configured in-app browser returned `Browser is not available: iab` while the local Vite server was running.
- Intended viewport: mobile-first, 390 × 844 CSS px; desktop responsive layout also implemented.
- Source pixels: 720 × 1280.
- Implementation pixels / density normalization: unavailable because browser capture was blocked.
- State: connected MT5 account when configured; stored/disconnected account otherwise. No sample values are injected.

## Full-view comparison evidence

The source reference was opened and inspected. It uses a dominant center account card, partially visible adjacent cards, luminous navy/cyan borders, large balance hierarchy, active-trade metrics, progress, pagination, and compact operational statistics. The implementation maps those same regions in `AccountCommandCarousel`, including touch swipe, previous/next controls, pagination dots, three-dimensional side-card transforms, account metrics, broker position metrics, and real empty/disconnected states.

A browser-rendered implementation image could not be captured, so a valid combined visual comparison was not possible. Code inspection and successful production compilation are not substitutes for that comparison.

## Focused-region comparison evidence

Blocked with the full-view capture. The intended focused regions are the account-card header/status, trade metric row, progress treatment, and mobile side-card crop.

## Findings

- [P1] Browser-rendered visual evidence is unavailable.
  - Location: local OnkarTradex Watchlist / account carousel.
  - Evidence: local Vite server started successfully, but the available computer-use browser rejected creation with `Browser is not available: iab`.
  - Impact: typography, exact mobile crop, touch-state appearance, and above-the-fold proportions cannot be signed off visually.
  - Fix: capture the authenticated Watchlist at 390 × 844 and compare it alongside the source reference before deployment.

## Required fidelity surfaces

- Fonts and typography: implemented with the application font stack and responsive display sizes; browser verification blocked.
- Spacing and layout rhythm: center/side card proportions, mobile padding, swipe stats, and safe-area sheet spacing implemented; browser verification blocked.
- Colors and visual tokens: dark navy glass, cyan/blue/green semantic glow, muted disconnected treatment implemented; browser verification blocked.
- Image quality and asset fidelity: the account card deliberately contains real data UI rather than invented mountain artwork or CSS illustration. No fake product imagery was introduced.
- Copy and content: all values are sourced from existing account, MT5 position, and journal records; unavailable values render as explicit empty/disconnected states.
- Accessibility/interaction: semantic buttons, labels, disabled states, touch swipe, reduced-motion override, and keyboard-reachable controls are present; runtime UI test blocked.

## Comparison history

- Pass 1: blocked before comparison because no supported browser surface was available. No visual fixes were inferred from code alone.

## Implementation checklist

1. Open the authenticated Market Scanner Watchlist in a supported browser.
2. Capture 390 × 844 and desktop 1440 × 1000 states with a connected and disconnected MT5 account.
3. Compare the mobile capture alongside the source image.
4. Correct any P0/P1/P2 crop, typography, overlap, or control-density issue before deployment.

final result: blocked
