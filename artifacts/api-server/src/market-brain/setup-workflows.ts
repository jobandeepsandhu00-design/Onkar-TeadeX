import type {
  Candle,
  FeatureValue,
  GlobalTradingWorkflow,
} from "@workspace/api-zod";

export const CANONICAL_SETUP_WORKFLOWS = [
  "Wickfill in Range",
  "Breakout A+",
  "Breakout Impulse",
  "Breakout Small Body",
  "Breakout Wickfill",
  "Fakeout at S/R",
  "Pullback — S/R Formed",
  "Pullback Impulse A+ — With S/R",
  "Pullback Impulse — Without S/R",
  "Pullback Wickfill",
  "S/R Buy / Sell",
  "S/R Impulse",
  "Counter Buy / Sell",
  "Defended Breakout",
  "Breakout Big Body",
  "A+ Buy / Sell",
] as const;

export type CanonicalSetupWorkflow = (typeof CANONICAL_SETUP_WORKFLOWS)[number];

const ALIASES: Record<string, CanonicalSetupWorkflow> = {
  "pullback s r formed": "Pullback — S/R Formed",
  "pullback impulse a with s r": "Pullback Impulse A+ — With S/R",
  "pullback impulse a plus with s r": "Pullback Impulse A+ — With S/R",
  "pullback impulse without s r": "Pullback Impulse — Without S/R",
  "s r buy": "S/R Buy / Sell",
  "s r sell": "S/R Buy / Sell",
  "s r buy sell": "S/R Buy / Sell",
  "counter buy": "Counter Buy / Sell",
  "counter sell": "Counter Buy / Sell",
  "counter buy sell": "Counter Buy / Sell",
  "a buy": "A+ Buy / Sell",
  "a sell": "A+ Buy / Sell",
  "a plus buy": "A+ Buy / Sell",
  "a plus sell": "A+ Buy / Sell",
  "a buy sell": "A+ Buy / Sell",
  "big body breakout buy": "Breakout Big Body",
  "big body breakout sell": "Breakout Big Body",
};

function nameKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const canonicalByKey = new Map<string, CanonicalSetupWorkflow>(
  CANONICAL_SETUP_WORKFLOWS.map((name) => [nameKey(name), name]),
);

export function canonicalSetupWorkflow(
  value: string,
): CanonicalSetupWorkflow | null {
  const key = nameKey(value);
  return canonicalByKey.get(key) ?? ALIASES[key] ?? null;
}

export type SetupWorkflowEvaluation = {
  setup: CanonicalSetupWorkflow;
  direction: "long" | "short";
  patternMatched: boolean;
  entryTrigger: boolean;
  conditionsMatched: string[];
  conditionsMissing: string[];
  invalidated: boolean;
  waitFor: string;
  features: Record<string, FeatureValue>;
};

function body(candle: Candle) {
  return Math.abs(candle.c - candle.o);
}

function range(candle: Candle) {
  return Math.max(candle.h - candle.l, Number.EPSILON);
}

function upperWick(candle: Candle) {
  return candle.h - Math.max(candle.o, candle.c);
}

function lowerWick(candle: Candle) {
  return Math.min(candle.o, candle.c) - candle.l;
}

function bullish(candle: Candle) {
  return candle.c > candle.o;
}

