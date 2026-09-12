import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  Cell,
  ComposedChart,
  Line,
} from "recharts";
import { Expand, Layers3, SlidersHorizontal } from "lucide-react";
import { AIButton, AIStatusBadge, Panel } from "./ui";
import { price, type SetupPreview, performanceSeries } from "./demo-data";
// Deterministic presentation fixtures, not live candles or historical price claims.
export function marketSeries(setup: SetupPreview, timeframe = "15m") {
  const span = setup.targets[0] - setup.stop;
  const factor =
    1 +
    (["1m", "5m", "15m", "1h", "4h", "D", "W"].indexOf(timeframe) + 1) * 0.018;
  const data = Array.from({ length: 60 }, (_, i) => ({
    label: `${String(8 + Math.floor(i / 12)).padStart(2, "0")}:${String((i % 12) * 5).padStart(2, "0")}`,
    value:
      setup.entry[0] +
      span *
        (Math.sin(i * 0.36) * 0.1 +
          (i / 60 - 0.5) * 0.4 +
          Math.cos(i * 0.9) * 0.035) *
        factor,
  }));
  return data.map((point, i) => {
    const open = data[Math.max(0, i - 1)].value;
    const volatility =
      Math.abs(span) * (0.017 + Math.abs(Math.sin(i * 3)) * 0.02);
    return {
      ...point,
      open,
      body: [Math.min(open, point.value), Math.max(open, point.value)],
      wick: [
        Math.min(open, point.value) - volatility,
        Math.max(open, point.value) + volatility,
      ],
      ma:
        data
          .slice(Math.max(0, i - 9), i + 1)
          .reduce((sum, p) => sum + p.value, 0) / Math.min(i + 1, 10),
    };
  });
}
export function MiniMarketChart({ setup }: { setup: SetupPreview }) {
  return (
    <div
      className="oai-mini-chart"
      aria-label={`${setup.symbol} sample price movement`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={marketSeries(setup)}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={setup.direction === "Long" ? "#37ddae" : "#fd8595"}
            fill={setup.direction === "Long" ? "#143c39" : "#432235"}
            strokeWidth={1.6}
            isAnimationActive={false}
          />
          <YAxis hide domain={["dataMin", "dataMax"]} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function MarketChart({
  setup,
  expanded = false,
  onExpand,
}: {
  setup: SetupPreview;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const [timeframe, setTimeframe] = useState("15m");
  const [zones, setZones] = useState(true);
  const [grid, setGrid] = useState(true);
  const reduceMotion = useReducedMotion();
  return (
    <Panel
      className={`oai-market-chart ${expanded ? "oai-chart-expanded" : ""}`}
      title={setup.symbol}
      kicker="MARKET STRUCTURE · SAMPLE CHART"
      action={
        <div className="oai-row">
          <AIStatusBadge status={setup.direction} />
          {onExpand && (
            <button
              className="oai-icon-button"
              aria-label="Expand chart"
              onClick={onExpand}
            >
              <Expand size={17} />
            </button>
          )}
        </div>
      }
    >
      <div className="oai-chart-quote">
        <strong>{price(setup.price)}</strong>
        <span
          className={setup.change.startsWith("−") ? "oai-red" : "oai-green"}
        >
          {setup.change}
        </span>
        <small>Illustrative quote</small>
      </div>
      <div className="oai-chart-toolbar">
        <div className="oai-tabs" role="group" aria-label="Chart timeframe">
          {["1m", "5m", "15m", "1h", "4h", "D", "W"].map((tf) => (
            <button
              key={tf}
              aria-pressed={tf === timeframe}
              className={tf === timeframe ? "active" : ""}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="oai-row">
          <button
            title="Toggle sample zones"
            aria-label="Toggle chart zones"
            aria-pressed={zones}
            className="oai-icon-button"
            onClick={() => setZones(!zones)}
          >
            <Layers3 size={16} />
          </button>
          <button
            aria-label="Toggle chart grid"
            aria-pressed={grid}
            className="oai-icon-button"
            onClick={() => setGrid(!grid)}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>
      <motion.div
        className="oai-chart-canvas"
        key={`${setup.id}-${timeframe}-${zones}-${grid}`}
        initial={reduceMotion ? false : { opacity: 0.62, scale: 0.994 }}
        animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            barGap="-100%"
            data={marketSeries(setup, timeframe)}
            margin={{ top: 22, right: 20, left: 0, bottom: 4 }}
          >
            {grid && (
              <CartesianGrid
                stroke="#1a2a41"
                strokeDasharray="3 5"
                vertical={false}
              />
            )}
            <XAxis
              dataKey="label"
              tick={{ fill: "#7c91aa", fontSize: 10 }}
              minTickGap={60}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              orientation="right"
              width={65}
              domain={[
                Math.min(setup.stop, setup.targets[1]) * 0.9999,
                Math.max(setup.stop, setup.targets[1]) * 1.0001,
              ]}
              tickFormatter={price}
              tick={{ fill: "#7c91aa", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#101d32",
                border: "1px solid #2e4664",
                borderRadius: 10,
                color: "#eaf3ff",
              }}
              formatter={(value, name) => [
                Array.isArray(value)
                  ? value.map(Number).map(price).join(" – ")
                  : price(Number(value)),
                `Sample ${name}`,
              ]}
            />
            {zones && (
              <ReferenceArea
                y1={setup.entry[0]}
                y2={setup.entry[1]}
                fill="#16bc99"
                fillOpacity={0.16}
                stroke="#209f85"
                strokeDasharray="4 4"
                label={{
                  value: "ENTRY / DEMAND ZONE",
                  fill: "#6bdcba",
                  fontSize: 9,
                  position: "insideLeft",
                }}
              />
            )}
            {zones && (
              <ReferenceLine
                y={setup.stop}
                stroke="#e96b82"
                strokeDasharray="5 5"
                label={{
                  value: "INVALIDATION / SL",
                  fill: "#e96b82",
                  fontSize: 9,
                  position: "insideTopLeft",
                }}
              />
            )}
            {zones && (
              <ReferenceLine
                y={setup.targets[0]}
                stroke="#41aeeb"
                strokeDasharray="4 4"
                label={{
                  value: "TAKE PROFIT 1",
                  fill: "#70c9fc",
                  fontSize: 9,
                  position: "insideTopLeft",
                }}
              />
            )}
            {zones && (
              <ReferenceLine
                y={setup.targets[1]}
                stroke="#b393ff"
                strokeDasharray="4 4"
                label={{
                  value: "TAKE PROFIT 2 / RESISTANCE",
                  fill: "#b393ff",
                  fontSize: 9,
                  position: "insideBottomLeft",
                }}
              />
            )}
            <Bar dataKey="wick" barSize={1} isAnimationActive={false}>
              {marketSeries(setup, timeframe).map((p, i) => (
                <Cell
                  key={i}
                  fill={p.value >= p.open ? "#38d2a2" : "#f06c81"}
                />
              ))}
            </Bar>
            <Bar dataKey="body" barSize={5} isAnimationActive={false}>
              {marketSeries(setup, timeframe).map((p, i) => (
                <Cell
                  key={i}
                  fill={p.value >= p.open ? "#38d2a2" : "#f06c81"}
                />
              ))}
            </Bar>
            <Line
              dataKey="ma"
              type="monotone"
              dot={false}
              stroke="#d6a956"
              strokeWidth={1}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <span className="oai-chart-radar" aria-hidden="true" />
      </motion.div>
      <footer className="oai-chart-footer">
        <span>
          <span className="oai-dot" />
          Illustrative price chart
        </span>
        <span>{timeframe} · UTC · No live feed</span>
      </footer>
    </Panel>
  );
}
export function PerformanceChart() {
  return (
    <div className="oai-performance-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={performanceSeries}>
          <CartesianGrid stroke="#172a40" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#8294ad", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{
              background: "#101d32",
              border: "1px solid #304460",
              color: "white",
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#5d9eff"
            fill="#162e54"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function ComparisonChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  return (
    <div className="oai-performance-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 25 }}>
          <XAxis type="number" hide />
          <YAxis
            dataKey="label"
            type="category"
            width={95}
            tick={{ fill: "#a7b7ce", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "#101d32",
              border: "1px solid #304460",
              color: "white",
            }}
          />
          <Bar
            dataKey="value"
            fill="#438bf8"
            radius={[0, 4, 4, 0]}
            barSize={15}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
