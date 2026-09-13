import {
  memo,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useId,
} from "react";
import { motion, useInView } from "framer-motion";
import type { AgentId } from "./agent-data";
import { AgentMotionLayer, type AgentVisualState } from "./motion";
import { Agent3D } from "./3d/Agent3D";
import { getAgent3DModel } from "./3d/modelManifest";
import type { Agent3DState } from "./3d/types";
import { ROBOT_PROFILES } from "./robot-profiles";
import { useAgentAnimationState, useDocumentVisible, useReducedMotionPreference } from "./useAgentAnimationState";

export type AgentAvatarState =
  | AgentVisualState
  | "listening"
  | "monitoring"
  | "speaking"
  | "warning"
  | "offline";

export type AgentAvatarAsset =
  | { kind: "layered-raster"; src: string }
  | { kind: "rive"; src: string; fallbackSrc: string; stateMachine?: string }
  | { kind: "gltf"; src: string; fallbackSrc: string };

type AvatarGeometry = {
  eyeTop: string;
  eyeLeft: string;
  eyeRight: string;
  eyeWidth: string;
  eyeHeight: string;
  headX: string;
  headY: string;
  headRadiusX: string;
  headRadiusY: string;
  chestX: string;
  chestY: string;
};

const DEFAULT_GEOMETRY: AvatarGeometry = {
  eyeTop: "29.4%",
  eyeLeft: "38.2%",
  eyeRight: "38.2%",
  eyeWidth: "8.4%",
  eyeHeight: "2.5%",
  headX: "50%",
  headY: "30%",
  headRadiusX: "28%",
  headRadiusY: "29%",
  chestX: "50%",
  chestY: "67%",
};

const GEOMETRY: Partial<Record<AgentId, Partial<AvatarGeometry>>> = {
  master: { eyeTop: "28.7%", eyeLeft: "39%", eyeRight: "37.1%", eyeWidth: "7.5%", chestY: "66.7%" },
  trend: { eyeTop: "29.1%", eyeLeft: "33%", eyeRight: "31.5%", eyeWidth: "16.5%", eyeHeight: "2.1%" },
  zone: { eyeTop: "28.5%", eyeLeft: "43.7%", eyeRight: "31.1%", eyeWidth: "8.2%", chestX: "60%", chestY: "72.5%" },
  setup: { eyeTop: "27.5%", eyeLeft: "45.1%", eyeRight: "28.7%", eyeWidth: "8.1%", chestX: "61.5%", chestY: "65.5%" },
  risk: { eyeTop: "27.6%", eyeLeft: "42.4%", eyeRight: "30.8%", eyeWidth: "9.1%", chestX: "61%", chestY: "70.4%" },
  news: { eyeTop: "28.3%", eyeLeft: "44.1%", eyeRight: "32.1%", eyeWidth: "7.7%", headX: "54%", chestX: "61%", chestY: "68%" },
  backtest: { eyeTop: "27.2%", eyeLeft: "43.5%", eyeRight: "31.8%", eyeWidth: "8.3%", headX: "54%", chestX: "61%", chestY: "70%" },
  journal: { eyeTop: "29.3%", eyeLeft: "38.6%", eyeRight: "36.8%", eyeWidth: "8.5%", headX: "51%", headY: "30%", chestX: "59.5%", chestY: "69%" },
  insight: { eyeTop: "29.2%", eyeLeft: "45.2%", eyeRight: "35.5%", eyeWidth: "6.7%", headX: "53%", headY: "29%", chestX: "52%", chestY: "70%" },
  execution: { eyeTop: "27.3%", eyeLeft: "42.7%", eyeRight: "31.1%", eyeWidth: "9.3%", eyeHeight: "2.1%", chestX: "57.5%", chestY: "70%" },
};

// Current expressive portraits have painted mouths, not articulated faces.
// Use the adjacent speech waveform until a real face rig is registered.

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function useAgentExpressionController({
  rootRef,
  state,
  visible,
  reducedMotion,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  state: AgentAvatarState;
  visible: boolean;
  reducedMotion: boolean;
}) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !visible || reducedMotion || state === "offline" || state === "disabled") return;

    let timeout = 0;
    let cancelled = false;
    const schedule = () => {
      const delay = randomBetween(3000, 7000);
      timeout = window.setTimeout(() => {
        if (cancelled) return;
        const closeTime = randomBetween(100, 180);
        root.dataset.blinking = "true";
        timeout = window.setTimeout(() => {
          root.dataset.blinking = "false";
          const doubleBlink = Math.random() < 0.18;
          if (!doubleBlink) {
            schedule();
            return;
          }
          timeout = window.setTimeout(() => {
            root.dataset.blinking = "true";
            timeout = window.setTimeout(() => {
              root.dataset.blinking = "false";
              schedule();
            }, randomBetween(100, 160));
          }, randomBetween(120, 210));
        }, closeTime + 45);
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      delete root.dataset.blinking;
    };
  }, [reducedMotion, rootRef, state, visible]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !visible || reducedMotion || state === "offline" || state === "disabled") return;
    let timeout = 0;
    let cancelled = false;
    const schedule = () => {
      timeout = window.setTimeout(() => {
        if (cancelled) return;
        const direction = Math.random() < 0.48 ? "center" : Math.random() < 0.5 ? "left" : "right";
        root.dataset.gaze = direction;
        schedule();
      }, randomBetween(2600, 5200));
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      delete root.dataset.gaze;
    };
  }, [reducedMotion, rootRef, state, visible]);
}

