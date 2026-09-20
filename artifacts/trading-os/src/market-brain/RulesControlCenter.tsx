import { useMemo, useState } from "react";
import type { ScannerConfig, ScannerSnapshot } from "@workspace/api-zod";
import {
  CheckCheck,
  ChevronDown,
  Edit3,
  Layers3,
  PauseCircle,
  Radar,
  Sparkles,
} from "lucide-react";
import { brainRequest } from "./api";
import { RuleVersionEditor } from "./RuleBuilder";
import { SymbolManager } from "./SymbolManager";
import { latestApprovedVersions } from "./strategy-versions";

const MAJOR_MARKETS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "GBPJPY",
  "EURJPY",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURGBP",
  "XAUUSD",
];

export function RulesControlCenter({
  snapshot,
  onSaved,
}: {
  snapshot: ScannerSnapshot;
  onSaved: () => void;
}) {
  const config = snapshot.config?.config;
  const approved = useMemo(() => latestApprovedVersions(snapshot), [snapshot]);
  const [markets, setMarkets] = useState(config?.symbols ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = new Set(
    config?.autoActivateApprovedSetups
      ? approved.map((version) => version.id)
      : (config?.strategyVersionIds ?? []),
  );

  async function saveConfig(
    patch: Partial<ScannerConfig>,
    successMessage?: string,
  ) {
    if (!config) {
      setError("Save the scanner profile once before activating setups.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await brainRequest("/config", "PUT", { ...config, ...patch });
      if (successMessage) setError(successMessage);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rules update failed");
    } finally {
      setBusy(false);
    }
  }

  const toggleSetup = (versionId: string, enabled: boolean) => {
    const ids = config?.autoActivateApprovedSetups
      ? approved.map((version) => version.id)
      : (config?.strategyVersionIds ?? []);
    void saveConfig({
      enabled: true,
      autoActivateApprovedSetups: false,
      strategyVersionIds: enabled
        ? [...new Set([...ids, versionId])]
        : ids.filter((id) => id !== versionId),
    });
  };

  return (
    <div className="mb-rules-center">
      <section className="mb-rules-hero">
        <div className="mb-rules-hero-icon">
          <Sparkles size={24} />
        </div>
        <div>
          <span className="mb-eyebrow">AUTOMATIC RULE CONTROL</span>
          <h3>Setup & Market Automation</h3>
          <p>
            Choose everything once. The scanner reads approved Setup Library
            rules automatically; detailed editing stays optional.
          </p>
        </div>
        <div className="mb-rules-counts">
          <span>
            <b>{selected.size}</b> setups
          </span>
          <span>
            <b>{config?.symbols.length ?? 0}</b> markets
          </span>
        </div>
      </section>

      <section className="mb-bulk-control">
        <div className="mb-section-heading">
          <div>
            <span className="mb-eyebrow">STEP 1</span>
            <h3>Choose setups</h3>
          </div>
          <span className="mb-badge mb-positive">
            {config?.autoActivateApprovedSetups ? "AUTO SYNC" : "CUSTOM"}
          </span>
        </div>
        <div className="mb-rule-presets">
          <button
            className={config?.autoActivateApprovedSetups ? "is-active" : ""}
            disabled={busy || !approved.length}
            onClick={() =>
              void saveConfig({
                enabled: true,
                autoActivateApprovedSetups: true,
                strategyVersionIds: [],
              })
            }
          >
            <CheckCheck size={19} />
            <span>
              <b>Select all approved</b>
              <small>New approvals join automatically</small>
            </span>
          </button>
          <button
            disabled={busy || !approved.length}
            onClick={() =>
              void saveConfig({
                enabled: true,
                autoActivateApprovedSetups: false,
                strategyVersionIds: approved.map((version) => version.id),
              })
            }
          >
            <Layers3 size={19} />
            <span>
              <b>Custom selection</b>
              <small>Turn individual setups on or off</small>
            </span>
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void saveConfig({
                enabled: false,
                autoActivateApprovedSetups: false,
                strategyVersionIds: [],
              })
            }
          >
            <PauseCircle size={19} />
            <span>
              <b>Pause all setups</b>
              <small>No setup scans until re-enabled</small>
            </span>
          </button>
        </div>

        {!approved.length ? (
          <p className="mb-notice">
            No approved setup version exists yet. Draft and old versions remain
            unavailable to the scanner.
          </p>
        ) : (
          <div className="mb-easy-setup-list">
            {approved.map((version, index) => {
              const enabled = selected.has(version.id);
              const symbolScope = version.definition.symbols.length
                ? `${version.definition.symbols.length} specified`
                : "All scanner markets";
              return (
                <article
                  className={enabled ? "is-enabled" : ""}
                  key={version.id}
                >
                  <span className="mb-setup-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="mb-easy-setup-copy">
                    <strong>{version.name}</strong>
                    <small>
                      {version.definition.direction.toUpperCase()} ·{" "}
                      {version.definition.higherTimeframe} →{" "}
                      {version.definition.timeframe} · {symbolScope}
                    </small>
                    <div className="mb-chip-row">
                      <span>R:R ≥ {version.definition.minRR}</span>
                      <span>{version.definition.rules.length} rules</span>
                      <span>
                        {version.definition.autoExecutionAllowed
                          ? "AUTO allowed"
                          : "Review only"}
                      </span>
                    </div>
                  </div>
                  <div className="mb-easy-setup-actions">
                    <button
                      type="button"
                      className="mb-switch"
                      role="switch"
                      aria-label={`${enabled ? "Disable" : "Enable"} ${version.name}`}
                      aria-checked={enabled}
                      disabled={busy}
                      onClick={() => toggleSetup(version.id, !enabled)}
                    >
                      <span />
                    </button>
                    <button
                      type="button"
                      className="mb-edit-rule"
                      onClick={() => {
                        setEditing(version.id);
                        setEditorOpen(true);
                      }}
                    >
                      <Edit3 size={15} /> Edit
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-bulk-control">
        <div className="mb-section-heading">
          <div>
            <span className="mb-eyebrow">STEP 2</span>
            <h3>Choose markets</h3>
          </div>
          <span className="mb-badge">{markets.length} SELECTED</span>
        </div>
        <div className="mb-market-presets">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMarkets(MAJOR_MARKETS)}
          >
            <Radar size={17} /> Select all major pairs + Gold
          </button>
          <button type="button" disabled={busy} onClick={() => setMarkets([])}>
            Clear selection
          </button>
        </div>
        <SymbolManager
          symbols={markets}
          provider={config?.provider ?? "twelvedata"}
          onChange={setMarkets}
        />
        <button
          className="mb-primary mb-save-market-scope"
          disabled={busy || !markets.length}
          onClick={() => void saveConfig({ symbols: markets })}
        >
          {busy ? "Saving…" : "Save market selection"}
        </button>
      </section>

      <section className="mb-rule-editor-shell">
        <button
          className="mb-rule-editor-toggle"
          type="button"
          aria-expanded={editorOpen}
          onClick={() => {
            if (!editorOpen) setEditing(null);
            setEditorOpen((open) => !open);
          }}
        >
          <span>
            <Edit3 size={18} />
            <b>Advanced setup editor</b>
            <small>Create or revise one setup only when needed</small>
          </span>
          <ChevronDown size={18} />
        </button>
        {editorOpen ? (
          <div className="mb-rule-editor-body">
            <RuleVersionEditor
              key={editing ?? "new-version"}
              snapshot={snapshot}
              initialVersionId={editing}
              onSaved={() => {
                setEditorOpen(false);
                setEditing(null);
                onSaved();
              }}
            />
          </div>
        ) : null}
      </section>

      {error ? (
        <p
          className={error.startsWith("Rules") ? "mb-success" : "mb-notice"}
          role="status"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
