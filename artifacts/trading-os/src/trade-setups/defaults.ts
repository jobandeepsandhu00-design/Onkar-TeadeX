import type {
  SetupDirection,
  SetupQuality,
  SetupRuleType,
  TradeSetup,
  TradeSetupRule,
} from "./types";
import {
  canonicalTradeSetupName,
  SETUP_WORKFLOW_CATALOG,
} from "./setup-workflow-catalog";

const LEGACY_DEFAULT_COVER = "/trade-setup-breakout.png";

export const createSetupId = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const slugifySetup = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export function createDefaultTradeSetups(): TradeSetup[] {
  const now = new Date().toISOString();
  return SETUP_WORKFLOW_CATALOG.map((spec, index) => {
    const { name, direction, category, quality } = spec;
    const rules: TradeSetupRule[] = spec.rules.map(
      ([type, content], sortOrder) => ({
        id: createSetupId(),
        type,
        content,
        sortOrder,
      }),
    );
    const rule = (type: SetupRuleType) =>
      rules.find((item) => item.type === type)?.content ?? "";
    const setup: TradeSetup = {
      id: createSetupId(),
      name,
      slug: slugifySetup(name),
      direction,
      category,
      quality,
      description: spec.description,
      timeframe: "M30",
      session: spec.session,
      status: "active",
      isFavorite: index < 4,
      sortOrder: index,
      coverImage: null,
      images: [],
      rules,
      createdAt: now,
      updatedAt: now,
      tags: ["Forex"],
      trend: rule("condition"),
      entry: rule("entry"),
      stop: rule("stop_loss"),
      target: rule("take_profit"),
      midTrade: rule("risk"),
      notes: "",
      checklist: rules
        .filter((item) => item.type === "condition")
        .map((item) => ({ id: item.id, text: item.content, done: false })),
      attachments: [],
      marketBias:
        direction === "Buy"
          ? "Bullish"
          : direction === "Sell"
            ? "Bearish"
            : "Neutral",
      setupType: category,
      exception: Boolean(spec.exception),
      image: null,
      photos: [],
    };
    return setup;
  });
}

function normalizeRule(
  value: unknown,
  type: SetupRuleType,
  index: number,
): TradeSetupRule | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return { id: createSetupId(), type, content: value.trim(), sortOrder: index };
}

export function normalizeTradeSetup(raw: unknown, index = 0): TradeSetup {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    any
  >;
  const direction: SetupDirection =
    source.direction === "Buy" || source.marketBias === "Bullish"
      ? "Buy"
      : source.direction === "Sell" || source.marketBias === "Bearish"
        ? "Sell"
        : "Both";
  const quality: SetupQuality = ["A+", "A", "B", "C"].includes(source.quality)
    ? source.quality
    : String(source.name ?? "").includes("A+")
      ? "A+"
      : "A";
  const legacyRules = [
    normalizeRule(source.trend, "condition", 0),
    normalizeRule(source.entry, "entry", 1),
    normalizeRule(source.stop, "stop_loss", 2),
    normalizeRule(source.target, "take_profit", 3),
    normalizeRule(source.midTrade, "risk", 4),
    normalizeRule(source.notes, "note", 5),
  ].filter((item): item is TradeSetupRule => Boolean(item));
  const checklistRules = Array.isArray(source.checklist)
    ? source.checklist
        .map((item: any, ruleIndex: number) =>
          normalizeRule(
            item?.text,
            "condition",
            legacyRules.length + ruleIndex,
          ),
        )
        .filter(Boolean)
    : [];
  const rules =
    Array.isArray(source.rules) && source.rules.length
      ? source.rules
          .map((item: any, ruleIndex: number) => ({
            id: String(item.id || createSetupId()),
            type: item.type as SetupRuleType,
            content: String(item.content || ""),
            sortOrder: Number.isFinite(item.sortOrder)
              ? item.sortOrder
              : ruleIndex,
          }))
          .filter((item: TradeSetupRule) => item.content.trim())
      : [...legacyRules, ...(checklistRules as TradeSetupRule[])];
  const legacyPhotos = Array.isArray(source.photos) ? source.photos : [];
  const images = (Array.isArray(source.images) ? source.images : legacyPhotos)
    .map((item: any, imageIndex: number) => ({
      id: String(item.id || createSetupId()),
      url: String(item.url || item.dataUrl || ""),
      storagePath: item.storagePath,
      name: item.name,
      mime: item.mime,
      caption: String(item.caption || ""),
      sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : imageIndex,
    }))
    .filter((item: { url: string }) => item.url);
  const sourceCoverUrl = source.coverImage?.url ?? source.image;
  const coverSource =
    sourceCoverUrl && sourceCoverUrl !== LEGACY_DEFAULT_COVER
      ? (source.coverImage ?? {
          id: createSetupId(),
          url: source.image,
          caption: "",
          sortOrder: 0,
        })
      : null;
  const coverImage = coverSource?.url
    ? {
        id: String(coverSource.id || createSetupId()),
        url: String(coverSource.url),
        storagePath: coverSource.storagePath,
        name: coverSource.name,
        mime: coverSource.mime,
        caption: String(coverSource.caption || ""),
        sortOrder: 0,
      }
    : (images[0] ?? null);
  const name = String(source.name || "Untitled Setup");
  const firstRule = (type: SetupRuleType) =>
    rules.find((item) => item.type === type)?.content ?? "";
  return {
    ...source,
    id: String(source.id || createSetupId()),
    name,
    slug: String(source.slug || slugifySetup(name)),
    direction,
    category: String(
      source.category || source.setupType || source.tags?.[0] || "General",
    ),
    quality,
    description: String(source.description || source.trend || ""),
    timeframe: source.timeframe || "M30",
    customTimeframe: source.customTimeframe,
    session: source.session || "London",
    status:
      source.status === "archived" || source.isActive === false
        ? "archived"
        : "active",
    isFavorite: Boolean(source.isFavorite),
    sortOrder: Number.isFinite(source.sortOrder) ? source.sortOrder : index,
    coverImage,
    images,
    rules,
    createdAt: String(
      source.createdAt || source.created_at || new Date().toISOString(),
    ),
    updatedAt: String(
      source.updatedAt || source.updated_at || new Date().toISOString(),
    ),
    tags: Array.isArray(source.tags) ? source.tags : ["Forex"],
    trend: String(source.trend || firstRule("condition")),
    entry: String(source.entry || firstRule("entry")),
    stop: String(source.stop || firstRule("stop_loss")),
    target: String(source.target || firstRule("take_profit")),
    midTrade: String(source.midTrade || firstRule("risk")),
    notes: String(source.notes || firstRule("note")),
    checklist: Array.isArray(source.checklist)
      ? source.checklist
      : rules
          .filter((item) => item.type === "condition")
          .map((item) => ({ id: item.id, text: item.content, done: false })),
    attachments: Array.isArray(source.attachments) ? source.attachments : [],
    marketBias: String(
      source.marketBias ||
        (direction === "Buy"
          ? "Bullish"
          : direction === "Sell"
            ? "Bearish"
            : "Neutral"),
    ),
    setupType: String(source.setupType || source.category || "General"),
    exception: Boolean(source.exception),
    image: coverImage?.url ?? null,
    photos: images.map((item) => ({
      id: item.id,
      url: item.url,
      caption: item.caption,
      storagePath: item.storagePath,
    })),
  } as TradeSetup;
}