function useAvatarStageLayout(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const { width, height } = root.getBoundingClientRect();
      const size = Math.max(width, height);
      const x = (width - size) / 2;
      const y = width > height ? (height - size) * 0.27 : 0;
      root.style.setProperty("--robot-stage-size", `${size}px`);
      root.style.setProperty("--robot-stage-x", `${x}px`);
      root.style.setProperty("--robot-stage-y", `${y}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);
}

type AudioGraph = {
  context: AudioContext;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
};
const audioGraphs = new WeakMap<HTMLMediaElement, AudioGraph>();

/** Optional bridge for a future voice response. It writes amplitude to CSS without React re-renders. */
export function useAudioReactiveLevel(
  audioElement: HTMLMediaElement | null | undefined,
  targetRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const target = targetRef.current;
    if (!audioElement || !target || !enabled || typeof window === "undefined") return;
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) return;
    let frame = 0;
    let graph = audioGraphs.get(audioElement);

    const start = () => {
      try {
        if (!graph) {
          const context = new AudioContextCtor();
          const analyser = context.createAnalyser();
          analyser.fftSize = 64;
          const source = context.createMediaElementSource(audioElement);
          source.connect(analyser);
          analyser.connect(context.destination);
          graph = { context, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
          audioGraphs.set(audioElement, graph);
        }
        void graph.context.resume();
        const draw = () => {
          if (!graph || audioElement.paused) return;
          graph.analyser.getByteFrequencyData(graph.data);
          let sum = 0;
          for (const sample of graph.data) sum += sample;
          target.style.setProperty("--robot-audio-level", String(Math.min(1, sum / graph.data.length / 150)));
          frame = window.requestAnimationFrame(draw);
        };
        window.cancelAnimationFrame(frame);
        draw();
      } catch {
        target.style.setProperty("--robot-audio-level", "0.35");
      }
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      target.style.setProperty("--robot-audio-level", "0");
    };
    audioElement.addEventListener("play", start);
    audioElement.addEventListener("pause", stop);
    audioElement.addEventListener("ended", stop);
    if (!audioElement.paused) start();
    return () => {
      stop();
      audioElement.removeEventListener("play", start);
      audioElement.removeEventListener("pause", stop);
      audioElement.removeEventListener("ended", stop);
    };
  }, [audioElement, enabled, targetRef]);
}

export function RobotBodyLayer({
  src,
  alt,
  animateBody,
  quality,
}: {
  src: string;
  alt: string;
  animateBody: boolean;
  quality: "featured" | "card";
}) {
  const lift = quality === "featured" ? -0.45 : -0.2;
  const breath = 1.003;
  return (
    <motion.span
      className="oai-robot-body-layer"
      aria-hidden="true"
      animate={animateBody ? { scaleY: [1, breath, 1], y: [0, lift, 0] } : { scaleY: 1, y: 0 }}
      transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut" }}
    >
      <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      <i className="oai-robot-shoulder oai-robot-shoulder-left" />
      <i className="oai-robot-shoulder oai-robot-shoulder-right" />
      <span className="sr-only">{alt}</span>
    </motion.span>
  );
}

export function RobotHeadLayer({
  src,
  animateHead,
  state,
  quality,
  children,
}: {
  src: string;
  animateHead: boolean;
  state: AgentAvatarState;
  quality: "featured" | "card";
  children?: ReactNode;
}) {
  const turn = quality === "featured" ? 1.5 : 0.8;
  const nod = quality === "featured" ? 0.7 : 0.4;
  const animation = useMemo(() => {
    if (!animateHead) return { rotateX: 0, rotateY: 0, x: 0, y: 0 };
    if (state === "scanning") return { rotateY: [-turn, 0, turn, 0], rotateX: [0, -nod * 0.45, 0, 0], x: [-1, 0, 1, 0] };
    if (state === "thinking") return { rotateY: [0, -turn * 0.5, turn * 0.3, 0], rotateX: [0, nod, nod, 0], y: [0, 1, 1, 0] };
    if (state === "speaking") return { rotateY: [-turn * 0.35, turn * 0.42, -turn * 0.2], rotateX: [0, -nod * 0.35, nod * 0.25], y: [0, -0.7, 0] };
    if (state === "alert") return { rotateY: [0, -turn * 0.65, turn * 0.65, 0], rotateX: [0, -nod * 0.5, 0] };
    return { rotateY: [-turn * 0.78, turn * 0.62, -turn * 0.25, -turn * 0.78], rotateX: [0, nod * 0.55, -nod * 0.28, 0], x: [-0.6, 0.5, 0, -0.6] };
  }, [animateHead, nod, state, turn]);

  return (
    <motion.span
      className="oai-robot-head-layer"
      aria-hidden="true"
      animate={animation}
      transition={{ duration: state === "scanning" ? 5.2 : state === "speaking" ? 2.6 : 7.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      {children}
    </motion.span>
  );
}

export function RobotEyeLayer({ agentId, src }: { agentId: AgentId; src: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="oai-robot-eye-svg" viewBox="0 0 720 720" aria-hidden="true" data-eye-profile={agentId}>
      {ROBOT_PROFILES[agentId].eyes.map((eye, index) => <g key={index}>
        <defs><clipPath id={`${id}-eye-${index}`}><path d={eye.path} /></clipPath></defs>
        <g clipPath={`url(#${id}-eye-${index})`}>
          <path d={eye.path} fill="#071019" />
          <g className="oai-eye-aperture" style={{ transformOrigin: `${eye.center[0]}px ${eye.center[1]}px` }}>
            <image href={src} width="720" height="720" />
            <path className="oai-eye-luminance" d={eye.path} />
          </g>
        </g>
      </g>)}
    </svg>
  );
}

