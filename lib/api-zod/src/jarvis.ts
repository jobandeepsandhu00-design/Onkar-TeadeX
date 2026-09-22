import { z } from "zod";

export const jarvisDestinations = [
  "tradex",
  "onkar",
  "command",
  "scanner",
  "setups",
  "library",
  "knowledge",
  "evolution",
  "simulation",
  "backtests",
  "journal",
  "performance",
  "notifications",
  "settings",
  "risk",
  "connections",
  "charts",
  "trades",
  "news",
] as const;
export type JarvisDestination = (typeof jarvisDestinations)[number];
export const jarvisSettingSchema = z.discriminatedUnion("key", [
  z
    .object({
      key: z.literal("frequencySeconds"),
      value: z.number().int().min(900).max(3600),
    })
    .strict(),
  z
    .object({
      key: z.literal("riskPercent"),
      value: z.number().positive().max(5),
    })
    .strict(),
  z.object({ key: z.literal("automaticAlerts"), value: z.boolean() }).strict(),
  z.object({ key: z.literal("aiAnalysis"), value: z.boolean() }).strict(),
  z
    .object({
      key: z.literal("symbols"),
      value: z
        .array(
          z.enum([
            "XAUUSD",
            "GBPJPY",
            "EURUSD",
            "GBPUSD",
            "USDJPY",
            "EURJPY",
            "AUDUSD",
            "USDCAD",
            "NZDUSD",
            "EURGBP",
          ]),
        )
        .min(1)
        .max(10),
    })
    .strict(),
]);
export const jarvisActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STATUS") }).strict(),
  z.object({ kind: z.literal("SAFE_PAUSE") }).strict(),
  z.object({ kind: z.literal("RESUME_ANALYSIS") }).strict(),
  z.object({ kind: z.literal("DISABLE_AUTO") }).strict(),
  z
    .object({ kind: z.literal("SETTING"), setting: jarvisSettingSchema })
    .strict(),
  z.object({ kind: z.literal("LEARN_LIBRARY") }).strict(),
]);
export type JarvisAction = z.infer<typeof jarvisActionSchema>;
export const jarvisRequestSchema = z
  .object({ requestId: z.string().uuid(), action: jarvisActionSchema })
  .strict();
export const jarvisDecisionSchema = z
  .object({ decision: z.enum(["CONFIRM", "CANCEL"]), nonce: z.string().uuid() })
  .strict();
export type JarvisResult = {
  id: string;
  state:
    | "AWAITING_CONFIRMATION"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELED"
    | "EXPIRED"
    | "UNKNOWN";
  message: string;
  nonce?: string;
  expiresAt?: string;
  before?: unknown;
  after?: unknown;
  observedAt?: string;
};
export type JarvisIntent =
  | { kind: "NAVIGATE"; destination: JarvisDestination }
  | {
      kind: "CHART";
      symbol?: string;
      timeframe?: "15m" | "30m" | "1h" | "4h";
      zoom?: "in" | "out" | "reset";
    }
  | {
      kind: "LOCAL";
      action: "STOP_SPEECH" | "MIC_OFF" | "SLEEP" | "WAKE" | "CANCEL" | "BACK";
      volume?: number;
    }
  | { kind: "VOLUME"; value: number }
  | { kind: "COMMAND"; action: JarvisAction }
  | { kind: "CLARIFY"; message: string }
  | { kind: "QUESTION"; question: string };

