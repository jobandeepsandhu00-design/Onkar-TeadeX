import {
  memo,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import type { AgentId } from "./agent-data";
import { AgentMotionLayer, type AgentVisualState } from "./motion";

export type AgentAvatarState =
  | AgentVisualState
  | "monitoring"
  | "speaking"
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

const EXPRESSIVE_AGENTS = new Set<AgentId>(["insight", "journal"]);

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
      const delay = randomBetween(state === "scanning" ? 2800 : 3200, state === "scanning" ? 5200 : 7000);
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
        }, closeTime);
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
  const lift = quality === "featured" ? -1.4 : -1;
  const breath = quality === "featured" ? 1.01 : 1.008;
  return (
    <motion.span
      className="oai-robot-body-layer"
      aria-hidden="true"
      animate={animateBody ? { scaleY: [1, breath, 1], y: [0, lift, 0] } : undefined}
      transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut" }}
    >
      <img src={src} alt="" draggable={false} />
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
}: {
  src: string;
  animateHead: boolean;
  state: AgentAvatarState;
  quality: "featured" | "card";
}) {
  const turn = quality === "featured" ? 2.6 : 1.9;
  const nod = quality === "featured" ? 1.15 : 0.8;
  const animation = useMemo(() => {
    if (!animateHead) return undefined;
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
      <img src={src} alt="" draggable={false} />
    </motion.span>
  );
}

export function RobotEyeLayer({ agentId }: { agentId: AgentId }) {
  return (
    <span className="oai-robot-eye-layer" data-eye-profile={agentId} aria-hidden="true">
      <i className="oai-robot-eye oai-robot-eye-left"><b /></i>
      <i className="oai-robot-eye oai-robot-eye-right"><b /></i>
      <span className="oai-robot-thinking-sweep" />
    </span>
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
  if (state === "speaking") return "active";
  if (state === "offline") return "disabled";
  return state;
}

type AnimatedAgentAvatarProps = {
  agentId: AgentId;
  agentType?: AgentId;
  state: AgentAvatarState;
  isSpeaking?: boolean;
  isSelected?: boolean;
  reducedMotion?: boolean;
  image?: string;
  asset?: AgentAvatarAsset;
  alt: string;
  quality?: "featured" | "card";
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
}: AnimatedAgentAvatarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const systemReducedMotion = useReducedMotion();
  const reduce = reducedMotion ?? Boolean(systemReducedMotion);
  const visible = useInView(rootRef, { amount: 0.16, margin: "0px" });
  const resolvedState: AgentAvatarState = isSpeaking ? "speaking" : state;
  const source = asset?.kind === "layered-raster" ? asset.src : asset?.fallbackSrc ?? image ?? "";
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
  } as CSSProperties;

  useAgentExpressionController({ rootRef, state: resolvedState, visible, reducedMotion: reduce });
  useAvatarStageLayout(rootRef);
  useAudioReactiveLevel(audioElement, rootRef as RefObject<HTMLElement | null>, visible && !reduce && resolvedState === "speaking");

  const animated = visible && !reduce && resolvedState !== "offline" && resolvedState !== "disabled";
  return (
    <div
      ref={rootRef}
      className={`oai-robot-avatar ${className}`}
      style={geometryStyle}
      data-agent={agentType}
      data-state={resolvedState}
      data-quality={quality}
      data-selected={isSelected ? "true" : "false"}
      data-visible={visible ? "true" : "false"}
      data-paused={!animated ? "true" : "false"}
      data-renderer={asset && asset.kind !== "layered-raster" ? "layered-raster-fallback" : "layered-raster"}
      data-future-asset={asset?.kind ?? "none"}
      data-gaze="center"
      data-blinking="false"
      role="img"
      aria-label={alt}
    >
      <span className="oai-robot-stage">
        <img className="oai-robot-base" src={source} alt="" width="720" height="720" loading={loading} decoding="async" draggable={false} />
        <RobotBodyLayer src={source} alt={alt} animateBody={animated} quality={quality} />
        <RobotHeadLayer src={source} animateHead={animated} state={resolvedState} quality={quality} />
        <RobotEyeLayer agentId={agentId} />
        <RobotMouthLayer expressive={EXPRESSIVE_AGENTS.has(agentType)} />
        <AgentGlowLayer />
        <AgentScanLayer agentId={agentId} state={resolveMotionState(resolvedState)} detail={quality === "featured"} />
        <span className="oai-robot-speaking-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      </span>
      {children}
    </div>
  );
});

export const AnimatedRobotFace = RobotHeadLayer;
export { useAgentExpressionController as AgentExpressionController };