function bearish(candle: Candle) {
  return candle.c < candle.o;
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function touchesZone(
  candle: Candle,
  zone: { low: number; high: number } | null,
) {
  return Boolean(zone && candle.l <= zone.high && candle.h >= zone.low);
}

function closesBeyond(
  candle: Candle,
  zone: { low: number; high: number } | null,
  direction: "long" | "short",
) {
  return Boolean(
    zone && (direction === "long" ? candle.c > zone.high : candle.c < zone.low),
  );
}

function breaksReference(
  trigger: Candle,
  reference: Candle,
  direction: "long" | "short",
) {
  return direction === "long"
    ? trigger.h > reference.h && bullish(trigger)
    : trigger.l < reference.l && bearish(trigger);
}

function directionFor(
  workflow: GlobalTradingWorkflow,
  requested: "long" | "short" | "both",
  setup: CanonicalSetupWorkflow,
  reference: Candle,
) {
  if (requested !== "both") return requested;
  if (setup === "Counter Buy / Sell")
    return workflow.fourHour.bias === "bullish" ? "short" : "long";
  const reaction = workflow.thirtyMinute.reaction;
  if (reaction.startsWith("BEARISH") || reaction === "RESISTANCE_CONFIRMED")
    return "short";
  if (reaction.startsWith("BULLISH") || reaction === "SUPPORT_CONFIRMED")
    return "long";
  if (workflow.fourHour.bias === "ranging")
    return bearish(reference) ? "short" : "long";
  return workflow.fourHour.bias === "bearish" ? "short" : "long";
}

/**
 * Evaluates the document's setup-specific 30M pattern using closed candles only.
 * The mandatory 4H → 1H → 30M parent gate remains separate and must unlock first.
 */
export function evaluateSetupWorkflow(args: {
  setupName: string;
  requestedDirection: "long" | "short" | "both";
  workflow: GlobalTradingWorkflow | null;
  closedThirtyMinuteCandles: Candle[];
}): SetupWorkflowEvaluation | null {
  const setup = canonicalSetupWorkflow(args.setupName);
  const workflow = args.workflow;
  const bars = args.closedThirtyMinuteCandles;
  if (!setup || !workflow || bars.length < 24) return null;
  const trigger = bars.at(-1)!;
  const reference = bars.at(-2)!;
  const prior = bars.at(-3)!;
  const recent = bars.slice(-12, -2);
  const direction = directionFor(
    workflow,
    args.requestedDirection,
    setup,
    reference,
  );
  const support = workflow.thirtyMinute.support;
  const resistance = workflow.thirtyMinute.resistance;
  const trendAligned =
    (direction === "long" && workflow.fourHour.bias === "bullish") ||
    (direction === "short" && workflow.fourHour.bias === "bearish");
  const relevantZone = direction === "long" ? support : resistance;
  const opposingZone = direction === "long" ? resistance : support;
  const atRelevantZone = touchesZone(reference, relevantZone);
  const referenceRange = range(reference);
  const smallBody = body(reference) / referenceRange <= 0.35;
  const largeBody =
    body(reference) / referenceRange >= 0.7 &&
    referenceRange >= average(recent.map(range)) * 1.25;
  const rejection =
    direction === "long"
      ? lowerWick(reference) / referenceRange >= 0.5
      : upperWick(reference) / referenceRange >= 0.5;
  const oppositeReference =
    direction === "long" ? bearish(reference) : bullish(reference);
  const sameDirectionReference =
    direction === "long" ? bullish(reference) : bearish(reference);
  const triggerPresent = breaksReference(trigger, reference, direction);
  const breakout = closesBeyond(reference, opposingZone, direction);
  const fakeout =
    direction === "long"
      ? Boolean(
          support && reference.l < support.low && reference.c > support.low,
        )
      : Boolean(
          resistance &&
          reference.h > resistance.high &&
          reference.c < resistance.high,
        );
  const volumeValues = recent
    .map((candle) => candle.v)
    .filter((value): value is number => value !== null && value > 0);
  const volumeAvailable = reference.v !== null && volumeValues.length >= 5;
  const volumeImpulse =
    volumeAvailable && reference.v! >= average(volumeValues) * 1.15;
  const repeatedDefense = Boolean(
    opposingZone &&
    recent.filter((candle) => touchesZone(candle, opposingZone)).length >= 2,
  );
  const strongLeg =
    recent
      .slice(-3)
      .filter((candle) =>
        direction === "long" ? bullish(candle) : bearish(candle),
      ).length >= 2;
  const weakCounter = oppositeReference && smallBody;
  const bothLocalSides = Boolean(support && resistance);
  const counterBreak =
    direction === "long"
      ? workflow.fourHour.bias === "bearish" &&
        closesBeyond(reference, resistance, "long")
      : workflow.fourHour.bias === "bullish" &&
        closesBeyond(reference, support, "short");

  let patternMatched = false;
  let waitFor =
    "The next closed 30M candle must provide the setup entry trigger.";
  const conditionsMatched: string[] = [];
  const conditionsMissing: string[] = [];
  const require = (condition: boolean, label: string) => {
    (condition ? conditionsMatched : conditionsMissing).push(label);
    return condition;
  };
  const all = (...conditions: boolean[]) => conditions.every(Boolean);

  switch (setup) {
    case "Wickfill in Range":
      patternMatched = all(
        require(workflow.fourHour.bias === "ranging" ||
          bothLocalSides, "Established range is present"),
        require(rejection, "A clear unfinished wick is present"),
        require(!closesBeyond(
          reference,
          opposingZone,
          direction,
        ), "Reference candle remains inside the range"),
      );
      waitFor =
        "Wait for the next 30M flip toward the wick; at S/R a second confirmation candle is mandatory.";
      break;
    case "Breakout A+":
      patternMatched = all(
        require(breakout, "30M candle closed beyond meaningful S/R"),
        require(smallBody, "Breakout reference body is weak/small"),
        require(!rejection, "No significant opposing rejection wick blocks the move"),
      );
      break;
    case "Breakout Impulse":
      patternMatched = all(
        require(breakout, "30M reference candle closed through S/R"),
        require(smallBody, "Reference candle is weak before impulse"),
        require(volumeAvailable, "Real volume data is available"),
        require(volumeImpulse, "Recognized volume impulse is present"),
      );
      waitFor = volumeAvailable
        ? waitFor
        : "Real volume is unavailable; this setup cannot be confirmed.";
      break;
    case "Breakout Small Body":
      patternMatched = all(
        require(breakout, "30M candle closed beyond S/R"),
        require(smallBody, "Breakout candle has an unusually small body"),
      );
      break;
    case "Breakout Wickfill":
      patternMatched = all(
        require(breakout, "30M candle closed beyond S/R"),
        require(rejection, "Breakout candle left a large rejection wick"),
      );
      waitFor =
        "Wait for a closed 30M re-flip/re-break in the breakout direction.";
      break;
    case "Fakeout at S/R":
      patternMatched = all(
        require(fakeout, "Failed break closed back inside the S/R range"),
        require(sameDirectionReference, "Reversal candle closed strongly back inside"),
      );
      break;
    case "Pullback — S/R Formed":
      patternMatched = all(
        require(trendAligned, "4H trend agrees with direction"),
        require(atRelevantZone, "Pullback reached prior S/R"),
        require(sameDirectionReference, "Fresh 30M S/R confirmation formed"),
      );
      break;
    case "Pullback Impulse A+ — With S/R":
      patternMatched = all(
        require(trendAligned, "4H trend agrees with direction"),
        require(atRelevantZone, "Fresh minor 30M S/R formed at pullback"),
        require(rejection, "Impulse/exhaustion rejection formed"),
      );
      break;
    case "Pullback Impulse — Without S/R":
      patternMatched = all(
        require(trendAligned, "4H trend remains intact"),
        require(!atRelevantZone, "No clean new minor S/R formed"),
        require(oppositeReference &&
          rejection, "Weak counter body with large exhaustion wick formed"),
      );
      break;
    case "Pullback Wickfill":
      patternMatched = all(
        require(trendAligned, "4H trend remains intact"),
        require(atRelevantZone, "Wick formed at the pullback area"),
        require(rejection, "Large pullback rejection wick formed"),
      );
      break;
    case "S/R Buy / Sell":
      patternMatched = all(
        require(trendAligned, "4H trend agrees with direction"),
        require(atRelevantZone, "Price retested existing S/R"),
        require(sameDirectionReference, "Fresh local S/R held on the closed candle"),
      );
      break;
    case "S/R Impulse":
      patternMatched = all(
        require(trendAligned, "4H trend agrees with direction"),
        require(atRelevantZone, "Price is at the intended S/R"),
        require(oppositeReference &&
          rejection, "Weak counter body and large exhaustion wick formed"),
        require(volumeAvailable, "Real volume data is available"),
      );
      waitFor = volumeAvailable
        ? waitFor
        : "Volume/session evidence is unavailable; this setup cannot be confirmed.";
      break;
    case "Counter Buy / Sell":
      patternMatched = all(
        require(bothLocalSides, "Both sides of local 30M structure are visible"),
        require(counterBreak, "Closed 30M candle broke the local level against the prior trend"),
        require(workflow.availableRange.status !==
          "INSUFFICIENT_RANGE", "Enough range remains for the counter move"),
      );
      break;
    case "Defended Breakout":
      patternMatched = all(
        require(repeatedDefense, "The same meaningful S/R level was defended at least twice"),
        require(breakout &&
          sameDirectionReference, "Decisive 30M close broke the defended level"),
      );
      break;
    case "Breakout Big Body": {
      const bigBreak = largeBody && breakout;
      const secondConfirmation =
        bigBreak &&
        (direction === "long" ? bullish(trigger) : bearish(trigger)) &&
        breaksReference(trigger, reference, direction);
      const earlier = bars.at(-3)!;
      const earlierLarge =
        body(earlier) / range(earlier) >= 0.7 &&
        range(earlier) >= average(bars.slice(-13, -3).map(range)) * 1.25;
      const pullbackContinuation =
        earlierLarge && touchesZone(reference, relevantZone) && triggerPresent;
      const consolidationContinuation =
        earlierLarge &&
        body(reference) / range(reference) <= 0.4 &&
        triggerPresent;
      patternMatched = Boolean(
        require(bigBreak ||
          pullbackContinuation ||
          consolidationContinuation, "A validated A+, consolidation, or pullback continuation path followed the big-body breakout"),
      );
      waitFor =
        secondConfirmation || pullbackContinuation || consolidationContinuation
          ? waitFor
          : "Do not chase the large candle; wait for a second confirmation, a new range breakout, or a confirmed pullback.";
      break;
    }
    case "A+ Buy / Sell":
      patternMatched = all(
        require(trendAligned, "Strong 4H direction is aligned"),
        require(strongLeg, "A strong directional leg preceded the setup"),
        require(weakCounter, "Exactly one weak opposite-coloured reference candle closed"),
        require(!closesBeyond(
          reference,
          relevantZone,
          direction === "long" ? "short" : "long",
        ), "Counter candle did not destroy structure"),
      );
      break;
  }

  const parentGateUnlocked = workflow.gate.status === "UNLOCKED";
  if (!parentGateUnlocked) {
    conditionsMissing.unshift(
      ...workflow.gate.missing.map((item) => `Parent gate — ${item}`),
    );
    waitFor = workflow.gate.missing[0] ?? "Complete the parent workflow.";
  }
  if (patternMatched && !triggerPresent) {
    conditionsMissing.push("Closed 30M entry-trigger candle");
  } else if (triggerPresent) {
    conditionsMatched.push("Closed 30M entry-trigger candle");
  }
  const invalidated =
    workflow.priceLocation === "AT_OPPOSING_ZONE" ||
    workflow.availableRange.status === "INSUFFICIENT_RANGE";
  return {
    setup,
    direction,
    patternMatched,
    // Setup recognition remains visible while execution stays fail-closed.
    entryTrigger:
      parentGateUnlocked && patternMatched && triggerPresent && !invalidated,
    conditionsMatched: [...new Set(conditionsMatched)],
    conditionsMissing: [...new Set(conditionsMissing)],
    invalidated,
    waitFor,
    features: {
      setupPatternMatched: patternMatched,
      entryTrigger:
        parentGateUnlocked && patternMatched && triggerPresent && !invalidated,
      volumeWindow: volumeAvailable ? volumeImpulse : null,
    },
  };
}
