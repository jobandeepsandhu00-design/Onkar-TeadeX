import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, BrainCircuit, GitBranch, LoaderCircle, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { getKnowledgeDashboard, type KnowledgeDashboard } from "./api";
import "./knowledge.css";

type Props = {
  surface: "tradex" | "onkar";
  onNavigate: (path: string) => void;
};

const metric = (data: KnowledgeDashboard | null, key: string) => Number(data?.metrics?.[key] ?? 0);

export function KnowledgeDashboardBridge({ surface, onNavigate }: Props) {
  const [data, setData] = useState<KnowledgeDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getKnowledgeDashboard()
      .then((value) => { if (active) setData(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Knowledge service unavailable."); });
    return () => { active = false; };
  }, []);

  const learning = Boolean(data?.preferences?.auto_library_learning && data?.preferences?.auto_analysis);
  const latest = data?.activity?.[0];

  return <section className={`ok-dashboard-bridge ok-dashboard-${surface}`} aria-label="Onkar AI Library Brain">
    <div className="ok-dashboard-glow" />
    <header>
      <div className="ok-dashboard-mark"><BrainCircuit size={surface === "onkar" ? 28 : 23} /></div>
      <div className="ok-dashboard-heading">
        <span>ONKAR AI · LIBRARY BRAIN</span>
        <h3>{surface === "tradex" ? "Your trading knowledge is becoming usable intelligence" : "Knowledge and market evidence, connected"}</h3>
        <p>{surface === "tradex" ? "Videos, approved setups and trade results feed the same protected memory used by Master AI." : "Master AI and every specialist now share one source-aware brain. Learning can create evidence and candidates, but cannot silently change live rules."}</p>
      </div>
      <div className={`ok-learning-state ${learning ? "is-live" : ""}`}><i />{learning ? "LEARNING ACTIVE" : "LEARNING PAUSED"}</div>
    </header>

    {error ? <div className="ok-dashboard-error"><TriangleAlert size={16} /><span>{error}</span></div> : !data ? <div className="ok-dashboard-loading"><LoaderCircle size={18} /><span>Connecting real Library knowledge…</span></div> : <>
      <div className="ok-dashboard-metrics">
        <article><BookOpen size={17} /><span>Library knowledge</span><strong>{metric(data, "libraryItems")}</strong></article>
        <article><Sparkles size={17} /><span>Videos learned</span><strong>{metric(data, "videosAnalyzed")}</strong></article>
        <article><ShieldCheck size={17} /><span>Setups understood</span><strong>{metric(data, "setupsUnderstood")}</strong></article>
        <article><GitBranch size={17} /><span>Needs review</span><strong>{metric(data, "needsReview")}</strong></article>
      </div>
      {surface === "onkar" && <div className="ok-dashboard-proof">
        <div><span>Latest audited learning</span><strong>{latest ? String(latest.title ?? "Learning event recorded") : "Waiting for the next verified learning event"}</strong></div>
        <div><span>Safety state</span><strong>Live rule changes and automatic promotion are locked</strong></div>
      </div>}
    </>}

    <footer>
      <button className="ok-dashboard-secondary" onClick={() => onNavigate("/onkar-ai/evolution")}><GitBranch size={16} />Evolution Lab<ArrowRight size={15} /></button>
      <button className="ok-dashboard-primary" onClick={() => onNavigate("/onkar-ai/knowledge")}><BrainCircuit size={16} />Open Knowledge Center<ArrowRight size={15} /></button>
    </footer>
  </section>;
}

export default KnowledgeDashboardBridge;
