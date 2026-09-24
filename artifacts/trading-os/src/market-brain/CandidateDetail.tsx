import { useEffect, useState } from "react";
import type {
  AIExplanation,
  RiskResult,
  ScannerCandidate,
} from "@workspace/api-zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { brainRequest } from "./api";

type Bar = { open_time: number; o: number; h: number; l: number; c: number };
type Detail = {
  candidate: ScannerCandidate;
  bars: Bar[];
  events: Array<{
    id: string;
    kind: string;
    detail: { state?: string; score?: number; dataAt?: string };
    created_at: string;
  }>;
  analysis: Array<{
    status: string;
    output: AIExplanation | null;
    created_at: string;
    model: string;
  }>;
  links: Array<{ source_trade_id: string; note: string }>;
};
type PaperDryRun = {
  simulationOnly: true;
  orderPlaced: false;
  candleClosedAt: string;
  accountId: string | null;
  provider: string;
  storedCounts: Record<string, number>;
  setup: {
    status: string;
    score: number;
    passed: number;
    total: number;
    readinessBlockers: string[];
  };
  paper: { preflightPass: boolean; blockers: string[] };
  limitation: string;
};
const price = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "Unavailable"
    : n.toLocaleString(undefined, { maximumFractionDigits: 5 });
const zone = (value: { low: number; high: number } | null | undefined) =>
  value ? `${price(value.low)}–${price(value.high)}` : "Unavailable";