export function RobotMouthLayer({ expressive }: { expressive: boolean }) {
  if (!expressive) return null;
  return (
    <span className="oai-robot-mouth" aria-hidden="true">
      <i /><i /><i /><i /><i />
    </span>
  );
}

export function AgentGlowLayer() {
  return (
    <span className="oai-robot-glow-layer" aria-hidden="true">
      <i className="oai-robot-chest-core" />
      <i className="oai-robot-chest-ring" />
      <i className="oai-robot-platform-light" />
    </span>
  );
}

export function AgentScanLayer({ agentId, state, detail }: { agentId: AgentId; state: AgentVisualState; detail: boolean }) {
  return (
    <span className="oai-robot-scan-layer" aria-hidden="true">
      <AgentMotionLayer agent={agentId} state={state} detail={detail} />
      <i className="oai-robot-face-grid" />
      <i className="oai-robot-scan-beam" />
      {agentId === "master" ? <span className="oai-robot-master-nodes">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span> : null}
      {agentId === "news" ? <span className="oai-robot-news-ticker">CPI · CALENDAR · EVENT FILTER</span> : null}
      {agentId === "execution" ? <span className="oai-robot-route-nodes"><i /><i /><i /><i /></span> : null}
      {agentId === "backtest" ? <span className="oai-robot-replay-track"><i /></span> : null}
    </span>
  );
}

function resolveMotionState(state: AgentAvatarState): AgentVisualState {
  if (state === "monitoring") return "active";
  if (state === "listening") return "active";
  if (state === "speaking") return "active";
  if (state === "warning") return "alert";
  if (state === "offline") return "disabled";
  return state;
}

function resolve3DState(state: AgentAvatarState): Agent3DState {
  if (state === "disabled") return "offline";
  if (state === "monitoring" || state === "active") return "idle";
  return state;
}

type AnimatedAgentAvatarProps = {
  agentId: AgentId;
  agentType?: AgentId;
  state?: AgentAvatarState;
  isSpeaking?: boolean;
  isSelected?: boolean;
  reducedMotion?: boolean;
  image?: string;
  asset?: AgentAvatarAsset;
  alt: string;
  quality?: "featured" | "card" | "thumbnail" | "preview" | "full";
  visible?: boolean;
  loading?: "eager" | "lazy";
  className?: string;
  audioElement?: HTMLMediaElement | null;
  children?: ReactNode;
};

