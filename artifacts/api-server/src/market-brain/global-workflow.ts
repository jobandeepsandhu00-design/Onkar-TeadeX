import {
  globalTradingWorkflowSchema,
  timeframeMs,
  type Candle,
  type GlobalTradingWorkflow,
  type Timeframe,
} from "@workspace/api-zod";
import {
  marketSession,
  timeframeContext,
  type TimeframeContext,
  type Zone,
} from "./calculations";

const WORKFLOW_SYMBOLS = new Set(["GBPJPY", "XAUUSD"]);
const PIP_SIZES: Record<string, number> = {
  GBPJPY: 0.01,
  XAUUSD: 0.01,
};

export const GLOBAL_WORKFLOW_TIMEFRAMES = ["4h", "1h", "30m"] as const;

export function globalWorkflowRequired(symbol: string) {
  return WORKFLOW_SYMBOLS.has(symbol.replace(/[/-]/g, "").toUpperCase());
}

type WorkflowZone = NonNullable<GlobalTradingWorkflow["fourHour"]["support"]>;

function zoneValue(zone: Zone, timeframe: "4h" | "1h" | "30m"): WorkflowZone {
  return {
    low: zone.low,
    high: zone.high,
    type: zone.type,
    timeframe,
    touches: zone.touches,
    freshness: zone.freshness,
  };
}

function zoneMid(zone: { low: number; high: number }) {
  return (zone.low + zone.high) / 2;
}

function activeZones(context: TimeframeContext) {
  return context.zones.filter((zone) => !zone.invalidated);
}

function nearestZone(
  context: TimeframeContext,
  timeframe: "4h" | "1h" | "30m",
  price: number,
  side: "support" | "resistance",
): WorkflowZone | null {
  const types =
    side === "support"
      ? new Set(["support", "equal_lows"])
      : new Set(["resistance", "equal_highs"]);
  const directional = activeZones(context).filter(
    (zone) =>
      types.has(zone.type) &&
      (side === "support" ? zone.low <= price : zone.high >= price),
  );
  const rows = directional.length
    ? directional
    : activeZones(context).filter((zone) => types.has(zone.type));
  const selected = rows.sort(
    (a, b) => Math.abs(zoneMid(a) - price) - Math.abs(zoneMid(b) - price),
  )[0];
  return selected ? zoneValue(selected, timeframe) : null;
}

function lastSwing(context: TimeframeContext, type: "high" | "low") {
  return (
    [...context.structure.swings].reverse().find((swing) => swing.type === type)
      ?.price ?? null
  );
}

function structureLabels(context: TimeframeContext) {
  const labels: string[] = [];
  if (context.structure.higherHigh) labels.push("HH");
  if (context.structure.higherLow) labels.push("HL");
  if (context.structure.lowerHigh) labels.push("LH");
  if (context.structure.lowerLow) labels.push("LL");
  if (!labels.length) labels.push("RANGE");
  return labels;
}

function overlaps(
  left: { low: number; high: number },
  right: { low: number; high: number },
) {
  return left.low <= right.high && right.low <= left.high;
}

function refinedSetupZone(
  bias: GlobalTradingWorkflow["fourHour"]["bias"],
  four: { support: WorkflowZone | null; resistance: WorkflowZone | null },
  one: { support: WorkflowZone | null; resistance: WorkflowZone | null },
  tolerance: number,
) {
  const parent = bias === "bullish" ? four.support : four.resistance;
  const child = bias === "bullish" ? one.support : one.resistance;
  if (!parent || !child) return null;
  const distance = Math.max(
    parent.low - child.high,
    child.low - parent.high,
    0,
  );
  return overlaps(parent, child) || distance <= tolerance ? child : null;
}

function distanceToZone(price: number, zone: WorkflowZone | null) {
  if (!zone) return Number.POSITIVE_INFINITY;
  if (price >= zone.low && price <= zone.high) return 0;
  return price < zone.low ? zone.low - price : price - zone.high;
}

