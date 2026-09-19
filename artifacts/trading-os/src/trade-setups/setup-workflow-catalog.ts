import type { SetupDirection, SetupQuality, SetupRuleType } from "./types";

export type SetupWorkflowSpec = {
  name: string;
  aliases: string[];
  direction: SetupDirection;
  category: string;
  quality: SetupQuality;
  description: string;
  session: "Any" | "London" | "New York" | "London/NY" | "Asian";
  exception?: boolean;
  rules: Array<[SetupRuleType, string]>;
};

const parentRules: Array<[SetupRuleType, string]> = [
  [
    "condition",
    "4H: identify bullish, bearish or ranging structure; mark major S/R, swings, broken structure, retests and rejection regions.",
  ],
  [
    "condition",
    "1H: refine the exact setup zone and classify alignment, pullback or conflict with the 4H map.",
  ],
  [
    "condition",
    "30M: mark recent S/R, swings and micro-structure; the required confirmation candle must close before Setup AI can confirm.",
  ],
  [
    "no_trade",
    "Do not trade in the middle of the range, too far from the zone, into nearby 1H/4H opposition, or without enough open range.",
  ],
];

const standardManagement: Array<[SetupRuleType, string]> = [
  [
    "stop_loss",
    "BUY below the reference candle/structural low; SELL above the reference candle/structural high.",
  ],
  [
    "take_profit",
    "Use the available structure and volatility; normally protect about 90% of a 25–30 pip target when that range exists.",
  ],
  [
    "risk",
    "Move toward break-even after the previous high/low breaks or roughly +10–15 pips; adverse re-flip may require a 75% reduction.",
  ],
  [
    "invalidation",
    "Exit if the setup's own structural low/high breaks or a setup-specific invalidation condition occurs.",
  ],
];

const workflow = (
  spec: Omit<SetupWorkflowSpec, "rules"> & {
    pattern: string;
    entry: string;
    invalidation: string;
    management?: Array<[SetupRuleType, string]>;
  },
): SetupWorkflowSpec => ({
  ...spec,
  rules: [
    ...parentRules,
    ["condition", spec.pattern],
    ["entry", spec.entry],
    ...(spec.management ?? standardManagement),
    ["invalidation", spec.invalidation],
  ],
});

