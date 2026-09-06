export type Result = "Win" | "Loss" | "Breakeven" | "Open";

export type TradeRecord = Record<string, any> & {
  id: string;
  date?: string;
  symbol?: string;
  side?: string;
  session?: string;
  timeframe?: string;
  setupId?: string;
  entry?: string | number;
  exit?: string | number;
  sl?: string | number;
  tp?: string | number;
  manualPnl?: string | number;
  pnl?: string | number;
  result?: string;
  mistakes?: string[];
};

export type EnrichedTrade = TradeRecord & {
  outcome: Result;
  pnlValue: number;
  pipsValue: number;
  rValue: number | null;
  setupName: string;
  compliance: number | null;
};

export type MistakeMetric = {
  name: string;
  category: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  occurrences: number;
  losses: number;
  wins: number;
  pnl: number;
  pips: number;
  averageLoss: number;
  winRate: number;
  lossShare: number;
  trades: EnrichedTrade[];
};

export type GroupMetric = {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  pips: number;
  avgR: number;
  profitFactor: number | null;
};

const numberValue = (value: unknown) => {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export function pipSize(symbol = "") {
  const value = symbol.toUpperCase().replace("/", "");
  if (value.includes("JPY")) return 0.01;
  if (value.includes("XAU") || value.includes("GOLD")) return 0.1;
  if (
    value.includes("BTC") ||
    value.includes("ETH") ||
    value.includes("NAS") ||
    value.includes("US30")
  )
    return 1;
  return 0.0001;
}

export function enrichTrades(
  trades: TradeRecord[] = [],
  setups: Array<Record<string, any>> = [],
): EnrichedTrade[] {
  const setupNames = new Map(
    setups.map((setup) => [
      String(setup.id),
      String(setup.name || "Unassigned"),
    ]),
  );
  return trades.map((trade) => {
    const entry = numberValue(trade.entry);
    const exit = numberValue(trade.exit);
    const stop = numberValue(trade.sl);
    const direction = String(trade.side || "Buy")
      .toLowerCase()
      .includes("sell")
      ? -1
      : 1;
    const importedPnl =
      numberValue(trade.manualPnl) ??
      numberValue(trade.pnl) ??
      numberValue(trade.netPnl);
    const priceMove =
      entry !== null && exit !== null ? (exit - entry) * direction : null;
    const pnlValue = importedPnl ?? 0;
    const rawResult = String(trade.result || "").toLowerCase();
    let outcome: Result = "Open";
    if (rawResult.includes("win") || rawResult === "profit") outcome = "Win";
    else if (rawResult.includes("loss")) outcome = "Loss";
    else if (rawResult.includes("break") || rawResult === "be")
      outcome = "Breakeven";
    else if (exit !== null || importedPnl !== null)
      outcome =
        pnlValue > 0 || (priceMove ?? 0) > 0
          ? "Win"
          : pnlValue < 0 || (priceMove ?? 0) < 0
            ? "Loss"
            : "Breakeven";
    const pipsValue =
      numberValue(trade.pips) ??
      (priceMove !== null ? priceMove / pipSize(trade.symbol) : 0);
    const riskPerUnit =
      entry !== null && stop !== null ? Math.abs(entry - stop) : 0;
    const rValue =
      numberValue(trade.rMultiple) ??
      (priceMove !== null && riskPerUnit > 0 ? priceMove / riskPerUnit : null);
    const checks = Array.isArray(trade.ruleChecks) ? trade.ruleChecks : [];
    const compliance = checks.length
      ? Math.round(
          (checks.filter(
            (check: any) => check === true || check?.passed === true,
          ).length /
            checks.length) *
            100,
        )
      : typeof trade.ruleCompliance === "number"
        ? trade.ruleCompliance
        : trade.rulesViolated === true
          ? 0
          : trade.rulesViolated === false && trade.grade
            ? 100
            : null;

    return {
      ...trade,
      outcome,
      pnlValue,
      pipsValue,
      rValue,
      setupName:
        trade.setupName ||
        setupNames.get(String(trade.setupId || "")) ||
        "Unassigned",
      compliance,
    };
  });
}

export function groupTrades(
  trades: EnrichedTrade[],
  selector: (trade: EnrichedTrade) => string,
): GroupMetric[] {
  const groups = new Map<string, EnrichedTrade[]>();
  trades.forEach((trade) => {
    const key = selector(trade) || "Unspecified";
    groups.set(key, [...(groups.get(key) || []), trade]);
  });
  return [...groups.entries()].map(([key, rows]) => {
    const closed = rows.filter((row) => row.outcome !== "Open");
    const wins = closed.filter((row) => row.outcome === "Win").length;
    const losses = closed.filter((row) => row.outcome === "Loss").length;
    const grossWin = closed.reduce(
      (sum, row) => sum + Math.max(0, row.pnlValue),
      0,
    );
    const grossLoss = Math.abs(
      closed.reduce((sum, row) => sum + Math.min(0, row.pnlValue), 0),
    );
    const rValues = closed
      .map((row) => row.rValue)
      .filter((value): value is number => value !== null);
    return {
      key,
      trades: closed.length,
      wins,
      losses,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      pnl: closed.reduce((sum, row) => sum + row.pnlValue, 0),
      pips: closed.reduce((sum, row) => sum + row.pipsValue, 0),
      avgR: rValues.length
        ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length
        : 0,
      profitFactor: grossLoss
        ? grossWin / grossLoss
        : grossWin > 0
          ? Infinity
          : null,
    };
  });
}

export function mistakeCategory(
  name: string,
  custom: Array<Record<string, any>> = [],
) {
  const saved = custom.find(
    (item) => String(item.name).toLowerCase() === name.toLowerCase(),
  );
  if (saved?.category) return saved.category;
  const value = name.toLowerCase();
  if (/fomo|revenge|fear|confidence|impatien|overtrad/.test(value))
    return "Psychology";
  if (/risk|stop|sl|size|oversiz|loss/.test(value)) return "Risk";
  if (/exit|secure|winner|held/.test(value)) return "Exit";
  if (/session|volume|timing/.test(value)) return "Session";
  if (/setup|direction|s\/r|zone|htf|range/.test(value)) return "Strategy";
  return "Entry";
}

export function mistakeMetrics(
  trades: EnrichedTrade[],
  custom: Array<Record<string, any>> = [],
): MistakeMetric[] {
  const closed = trades.filter((trade) => trade.outcome !== "Open");
  const losingTrades = closed.filter((trade) => trade.outcome === "Loss");
  const names = new Set<string>();
  closed.forEach((trade) =>
    (trade.mistakes || []).forEach((mistake: string) => names.add(mistake)),
  );
  return [...names]
    .map((name) => {
      const rows = closed.filter((trade) =>
        (trade.mistakes || []).includes(name),
      );
      const losses = rows.filter((trade) => trade.outcome === "Loss");
      const wins = rows.filter((trade) => trade.outcome === "Win");
      const pnl = rows.reduce((sum, trade) => sum + trade.pnlValue, 0);
      const pips = rows.reduce((sum, trade) => sum + trade.pipsValue, 0);
      const saved = custom.find(
        (item) => String(item.name).toLowerCase() === name.toLowerCase(),
      );
      const severity =
        saved?.severity ||
        (losses.length >= 8 || pnl <= -500
          ? "Critical"
          : losses.length >= 4 || pnl <= -200
            ? "High"
            : losses.length >= 2 || pnl < 0
              ? "Medium"
              : "Low");
      return {
        name,
        category: mistakeCategory(name, custom),
        severity,
        occurrences: rows.length,
        losses: losses.length,
        wins: wins.length,
        pnl,
        pips,
        averageLoss: losses.length
          ? losses.reduce((sum, trade) => sum + trade.pnlValue, 0) /
            losses.length
          : 0,
        winRate: rows.length ? (wins.length / rows.length) * 100 : 0,
        lossShare: losingTrades.length
          ? (losses.length / losingTrades.length) * 100
          : 0,
        trades: rows,
      };
    })
    .sort((a, b) => a.pnl - b.pnl || b.occurrences - a.occurrences);
}

export function cumulativeSeries(trades: EnrichedTrade[]) {
  let equity = 0;
  let peak = 0;
  let wins = 0;
  const closed = [...trades]
    .filter((trade) => trade.outcome !== "Open")
    .sort((a, b) =>
      `${a.date || ""}${a.entryTime || ""}`.localeCompare(
        `${b.date || ""}${b.entryTime || ""}`,
      ),
    );
  return closed.map((trade, index) => {
    equity += trade.pnlValue;
    peak = Math.max(peak, equity);
    if (trade.outcome === "Win") wins += 1;
    return {
      index: index + 1,
      date: trade.date || `Trade ${index + 1}`,
      symbol: trade.symbol || "—",
      pnl: trade.pnlValue,
      pips: trade.pipsValue,
      r: trade.rValue || 0,
      equity,
      drawdown: equity - peak,
      winRate: Math.round((wins / (index + 1)) * 100),
    };
  });
}

export function dateStart(preset: string) {
  const now = new Date();
  const date = new Date(now);
  const localDate = (value: Date) => {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 10);
  };
  if (preset === "Today") return localDate(now);
  if (preset === "7 Days") date.setDate(now.getDate() - 6);
  else if (preset === "30 Days") date.setDate(now.getDate() - 29);
  else if (preset === "90 Days") date.setDate(now.getDate() - 89);
  else if (preset === "This Month") date.setDate(1);
  else if (preset === "This Year") {
    date.setMonth(0);
    date.setDate(1);
  } else return "";
  return localDate(date);
}

export function money(value: number, currency: string) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${currency}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function signed(value: number, suffix = "") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}${suffix}`;
}
