import { useState } from "react";
import {
  FEATURES,
  TIMEFRAMES,
  strategyVersionSchema,
  type MachineRule,
  type ScannerSnapshot,
  type StrategyVersion,
} from "@workspace/api-zod";
import { Plus, Trash2 } from "lucide-react";
import { brainRequest } from "./api";

export function RuleBuilder({
  snapshot,
  onSaved,
}: {
  snapshot: ScannerSnapshot;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<StrategyVersion>(() => ({
    sourceSetupId: snapshot.setups[0]?.id || "",
    name: snapshot.setups[0]?.name || "",
    direction: "long",
    timeframe: "15m",
    higherTimeframe: "1h",
    symbols: [],
    sessions: [],
    rules: [],
    approval: "draft",
    minRR: 2,
    expiresBars: 16,
  }));
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [symbolsText, setSymbolsText] = useState("");
  const update = <K extends keyof StrategyVersion>(
    key: K,
    value: StrategyVersion[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));
  const rule = (id: string, patch: Partial<MachineRule>) =>
    setDraft((d) => ({
      ...d,
      rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  async function save(approval: StrategyVersion["approval"]) {
    const parsed = strategyVersionSchema.safeParse({
      ...draft,
      approval,
      symbols: symbolsText
        .toUpperCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" · "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await brainRequest("/strategies", "POST", parsed.data);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save version");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-stack">
      <div>
        <h3>Strategy rule versions</h3>
        <p className="mb-muted">
          Extend an existing setup with explicit conditions. Prose, videos and
          AI-extracted ideas do not become active rules until you approve them.
          Each save preserves the previous version.
        </p>
      </div>
      {!snapshot.setups.length ? (
        <p className="mb-notice">
          Create a setup in your existing Setup Library first. No duplicate
          setup library is created here.
        </p>
      ) : (
        <>
          <div className="mb-grid">
            <label>
              Existing setup
              <select
                value={draft.sourceSetupId}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    sourceSetupId: e.target.value,
                    name:
                      snapshot.setups.find((s) => s.id === e.target.value)
                        ?.name || "",
                  }))
                }
              >
                {snapshot.setups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Version name
              <input
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              Direction
              <select
                value={draft.direction}
                onChange={(e) =>
                  update(
                    "direction",
                    e.target.value as StrategyVersion["direction"],
                  )
                }
              >
                {["long", "short", "both"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Execution timeframe
              <select
                value={draft.timeframe}
                onChange={(e) =>
                  update(
                    "timeframe",
                    e.target.value as StrategyVersion["timeframe"],
                  )
                }
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Higher timeframe
              <select
                value={draft.higherTimeframe}
                onChange={(e) =>
                  update(
                    "higherTimeframe",
                    e.target.value as StrategyVersion["higherTimeframe"],
                  )
                }
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum planned R:R
              <input
                type="number"
                min={1}
                max={10}
                step="0.1"
                value={draft.minRR}
                onChange={(e) => update("minRR", Number(e.target.value))}
              />
            </label>
            <label>
              Symbols (empty = scanner symbols)
              <input
                value={symbolsText}
                onChange={(e) => setSymbolsText(e.target.value)}
                placeholder="EURUSD, XAUUSD"
              />
            </label>
            <label>
              Valid for execution candles
              <input
                type="number"
                min={2}
                max={96}
                value={draft.expiresBars}
                onChange={(e) => update("expiresBars", Number(e.target.value))}
              />
            </label>
          </div>
          <div className="mb-row mb-wrap">
            {["Asia", "London", "New York", "London/NY"].map((s) => (
              <label className="mb-check" key={s}>
                <input
                  type="checkbox"
                  checked={draft.sessions.includes(s)}
                  onChange={(e) =>
                    update(
                      "sessions",
                      e.target.checked
                        ? [...draft.sessions, s]
                        : draft.sessions.filter((x) => x !== s),
                    )
                  }
                />
                {s}
              </label>
            ))}
            <span className="mb-muted">No sessions selected = all</span>
          </div>
          {draft.rules.map((r, i) => (
            <fieldset className="mb-panel" key={r.id}>
              <legend>Condition {i + 1}</legend>
              <div className="mb-grid">
                <label>
                  Feature
                  <select
                    value={r.feature}
                    onChange={(e) =>
                      rule(r.id, {
                        feature: e.target.value as MachineRule["feature"],
                      })
                    }
                  >
                    {FEATURES.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Timeframe
                  <select
                    value={r.timeframe}
                    onChange={(e) =>
                      rule(r.id, {
                        timeframe: e.target.value as MachineRule["timeframe"],
                      })
                    }
                  >
                    {TIMEFRAMES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Comparison
                  <select
                    value={r.operator}
                    onChange={(e) =>
                      rule(r.id, {
                        operator: e.target.value as MachineRule["operator"],
                      })
                    }
                  >
                    {["eq", "neq", "gt", "gte", "lt", "lte"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Expected value
                  <input
                    value={String(r.expected)}
                    onChange={(e) => {
                      const v = e.target.value;
                      rule(r.id, {
                        expected:
                          v === "true"
                            ? true
                            : v === "false"
                              ? false
                              : v.trim() && Number.isFinite(Number(v))
                                ? Number(v)
                                : v,
                      });
                    }}
                    placeholder="bullish, true, or a number"
                  />
                </label>
                <label>
                  Weight
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={r.weight}
                    onChange={(e) =>
                      rule(r.id, { weight: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Explanation
                  <input
                    value={r.explanation}
                    onChange={(e) =>
                      rule(r.id, { explanation: e.target.value })
                    }
                    maxLength={500}
                  />
                </label>
              </div>
              <div className="mb-row">
                <label className="mb-check">
                  <input
                    type="checkbox"
                    checked={r.required}
                    onChange={(e) => rule(r.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "rules",
                      draft.rules.filter((x) => x.id !== r.id),
                    )
                  }
                  aria-label={`Remove condition ${i + 1}`}
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={draft.rules.length >= 30}
            onClick={() =>
              update("rules", [
                ...draft.rules,
                {
                  id: crypto.randomUUID(),
                  feature: "trend",
                  timeframe: draft.higherTimeframe,
                  operator: "eq",
                  expected: "bullish",
                  required: true,
                  weight: 15,
                  explanation: "",
                },
              ])
            }
          >
            <Plus size={16} />
            Add condition
          </button>
          <p className="mb-muted">
            Score = passed weights / all weights. “neq” means not equal;
            unavailable values always fail. Trend/pattern values: bullish,
            bearish, ranging or none. Boolean conditions use true/false. Raw
            volume can be unavailable for Forex. Score is not a probability of
            winning.
          </p>
          {error && (
            <p role="alert" className="mb-notice">
              {error}
            </p>
          )}
          <div className="mb-row mb-wrap">
            <button disabled={busy} onClick={() => void save("draft")}>
              Save draft
            </button>
            <button
              className="mb-primary"
              disabled={busy}
              onClick={() => void save("approved")}
            >
              {busy ? "Saving…" : "I approve these rules · Save version"}
            </button>
          </div>
        </>
      )}
      <div className="mb-stack">
        {snapshot.versions.map((v, i) => (
          <div className="mb-panel mb-row mb-between" key={v.id}>
            <div>
              <strong>{v.name}</strong>
              <p className="mb-muted">
                {v.definition.approval} · {v.definition.rules.length} rules ·{" "}
                {new Date(v.created_at).toLocaleString()} · {v.id.slice(0, 8)}
              </p>
            </div>
            <button
              onClick={() => {
                setDraft({ ...v.definition, approval: "draft" });
                setSymbolsText(v.definition.symbols.join(", "));
                setError("");
              }}
            >
              Revise
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