function locatePrice(args: {
  bias: GlobalTradingWorkflow["fourHour"]["bias"];
  price: number;
  tolerance: number;
  fourSupport: WorkflowZone | null;
  fourResistance: WorkflowZone | null;
  oneSupport: WorkflowZone | null;
  oneResistance: WorkflowZone | null;
  thirtySupport: WorkflowZone | null;
  thirtyResistance: WorkflowZone | null;
  setupZone: WorkflowZone | null;
}): GlobalTradingWorkflow["priceLocation"] {
  const {
    bias,
    price,
    tolerance,
    fourSupport,
    fourResistance,
    oneSupport,
    oneResistance,
    thirtySupport,
    thirtyResistance,
    setupZone,
  } = args;
  const at = (zone: WorkflowZone | null) =>
    distanceToZone(price, zone) <= tolerance;
  if (bias === "ranging") {
    if (at(thirtySupport)) return "AT_30M_SUPPORT";
    if (at(thirtyResistance)) return "AT_30M_RESISTANCE";
    if (at(oneSupport)) return "AT_1H_SUPPORT";
    if (at(oneResistance)) return "AT_1H_RESISTANCE";
    if (at(fourSupport)) return "AT_4H_SUPPORT";
    if (at(fourResistance)) return "AT_4H_RESISTANCE";
  } else if (bias === "bullish") {
    if (at(fourResistance) || at(oneResistance)) return "AT_OPPOSING_ZONE";
    if (at(thirtySupport)) return "AT_30M_SUPPORT";
    if (at(oneSupport)) return "AT_1H_SUPPORT";
    if (at(fourSupport)) return "AT_4H_SUPPORT";
  } else if (bias === "bearish") {
    if (at(fourSupport) || at(oneSupport)) return "AT_OPPOSING_ZONE";
    if (at(thirtyResistance)) return "AT_30M_RESISTANCE";
    if (at(oneResistance)) return "AT_1H_RESISTANCE";
    if (at(fourResistance)) return "AT_4H_RESISTANCE";
  }
  if (distanceToZone(price, setupZone) <= tolerance * 2)
    return "APPROACHING_ZONE";
  const supports = [fourSupport, oneSupport, thirtySupport].filter(
    (zone): zone is WorkflowZone => Boolean(zone),
  );
  const resistances = [fourResistance, oneResistance, thirtyResistance].filter(
    (zone): zone is WorkflowZone => Boolean(zone),
  );
  if (
    supports.some((zone) => zone.high < price) &&
    resistances.some((zone) => zone.low > price)
  )
    return "MIDDLE_OF_RANGE";
  return "TOO_FAR_FROM_ZONE";
}

function classifyReaction(
  context: TimeframeContext,
  candle: Candle,
  support: WorkflowZone | null,
  resistance: WorkflowZone | null,
): GlobalTradingWorkflow["thirtyMinute"]["reaction"] {
  const patterns = context.patterns;
  if (patterns.sweep === "bullish") return "BULLISH_FAKEOUT";
  if (patterns.sweep === "bearish") return "BEARISH_FAKEOUT";
  if (patterns.rejection === "bullish") return "BULLISH_REJECTION";
  if (patterns.rejection === "bearish") return "BEARISH_REJECTION";
  if (patterns.breakout === "bullish") return "BULLISH_BREAKOUT";
  if (patterns.breakout === "bearish") return "BEARISH_BREAKOUT";
  if (
    support &&
    candle.l <= support.high &&
    candle.c > candle.o &&
    candle.c >= support.low
  )
    return "SUPPORT_CONFIRMED";
  if (
    resistance &&
    candle.h >= resistance.low &&
    candle.c < candle.o &&
    candle.c <= resistance.high
  )
    return "RESISTANCE_CONFIRMED";
  if (patterns.momentum === "bullish") return "BULLISH_CONTINUATION";
  if (patterns.momentum === "bearish") return "BEARISH_CONTINUATION";
  return "NO_CONFIRMATION";
}

function alignment(
  four: GlobalTradingWorkflow["fourHour"]["bias"],
  one: GlobalTradingWorkflow["oneHour"]["bias"],
  price: number,
  parentZone: WorkflowZone | null,
): GlobalTradingWorkflow["oneHour"]["alignment"] {
  if (four === "ranging") return "RANGING";
  if (four === one) return "FULL_ALIGNMENT";
  if (one === "ranging" || distanceToZone(price, parentZone) === 0)
    return "PARTIAL_ALIGNMENT";
  return "CONFLICT";
}

