# Design QA — Home Multi-Agent Command Center

## Evidence

- Source visual truth: `C:\Users\joban\.codex\codex-remote-attachments\01a07180-c785-7692-9b30-a7c170f1481f\051E2672-B46F-499A-9BAF-9FCC03C45153\1-Photo-1.jpg`
- Source pixels: 589 × 1280, including mobile browser chrome and a 589px-wide app surface.
- Implementation capture: Codex in-app Browser, `http://127.0.0.1:5188/`, tab 11.
- Implementation viewport: 390 × 844 CSS px, device pixel ratio 1.
- Combined comparison view inspected: `http://127.0.0.1:5188/design-qa`, 900 × 1200 CSS px.
- State: normal Home dashboard preview with Mool Mantar above, multi-agent replacement in the original AI-card position, and Market Overview continuing below.
- Density normalization: source was scaled to 390px display width; implementation stayed at native 390 CSS px.
- Primary interactions tested: direct Trend AI navigation to `/onkar-ai/scanner`; horizontal agent strip; Home-to-workspace handoff.
- Browser console errors: none.

## Full-view comparison

The replacement preserves the source dashboard's midnight-blue fintech palette, luminous blue border, compact radii, strong AI imagery, and premium CTA treatment. It deliberately changes the old single promotional hero into the requested command-center hierarchy: honest connection state, featured Master AI, specialist strip, activity, combined conclusion, and full-workspace CTA. Mool Mantar remains directly above and Market Overview continues directly below.

## Focused-region comparison

The Master AI and specialist strip were inspected at native mobile width. Robot portraits are correctly cropped to head/upper-body, status labels remain legible, the second specialist peeks into view to communicate horizontal swiping, and sample values are explicitly identified instead of appearing live. The detail is readable without a page-width overflow.

## Findings

- No P0, P1, or P2 issues remain.
- [P3] The activity/conclusion strip requires a horizontal swipe on mobile. This is intentional to keep the command center compact while preserving both panels.

## Required fidelity surfaces

- Fonts and typography: Sora/Inter hierarchy matches the existing OnkarTradex dashboard; compact labels retain readable weight and contrast.
- Spacing and layout rhythm: 14px outer dashboard rhythm is preserved; 12px internal spacing and 12–18px radii match the source card language.
- Colors and visual tokens: dark navy, electric blue, cyan, gold, green, purple and orange are reused through the existing scoped Onkar AI tokens.
- Image quality and asset fidelity: existing optimized 720px robot portraits are used with native dimensions, async decoding and lazy loading below the first visible cards; no placeholder avatars are present.
- Copy and content: all ten named agents, their roles, routes, sample activity, Master conclusion and manual-execution warning are represented. Unverified data is labeled Preview/Sample.

## Comparison history

1. Initial implementation: P2 excessive mobile height at 916px due to a single-column Master metric stack and vertically stacked support panels.
2. Fix: Master metrics changed to a compact two-column layout; activity and conclusion changed to a snap-scrolling mobile strip.
3. Post-fix evidence: command center measures 761px at 390px viewport width, document scroll width remains 375px within the browser's content area, all primary content remains readable, and existing Market Overview follows immediately afterward.

## Implementation checklist

- [x] Preserve all Home sections outside the existing Onkar AI slot.
- [x] Feature Master AI and expose all nine specialist agents.
- [x] Route every agent into an existing Onkar AI workspace destination.
- [x] Add lightweight image, glow, eye, halo and card motion.
- [x] Lazy-load lower specialist artwork and reserve image dimensions.
- [x] Support reduced motion.
- [x] Label unverified information as Preview/Sample.
- [x] Verify mobile rendering, navigation and console health.

final result: passed
