import { useEffect, useMemo, useRef, useState } from "react";
import type { ScannerConfig, ScannerSnapshot } from "@workspace/api-zod";
import {
  CheckCheck,
  Edit3,
  Layers3,
  PauseCircle,
  Radar,
  Search,
  Sparkles,
} from "lucide-react";
import { brainRequest } from "./api";
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
  onEditSetup,
}: {
  snapshot: ScannerSnapshot;
  onSaved: () => void;
  onEditSetup?: (setupId: string) => void;
}) {
  const config = snapshot.config?.config;
  const approved = useMemo(() => latestApprovedVersions(snapshot), [snapshot]);
  const [markets, setMarkets] = useState(config?.symbols ?? []);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const syncAttempted = useRef(false);

  const setupRows = useMemo(() => {
    const approvedBySetup = new Map(
      approved.map((version) => [version.source_setup_id, version]),
    );
    const libraryRows = snapshot.setups.map((setup) => ({
      setup,
      version: approvedBySetup.get(setup.id),
    }));
    const knownSetupIds = new Set(snapshot.setups.map((setup) => setup.id));
    const versionOnlyRows = approved
      .filter((version) => !knownSetupIds.has(version.source_setup_id))
      .map((version) => ({
        setup: { id: version.source_setup_id, name: version.name },
        version,
      }));
    return [...libraryRows, ...versionOnlyRows];
  }, [approved, snapshot.setups]);

  const visibleSetups = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return setupRows;
    return setupRows.filter(({ setup, version }) =>
      [setup.name, version?.definition.direction, version?.definition.timeframe]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [query, setupRows]);

  const selected = new Set(
    config?.autoActivateApprovedSetups
      ? approved.map((version) => version.id)
      : (config?.strategyVersionIds ?? []),
  );

  useEffect(() => {
    const approvedBySetup = new Map(
      approved.map((version) => [version.source_setup_id, version]),
    );
    const hasUnsyncedSetups = snapshot.setups.some(
      (setup) =>
        !approvedBySetup.get(setup.id)?.definition.autoExecutionAllowed,
    );
    if (!hasUnsyncedSetups || syncAttempted.current) return;
    syncAttempted.current = true;
    setSyncing(true);
    setError("");
    void brainRequest<{ synced: number; message: string }>(
      "/strategies/sync-library",
      "POST",
    )
      .then(async (result) => {
        if (config) {
          await brainRequest("/config", "PUT", {
            ...config,
            enabled: true,
            autoActivateApprovedSetups: true,
            strategyVersionIds: [],
          });
        }
        setError(result.message);
        onSaved();
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Automatic setup synchronization failed",
        ),
      )
      .finally(() => setSyncing(false));
  }, [approved, config, onSaved, snapshot.setups]);

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
            Choose setups once. Approved Setup Library rules are loaded
            automatically and every library setup stays visible in this list.
          </p>
        </div>
        <div className="mb-rules-counts">
          <span>
            <b>{selected.size}</b> active
          </span>
          <span>
            <b>{setupRows.length}</b> total
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
            {syncing
              ? "SYNCING"
              : config?.autoActivateApprovedSetups
                ? "AUTO SYNC"
                : "CUSTOM"}
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
              <b>Activate all approved setups</b>
              <small>
                All ready setups on · new approvals join automatically
              </small>
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
              <b>Choose setups individually</b>
              <small>
                Start with all ready setups, then turn off any you do not want
              </small>
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

        <label className="mb-setup-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all setups…"
            aria-label="Search all setups"
          />
          <span>{visibleSetups.length}</span>
        </label>

        {!setupRows.length ? (
          <p className="mb-notice">No setups exist in the Setup Library yet.</p>
        ) : (
          <div className="mb-easy-setup-list">
            {visibleSetups.map(({ setup, version }, index) => {
              const ready = Boolean(version);
              const enabled = version ? selected.has(version.id) : false;
              const symbolScope = version?.definition.symbols.length
                ? `${version.definition.symbols.length} specified`
                : "All scanner markets";
              return (
                <article
                  className={`${enabled ? "is-enabled" : ""} ${ready ? "" : "is-unavailable"}`}
                  key={setup.id}
                >
                  <span className="mb-setup-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="mb-easy-setup-copy">
                    <strong>{setup.name}</strong>
                    {version ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <small>
                          {syncing
                            ? "Approving canonical workflow…"
                            : "Saved in Setup Library · not scanner-ready"}
                        </small>
                        <div className="mb-chip-row">
                          <span className="mb-chip-warning">
                            {syncing ? "Preparing" : "Needs approved rules"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mb-easy-setup-actions">
                    <button
                      type="button"
                      className="mb-switch"
                      role="switch"
                      aria-label={
                        ready
                          ? `${enabled ? "Disable" : "Enable"} ${setup.name}`
                          : `${setup.name} needs approved scanner rules`
                      }
                      aria-checked={enabled}
                      disabled={busy || !version}
                      onClick={() =>
                        version && toggleSetup(version.id, !enabled)
                      }
                    >
                      <span />
                    </button>
                    <button
                      type="button"
                      className="mb-edit-rule"
                      onClick={() => onEditSetup?.(setup.id)}
                      disabled={!onEditSetup}
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
