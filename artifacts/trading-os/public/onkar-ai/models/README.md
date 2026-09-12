# Onkar AI rigged model contract

This directory intentionally contains no generic models. The existing branded
robot JPG portraits remain the production fallback until matching, licensed,
optimized GLB assets are supplied.

## Expected files

One recognizable model per agent: `master.glb`, `trend.glb`, `zone.glb`,
`setup.glb`, `risk.glb`, `news.glb`, `backtest.glb`, `journal.glb`,
`insight.glb`, and `execution.glb`.

Register a completed model in `src/onkar-ai/3d/modelManifest.ts`. Never add a
manifest entry before the corresponding file exists and passes visual QA.

## Rig contract

Required core bones: Root, Pelvis, Spine, Chest, Neck, Head, left/right
shoulder, upper arm, lower arm, and hand. Eye bones are recommended. Expressive
agents may expose BlinkLeft, BlinkRight, Blink, Smile, Neutral, Talk_A, Talk_E,
Talk_I, Talk_O, and Talk_U morph targets. Helmet agents should use emissive
meshes named with `eye`, `visor`, `core`, `chest`, or `light` instead of a mouth.

Animation clips should use recognizable names such as Idle, IdleVariation,
Listening, Thinking, Scanning, Speaking, Success, Warning, Alert, Explain,
Present, Protect, or Analyze. The runtime selects the best available clip and
blends between states.

## Delivery targets

- GLB/GLTF, licensed for production use
- Draco or Meshopt geometry compression
- KTX2/Basis textures
- 1K textures for mobile; 2K only for desktop full views
- Approximately 2–8 MB per optimized agent
- Head/upper-torso framing must match the existing portrait identity

