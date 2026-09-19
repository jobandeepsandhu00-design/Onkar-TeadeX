import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { mt5Request } from "./MT5StatusPanel";

type BrokerSymbols = {
  watchlist: Array<{
    internal: string;
    broker: string | null;
    confidence: number;
    manual: boolean;
    candidates: string[];
  }>;
  available: string[];
};

const QUICK_SYMBOLS = [
  "XAU/USD",
  "GBP/JPY",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "EUR/JPY",
  "AUD/USD",
  "USD/CAD",
  "NZD/USD",
  "EUR/GBP",
];

const canonical = (symbol: string) =>
  symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
const display = (symbol: string) => {
  const value = canonical(symbol);
  if (value === "XAUUSD" || value === "GOLD") return "XAU/USD";
  if (/^[A-Z]{6}$/.test(value)) return `${value.slice(0, 3)}/${value.slice(3)}`;
  return symbol.toUpperCase();
};

export function SymbolManager({
  symbols,
  provider,
  onChange,
}: {
  symbols: string[];
  provider: "mt5" | "twelvedata" | "coinbase";
  onChange: (symbols: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [broker, setBroker] = useState<BrokerSymbols | null>(null);
  const [brokerError, setBrokerError] = useState("");

  useEffect(() => {
    if (!open || provider !== "mt5" || broker) return;
    const controller = new AbortController();
    void mt5Request<BrokerSymbols>("/symbols", controller.signal)
      .then((result) => {
        setBroker(result);
        setBrokerError("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setBrokerError(
            error instanceof Error
              ? error.message
              : "Broker symbols unavailable",
          );
      });
    return () => controller.abort();
  }, [broker, open, provider]);

  const normalized = useMemo(
    () => symbols.map(canonical).filter(Boolean),
    [symbols],
  );
  const catalog = useMemo(() => {
    const discovered =
      broker?.watchlist.map((item) => ({
        internal: item.internal,
        broker: item.broker,
        confidence: item.confidence,
      })) ?? [];
    const raw =
      broker?.available.map((name) => ({
        internal: display(name),
        broker: name,
        confidence: 0,
      })) ?? [];
    const unique = new Map<string, (typeof discovered)[number]>();
    for (const item of [...discovered, ...raw]) {
      const key = canonical(item.internal);
      if (
        !unique.has(key) ||
        item.confidence > (unique.get(key)?.confidence ?? 0)
      )
        unique.set(key, item);
    }
    return [...unique.values()];
  }, [broker]);
  const results = catalog
    .filter((item) =>
      `${item.internal} ${item.broker ?? ""}`
        .toUpperCase()
        .includes(query.toUpperCase()),
    )
    .slice(0, 40);

  const add = (value: string) => {
    const next = canonical(value);
    if (next && !normalized.includes(next)) onChange([...normalized, next]);
  };
  const remove = (index: number) =>
    onChange(normalized.filter((_, position) => position !== index));
  const move = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= normalized.length) return;
    const next = [...normalized];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <section className="mb-symbol-manager">
      <div className="mb-row mb-between">
        <div>
          <strong>Markets</strong>
          <p className="mb-muted">Enabled symbols are scanned in this order.</p>
        </div>
        <button
          type="button"
          className="mb-symbol-add"
          onClick={() => setOpen(true)}
        >
          <Plus size={16} /> Add symbol
        </button>
      </div>
      <div className="mb-symbol-chips">
        {normalized.map((symbol, index) => (
          <div className="mb-symbol-chip" key={`${symbol}-${index}`}>
            <b>{display(symbol)}</b>
            <span>
              {provider === "mt5"
                ? (broker?.watchlist.find(
                    (item) => canonical(item.internal) === symbol,
                  )?.broker ?? "mapping on save")
                : provider}
            </span>
            <button
              type="button"
              aria-label={`Move ${display(symbol)} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              aria-label={`Move ${display(symbol)} down`}
              disabled={index === normalized.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              aria-label={`Remove ${display(symbol)}`}
              onClick={() => remove(index)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {!normalized.length ? (
          <p className="mb-notice">
            No markets enabled. Add at least one market before saving.
          </p>
        ) : null}
      </div>
      {open ? (
        <div
          className="mb-sheet-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setOpen(false)
          }
        >
          <div
            className="mb-symbol-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Add market"
          >
            <div className="mb-row mb-between">
              <div>
                <span className="mb-eyebrow">Watchlist</span>
                <h3>Add a market</h3>
              </div>
              <button
                type="button"
                className="mb-icon-button"
                aria-label="Close symbol manager"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label className="mb-symbol-search">
              <Search size={17} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search instrument…"
              />
            </label>
            <strong className="mb-sheet-label">Quick add</strong>
            <div className="mb-quick-symbols">
              {QUICK_SYMBOLS.map((symbol) => (
                <button
                  type="button"
                  disabled={normalized.includes(canonical(symbol))}
                  key={symbol}
                  onClick={() => add(symbol)}
                >
                  <Plus size={14} /> {symbol}
                </button>
              ))}
            </div>
            {provider === "mt5" ? (
              <>
                <div className="mb-row mb-between">
                  <strong className="mb-sheet-label">
                    Available from connected MT5 broker
                  </strong>
                  <small className="mb-muted">
                    {broker?.available.length ?? 0} found
                  </small>
                </div>
                {brokerError ? (
                  <p className="mb-notice">
                    MT5 symbols unavailable: {brokerError}. Quick-add markets
                    remain available and will be mapped when MT5 connects.
                  </p>
                ) : null}
                {!broker && !brokerError ? (
                  <p className="mb-muted">Loading broker instruments…</p>
                ) : null}
                <div className="mb-symbol-results">
                  {results.map((item) => {
                    const key = canonical(item.internal);
                    return (
                      <button
                        type="button"
                        key={`${key}-${item.broker}`}
                        disabled={normalized.includes(key)}
                        onClick={() => add(item.internal)}
                      >
                        <span>
                          <b>{display(item.internal)}</b>
                          <small>
                            {item.broker ?? "No confident broker mapping"}
                          </small>
                        </span>
                        <Plus size={16} />
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="mb-muted">
                The selected provider uses normalized symbols. Add a quick
                market above.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