export const SETUP_WORKFLOW_CATALOG: SetupWorkflowSpec[] = [
  workflow({
    name: "Wickfill in Range",
    aliases: [],
    direction: "Both",
    category: "Range",
    quality: "A",
    session: "Any",
    exception: true,
    description:
      "Trade an unfinished wick inside an established range, with extra confirmation when the wick rejects directly from S/R.",
    pattern:
      "A clear wick remains inside an established range. If it forms at S/R, a second closed candle must confirm pressure.",
    entry:
      "Enter on the next closed 30M bullish/bearish flip toward the wickfill; the S/R rejection version requires the second confirmation candle.",
    management: [
      [
        "stop_loss",
        "Place SL beyond the relevant wick or invalidating structure.",
      ],
      [
        "take_profit",
        "Target the wickfill itself rather than automatically using the standard 25–30 pip target.",
      ],
      [
        "risk",
        "Manage exposure by the available range and the reference structure.",
      ],
    ],
    invalidation:
      "Reject a poorly defined wick, bad location, insufficient room, or conflicting higher-timeframe structure.",
  }),
  workflow({
    name: "Breakout A+",
    aliases: [],
    direction: "Both",
    category: "Breakout",
    quality: "A+",
    session: "Any",
    description:
      "Clean approach to S/R followed by a weak/small closed breakout candle and a confirmed continuation break.",
    pattern:
      "Price approaches meaningful S/R cleanly and a small/weak 30M candle closes slightly beyond it without a major opposing wick.",
    entry:
      "Enter after a closed next candle breaks the breakout/reference candle high for BUY or low for SELL.",
    invalidation:
      "No trade with an opposing wick, insufficient range, extension, or nearby 1H/4H obstruction.",
  }),
  workflow({
    name: "Breakout Impulse",
    aliases: [],
    direction: "Both",
    category: "Breakout",
    quality: "A",
    session: "London/NY",
    description:
      "A closed weak breakout reference followed by decisive continuation during a verified high-volume window.",
    pattern:
      "A weak 30M reference candle closes near/through S/R and verified real volume/momentum then pushes decisively through the level.",
    entry:
      "After the reference candle closes, enter only on the confirmed continuation/high-low break.",
    invalidation:
      "Cannot confirm outside a recognized high-volume window or when real volume/session evidence is unavailable.",
  }),
  workflow({
    name: "Breakout Small Body",
    aliases: [],
    direction: "Both",
    category: "Breakout",
    quality: "A",
    session: "Any",
    description:
      "An unusually small-bodied 30M candle closes beyond established S/R before a confirmed continuation break.",
    pattern:
      "A small-bodied 30M candle closes above resistance for BUY or below support for SELL.",
    entry:
      "Enter after a closed next candle breaks the small breakout candle's high/low.",
    invalidation:
      "Reject when the breakout closes into higher-timeframe opposition or available range is inadequate.",
  }),
  workflow({
    name: "Breakout Wickfill",
    aliases: [],
    direction: "Both",
    category: "Breakout",
    quality: "A",
    session: "Any",
    description:
      "A breakout closes beyond S/R with a large wick, so continuation must return before entry.",
    pattern:
      "The 30M breakout candle closes beyond S/R but leaves a large rejection wick.",
    entry:
      "Enter only after a later closed candle re-flips/re-breaks in the breakout direction.",
    invalidation:
      "Never enter the first break blindly; continuation must return after the wick-bearing candle closes.",
  }),
  workflow({
    name: "Fakeout at S/R",
    aliases: [],
    direction: "Both",
    category: "Range",
    quality: "A",
    session: "Any",
    description:
      "A failed level break closes back inside the range with a strong reversal candle near the tested zone.",
    pattern:
      "Price breaks S/R, fails to hold, and the closed 30M reversal candle returns inside with stronger opposite character.",
    entry:
      "Enter after the next closed candle flips or breaks the confirmation candle high/low.",
    invalidation:
      "Do not enter when price closes near the middle of the range or away from the relevant zone.",
  }),
  workflow({
    name: "Pullback — S/R Formed",
    aliases: ["Pullback S/R Formed"],
    direction: "Both",
    category: "Trend Pullback",
    quality: "A+",
    session: "Any",
    description:
      "Trend continuation after a pullback retests prior S/R and fresh 30M micro S/R forms.",
    pattern:
      "4H trend is valid, 1H identifies the continuation area, and fresh 30M support/resistance forms at the retest with a closed confirmation.",
    entry:
      "Enter on the next closed trend-direction flip or relevant high/low break.",
    invalidation:
      "A zone touch alone is insufficient; fresh S/R and confirmation must actually form.",
  }),
  workflow({
    name: "Pullback Impulse A+ — With S/R",
    aliases: ["Pullback Impulse A+ with S/R"],
    direction: "Both",
    category: "Trend Pullback",
    quality: "A+",
    session: "Any",
    description:
      "Trend pullback with a fresh minor level plus exhaustion/rejection confirmation.",
    pattern:
      "A valid trend pullback creates new minor 30M S/R plus a closed impulse/rejection confirmation.",
    entry: "Enter on the next closed trend-direction flip/high-low break.",
    invalidation:
      "If no clean minor S/R forms, evaluate the Without S/R workflow instead of forcing this setup.",
  }),
  workflow({
    name: "Pullback Impulse — Without S/R",
    aliases: ["Pullback Impulse without S/R"],
    direction: "Both",
    category: "Trend Pullback",
    quality: "B",
    session: "Any",
    description:
      "Trend pullback without a clean new minor level, using a weak counter body and large exhaustion wick.",
    pattern:
      "Trend remains intact; no clean new minor S/R forms; a weak counter-direction 30M body closes with a large rejection wick.",
    entry:
      "Enter after the next closed candle reclaims/breaks in the trend direction.",
    invalidation:
      "Do not change size automatically; Risk AI may only use an explicit user-approved sizing rule.",
  }),
  workflow({
    name: "Pullback Wickfill",
    aliases: [],
    direction: "Both",
    category: "Trend Pullback",
    quality: "A",
    session: "Any",
    description:
      "A trend pullback leaves a large rejection wick whose region becomes the local S/R reference.",
    pattern:
      "Trend remains intact and a large 30M rejection wick closes in the valid 1H pullback zone.",
    entry:
      "Enter after the next closed candle flips/re-breaks in the trend direction.",
    invalidation:
      "Reject a wick in poor location, against main structure, or directly into nearby HTF opposition.",
  }),
  workflow({
    name: "S/R Buy / Sell",
    aliases: ["S/R Buy", "S/R Sell"],
    direction: "Both",
    category: "Trend Pullback",
    quality: "A",
    session: "Any",
    description:
      "Core trend setup: pull back to an existing zone, then require fresh local S/R and a closed confirmation.",
    pattern:
      "Aligned trend reaches existing S/R and a fresh local 30M level forms/holds with a closed confirmation.",
    entry:
      "BUY on the closed break of the relevant bearish candle high/bullish flip; SELL is the inverse.",
    invalidation:
      "Reaching support/resistance alone is not enough; the level must hold and confirm.",
  }),
  workflow({
    name: "S/R Impulse",
    aliases: [],
    direction: "Both",
    category: "Trend Pullback",
    quality: "A",
    session: "London/NY",
    description:
      "S/R continuation confirmed by a weak counter body and large exhaustion wick with verified session/volume context.",
    pattern:
      "At intended S/R, a weak counter body closes with a large rejection wick while trend and verified volume/session remain valid.",
    entry:
      "Enter after the next closed candle flips or breaks high/low in the trend direction.",
    invalidation:
      "Not every wick is impulse confirmation; location, trend and verified volume/session must all pass.",
  }),
  workflow({
    name: "Counter Buy / Sell",
    aliases: ["Counter Buy", "Counter Sell"],
    direction: "Both",
    category: "Trend Losing Control",
    quality: "B",
    session: "Any",
    exception: true,
    description:
      "Counter-trend exception requiring momentum loss, both sides of local structure and a confirmed break.",
    pattern:
      "Prevailing trend loses control, both local support and resistance form, and a closed 30M candle breaks the level opposing the old trend with open range.",
    entry:
      "Enter only the confirmed closed breakout of the local level opposing the previous trend.",
    invalidation:
      "One opposite-coloured candle is never enough to declare a counter-trend setup.",
  }),
  workflow({
    name: "Defended Breakout",
    aliases: [],
    direction: "Both",
    category: "Breakout",
    quality: "A+",
    session: "Any",
    description:
      "The same meaningful level is defended repeatedly before a decisive closed breakout.",
    pattern:
      "The same 30M S/R is tested and rejected at least twice, then a decisive candle closes beyond it.",
    entry:
      "After the decisive close, use the next valid closed continuation/high-low break.",
    invalidation:
      "Tests must refer to the same meaningful level; unrelated candles cannot be counted as defense.",
  }),
  workflow({
    name: "Breakout Big Body",
    aliases: ["Big Body Breakout Buy", "Big Body Breakout Sell"],
    direction: "Both",
    category: "Breakout",
    quality: "A",
    session: "Any",
    exception: true,
    description:
      "A decisive large-body breakout that must develop an A+, consolidation, or pullback continuation path before entry.",
    pattern:
      "A large full-bodied 30M candle closes beyond S/R, then one of three validated continuation paths forms.",
    entry:
      "Do not chase: wait for a second confirming candle, a breakout of the new small range, or fresh S/R after a pullback.",
    management: [
      [
        "stop_loss",
        "Trail below the relevant entry/continuation candle for BUY or above it for SELL.",
      ],
      [
        "take_profit",
        "Manage along the continuation path and next available structure rather than relying only on a fixed target.",
      ],
      [
        "risk",
        "Risk AI must approve the chosen follow-up path; the original extended candle is not an automatic entry.",
      ],
    ],
    invalidation:
      "No entry unless one of the three follow-up paths develops cleanly.",
  }),
  workflow({
    name: "A+ Buy / Sell",
    aliases: ["A+ Buy", "A+ Sell"],
    direction: "Both",
    category: "Clean Momentum",
    quality: "A+",
    session: "Any",
    description:
      "Strong directional leg followed by exactly one weak opposite candle that preserves structure, then a continuation break.",
    pattern:
      "Strong aligned trend leg, one weak opposite-coloured 30M candle, structure intact, and sufficient room to the next HTF zone.",
    entry:
      "Enter after a closed candle breaks the weak counter candle high for BUY or low for SELL.",
    invalidation:
      "Reject if the counter candle breaks structure, price is extended, or entry runs into major HTF opposition.",
  }),
];

function setupKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const canonicalNames = new Map<string, string>();
for (const setup of SETUP_WORKFLOW_CATALOG) {
  canonicalNames.set(setupKey(setup.name), setup.name);
  for (const alias of setup.aliases)
    canonicalNames.set(setupKey(alias), setup.name);
}

export function canonicalTradeSetupName(value: string) {
  return canonicalNames.get(setupKey(value)) ?? value;
}
