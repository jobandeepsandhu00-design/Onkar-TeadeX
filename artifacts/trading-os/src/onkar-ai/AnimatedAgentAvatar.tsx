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
  master: { eyeTop: "28.3%", eyeLeft: "37.2%", eyeRight: "37.2%", eyeWidth: "9.2%", chestY: "67.4%" },
  trend: { eyeTop: "29.4%", eyeLeft: "33.4%", eyeRight: "33.4%", eyeWidth: "14.2%", eyeHeight: "2.2%" },
  zone: { eyeTop: "29.2%", eyeLeft: "37.6%", eyeRight: "37.6%", eyeWidth: "9.1%" },
  setup: { eyeTop: "29%", eyeLeft: "37.5%", eyeRight: "37.5%", eyeWidth: "9%" },
  risk: { eyeTop: "29.5%", eyeLeft: "36.7%", eyeRight: "36.7%", eyeWidth: "9.8%" },
  news: { eyeTop: "29.6%", eyeLeft: "38%", eyeRight: "38%", eyeWidth: "8.5%" },
  backtest: { eyeTop: "29.4%", eyeLeft: "37.2%", eyeRight: "37.2%", eyeWidth: "9.2%" },
  journal: { eyeTop: "27.2%", eyeLeft: "37.7%", eyeRight: "37.7%", eyeWidth: "8.2%", headX: "51%", headY: "29%" },
  insight: { eyeTop: "25.8%", eyeLeft: "38.1%", eyeRight: "38.1%", eyeWidth: "7.8%", headX: "50.5%", headY: "28%" },
  execution: { eyeTop: "29.3%", eyeLeft: "35.5%", eyeRight: "35.5%", eyeWidth: "11%", eyeHeight: "2.2%" },
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

export function RobotBodyLayer({ src, alt, animateBody }: { src: string; alt: string; animateBody: boolean }) {
  return (
    <motion.span
      className="oai-robot-body-layer"
      aria-hidden="true"
      animate={animateBody ? { scaleY: [1, 1.003, 1], y: [0, -0.45, 0] } : undefined}
      transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut" }}
    >
      <img src={src} alt="" draggable={false} />
      <i className="oai-robot-shoulder oai-robot-shoulder-left" />
      <i className="oai-robot-shoulder oai-robot-shoulder-right" />
      <span className="sr-only">{alt}</span>
    </motion.span>
  );
}

export function RobotHeadLayer({ src, animateHead, state }: { src: string; animateHead: boolean; state: AgentAvatarState }) {
  const animation = useMemo(() => {
    if (!animateHead) return undefined;
    if (state === "scanning") return { rotateY: [-1.5, 0, 1.5, 0], rotateX: [0, -0.35, 0, 0] };
    if (state === "thinking") return { rotateY: [0, -0.6, 0.4, 0], rotateX: [0, 0.9, 0.9, 0] };
    if (state === "speaking") return { rotateY: [-0.45, 0.5, -0.25], rotateX: [0, -0.25, 0.2] };
    if (state === "alert") return { rotateY: [0, -0.8, 0.8, 0], rotateX: [0, -0.4, 0] };
    return { rotateY: [-1.1, 0.9, -0.35, -1.1], rotateX: [0, 0.45, -0.2, 0] };
  }, [animateHead, state]);

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
      <img className="oai-robot-base" src={source} alt="" width="720" height="720" loading={loading} decoding="async" draggable={false} />
      <RobotBodyLayer src={source} alt={alt} animateBody={animated} />
      <RobotHeadLayer src={source} animateHead={animated} state={resolvedState} />
      <RobotEyeLayer agentId={agentId} />
      <RobotMouthLayer expressive={EXPRESSIVE_AGENTS.has(agentType)} />
      <AgentGlowLayer />
      <AgentScanLayer agentId={agentId} state={resolveMotionState(resolvedState)} detail={quality === "featured"} />
      <span className="oai-robot-speaking-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      {children}
    </div>
  );
});

export const AnimatedRobotFace = RobotHeadLayer;
export { useAgentExpressionController as AgentExpressionController };
