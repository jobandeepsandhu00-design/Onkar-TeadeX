import {
  Component,
  lazy,
  Suspense,
  useEffect,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useInView } from "framer-motion";
import { useDocumentVisible, useReducedMotionPreference } from "../useAgentAnimationState";
import { useRef } from "react";
import { getAgent3DModel } from "./modelManifest";
import type { Agent3DFallbackReason, Agent3DProps } from "./types";
import { useWebGLSupport } from "./useWebGLSupport";
import { use3DRendererBudget } from "./use3DRendererBudget";

const AgentScene = lazy(() => import("./AgentScene"));

class SceneErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Lazy, viewport-aware GLB renderer. It never replaces the polished poster
 * unless a real model is registered and WebGL is available.
 */
export function Agent3D({
  agent,
  state,
  quality = "preview",
  model: suppliedModel,
  posterSrc,
  className = "",
  interactive = true,
  reducedMotion,
  audioElement,
  onReady,
  onFallback,
}: Agent3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const systemReducedMotion = useReducedMotionPreference();
  const documentVisible = useDocumentVisible();
  const reduce = Boolean(reducedMotion || systemReducedMotion);
  const inView = useInView(hostRef, { amount: 0.15, margin: "120px" });
  const webgl = useWebGLSupport();
  const model = suppliedModel ?? getAgent3DModel(agent);
  const budgetGranted = use3DRendererBudget(Boolean(model) && documentVisible && inView && webgl === "supported" && quality !== "thumbnail");

  const poster = (
    <img
      className="oai-agent3d-poster"
      src={posterSrc}
      alt={`${agent} AI robot avatar`}
      loading={quality === "full" ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
    />
  );

  let reason: Agent3DFallbackReason | null = null;
  if (quality === "thumbnail") reason = "thumbnail";
  else if (!model) reason = "model-unavailable";
  else if (webgl === "unsupported") reason = "webgl-unavailable";
  else if (!inView || !documentVisible) reason = "offscreen";
  else if (webgl === "supported" && !budgetGranted) reason = "renderer-budget";

  useEffect(() => {
    if (reason) onFallback?.(reason);
  }, [onFallback, reason]);

  if (reason) {
    return <div ref={hostRef} className={`oai-agent3d oai-agent3d-fallback ${className}`} data-renderer="poster" data-fallback={reason}>{poster}</div>;
  }

  return (
    <div ref={hostRef} className={`oai-agent3d ${className}`} data-renderer="webgl">
      <SceneErrorBoundary fallback={poster} onError={() => onFallback?.("load-error")}>
        <Suspense fallback={poster}>
          {webgl === "supported" && model ? (
            <AgentScene
              agent={agent}
              state={state}
              quality={quality}
              model={model}
              interactive={interactive}
              reducedMotion={reduce}
              audioElement={audioElement}
              onReady={onReady}
            />
          ) : poster}
        </Suspense>
      </SceneErrorBoundary>
    </div>
  );
}
