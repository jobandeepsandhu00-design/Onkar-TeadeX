import type { AgentId } from "../agent-data";
import type { Agent3DState } from "./types";

const ACCENTS: Record<AgentId, [string, string]> = {
  master: ["#43a9ff", "#f4c45d"],
  trend: ["#29f0b4", "#0c9f86"],
  zone: ["#39dcff", "#f2c15b"],
  setup: ["#3689ff", "#a36bff"],
  risk: ["#35e78d", "#ef5365"],
  news: ["#4e9bff", "#ffb544"],
  backtest: ["#8a63ff", "#428dff"],
  journal: ["#e7f3ff", "#6faeff"],
  insight: ["#84adff", "#b079ff"],
  execution: ["#3d95ff", "#ff8b38"],
};

export function AgentLights({ agent, state }: { agent: AgentId; state: Agent3DState }) {
  const [primary, secondary] = ACCENTS[agent];
  const alertBoost = state === "alert" || state === "warning" ? 1.35 : 1;
  return (
    <>
      <ambientLight intensity={0.34} color="#b8d8ff" />
      <directionalLight position={[2.8, 4.4, 4]} intensity={2.1 * alertBoost} color={primary} />
      <spotLight position={[-3.2, 2.6, 2.2]} intensity={32} angle={0.38} penumbra={0.8} color={secondary} />
      <pointLight position={[0, 1.2, -2.2]} intensity={6} color={primary} />
    </>
  );
}

