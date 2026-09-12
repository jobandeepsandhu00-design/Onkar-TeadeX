import { useEffect, useMemo, useRef } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import type { Group } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AgentId } from "../agent-data";
import type { Agent3DModelAsset, Agent3DQuality, Agent3DState } from "./types";
import { useAgentAudioLevel } from "./useAgentAudioLevel";
import { AgentAnimator } from "./AgentAnimator";

export function AgentModel({
  agent,
  state,
  quality,
  model,
  interactive,
  reducedMotion,
  audioElement,
  onReady,
}: {
  agent: AgentId;
  state: Agent3DState;
  quality: Agent3DQuality;
  model: Agent3DModelAsset;
  interactive: boolean;
  reducedMotion: boolean;
  audioElement?: HTMLMediaElement | null;
  onReady?: () => void;
}) {
  const root = useRef<Group>(null);
  const reaction = useRef(0);
  const gltf = useGLTF(model.modelSrc, true);
  const scene = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, root);
  const audioLevel = useAgentAudioLevel(audioElement, state === "speaking");

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  return (
    <group
      ref={root}
      position={model.position ?? [0, -1.25, 0]}
      rotation={model.rotation ?? [0, 0, 0]}
      scale={model.scale ?? 1}
      onPointerDown={interactive ? (event) => {
        event.stopPropagation();
        reaction.current = event.point.x >= 0 ? 1 : -1;
      } : undefined}
    >
      <primitive object={scene} />
      <AgentAnimator
        root={root}
        scene={scene}
        actions={actions}
        state={state}
        quality={quality}
        agent={agent}
        reducedMotion={reducedMotion}
        interactive={interactive}
        audioLevel={audioLevel}
        reaction={reaction}
      />
    </group>
  );
}

