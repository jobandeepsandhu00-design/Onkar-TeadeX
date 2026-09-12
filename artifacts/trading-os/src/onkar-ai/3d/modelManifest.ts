import type { AgentId } from "../agent-data";
import type { Agent3DModelAsset } from "./types";

/**
 * Production model registry.
 *
 * Deliberately empty until recognizable, licensed, rigged Onkar AI GLBs exist.
 * A missing entry always retains the current polished raster avatar.
 */
export const AGENT_3D_MODELS: Readonly<Partial<Record<AgentId, Agent3DModelAsset>>> = {};

export function getAgent3DModel(agentId: AgentId): Agent3DModelAsset | null {
  return AGENT_3D_MODELS[agentId] ?? null;
}

