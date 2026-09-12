import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, Preload } from "@react-three/drei";
import type { Agent3DProps } from "./types";
import { AgentLights } from "./AgentLights";
import { AgentModel } from "./AgentModel";

type SceneProps = Required<Pick<Agent3DProps, "agent" | "state" | "quality" | "interactive" | "reducedMotion">>
  & Pick<Agent3DProps, "audioElement" | "onReady">
  & { model: NonNullable<Agent3DProps["model"]> };

export default function AgentScene({
  agent,
  state,
  quality,
  model,
  interactive,
  reducedMotion,
  audioElement,
  onReady,
}: SceneProps) {
  const dpr: [number, number] = quality === "full" ? [1, 1.75] : [0.75, 1.25];
  const cameraPosition: [number, number, number] = quality === "full" ? [0, 1.25, 4.4] : [0, 1.35, 3.5];

  return (
    <Canvas
      className="oai-agent3d-canvas"
      dpr={dpr}
      camera={{ position: cameraPosition, fov: quality === "full" ? 31 : 28, near: 0.1, far: 40 }}
      gl={{ alpha: true, antialias: quality === "full", powerPreference: "high-performance" }}
      frameloop={state === "offline" ? "demand" : "always"}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
    >
      <AgentLights agent={agent} state={state} />
      <AgentModel
        agent={agent}
        state={state}
        quality={quality}
        model={model}
        interactive={interactive}
        reducedMotion={reducedMotion}
        audioElement={audioElement}
        onReady={onReady}
      />
      <AdaptiveDpr pixelated={false} />
      {quality === "full" ? <Preload all /> : null}
    </Canvas>
  );
}