function CandidateChart({
  bars,
  plan,
  frozen,
}: {
  bars: Bar[];
  plan: RiskResult;
  frozen: boolean;
}) {
  const rows = [...bars].sort((a, b) => a.open_time - b.open_time).slice(-80);
  if (!rows.length)
    return <p className="mb-notice">No stored chart candles available.</p>;
  const high = Math.max(plan.target, plan.stop, ...rows.map((b) => b.h)),
    low = Math.min(plan.target, plan.stop, ...rows.map((b) => b.l)),
    range = high - low || 1;
  const y = (v: number) => 265 - ((v - low) / range) * 230,
    x = (i: number) => 16 + (i * 700) / rows.length;
  return (
    <figure>
      <svg
        viewBox="0 0 900 300"
        className="mb-chart"
        role="img"
        aria-label="Real stored candles with calculated entry, stop and target levels"
      >
        {rows.map((b, i) => (
          <g key={b.open_time} stroke={b.c >= b.o ? "#34d399" : "#fb7185"}>
            <title>
              {new Date(b.open_time).toISOString()} · O {b.o} H {b.h} L {b.l} C{" "}
              {b.c}
            </title>
            <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} />
            <rect
              x={x(i) - 2.5}
              width={5}
              y={Math.min(y(b.o), y(b.c))}
              height={Math.max(1, Math.abs(y(b.o) - y(b.c)))}
              fill={b.c >= b.o ? "#34d399" : "#fb7185"}
            />
          </g>
        ))}
        {[
          [plan.entry, "Entry", "#38bdf8"],
          [plan.stop, "Invalidation / SL", "#fb7185"],
          [plan.target, "Target", "#34d399"],
        ].map(([v, label, color]) => (
          <g key={label}>
            <line
              x1={8}
              x2={730}
              y1={y(Number(v))}
              y2={y(Number(v))}
              stroke={String(color)}
              strokeDasharray="5 5"
            />
            <text
              x={740}
              y={y(Number(v)) + 4}
              fill={String(color)}
              fontSize={12}
            >
              {label} {price(Number(v))}
            </text>
          </g>
        ))}
        <text x={10} y={292} fill="#94a3b8" fontSize={12}>
          {new Date(rows[0].open_time).toLocaleString()}
        </text>
        <text x={520} y={292} fill="#94a3b8" fontSize={12}>
          {new Date(rows.at(-1)!.open_time).toLocaleString()}
        </text>
      </svg>
      <figcaption className="mb-muted">
        Stored OHLC data, not a screenshot interpretation. Dashed levels are{" "}
        {frozen
          ? "the frozen, risk-approved plan—not proof of broker execution."
          : "provisional calculations only; they cannot execute until every gate passes."}
      </figcaption>
    </figure>
  );
}
export function CandidateDetail({
  candidate,
  onClose,
  onJournal,
  journalTrades,
}: {
  candidate: ScannerCandidate;
  onClose: () => void;
  onJournal: () => void;
  journalTrades: Array<{ id: string; symbol?: string; date?: string }>;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [tradeId, setTradeId] = useState(""),
    [note, setNote] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<AIExplanation | null>(null);
  const [dryRun, setDryRun] = useState<PaperDryRun | null>(null);
  const [dryRunError, setDryRunError] = useState("");
  const [dryRunBusy, setDryRunBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setDryRun(null);
    setDryRunError("");
    void brainRequest<Detail>(
      `/candidates/${candidate.id}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load analysis");
      });
    return () => controller.abort();
  }, [candidate.id, candidate.updated_at]);
  const c = detail?.candidate ?? candidate,
    p = c.payload,
    plan = c.plan ?? p.risk,
    ai = detail?.analysis[0];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="market-brain mb-modal">
        <DialogTitle>
          {c.symbol} · {p.strategyName || "Setup analysis"}
        </DialogTitle>
        <DialogDescription className="mb-muted">
          {c.timeframe} · {p.direction} · {c.score}/100 deterministic rule
          confluence. This is not a win-probability estimate.
        </DialogDescription>
        <div className="mb-stack">
          {error && (
            <p role="alert" className="mb-notice">
              {error}
            </p>
          )}
          {detail ? (
            <CandidateChart
              bars={detail.bars}
              plan={plan}
              frozen={Boolean(c.plan)}
            />
          ) : (
            <div className="mb-skeleton" aria-label="Loading chart" />
          )}
          <div className="mb-grid">
            {[
              [
                "Status",
                candidate.staleNow || p.stale ? "STALE DATA" : c.state,
              ],
              ["HTF context", `${p.higherTimeframe} · ${p.marketBias}`],
              [c.plan ? "Entry" : "Provisional entry", price(plan.entry)],
              [
                c.plan ? "Stop / invalidation" : "Provisional invalidation",
                price(plan.stop),
              ],
              [c.plan ? "Target" : "Provisional target", price(plan.target)],
              ["Reward/risk", `${plan.rr.toFixed(2)}R`],
              [
                "Monetary risk",
                `${plan.currency ?? ""} ${price(plan.monetaryRisk)}`,
              ],
              ["Position size", price(plan.positionSize)],
            ].map(([label, value]) => (
              <div className="mb-panel" key={label}>
                <span className="mb-muted">{label}</span>
                <strong className="mb-value">{value}</strong>
              </div>
            ))}
          </div>
          {p.globalWorkflowRequired && (
            <section className="mb-panel">
              <h3>Official 4H → 1H → 30M workflow</h3>
              {p.globalWorkflow ? (
                <>
                  <div className="mb-grid">
                    {[
                      [
                        "Master status",
                        p.globalWorkflow.masterStatus.replaceAll("_", " "),
                      ],
                      ["Shared workflow gate", p.globalWorkflow.gate.status],
                      ["4H bias", p.globalWorkflow.fourHour.bias],
                      ["4H support", zone(p.globalWorkflow.fourHour.support)],
                      [
                        "4H resistance",
                        zone(p.globalWorkflow.fourHour.resistance),
                      ],
                      [
                        "1H alignment",
                        p.globalWorkflow.oneHour.alignment.replaceAll("_", " "),
                      ],
                      [
                        "1H setup zone",
                        zone(p.globalWorkflow.oneHour.setupZone),
                      ],
                      [
                        "30M reaction",
                        p.globalWorkflow.thirtyMinute.reaction.replaceAll(
                          "_",
                          " ",
                        ),
                      ],
                      [
                        "Last evaluated 30M candle",
                        p.globalWorkflow.thirtyMinute.candle.closed
                          ? "CLOSED"
                          : "FORMING",
                      ],
                      [
                        "Price location",
                        p.globalWorkflow.priceLocation.replaceAll("_", " "),
                      ],
                      [
                        "Available range",
                        p.globalWorkflow.availableRange.pips === null
                          ? p.globalWorkflow.availableRange.status.replaceAll(
                              "_",
                              " ",
                            )
                          : `${p.globalWorkflow.availableRange.pips.toFixed(1)} pips · ${p.globalWorkflow.availableRange.status.replaceAll("_", " ")}`,
                      ],
                      ["Risk gate", p.globalWorkflow.riskGate],
                    ].map(([label, value]) => (
                      <div className="mb-panel" key={label}>
                        <span className="mb-muted">{label}</span>
                        <strong className="mb-value">{value}</strong>
                      </div>
                    ))}
                  </div>
                  {p.globalWorkflow.gate.missing.length > 0 && (
                    <>
                      <h4>Shared workflow missing</h4>
                      <ul className="mb-warning">
                        {p.globalWorkflow.gate.missing.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="mb-muted">
                    {p.paperFastEntryApplied
                      ? "Paper Fast Entry uses this approved setup's own closed-30M trigger; the shared workflow remains visible for context. Risk, fresh data, news and execution permissions still have veto authority. MT5 remains on the standard gate."
                      : "Setup matching cannot become READY until every shared workflow gate is satisfied from closed market candles. Risk AI retains veto authority."}
                  </p>
                </>
              ) : (
                <p className="mb-notice">
                  Waiting for sufficient closed 4H, 1H and 30M candles. Setup AI
                  remains locked.
                </p>
              )}
            </section>
          )}
          {p.setupWorkflow && (
            <section className="mb-panel">
              <h3>{p.setupWorkflow.setup} workflow</h3>
              <div className="mb-grid">
                {[
                  [
                    "Pattern",
                    p.setupWorkflow.patternMatched ? "MATCHED" : "WAITING",
                  ],
                  [
                    "Closed entry trigger",
                    p.setupWorkflow.entryTrigger ? "CONFIRMED" : "WAITING",
                  ],
                  ["Direction", p.setupWorkflow.direction.toUpperCase()],
                  [
                    "Invalidation",
                    p.setupWorkflow.invalidated ? "PRESENT" : "CLEAR",
                  ],
                ].map(([label, value]) => (
                  <div className="mb-panel" key={label}>
                    <span className="mb-muted">{label}</span>
                    <strong className="mb-value">{value}</strong>
                  </div>
                ))}
              </div>
              {p.setupWorkflow.conditionsMatched.length > 0 && (
                <>
                  <h4>Matched evidence</h4>
                  <ul className="mb-positive">
                    {p.setupWorkflow.conditionsMatched.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {p.setupWorkflow.conditionsMissing.length > 0 && (
                <>
                  <h4>Waiting for</h4>
                  <ul className="mb-warning">
                    {p.setupWorkflow.conditionsMissing.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mb-muted">Next: {p.setupWorkflow.waitFor}</p>
            </section>
          )}
          {c.plan && (
            <p className="mb-muted">
              Execution levels were frozen when the setup first became READY.
              Current market calculations do not move that plan’s stop or
              target.
            </p>
          )}
          <section>
            <h3>Why / why not</h3>
            {p.readinessBlockers && p.readinessBlockers.length > 0 && (
              <ul className="mb-warning">
                {p.readinessBlockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={dryRunBusy}
              onClick={async () => {
                setDryRunBusy(true);
                setDryRunError("");
                try {
                  setDryRun(
                    await brainRequest<PaperDryRun>(
                      `/candidates/${c.id}/paper-dry-run`,
                      "GET",
                    ),
                  );
                } catch (cause) {
                  setDryRunError(
                    cause instanceof Error
                      ? cause.message
                      : "Stored-candle replay failed",
                  );
                } finally {
                  setDryRunBusy(false);
                }
              }}
            >
              {dryRunBusy
                ? "Replaying stored candles…"
                : "Replay stored candle + Paper checks (no order)"}
            </button>
            {dryRunError && (
              <p role="alert" className="mb-notice">
                {dryRunError}
              </p>
            )}
            {dryRun && (
              <div className="mb-panel" aria-live="polite">
                <h4>Paper dry run · no order placed</h4>
                <p>
                  Closed {new Date(dryRun.candleClosedAt).toLocaleString()} ·{" "}
                  {dryRun.provider} · account{" "}
                  {dryRun.accountId ?? "not selected"} · stored candles{" "}
                  {Object.entries(dryRun.storedCounts)
                    .map(([tf, count]) => `${tf}: ${count}`)
                    .join(", ")}
                </p>
                <p>
                  Setup: {dryRun.setup.status} · {dryRun.setup.score}/100 ·{" "}
                  {dryRun.setup.passed}/{dryRun.setup.total} rules
                </p>
                <p>
                  Paper preflight:{" "}
                  {dryRun.paper.preflightPass
                    ? "PASS (simulation only)"
                    : "BLOCKED"}
                </p>
                {[...dryRun.setup.readinessBlockers, ...dryRun.paper.blockers]
                  .length > 0 && (
                  <ul className="mb-warning">
                    {[
                      ...new Set([
                        ...dryRun.setup.readinessBlockers,
                        ...dryRun.paper.blockers,
                      ]),
                    ].map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
                <p className="mb-muted">{dryRun.limitation}</p>
              </div>
            )}
            <div className="mb-stack">
              {p.rules.map((r) => (
                <div className="mb-rule" key={r.id}>
                  <span className={r.passed ? "mb-positive" : "mb-warning"}>
                    {r.passed ? "✓" : r.available ? "✕" : "?"}
                  </span>
                  <div>
                    <strong>
                      {r.feature} · {r.timeframe}
                    </strong>
                    <p className="mb-muted">
                      {String(r.actual ?? "Unavailable")} {r.operator}{" "}
                      {String(r.expected)} · weight {r.weight} ·{" "}
                      {r.required ? "required" : "optional"}
                      {r.explanation ? ` · ${r.explanation}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>Risk & news</h3>
            <p className="mb-muted">
              {p.news.status === "safe"
                ? "NEWS CLEARANCE VERIFIED"
                : p.news.status === "blocked"
                  ? "HIGH-IMPACT NEWS BLACKOUT"
                  : "NEWS CONFIRMATION UNAVAILABLE"}{" "}
              · {new Date(p.news.checkedAt).toLocaleString()}
            </p>
            {p.warnings.map((w, i) => (
              <p key={i} className="mb-notice">
                {w}
              </p>
            ))}
            {p.news.events.map((e) => (
              <p key={`${e.time}:${e.title}`} className="mb-muted">
                {e.currency} · {e.title} · {new Date(e.time).toLocaleString()}
              </p>
            ))}
          </section>
          <section>
            <h3>Historical journal comparison</h3>
            {p.historical ? (
              <>
                <p>
                  {p.historical.sample} matching trades ·{" "}
                  {p.historical.knownPnl} with known P&L · {p.historical.wins}{" "}
                  wins · {p.historical.losses} losses
                </p>
                <p className="mb-muted">
                  Win rate{" "}
                  {p.historical.winRate === null
                    ? "unavailable"
                    : `${p.historical.winRate.toFixed(1)}%`}{" "}
                  · Average{" "}
                  {p.historical.averageR === null
                    ? "R unavailable"
                    : `${p.historical.averageR.toFixed(2)}R`}
                </p>
                <p className="mb-notice">{p.historical.caution}</p>
                <p className="mb-muted">
                  Exact setup, symbol, timeframe and account comparison—not an
                  AI-generated statistic.
                </p>
              </>
            ) : (
              <p className="mb-muted">No historical comparison saved.</p>
            )}
          </section>
          <section>
            <h3>AI interpretation</h3>
            {ai?.status === "succeeded" && ai.output ? (
              <>
                <p>{ai.output.summary}</p>
                <ul>
                  {ai.output.why.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <ul className="mb-warning">
                  {ai.output.whyNot.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p>
                  Missing:{" "}
                  {ai.output.missing.join(" · ") ||
                    "No additional conditions reported"}
                </p>
                <p>Invalidation: {ai.output.invalidation}</p>
                <p className="mb-muted">
                  Lesson: {ai.output.educationalLesson}
                </p>
                <p className="mb-muted">
                  AI interpretation · {ai.model} ·{" "}
                  {new Date(ai.created_at).toLocaleString()}. Check against the
                  latest rule results above.
                </p>
              </>
            ) : (
              <p className="mb-muted">
                {ai?.status === "failed"
                  ? "AI explanation failed safely. Calculated analysis remains available."
                  : "No AI interpretation yet. The provider must be configured and this candidate must meet your threshold and daily budget."}
              </p>
            )}
          </section>
          <section className="mb-panel">
            <h3>Ask about this evidence</h3>
            <label>
              Your question
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={800}
                placeholder="Which conditions are missing?"
              />
            </label>
            <button
              disabled={busy || question.trim().length < 4}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await brainRequest<{ output: AIExplanation }>(
                    "/chat",
                    "POST",
                    { candidateId: c.id, question },
                  );
                  setAnswer(result.output);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "AI question failed",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ask ONKAR AI
            </button>
            {answer && (
              <div>
                <p>{answer.summary}</p>
                <ul>
                  {[...answer.why, ...answer.whyNot, ...answer.missing].map(
                    (s, i) => (
                      <li key={i}>{s}</li>
                    ),
                  )}
                </ul>
                <p className="mb-muted">{answer.educationalLesson}</p>
              </div>
            )}
            <p className="mb-muted">
              Uses private, read-only market/rule/risk/journal tools and your
              daily AI budget. No arbitrary database access.
            </p>
          </section>
          <section>
            <h3>Lifecycle timeline</h3>
            {detail?.events.map((e) => (
              <div key={e.id} className="mb-timeline">
                <strong>{e.kind.replaceAll("_", " ")}</strong>
                <p className="mb-muted">
                  {new Date(e.detail.dataAt || e.created_at).toLocaleString()} ·{" "}
                  {e.detail.state}{" "}
                  {e.detail.score === undefined
                    ? ""
                    : `· ${e.detail.score}/100`}
                </p>
              </div>
            ))}
          </section>
          <section className="mb-panel">
            <h3>Connect to your journal</h3>
            <p className="mb-muted">
              No trade is created automatically. Log your actual trade, then
              link it to this immutable setup record.
            </p>
            <button onClick={onJournal}>Open journal</button>
            <label>
              Existing trade
              <select
                value={tradeId}
                onChange={(e) => {
                  setTradeId(e.target.value);
                  setSaved(false);
                }}
              >
                <option value="">Choose trade</option>
                {journalTrades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.symbol} · {t.date} · {t.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Review note
              <textarea
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              disabled={!tradeId || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await brainRequest(`/candidates/${c.id}/journal`, "POST", {
                    tradeId,
                    note,
                  });
                  setSaved(true);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not link trade",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {saved ? "Linked ✓" : "Save journal link"}
            </button>
            {detail?.links.map((l) => (
              <p className="mb-muted" key={l.source_trade_id}>
                Linked: {l.source_trade_id} · {l.note}
              </p>
            ))}
          </section>
          <p className="mb-muted">
            Provider: {p.provider} · Candle:{" "}
            {new Date(c.last_candle_at).toLocaleString()} · Analysis:{" "}
            {new Date(p.analyzedAt).toLocaleString()} · Expires:{" "}
            {new Date(c.expires_at).toLocaleString()}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
