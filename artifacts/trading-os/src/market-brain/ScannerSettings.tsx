import { useState } from "react";
import {
  TIMEFRAMES,
  OPPORTUNITY_SCORE_THRESHOLD,
  TWELVE_DATA_MIN_CYCLE_SECONDS,
  scannerConfigSchema,
  scannerConfigWithCurrentScorePolicy,
  type ScannerConfig,
  type ScannerSnapshot,
} from "@workspace/api-zod";
import { brainRequest } from "./api";
import { SymbolManager } from "./SymbolManager";
import { latestApprovedVersions } from "./strategy-versions";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  ShieldAlert,
  Workflow,
  Zap,
} from "lucide-react";

export function ScannerSettings({
  snapshot,
  onSaved,
}: {
  snapshot: ScannerSnapshot;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ScannerConfig>(() => {
    const saved = scannerConfigWithCurrentScorePolicy(
      snapshot.config?.config ?? snapshot.defaults,
    );
    return saved.provider === "twelvedata" &&
      saved.frequencySeconds < TWELVE_DATA_MIN_CYCLE_SECONDS
      ? { ...saved, frequencySeconds: TWELVE_DATA_MIN_CYCLE_SECONDS }
      : saved;
  });
  const [contractText, setContractText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(draft.risk.valuePerPriceUnit).map(([s, v]) => [
        s,
        String(v),
      ]),
    ),
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [webhook, setWebhook] = useState<{ secret: string; path: string } | null>(
      null,
    );
  const approvedVersions = latestApprovedVersions(snapshot);
  const requiredFrames = ["4h", "1h", "30m"] as const;
  const scannerFrames = new Set<string>(requiredFrames);
  approvedVersions.forEach((version) => {
    scannerFrames.add(version.definition.timeframe);
    scannerFrames.add(version.definition.higherTimeframe);
    version.definition.rules.forEach((rule) =>
      scannerFrames.add(rule.timeframe),
    );
  });
  const creditsPerSymbol = scannerFrames.size;
  const creditsPerFullCycle = creditsPerSymbol * draft.symbols.length;
  const secondsPerSymbol = Math.max(
    15,
    Math.round(draft.frequencySeconds / Math.max(1, draft.symbols.length)),
  );
  const apiLoad =
    creditsPerSymbol > 8
      ? "overloaded"
      : creditsPerSymbol >= 7
        ? "near-limit"
        : "healthy";
  const standardPaperSymbol = (symbol: string) =>
    /^(AUD|CAD|CHF|EUR|GBP|JPY|NZD|SGD|USD)(AUD|CAD|CHF|EUR|GBP|JPY|NZD|SGD|USD)$/.test(
      symbol.replace(/[/-]/g, ""),
    ) || ["XAUUSD", "XAGUSD"].includes(symbol.replace(/[/-]/g, ""));
  const missingSizing =
    draft.provider === "twelvedata"
      ? draft.symbols.filter(
          (symbol) =>
            !standardPaperSymbol(symbol) &&
            !draft.risk.valuePerPriceUnit[symbol],
        )
      : [];
  const update = <K extends keyof ScannerConfig>(
    key: K,
    value: ScannerConfig[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));
  async function save() {
    if (
      draft.paperFastEntry &&
      !snapshot.config?.config.paperFastEntry &&
      !window.confirm(
        "Enable Paper Fast Entry? Approved canonical setups can use their own closed-30M-candle trigger without the shared ten-check gate. Account, fresh data, risk, news, permissions and AUTO mode still apply. This does not arm automatic trading or enable MT5 live execution.",
      )
    )
      return;
    const parsed = scannerConfigSchema.safeParse({
      ...draft,
      frequencySeconds:
        draft.provider === "twelvedata"
          ? Math.max(TWELVE_DATA_MIN_CYCLE_SECONDS, draft.frequencySeconds)
          : draft.frequencySeconds,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" · "),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await brainRequest("/config", "PUT", parsed.data);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-stack">
      <span className="mb-eyebrow">Scanner profile manager</span>
      <h3>Command Center Settings</h3>
      <p className="mb-muted">
        Only your approved versions and selected account are used. Your
        journal’s fallback balance is never used for scanner risk. Monitoring
        runs on the server, not in this tab.
      </p>
      <section
        className="mb-scanner-profile"
        aria-label="Automatic scanner workflow"
      >
        <div className="mb-profile-heading">
          <span className="mb-profile-icon">
            <Workflow size={20} />
          </span>
          <div>
            <span className="mb-eyebrow">
              AUTOMATIC MULTI-TIMEFRAME PROFILE
            </span>
            <h3>4H → 1H → 30M</h3>
            <p className="mb-muted">
              One shared Twelve Data feed powers structure, setup detection, AI
              evidence and alerts.
            </p>
          </div>
          <span className={`mb-load-state is-${apiLoad}`}>
            <i />
            {apiLoad.replace("-", " ")}
          </span>
        </div>
        <div className="mb-workflow-rail">
          <div>
            <strong>4H</strong>
            <span>Bias & major structure</span>
            <small>Refresh context when a new 4H candle is available</small>
          </div>
          <b>→</b>
          <div>
            <strong>1H</strong>
            <span>Zone & price location</span>
            <small>Re-check on each closed 1H candle</small>
          </div>
          <b>→</b>
          <div className="is-execution">
            <strong>30M</strong>
            <span>Setup confirmation</span>
            <small>Only a closed 30M candle can unlock a trade</small>
          </div>
        </div>
        <div className="mb-profile-facts">
          <span>
            <Database size={15} />
            <b>{draft.symbols.length}</b> markets
          </span>
          <span>
            <Clock3 size={15} />
            <b>~{secondsPerSymbol}s</b> per symbol check
          </span>
          <span>
            <Activity size={15} />
            <b>{creditsPerSymbol}</b> estimated credits / symbol burst
          </span>
          <span>
            <Gauge size={15} />
            <b>{creditsPerFullCycle}</b> estimated credits / full cycle
          </span>
        </div>
        <div className={`mb-api-guard is-${apiLoad}`}>
          {apiLoad === "healthy" ? (
            <CheckCircle2 size={18} />
          ) : (
            <ShieldAlert size={18} />
          )}
          <div>
            <strong>Twelve Data load guard</strong>
            <span>
              {apiLoad === "healthy"
                ? `Current one-symbol burst is below the Basic 8 limit shown in your provider plan. Calls are cached and symbols are staggered.`
                : apiLoad === "near-limit"
                  ? "This profile is close to an 8-credit minute limit. Avoid manual refreshes while a worker cycle is running."
                  : "This profile may exceed an 8-credit minute limit. Remove optional timeframes or increase the cycle interval."}
            </span>
          </div>
          <em>
            {String(
              snapshot.connection.twelveData ??
                snapshot.config?.health.status ??
                "unknown",
            ).replaceAll("_", " ")}
          </em>
        </div>
      </section>
      <details className="mb-settings-section" open>
        <summary>
          General Scanner <span>Guided mode · {draft.provider}</span>
        </summary>
        <div className="mb-guided-grid">
          <label className="mb-guided-control">
            <span>
              <Database size={16} /> Market-data provider
            </span>
            <select
              value={draft.provider}
              onChange={(e) => {
                const provider = e.target.value as ScannerConfig["provider"];
                setDraft((current) => ({
                  ...current,
                  provider,
                  frequencySeconds:
                    provider === "twelvedata"
                      ? Math.max(
                          TWELVE_DATA_MIN_CYCLE_SECONDS,
                          current.frequencySeconds,
                        )
                      : current.frequencySeconds,
                }));
              }}
            >
              <option value="twelvedata">Twelve Data · paper trading</option>
              <option value="mt5">MetaTrader 5 · broker feed</option>
              <option value="coinbase">Coinbase · crypto analysis</option>
            </select>
            <small>
              {draft.provider === "twelvedata"
                ? "MT5 is not required. Real prices are used for Paper execution."
                : "Execution availability follows the selected provider."}
            </small>
          </label>
          <label className="mb-guided-control">
            <span>
              <ShieldAlert size={16} /> Risk account
            </span>
            <select
              value={draft.accountId ?? ""}
              onChange={(e) => update("accountId", e.target.value || null)}
            >
              <option value="">Select account · execution blocked</option>
              {snapshot.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.type} · {a.currency}
                </option>
              ))}
            </select>
            <small>
              {draft.accountId
                ? "Balance and limits from this account control every risk decision."
                : "Choose a funded Paper or MT5 account before execution can become READY."}
            </small>
          </label>
        </div>
        <label className="mb-paper-fast-entry">
          <input
            type="checkbox"
            checked={draft.paperFastEntry}
            onChange={(event) => update("paperFastEntry", event.target.checked)}
          />
          <span>
            <strong>Paper Fast Entry</strong>
            <small>
              Off by default. For approved canonical setups on Twelve Data
              Paper only, use the setup-specific closed 30M trigger instead of
              the shared ten-check gate. Fresh candles, account, risk, news,
              permissions and AUTO mode remain mandatory. MT5 is unchanged.
            </small>
          </span>
        </label>
        <div
          className="mb-cadence-picker"
          role="group"
          aria-label="Scanner cadence"
        >
          <span>
            <Zap size={16} /> API call schedule
          </span>
          {[
            [900, "Recommended", "Full two-market cycle every 15 minutes"],
            [1800, "Conservative", "Full cycle every 30 minutes"],
            [3600, "Low usage", "Full cycle every 60 minutes"],
          ].map(([seconds, title, description]) => (
            <button
              key={String(seconds)}
              type="button"
              className={draft.frequencySeconds === seconds ? "is-active" : ""}
              onClick={() => update("frequencySeconds", Number(seconds))}
            >
              <strong>{title}</strong>
              <span>{description}</span>
              <small>{Number(seconds) / 60} min full cycle</small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mb-apply-workflow"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              provider: "twelvedata",
              symbols: ["XAUUSD", "GBPJPY"],
              timeframes: ["4h", "1h", "30m"],
              frequencySeconds: TWELVE_DATA_MIN_CYCLE_SECONDS,
              minimumScore: OPPORTUNITY_SCORE_THRESHOLD,
              aiThreshold: OPPORTUNITY_SCORE_THRESHOLD,
              alertThreshold: OPPORTUNITY_SCORE_THRESHOLD,
            }))
          }
        >
          <CheckCircle2 size={17} /> Apply recommended XAUUSD + GBPJPY workflow
        </button>
        <details className="mb-advanced-settings">
          <summary>Advanced thresholds and daily limits</summary>
          <div className="mb-grid">
            <label>
              Exact full watchlist cycle (seconds)
              <input
                type="number"
                min={
                  draft.provider === "twelvedata"
                    ? TWELVE_DATA_MIN_CYCLE_SECONDS
                    : 60
                }
                max={3600}
                value={draft.frequencySeconds}
                onChange={(e) =>
                  update(
                    "frequencySeconds",
                    draft.provider === "twelvedata"
                      ? Math.max(
                          TWELVE_DATA_MIN_CYCLE_SECONDS,
                          Number(e.target.value),
                        )
                      : Number(e.target.value),
                  )
                }
              />
              {draft.provider === "twelvedata" && (
                <small>
                  Twelve Data is protected by a 900-second (15-minute) minimum.
                </small>
              )}
            </label>
            {(
              [
                ["minimumScore", "Minimum candidate score"],
                ["aiThreshold", "AI explanation threshold"],
                ["alertThreshold", "READY / alert threshold"],
                ["maxAlertsPerDay", "Maximum alerts per UTC day"],
                ["maxAiCallsPerDay", "Maximum AI calls per UTC day"],
                ["newsBeforeMinutes", "News blackout: minutes before"],
                ["newsAfterMinutes", "News blackout: minutes after"],
              ] as const
            ).map(([key, title]) => (
              <label key={key}>
                {title}
                <input
                  type="number"
                  min={
                    key === "minimumScore" ||
                    key === "aiThreshold" ||
                    key === "alertThreshold"
                      ? OPPORTUNITY_SCORE_THRESHOLD
                      : 0
                  }
                  value={draft[key]}
                  onChange={(e) => update(key, Number(e.target.value))}
                />
                {(key === "minimumScore" ||
                  key === "aiThreshold" ||
                  key === "alertThreshold") && (
                  <small>
                    20/100 unlocks opportunity processing. Required setup,
                    closed-candle, risk, news, fresh-data and execution gates
                    still must pass.
                  </small>
                )}
              </label>
            ))}
          </div>
        </details>
      </details>
      <details className="mb-settings-section" open>
        <summary>
          Risk Profile{" "}
          <span>
            {missingSizing.length
              ? `${missingSizing.length} custom specification${missingSizing.length === 1 ? "" : "s"} missing`
              : `${draft.risk.riskPercent}% per trade · automatic sizing`}
          </span>
        </summary>
        {missingSizing.length > 0 && (
          <div className="mb-risk-blocker" role="status">
            <ShieldAlert size={18} />
            <div>
              <strong>A custom instrument specification is required.</strong>
              <span>
                Missing: {missingSizing.join(", ")}. Standard FX and metal
                contracts are calculated automatically.
              </span>
            </div>
          </div>
        )}
        <div className="mb-grid">
          {(
            [
              ["riskPercent", "Risk per trade (%)"],
              ["maxDailyLossPercent", "Maximum daily loss (%)"],
              ["maxOpenPositions", "Maximum open positions"],
              ["maxOpenRiskPercent", "Maximum simultaneous risk (%)"],
              ["minimumRR", "Minimum reward/risk"],
            ] as const
          ).map(([key, title]) => (
            <label key={key}>
              {title}
              <input
                type="number"
                step="0.1"
                min={0}
                value={draft.risk[key]}
                onChange={(e) =>
                  update("risk", {
                    ...draft.risk,
                    [key]: Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>
      <details className="mb-settings-section" open>
        <summary>
          Market Selection{" "}
          <span>
            {draft.symbols.length} markets · {draft.timeframes.join(" / ")}
          </span>
        </summary>
        <SymbolManager
          symbols={draft.symbols}
          provider={draft.provider}
          onChange={(symbols) => update("symbols", symbols)}
        />
        <fieldset className="mb-panel">
          <legend>Multi-timeframe workflow</legend>
          <div className="mb-required-timeframes">
            {requiredFrames.map((tf, index) => (
              <span key={tf}>
                <CheckCircle2 size={15} />
                <strong>{tf.toUpperCase()}</strong>
                <small>
                  {index === 0
                    ? "Bias"
                    : index === 1
                      ? "Structure & zone"
                      : "Closed-candle confirmation"}
                </small>
              </span>
            ))}
          </div>
          <p className="mb-muted">
            These three workflow timeframes are loaded automatically for every
            enabled symbol and approved setup.
          </p>
          <details className="mb-advanced-settings">
            <summary>Optional chart and webhook timeframes</summary>
            <div className="mb-row mb-wrap">
              {TIMEFRAMES.filter(
                (tf) =>
                  !requiredFrames.includes(
                    tf as (typeof requiredFrames)[number],
                  ),
              ).map((tf) => (
                <label className="mb-check" key={tf}>
                  <input
                    type="checkbox"
                    checked={draft.timeframes.includes(tf)}
                    onChange={(e) =>
                      update(
                        "timeframes",
                        e.target.checked
                          ? [...draft.timeframes, tf]
                          : draft.timeframes.filter((t) => t !== tf),
                      )
                    }
                  />
                  {tf}
                </label>
              ))}
            </div>
          </details>
        </fieldset>
      </details>
      <details
        className="mb-settings-section"
        open={missingSizing.length > 0 || undefined}
      >
        <summary>
          Instrument Sizing{" "}
          <span>
            {missingSizing.length ? "Custom fallback required" : "Automatic"}
          </span>
        </summary>
        <fieldset className="mb-panel">
          <legend>Provider-aware position sizing</legend>
          <p className="mb-muted">
            Twelve Data supplies live prices and account-currency conversion.
            Onkar Paper uses explicit standard contracts (100,000 base units for
            FX; 100 oz for XAUUSD). MT5 uses the connected broker’s live tick
            value, tick size and volume step. Position size is rounded down so
            it cannot exceed your selected monetary risk.
          </p>
          <div className="mb-required-timeframes">
            {draft.symbols.map((s) => (
              <span key={s}>
                <CheckCircle2 size={15} />
                <strong>{s}</strong>
                <small>
                  {draft.provider === "mt5"
                    ? "MT5 broker specification"
                    : standardPaperSymbol(s)
                      ? "Paper contract + live conversion"
                      : "Custom fallback"}
                </small>
              </span>
            ))}
          </div>
          {missingSizing.length > 0 && (
            <details className="mb-advanced-settings">
              <summary>Custom instrument fallback values</summary>
              <div className="mb-grid">
                {missingSizing.map((s) => (
                  <label key={s}>
                    {s} · account-currency value per 1.0 price move
                    <input
                      inputMode="decimal"
                      value={contractText[s] ?? ""}
                      onChange={(e) => {
                        setContractText((old) => ({
                          ...old,
                          [s]: e.target.value,
                        }));
                        const values = { ...draft.risk.valuePerPriceUnit };
                        const n = Number(e.target.value.replace(",", "."));
                        if (n > 0) values[s] = n;
                        else delete values[s];
                        update("risk", {
                          ...draft.risk,
                          valuePerPriceUnit: values,
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
          )}
        </fieldset>
      </details>
      <details className="mb-settings-section" open>
        <summary>
          Setup Automation{" "}
          <span>
            {draft.autoActivateApprovedSetups
              ? "All approved · automatic"
              : `${draft.strategyVersionIds.length} enabled`}
          </span>
        </summary>
        <fieldset className="mb-panel">
          <legend>Active approved strategies</legend>
          <label className="mb-check">
            <input
              type="checkbox"
              checked={draft.autoActivateApprovedSetups}
              onChange={(e) =>
                update("autoActivateApprovedSetups", e.target.checked)
              }
            />
            Automatically scan every approved Setup Library version
          </label>
          <p className="mb-muted">
            Newly approved versions join the scanner automatically. Draft,
            disabled and AI-extracted versions remain blocked until approved.
          </p>
          {approvedVersions.length > 0 && (
            <div className="mb-row mb-wrap">
              <button
                type="button"
                onClick={() =>
                  update(
                    "strategyVersionIds",
                    approvedVersions.map((version) => version.id),
                  )
                }
              >
                Enable all approved setups
              </button>
              <button
                type="button"
                onClick={() => update("strategyVersionIds", [])}
              >
                Turn off all setups
              </button>
            </div>
          )}
          {approvedVersions.map((v) => (
            <label className="mb-check" key={v.id}>
              <input
                type="checkbox"
                disabled={draft.autoActivateApprovedSetups}
                checked={
                  draft.autoActivateApprovedSetups ||
                  draft.strategyVersionIds.includes(v.id)
                }
                onChange={(e) =>
                  update(
                    "strategyVersionIds",
                    e.target.checked
                      ? [...draft.strategyVersionIds, v.id]
                      : draft.strategyVersionIds.filter((id) => id !== v.id),
                  )
                }
              />
              {v.name} · {v.id.slice(0, 8)}
            </label>
          ))}
          {!approvedVersions.length && (
            <p className="mb-muted">Approve a version in Rules first.</p>
          )}
          <p className="mb-muted">
            {draft.autoActivateApprovedSetups
              ? "All approved setup versions are enabled automatically."
              : `${draft.strategyVersionIds.length} approved setup version${draft.strategyVersionIds.length === 1 ? "" : "s"} enabled.`}
          </p>
        </fieldset>
      </details>
      <details className="mb-settings-section">
        <summary>
          News & AI Limits{" "}
          <span>
            {draft.requireNews ? "Verified news required" : "Warnings only"}
          </span>
        </summary>
        <label className="mb-check">
          <input
            type="checkbox"
            checked={draft.requireNews}
            onChange={(e) => update("requireNews", e.target.checked)}
          />
          Require verified news clearance for READY
        </label>
        {!draft.requireNews && (
          <p className="mb-notice">
            News blocking is disabled. News warnings still appear; unavailable
            news must not be interpreted as safe.
          </p>
        )}
        <p className="mb-muted">
          AI and alert budgets are configured in General Scanner. Deterministic
          setup and risk checks continue even if AI explanation limits are
          reached.
        </p>
      </details>
      <label className="mb-check">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => update("enabled", e.target.checked)}
        />
        Enable autonomous analysis (never order execution)
      </label>
      {error && (
        <p role="alert" className="mb-notice">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="mb-primary"
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save scanner settings"}
      </button>
      <fieldset className="mb-panel">
        <legend>TradingView webhook</legend>
        <p className="mb-muted">
          Authenticated Pine alerts enqueue rule re-evaluation; they cannot
          approve a trade. Key generation revokes your previous key.
        </p>
        <button
          disabled={busy || !snapshot.config}
          onClick={async () => {
            setBusy(true);
            try {
              setWebhook(await brainRequest("/webhook-key", "POST"));
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Key generation failed",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Generate / rotate webhook key
        </button>
        {webhook && (
          <>
            <p className="mb-muted">
              Copy into TradingView privately. This key is shown only in this
              session.
            </p>
            <label>
              Endpoint
              <input readOnly value={`${location.origin}${webhook.path}`} />
            </label>
            <label>
              Secret
              <input
                type="password"
                readOnly
                value={webhook.secret}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(webhook.secret);
                } catch {
                  setError(
                    "Clipboard unavailable. Select and copy the secret field.",
                  );
                }
              }}
            >
              Copy secret
            </button>
          </>
        )}
      </fieldset>
    </div>
  );
}
