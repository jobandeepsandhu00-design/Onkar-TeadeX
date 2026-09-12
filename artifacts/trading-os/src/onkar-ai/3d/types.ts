import type { AgentId } from "../agent-data";

export type Agent3DState =
  | "idle"
  | "listening"
  | "thinking"
  | "scanning"
  | "speaking"
  | "success"
  | "warning"
  | "alert"
  | "offline";

export type Agent3DQuality = "thumbnail" | "preview" | "full";

export type Agent3DModelAsset = {
  agentId: AgentId;
  modelSrc: string;
  posterSrc: string;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  cameraTarget?: [number, number, number];
};

export type Agent3DProps = {
  agent: AgentId;
  state: Agent3DState;
  quality?: Agent3DQuality;
  model?: Agent3DModelAsset | null;
  posterSrc: string;
  className?: string;
  interactive?: boolean;
  reducedMotion?: boolean;
  audioElement?: HTMLMediaElement | null;
  onReady?: () => void;
  onFallback?: (reason: Agent3DFallbackReason) => void;
};

export type Agent3DFallbackReason =
  | "thumbnail"
  | "model-unavailable"
  | "webgl-unavailable"
  | "offscreen"
  | "renderer-budget"
  | "load-error";

export const AGENT_CLIP_CANDIDATES: Record<Agent3DState, readonly string[]> = {
  idle: ["Idle", "IdleVariation"],
  listening: ["Listening", "Idle"],
  thinking: ["Thinking", "Analyze", "IdleVariation", "Idle"],
  scanning: ["Scanning", "Analyze", "LookLeft", "Idle"],
  speaking: ["Speaking", "Explain", "Present", "Idle"],
  success: ["Success", "Present", "Idle"],
  warning: ["Warning", "Protect", "Idle"],
  alert: ["Alert", "Warning", "Protect", "Idle"],
  offline: ["Offline", "Idle"],
};

export const REQUIRED_RIG_BONES = [
  "Root", "Pelvis", "Spine", "Chest", "Neck", "Head",
  "Shoulder_L", "UpperArm_L", "LowerArm_L", "Hand_L",
  "Shoulder_R", "UpperArm_R", "LowerArm_R", "Hand_R",
] as const;

export const OPTIONAL_FACE_CONTROLS = [
  "BlinkLeft", "BlinkRight", "Blink", "Smile", "Neutral",
  "Talk_A", "Talk_E", "Talk_I", "Talk_O", "Talk_U",
] as const;