export const AnimatedAgentAvatar = memo(function AnimatedAgentAvatar({
  agentId,
  agentType = agentId,
  state,
  isSpeaking = false,
  isSelected = false,
  reducedMotion,
  image,
  asset,
  alt,
  quality = "card",
  loading = "lazy",
  className = "",
  audioElement,
  children,
  visible: suppliedVisible = true,
}: AnimatedAgentAvatarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const systemReducedMotion = useReducedMotionPreference();
  const reduce = Boolean(reducedMotion || systemReducedMotion);
  const inView = useInView(rootRef, { amount: 0.16, margin: "0px" });
  const documentVisible = useDocumentVisible();
  const visible = inView && documentVisible && suppliedVisible;
  const runtime = useAgentAnimationState(agentId);
  const resolvedState: AgentAvatarState = runtime.isSpeaking || isSpeaking ? "speaking" : runtime.confirmed || runtime.state === "listening" || runtime.isWorking ? runtime.state : state ?? "idle";
  const renderQuality = quality === "full" || quality === "featured" ? "featured" : "card";
  const source = asset?.kind === "layered-raster" ? asset.src : asset?.fallbackSrc ?? image ?? "";
  const registeredModel = getAgent3DModel(agentType);
  const model3d = asset?.kind === "gltf"
    ? { agentId: agentType, modelSrc: asset.src, posterSrc: asset.fallbackSrc }
    : registeredModel;
  const geometry = { ...DEFAULT_GEOMETRY, ...GEOMETRY[agentType] };
  const geometryStyle = {
    "--robot-eye-top": geometry.eyeTop,
    "--robot-eye-left": geometry.eyeLeft,
    "--robot-eye-right": geometry.eyeRight,
    "--robot-eye-width": geometry.eyeWidth,
    "--robot-eye-height": geometry.eyeHeight,
    "--robot-head-x": geometry.headX,
    "--robot-head-y": geometry.headY,
    "--robot-head-rx": geometry.headRadiusX,
    "--robot-head-ry": geometry.headRadiusY,
    "--robot-chest-x": geometry.chestX,
    "--robot-chest-y": geometry.chestY,
    "--robot-head-clip": ROBOT_PROFILES[agentType].head,
    "--robot-core-x": `${ROBOT_PROFILES[agentType].chest[0] / 7.2}%`,
    "--robot-core-y": `${ROBOT_PROFILES[agentType].chest[1] / 7.2}%`,
    "--robot-breath-duration": `${ROBOT_PROFILES[agentType].breath}s`,
  } as CSSProperties;

  useAgentExpressionController({ rootRef, state: resolvedState, visible: visible && quality !== "thumbnail", reducedMotion: reduce });
  useAvatarStageLayout(rootRef);
  useAudioReactiveLevel(audioElement, rootRef as RefObject<HTMLElement | null>, visible && !reduce && resolvedState === "speaking");

  const animated = visible && !reduce && quality !== "thumbnail" && resolvedState !== "offline" && resolvedState !== "disabled";
  return (
    <div
      ref={rootRef}
      className={`oai-robot-avatar ${className}`}
      style={geometryStyle}
      data-agent={agentType}
      data-state={resolvedState}
      data-quality={renderQuality}
      data-reduced-motion={reduce ? "true" : "false"}
      data-animation-tier={quality}
      data-selected={isSelected ? "true" : "false"}
      data-visible={visible ? "true" : "false"}
      data-paused={!animated ? "true" : "false"}
      data-renderer={model3d ? "gltf" : asset && asset.kind !== "layered-raster" ? "layered-raster-fallback" : "layered-raster"}
      data-future-asset={asset?.kind ?? "none"}
      data-gaze="center"
      data-blinking="false"
      role="img"
      aria-label={alt}
    >
      {model3d && quality !== "thumbnail" ? (
        <Agent3D
          className="oai-agent3d-fill"
          agent={agentType}
          state={resolve3DState(resolvedState)}
          quality={renderQuality === "featured" ? "full" : "preview"}
          model={model3d}
          posterSrc={model3d.posterSrc || source}
          reducedMotion={reduce}
          audioElement={audioElement}
        />
      ) : (
        <span className="oai-robot-stage">
          <img className="oai-robot-base" src={source} alt="" width="720" height="720" loading={loading} decoding="async" draggable={false} />
          <RobotBodyLayer src={source} alt={alt} animateBody={animated} quality={renderQuality} />
          <RobotHeadLayer src={source} animateHead={animated} state={resolvedState} quality={renderQuality}>
            <RobotEyeLayer agentId={agentType} src={source} />
            <span className="oai-robot-thinking-sweep" />
          </RobotHeadLayer>
          <AgentGlowLayer />
          <AgentScanLayer agentId={agentId} state={resolveMotionState(resolvedState)} detail={renderQuality === "featured"} />
          <span className="oai-robot-speaking-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        </span>
      )}
      {children}
    </div>
  );
});

export const AnimatedRobotFace = RobotHeadLayer;
export { useAgentExpressionController as AgentExpressionController };
