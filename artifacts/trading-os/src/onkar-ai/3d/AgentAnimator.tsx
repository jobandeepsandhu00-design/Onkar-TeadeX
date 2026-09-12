import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { AnimationAction, Group, Mesh, MeshStandardMaterial, Object3D } from "three";
import { MathUtils } from "three";
import type { AgentId } from "../agent-data";
import { AGENT_CLIP_CANDIDATES, type Agent3DQuality, type Agent3DState } from "./types";

type MorphControl = {
  influences: number[];
  dictionary: Record<string, number>;
};

type LightMaterial = MeshStandardMaterial & { emissiveIntensity: number };

const BONE_ALIASES = {
  head: ["head", "headbone"],
  neck: ["neck", "neckbone"],
  chest: ["chest", "spine02", "spine2", "upperchest"],
  shoulderL: ["shoulderl", "leftshoulder", "claviclel"],
  shoulderR: ["shoulderr", "rightshoulder", "clavicler"],
} as const;

function normalized(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findBone(root: Object3D, aliases: readonly string[]) {
  let result: Object3D | null = null;
  root.traverse((node) => {
    if (!result && aliases.includes(normalized(node.name))) result = node;
  });
  return result as Object3D | null;
}

function findClip(
  actions: Record<string, AnimationAction | null>,
  state: Agent3DState,
) {
  const names = Object.keys(actions);
  for (const candidate of AGENT_CLIP_CANDIDATES[state]) {
    const match = names.find((name) => normalized(name) === normalized(candidate));
    if (match && actions[match]) return actions[match];
  }
  return null;
}

function setMorph(control: MorphControl, names: readonly string[], value: number) {
  for (const name of names) {
    const index = control.dictionary[name] ?? control.dictionary[normalized(name)];
    if (typeof index === "number") control.influences[index] = MathUtils.lerp(control.influences[index] ?? 0, value, 0.42);
  }
}

export function AgentAnimator({
  root,
  scene,
  actions,
  state,
  quality,
  agent,
  reducedMotion,
  interactive,
  audioLevel,
  reaction,
}: {
  root: RefObject<Group | null>;
  scene: Object3D;
  actions: Record<string, AnimationAction | null>;
  state: Agent3DState;
  quality: Agent3DQuality;
  agent: AgentId;
  reducedMotion: boolean;
  interactive: boolean;
  audioLevel: RefObject<number>;
  reaction: RefObject<number>;
}) {
  const pointer = useThree((store) => store.pointer);
  const blink = useRef(0);
  const blinkTarget = useRef(0);
  const nextBlink = useRef(3 + Math.random() * 4);
  const baseRootY = useRef<number | null>(null);

  const rig = useMemo(() => ({
    head: findBone(scene, BONE_ALIASES.head),
    neck: findBone(scene, BONE_ALIASES.neck),
    chest: findBone(scene, BONE_ALIASES.chest),
    shoulderL: findBone(scene, BONE_ALIASES.shoulderL),
    shoulderR: findBone(scene, BONE_ALIASES.shoulderR),
  }), [scene]);

  const morphs = useMemo(() => {
    const controls: MorphControl[] = [];
    scene.traverse((node) => {
      const mesh = node as Mesh & { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] };
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      const dictionary: Record<string, number> = { ...mesh.morphTargetDictionary };
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) dictionary[normalized(name)] = index;
      controls.push({ dictionary, influences: mesh.morphTargetInfluences });
    });
    return controls;
  }, [scene]);

  const lightMaterials = useMemo(() => {
    const materials = new Set<LightMaterial>();
    scene.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh || !/(eye|visor|core|chest|light)/i.test(mesh.name)) return;
      const entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of entries) {
        const lit = material as LightMaterial;
        if ("emissiveIntensity" in lit) materials.add(lit);
      }
    });
    return [...materials];
  }, [scene]);

  useEffect(() => {
    const next = findClip(actions, state);
    if (!next) return;
    next.reset().fadeIn(0.35).play();
    return () => {
      next.fadeOut(0.3);
    };
  }, [actions, state]);

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime();
    if (state === "offline") return;

    if (!reducedMotion) {
      nextBlink.current -= delta;
      if (nextBlink.current <= 0 && blinkTarget.current === 0) {
        blinkTarget.current = 1;
        nextBlink.current = 3 + Math.random() * 4;
      }
      blink.current = MathUtils.damp(blink.current, blinkTarget.current, 32, delta);
      if (blinkTarget.current === 1 && blink.current > 0.88) blinkTarget.current = 0;

      const previewLimit = quality === "full" ? 1 : 0.38;
      const yawLimit = MathUtils.degToRad((quality === "full" ? 15 : 5) * previewLimit);
      const pitchLimit = MathUtils.degToRad((quality === "full" ? 8 : 3) * previewLimit);
      const stateScan = state === "scanning" ? Math.sin(elapsed * 0.72) * yawLimit * 0.7 : 0;
      const pointerYaw = interactive ? MathUtils.clamp(pointer.x * yawLimit, -yawLimit, yawLimit) : 0;
      const pointerPitch = interactive ? MathUtils.clamp(-pointer.y * pitchLimit, -pitchLimit, pitchLimit) : 0;
      const thinkingPitch = state === "thinking" ? MathUtils.degToRad(2.5) : 0;
      const reactionYaw = reaction.current * MathUtils.degToRad(2.4);

      if (rig.head) {
        rig.head.rotation.y = MathUtils.damp(rig.head.rotation.y, stateScan + pointerYaw + reactionYaw, 3.2, delta);
        rig.head.rotation.x = MathUtils.damp(rig.head.rotation.x, pointerPitch + thinkingPitch, 3.2, delta);
      }
      if (rig.neck) rig.neck.rotation.y = MathUtils.damp(rig.neck.rotation.y, (stateScan + pointerYaw) * 0.35, 2.4, delta);
      if (rig.chest) rig.chest.scale.y = 1 + Math.sin(elapsed * 1.15) * 0.0035;
      if (rig.shoulderL) rig.shoulderL.rotation.z += Math.sin(elapsed * 0.78) * 0.00004;
      if (rig.shoulderR) rig.shoulderR.rotation.z -= Math.sin(elapsed * 0.78) * 0.00004;
      reaction.current = MathUtils.damp(reaction.current, 0, 4.5, delta);
    }

    const voice = state === "speaking" ? Math.max(audioLevel.current, 0.12 + Math.abs(Math.sin(elapsed * 8.2)) * 0.16) : 0;
    for (const control of morphs) {
      setMorph(control, ["Blink", "BlinkLeft", "BlinkRight"], reducedMotion ? 0 : blink.current);
      setMorph(control, ["Smile"], state === "success" ? 0.72 : agent === "insight" && state === "idle" ? 0.28 : 0);
      setMorph(control, ["Talk_A", "Talk_E", "Talk_I", "Talk_O", "Talk_U"], voice);
    }

    const lightBoost = state === "scanning" ? 0.55 : state === "alert" || state === "warning" ? 0.9 : state === "speaking" ? voice : 0.2;
    for (const material of lightMaterials) material.emissiveIntensity = 1.1 + lightBoost + Math.sin(elapsed * 2.1) * 0.12;

    if (root.current && !reducedMotion) {
      if (baseRootY.current === null) baseRootY.current = root.current.position.y;
      root.current.position.y = baseRootY.current + Math.sin(elapsed * 0.62) * 0.006;
    }
  });

  return null;
}
