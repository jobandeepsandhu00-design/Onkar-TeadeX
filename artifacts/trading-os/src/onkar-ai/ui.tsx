import type { ReactNode } from "react";
import { ArrowUpRight, BrainCircuit, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import type { SetupPreview } from "./demo-data";
export function AIButton({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
}) {
  return (
    <Button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`oai-button ${primary ? "oai-button-primary" : ""} ${className}`}
      variant="outline"
    >
      {children}
    </Button>
  );
}
export function Panel({
  title,
  kicker,
  action,
  children,
  className = "",
}: {
  title?: string;
  kicker?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`oai-panel ${className}`}>
      {title && (
        <header className="oai-panel-heading">
          <div>
            {kicker && <span className="oai-eyebrow">{kicker}</span>}
            <h2>{title}</h2>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
export function AIStatusBadge({ status }: { status: string }) {
  const tone = /High|Ready|Long|Win|Safe/.test(status)
    ? "green"
    : /Invalid|Loss|Short|Offline/.test(status)
      ? "red"
      : /Develop|Medium|Waiting/.test(status)
        ? "gold"
        : "blue";
  return (
    <Badge className={`oai-badge oai-${tone}`}>
      <span className="oai-dot" />
      {status}
    </Badge>
  );
}
export function AIScoreBadge({
  score,
  large = false,
}: {
  score: number;
  large?: boolean;
}) {
  return (
    <span
      title="Sample rule confluence score, not a win probability"
      className={`oai-score ${large ? "oai-score-large" : ""} ${score >= 80 ? "oai-green" : score >= 65 ? "oai-blue" : "oai-gold"}`}
    >
      {score}
      <small>/100</small>
    </span>
  );
}
export function DemoLabel() {
  return <span className="oai-demo-label">DESIGN PREVIEW · SAMPLE DATA</span>;
}
export function OnkarAIEntryButton({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`oai-entry ${compact ? "oai-entry-compact" : ""}`}
      onClick={onClick}
    >
      <span className="oai-entry-icon">
        <BrainCircuit size={compact ? 19 : 25} />
      </span>
      <span>
        <strong>Onkar AI</strong>
        {!compact && <small>Explore your intelligence workspace</small>}
      </span>
      {compact ? (
        <ArrowUpRight size={17} />
      ) : (
        <span className="oai-entry-action">
          Open AI Dashboard <ChevronRight size={18} />
        </span>
      )}
    </button>
  );
}
export function SymbolMark({ setup }: { setup: SetupPreview }) {
  return (
    <span
      className={`oai-symbol-mark ${setup.asset === "Gold" ? "oai-gold" : setup.asset === "Crypto" ? "oai-purple" : "oai-blue"}`}
    >
      {setup.symbol.slice(0, 2)}
    </span>
  );
}
export function KeyValue({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="oai-key-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
