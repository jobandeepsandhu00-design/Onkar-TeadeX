import { useState } from "react";
import type { ScannerSnapshot } from "@workspace/api-zod";
import { brainRequest } from "./api";
type Replay = {
  source: string;
  count: number;
  wins: number;
  losses: number;
  averageR: number | null;
  maxDrawdownR: number;
  profitFactor: number | null;
  unfinished: boolean;
  warnings: string[];
  signals: Array<{ state: string }>;
};
export function ScannerReplay({ snapshot }: { snapshot: ScannerSnapshot }) {
  const [versionId, setVersion] = useState(
    snapshot.versions.find((v) => v.definition.approval === "approved")?.id ||
      "",
  );
  const [symbol, setSymbol] = useState(
      snapshot.config?.config.symbols[0] || "",
    ),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [allowMissingHistoricalNews, setAllowNews] = useState(false);
  const [result, setResult] = useState<Replay | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="mb-stack">
      <h3>Historical rule replay</h3>
      <p className="mb-notice">
        Simulation only. Uses stored real candles and immutable strategy rules.
        No look-ahead; incomplete higher-timeframe candles are excluded. Costs,
        slippage and intrabar price ordering are not modeled.
      </p>
      <div className="mb-grid">
        <label>
          Approved rule version
          <select
            value={versionId}
            onChange={(e) => setVersion(e.target.value)}
          >
            <option value="">Choose version</option>
            {snapshot.versions
              .filter((v) => v.definition.approval === "approved")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.id.slice(0, 8)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Symbol
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          From (UTC)
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through (UTC)
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <label className="mb-check">
        <input
          type="checkbox"
          checked={allowMissingHistoricalNews}
          onChange={(e) => setAllowNews(e.target.checked)}
        />
        Explicitly allow replay without historical news clearance
      </label>
      <p className="mb-muted">
        This does not change live scanner settings. Rules explicitly requiring
        newsSafe still fail when news is unavailable. Maximum 999 stored candles
        per timeframe per request.
      </p>
      <button
        disabled={busy || !versionId || !from || !to}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setResult(
              await brainRequest("/backtest", "POST", {
                versionId,
                symbol,
                from: `${from}T00:00:00Z`,
                to: `${to}T23:59:59Z`,
                acknowledgeSimulation: true,
                allowMissingHistoricalNews,
              }),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Replay failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Replaying…" : "Run simulation"}
      </button>
      {error && (
        <p className="mb-notice" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="mb-kpis">
            {[
              ["Simulated outcomes", result.count],
              ["Wins / losses", `${result.wins} / ${result.losses}`],
              ["Average R", result.averageR?.toFixed(2) ?? "Unavailable"],
              ["Drawdown R", result.maxDrawdownR.toFixed(2)],
              [
                "Profit factor",
                result.profitFactor?.toFixed(2) ?? "Unavailable",
              ],
            ].map(([k, v]) => (
              <div className="mb-panel" key={k}>
                <span className="mb-muted">{k}</span>
                <strong className="mb-value">{v}</strong>
              </div>
            ))}
          </div>
          <p>
            {result.signals.length} candle evaluations ·{" "}
            {result.signals.filter((s) => s.state === "READY").length} READY
            signals ·{" "}
            {result.unfinished
              ? "Unfinished plan excluded from results"
              : "No unfinished plan"}
          </p>
          {result.warnings.map((w) => (
            <p className="mb-muted" key={w}>
              {w}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