// This parser never turns LLM output into actions. Exact, bounded commands only.
export function normalizeJarvisSpeech(value: string) {
  return value
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/x\s*a\s*u\s*[/ ]?\s*u\s*s\s*d|xau\/usd|gold/g, "xauusd")
    .replace(/gbp\/jpy|pound[ -]yen/g, "gbpjpy")
    .replace(/zero point five/g, "0.5")
    .replace(/thirty minutes?|thirty minute/g, "30m")
    .replace(/fifteen minutes?|fifteen minute/g, "15m")
    .replace(/four hours?|four hour/g, "4h")
    .replace(/one hours?|one hour/g, "1h")
    .replace(/forty percent/g, "40 percent")
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function stripJarvisWake(text: string, allowJar = false): string | null {
  const match = text
    .trim()
    .match(
      allowJar
        ? /^(?:hey\s+)?(?:jarvis|jar)\b[\s,:.-]*(.*)$/i
        : /^(?:hey\s+)?jarvis\b[\s,:.-]*(.*)$/i,
    );
  return match ? match[1] : null;
}
export function parseJarvisIntent(input: string): JarvisIntent {
  const q = normalizeJarvisSpeech(stripJarvisWake(input) ?? input);
  if (
    /\b(don't|do not|never|cancel|no stop)\b/.test(q) ||
    /^(no|no thanks)$/.test(q)
  )
    return { kind: "LOCAL", action: "CANCEL" };
  if (/^(stop speaking|be quiet|quiet|wait|stop talking)$/.test(q))
    return { kind: "LOCAL", action: "STOP_SPEECH" };
  if (/^(turn off (the )?(microphone|mic)|microphone off|mic off)$/.test(q))
    return { kind: "LOCAL", action: "MIC_OFF" };
  if (/^(go to sleep|sleep)$/.test(q))
    return { kind: "LOCAL", action: "SLEEP" };
  if (/^(wake up|hello)$/.test(q)) return { kind: "LOCAL", action: "WAKE" };
  if (/^(go back|back)$/.test(q)) return { kind: "LOCAL", action: "BACK" };
  if (
    /^(turn off (the )?system|stop trading|emergency (stop|pause)|pause (the )?(system|scanner|trading))$/.test(
      q,
    )
  )
    return { kind: "COMMAND", action: { kind: "SAFE_PAUSE" } };
  if (
    /^(turn (the )?system back on|resume (the )?(system|scanner|analysis)|start (the )?scanner)$/.test(
      q,
    )
  )
    return { kind: "COMMAND", action: { kind: "RESUME_ANALYSIS" } };
  if (/^(disable|turn off) (auto|automatic) (execution|trading)$/.test(q))
    return { kind: "COMMAND", action: { kind: "DISABLE_AUTO" } };
  if (
    /^(read|show|what are) (my |the )?(scanner settings|system status|scanner status)$/.test(
      q,
    )
  )
    return { kind: "COMMAND", action: { kind: "STATUS" } };
  if (
    /^(learn|process|sync|synchronize) (my |the )?(library|new videos)$/.test(q)
  )
    return { kind: "COMMAND", action: { kind: "LEARN_LIBRARY" } };
  const volume = q.match(
    /^(?:set )?(?:voice )?volume (?:to )?(\d{1,3})(?: percent|%)?$/,
  );
  if (volume && Number(volume[1]) <= 100)
    return { kind: "VOLUME", value: Number(volume[1]) / 100 };
  const frequency = q.match(
    /^(?:set |change )?(?:api|scanner)(?: calls?| interval| schedule)? (?:to |every )?(\d+) (?:minutes?|min)$/,
  );
  if (frequency) {
    const value = Number(frequency[1]) * 60;
    return value >= 900 && value <= 3600
      ? {
          kind: "COMMAND",
          action: {
            kind: "SETTING",
            setting: { key: "frequencySeconds", value },
          },
        }
      : {
          kind: "CLARIFY",
          message:
            "Choose 15–60 minutes. The shared Twelve Data minimum remains 15 minutes.",
        };
  }
  const risk = q.match(
    /^(?:set |change )?risk(?: per trade)? (?:to )?(\d+(?:\.\d+)?)\s*(?:percent|%)$/,
  );
  if (risk) {
    const value = Number(risk[1]);
    return value > 0 && value <= 5
      ? {
          kind: "COMMAND",
          action: { kind: "SETTING", setting: { key: "riskPercent", value } },
        }
      : {
          kind: "CLARIFY",
          message:
            "Risk must be greater than 0 and at most 5 percent. Existing account limits still apply.",
        };
  }
  const toggle = q.match(
    /^(enable|disable|turn on|turn off) (alerts|ai analysis)$/,
  );
  if (toggle)
    return {
      kind: "COMMAND",
      action: {
        kind: "SETTING",
        setting: {
          key: toggle[2] === "alerts" ? "automaticAlerts" : "aiAnalysis",
          value: ["enable", "turn on"].includes(toggle[1]),
        },
      },
    };
  if (/^show only xauusd and gbpjpy$/.test(q))
    return {
      kind: "COMMAND",
      action: {
        kind: "SETTING",
        setting: { key: "symbols", value: ["XAUUSD", "GBPJPY"] },
      },
    };
  const destinations: Array<[RegExp, JarvisDestination]> = [
    [/^(?:the )?(?:onkar )?tradex(?: dashboard)?$/, "tradex"],
    [/^(?:onkar ai(?: dashboard)?|home|onkar home)$/, "onkar"],
    [/^(?:ai )?command cent(?:er|re)$/, "command"],
    [/^(?:market )?scanner$/, "scanner"],
    [/^(?:setup library|setups)$/, "setups"],
    [/^(?:media library|videos|library|upload video)$/, "library"],
    [/^knowledge(?: cent(?:er|re))?$/, "knowledge"],
    [/^(?:evolution|improvement)(?: lab)?$/, "evolution"],
    [/^simulation(?: lab)?$/, "simulation"],
    [/^backtests?|backtesting$/, "backtests"],
    [/^(?:trading )?journal$/, "journal"],
    [/^(?:performance|analytics)$/, "performance"],
    [/^(?:notifications|alerts)$/, "notifications"],
    [/^settings$/, "settings"],
    [/^risk(?: management)?$/, "risk"],
    [/^(?:connections|integrations)$/, "connections"],
    [/^(?:my )?active trades$/, "trades"],
    [/^news$/, "news"],
    [/^charts?$/, "charts"],
  ];
  const nav = q.replace(/^(?:open|go to|show|take me to) (?:the )?/, "");
  for (const [match, destination] of destinations)
    if (match.test(nav)) return { kind: "NAVIGATE", destination };
  if (/^(zoom in|zoom out|reset chart)$/.test(q))
    return {
      kind: "CHART",
      zoom: q === "zoom in" ? "in" : q === "zoom out" ? "out" : "reset",
    };
  const chart = q.match(
    /^(?:show|open|switch to) (?:(xauusd|gbpjpy|eurusd|gbpusd|usdjpy)(?: chart)?(?: on| at)?\s*)?(15m|30m|1h|4h|15 minutes?|30 minutes?|1 hour|4 hours)?(?: chart)?$/,
  );
  if (chart && (chart[1] || chart[2])) {
    const tf = chart[2]?.replace(/ minutes?/, "m").replace(/ hours?/, "h") as
      | "15m"
      | "30m"
      | "1h"
      | "4h"
      | undefined;
    return { kind: "CHART", symbol: chart[1]?.toUpperCase(), timeframe: tf };
  }
  if (/^(yes|confirm|do it|okay|ok)$/.test(q))
    return {
      kind: "CLARIFY",
      message:
        "Review the exact pending action and use its on-screen Confirm button. A generic yes cannot authorize changes.",
    };
  if (
    /\b(buy|sell|close|delete|remove|move|modify|execute|enable|disable|set|change|start|run|upload|create|save|approve|promote|rollback)\b/.test(
      q,
    ) &&
    !/^(why|what|how|explain|when|which)\b/.test(q)
  )
    return {
      kind: "CLARIFY",
      message:
        "I cannot safely execute that command from this phrase. Open the relevant trade, setup, simulation or settings screen to select exact targets and use its protected controls. No action has been taken.",
    };
  return { kind: "QUESTION", question: input.trim().slice(0, 1000) };
}