function closestOpposingZone(
  bias: GlobalTradingWorkflow["fourHour"]["bias"],
  price: number,
  zones: Array<WorkflowZone | null>,
) {
  return (
    zones
      .filter((zone): zone is WorkflowZone => Boolean(zone))
      .filter((zone) =>
        bias === "bullish" ? zone.low > price : zone.high < price,
      )
      .sort(
        (a, b) =>
          Math.abs((bias === "bullish" ? a.low : a.high) - price) -
          Math.abs((bias === "bullish" ? b.low : b.high) - price),
      )[0] ?? null
  );
}

export function buildGlobalTradingWorkflow(args: {
  symbol: string;
  histories: Partial<Record<Timeframe, Candle[]>>;
  now: number;
  formingThirtyMinute?: Candle | null;
}): GlobalTradingWorkflow | null {
  const fourBars = args.histories["4h"];
  const oneBars = args.histories["1h"];
  const thirtyBars = args.histories["30m"];
  if (
    !fourBars ||
    !oneBars ||
    !thirtyBars ||
    fourBars.length < 30 ||
    oneBars.length < 30 ||
    thirtyBars.length < 30
  )
    return null;
  const four = timeframeContext(fourBars, "4h", args.now);
  const one = timeframeContext(oneBars, "1h", args.now);
  const thirty = timeframeContext(thirtyBars, "30m", args.now);
  const candle = thirtyBars.at(-1)!;
  const price = candle.c;
  const fourSupport = nearestZone(four, "4h", price, "support");
  const fourResistance = nearestZone(four, "4h", price, "resistance");
  const oneSupport = nearestZone(one, "1h", price, "support");
  const oneResistance = nearestZone(one, "1h", price, "resistance");
  const thirtySupport = nearestZone(thirty, "30m", price, "support");
  const thirtyResistance = nearestZone(thirty, "30m", price, "resistance");
  const bias = four.structure
    .trend as GlobalTradingWorkflow["fourHour"]["bias"];
  const oneHourBias = one.structure
    .trend as GlobalTradingWorkflow["oneHour"]["bias"];
  const tolerance = Math.max(
    thirty.indicators.atr ? thirty.indicators.atr * 0.2 : 0,
    price * 0.0002,
  );
  const parentZone = bias === "bullish" ? fourSupport : fourResistance;
  const setupZone =
    bias === "ranging"
      ? ([oneSupport, oneResistance]
          .filter((zone): zone is WorkflowZone => Boolean(zone))
          .sort(
            (a, b) => distanceToZone(price, a) - distanceToZone(price, b),
          )[0] ?? null)
      : refinedSetupZone(
          bias,
          { support: fourSupport, resistance: fourResistance },
          { support: oneSupport, resistance: oneResistance },
          one.indicators.atr ?? tolerance,
        );
  const oneAlignment = alignment(bias, oneHourBias, price, parentZone);
  const priceLocation = locatePrice({
    bias,
    price,
    tolerance,
    fourSupport,
    fourResistance,
    oneSupport,
    oneResistance,
    thirtySupport,
    thirtyResistance,
    setupZone,
  });
  const rangeAtSupport = [
    "AT_4H_SUPPORT",
    "AT_1H_SUPPORT",
    "AT_30M_SUPPORT",
  ].includes(priceLocation);
  const effectiveRangeBias =
    bias === "ranging" ? (rangeAtSupport ? "bullish" : "bearish") : bias;
  const opposingZone = closestOpposingZone(
    effectiveRangeBias,
    price,
    bias === "bullish" || (bias === "ranging" && rangeAtSupport)
      ? [fourResistance, oneResistance, thirtyResistance]
      : [fourSupport, oneSupport, thirtySupport],
  );
  const priceUnits = opposingZone
    ? Math.max(
        0,
        effectiveRangeBias === "bullish"
          ? opposingZone.low - price
          : price - opposingZone.high,
      )
    : null;
  const normalizedSymbol = args.symbol.replace(/[/-]/g, "").toUpperCase();
  const pipSize = PIP_SIZES[normalizedSymbol] ?? null;
  const pips = priceUnits !== null && pipSize ? priceUnits / pipSize : null;
  const rangeStatus: GlobalTradingWorkflow["availableRange"]["status"] =
    pips === null
      ? "UNAVAILABLE"
      : pips >= 40
        ? "GOOD_RANGE"
        : pips >= 20
          ? "LIMITED_RANGE"
          : "INSUFFICIENT_RANGE";
  const candleClosed = candle.t + timeframeMs["30m"] <= args.now;
  const reaction = classifyReaction(
    thirty,
    candle,
    thirtySupport,
    thirtyResistance,
  );
  const checks = [
    ["4H bias identified", true],
    [
      "4H major support and resistance identified",
      Boolean(fourSupport && fourResistance),
    ],
    ["1H structure analyzed", true],
    ["1H refined setup zone identified", Boolean(setupZone)],
    [
      "30M recent support and resistance identified",
      Boolean(thirtySupport && thirtyResistance),
    ],
    ["30M local structure understood", thirty.structure.swings.length >= 2],
    [
      "Price at the correct location",
      !["MIDDLE_OF_RANGE", "TOO_FAR_FROM_ZONE", "AT_OPPOSING_ZONE"].includes(
        priceLocation,
      ),
    ],
    [
      "Enough range available",
      rangeStatus !== "INSUFFICIENT_RANGE" && rangeStatus !== "UNAVAILABLE",
    ],
    ["30M candle closed", candleClosed],
    // The parent gate classifies the closed 30M reaction; the selected setup
    // decides whether it must align with 4H. This preserves the documented
    // Counter Buy / Sell exception without weakening setup-specific rules.
    ["Valid 30M reaction classified", reaction !== "NO_CONFIRMATION"],
  ] as const;
  const passed = checks.filter(([, ok]) => ok).map(([name]) => name);
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const gateStatus = missing.length ? "LOCKED" : "UNLOCKED";
  const masterStatus: GlobalTradingWorkflow["masterStatus"] = !candleClosed
    ? "WAITING_FOR_30M_CLOSE"
    : args.formingThirtyMinute && reaction === "NO_CONFIRMATION"
      ? "WAITING_FOR_30M_CLOSE"
      : priceLocation === "APPROACHING_ZONE"
        ? "APPROACHING_ZONE"
        : ["AT_OPPOSING_ZONE", "TOO_FAR_FROM_ZONE", "MIDDLE_OF_RANGE"].includes(
              priceLocation,
            )
          ? "SCANNING"
          : reaction === "NO_CONFIRMATION"
            ? "NO_CONFIRMATION"
            : gateStatus === "UNLOCKED"
              ? "SETUP_DETECTED"
              : "AT_SETUP_AREA";
  return globalTradingWorkflowSchema.parse({
    version: "4h-1h-30m-v1",
    symbol: normalizedSymbol,
    evaluatedAt: new Date(args.now).toISOString(),
    session: marketSession(args.now),
    currentPrice: price,
    fourHour: {
      bias,
      structure: structureLabels(four),
      support: fourSupport,
      resistance: fourResistance,
      swingHigh: lastSwing(four, "high"),
      swingLow: lastSwing(four, "low"),
      brokenStructure: four.structure.bos,
    },
    oneHour: {
      bias: oneHourBias,
      alignment: oneAlignment,
      support: oneSupport,
      resistance: oneResistance,
      setupZone,
      swingHigh: lastSwing(one, "high"),
      swingLow: lastSwing(one, "low"),
      brokenStructure: one.structure.bos,
    },
    thirtyMinute: {
      support: thirtySupport,
      resistance: thirtyResistance,
      swingHigh: lastSwing(thirty, "high"),
      swingLow: lastSwing(thirty, "low"),
      brokenStructure: thirty.structure.bos,
      candle: { ...candle, closed: candleClosed },
      reaction,
    },
    priceLocation,
    availableRange: {
      priceUnits,
      pips,
      pipSize,
      status: rangeStatus,
      opposingZone,
    },
    gate: { status: gateStatus, passed, missing },
    riskGate: "PENDING",
    masterStatus,
  });
}

export function finalizeGlobalTradingWorkflow(
  workflow: GlobalTradingWorkflow,
  setupMatched: boolean,
  riskAllowed: boolean,
): GlobalTradingWorkflow {
  if (workflow.gate.status === "LOCKED") return workflow;
  return globalTradingWorkflowSchema.parse({
    ...workflow,
    riskGate: setupMatched
      ? riskAllowed
        ? "APPROVED"
        : "REJECTED"
      : "PENDING",
    masterStatus: !setupMatched
      ? "NO_CONFIRMATION"
      : riskAllowed
        ? "ENTRY_READY"
        : "RISK_REJECTED",
  });
}
