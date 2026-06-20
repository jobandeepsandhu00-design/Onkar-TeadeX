---
name: Feature Hub architecture
description: How the 50-feature hub is structured in App.tsx and MoreTab
---

## Rule
FEATURES_CATALOG (50 items, 25 free + 25 paid) is defined as a module-level const before MoreTab.
FeatureHubPanel is the container component rendered at More → AI Lab.
enabledFeatures: Record<string,boolean> lives in DEFAULT_SETTINGS and settings.

## Critical constraint — React hooks in switch
renderFeaturePanel() uses a switch/case pattern. Any feature panel that needs local state
MUST be extracted into its own named component (e.g. AIChatFeaturePanel, ConfluenceScorerPanel)
and called from the switch case. Never use useState() inside a switch case — it violates
React's rules of hooks and causes silent runtime bugs.

**Why:** Found this bug when aiChat and confluenceScorer used useState inside switch cases.
Fixed by extracting to AIChatFeaturePanel and ConfluenceScorerPanel components.

## How to apply
When adding new paid feature panels that need local state (text inputs, etc.),
always create a named sub-component above FeatureHubPanel and reference it in the switch.
