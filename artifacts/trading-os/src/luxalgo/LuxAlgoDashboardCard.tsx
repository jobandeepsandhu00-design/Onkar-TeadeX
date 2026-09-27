import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Code2,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { luxRequest } from "./api";
import "./luxalgo.css";

type LuxHealth = {
  status?: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "AUTH_REQUIRED";
  availableTools?: string[];
  tools?: string[];
};

export function LuxAlgoDashboardCard({
  onOpen,
  surface = "tradex",
}: {
  onOpen: () => void;
  surface?: "tradex" | "onkar";
}) {
  const [health, setHealth] = useState<LuxHealth | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void luxRequest<LuxHealth>("/health", { signal: controller.signal })
      .then((value) => {
        setHealth(value);
        setUnavailable(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUnavailable(true);
      });
    return () => controller.abort();
  }, []);

  const status = unavailable
    ? "UNAVAILABLE"
    : health?.status ?? "CHECKING";
  const connected = status === "CONNECTED";
  const toolCount = health?.availableTools?.length ?? health?.tools?.length;

  return (
    <section className={`lux-dashboard-card lux-dashboard-card-${surface}`}>
      <div className="lux-dashboard-glow" aria-hidden="true" />
      <div className="lux-dashboard-card-head">
        <span className="lux-dashboard-mark">
          <Search size={20} />
        </span>
        <div>
          <span className="lux-dashboard-eyebrow">
            OFFICIAL MCP · EXTERNAL RESEARCH
          </span>
          <h2>LuxAlgo Research Center</h2>
          <p>
            Browse official concepts, indicators, Pine source and Edge Stats
            without changing OnkarTradeX execution rules.
          </p>
        </div>
        <span
          className={`lux-dashboard-status ${connected ? "connected" : status.toLowerCase()}`}
          title="LuxAlgo MCP connection health"
        >
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {status}
        </span>
      </div>
      <div className="lux-dashboard-features" aria-label="LuxAlgo research features">
        <span><BookOpen size={14} /> Library</span>
        <span><ShieldCheck size={14} /> Price Action</span>
        <span><Code2 size={14} /> Source Code</span>
        <span><BarChart3 size={14} /> Edge Stats</span>
      </div>
      <div className="lux-dashboard-card-foot">
        <small>
          Research only{typeof toolCount === "number" ? ` · ${toolCount} tools discovered` : " · execution remains isolated"}
        </small>
        <button type="button" onClick={onOpen}>
          Open LuxAlgo Research <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  );
}
