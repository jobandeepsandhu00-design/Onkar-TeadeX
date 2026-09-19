import { useState } from "react";
import {
  TIMEFRAMES,
  scannerConfigSchema,
  type ScannerConfig,
  type ScannerSnapshot,
} from "@workspace/api-zod";
import { brainRequest } from "./api";
import { SymbolManager } from "./SymbolManager";

export function ScannerSettings({
  snapshot,
  onSaved,
}: {
  snapshot: ScannerSnapshot;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ScannerConfig>(
    () => snapshot.config?.config ?? snapshot.defaults,
  );
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
  const update = <K extends keyof ScannerConfig>(
    key: K,
    value: ScannerConfig[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));
  async function save() {
    const parsed = scannerConfigSchema.safeParse({
      ...draft,
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
      <h3>Scanner configuration</h3>
      <p className="mb-muted">
        Only your approved versions and selected account are used. Your
        journal’s fallback balance is never used for scanner risk. Monitoring
        runs on the server, not in this tab.
      </p>
      <div className="mb-grid">
        <label>
          Market-data provider
          <select
            value={draft.provider}
            onChange={(e) =>
              update("provider", e.target.value as ScannerConfig["provider"])
            }
          >
            <option value="mt5">MetaTrader 5 · connected broker feed</option>
            <option value="twelvedata">
              Twelve Data · server API key required
            </option>
            <option value="coinbase">Coinbase · public crypto markets</option>
          </select>
        </label>
        <label>
          Risk account
          <select
            value={draft.accountId ?? ""}
            onChange={(e) => update("accountId", e.target.value || null)}
          >
            <option value="">Select account (risk otherwise blocked)</option>
            {snapshot.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.type} · {a.currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Full watchlist cycle (seconds)
          <input
            type="number"
            min={60}
            max={3600}
            value={draft.frequencySeconds}
            onChange={(e) => update("frequencySeconds", Number(e.target.value))}
          />
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
              min={0}
              value={draft[key]}
              onChange={(e) => update(key, Number(e.target.value))}
            />
          </label>
        ))}
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
                update("risk", { ...draft.risk, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <SymbolManager
        symbols={draft.symbols}
        provider={draft.provider}
        onChange={(symbols) => update("symbols", symbols)}
      />
      <fieldset className="mb-panel">
        <legend>Market / webhook timeframes</legend>
        <div className="mb-row mb-wrap">
          {TIMEFRAMES.map((tf) => (
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
        <p className="mb-muted">
          The scanner additionally loads every timeframe required by active
          strategy rules.
        </p>
      </fieldset>
      <fieldset className="mb-panel">
        <legend>Instrument sizing in this account’s currency</legend>
        <p className="mb-muted">
          Enter the account-currency P&L for a price move of 1.0 per one
          unit/lot of your broker’s position size. Check your broker’s contract
          specification and currency conversion. Missing values block READY;
          they are not guessed.
        </p>
        <div className="mb-grid">
          {draft.symbols.map((s) => (
            <label key={s}>
              {s}
              <input
                inputMode="decimal"
                value={contractText[s] ?? ""}
                onChange={(e) => {
                  setContractText((old) => ({ ...old, [s]: e.target.value }));
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
      </fieldset>
      <fieldset className="mb-panel">
        <legend>Active approved strategies</legend>
        {snapshot.versions.some(
          (version) => version.definition.approval === "approved",
        ) && (
          <div className="mb-row mb-wrap">
            <button
              type="button"
              onClick={() =>
                update(
                  "strategyVersionIds",
                  snapshot.versions
                    .filter(
                      (version) => version.definition.approval === "approved",
                    )
                    .map((version) => version.id),
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
        {snapshot.versions
          .filter((v) => v.definition.approval === "approved")
          .map((v) => (
            <label className="mb-check" key={v.id}>
              <input
                type="checkbox"
                checked={draft.strategyVersionIds.includes(v.id)}
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
        {!snapshot.versions.some(
          (v) => v.definition.approval === "approved",
        ) && <p className="mb-muted">Approve a version in Rules first.</p>}
        <p className="mb-muted">
          {draft.strategyVersionIds.length} approved setup version
          {draft.strategyVersionIds.length === 1 ? "" : "s"} enabled.
        </p>
      </fieldset>
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