export function normalizeTradeSetups(
  raw: unknown[],
  includeMissingDefaults = false,
): TradeSetup[] {
  const normalized = (Array.isArray(raw) ? raw : []).map(normalizeTradeSetup);
  if (!includeMissingDefaults)
    return normalized.sort((a, b) => a.sortOrder - b.sortOrder);
  const existing = new Set(
    normalized.map((item) => canonicalTradeSetupName(item.name).toLowerCase()),
  );
  const additions = createDefaultTradeSetups().filter(
    (item) => !existing.has(canonicalTradeSetupName(item.name).toLowerCase()),
  );
  return [
    ...normalized,
    ...additions.map((item, offset) => ({
      ...item,
      sortOrder: normalized.length + offset,
    })),
  ];
}

export const DEFAULT_TRADING_RULES = [
  "Follow M30/H1 timeframe",
  "Follow current session trend",
  "Be aware of fakeouts",
  "Stop loss below/above recent M15/M30 structure",
  "Long wick = SL at recent high/low when applicable",
  "Secure minimum 25–30 pips according to plan",
  "Avoid trades near H1/H4 zones",
  "Setups must occur during volume time",
  "No trade when SL placement is unreasonable",
  "No trade when candle has just started",
  "Small wick → wait for confirmation",
  "Long wick → evaluate flip/re-break logic",
  "First break → prefer re-break where applicable",
  "Do not chase candles far from S/R",
  "Avoid 4th/5th motion candle entries",
  "Check clean range before entry",
  "Confirm session trend alignment",
  "No volume / small M15-M30 body → wait",
];

export const ENTRY_CHECKLIST = [
  "Trend aligned?",
  "Session aligned?",
  "Clear S/R?",
  "Clean range?",
  "Volume present?",
  "No H1/H4 zone nearby?",
  "Entry candle valid?",
  "Wick acceptable?",
  "SL reasonable?",
  "Can risk be managed?",
  "Price not too extended?",
  "Not the 4th/5th motion candle?",
  "Confirmation completed?",
  "No FOMO?",
];

export const RISK_CARDS = [
  ["+15 pips", "Consider break-even or partial stop protection"],
  ["Price struggling", "Cut 50–75% according to plan"],
  ["Breaks structure then returns", "Cut 50–75% near entry"],
  ["Own low/high breaks", "Cut 75% or exit fully"],
  ["Entered on wick", "Move to break-even when flipped"],
  ["Large wick retraces >50%", "Reduce exposure"],
  ["Price not pushing", "Cut loss according to plan"],
  ["Lower timeframe breaks", "Reduce or exit"],
] as const;
