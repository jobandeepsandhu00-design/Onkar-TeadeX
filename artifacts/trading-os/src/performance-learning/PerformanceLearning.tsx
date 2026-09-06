import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Brain,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Filter,
  Flag,
  Layers3,
  Lightbulb,
  ListChecks,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  cumulativeSeries,
  dateStart,
  enrichTrades,
  groupTrades,
  mistakeMetrics,
  money,
  signed,
  type EnrichedTrade,
  type GroupMetric,
  type MistakeMetric,
} from "./analytics";

type Props = {
  data: any;
  setData: (updater: (current: any) => any) => void;
  onClose?: () => void;
  embedded?: boolean;
};

type Filters = {
  preset: string;
  customStart: string;
  customEnd: string;
  account: string;
  symbol: string;
  setup: string;
  session: string;
  timeframe: string;
  direction: string;
  result: string;
  query: string;
};

const panel =
  "rounded-2xl border border-slate-800/90 bg-slate-900/75 shadow-xl shadow-black/10";
const input =
  "h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-slate-300 outline-none transition focus:border-amber-500/60";
const presets = [
  "Today",
  "7 Days",
  "30 Days",
  "90 Days",
  "This Month",
  "This Year",
  "All Time",
  "Custom",
];

function pct(value: number) {
  return `${Math.round(value)}%`;
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function unique(values: Array<string | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort();
}

const MISTAKE_ACTIONS: Record<string, string> = {
  "Entered too early": "Wait for the confirmation candle to close before entering.",
  "No confirmation": "Require your saved confirmation rule before every entry.",
  "Chased price": "Only enter near the planned zone; skip extended candles.",
  "Entered in middle of range": "Wait for price to reach a clear support or resistance area.",
  "Wrong direction": "Confirm higher-timeframe and session direction before entry.",
  "Ignored higher timeframe": "Check M30/H1 structure and nearby H1/H4 zones first.",
  "H1/H4 zone nearby": "Avoid entries without clean room beyond the higher-timeframe zone.",
  "Moved stop loss": "Set the invalidation level before entry and do not widen it.",
  Overtrading: "Set a maximum number of trades for the session and stop at the limit.",
  FOMO: "Use a short pause checklist and accept missed trades instead of chasing.",
  "Revenge trade": "Pause after a loss and complete a review before taking another trade.",
  "Low volume": "Wait for a planned volume window and a valid M15/M30 body.",
  "No clear S/R": "Mark support and resistance before considering an entry.",
  "4th/5th motion candle": "Skip late-motion entries and wait for a fresh pullback or structure.",
  "Poor clean range": "Confirm enough unobstructed room to the target before entry.",
  "Bad session timing": "Trade only inside the sessions defined in your plan.",
  "Oversized risk": "Keep risk at or below your predefined maximum.",
  "Did not secure profit": "Follow your planned partial or protection rule at the chosen milestone.",
  "Held loser too long": "Exit when your invalidation or structure-break rule triggers.",
  "Cut winner too early": "Manage the trade using the planned target and structure, not emotion.",
};
const WIN_STRENGTH_OPTIONS = [
  "Followed setup rules",
  "Waited for confirmation",
  "Followed session trend",
  "Clear S/R",
  "Clean range",
  "Good volume",
  "Correct entry timing",
  "Good stop loss",
  "Risk managed correctly",
  "Stayed patient",
  "Held the winner",
  "Took planned profit",
];

function topTag(trades: EnrichedTrade[], key: "mistakes" | "strengths") {
  const counts = new Map<string, number>();
  trades.forEach((trade) =>
    (Array.isArray(trade[key]) ? trade[key] : []).forEach((tag: string) =>
      counts.set(tag, (counts.get(tag) || 0) + 1),
    ),
  );
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
}

function KpiCard({
  label,
  value,
  tone = "slate",
  hint,
  bars,
}: {
  label: string;
  value: string;
  tone?: string;
  hint: string;
  bars: number[];
}) {
  const toneClass =
    tone === "green"
      ? "text-emerald-400"
      : tone === "red"
        ? "text-rose-400"
        : tone === "gold"
          ? "text-amber-400"
          : tone === "blue"
            ? "text-sky-400"
            : "text-slate-100";
  const max = Math.max(1, ...bars.map((bar) => Math.abs(bar)));
  return (
    <div
      title={hint}
      className={`${panel} min-w-[145px] p-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-slate-700`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {label}
          </p>
          <p
            className={`mt-1 text-lg font-black tracking-tight ${toneClass}`}
            style={{ fontFamily: "'Sora',sans-serif" }}
          >
            {value}
          </p>
        </div>
        <BarChart3
          size={14}
          className="mt-0.5 text-slate-700"
          aria-hidden="true"
        />
      </div>
      <div className="mt-3 flex h-5 items-end gap-1" aria-hidden="true">
        {(bars.length ? bars : [0, 0, 0, 0, 0, 0])
          .slice(-8)
          .map((bar, index) => (
            <span
              key={index}
              className={`flex-1 rounded-sm ${bar < 0 ? "bg-rose-500/55" : bar > 0 ? "bg-emerald-500/55" : "bg-slate-700/70"}`}
              style={{ height: `${Math.max(3, (Math.abs(bar) / max) * 20)}px` }}
            />
          ))}
      </div>
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  data,
  trades,
  sticky = true,
}: {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
  data: any;
  trades: EnrichedTrade[];
  sticky?: boolean;
}) {
  const options = [
    [
      "account",
      "All accounts",
      (data.tradingAccounts || []).map((account: any) => [
        account.id,
        account.alias || account.accountNumber,
      ]),
    ],
    [
      "symbol",
      "All symbols",
      unique(trades.map((trade) => trade.symbol)).map((value) => [
        value,
        value,
      ]),
    ],
    [
      "setup",
      "All setups",
      unique(trades.map((trade) => trade.setupName)).map((value) => [
        value,
        value,
      ]),
    ],
    [
      "session",
      "All sessions",
      unique(trades.map((trade) => trade.session)).map((value) => [
        value,
        value,
      ]),
    ],
    [
      "timeframe",
      "All timeframes",
      unique(trades.map((trade) => trade.timeframe)).map((value) => [
        value,
        value,
      ]),
    ],
    [
      "direction",
      "Buy & Sell",
      [
        ["Buy", "Buy"],
        ["Sell", "Sell"],
      ],
    ],
    [
      "result",
      "All results",
      [
        ["Win", "Win"],
        ["Loss", "Loss"],
        ["Breakeven", "Break-even"],
      ],
    ],
  ] as Array<[keyof Filters, string, string[][]]>;
  return (
    <div
      className={`${panel} ${sticky ? "sticky top-0 z-20" : ""} p-3 backdrop-blur-xl`}
    >
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => onChange("preset", preset)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition ${filters.preset === preset ? "border-amber-500/60 bg-amber-500/15 text-amber-300" : "border-slate-800 bg-slate-950 text-slate-500 hover:text-slate-300"}`}
          >
            {preset}
          </button>
        ))}
      </div>
      {filters.preset === "Custom" && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:max-w-sm">
          <input
            type="date"
            value={filters.customStart}
            onChange={(event) => onChange("customStart", event.target.value)}
            className={input}
            aria-label="Custom range start"
          />
          <input
            type="date"
            value={filters.customEnd}
            onChange={(event) => onChange("customEnd", event.target.value)}
            className={input}
            aria-label="Custom range end"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {options.map(([key, label, values]) => (
          <select
            key={key}
            value={filters[key]}
            onChange={(event) => onChange(key, event.target.value)}
            className={input}
            aria-label={label}
          >
            <option value="">{label}</option>
            {values.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        ))}
        <label className="relative col-span-2 md:col-span-1">
          <Search
            size={13}
            className="absolute left-3 top-3.5 text-slate-600"
          />
          <input
            value={filters.query}
            onChange={(event) => onChange("query", event.target.value)}
            placeholder="Search trades…"
            className={`${input} w-full pl-9`}
          />
        </label>
      </div>
    </div>
  );
}

function PerformanceOverview({
  trades,
  currency,
}: {
  trades: EnrichedTrade[];
  currency: string;
}) {
  const [metric, setMetric] = useState("equity");
  const series = useMemo(() => cumulativeSeries(trades), [trades]);
  const metricConfig: Record<
    string,
    {
      key: string;
      label: string;
      color: string;
      format: (value: number) => string;
    }
  > = {
    pnl: {
      key: "pnl",
      label: "Trade P&L",
      color: "#38bdf8",
      format: (value) => money(value, currency),
    },
    equity: {
      key: "equity",
      label: "Cumulative P&L",
      color: "#34d399",
      format: (value) => money(value, currency),
    },
    pips: {
      key: "pips",
      label: "Pips",
      color: "#f59e0b",
      format: (value) => signed(value, "p"),
    },
    winRate: {
      key: "winRate",
      label: "Win Rate",
      color: "#a78bfa",
      format: (value) => `${value.toFixed(0)}%`,
    },
    drawdown: {
      key: "drawdown",
      label: "Drawdown",
      color: "#fb7185",
      format: (value) => money(value, currency),
    },
    r: {
      key: "r",
      label: "R Multiple",
      color: "#60a5fa",
      format: (value) => signed(value, "R"),
    },
  };
  const config = metricConfig[metric];
  return (
    <section className={`${panel} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-slate-800 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-100">
            Performance Overview
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Your closed trades, in execution order
          </p>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {Object.entries(metricConfig).map(([key, item]) => (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition ${metric === key ? "bg-slate-700 text-white" : "text-slate-500 hover:bg-slate-800"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[260px] p-3 md:h-[330px] md:p-5">
        {series.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 10, right: 8, left: -18, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id="performanceFill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={config.color}
                    stopOpacity={0.3}
                  />
                  <stop offset="95%" stopColor={config.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#1e293b"
                strokeDasharray="3 5"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 9 }}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke="#334155" />
              <Tooltip
                contentStyle={{
                  background: "#081120",
                  border: "1px solid #334155",
                  borderRadius: 12,
                  fontSize: 11,
                }}
                formatter={(value: number) => [
                  config.format(Number(value)),
                  config.label,
                ]}
              />
              <Area
                type="monotone"
                dataKey={config.key}
                stroke={config.color}
                strokeWidth={2.5}
                fill="url(#performanceFill)"
                activeDot={{ r: 4, fill: config.color }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty
            title="No closed trades in this range"
            body="Log an exit or imported result to begin your performance curve."
          />
        )}
      </div>
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-36 flex-col items-center justify-center px-6 text-center">
      <BarChart3 size={26} className="text-slate-700" />
      <p className="mt-3 text-sm font-semibold text-slate-300">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-600">
        {body}
      </p>
    </div>
  );
}

function WinLossComparison({
  trades,
  currency,
}: {
  trades: EnrichedTrade[];
  currency: string;
}) {
  const wins = trades.filter((trade) => trade.outcome === "Win");
  const losses = trades.filter((trade) => trade.outcome === "Loss");
  const bestSetup = groupTrades(wins, (trade) => trade.setupName).sort(
    (a, b) => b.pnl - a.pnl,
  )[0];
  const worstSetup = groupTrades(losses, (trade) => trade.setupName).sort(
    (a, b) => a.pnl - b.pnl,
  )[0];
  const topMistake = mistakeMetrics(losses)[0];
  const topStrength = topTag(wins, "strengths");
  const card = (kind: "win" | "loss", rows: EnrichedTrade[]) => {
    const positive = kind === "win";
    const pnl = rows.reduce((sum, trade) => sum + trade.pnlValue, 0);
    const pips = rows.reduce((sum, trade) => sum + trade.pipsValue, 0);
    return (
      <div
        className={`${panel} ${positive ? "border-emerald-500/20" : "border-rose-500/20"} p-4`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 place-items-center rounded-xl ${positive ? "bg-emerald-500/12 text-emerald-400" : "bg-rose-500/12 text-rose-400"}`}
          >
            {positive ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
          </span>
          <div>
            <p className="text-sm font-bold text-slate-100">
              {positive ? "Winning Trades" : "Losing Trades"}
            </p>
            <p className="text-[11px] text-slate-500">
              {rows.length} closed trades
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            [
              positive ? "Average win" : "Average loss",
              money(average(rows.map((trade) => trade.pnlValue)), currency),
            ],
            [positive ? "Net pips" : "Pips lost", signed(pips, "p")],
            [
              positive ? "Best setup" : "Worst setup",
              positive ? bestSetup?.key || "—" : worstSetup?.key || "—",
            ],
            [
              positive ? "Top winning behavior" : "Top mistake",
              positive
                ? topStrength?.[0] || "Add win review tags"
                : topMistake?.name || "—",
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5"
            >
              <p className="truncate text-xs font-bold text-slate-200">
                {value}
              </p>
              <p className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-600">
                {label}
              </p>
            </div>
          ))}
        </div>
        <p
          className={`mt-3 text-lg font-black ${positive ? "text-emerald-400" : "text-rose-400"}`}
        >
          {money(pnl, currency)}
        </p>
      </div>
    );
  };
  return (
    <section>
      <SectionHeading
        icon={<Trophy size={16} />}
        title="Winning vs Losing Trades"
        subtitle="Compare the habits behind both outcomes"
      />
      <div className="grid gap-3 md:grid-cols-2">
        {card("win", wins)}
        {card("loss", losses)}
      </div>
      {wins.length > 0 && losses.length > 0 && (topStrength || topMistake) && (
        <div className="mt-3 rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-amber-400">Your comparison</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Winning trades most often show <span className="font-semibold text-emerald-300">{topStrength?.[0] || "your saved winning behaviors"}</span>, while losing trades most often include <span className="font-semibold text-rose-300">{topMistake?.name || "a saved mistake"}</span>.
          </p>
        </div>
      )}
    </section>
  );
}

function Severity({ value }: { value: MistakeMetric["severity"] }) {
  const cls =
    value === "Critical"
      ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
      : value === "High"
        ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
        : value === "Medium"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
          : "border-slate-700 bg-slate-800 text-slate-400";
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${cls}`}
    >
      {value}
    </span>
  );
}

function MistakeAnalysis({
  mistakes,
  currency,
  onSelect,
  custom,
  onManage,
}: {
  mistakes: MistakeMetric[];
  currency: string;
  onSelect: (mistake: MistakeMetric) => void;
  custom: any[];
  onManage: () => void;
}) {
  const [category, setCategory] = useState("All");
  const shown =
    category === "All"
      ? mistakes
      : mistakes.filter((mistake) => mistake.category === category);
  return (
    <section>
      <SectionHeading
        icon={<AlertTriangle size={16} />}
        title="Mistake Analysis"
        subtitle="Ranked by the impact on your results"
        action={
          <button
            onClick={onManage}
            className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300"
          >
            <Plus size={12} /> Add Mistake
          </button>
        }
      />
      <div className={`${panel} overflow-hidden`}>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-800 p-3">
          {[
            "All",
            "Entry",
            "Risk",
            "Psychology",
            "Strategy",
            "Session",
            "Exit",
          ].map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-semibold ${category === item ? "bg-rose-500/15 text-rose-300" : "text-slate-500 hover:bg-slate-800"}`}
            >
              {item}
            </button>
          ))}
        </div>
        {shown.length ? (
          <div className="divide-y divide-slate-800/80">
            {shown.map((mistake, index) => (
              <button
                key={mistake.name}
                onClick={() => onSelect(mistake)}
                className="grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-800/35 md:grid-cols-[32px_1.4fr_repeat(4,minmax(80px,.7fr))_auto]"
              >
                <span className="text-xs font-black text-slate-600">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {mistake.name}
                    </p>
                    <Severity value={mistake.severity} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-600">
                    {mistake.category} · {mistake.lossShare.toFixed(0)}% of
                    losing trades
                  </p>
                </div>
                <div className="hidden md:block">
                  <p className="text-xs font-bold text-slate-200">
                    {mistake.occurrences}
                  </p>
                  <p className="text-[9px] text-slate-600">Occurrences</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-xs font-bold text-rose-400">
                    {money(mistake.pnl, currency)}
                  </p>
                  <p className="text-[9px] text-slate-600">P&L impact</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-xs font-bold text-rose-300">
                    {signed(mistake.pips, "p")}
                  </p>
                  <p className="text-[9px] text-slate-600">Pips impact</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-xs font-bold text-slate-300">
                    {pct(mistake.winRate)}
                  </p>
                  <p className="text-[9px] text-slate-600">
                    Win rate with mistake
                  </p>
                </div>
                <ChevronRight size={15} className="text-slate-700" />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title="No mistakes tagged yet"
            body="Review a closed trade and tag what happened. Your cost ranking will appear here automatically."
          />
        )}
        {custom.length > 0 && (
          <p className="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-600">
            {custom.filter((item) => item.active !== false).length} custom
            mistake definitions active
          </p>
        )}
      </div>
    </section>
  );
}

function MistakeDrawer({
  mistake,
  currency,
  onClose,
  rule,
}: {
  mistake: MistakeMetric;
  currency: string;
  onClose: () => void;
  rule?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 border-b border-slate-800 px-4 pb-4"
          style={{ paddingTop: "calc(1rem + env(safe-area-inset-top,0px))" }}
        >
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-100">{mistake.name}</p>
            <p className="text-[11px] text-slate-500">
              Mistake detail · {mistake.category}
            </p>
          </div>
          <Severity value={mistake.severity} />
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Occurrences", mistake.occurrences],
              ["Win rate", pct(mistake.winRate)],
              ["P&L impact", money(mistake.pnl, currency)],
              ["Losses", mistake.losses],
              ["Pips impact", signed(mistake.pips, "p")],
              ["Avg loss", money(mistake.averageLoss, currency)],
            ].map(([label, value]) => (
              <div key={label} className={`${panel} p-3 text-center`}>
                <p className="text-sm font-black text-slate-100">{value}</p>
                <p className="mt-1 text-[9px] uppercase text-slate-600">
                  {label}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-amber-300">
              <Lightbulb size={15} />
              <p className="text-xs font-bold uppercase tracking-wide">
                How to improve
              </p>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {rule ||
                `Before your next entry, pause and verify the rule connected to “${mistake.name}”. Record the confirmation in your review.`}
            </p>
            <p className="mt-2 text-[10px] text-slate-600">
              Process guidance based on your saved rules and journal data — not
              financial advice.
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              Trades where this happened
            </p>
            <div className="space-y-2">
              {mistake.trades.map((trade) => (
                <div
                  key={trade.id}
                  className={`${panel} flex items-center gap-3 p-3`}
                >
                  <div
                    className={`h-8 w-1 rounded-full ${trade.outcome === "Win" ? "bg-emerald-500" : "bg-rose-500"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-200">
                      {trade.symbol || "Trade"} · {trade.setupName}
                    </p>
                    <p className="text-[10px] text-slate-600">
                      {trade.date || "—"} · {trade.session || "No session"}
                    </p>
                  </div>
                  <p
                    className={`text-xs font-bold ${trade.pnlValue >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                  >
                    {money(trade.pnlValue, currency)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function SetupPerformance({
  rows,
  currency,
  onSelect,
}: {
  rows: GroupMetric[];
  currency: string;
  onSelect: (row: GroupMetric) => void;
}) {
  const [sort, setSort] = useState("pnl");
  const sorted = [...rows].sort((a, b) =>
    sort === "winRate"
      ? b.winRate - a.winRate
      : sort === "trades"
        ? b.trades - a.trades
        : sort === "worst"
          ? a.pnl - b.pnl
          : b.pnl - a.pnl,
  );
  const max = Math.max(1, ...sorted.map((row) => Math.abs(row.pnl)));
  return (
    <section>
      <SectionHeading
        icon={<Layers3 size={16} />}
        title="Setup Performance"
        subtitle="Calculated from your real logged trades"
        action={
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className={`${input} !h-8`}
          >
            <option value="pnl">Highest P&L</option>
            <option value="winRate">Best win rate</option>
            <option value="trades">Most traded</option>
            <option value="worst">Worst performing</option>
          </select>
        }
      />
      <div className={`${panel} overflow-hidden`}>
        {sorted.length ? (
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((row) => (
              <button
                key={row.key}
                onClick={() => onSelect(row)}
                className="rounded-xl border border-slate-800 bg-slate-950/65 p-3.5 text-left transition hover:border-slate-700 hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-100">
                      {row.key}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-600">
                      {row.trades} trades · {row.wins}W / {row.losses}L
                    </p>
                  </div>
                  <span
                    className={`text-sm font-black ${row.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                  >
                    {money(row.pnl, currency)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${row.pnl >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                    style={{
                      width: `${Math.max(5, (Math.abs(row.pnl) / max) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Win rate", pct(row.winRate)],
                    ["Net pips", signed(row.pips, "p")],
                    ["Avg R", signed(row.avgR, "R")],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs font-bold text-slate-300">
                        {value}
                      </p>
                      <p className="text-[9px] text-slate-600">{label}</p>
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title="No setup performance yet"
            body="Assign a setup to closed trades to compare your playbook."
          />
        )}
      </div>
    </section>
  );
}

function SetupDrawer({
  setup,
  trades,
  currency,
  onClose,
}: {
  setup: GroupMetric;
  trades: EnrichedTrade[];
  currency: string;
  onClose: () => void;
}) {
  const rows = trades.filter((trade) => trade.setupName === setup.key);
  const sessions = groupTrades(
    rows,
    (trade) => trade.session || "Unspecified",
  ).sort((a, b) => b.pnl - a.pnl);
  const timeframes = groupTrades(
    rows,
    (trade) => trade.timeframe || "Unspecified",
  ).sort((a, b) => b.pnl - a.pnl);
  const mistakes = mistakeMetrics(rows).slice(0, 4);
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 border-b border-slate-800 px-4 pb-4"
          style={{ paddingTop: "calc(1rem + env(safe-area-inset-top,0px))" }}
        >
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="flex-1">
            <p className="text-base font-black text-slate-100">{setup.key}</p>
            <p className="text-[11px] text-slate-500">
              {setup.trades} closed trades
            </p>
          </div>
          <p
            className={`text-lg font-black ${setup.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
          >
            {money(setup.pnl, currency)}
          </p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Win rate", pct(setup.winRate)],
              ["Net pips", signed(setup.pips, "p")],
              ["Average R", signed(setup.avgR, "R")],
              [
                "Profit factor",
                setup.profitFactor === Infinity
                  ? "∞"
                  : setup.profitFactor?.toFixed(2) || "—",
              ],
            ].map(([label, value]) => (
              <div key={label} className={`${panel} p-3 text-center`}>
                <p className="text-base font-black text-slate-100">{value}</p>
                <p className="text-[9px] uppercase text-slate-600">{label}</p>
              </div>
            ))}
          </div>
          <Breakdown title="Sessions" rows={sessions} currency={currency} />
          <Breakdown title="Timeframes" rows={timeframes} currency={currency} />
          <div className={`${panel} p-4`}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Common mistakes
            </p>
            <div className="mt-3 space-y-2">
              {mistakes.length ? (
                mistakes.map((mistake) => (
                  <div
                    key={mistake.name}
                    className="flex items-center justify-between"
                  >
                    <span className="text-xs text-slate-300">
                      {mistake.name}
                    </span>
                    <span className="text-xs font-bold text-rose-400">
                      {mistake.occurrences}× · {money(mistake.pnl, currency)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-600">
                  No mistakes tagged for this setup.
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: GroupMetric[];
  currency: string;
}) {
  return (
    <div className={`${panel} p-4`}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-xl bg-slate-950/60 px-3 py-2.5"
          >
            <span className="text-xs font-semibold text-slate-300">
              {row.key}
            </span>
            <span className="text-[11px] text-slate-500">
              {pct(row.winRate)} WR
            </span>
            <span
              className={`text-xs font-bold ${row.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
            >
              {money(row.pnl, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionPerformance({
  trades,
  currency,
}: {
  trades: EnrichedTrade[];
  currency: string;
}) {
  const sessions = groupTrades(
    trades,
    (trade) => trade.session || "Unspecified",
  ).sort((a, b) => b.pnl - a.pnl);
  const timedTrades = trades.filter((trade) => trade.entryTime);
  const dayRows = groupTrades(
    timedTrades.length ? timedTrades : trades,
    (trade) =>
      timedTrades.length
        ? `${String(trade.entryTime).slice(0, 2)}:00`
        : trade.date
          ? new Date(`${trade.date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "short",
            })
          : "Unknown",
  ).sort((a, b) => a.key.localeCompare(b.key));
  return (
    <section>
      <SectionHeading
        icon={<Clock3 size={16} />}
        title="Session & Time Performance"
        subtitle="See when your execution is strongest"
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr]">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {sessions.slice(0, 4).map((row, index) => (
            <div
              key={row.key}
              className={`${panel} flex items-center gap-3 p-3.5 ${index === 0 ? "border-emerald-500/25" : ""}`}
            >
              <span
                className={`grid h-9 w-9 place-items-center rounded-xl ${index === 0 ? "bg-emerald-500/12 text-emerald-400" : "bg-slate-800 text-slate-500"}`}
              >
                {index === 0 ? <Trophy size={16} /> : <Clock3 size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-200">
                  {row.key}
                </p>
                <p className="text-[10px] text-slate-600">
                  {row.trades} trades · {pct(row.winRate)} WR
                </p>
              </div>
              <p
                className={`text-xs font-black ${row.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {money(row.pnl, currency)}
              </p>
            </div>
          ))}
        </div>
        <div className={`${panel} h-[260px] p-4`}>
          <p className="mb-3 text-xs font-bold text-slate-300">
            {timedTrades.length ? "Win rate by entry hour" : "Win rate by day"}
          </p>
          {dayRows.length ? (
            <ResponsiveContainer width="100%" height="88%">
              <BarChart data={dayRows}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#64748b", fontSize: 9 }}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#081120",
                    border: "1px solid #334155",
                    borderRadius: 10,
                  }}
                />
                <Bar dataKey="winRate" radius={[5, 5, 0, 0]}>
                  {dayRows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={row.winRate >= 50 ? "#10b981" : "#f43f5e"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty
              title="Not enough timing data"
              body="Dates and sessions will build this view."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function LearningInsights({
  trades,
  setups,
  mistakes,
  customMistakes,
  currency,
  onViewMistake,
}: {
  trades: EnrichedTrade[];
  setups: GroupMetric[];
  mistakes: MistakeMetric[];
  customMistakes: any[];
  currency: string;
  onViewMistake: (mistake: MistakeMetric) => void;
}) {
  const best = [...setups].sort((a, b) => b.pnl - a.pnl)[0];
  const worstMistake = mistakes[0];
  const wins = trades.filter((trade) => trade.outcome === "Win");
  const losses = trades.filter((trade) => trade.outcome === "Loss");
  const winningStrength = topTag(wins, "strengths");
  const latestLesson = [...trades].reverse().find((trade) => String(trade.lesson || "").trim())?.lesson;
  const mistakeAction = worstMistake
    ? customMistakes.find((item: any) => item.name === worstMistake.name)?.improvementRule ||
      MISTAKE_ACTIONS[worstMistake.name] ||
      `Add a pre-entry check that prevents “${worstMistake.name}”.`
    : "";
  const sessions = groupTrades(
    trades,
    (trade) => trade.session || "Unspecified",
  ).sort((a, b) => b.pnl - a.pnl);
  const clean = trades.filter(
    (trade) => !trade.rulesViolated && trade.outcome !== "Open",
  );
  const violated = trades.filter(
    (trade) => trade.rulesViolated && trade.outcome !== "Open",
  );
  const insights = [
    best && {
      tone: "green",
      title: `${best.key} is your strongest setup`,
      reason: `${pct(best.winRate)} win rate and ${money(best.pnl, currency)} across ${best.trades} trades.`,
      action: "Keep collecting clean examples before increasing focus.",
    },
    worstMistake && {
      tone: "red",
      title: `${worstMistake.name} is your most expensive mistake`,
      reason: `${worstMistake.occurrences} occurrences with ${money(worstMistake.pnl, currency)} impact.`,
      action: mistakeAction,
      click: () => onViewMistake(worstMistake),
    },
    winningStrength && {
      tone: "green",
      title: `${winningStrength[0]} is your most repeated winning behavior`,
      reason: `You tagged it on ${winningStrength[1]} of ${wins.length} winning trades.`,
      action: `Make “${winningStrength[0]}” a non-negotiable part of your pre-trade process.`,
    },
    wins.length > 0 && losses.length > 0 && (winningStrength || worstMistake) && {
      tone: "gold",
      title: "What separates your wins from your losses",
      reason: `Wins most often include ${winningStrength?.[0] || "your documented strengths"}; losses most often include ${worstMistake?.name || "a recorded mistake"}.`,
      action: `Repeat the winning behavior and use this guardrail: ${mistakeAction || "review the loss before the next entry."}`,
    },
    sessions[0] && {
      tone: "blue",
      title: `${sessions[0].key} is currently your best session`,
      reason: `${pct(sessions[0].winRate)} win rate and ${money(sessions[0].pnl, currency)} net.`,
      action: "Compare this with weaker sessions before changing your plan.",
    },
    clean.length > 0 && {
      tone: "gold",
      title: "Rule compliance changes the result",
      reason: `Clean trades: ${money(
        clean.reduce((sum, trade) => sum + trade.pnlValue, 0),
        currency,
      )}. Violations: ${money(
        violated.reduce((sum, trade) => sum + trade.pnlValue, 0),
        currency,
      )}.`,
      action: "Review violations weekly and choose one rule to improve.",
    },
    latestLesson && {
      tone: "blue",
      title: "Your latest saved lesson",
      reason: String(latestLesson),
      action: "Apply this lesson deliberately on the next matching setup, then review the result.",
    },
  ].filter(Boolean) as Array<{
    tone: string;
    title: string;
    reason: string;
    action: string;
    click?: () => void;
  }>;
  return (
    <section>
      <SectionHeading
        icon={<Brain size={16} />}
        title="Learn & Improve"
        subtitle="Evidence from your own journal — not a trading signal"
      />
      <div className="grid gap-3 md:grid-cols-2">
        {insights.length ? (
          insights.map((insight) => (
            <button
              key={insight.title}
              onClick={insight.click}
              disabled={!insight.click}
              className={`${panel} p-4 text-left transition ${insight.click ? "hover:border-slate-700" : ""}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${insight.tone === "green" ? "bg-emerald-500/12 text-emerald-400" : insight.tone === "red" ? "bg-rose-500/12 text-rose-400" : insight.tone === "blue" ? "bg-sky-500/12 text-sky-400" : "bg-amber-500/12 text-amber-400"}`}
                >
                  <Lightbulb size={16} />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-100">
                    {insight.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    {insight.reason}
                  </p>
                  <p className="mt-2 text-[11px] font-semibold text-amber-300">
                    Suggested action: {insight.action}
                  </p>
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className={`${panel} md:col-span-2`}>
            <Empty
              title="Your coaching insights are waiting"
              body="Log and review a few closed trades to reveal repeatable patterns."
            />
          </div>
        )}
      </div>
    </section>
  );
}

function ImprovementPlan({
  goals,
  onChange,
  suggestions,
}: {
  goals: any[];
  onChange: (goals: any[]) => void;
  suggestions: Array<{ name: string; reason: string; source: string }>;
}) {
  const [name, setName] = useState("");
  const add = () => {
    if (!name.trim()) return;
    onChange([
      ...goals,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        active: true,
        progress: 0,
        violations: 0,
      },
    ]);
    setName("");
  };
  const addSuggested = (suggestion: { name: string; reason: string; source: string }) => {
    if (goals.some((goal) => goal.name.toLowerCase() === suggestion.name.toLowerCase())) return;
    onChange([
      ...goals,
      {
        id: crypto.randomUUID(),
        name: suggestion.name,
        active: true,
        progress: 0,
        violations: 0,
        reason: suggestion.reason,
        source: suggestion.source,
      },
    ]);
  };
  return (
    <section>
      <SectionHeading
        icon={<Target size={16} />}
        title="Improvement Plan"
        subtitle="Turn one repeated lesson into a measurable habit"
      />
      <div className={`${panel} p-4`}>
        {suggestions.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-200">Recommended from your journal</p>
                <p className="mt-0.5 text-[10px] text-slate-600">Generated from your tagged losses, winning strengths, and setup results.</p>
              </div>
              <Lightbulb size={16} className="shrink-0 text-amber-400" />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {suggestions.map((suggestion) => {
                const alreadyAdded = goals.some((goal) => goal.name.toLowerCase() === suggestion.name.toLowerCase());
                return (
                  <div key={suggestion.name} className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-amber-200">{suggestion.name}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{suggestion.reason}</p>
                        <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">Source: {suggestion.source}</p>
                      </div>
                      <button onClick={() => addSuggested(suggestion)} disabled={alreadyAdded}
                        className="shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-300 disabled:border-emerald-500/20 disabled:bg-emerald-500/10 disabled:text-emerald-400">
                        {alreadyAdded ? "Added" : "+ Add"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="Example: Wait for confirmation"
            className={`${input} flex-1`}
          />
          <button
            onClick={add}
            className="rounded-xl bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400"
          >
            <Plus size={15} />
            <span className="sr-only">Add goal</span>
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {goals.length ? (
            goals.map((goal) => (
              <div
                key={goal.id}
                className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
              >
                <button
                  onClick={() =>
                    onChange(
                      goals.map((item) =>
                        item.id === goal.id
                          ? { ...item, active: !item.active }
                          : item,
                      ),
                    )
                  }
                  className={`grid h-6 w-6 place-items-center rounded-lg border ${goal.active ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" : "border-slate-700 text-slate-700"}`}
                >
                  {goal.active && <Check size={13} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-semibold ${goal.active ? "text-slate-200" : "text-slate-600 line-through"}`}
                  >
                    {goal.name}
                  </p>
                  <p className="text-[10px] text-slate-600">
                    {goal.progress || 0}% compliance · {goal.violations || 0}{" "}
                    violations
                  </p>
                </div>
                <button
                  onClick={() =>
                    onChange(goals.filter((item) => item.id !== goal.id))
                  }
                  className="p-1.5 text-slate-700 hover:text-rose-400"
                >
                  <X size={14} />
                </button>
              </div>
            ))
          ) : (
            <p className="py-4 text-center text-xs text-slate-600">
              No improvement goals yet. Add the one habit that would change your
              next ten trades.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TradeTable({
  trades,
  currency,
  onOpen,
}: {
  trades: EnrichedTrade[];
  currency: string;
  onOpen: (trade: EnrichedTrade) => void;
}) {
  return (
    <section>
      <SectionHeading
        icon={<ListChecks size={16} />}
        title="Trade Review"
        subtitle={`${trades.length} trades match your filters`}
      />
      <div className={`${panel} overflow-hidden`}>
        {trades.length ? (
          <div className="divide-y divide-slate-800/80">
            {[...trades]
              .sort((a, b) =>
                String(b.date || "").localeCompare(String(a.date || "")),
              )
              .slice(0, 50)
              .map((trade) => (
                <button
                  key={trade.id}
                  onClick={() => onOpen(trade)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-800/35 md:grid-cols-[100px_1fr_1fr_100px_100px_80px_auto]"
                >
                  <span className="hidden text-[11px] text-slate-500 md:block">
                    {trade.date || "—"}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-100">
                      {trade.symbol || "Trade"}
                    </p>
                    <p className="text-[10px] text-slate-600 md:hidden">
                      {trade.date || "—"} · {trade.session || "No session"}
                    </p>
                  </div>
                  <span className="hidden truncate text-xs text-slate-400 md:block">
                    {trade.setupName}
                  </span>
                  <span className="hidden text-xs text-slate-500 md:block">
                    {trade.session || "—"}
                  </span>
                  <span
                    className={`hidden text-xs font-bold md:block ${trade.outcome === "Win" ? "text-emerald-400" : trade.outcome === "Loss" ? "text-rose-400" : "text-slate-400"}`}
                  >
                    {trade.outcome}
                  </span>
                  <span className="hidden text-xs font-bold text-slate-300 md:block">
                    {trade.rValue === null ? "—" : signed(trade.rValue, "R")}
                  </span>
                  <div className="text-right">
                    <p
                      className={`text-sm font-black ${trade.pnlValue >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {money(trade.pnlValue, currency)}
                    </p>
                    <p className="text-[10px] text-slate-600">
                      {trade.compliance === null
                        ? "Not reviewed"
                        : `${trade.compliance}% rules`}
                    </p>
                  </div>
                  <ChevronRight size={15} className="text-slate-700" />
                </button>
              ))}
          </div>
        ) : (
          <Empty
            title="No trades match these filters"
            body="Broaden the range or clear one of the filters."
          />
        )}
      </div>
    </section>
  );
}

function TradeReviewDrawer({
  trade,
  currency,
  onClose,
  onSave,
  mistakeOptions,
}: {
  trade: EnrichedTrade;
  currency: string;
  onClose: () => void;
  onSave: (next: any) => void;
  mistakeOptions: string[];
}) {
  const [draft, setDraft] = useState<any>({
    ...trade,
    mistakes: trade.mistakes || [],
    strengths: trade.strengths || [],
    result: trade.result || (trade.outcome === "Open" ? "" : trade.outcome),
    lesson: trade.lesson || "",
    whatWentWell: trade.whatWentWell || "",
    whatWentWrong: trade.whatWentWrong || "",
    emotion: trade.emotion || "",
    setupRulesFollowed: trade.setupRulesFollowed,
    riskRulesFollowed: trade.riskRulesFollowed,
    psychologyRulesFollowed: trade.psychologyRulesFollowed,
  });
  const toggleMistake = (name: string) =>
    setDraft((current: any) => ({
      ...current,
      mistakes: current.mistakes.includes(name)
        ? current.mistakes.filter((item: string) => item !== name)
        : [...current.mistakes, name],
    }));
  const toggleStrength = (name: string) =>
    setDraft((current: any) => ({
      ...current,
      strengths: current.strengths.includes(name)
        ? current.strengths.filter((item: string) => item !== name)
        : [...current.strengths, name],
    }));
  const reviewOutcome = draft.result || trade.outcome;
  const checks = [
    draft.setupRulesFollowed,
    draft.riskRulesFollowed,
    draft.psychologyRulesFollowed,
  ].filter((value) => typeof value === "boolean");
  const compliance = checks.length
    ? Math.round((checks.filter(Boolean).length / checks.length) * 100)
    : null;
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 border-b border-slate-800 px-4 pb-4"
          style={{ paddingTop: "calc(1rem + env(safe-area-inset-top,0px))" }}
        >
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="flex-1">
            <p className="text-base font-black text-slate-100">
              {trade.symbol} · {trade.side}
            </p>
            <p className="text-[11px] text-slate-500">
              {trade.date} · {trade.setupName} · {trade.session || "No session"}
            </p>
          </div>
          <span
            className={`rounded-lg px-2.5 py-1 text-xs font-black ${trade.outcome === "Win" ? "bg-emerald-500/15 text-emerald-400" : trade.outcome === "Loss" ? "bg-rose-500/15 text-rose-400" : "bg-slate-800 text-slate-300"}`}
          >
            {trade.outcome}
          </span>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-28">
          <div className={`${panel} p-4`}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Trade outcome</p>
            <p className="mt-1 text-[10px] text-slate-600">Optional manual review result. P&amp;L remains your recorded broker value.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {["Win", "Loss", "Breakeven"].map((outcome) => (
                <button key={outcome} onClick={() => setDraft((current: any) => ({
                  ...current,
                  result: current.result === outcome ? "" : outcome,
                  ...(outcome === "Win" ? { mistakes: [] } : {}),
                  ...(outcome === "Loss" ? { strengths: [] } : {}),
                }))}
                  className={`rounded-xl border py-2 text-xs font-bold ${draft.result === outcome ? outcome === "Win" ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-300" : outcome === "Loss" ? "border-rose-500/40 bg-rose-500/12 text-rose-300" : "border-slate-600 bg-slate-800 text-slate-200" : "border-slate-800 bg-slate-950 text-slate-500"}`}>
                  {outcome === "Breakeven" ? "BE" : outcome}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["P&L", money(trade.pnlValue, currency)],
              ["Pips", signed(trade.pipsValue, "p")],
              [
                "R Multiple",
                trade.rValue === null ? "—" : signed(trade.rValue, "R"),
              ],
            ].map(([label, value]) => (
              <div key={label} className={`${panel} p-3 text-center`}>
                <p className="text-sm font-black text-slate-100">{value}</p>
                <p className="text-[9px] uppercase text-slate-600">{label}</p>
              </div>
            ))}
          </div>
          {Array.isArray(trade.attachments) &&
            trade.attachments.find(
              (item: any) => item.isImage || item.dataUrl || item.signedUrl,
            ) && (
              <img
                src={
                  (
                    trade.attachments.find(
                      (item: any) =>
                        item.isImage || item.dataUrl || item.signedUrl,
                    ) as any
                  ).signedUrl ||
                  (
                    trade.attachments.find(
                      (item: any) =>
                        item.isImage || item.dataUrl || item.signedUrl,
                    ) as any
                  ).dataUrl
                }
                alt={`${trade.symbol} trade screenshot`}
                className="max-h-[420px] w-full rounded-2xl border border-slate-800 bg-slate-900 object-contain"
              />
            )}
          <div className={`${panel} p-4`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Rule compliance
              </p>
              <span className="text-sm font-black text-amber-400">
                {compliance === null ? "Not scored" : `${compliance}%`}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                ["setupRulesFollowed", "Setup rules"],
                ["riskRulesFollowed", "Risk rules"],
                ["psychologyRulesFollowed", "Psychology"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() =>
                    setDraft((current: any) => ({
                      ...current,
                      [key]: current[key] === true ? false : true,
                    }))
                  }
                  className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${draft[key] === true ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : draft[key] === false ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-slate-800 bg-slate-950 text-slate-500"}`}
                >
                  {draft[key] === true
                    ? "Passed · "
                    : draft[key] === false
                      ? "Violated · "
                      : "Score · "}
                  {label}
                </button>
              ))}
            </div>
          </div>
          {reviewOutcome === "Loss" && <div className={`${panel} border-rose-500/20 p-4`}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Why this trade lost
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {mistakeOptions.map((name) => (
                <button
                  key={name}
                  onClick={() => toggleMistake(name)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${draft.mistakes.includes(name) ? "border-rose-500/35 bg-rose-500/12 text-rose-300" : "border-slate-800 bg-slate-950 text-slate-500"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>}
          {reviewOutcome === "Win" && <div className={`${panel} border-emerald-500/20 p-4`}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">What made this trade work</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {WIN_STRENGTH_OPTIONS.map((name) => (
                <button key={name} onClick={() => toggleStrength(name)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${draft.strengths.includes(name) ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-300" : "border-slate-800 bg-slate-950 text-slate-500"}`}>
                  {name}
                </button>
              ))}
            </div>
          </div>}
          {[
            ...(reviewOutcome !== "Loss" ? [["whatWentWell", reviewOutcome === "Win" ? "Winning lesson" : "What went well?"]] : []),
            ...(reviewOutcome !== "Win" ? [["whatWentWrong", "What went wrong?"]] : []),
            ...(reviewOutcome === "Loss" ? [["rootCause", "Root cause"], ["nextAction", "What should I do next time?"]] : []),
            ["lesson", "Lesson learned"],
            ["emotion", "Emotion / psychology"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                {label}
              </span>
              <textarea
                value={draft[key] || ""}
                onChange={(event) =>
                  setDraft((current: any) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm text-slate-200 outline-none focus:border-amber-500/50"
              />
            </label>
          ))}
        </div>
        <div
          className="fixed bottom-0 right-0 flex w-full max-w-2xl gap-2 border-t border-slate-800 bg-slate-950/95 p-4 backdrop-blur"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom,0px))",
          }}
        >
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-800 bg-slate-900 py-3 text-sm font-semibold text-slate-400"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave({
                ...draft,
                ruleCompliance: compliance,
                rulesViolated:
                  compliance !== null ? compliance < 100 : draft.rulesViolated,
              });
              onClose();
            }}
            className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950"
          >
            Save Review
          </button>
        </div>
      </aside>
    </div>
  );
}

function MistakeManager({
  items,
  onClose,
  onChange,
}: {
  items: any[];
  onClose: () => void;
  onChange: (items: any[]) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    category: "Entry",
    severity: "Medium",
    description: "",
    improvementRule: "",
    active: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const reset = () => {
    setForm({
      name: "",
      category: "Entry",
      severity: "Medium",
      description: "",
      improvementRule: "",
      active: true,
    });
    setEditingId(null);
  };
  const add = () => {
    if (!form.name.trim()) return;
    onChange(
      editingId
        ? items.map((item) =>
            item.id === editingId
              ? { ...item, ...form, name: form.name.trim() }
              : item,
          )
        : [
            ...items,
            { ...form, id: crypto.randomUUID(), name: form.name.trim() },
          ],
    );
    reset();
  };
  const edit = (item: any) => {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      category: item.category || "Entry",
      severity: item.severity || "Medium",
      description: item.description || "",
      improvementRule: item.improvementRule || "",
      active: item.active !== false,
    });
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`${panel} max-h-[90dvh] w-full max-w-xl overflow-y-auto p-4`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-black text-slate-100">
              Mistake Library
            </p>
            <p className="text-[11px] text-slate-500">
              Create, edit, archive, and order your review tags
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-500">
            <X size={17} />
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Mistake name"
            className={input}
          />
          <select
            value={form.category}
            onChange={(event) =>
              setForm({ ...form, category: event.target.value })
            }
            className={input}
          >
            {["Entry", "Risk", "Psychology", "Strategy", "Session", "Exit"].map(
              (item) => (
                <option key={item}>{item}</option>
              ),
            )}
          </select>
          <select
            value={form.severity}
            onChange={(event) =>
              setForm({ ...form, severity: event.target.value })
            }
            className={input}
          >
            {["Critical", "High", "Medium", "Low"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <input
            value={form.improvementRule}
            onChange={(event) =>
              setForm({ ...form, improvementRule: event.target.value })
            }
            placeholder="Improvement rule"
            className={input}
          />
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
            placeholder="Description"
            rows={2}
            className="sm:col-span-2 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300 outline-none"
          />
          <button
            onClick={add}
            className="sm:col-span-2 rounded-xl bg-amber-500 py-2.5 text-xs font-black text-slate-950"
          >
            {editingId ? "Save Changes" : "Add Mistake"}
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
            >
              <button
                onClick={() =>
                  onChange(
                    items.map((current) =>
                      current.id === item.id
                        ? { ...current, active: current.active === false }
                        : current,
                    ),
                  )
                }
                className={`grid h-6 w-6 place-items-center rounded-lg border ${item.active !== false ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-slate-700 text-slate-700"}`}
              >
                {item.active !== false && <Check size={12} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-200">
                  {item.name}
                </p>
                <p className="text-[10px] text-slate-600">
                  {item.category} · {item.severity}
                </p>
              </div>
              <button
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="Move up"
                className="p-1 text-slate-600 disabled:opacity-20"
              >
                <ArrowUpRight size={13} />
              </button>
              <button
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                title="Move down"
                className="p-1 text-slate-600 disabled:opacity-20"
              >
                <ArrowDownRight size={13} />
              </button>
              <button
                onClick={() => edit(item)}
                title="Edit mistake"
                className="p-1 text-slate-600 hover:text-amber-400"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() =>
                  onChange(items.filter((current) => current.id !== item.id))
                }
                title="Delete mistake"
                className="text-slate-700 hover:text-rose-400"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl border border-slate-800 bg-slate-900 text-amber-400">
          {icon}
        </span>
        <div>
          <h2
            className="text-sm font-black text-slate-100"
            style={{ fontFamily: "'Sora',sans-serif" }}
          >
            {title}
          </h2>
          <p className="text-[10px] text-slate-600 md:text-[11px]">
            {subtitle}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}

export default function PerformanceLearning({
  data,
  setData,
  onClose,
  embedded = false,
}: Props) {
  const allTrades = useMemo(
    () => enrichTrades(data.trades || [], data.setups || []),
    [data.trades, data.setups],
  );
  const [filters, setFilters] = useState<Filters>({
    preset: "30 Days",
    customStart: "",
    customEnd: "",
    account: data.activeAccountId || "",
    symbol: "",
    setup: "",
    session: "",
    timeframe: "",
    direction: "",
    result: "",
    query: "",
  });
  const [selectedMistake, setSelectedMistake] = useState<MistakeMetric | null>(
    null,
  );
  const [selectedSetup, setSelectedSetup] = useState<GroupMetric | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<EnrichedTrade | null>(
    null,
  );
  const [manageMistakes, setManageMistakes] = useState(false);
  const customMistakes = data.settings?.customMistakes || [];
  const start =
    filters.preset === "Custom"
      ? filters.customStart
      : dateStart(filters.preset);
  const end = filters.preset === "Custom" ? filters.customEnd : "";
  const filtered = useMemo(
    () =>
      allTrades.filter((trade) => {
        const query = filters.query.toLowerCase().trim();
        return (
          (!start || String(trade.date || "") >= start) &&
          (!end || String(trade.date || "") <= end) &&
          (!filters.account || trade.accountId === filters.account) &&
          (!filters.symbol || trade.symbol === filters.symbol) &&
          (!filters.setup || trade.setupName === filters.setup) &&
          (!filters.session || trade.session === filters.session) &&
          (!filters.timeframe || trade.timeframe === filters.timeframe) &&
          (!filters.direction ||
            String(trade.side)
              .toLowerCase()
              .includes(filters.direction.toLowerCase())) &&
          (!filters.result || trade.outcome === filters.result) &&
          (!query ||
            [
              trade.symbol,
              trade.setupName,
              trade.session,
              trade.notes,
              ...(trade.mistakes || []),
            ]
              .join(" ")
              .toLowerCase()
              .includes(query))
        );
      }),
    [allTrades, filters, start, end],
  );
  const closed = filtered.filter((trade) => trade.outcome !== "Open");
  const wins = closed.filter((trade) => trade.outcome === "Win");
  const losses = closed.filter((trade) => trade.outcome === "Loss");
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnlValue, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, trade) => sum + trade.pnlValue, 0),
  );
  const totalPnl = closed.reduce((sum, trade) => sum + trade.pnlValue, 0);
  const netPips = closed.reduce((sum, trade) => sum + trade.pipsValue, 0);
  const setupRows = groupTrades(closed, (trade) => trade.setupName).filter(
    (row) => row.key !== "Unassigned",
  );
  const mistakeRows = mistakeMetrics(closed, customMistakes);
  const currency =
    data.tradingAccounts?.find((account: any) => account.id === filters.account)
      ?.currency ||
    data.account?.currency ||
    "€";
  const series = cumulativeSeries(closed);
  const dailyBars = series.map((point) => point.pnl);
  const rValues = closed
    .map((trade) => trade.rValue)
    .filter((value): value is number => value !== null);
  const maxDrawdown = Math.min(0, ...series.map((point) => point.drawdown));
  const bestSetup = [...setupRows].sort((a, b) => b.pnl - a.pnl)[0];
  const topMistake = mistakeRows[0];
  const kpis = [
    [
      "Total Trades",
      String(closed.length),
      "blue",
      "Closed trades in the selected filters",
    ],
    [
      "Win Rate",
      closed.length ? pct((wins.length / closed.length) * 100) : "—",
      wins.length >= losses.length ? "green" : "red",
      "Wins divided by closed trades",
    ],
    [
      "Total P&L",
      money(totalPnl, currency),
      totalPnl >= 0 ? "green" : "red",
      "Realized P&L from the selected trades",
    ],
    [
      "Net Pips",
      signed(netPips, "p"),
      netPips >= 0 ? "green" : "red",
      "Total price movement converted to pips",
    ],
    [
      "Profit Factor",
      grossLoss ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? "∞" : "—",
      grossWin >= grossLoss ? "green" : "red",
      "Gross profit divided by gross loss",
    ],
    [
      "Expectancy",
      closed.length ? money(totalPnl / closed.length, currency) : "—",
      totalPnl >= 0 ? "green" : "red",
      "Average P&L expected per logged trade",
    ],
    [
      "Average Win",
      wins.length
        ? money(average(wins.map((trade) => trade.pnlValue)), currency)
        : "—",
      "green",
      "Mean P&L of winning trades",
    ],
    [
      "Average Loss",
      losses.length
        ? money(average(losses.map((trade) => trade.pnlValue)), currency)
        : "—",
      "red",
      "Mean P&L of losing trades",
    ],
    [
      "Average R",
      rValues.length ? signed(average(rValues), "R") : "—",
      "gold",
      "Mean realized R multiple",
    ],
    [
      "Max Drawdown",
      money(maxDrawdown, currency),
      "red",
      "Largest fall from the running P&L peak",
    ],
    [
      "Best Setup",
      bestSetup?.key || "—",
      "green",
      "Setup with the highest total P&L",
    ],
    [
      "Costly Mistake",
      topMistake?.name || "—",
      "red",
      "Mistake with the lowest total P&L impact",
    ],
  ];
  const updateSettings = (key: string, value: any) =>
    setData((current) => ({
      ...current,
      settings: { ...(current.settings || {}), [key]: value },
    }));
  const mistakeOptions = unique([
    "Entered too early",
    "No confirmation",
    "Chased price",
    "Entered in middle of range",
    "Wrong direction",
    "Ignored higher timeframe",
    "H1/H4 zone nearby",
    "Moved stop loss",
    "Overtrading",
    "FOMO",
    "Revenge trade",
    "Low volume",
    "No clear S/R",
    "4th/5th motion candle",
    "Poor clean range",
    "Bad session timing",
    "Oversized risk",
    "Did not secure profit",
    "Held loser too long",
    "Cut winner too early",
    ...customMistakes
      .filter((item: any) => item.active !== false)
      .map((item: any) => item.name),
  ]);
  const improvementRule = selectedMistake
    ? customMistakes.find((item: any) => item.name === selectedMistake.name)
        ?.improvementRule ||
      (data.settings?.tradeSetupBoardRules || []).find((rule: string) =>
        rule
          .toLowerCase()
          .includes(selectedMistake.name.toLowerCase().split(" ")[0]),
      )
    : undefined;
  const winningStrength = topTag(wins, "strengths");
  const automaticSuggestions = [
    topMistake && {
      name: `Avoid: ${topMistake.name}`,
      reason:
        customMistakes.find((item: any) => item.name === topMistake.name)
          ?.improvementRule ||
        MISTAKE_ACTIONS[topMistake.name] ||
        `Add a pre-entry check that prevents “${topMistake.name}”.`,
      source: `${topMistake.occurrences} tagged trade${topMistake.occurrences === 1 ? "" : "s"} · ${money(topMistake.pnl, currency)} impact`,
    },
    winningStrength && {
      name: `Repeat: ${winningStrength[0]}`,
      reason: `This is your most frequently tagged winning behavior. Deliberately check for it before the next matching setup.`,
      source: `${winningStrength[1]} winning trade${winningStrength[1] === 1 ? "" : "s"}`,
    },
    bestSetup && {
      name: `Review ${bestSetup.key} before trading`,
      reason: `This is currently your best logged setup. Study its clean wins and compare them with its losses before the next execution.`,
      source: `${pct(bestSetup.winRate)} win rate · ${money(bestSetup.pnl, currency)} · ${bestSetup.trades} trades`,
    },
  ].filter(Boolean) as Array<{ name: string; reason: string; source: string }>;
  return (
    <div className={`${embedded ? "" : "min-h-screen"} space-y-6 pb-8`}>
      <header className="relative overflow-hidden rounded-2xl border border-amber-500/15 bg-slate-900 p-4 md:p-6">
        <div className="absolute right-0 top-0 h-40 w-64 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,.12),transparent_65%)]" />
        <div className="relative flex items-start gap-3">
          {!embedded && (
            <button
              onClick={onClose}
              className="mt-0.5 rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:text-amber-400"
            >
              <ArrowLeft size={17} />
            </button>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[.2em] text-amber-400">
                Smart Raja Concepts
              </span>
              <span className="h-px w-10 bg-amber-500/30" />
            </div>
            <h1
              className="mt-2 text-2xl font-black tracking-tight text-white md:text-3xl"
              style={{ fontFamily: "'Sora',sans-serif" }}
            >
              Performance & Learning
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400 md:text-sm">
              Understand what makes you win, what makes you lose, and what to
              improve.
            </p>
          </div>
          <div className="hidden rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-right sm:block">
            <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-500">
              Journal coverage
            </p>
            <p className="text-sm font-black text-emerald-300">
              {allTrades.length
                ? pct((closed.length / allTrades.length) * 100)
                : "0%"}
            </p>
          </div>
        </div>
      </header>
      <FilterBar
        filters={filters}
        onChange={(key, value) =>
          setFilters((current) => ({ ...current, [key]: value }))
        }
        data={data}
        trades={allTrades}
        sticky={!embedded}
      />
      <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-4 xl:grid-cols-6">
        {kpis.map(([label, value, tone, hint]) => (
          <KpiCard
            key={label}
            label={label}
            value={value}
            tone={tone}
            hint={hint}
            bars={dailyBars}
          />
        ))}
      </div>
      <PerformanceOverview trades={closed} currency={currency} />
      <WinLossComparison trades={closed} currency={currency} />
      <MistakeAnalysis
        mistakes={mistakeRows}
        currency={currency}
        onSelect={setSelectedMistake}
        custom={customMistakes}
        onManage={() => setManageMistakes(true)}
      />
      <SetupPerformance
        rows={setupRows}
        currency={currency}
        onSelect={setSelectedSetup}
      />
      <LearningInsights
        trades={closed}
        setups={setupRows}
        mistakes={mistakeRows}
        customMistakes={customMistakes}
        currency={currency}
        onViewMistake={setSelectedMistake}
      />
      <SessionPerformance trades={closed} currency={currency} />
      <ImprovementPlan
        goals={data.settings?.improvementGoals || []}
        onChange={(goals) => updateSettings("improvementGoals", goals)}
        suggestions={automaticSuggestions}
      />
      <TradeTable
        trades={filtered}
        currency={currency}
        onOpen={setSelectedTrade}
      />
      <p className="text-center text-[10px] text-slate-700">
        Analytics are journaling and process-review tools based on your own
        entries, not financial advice or trading signals.
      </p>
      {selectedMistake && (
        <MistakeDrawer
          mistake={selectedMistake}
          currency={currency}
          onClose={() => setSelectedMistake(null)}
          rule={improvementRule}
        />
      )}
      {selectedSetup && (
        <SetupDrawer
          setup={selectedSetup}
          trades={closed}
          currency={currency}
          onClose={() => setSelectedSetup(null)}
        />
      )}
      {selectedTrade && (
        <TradeReviewDrawer
          trade={selectedTrade}
          currency={currency}
          mistakeOptions={mistakeOptions}
          onClose={() => setSelectedTrade(null)}
          onSave={(next) =>
            setData((current) => ({
              ...current,
              trades: current.trades.map((trade: any) =>
                trade.id === next.id ? next : trade,
              ),
            }))
          }
        />
      )}
      {manageMistakes && (
        <MistakeManager
          items={customMistakes}
          onClose={() => setManageMistakes(false)}
          onChange={(items) => updateSettings("customMistakes", items)}
        />
      )}
    </div>
  );
}
