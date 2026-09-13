# Onkar AI character motion and voice

## Asset audit

All ten agents (Master, Trend, Zone, Setup, Risk, News, Backtest, Journal,
Insight, Execution) currently use 720×720 JPG portraits in
`artifacts/trading-os/public/onkar-ai/agents`. No matching separated raster,
Rive, Lottie, GLB or GLTF assets are present. The production 3D manifest is empty.

The immediate renderer is a **layered 2D illusion**, not a skeleton rig. Hand-aligned
eye socket masks preserve each original eye texture and close its aperture.
Eye masks live inside the head layer, so they follow the same subtle head motion.
The original sharp artwork stays underneath; torso motion is only 0.3% scale.
The glow animates opacity independently of blink transform (the old animation
overrode the blink). Each portrait has separate head/eye/chest coordinates.
No artificial mouth is painted onto a helmet or a static expressive face.

## Runtime

`agent-runtime.ts` is the shared in-memory state machine; `useAgentAnimationState`
subscribes per agent across Home and workspace. No sensitive report text is persisted
there. Progress comes from the authenticated Master endpoint's optional SSE events.
Those events contain agent, operational state, run ID and timestamp only, never
private reasoning. Existing JSON callers continue to work. Review of stored evidence
is labelled **reviewing**, not live scanning. A queued scan is not an active scan.
Backtest and candidate-explanation requests also update their corresponding avatars.
No autonomous order execution is added.

Initial cards remain Preview; unknown/unavailable agents dim. Only invoked agents
receive completion states. Completed success fades to idle; stale request tokens are
ignored; failed/aborted streams cannot leave work running. Final response receipt is
not itself speech. Master/Insight animate speaking only while device voice is playing.
The current OpenAI response is not token-streamed; the SSE stream carries operational
events, followed by the completed report.

## Voice

`AgentVoiceProvider` can be replaced with another TTS provider without changing
avatar components. The current provider uses browser SpeechSynthesis with available
English/system voices and conservative role-specific pitch/rate. One global manager
cancels the previous agent before another speaks. Auto-speak is OFF by default.
Device voice controls include enable/disable, auto-speak, speed and volume. Preferences
alone are stored locally. Voice stops on page hiding, logout, explicit Stop, error,
or timeout. Browser voice availability and permission vary; iPhone may require a
Read aloud tap. No microphone input is requested or recorded.

SpeechSynthesis does not expose an audio waveform. Its visor/waveform animation is
procedural, **not phoneme lip sync**. The existing HTMLMediaElement analyser bridge
supports actual audio amplitude when a future playback provider supplies an element.
That bridge should not be used twice for the same media element.

## Performance / accessibility

IntersectionObserver and document visibility pause offscreen blink timers and motion.
Thumbnail mode disables movement; preview uses lightweight layers; full uses available
registered 3D assets or the same preserved layered artwork. No new animation dependency
or robot asset is downloaded. Respect system reduced motion: no head/body movement,
CSS loops or camera drift; keep state labels and the static speaking indicator.

## Future asset contract

Keep matching licensed GLBs in the existing `3d/modelManifest.ts`. The existing engine
lazy-loads its scene and enforces a renderer budget; see `3d/types.ts` for supported
Head, Neck, Chest, shoulders/arm/hand bones, Idle/Thinking/Scanning/Speaking clips,
and Blink/Smile/Talk morph targets. Actual independent arm gestures and expressive
mouth articulation require those assets. Do not register a generic replacement.
The avatar asset discriminated union reserves a Rive state-machine adapter; Rive
currently uses the honest raster fallback until matching artwork and a runtime exist.

## Verification

- `pnpm --filter @workspace/trading-os typecheck:scanner`
- `pnpm --filter @workspace/api-server typecheck:scanner`
- From api-server: `pnpm exec tsx --test ../trading-os/src/onkar-ai/__tests__/*.test.ts`
- `node scripts/onkar-ai-preview.mjs` for isolated UI (no production credentials/data).
- Check Home and `/onkar-ai` at 390×844; inspect every agent, swipe the specialist
  strip, then verify blink closure, speaking/stop, unavailable state and reduced motion.
- Headless voice tests use a fake device provider; actual iPhone voice quality and
  permission behavior require a real device. Never claim live backend success from
  the isolated preview.
