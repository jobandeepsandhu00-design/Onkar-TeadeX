import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Home, BookOpen, Layers, GraduationCap, Search, Plus, X, TrendingUp, TrendingDown,
  Target, Percent, BarChart3, Calendar, Tag, ChevronDown, ChevronRight, Trash2, Pencil,
  Upload, Image as ImageIcon, FileText, Crown, AlertTriangle, CheckCircle2, ListChecks,
  BookMarked, Brain, ShieldAlert, Download, RotateCcw, Filter, Paperclip, ChevronUp,
  ChevronLeft, MoreHorizontal, Wallet, ClipboardList, ArrowLeft, Copy, Check, Sparkles,
  Trophy, Flame, Gauge, DollarSign, Smile, Zap, AlertCircle, CalendarDays, Activity, Calculator
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
} from "recharts";
import { storage } from "./api";
import CsvImportModal from "./CsvImport";
import PerformanceReport from "./PerformanceReport";

/* ============================================================
   UTILITIES
   ============================================================ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cx = (...a) => a.filter(Boolean).join(" ");
const fmt2 = (n) => (n === null || n === undefined || isNaN(n) ? "—" : n.toFixed(2));
const fmtPct = (n) => (n === null || n === undefined || isNaN(n) ? "—" : n.toFixed(1) + "%");
const fmtSigned = (n, suffix = "") =>
  n === null || n === undefined || isNaN(n) ? "—" : (n > 0 ? "+" : "") + n.toFixed(2) + suffix;

// Currency-aware formatters (use account.currency prefix)
const fmtBal = (n, cur = "€") => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const s = abs >= 1000 ? abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
  return (n < 0 ? "-" : "") + cur + s;
};
const fmtBalSigned = (n, cur = "€") => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const s = abs >= 1000 ? abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
  return (n >= 0 ? "+" : "-") + cur + s;
};
const CURRENCIES = [
  { symbol: "€", label: "EUR — Euro" },
  { symbol: "$", label: "USD — US Dollar" },
  { symbol: "£", label: "GBP — British Pound" },
  { symbol: "¥", label: "JPY — Japanese Yen" },
  { symbol: "A$", label: "AUD — Australian Dollar" },
  { symbol: "NZ$", label: "NZD — New Zealand Dollar" },
  { symbol: "C$", label: "CAD — Canadian Dollar" },
  { symbol: "CHF", label: "CHF — Swiss Franc" },
];
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (dateStr) => (dateStr ? dateStr.slice(0, 7) : "unknown");
const monthLabel = (key) => {
  if (key === "unknown") return "—";
  const [y, m] = key.split("-");
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
};

function toDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatMinutes(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return "—";
  const totalMin = Math.round(mins);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const rem = totalMin % 60;
  if (hours < 24) return `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

function computeTrade(t) {
  const dir = t.side === "Sell" ? -1 : 1;
  const entry = parseFloat(t.entry);
  const exit = parseFloat(t.exit);
  const sl = parseFloat(t.sl);
  const tp = parseFloat(t.tp);
  const size = parseFloat(t.positionSize) || 1;
  let pnl = null, rMultiple = null, plannedRR = null, result = null, pctMove = null;
  const riskPerUnit = !isNaN(entry) && !isNaN(sl) ? Math.abs(entry - sl) : null;
  if (!isNaN(entry) && !isNaN(tp) && riskPerUnit) {
    plannedRR = Math.abs(tp - entry) / riskPerUnit;
  }
  if (!isNaN(entry) && !isNaN(exit)) {
    pnl = (exit - entry) * dir * size;
    if (riskPerUnit) rMultiple = ((exit - entry) * dir) / riskPerUnit;
    if (entry !== 0) pctMove = ((exit - entry) / Math.abs(entry)) * dir * 100;
    if (pnl > 0.0000001) result = "Win";
    else if (pnl < -0.0000001) result = "Loss";
    else result = "Breakeven";
  }
  const fees = (parseFloat(t.fees) || 0) + (parseFloat(t.commission) || 0);
  const netPnl = pnl === null ? null : pnl - fees;

  let holdMinutes = null;
  if (t.entryTime && t.exitTime && t.date) {
    const exitDateStr = t.exitDate && t.exitDate.trim() ? t.exitDate : t.date;
    const entryDt = toDateTime(t.date, t.entryTime);
    const exitDt = toDateTime(exitDateStr, t.exitTime);
    if (entryDt && exitDt && exitDt >= entryDt) holdMinutes = (exitDt - entryDt) / 60000;
  }

  return { pnl, rMultiple, plannedRR, result, pctMove, fees, netPnl, holdMinutes };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   SEED DATA — Smart Raja Concepts (SRC) Price Action System
   ============================================================ */

const STANDARD_TEMPLATE = {
  entry: "On the next candle's flip, or a break of the previous candle's high/low, once the qualifying wick or pattern has formed.",
  stop: "Below the entry candle for buys; above the entry candle for sells.",
  target: "Secure roughly 90% of a 25–30 pip target (adjust slightly for current volatility). Move to break-even once price breaks the previous high/low, or once the trade is 10–15 pips in profit.",
  midTrade: "If the entry candle re-flips against you, cut 75% of the position. If your own structural low/high breaks, cut the full position."
};

const CHECKLIST_MASTER = [
  { group: "Risk & Stop-Loss", text: "Is the stop-loss reasonable, and can you actually manage that risk?" },
  { group: "Risk & Stop-Loss", text: "Is the stop-loss placement too far away? If so — no trade." },
  { group: "Risk & Stop-Loss", text: "Does the wick represent more than a 50% retracement of the move? If so — no trade." },
  { group: "Candle & Wick", text: "Has the candle only just started (1–2 minutes old)? If so, don't enter yet." },
  { group: "Candle & Wick", text: "Small wick? Wait for a confirmed break of the previous candle's high or low before entering." },
  { group: "Candle & Wick", text: "Long wick? Enter on the flip." },
  { group: "Candle & Wick", text: "Long wick that has already broken the previous low/high? Re-flip with the trend; enter on the re-break." },
  { group: "Candle & Wick", text: "On a first break, wait — enter on the re-break, not the first touch." },
  { group: "Candle & Wick", text: "Has a wick of at least 10–15 pips already formed?" },
  { group: "Candle & Wick", text: "Has the candle closed far from the relevant S/R with no retracement? If so, no trade — wait for an A+ or pullback setup." },
  { group: "Context & Confirmation", text: "If entering on a wick, does it align with the current session's volume and trend?" },
  { group: "Context & Confirmation", text: "Never enter on a wick that runs against the prevailing trend/volume." },
  { group: "Context & Confirmation", text: "No wick at all, just a clean high/low break? Place the stop at the current high/low." },
  { group: "Context & Confirmation", text: "Does the higher timeframe (30m/1H) trend match your entry direction — and does the session trend align too?" },
  { group: "Timing & Structure", text: "Second half of a 30-minute candle with no wick on the 15-minute? Fine — trade with half the normal risk." },
  { group: "Timing & Structure", text: "Has price already pushed as far as it reasonably can (~150 pips)? Wait for a pullback rather than chasing." },
  { group: "Timing & Structure", text: "Is the entry candle the 4th or 5th candle in the current move? If so — no trade, likely exhausted." },
  { group: "Timing & Structure", text: "Is a 1H or 4H zone/level nearby? If so — no trade." },
  { group: "Timing & Structure", text: "Has price left a clean range with at least ~40 pips of room? Did the breakout candle close clearly beyond the level?" },
  { group: "Timing & Structure", text: "Is there real volume behind the move (good 15m/30m closes)?" },
];

function makeSetup(name, trend, entry, tags, checklist, opts = {}) {
  return {
    id: uid(),
    name,
    tags,
    trend,
    entry,
    stop: opts.stop || STANDARD_TEMPLATE.stop,
    target: opts.target || STANDARD_TEMPLATE.target,
    midTrade: opts.midTrade || STANDARD_TEMPLATE.midTrade,
    exception: !!opts.exception,
    checklist: checklist.map((c) => ({ id: uid(), text: c, done: false })),
    notes: "",
    attachments: [],
  };
}

function seedSetups() {
  return [
    makeSetup(
      "Wickfill in Range",
      "Inside an established range (not breaking out).",
      "Scenario A — 'wick in the middle': a wick prints roughly mid-range; enter on the next candle's flip. Scenario B — 'wick rejected': the wick is rejected directly off the S/R line; wait for a second candle to confirm buy/sell volume before entering.",
      ["Forex"],
      [
        "Confirm price is inside an established range, not breaking out",
        "Scenario A: enter on the next candle's flip after a mid-range wick",
        "Scenario B: wait for a 2nd confirming candle after rejection at the S/R line",
      ],
      { target: "EXCEPTION to the standard template — target the wickfill itself, not a fixed 25–30 pip target.", exception: true }
    ),
    makeSetup(
      "Breakout A+",
      "A clean approach (no recent opposing wick) into the level.",
      "A weak/small-bodied close just beyond resistance (buys) or support (sells); enter on the next candle breaking the entry candle's high/low.",
      ["Forex"],
      [
        "No recent opposing wick on the approach into the level",
        "Weak/small-bodied close just beyond the level",
        "Enter on the next candle breaking that candle's high/low",
      ]
    ),
    makeSetup(
      "Breakout Impulse",
      "Same pattern as Breakout A+, valid only during a recognized high-volume window (\"Only Vol Time\").",
      "A weak close right at the level followed by a strong push through it.",
      ["Forex"],
      [
        "Only valid inside a recognized high-volume window (Vol Time)",
        "Weak close at the level, then a strong push through it",
        "Skip if the push doesn't show real volume behind it",
      ]
    ),
    makeSetup(
      "Breakout Small Body",
      "The candle that closes beyond the level has an unusually small body.",
      "Entry triggers on the next candle breaking that small candle's high/low.",
      ["Forex"],
      [
        "Breakout candle's body is unusually small",
        "Enter on the next candle breaking that small candle's high/low",
        "Check no 1H/4H zone sits just beyond — skip if so",
      ]
    ),
    makeSetup(
      "Breakout Wickfill",
      "The breakout candle closes beyond the level but leaves a large wick behind it (a partial rejection).",
      "Enter on the next candle flipping back in the breakout direction after that wick.",
      ["Forex"],
      [
        "Breakout candle leaves a large rejection wick behind it",
        "Wait for the next candle to flip back in the breakout direction",
        "Treat the rejection wick as part of your risk picture",
      ]
    ),
    makeSetup(
      "Fakeout at S/R",
      "Price tests a support/resistance, briefly pushes through, then closes back inside the range with a body clearly stronger than the prior opposing candle.",
      "Trade the reversal on the next candle's flip or break.",
      ["Forex"],
      [
        "Price pushed through the level, then closed back inside the range",
        "Reversal body is clearly stronger than the breakout candle",
        "Only valid if the close lands back near the level, not mid-range",
      ]
    ),
    makeSetup(
      "Pullback, S/R Formed",
      "Trend pulls back to retest a prior support/resistance.",
      "Once a fresh micro-support (uptrend) or micro-resistance (downtrend) prints at the retest, enter on the next candle's flip in the trend direction.",
      ["Forex"],
      [
        "Trend pulls back to retest a prior support/resistance",
        "A fresh micro-S/R prints at the retest",
        "Enter on the next candle's flip in the original trend direction",
      ]
    ),
    makeSetup(
      "Pullback Impulse A+ (with S/R)",
      "A pullback that also leaves a minor support/resistance (a weak counter-close) at the retest.",
      "Combines impulse logic with a confirmed minor level for extra confluence.",
      ["Forex"],
      [
        "Pullback leaves a minor S/R (weak counter-close) at the retest",
        "Confluence of impulse logic + a confirmed minor level",
        "Prefer this over the no-S/R variant when both are present",
      ]
    ),
    makeSetup(
      "Pullback Impulse (without S/R)",
      "Same impulse logic as above, but the retest candle only shows a weak body and exhaustion wick rather than a clean minor S/R.",
      "A slightly lower-confidence version of the setup above.",
      ["Forex"],
      [
        "Retest candle shows only a weak body + exhaustion wick",
        "No clean minor S/R formed — lower-confidence version",
        "Consider reduced size given the lower confluence",
      ]
    ),
    makeSetup(
      "Pullback Wickfill",
      "The retest candle leaves a large wick rather than a clean small-bodied close.",
      "Treat the wick itself as the support/resistance and enter on the next candle's flip.",
      ["Forex"],
      [
        "Retest candle leaves a large wick, not a clean small body",
        "Treat the wick itself as the support/resistance",
        "Enter on the next candle's flip",
      ]
    ),
    makeSetup(
      "S/R Buy / Sell",
      "The simplest version: a fresh support forms at an existing support (uptrend), or a fresh resistance forms at an existing resistance (downtrend).",
      "Enter with the trend on confirmation.",
      ["Forex"],
      [
        "Fresh support/resistance forms at an existing level, in the trend direction",
        "Enter with the trend on confirmation",
        "Highest-frequency, simplest setup in the library",
      ]
    ),
    makeSetup(
      "S/R Impulse",
      "Same context as S/R Buy/Sell, but the confirming candle at the level shows a weak body with an exhaustion wick.",
      "Trade the reaction at the level once the exhaustion wick prints, rather than waiting for a clean reversal candle.",
      ["Forex"],
      [
        "Same context as S/R Buy/Sell",
        "Confirming candle shows a weak body + exhaustion wick, not a clean reversal candle",
        "Real volume behind the wick is required",
      ]
    ),
    makeSetup(
      "Counter Buy / Sell",
      "Reserved for counter-trend trades: wait for a fresh support and resistance to both form.",
      "Trade the breakout of the level opposing the prevailing trend — specifically when the trend's own volume is visibly dying (it failed to break its own most recent S/R).",
      ["Forex"],
      [
        "Reserved for counter-trend trades only — the exception, not the rule",
        "Wait for a fresh support AND resistance to both form first",
        "Only valid when the prevailing trend's volume is visibly dying",
      ]
    ),
    makeSetup(
      "Defended Breakout",
      "A resistance (or support) is tested and defended multiple times before a decisive close finally breaks and closes beyond it.",
      "The repeated defense adds confidence to the eventual break.",
      ["Forex"],
      [
        "Level is tested and defended multiple times first",
        "A decisive close finally breaks and closes beyond it",
        "More repeated defenses = more confidence in the eventual break",
      ]
    ),
    makeSetup(
      "Breakout Big Body",
      "The breakout candle itself has an unusually large body — a strong, decisive close beyond the level.",
      "Manage with a trailing stop rather than a fixed stop, since momentum is strong.",
      ["Forex"],
      [
        "Breakout candle has an unusually large, decisive body",
        "Use a trailing stop below/above the entry candle, not a fixed stop",
        "Don't cap the trade early — momentum is strong here",
      ],
      { stop: "EXCEPTION to the standard template — use a trailing stop below the entry candle for buys (above for sells) rather than a fixed stop, since momentum is strong.", exception: true }
    ),
    makeSetup(
      "A+ Buy / Sell",
      "A strong, clean trend leg into a level, immediately followed by one weak counter-colored candle.",
      "Enter on the break of that weak candle's high/low in the original trend direction.",
      ["Forex"],
      [
        "Strong, clean trend leg into the level",
        "Immediately followed by one weak counter-colored candle",
        "Enter on the break of that weak candle's high/low, in the trend direction",
      ]
    ),
    makeSetup(
      "Big-Body Breakout — 3-Scenario Framework",
      "When an extended, large-bodied breakout candle prints clear of a level, three follow-up scenarios are anticipated.",
      "Scenario A — A+ Setup: wait for a 2nd candle close confirming the breakout. Scenario B — Range Breakout: wait for consolidation, then trade the breakout of that new range. Scenario C — Pullback Buy/Sell: wait for a fresh S/R to form on the pullback.",
      ["Forex", "Framework"],
      [
        "Scenario A: wait for a second candle to close, confirming the breakout",
        "Scenario B: wait for consolidation, then trade the new range's breakout",
        "Scenario C: wait for a fresh support/resistance to form on the pullback",
      ]
    ),
    makeSetup(
      "Playbook After Extended Push (200+ pips)",
      "After price has pushed roughly 200+ pips in one direction on strong, full-bodied HTF candles.",
      "Don't chase a fresh entry in the move's direction once a counter-level has formed. Wait for both a support and a resistance to print, then watch which side breaks.",
      ["Forex", "Framework"],
      [
        "Don't chase a fresh entry once a counter-level has formed against the push",
        "Wait for both a support and a resistance to print first",
        "Counter trade if the new range breaks counter-direction; pullback-continuation trade if the original direction resumes after",
      ]
    ),
  ];
}

function seedStrategies() {
  return [
    {
      id: uid(), name: "London Breakout",
      description: "Trades the volatility expansion around the London Open by waiting for a breakout setup to confirm during the highest-volume window of the European session.",
      marketType: "Forex", timeframe: "15m – 1H",
      entryConditions: "Wait for a Breakout A+, Breakout Impulse, or Defended Breakout setup to confirm during the London Open window (≈3:00–4:30am EST). Require a real range of 20+ pips and a confirmed candle-close beyond the level.",
      exitConditions: "Standard management template — secure ~90% of a 25–30 pip target, move to break-even at 10–15 pips in profit or on break of the previous high/low.",
      riskRules: "1% static risk per trade, 2% daily ceiling. Cut 75% on a re-flip against you; cut the full position if your own structural level breaks.",
      notes: "Example starter strategy — edit freely. Pairs well with the Session Windows reference in the Price Action Academy.",
      attachments: [],
    },
    {
      id: uid(), name: "Smart Money Strategy",
      description: "Combines SRC market-structure read (HH/HL, break-and-retest) with Smart Money Concepts order-flow ideas — liquidity sweeps, BOS/CHOCH, and order block or FVG retests.",
      marketType: "Forex / Crypto", timeframe: "HTF bias (4H/1H) → LTF entries (15m/5m)",
      entryConditions: "Mark HTF trend and the last BOS/CHOCH. Wait for a liquidity sweep beyond a recent high/low, then a retest of the resulting order block or fair value gap in the direction of the new structure.",
      exitConditions: "Target the opposing liquidity pool or the edge of the premium/discount zone. Move to break-even once the entry-timeframe structure confirms in your favor.",
      riskRules: "1% static risk, or dynamic risk split 0.5% + 0.5% once the first add is at break-even.",
      notes: "Example starter strategy — edit freely. See the Smart Money Concepts Academy tab for term definitions.",
      attachments: [],
    },
    {
      id: uid(), name: "Swing Trading Strategy",
      description: "Lower-frequency approach trading pullbacks into higher-timeframe support/resistance, aligned with the Daily trend, holding positions over several days.",
      marketType: "Forex / Stocks", timeframe: "4H / Daily",
      entryConditions: "Daily trend is clearly up or down (HH/HL or LL/LH). Wait for a Pullback, S/R Formed setup on the 4H at a Daily-level zone.",
      exitConditions: "Target the next major HTF S/R level rather than a fixed pip count; trail the stop behind new structure as the move develops.",
      riskRules: "1% static risk per trade. Wider stops are acceptable given the longer hold — size down accordingly.",
      notes: "Example starter strategy — edit freely.",
      attachments: [],
    },
    {
      id: uid(), name: "Scalping Strategy",
      description: "High-frequency approach trading Wickfill and Impulse setups inside the first hour of a session open, in and out within minutes.",
      marketType: "Forex", timeframe: "1m – 5m",
      entryConditions: "Only during a recognized Vol Time window. Trade Wickfill in Range or Breakout Impulse setups exclusively; skip everything outside the open.",
      exitConditions: "Quick partial at 10–15 pips, move remainder to break-even immediately. Full exit well before the session's volume fades.",
      riskRules: "Reduced size (~0.5% per trade) given the speed and frequency of entries.",
      notes: "Example starter strategy — edit freely.",
      attachments: [],
    },
  ];
}

function seedPlans() {
  return {
    master: {
      goals: "Consistency over months, not days. Protect capital before chasing profit. Treat trading as a business with a daily risk budget.",
      monthlyTarget: "20%",
      weeklyTarget: "7%",
      dailyTarget: "2%",
      maxRiskPerTrade: "1% per trade (2% absolute ceiling)",
      maxDailyLoss: "3%",
      maxWeeklyLoss: "",
      focusPairs: "XAUUSD, GBPJPY",
      sessions: "Pre London | London",
      preLondonTime: "6:30am – 9:30am UK / 7pm – 10pm NZT",
      londonTime: "8:00am – 12:00pm UK / 9pm – 1am NZT",
    },
    custom: [
      {
        id: uid(),
        name: "Forex Trading Plan (SRC Starter Template)",
        marketConditions: "Trade only during recognized high-volume windows: Pre-London (6:30–9:30am UK) and London Open (8:00am–12:00pm UK). Confirm the 30m/1H+ trend before entering.",
        entryRules: "Use a setup from the Setup Library. Require: a real S/R zone, a range of at least 20–25 pips, a confirmed candle close, and a recognized volume window.",
        exitRules: "Secure ~90% of a 25–30 pip target. Move to break-even at 10–15 pips in profit or on a break of the previous high/low.",
        riskRules: "1% static risk per trade (3% daily ceiling). Cut 50–75% on adverse structure breaks per the in-trade risk rules.",
        psychologyRules: "No new trade within one full candle of taking a loss. Journal every trade. Review losses by asking how the trade looks from the other side.",
        attachments: [],
      },
    ],
  };
}

function seedSMC() {
  const t = (term, definition) => ({ id: uid(), term, definition, notes: "", attachments: [] });
  return [
    t("Liquidity", "Areas where stop-losses and pending orders cluster — typically just above old swing highs or just below old swing lows. These pools act as a magnet that price is often drawn toward."),
    t("Liquidity Sweeps", "A fast move that pushes through one of those liquidity pools — triggering the resting stops and orders — before reversing back in the original direction."),
    t("Break of Structure (BOS)", "A candle close beyond a prior swing high or low in the direction of the existing trend, confirming that the trend is continuing."),
    t("Change of Character (CHOCH)", "The first break of structure in the opposite direction of the prevailing trend — an early signal that a reversal may be developing."),
    t("Order Blocks", "The last down-close (or up-close) candle before a strong impulsive move — viewed as the footprint of institutional buying or selling, and a zone price often returns to before continuing."),
    t("Fair Value Gaps (FVG)", "A three-candle imbalance where the wick of the first candle and the wick of the third candle don't overlap, leaving a gap in price that the market often returns to 'fill.'"),
    t("Mitigation Blocks", "A zone where price returns to mitigate (partially offset) unfilled institutional orders left behind by a failed move — similar to an order block, but formed after a stop-out rather than a clean impulse."),
    t("Premium & Discount Zones", "Dividing a trading range at its midpoint (50%): the upper half is 'premium' (a favorable area to look for sells), the lower half is 'discount' (a favorable area to look for buys)."),
    t("Market Structure Shift (MSS)", "A break of structure that signals a shift in the higher-timeframe trend itself — often used alongside CHOCH as the trigger for trading the new direction."),
  ];
}

function seedVault() {
  const n = (title, folder, body) => ({ id: uid(), title, folder, body, attachments: [] });
  return [
    n(
      "Glossary of Terms",
      "Price Action",
      "HTF / LTF — Higher timeframe / lower timeframe.\n\nHH / HL / LL / LH — Higher high / higher low / lower low / lower high — the building blocks of trend.\n\nS/R — Support / resistance.\n\nWickfill — The filling-in of a candle's wick by subsequent price action, typically occurring on momentum and volume.\n\nBOPCH / BOPCL — Break of previous candle high / break of previous candle low.\n\nBE — Break-even — moving the stop-loss to the entry price once a trade is sufficiently in profit or confirmed.\n\nM.Risk — The mid-trade risk-management rule applied to a setup (e.g., cutting size on a reflip, or exiting fully on an own-structure break).\n\nA+ setup — A high-quality, 'textbook' version of a given setup with strong confluence.\n\nReflip — Price breaking back through the entry level against your position before (potentially) resuming in your favor.\n\nVol Time — A recognized high-volume trading window (a session open or overlap) required for certain higher-risk setup types.\n\nStatic Risk — A fixed percentage of the account risked on a single position.\n\nDynamic Risk — The same total risk split across two or more entries on the same trade idea, added as the trade develops."
    ),
    n(
      "Session Windows Reference",
      "Price Action",
      "All times Eastern (EST), approximate — treat as a volume guide, not a hard cutoff. Adjust for daylight-saving shifts.\n\nPre-Asian — 6:00–6:30pm to 8pm\nAsian — 8–9pm to 10pm\nPre-London — 1:00–1:30am to 3am\nLondon Open — 3am to 4:30am\nLondon Close — 10am to 11:30am\nPre-NY — 5:30am to 8am\nNY Open / NY-London Overlap — 8am to 10–11:30am\n\nLarge, tradable candles tend to form during London Open and NY Open. Candles printed outside the main sessions tend to be smaller and less reliable."
    ),
    n(
      "Pre-Entry Checklist (Master)",
      "Setups",
      CHECKLIST_MASTER.map((c) => `[${c.group}] ${c.text}`).join("\n\n")
    ),
    n(
      "General Trading Rules",
      "Risk Management",
      "Only trade off the 30-minute / 1-hour timeframes.\nFollow the current session's trend.\nStay alert for fakeouts running against the current session trend.\nKeep the stop-loss below/above the previous 30-minute or 15-minute candle, or the most recent swing high/low.\nIf the entry candle's wick is long, anchor the stop to the most recent swing low/high instead of the entry candle itself.\nTake-profit should always secure a minimum of 25–30 pips, then move to break-even.\nEven if the stop-loss ends up wider than 40 pips, the take-profit should still secure at least 25 pips (roughly 75–90% of the planned target).\nIf a 1-hour or 4-hour zone is nearby, don't take the trade.\n\nRecognized entry types — all must occur within a high-volume window, no exceptions:\nCounter Buy/Sell · Impulse Breakout Buy/Sell · Complete Breakout Buy/Sell (high-volume time only) · S/R-formed-at-S/R Buy/Sell (with trend) · Wickfill (follow trend/volume) · Impulse Buy/Sell ('A+', high-volume time only) · Pullback Buy/Sell (S/R formed) · Fakeout Buy/Sell (follow trend)."
    ),
    n(
      "Standard Setup Management Template",
      "Setups",
      `Entry — ${STANDARD_TEMPLATE.entry}\n\nStop-loss — ${STANDARD_TEMPLATE.stop}\n\nTake-profit — ${STANDARD_TEMPLATE.target}\n\nMid-trade risk rule — ${STANDARD_TEMPLATE.midTrade}\n\nApplies to nearly every named setup in the library, except Wickfill in Range (target = the wickfill itself) and Breakout Big Body (stop = trailing stop).`
    ),
  ];
}

/* ---- Price Action Academy long-form modules ---- */
const ACADEMY_MODULES = [
  {
    id: "overview", title: "1. Overview & Trading Philosophy", icon: "Sparkles",
    blocks: [
      { p: "This guide consolidates a complete price-action trading system: the underlying market-structure concepts, the full risk-management framework, the pre-entry checklist, and the named library of entry setups used to trade support, resistance, breakouts, pullbacks, and counter-trend moves." },
      { h: "Five non-negotiable ideas" },
      { ul: [
        "Give it real time — plan on at least six months of consistent screen time before expecting reliable results. Price action is learned by pattern repetition, not by reading rules once.",
        "Trade probability, not prediction — every setup is a higher-probability scenario, not a certainty. No setup works 100% of the time.",
        "Protect capital before chasing profit — position sizing and cutting losses early matter more than any single winning trade.",
        "Default to trading with the trend — counter-trend and fakeout trades exist, but require extra confirmation. They're the exception, not the rule.",
        "Only trade with a defined edge — a real S/R zone, a real range, and a real candle-close confirmation, inside a recognized high-volume window, are the minimum bar for taking a trade.",
      ]},
    ],
  },
  {
    id: "risk", title: "2. Risk Management Framework", icon: "ShieldAlert",
    blocks: [
      { h: "2.1 Core Principle" },
      { p: "The single most important rule in the entire system: you must always be completely OK with the amount of money a trade could lose before you enter it. You can't control how much you win on any given trade, but you can always control how much you're willing to lose — risk management is the actual skill being practiced, not a side concern." },
      { h: "2.2 Static Risk vs. Dynamic Risk" },
      { p: "Static risk means entering with a single position sized at a fixed % of the account — typically 1% as a base case, 2% as a practical daily ceiling. This is the right default for newer traders." },
      { table: { headers: ["Account Size", "1% Risk", "2% Risk (daily ceiling)"], rows: [["$1,000", "$10", "$20"], ["$10,000", "$100", "$200"]] } },
      { p: "Dynamic risk means splitting the same total risk budget across multiple entries on the same idea — e.g. two 0.5% positions instead of one 1% position. The second position is added as price moves in a way that doesn't invalidate the original stop. Don't attempt this until comfortable with static risk first; start with two 0.5% positions, not a four-way split." },
      { h: "2.3 Daily Risk Planning" },
      { p: "Treat trading as a business with a daily risk budget, not a way to get rich quickly. Decide the daily limit in advance and don't exceed it regardless of how the day is going." },
      { table: { headers: ["Account Size", "Daily Risk Limit (2%)"], rows: [["$100", "$2/day"], ["$1,000", "$20/day"], ["$10,000", "$200/day"]] } },
      { h: "2.4 Cutting Losses Short on a Live Trade" },
      { p: "Once in a trade, drop to a lower timeframe than the one you entered on to monitor structure in real time. If price breaks the high/low of the smaller-timeframe candle that built your setup — even though your original stop hasn't been hit — close roughly 50% of the position immediately." },
      { ul: [
        "Pushed into ~15 pips of profit? Move to break-even and/or take partial profit (secure 50% at entry).",
        "Price struggling to push in your favor? Cut 50–75% of the position.",
        "Price broke the prior high/low in your favor but is coming back to entry? Cut 50–75% — this one is a must.",
        "Price breaks your own structure (the low/high that defined the trade)? Cut 75% or the full position.",
        "Entered on a wick rather than a confirmed close? Move to break-even once the setup 'flips' in your favor.",
        "Took a wide stop because of a long wick? Cut the position if price retraces more than 50% of that wick again.",
        "Price simply isn't pushing after entry? Cut the loss as soon as the relevant LTF candle's high/low breaks against you.",
      ]},
      { p: "One bad drawdown trade can erase an entire run of hard-won profit. Cut losses small and keep emotion out of the decision." },
      { h: "2.5 Adding to a Position (Dynamic Risk in Practice)" },
      { ul: [
        "There must still be enough remaining range for the move to continue — don't add late into an already-extended move.",
        "Move the first position to break-even before adding another.",
        "When starting out, use a reduced size (~50% of normal) for any add-on.",
        "Only add when there is genuine volume behind the move.",
      ]},
      { h: "2.6 Giving a Trade a Second Chance" },
      { p: "If a trade is stopped out and price turns back in your original direction, a re-entry can be considered — but only in the same direction as the original idea, only within your daily risk allowance, and only on a genuine new confirmation (a fresh break with a decisive close). If price closes indecisively in the middle of the range, there is no second-chance trade." },
      { h: "2.7 Adding Risk Back After a Partial Close" },
      { p: "After cutting 50% on an adverse move, that 50% can be added back if the market gives a fresh, valid reason — a strong confirming candle or a clean break of the relevant level. If price closes indecisively instead, leave the trade as-is." },
      { h: "2.8 Learning From Losses" },
      { p: "A loss is a trade idea that didn't work — not a personal failure. Common reasons a loss grows larger than planned:" },
      { ul: [
        "Trading off a mental stop-loss instead of a real, placed one.",
        "Removing a stop-loss mid-trade.",
        "Being too fearful to close or accept a loss once it's clearly happening.",
        "Taking a revenge ('F-it') position after a loss.",
        "Over-leveraging the position size.",
        "Over-trading — taking more trades than the plan allows.",
      ]},
      { p: "A constructive response after taking a loss: don't enter another trade immediately, step back for at least one full candle, ask what you missed and why the trade didn't work, consider how the opposite trade would have played out, and accept you were wrong without dwelling on it. Some losses are simply the built-in cost of running a positive-probability system over time." },
    ],
  },
  {
    id: "structure", title: "3. Market Structure Foundations", icon: "Layers",
    blocks: [
      { h: "3.1 Sessions & Timing" },
      { p: "Large, tradable candles tend to form during the most volatile windows of the day — primarily London Open and NY Open. A Daily candle is effectively built from six 4-hour candles; the most useful one is the 4H candle overlapping your own trading window." },
      { table: { headers: ["Session", "Window (EST, approx.)"], rows: [
        ["Pre-Asian", "6:00–6:30pm – 8pm"], ["Asian", "8–9pm – 10pm"], ["Pre-London", "1:00–1:30am – 3am"],
        ["London Open", "3am – 4:30am"], ["London Close", "10am – 11:30am"], ["Pre-NY", "5:30am – 8am"],
        ["NY Open / Overlap", "8am – 10–11:30am"],
      ]}},
      { h: "3.2 Support, Resistance, Zones & Range" },
      { ul: [
        "Support: an area where candles are most likely to reject and turn bullish. Resistance: the bearish mirror.",
        "S/R are zones/areas of price, never an exact single price.",
        "A zone is most reliable on the 30-minute timeframe or higher — the higher the timeframe, the stronger the zone.",
        "Range = the distance, in pips, between a support and a resistance. A workable range is at least 20–25 pips; a 40-pip range is a typical 'good' example.",
        "The closer price still is to a zone, the higher the probability of a reaction there.",
        "Exhaustion wicks clustered at a zone (wicks clearly larger than bodies) signal exhaustion of the prior momentum and reinforce that the zone is being respected.",
      ]},
      { h: "3.3 Higher Timeframe vs. Lower Timeframe (HTF / LTF)" },
      { p: "A HTF candle is a container built from many LTF candles — reading the LTF candles inside it reveals what's really happening before the HTF candle closes. Loose mental model: Daily ≈ four to six 4H candles, 4H ≈ four 1H candles, 1H ≈ two to four 30m candles, and so on. The higher the timeframe, the stronger the signal — 15-minute S/R zones are generally too weak to act on alone. 'HTF wickfill = LTF market structure': a long wick on a HTF candle is really LTF price action (a pullback, a sweep, a retest) compressed into a single candle." },
      { h: "3.4 Identifying Trend" },
      { ul: [
        "Uptrend: higher highs (HH) and higher lows (HL); each push respects the low of the prior leg.",
        "Downtrend: lower lows (LL) and lower highs (LH); each push respects the high of the prior leg.",
        "Consolidation: price oscillates without printing a fresh HH or LL.",
        "Always anchor 'trend' to the timeframe you're actually trading — the Daily trend can be bullish while the 1H trend inside it is briefly bearish.",
        "Whenever price prints a fresh high or low, there is roughly a 70–80% chance that level eventually gets retested ('break and retest') — a core statistical edge much of the setup library is built around.",
      ]},
      { h: "3.5 Candle Trends & Confirmation" },
      { p: "When trending, candles must respect their own structure — bullish trends respect prior lows, bearish trends respect prior highs. The strength of a close matters as much as its direction." },
      { table: { headers: ["Entry Style", "Characteristics"], rows: [
        ["Before candle closes", "Lower probability — effectively a bet on how the candle will finish."],
        ["After candle closes", "Higher probability — the safer default."],
      ]}},
      { h: "3.6 Momentum, Volatility & Volume" },
      { ul: [
        "Volume is largely a function of what time of day it is — which session is active.",
        "Volatility without real volume behind it tends to produce choppy, low-quality moves — often better to sit out.",
        "Momentum is a byproduct of volume; it clusters around news releases, headlines, trend changes, and market open/close.",
      ]},
      { h: "3.7 Wicks & Wickfills" },
      { ul: [
        "A wick gets 'filled' whenever price is in momentum with real volume behind the move.",
        "LTF wickfills are what ultimately build the wicks visible on HTF candles.",
        "A wick formed at a Daily or 4H S/R level marks the practical 'range/depth' of that zone.",
      ]},
      { h: "3.8 Breakouts, Fakeouts & Impulse Moves" },
      { p: "Breakout: a candle closes beyond an area previous candles couldn't close beyond. Most breakouts get retested; the best confirmation comes from a 30m–1H close beyond the level." },
      { p: "Fakeout: price appears to break a zone but quickly returns inside, trapping traders. Fakeouts follow extended consolidation and can only be reacted to once price closes back inside with a decisively strong opposite-direction body — close near the level, not mid-range." },
      { p: "Impulse Entry: entering as price is already moving fast, without waiting for a full close — justified specifically when an exhaustion candle (wick clearly larger than body) prints at a S/R level with real volume. Price then tends to continue in the original direction roughly 90% of the time." },
      { h: "3.9 Trading the Trend vs. Counter-Trend" },
      { p: "Default approach: buy at a freshly formed support within an uptrend, sell at a freshly formed resistance within a downtrend. A single counter-trend candle is never, by itself, a reason to act. Counter-trend trades are only justified when price clearly fails to break back through a freshly formed level against the trend, and there's still enough range left to make it worthwhile — these remain lower-probability, exception trades." },
    ],
  },
  {
    id: "candles", title: "4. Candlestick Mastery", icon: "BarChart3",
    blocks: [
      { p: "Standard candlestick reference patterns, tied back into the system's own language of wicks and exhaustion candles (see Section 3.7–3.8)." },
      { h: "Pin Bar" },
      { p: "A candle with a small body and a long wick (tail) on one side, showing rejection of price beyond that level. A long lower wick suggests bullish rejection; a long upper wick suggests bearish rejection. This is the same shape the system calls an exhaustion candle when it prints at a S/R zone with real volume behind it." },
      { h: "Engulfing Candle" },
      { p: "A two-candle pattern where the second candle's body fully engulfs the body of the first. A bullish engulfing opens below the prior close and closes above the prior open (and the reverse for bearish) — signalling a potential shift in control between buyers and sellers." },
      { h: "Inside Bar" },
      { p: "A candle whose entire range sits inside the range of the previous candle — reflecting a pause or contraction in volatility, often preceding a breakout. Watch inside bars near a zone for the eventual directional resolution." },
      { h: "Rejection Candle" },
      { p: "Any candle whose close shows price was firmly turned away from a level — typically a long wick with a small body closing back inside the range. This is exactly the 'exhaustion candle' signature the system relies on for impulse entries." },
    ],
  },
  {
    id: "patrading", title: "5. Price Action Trading: Breakouts, Pullbacks, Continuation & Reversals", icon: "TrendingUp",
    blocks: [
      { h: "Breakouts" },
      { p: "A breakout happens when a candle closes beyond an area previous candles couldn't close beyond. The best way to find a tradeable one is to wait for a candle to break and close beyond the level — 30m to 1H gives the best confirmations." },
      { h: "Fakeouts" },
      { p: "A fakeout happens when price appears to break a zone but quickly returns inside, trapping traders who entered expecting continuation. They typically follow extended consolidation and can only be reacted to, never anticipated." },
      { h: "Pullbacks" },
      { p: "A pullback retests a prior S/R within an existing trend. Once a fresh micro-level prints at the retest, the pullback can be traded with the trend (see the Pullback setups in the Setup Library)." },
      { h: "Trend Continuation" },
      { p: "The default mode of this system: buy at fresh support in an uptrend, sell at fresh resistance in a downtrend. The vast majority of setups in the library are continuation setups." },
      { h: "Reversals" },
      { p: "Counter-trend / reversal trades require a confirmed fakeout or a level holding firm against the trend, plus visibly dying volume on the prevailing trend's own structure. These are treated as the exception, never the primary strategy." },
    ],
  },
  {
    id: "checklist", title: "6. Pre-Entry Checklist", icon: "ListChecks",
    blocks: [
      { p: "Run through this before taking any entry. Grouped by theme for readability — in practice all of these checks happen together in the seconds before a trade." },
    ],
  },
  {
    id: "rules", title: "7. General Trading Rules", icon: "CheckCircle2",
    blocks: [
      { ul: [
        "Only trade off the 30-minute / 1-hour timeframes.",
        "Follow the current session's trend.",
        "Stay alert for fakeouts running against the current session trend.",
        "Keep the stop-loss below/above the previous 30m or 15m candle, or the most recent swing high/low.",
        "If the entry candle's wick is long, anchor the stop to the most recent swing low/high instead.",
        "Take-profit should always secure a minimum of 25–30 pips, then move to break-even.",
        "Even if the stop ends up wider than 40 pips, the take-profit should still secure at least 25 pips.",
        "If a 1H or 4H zone is nearby, don't take the trade.",
      ]},
      { h: "Recognized entry types (high-volume window required, no exceptions)" },
      { ul: [
        "Counter Buy/Sell", "Impulse Breakout Buy/Sell", "Complete Breakout Buy/Sell (high-volume time only)",
        "S/R-formed-at-S/R Buy/Sell (with trend)", "Wickfill (follow trend/volume)", "Impulse Buy/Sell ('A+', high-volume time only)",
        "Pullback Buy/Sell (S/R formed)", "Fakeout Buy/Sell (follow trend)",
      ]},
    ],
  },
  {
    id: "planning", title: "8. Building a Trading Plan", icon: "ClipboardList",
    blocks: [
      { p: "Define these before trading live, and revisit them regularly:" },
      { ul: [
        "Goal for the day.", "Pair(s) to trade.", "Maximum number of trades.", "Acceptable win/loss ratio.",
        "Specific times you will trade.", "Daily risk limit.", "An observation & planning routine before the session starts.",
        "A journaling habit — wins vs. losses, entries vs. exits, room for improvement.",
      ]},
      { p: "Pair selection should weigh: how much time you actually have to trade, which market/session is open during that window, and whether that pair offers enough volatility during your chosen session. Treat trading as a business with a daily risk budget — consistency over months, not days, is the realistic path to results." },
      { p: "Open the Trading Plans tab to build your own plan using this structure." },
    ],
  },
  {
    id: "psychology", title: "9. Trading Psychology & Discipline", icon: "Brain",
    blocks: [
      { ul: [
        "Expect to need real screen time — plan on several months of mostly observing price action before expecting consistent results.",
        "Don't let missed trades create regret or rushed decisions — chasing a missed move with poor risk control causes more damage than missing it outright.",
        "Emotional capacity is limited — realistically you can only make one or two clear-headed trade decisions at a time.",
        "Treat a loss as information, not a verdict on your ability.",
        "Recognize common failure patterns: trading without a plan, having a plan but not following it, over-leveraging, ignoring risk management, chasing outsized returns.",
        "Discipline compounds like a habit — roughly three weeks of consistent repetition to form, so consistency matters more than intensity early on.",
        "Take breaks periodically — studying and screen time are mentally taxing even without taking trades.",
        "Avoid analysis paralysis: how confident are you really, does the setup match your plan, what's the realistic worst case, how often has this exact setup worked before?",
      ]},
      { p: "Log mistakes, causes, and lessons in the Trading Psychology tab to build your own pattern library over time." },
    ],
  },
  {
    id: "glossary", title: "10. Glossary of Terms", icon: "BookMarked",
    blocks: [
      { table: { headers: ["Term", "Meaning"], rows: [
        ["HTF / LTF", "Higher timeframe / lower timeframe."],
        ["HH / HL / LL / LH", "Higher high / higher low / lower low / lower high — the building blocks of trend."],
        ["S/R", "Support / resistance."],
        ["Wickfill", "The filling-in of a candle's wick by subsequent price action, on momentum and volume."],
        ["BOPCH / BOPCL", "Break of previous candle high / low."],
        ["BE", "Break-even — moving the stop to entry once sufficiently in profit or confirmed."],
        ["M.Risk", "The mid-trade risk rule applied to a setup."],
        ["A+ setup", "A high-quality, 'textbook' version of a setup with strong confluence."],
        ["Reflip", "Price breaking back through the entry level against you before (potentially) resuming in your favor."],
        ["Vol Time", "A recognized high-volume window required for certain higher-risk setups."],
        ["Static Risk", "A fixed % of the account risked on a single position."],
        ["Dynamic Risk", "The same total risk split across two or more entries, added as the trade develops."],
      ]}},
    ],
  },
  {
    id: "closing", title: "11. Closing Note & Sources", icon: "BookOpen",
    blocks: [
      { p: "This reference brings together the risk-management rules, market-structure concepts, and the complete named entry-setup library into a single working document — for personal study and strategy reference, not financial advice. Every setup is a probability-based tool; proper risk management (Section 2) is what determines whether that probability translates into a sustainable result over time." },
      { h: "Sources synthesized in this guide" },
      { ul: [
        "Smart Raja Concepts (SRC) — risk management & market-structure course notes",
        "Named Entry-Setup Library ('BIGEY') — chart-pattern playbook, checklist & risk rules",
        "Market Fluidity / supplementary course slide deck — sessions, momentum, psychology",
      ]},
    ],
  },
];

const DEFAULT_DATA = () => ({
  trades: [],
  setups: seedSetups(),
  strategies: seedStrategies(),
  plans: seedPlans(),
  psychology: [],
  vault: seedVault(),
  smc: seedSMC(),
  checkins: [],
  account: { startingBalance: 1000, currency: "€" },
});

const STORAGE_KEY = "src_trading_os_v1";

/* ============================================================
   ICON MAP (for data-driven icons)
   ============================================================ */
const ICONS = {
  Sparkles, ShieldAlert, Layers, BarChart3, TrendingUp, ListChecks, CheckCircle2,
  ClipboardList, Brain, BookMarked, BookOpen,
};

/* ============================================================
   SMALL REUSABLE UI PRIMITIVES
   ============================================================ */
function Card({ children, className = "", onClick }) {
  return (
    <div
      onClick={onClick}
      className={cx(
        "bg-slate-900 border border-slate-800 rounded-2xl p-4",
        onClick && "active:scale-[0.99] cursor-pointer transition-transform",
        className
      )}
    >
      {children}
    </div>
  );
}

function Pill({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-800 text-slate-300 border-slate-700",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    sky: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  };
  return (
    <span className={cx("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", tones[tone])}>
      {children}
    </span>
  );
}

function SectionTitle({ children, action, sub }) {
  return (
    <div className="flex items-start justify-between mb-3 px-1">
      <div>
        <h2 className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>{children}</h2>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, tone = "slate", label }) {
  const tones = {
    slate: "bg-slate-800 text-slate-300 hover:bg-slate-700",
    amber: "bg-amber-500 text-slate-950 hover:bg-amber-400",
    rose: "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20",
  };
  return (
    <button onClick={onClick} className={cx("flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition", tones[tone])}>
      <Icon size={15} />
      {label && <span>{label}</span>}
    </button>
  );
}

function EmptyState({ icon: Icon, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
        <Icon size={24} className="text-slate-600" />
      </div>
      <p className="text-slate-300 font-medium">{title}</p>
      {sub && <p className="text-slate-500 text-sm mt-1 max-w-xs">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "bg-slate-950 border border-slate-800 w-full sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto",
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
      >
        <div className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between z-10">
          <h3 className="font-semibold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 pb-8">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, title, body, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-sm w-full">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} className="text-amber-400" />
          <h3 className="font-semibold text-slate-100">{title}</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">{body}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-2 rounded-xl text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={onConfirm} className="px-3 py-2 rounded-xl text-sm bg-rose-500 text-white hover:bg-rose-400 font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PERSISTENT NAVIGATION — PageHeader + FloatingHomeButton
   Used by every nested Create/Edit page so the user is never
   stuck without a way back to the Dashboard.
   ============================================================ */
function Breadcrumbs({ crumbs }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-[11px] min-w-0">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1 shrink-0">
          {i > 0 && <ChevronRight size={10} className="text-slate-700" />}
          {c.onClick ? (
            <button onClick={c.onClick} className="text-slate-500 hover:text-amber-400 transition">{c.label}</button>
          ) : (
            <span className="text-slate-300 font-medium">{c.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function PageHeader({ crumbs, onBack, onClose, onSave, saveLabel = "Save", saveDisabled = false }) {
  return (
    <div className="border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3 flex items-center gap-2.5 shrink-0">
      <button onClick={onBack} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400 shrink-0">
        <ArrowLeft size={17} />
      </button>
      <div className="flex-1 min-w-0">
        <Breadcrumbs crumbs={crumbs} />
      </div>
      {onSave && (
        <button onClick={onSave} disabled={saveDisabled}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-semibold text-xs shrink-0">
          <Check size={13} /> {saveLabel}
        </button>
      )}
      <button onClick={onClose} title="Close — back to Dashboard" className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 shrink-0">
        <X size={17} />
      </button>
    </div>
  );
}

function FloatingHomeButton({ goTo }) {
  if (!goTo) return null;
  return (
    <button onClick={() => goTo("home")} title="Back to Dashboard"
      className="fixed bottom-24 right-4 z-40 w-12 h-12 rounded-full bg-amber-500 text-slate-950 shadow-2xl shadow-black/40 flex items-center justify-center hover:bg-amber-400 transition">
      <Home size={20} />
    </button>
  );
}

/* Generic full-page form shell: header + scrollable body + floating home button.
   Every Create/Edit page in Library, Plans, Vault & Psychology uses this so
   none of them can ever become a dead end. */
function FullPageShell({ crumbs, onBack, onClose, onSave, saveLabel, saveDisabled, goTo, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      <PageHeader crumbs={crumbs} onBack={onBack} onClose={onClose} onSave={onSave} saveLabel={saveLabel} saveDisabled={saveDisabled} />
      <div className="flex-1 overflow-y-auto p-4 pb-8">
        {children}
      </div>
      <FloatingHomeButton goTo={goTo} />
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-600 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50";

function TextInput(props) { return <input {...props} className={cx(inputCls, props.className)} />; }
function TextArea(props) { return <textarea {...props} className={cx(inputCls, "min-h-[80px] resize-y", props.className)} />; }
function Select({ children, ...props }) {
  return <select {...props} className={cx(inputCls, "appearance-none")}>{children}</select>;
}

function SymbolSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) { setQ(""); return; }
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.toLowerCase();
    if (!term) return SYMBOL_GROUPS;
    return SYMBOL_GROUPS.map((g) => ({
      ...g,
      symbols: g.symbols.filter((s) => s.s.toLowerCase().includes(term) || s.l.toLowerCase().includes(term)),
    })).filter((g) => g.symbols.length > 0);
  }, [q]);

  const pick = (sym) => { onChange(sym); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onFocus={() => setOpen(true)}
          placeholder="Search or type symbol..."
          className={cx(inputCls, "flex-1")}
        />
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-amber-400">
          <ChevronDown size={16} className={cx("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-72 overflow-y-auto">
          <div className="p-2 border-b border-slate-800 sticky top-0 bg-slate-900">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter symbols..."
              className={cx(inputCls, "py-2 text-xs")}
            />
          </div>
          {filtered.map((grp) => (
            <div key={grp.group}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500 font-semibold bg-slate-900/80 sticky">{grp.group}</div>
              {grp.symbols.map(({ s, l }) => (
                <button key={s} type="button" onClick={() => pick(s)}
                  className={cx("w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-800 text-left",
                    value === s ? "bg-amber-500/10 text-amber-400" : "text-slate-300")}>
                  <span className="font-semibold w-20 shrink-0">{s}</span>
                  <span className="text-slate-500 text-xs truncate">{l}</span>
                </button>
              ))}
            </div>
          ))}
          {q && !filtered.length && (
            <button type="button" onClick={() => pick(q.toUpperCase())}
              className="w-full px-3 py-3 text-sm text-amber-400 hover:bg-slate-800 text-left flex items-center gap-2">
              <Plus size={14} /> Use "{q.toUpperCase()}" as custom symbol
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TagToggle({ options, value, onChange }) {
  const toggle = (opt) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          type="button"
          key={opt}
          onClick={() => toggle(opt)}
          className={cx(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition",
            value.includes(opt) ? "bg-amber-500 border-amber-500 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-400"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/* ---- Attachments ---- */
function Attachments({ items = [], onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const addFiles = async (fileList) => {
    setBusy(true);
    const next = [...items];
    for (const file of Array.from(fileList)) {
      let dataUrl = null;
      const tooBig = file.size > 3.5 * 1024 * 1024;
      if (!tooBig) {
        try { dataUrl = await fileToDataUrl(file); } catch (e) { dataUrl = null; }
      }
      next.push({
        id: uid(),
        name: file.name,
        mime: file.type,
        isImage: file.type.startsWith("image/"),
        dataUrl,
        tooBig,
        size: file.size,
      });
    }
    onChange(next);
    setBusy(false);
  };

  const remove = (id) => onChange(items.filter((i) => i.id !== id));

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {items.map((it) => (
          <div key={it.id} className="relative group">
            {it.isImage && it.dataUrl ? (
              <img src={it.dataUrl} alt={it.name} className="w-16 h-16 object-cover rounded-lg border border-slate-700" />
            ) : (
              <div className="w-16 h-16 rounded-lg border border-slate-700 bg-slate-800 flex flex-col items-center justify-center p-1">
                <FileText size={18} className="text-slate-400" />
                <span className="text-[9px] text-slate-500 truncate w-full text-center">{it.name.slice(0, 10)}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(it.id)}
              className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center"
            >
              <X size={11} />
            </button>
            {it.tooBig && <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-amber-300 text-center">large file</span>}
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current && fileRef.current.click()}
          className="w-16 h-16 rounded-lg border border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 hover:border-amber-500/50 hover:text-amber-400"
        >
          <Upload size={16} />
          <span className="text-[9px] mt-0.5">{busy ? "..." : "Add"}</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.mp4,.mov,.txt"
        className="hidden"
        onChange={(e) => e.target.files && e.target.files.length && addFiles(e.target.files)}
      />
      <p className="text-[11px] text-slate-600">Photos, screenshots, PDFs &amp; docs. Files over ~3.5MB are listed by name only (storage limit).</p>
    </div>
  );
}

function AttachmentGrid({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((it) =>
        it.isImage && it.dataUrl ? (
          <img key={it.id} src={it.dataUrl} alt={it.name} className="w-14 h-14 object-cover rounded-lg border border-slate-700" />
        ) : (
          <a
            key={it.id}
            href={it.dataUrl || "#"}
            download={it.name}
            className="w-14 h-14 rounded-lg border border-slate-700 bg-slate-800 flex flex-col items-center justify-center p-1 text-slate-400"
          >
            <FileText size={16} />
            <span className="text-[8px] truncate w-full text-center">{it.name.slice(0, 9)}</span>
          </a>
        )
      )}
    </div>
  );
}

function Accordion({ id, open, onToggle, title, badge, children, icon: Icon }) {
  const isOpen = open === id;
  return (
    <Card className="!p-0 overflow-hidden">
      <button onClick={() => onToggle(isOpen ? null : id)} className="w-full flex items-center justify-between px-4 py-3.5 text-left">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && <Icon size={16} className="text-amber-400 shrink-0" />}
          <span className="font-medium text-slate-100 text-sm truncate">{title}</span>
          {badge}
        </div>
        {isOpen ? <ChevronUp size={18} className="text-slate-500 shrink-0" /> : <ChevronDown size={18} className="text-slate-500 shrink-0" />}
      </button>
      {isOpen && <div className="px-4 pb-4 border-t border-slate-800 pt-3">{children}</div>}
    </Card>
  );
}

function renderBlocks(blocks) {
  return blocks.map((b, i) => {
    if (b.h) return <h4 key={i} className="text-amber-400 font-semibold text-sm mt-4 mb-1.5">{b.h}</h4>;
    if (b.p) return <p key={i} className="text-sm text-slate-300 leading-relaxed mb-2">{b.p}</p>;
    if (b.ul) return (
      <ul key={i} className="space-y-1.5 mb-2">
        {b.ul.map((item, j) => (
          <li key={j} className="text-sm text-slate-300 leading-relaxed flex gap-2">
            <span className="text-amber-500 mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
    if (b.table) return (
      <div key={i} className="overflow-x-auto mb-3 rounded-xl border border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800/60">
              {b.table.headers.map((h, hi) => (
                <th key={hi} className="text-left px-3 py-2 font-semibold text-slate-300 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((row, ri) => (
              <tr key={ri} className="border-t border-slate-800">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-slate-400 align-top">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    return null;
  });
}

/* ============================================================
   SHARED CONSTANTS FOR FORMS
   ============================================================ */
const MARKET_TYPES = ["Forex", "Stocks", "Crypto", "Futures", "Indices", "Commodities", "Other"];
const RESULT_TONE = { Win: "emerald", Loss: "rose", Breakeven: "slate", Open: "sky" };
const SESSION_OPTIONS = ["Pre-London", "London", "New York", "Asian", "Pre-Asian", "NY-London Overlap", "Unspecified"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SYMBOL_GROUPS = [
  {
    group: "Forex — Majors", symbols: [
      { s: "EURUSD", l: "Euro / US Dollar" }, { s: "GBPUSD", l: "British Pound / US Dollar" },
      { s: "USDJPY", l: "US Dollar / Japanese Yen" }, { s: "USDCHF", l: "US Dollar / Swiss Franc" },
      { s: "AUDUSD", l: "Australian Dollar / US Dollar" }, { s: "NZDUSD", l: "New Zealand Dollar / US Dollar" },
      { s: "USDCAD", l: "US Dollar / Canadian Dollar" },
    ],
  },
  {
    group: "Forex — Crosses", symbols: [
      { s: "EURGBP", l: "Euro / British Pound" }, { s: "EURJPY", l: "Euro / Japanese Yen" },
      { s: "GBPJPY", l: "British Pound / Japanese Yen" }, { s: "GBPCHF", l: "British Pound / Swiss Franc" },
      { s: "AUDJPY", l: "Australian Dollar / Japanese Yen" }, { s: "NZDJPY", l: "New Zealand Dollar / Japanese Yen" },
      { s: "EURAUD", l: "Euro / Australian Dollar" }, { s: "EURNZD", l: "Euro / New Zealand Dollar" },
      { s: "GBPAUD", l: "British Pound / Australian Dollar" }, { s: "GBPNZD", l: "British Pound / New Zealand Dollar" },
    ],
  },
  {
    group: "Indices", symbols: [
      { s: "US30", l: "Dow Jones Industrial Average" }, { s: "NAS100", l: "Nasdaq 100" },
      { s: "SPX500", l: "S&P 500" }, { s: "DAX40", l: "DAX 40" }, { s: "FTSE100", l: "FTSE 100" },
    ],
  },
  {
    group: "Commodities", symbols: [
      { s: "XAUUSD", l: "Gold" }, { s: "XAGUSD", l: "Silver" },
      { s: "USOIL", l: "WTI Crude Oil" }, { s: "UKOIL", l: "Brent Crude Oil" },
    ],
  },
  {
    group: "Crypto", symbols: [
      { s: "BTCUSD", l: "Bitcoin / US Dollar" }, { s: "ETHUSD", l: "Ethereum / US Dollar" },
      { s: "SOLUSD", l: "Solana / US Dollar" },
    ],
  },
];

/* ============================================================
   POSITION SIZE CALCULATOR ENGINE
   ============================================================ */
// pipSize: minimum price move that counts as 1 pip
// pipValuePerLot: USD value of 1 pip for 1 standard lot
// contractSize: units per 1 standard lot
// unit: display label for the instrument size
const INSTRUMENT_SPECS = {
  // ── Forex Majors ─────────────────────────────────────────
  EURUSD: { pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, unit: "units", category: "Forex" },
  GBPUSD: { pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, unit: "units", category: "Forex" },
  AUDUSD: { pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, unit: "units", category: "Forex" },
  NZDUSD: { pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, unit: "units", category: "Forex" },
  USDCHF: { pipSize: 0.0001, pipValuePerLot: 9.5, contractSize: 100000, unit: "units", category: "Forex" },
  USDCAD: { pipSize: 0.0001, pipValuePerLot: 7.5, contractSize: 100000, unit: "units", category: "Forex" },
  USDJPY: { pipSize: 0.01, pipValuePerLot: 9, contractSize: 100000, unit: "units", category: "Forex" },
  // ── Forex Crosses ─────────────────────────────────────────
  EURGBP: { pipSize: 0.0001, pipValuePerLot: 12.5, contractSize: 100000, unit: "units", category: "Forex" },
  EURJPY: { pipSize: 0.01, pipValuePerLot: 9, contractSize: 100000, unit: "units", category: "Forex" },
  EURCHF: { pipSize: 0.0001, pipValuePerLot: 9.5, contractSize: 100000, unit: "units", category: "Forex" },
  EURAUD: { pipSize: 0.0001, pipValuePerLot: 6.5, contractSize: 100000, unit: "units", category: "Forex" },
  EURNZD: { pipSize: 0.0001, pipValuePerLot: 6, contractSize: 100000, unit: "units", category: "Forex" },
  EURCAD: { pipSize: 0.0001, pipValuePerLot: 7.5, contractSize: 100000, unit: "units", category: "Forex" },
  GBPJPY: { pipSize: 0.01, pipValuePerLot: 9, contractSize: 100000, unit: "units", category: "Forex" },
  GBPCHF: { pipSize: 0.0001, pipValuePerLot: 9.5, contractSize: 100000, unit: "units", category: "Forex" },
  GBPAUD: { pipSize: 0.0001, pipValuePerLot: 6.5, contractSize: 100000, unit: "units", category: "Forex" },
  GBPNZD: { pipSize: 0.0001, pipValuePerLot: 6, contractSize: 100000, unit: "units", category: "Forex" },
  GBPCAD: { pipSize: 0.0001, pipValuePerLot: 7.5, contractSize: 100000, unit: "units", category: "Forex" },
  AUDJPY: { pipSize: 0.01, pipValuePerLot: 9, contractSize: 100000, unit: "units", category: "Forex" },
  NZDJPY: { pipSize: 0.01, pipValuePerLot: 9, contractSize: 100000, unit: "units", category: "Forex" },
  CADJPY: { pipSize: 0.01, pipValuePerLot: 9, contractSize: 100000, unit: "units", category: "Forex" },
  CHFJPY: { pipSize: 0.01, pipValuePerLot: 9, contractSize: 100000, unit: "units", category: "Forex" },
  AUDNZD: { pipSize: 0.0001, pipValuePerLot: 6, contractSize: 100000, unit: "units", category: "Forex" },
  AUDCAD: { pipSize: 0.0001, pipValuePerLot: 7.5, contractSize: 100000, unit: "units", category: "Forex" },
  AUDCHF: { pipSize: 0.0001, pipValuePerLot: 9.5, contractSize: 100000, unit: "units", category: "Forex" },
  NZDCAD: { pipSize: 0.0001, pipValuePerLot: 7.5, contractSize: 100000, unit: "units", category: "Forex" },
  NZDCHF: { pipSize: 0.0001, pipValuePerLot: 9.5, contractSize: 100000, unit: "units", category: "Forex" },
  CADCHF: { pipSize: 0.0001, pipValuePerLot: 9.5, contractSize: 100000, unit: "units", category: "Forex" },
  // ── Commodities ───────────────────────────────────────────
  XAUUSD: { pipSize: 0.01, pipValuePerLot: 1, contractSize: 100, unit: "oz", category: "Gold",
    note: "1 standard lot = 100 oz · min 0.01 lots" },
  XAGUSD: { pipSize: 0.001, pipValuePerLot: 5, contractSize: 5000, unit: "oz", category: "Silver" },
  USOIL:  { pipSize: 0.01, pipValuePerLot: 10, contractSize: 1000, unit: "barrels", category: "Oil" },
  UKOIL:  { pipSize: 0.01, pipValuePerLot: 10, contractSize: 1000, unit: "barrels", category: "Oil" },
  // ── Indices ───────────────────────────────────────────────
  US30:   { pipSize: 1, pipValuePerLot: 1, contractSize: 1, unit: "contracts", category: "Indices",
    note: "1 point = $1 · varies by broker" },
  NAS100: { pipSize: 0.1, pipValuePerLot: 1, contractSize: 1, unit: "contracts", category: "Indices",
    note: "0.1 point = $1 · varies by broker" },
  SPX500: { pipSize: 0.1, pipValuePerLot: 10, contractSize: 1, unit: "contracts", category: "Indices" },
  DAX40:  { pipSize: 0.1, pipValuePerLot: 1, contractSize: 1, unit: "contracts", category: "Indices" },
  FTSE100:{ pipSize: 0.1, pipValuePerLot: 10, contractSize: 1, unit: "contracts", category: "Indices" },
  // ── Crypto ────────────────────────────────────────────────
  BTCUSD: { pipSize: 1, pipValuePerLot: 1, contractSize: 1, unit: "BTC", category: "Crypto" },
  ETHUSD: { pipSize: 0.01, pipValuePerLot: 1, contractSize: 1, unit: "ETH", category: "Crypto" },
  SOLUSD: { pipSize: 0.001, pipValuePerLot: 1, contractSize: 1, unit: "SOL", category: "Crypto" },
};

function getSpec(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  return INSTRUMENT_SPECS[upper] || null;
}

function calcPositionSize({ symbol, accountBalance, riskPct, entry, sl }) {
  const spec = getSpec(symbol);
  const bal = parseFloat(accountBalance);
  const risk = parseFloat(riskPct);
  const entryN = parseFloat(entry);
  const slN = parseFloat(sl);

  if (!spec || isNaN(bal) || isNaN(risk) || isNaN(entryN) || isNaN(slN) || entryN === slN || bal <= 0 || risk <= 0) {
    return null;
  }

  const riskAmount = bal * (risk / 100);
  const rawDist = Math.abs(entryN - slN);
  const pipDistance = rawDist / spec.pipSize;
  const lots = riskAmount / (pipDistance * spec.pipValuePerLot);
  const roundedLots = Math.max(0.01, Math.round(lots * 100) / 100);
  const units = roundedLots * spec.contractSize;
  const actualRisk = roundedLots * pipDistance * spec.pipValuePerLot;
  const tpDistance = null; // filled in when TP is known
  const slDistRaw = rawDist;

  return {
    spec, riskAmount, pipDistance: Math.round(pipDistance * 10) / 10, rawDist,
    lots, roundedLots, units, actualRisk, slDistRaw,
    pipLabel: spec.category === "Forex" ? "pips" : spec.category === "Gold" || spec.category === "Oil" ? "pts" : "pts",
  };
}

// Standard lot steps for quick-pick
const LOT_STEPS = [0.01, 0.02, 0.05, 0.10, 0.20, 0.50, 1.00];

/* ============================================================
   DASHBOARD — SHARED COMPONENTS
   ============================================================ */
function StatCard({ label, value, sub, icon: Icon, tone = "slate" }) {
  const toneText = {
    slate: "text-slate-100", amber: "text-amber-400", emerald: "text-emerald-400", rose: "text-rose-400",
  };
  return (
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</span>
        {Icon && <Icon size={14} className="text-slate-600" />}
      </div>
      <div className={cx("text-xl font-semibold", toneText[tone])} style={{ fontFamily: "'Sora', sans-serif" }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </Card>
  );
}

function getMonthMatrix(year, month) {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) {
    cells.push({ dayNum: daysInPrevMonth - startDow + 1 + i, inMonth: false, iso: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ dayNum: d, inMonth: true, iso });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ dayNum: nextDay++, inMonth: false, iso: null });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function computeAnalytics(data) {
  const trades = data.trades || [];
  const computed = trades.map((t) => ({ ...t, c: computeTrade(t) }));
  const closed = computed.filter((t) => t.c.result);
  const wins = closed.filter((t) => t.c.result === "Win");
  const losses = closed.filter((t) => t.c.result === "Loss");

  const grossProfit = wins.reduce((s, t) => s + (t.c.pnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.c.pnl || 0), 0));
  const netProfit = closed.reduce((s, t) => s + (t.c.pnl || 0), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : null;

  const rrVals = trades.map((t) => computeTrade(t).plannedRR).filter((v) => v !== null && !isNaN(v));
  const avgRR = rrVals.length ? rrVals.reduce((s, v) => s + v, 0) / rrVals.length : null;
  const rmVals = closed.map((t) => t.c.rMultiple).filter((v) => v !== null && !isNaN(v));
  const avgRMultiple = rmVals.length ? rmVals.reduce((s, v) => s + v, 0) / rmVals.length : null;

  const byPnlDesc = [...closed].sort((x, y) => (y.c.pnl || 0) - (x.c.pnl || 0));
  const bestTrade = byPnlDesc.length ? byPnlDesc[0] : null;
  const worstTrade = byPnlDesc.length ? byPnlDesc[byPnlDesc.length - 1] : null;
  const pctVals = closed.filter((t) => t.c.pctMove !== null && !isNaN(t.c.pctMove));
  const topGainer = pctVals.length ? [...pctVals].sort((x, y) => y.c.pctMove - x.c.pctMove)[0] : null;

  const holdVals = closed.filter((t) => t.c.holdMinutes !== null);
  const avgHoldMinutes = holdVals.length ? holdVals.reduce((s, t) => s + t.c.holdMinutes, 0) / holdVals.length : null;
  const winHolds = wins.filter((t) => t.c.holdMinutes !== null);
  const lossHolds = losses.filter((t) => t.c.holdMinutes !== null);
  const longestWinningHold = winHolds.length ? Math.max(...winHolds.map((t) => t.c.holdMinutes)) : null;
  const longestLosingHold = lossHolds.length ? Math.max(...lossHolds.map((t) => t.c.holdMinutes)) : null;

  const totalFees = closed.reduce((s, t) => s + (parseFloat(t.fees) || 0), 0);
  const totalCommission = closed.reduce((s, t) => s + (parseFloat(t.commission) || 0), 0);

  const sortedChrono = [...closed].sort((x, y) => (x.date || "").localeCompare(y.date || ""));
  let bestWinStreak = 0, bestLossStreak = 0, runWin = 0, runLoss = 0;
  sortedChrono.forEach((t) => {
    if (t.c.result === "Win") { runWin++; runLoss = 0; bestWinStreak = Math.max(bestWinStreak, runWin); }
    else if (t.c.result === "Loss") { runLoss++; runWin = 0; bestLossStreak = Math.max(bestLossStreak, runLoss); }
    else { runWin = 0; runLoss = 0; }
  });
  let currentStreakType = null, currentStreakLength = 0;
  for (let i = sortedChrono.length - 1; i >= 0; i--) {
    const r = sortedChrono[i].c.result;
    if (r === "Breakeven") break;
    if (currentStreakType === null) { currentStreakType = r; currentStreakLength = 1; }
    else if (r === currentStreakType) currentStreakLength++;
    else break;
  }

  let qualityScore = null;
  if (winRate !== null || profitFactor !== null || avgRMultiple !== null) {
    const wrScore = winRate === null ? 50 : Math.min(100, winRate);
    const pfScore = profitFactor === null ? 50 : profitFactor === Infinity ? 100 : Math.min(100, profitFactor * 33.3);
    const rmScore = avgRMultiple === null ? 50 : Math.min(100, Math.max(0, (avgRMultiple + 1) * 33.3));
    qualityScore = Math.round(wrScore * 0.4 + pfScore * 0.35 + rmScore * 0.25);
  }

  const riskVals = trades.map((t) => parseFloat(t.riskPct)).filter((v) => !isNaN(v));
  const avgRiskPct = riskVals.length ? riskVals.reduce((s, v) => s + v, 0) / riskVals.length : null;
  const maxRiskPct = riskVals.length ? Math.max(...riskVals) : null;
  const openRiskExposure = trades.filter((t) => !t.exit).reduce((s, t) => s + (parseFloat(t.riskPct) || 0), 0);

  const groupBy = (list, keyFn) => {
    const map = {};
    list.forEach((t) => {
      const k = keyFn(t);
      if (k === null || k === undefined || k === "") return;
      if (!map[k]) map[k] = [];
      map[k].push(t);
    });
    return map;
  };
  const bestByPnl = (map, labelFn) => {
    let best = null;
    Object.entries(map).forEach(([k, list]) => {
      const pnl = list.reduce((s, t) => s + (t.c.pnl || 0), 0);
      const w = list.filter((t) => t.c.result === "Win").length;
      const wr = list.length ? (w / list.length) * 100 : null;
      if (!best || pnl > best.pnl) best = { key: k, label: labelFn(k), pnl, count: list.length, winRate: wr };
    });
    return best;
  };
  const bestByWinRate = (map, labelFn, minCount = 1) => {
    let best = null;
    Object.entries(map).forEach(([k, list]) => {
      if (list.length < minCount) return;
      const w = list.filter((t) => t.c.result === "Win").length;
      const wr = (w / list.length) * 100;
      if (!best || wr > best.winRate) best = { key: k, label: labelFn(k), winRate: wr, count: list.length };
    });
    return best;
  };

  const stratName = (id) => (data.strategies.find((s) => s.id === id) || {}).name || "Unknown";
  const bestStrategy = bestByPnl(groupBy(closed, (t) => t.strategyId), stratName);
  const setupName = (id) => (data.setups.find((s) => s.id === id) || {}).name || "Unknown";
  const bestSetup = bestByPnl(groupBy(closed, (t) => t.setupId), setupName);
  const dayMapGroup = groupBy(closed.filter((t) => t.date), (t) => {
    const d = new Date(t.date + "T12:00:00");
    return isNaN(d.getTime()) ? null : d.getDay();
  });
  const bestDay = bestByPnl(dayMapGroup, (k) => DAY_NAMES[parseInt(k)]);
  const bestSession = bestByPnl(groupBy(closed, (t) => t.session), (k) => k);
  const bestMarket = bestByWinRate(groupBy(closed, (t) => t.market), (k) => k, 1);
  const bestSymbol = bestByPnl(groupBy(closed, (t) => t.symbol), (k) => k);

  const strengths = [];
  if (bestStrategy && bestStrategy.pnl > 0) strengths.push(`${bestStrategy.label} is your most profitable strategy so far (${fmtSigned(bestStrategy.pnl)}).`);
  if (bestSetup && bestSetup.pnl > 0) strengths.push(`The "${bestSetup.label}" setup is producing your best results (${fmtSigned(bestSetup.pnl)}).`);
  if (bestDay) strengths.push(`You trade best on ${bestDay.label}s (${fmtSigned(bestDay.pnl)} total).`);
  if (bestSession) strengths.push(`Your ${bestSession.label} session trades outperform other sessions.`);
  if (winRate !== null && winRate >= 55) strengths.push(`Your overall win rate of ${fmtPct(winRate)} is a real edge — keep following your checklist.`);
  if (!strengths.length) strengths.push("Log a few more closed trades to start surfacing your personal strengths here.");

  const today = todayISO();
  const nowDate = new Date(today + "T12:00:00");
  const dowMonday = ((nowDate.getDay() + 6) % 7); // days since Monday
  const weekStart = new Date(nowDate); weekStart.setDate(nowDate.getDate() - dowMonday);
  const weekStartISO = weekStart.toISOString().slice(0, 10);
  const monthStartISO = today.slice(0, 7) + "-01";

  const dayPnl = closed.filter((t) => t.date === today).reduce((s, t) => s + (t.c.pnl || 0), 0);
  const weekPnl = closed.filter((t) => t.date >= weekStartISO && t.date <= today).reduce((s, t) => s + (t.c.pnl || 0), 0);
  const monthPnl = closed.filter((t) => t.date && t.date.startsWith(today.slice(0, 7))).reduce((s, t) => s + (t.c.pnl || 0), 0);

  return {
    totalTrades: trades.length, closedCount: closed.length, winningTrades: wins.length, losingTrades: losses.length,
    winRate, profitFactor, avgRR, avgRMultiple, totalPnl: netProfit, grossProfit, grossLoss, netProfit,
    bestTrade, worstTrade, topGainer, avgHoldMinutes, longestWinningHold, longestLosingHold,
    totalFees, totalCommission, bestWinStreak, bestLossStreak, currentStreakType, currentStreakLength,
    qualityScore, avgRiskPct, maxRiskPct, openRiskExposure,
    bestStrategy, bestSetup, bestDay, bestSession, bestMarket, bestSymbol, strengths,
    computedTrades: computed, closedTrades: closed,
    dayPnl, weekPnl, monthPnl,
  };
}

/* ============================================================
   POSITION SIZE CALCULATOR — STANDALONE WIDGET
   ============================================================ */
function PipDisplay({ label, value, sub, tone }) {
  const colors = { emerald: "text-emerald-400", amber: "text-amber-400", rose: "text-rose-400", sky: "text-sky-400", slate: "text-slate-100" };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
      <div className={cx("text-base font-bold leading-tight", colors[tone] || colors.slate)} style={{ fontFamily: "'Sora', sans-serif" }}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

/* ============================================================
   POSITION SIZE CALCULATOR — STANDALONE WIDGET (v2)
   ============================================================ */
const QUICK_AMOUNTS = [1, 5, 10, 20, 50, 100];
const RR_OPTIONS    = ["1:1", "1:2", "1:3", "1:4"];
const TRADER_QUOTES = [
  { q: "Protect capital first. Profits come second.", src: "SRC Core Principle" },
  { q: "Losing less than planned is a win.", src: "Risk Management" },
  { q: "Discipline beats prediction every single time.", src: "Trading Truth" },
  { q: "Wait for confirmation, not hope.", src: "Entry Rule #1" },
  { q: "Follow the plan, not your emotions.", src: "Psychology" },
  { q: "Quality trades over quantity — always.", src: "SRC Philosophy" },
  { q: "The market rewards patience and punishes impatience.", src: "Market Truth" },
  { q: "Every rule broken delays your goals.", src: "Accountability" },
  { q: "One bad trade can erase ten good ones. Manage risk first.", src: "Capital Preservation" },
  { q: "If it's not an A+ setup, it's not a trade.", src: "SRC Entry Standards" },
  { q: "The stop loss is not optional — it is the trade.", src: "Risk Rule" },
  { q: "Process over outcome. Judge trades by the decision, not the result.", src: "Growth Mindset" },
  { q: "Sit on your hands until the trade presents itself.", src: "Patience" },
  { q: "A breakeven trade is a win when the alternative was a loss.", src: "Trade Management" },
  { q: "Your trading account is a business. Run it like one.", src: "SRC Philosophy" },
];
const ALL_RULE_REMINDERS = [
  "Buy with the higher timeframe trend only.",
  "Only trade clean, confirmed candle closes.",
  "No trades above 30 pip stop loss — rule is absolute.",
  "Respect daily risk limit of 3%. Stop when hit.",
  "Secure profits at logical HTF levels.",
  "Wait for at least 20 pip range before entering.",
  "Move stop to break-even at 10–15 pips in profit.",
  "No revenge trading. One full candle after any loss.",
  "Trade only during Pre-London and London sessions.",
  "Confirm bias on the 30m and 1H before entry.",
  "No trades on consolidating markets.",
  "Wicks into S/R levels — wait for the fill or rejection.",
  "Cut 50–75% of position on first adverse structure break.",
  "A+ setups only — if you're unsure, it's not A+.",
  "Journal every trade before moving on.",
];

function getDailyItems(arr, count) {
  const dayIndex = Math.floor(Date.now() / 86400000);
  const out = [];
  for (let i = 0; i < count; i++) out.push(arr[(dayIndex + i) % arr.length]);
  return out;
}

function PositionSizeCalc({ account }) {
  const acc   = account || { startingBalance: 1000, currency: "€" };
  const cur   = acc.currency || "€";
  const bal   = parseFloat(acc.startingBalance) || 1000;

  const [sym,       setSym]       = useState("XAUUSD");
  const [direction, setDirection] = useState("Buy");
  const [entry,     setEntry]     = useState("");
  const [sl,        setSl]        = useState("");
  const [riskMode,  setRiskMode]  = useState("amount"); // "amount" | "pct"
  const [riskAmt,   setRiskAmt]   = useState("10");
  const [riskPct,   setRiskPct]   = useState("1");
  const [customAmt, setCustomAmt] = useState("");
  const [showCustom,setShowCustom]= useState(false);
  const [rrSel,     setRrSel]     = useState(null);   // "1:1"|"1:2"|…|"custom"
  const [customRR,  setCustomRR]  = useState("");

  const effectiveRiskAmt = useMemo(() => {
    if (riskMode === "amount") return parseFloat(riskAmt) || 0;
    return bal * ((parseFloat(riskPct) || 0) / 100);
  }, [riskMode, riskAmt, riskPct, bal]);

  const effectiveRiskPct = useMemo(() => {
    if (riskMode === "pct") return parseFloat(riskPct) || 0;
    return bal > 0 ? (effectiveRiskAmt / bal) * 100 : 0;
  }, [riskMode, riskPct, effectiveRiskAmt, bal]);

  const result = useMemo(() => {
    const fakeRiskPct = effectiveRiskPct;
    return calcPositionSize({ symbol: sym, accountBalance: bal, riskPct: fakeRiskPct, entry, sl });
  }, [sym, bal, effectiveRiskPct, entry, sl]);

  const rrNum = useMemo(() => {
    if (!rrSel) return null;
    if (rrSel === "custom") return parseFloat(customRR) || null;
    return parseFloat(rrSel.split(":")[1]);
  }, [rrSel, customRR]);

  const tpCalc = useMemo(() => {
    if (!rrNum || !entry || !sl) return null;
    const e = parseFloat(entry), s = parseFloat(sl);
    if (isNaN(e) || isNaN(s)) return null;
    const dist = Math.abs(e - s);
    const tp   = direction === "Buy" ? e + dist * rrNum : e - dist * rrNum;
    const potProfit = effectiveRiskAmt * rrNum;
    return { tp: Math.round(tp * 100000) / 100000, potProfit };
  }, [rrNum, entry, sl, direction, effectiveRiskAmt]);

  const spec = getSpec(sym);
  const isGold = sym === "XAUUSD";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-sky-500/15 flex items-center justify-center">
            <Calculator size={14} className="text-sky-400" />
          </div>
          <div>
            <div className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Position Size Calculator</div>
            <div className="text-[11px] text-slate-500">Auto risk & lot size · live updates</div>
          </div>
        </div>
        {spec && <div className="text-[10px] text-slate-500 text-right">{spec.category}<br />{spec.note || `1 lot = ${spec.contractSize.toLocaleString()} ${spec.unit}`}</div>}
      </div>

      {/* Instrument + Direction */}
      <div>
        <div className="text-xs font-medium text-slate-400 mb-1.5">Instrument</div>
        <SymbolSelector value={sym} onChange={setSym} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {["Buy", "Sell"].map((d) => (
          <button key={d} onClick={() => setDirection(d)}
            className={cx("py-2.5 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 transition",
              direction === d && d === "Buy"  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" :
              direction === d && d === "Sell" ? "bg-rose-500/15 border-rose-500/40 text-rose-400" :
              "bg-slate-900 border-slate-700 text-slate-500")}>
            {d === "Buy" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{d}
          </button>
        ))}
      </div>

      {/* Entry + SL */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1.5">Entry Price</div>
          <input type="number" step="any" value={entry} onChange={(e) => setEntry(e.target.value)}
            placeholder={isGold ? "2350.00" : "1.08500"}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
        </div>
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1.5">Stop Loss</div>
          <input type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)}
            placeholder={isGold ? "2340.00" : "1.08000"}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40" />
        </div>
      </div>

      {/* Risk section */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xs font-medium text-slate-400">Risk Amount</div>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setRiskMode("amount")} className={cx("px-2.5 py-1 rounded-md text-xs font-medium transition", riskMode === "amount" ? "bg-amber-500 text-slate-950" : "text-slate-500")}>{cur}</button>
            <button onClick={() => setRiskMode("pct")}   className={cx("px-2.5 py-1 rounded-md text-xs font-medium transition", riskMode === "pct"    ? "bg-amber-500 text-slate-950" : "text-slate-500")}>%</button>
          </div>
        </div>

        {riskMode === "amount" ? (
          <>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {QUICK_AMOUNTS.map((a) => {
                const isActive = !showCustom && parseFloat(riskAmt) === a;
                return (
                  <button key={a} onClick={() => { setRiskAmt(String(a)); setShowCustom(false); }}
                    className={cx("py-2.5 rounded-xl text-sm font-semibold border transition",
                      isActive ? "bg-amber-500/15 border-amber-500/40 text-amber-400" : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600")}>
                    {cur}{a}
                  </button>
                );
              })}
            </div>
            {showCustom ? (
              <div className="flex gap-2">
                <input type="number" step="any" value={customAmt} onChange={(e) => { setCustomAmt(e.target.value); setRiskAmt(e.target.value); }}
                  autoFocus placeholder={`Custom amount in ${cur}`}
                  className="flex-1 bg-slate-900 border border-amber-500/40 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
                <button onClick={() => setShowCustom(false)} className="px-3 rounded-xl bg-slate-800 text-slate-400"><X size={14} /></button>
              </div>
            ) : (
              <button onClick={() => setShowCustom(true)} className="w-full py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-xs font-medium hover:border-slate-600">
                + Custom amount
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-1.5 mb-2">
              {["0.5", "1", "1.5", "2", "3"].map((p) => (
                <button key={p} onClick={() => setRiskPct(p)}
                  className={cx("flex-1 py-2 rounded-xl text-xs font-semibold border transition",
                    riskPct === p ? "bg-amber-500/15 border-amber-500/40 text-amber-400" : "bg-slate-900 border-slate-800 text-slate-500")}>
                  {p}%
                </button>
              ))}
            </div>
            <input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(e.target.value)}
              placeholder="Risk %" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          </>
        )}

        <div className="mt-2 flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">Risk:</span>
          <span className="text-sm font-bold text-rose-400">{fmtBal(effectiveRiskAmt, cur)}</span>
          <span className="text-slate-700">·</span>
          <span className="text-xs text-slate-500">{effectiveRiskPct.toFixed(2)}% of balance</span>
          <span className="ml-auto text-xs text-slate-500">{fmtBal(bal, cur)}</span>
        </div>
      </div>

      {/* R:R Targets */}
      <div>
        <div className="text-xs font-medium text-slate-400 mb-1.5">Risk Reward Target</div>
        <div className="grid grid-cols-5 gap-1.5">
          {RR_OPTIONS.map((rr) => (
            <button key={rr} onClick={() => setRrSel(rrSel === rr ? null : rr)}
              className={cx("py-2.5 rounded-xl text-xs font-bold border transition",
                rrSel === rr ? "bg-sky-500/15 border-sky-500/40 text-sky-400" : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600")}>
              {rr}
            </button>
          ))}
          <button onClick={() => setRrSel(rrSel === "custom" ? null : "custom")}
            className={cx("py-2.5 rounded-xl text-xs font-bold border transition",
              rrSel === "custom" ? "bg-sky-500/15 border-sky-500/40 text-sky-400" : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600")}>
            1:?
          </button>
        </div>
        {rrSel === "custom" && (
          <input type="number" step="0.5" min="0.1" value={customRR} onChange={(e) => setCustomRR(e.target.value)}
            placeholder="e.g. 2.5 for 1:2.5" className="mt-2 w-full bg-slate-900 border border-sky-500/40 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40" />
        )}
        {tpCalc && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="bg-sky-500/8 border border-sky-500/20 rounded-xl p-3 text-center">
              <div className="text-sm font-bold text-sky-400">{tpCalc.tp}</div>
              <div className="text-[10px] text-slate-500">TP Price ({direction === "Buy" ? "↑" : "↓"})</div>
            </div>
            <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-3 text-center">
              <div className="text-sm font-bold text-emerald-400">{fmtBal(tpCalc.potProfit, cur)}</div>
              <div className="text-[10px] text-slate-500">Potential Profit</div>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {result ? (
        <>
          {isGold && (
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-3 py-2 flex items-center gap-2">
              <span className="text-amber-400 text-sm">★</span>
              <span className="text-xs text-amber-400/90">Gold · 1 standard lot = 100 oz · 0.01 lots = 1 oz</span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-500/8 border border-emerald-500/25 rounded-xl p-3 text-center">
              <div className="text-base font-bold text-emerald-400" style={{ fontFamily: "'Sora', sans-serif" }}>{result.roundedLots.toFixed(2)}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Lot Size</div>
            </div>
            <div className="bg-amber-500/8 border border-amber-500/25 rounded-xl p-3 text-center">
              <div className="text-base font-bold text-amber-400" style={{ fontFamily: "'Sora', sans-serif" }}>
                {result.units < 1000 ? result.units.toFixed(2) : Math.round(result.units).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{spec?.unit || "Units"}</div>
            </div>
            <div className="bg-rose-500/8 border border-rose-500/25 rounded-xl p-3 text-center">
              <div className="text-base font-bold text-rose-400" style={{ fontFamily: "'Sora', sans-serif" }}>{fmtBal(effectiveRiskAmt, cur)}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Risk Amount</div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
              <div className="text-sm font-bold text-slate-200">
                {result.pipDistance < 1 ? result.pipDistance.toFixed(1) : Math.round(result.pipDistance).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">SL {result.pipLabel}</div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
              <div className="text-sm font-bold text-slate-200">{fmtBal(result.actualRisk, cur)}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Actual Risk</div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
              <div className="text-sm font-bold text-slate-200">${result.spec.pipValuePerLot}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Pip Val/Lot</div>
            </div>
          </div>

          {/* Lot quick-pick table */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
            <div className="text-[11px] text-slate-500 font-medium mb-2">Lot size comparison</div>
            <div className="space-y-1.5">
              {LOT_STEPS.map((l) => {
                const r = l * result.pipDistance * result.spec.pipValuePerLot;
                const pct = (r / bal) * 100;
                const isRec = l === result.roundedLots;
                return (
                  <div key={l} className={cx("flex items-center justify-between rounded-lg px-3 py-2 text-xs",
                    isRec ? "bg-emerald-500/10 border border-emerald-500/25" : "bg-slate-800")}>
                    <span className={cx("font-bold", isRec ? "text-emerald-400" : "text-slate-300")}>{l.toFixed(2)} lots</span>
                    <span className={cx("font-medium", pct <= 1 ? "text-sky-400" : pct <= 2 ? "text-emerald-400" : pct <= 3 ? "text-amber-400" : "text-rose-400")}>{fmtBal(r, cur)}</span>
                    <span className={cx("text-[10px]", pct <= 2 ? "text-emerald-400/70" : pct <= 3 ? "text-amber-400/70" : "text-rose-400/70")}>{pct.toFixed(1)}%</span>
                    {isRec && <span className="text-emerald-400 text-[10px] font-semibold">← recommended</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 text-center">
          <Calculator size={22} className="text-slate-600 mx-auto mb-2" />
          <div className="text-xs text-slate-500 leading-relaxed">Enter entry price and stop loss<br />to calculate position size</div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ACCOUNT — BALANCE CARD & SETTINGS
   ============================================================ */
function AccountBalanceCard({ account, a }) {
  const cur = account.currency || "€";
  const startBal = parseFloat(account.startingBalance) || 0;
  const currentBal = startBal + (a.netProfit || 0);
  const growthAmt = currentBal - startBal;
  const growthPct = startBal !== 0 ? (growthAmt / startBal) * 100 : null;
  const isPositive = currentBal >= startBal;

  const pnlRow = (label, val, cls) => (
    <div className="flex items-center justify-between py-2 border-b border-slate-800/60 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cx("text-sm font-semibold", cls)}>{fmtBalSigned(val, cur)}</span>
    </div>
  );

  return (
    <div className="rounded-2xl border border-amber-500/25 overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1a1000 100%)" }}>
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <Wallet size={16} className="text-amber-400" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-400/80">Account Balance</div>
              <div className="text-[11px] text-slate-500">Starting {fmtBal(startBal, cur)}</div>
            </div>
          </div>
          {growthPct !== null && (
            <div className={cx("flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold",
              isPositive ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400")}>
              {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {growthPct > 0 ? "+" : ""}{growthPct.toFixed(2)}%
            </div>
          )}
        </div>

        <div className="mb-1">
          <div className="text-[11px] text-slate-500 mb-0.5">Current Balance</div>
          <div className={cx("text-4xl font-bold tracking-tight", isPositive ? "text-emerald-400" : "text-rose-400")}
            style={{ fontFamily: "'Sora', sans-serif" }}>
            {fmtBal(currentBal, cur)}
          </div>
          <div className={cx("text-sm font-medium mt-1", growthAmt >= 0 ? "text-emerald-400/80" : "text-rose-400/80")}>
            {fmtBalSigned(growthAmt, cur)} all time
          </div>
        </div>
      </div>

      <div className="px-5 pb-3">
        {pnlRow("Today's P/L", a.dayPnl, a.dayPnl >= 0 ? "text-emerald-400" : "text-rose-400")}
        {pnlRow("This Week", a.weekPnl, a.weekPnl >= 0 ? "text-emerald-400" : "text-rose-400")}
        {pnlRow("This Month", a.monthPnl, a.monthPnl >= 0 ? "text-emerald-400" : "text-rose-400")}
      </div>

      <div className="px-4 pb-4">
        <div className="text-[10px] uppercase tracking-wide text-slate-600 font-medium mb-1.5">Equity Curve</div>
        {a.closedTrades.length > 0 ? (
          <div style={{ width: "100%", height: 90 }}>
            <ResponsiveContainer>
              <LineChart data={(() => {
                const sorted = [...a.closedTrades].filter((t) => t.date).sort((x, y) => x.date.localeCompare(y.date));
                let run = startBal;
                return sorted.map((t) => { run += t.c.pnl || 0; return { bal: Math.round(run * 100) / 100 }; });
              })()}>
                <Line type="monotone" dataKey="bal" stroke={isPositive ? "#34d399" : "#f87171"} strokeWidth={2} dot={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }}
                  formatter={(v) => [fmtBal(v, cur), "Balance"]} labelFormatter={() => ""} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-14 flex items-center justify-center text-xs text-slate-600">Log closed trades to see your equity curve</div>
        )}
      </div>
    </div>
  );
}

function AccountSettings({ data, setData }) {
  const acc = data.account || { startingBalance: 1000, currency: "€" };
  const [bal, setBal] = useState(String(acc.startingBalance));
  const [cur, setCur] = useState(acc.currency);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setBal(String(acc.startingBalance)); setCur(acc.currency); setSaved(false); }, [acc.startingBalance, acc.currency]);

  const save = () => {
    const parsed = parseFloat(bal);
    if (isNaN(parsed) || parsed < 0) return;
    setData((d) => ({ ...d, account: { startingBalance: parsed, currency: cur } }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      <SectionTitle sub="Set your starting balance and currency">Account Settings</SectionTitle>
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Wallet size={16} className="text-amber-400" />
          <span className="font-semibold text-slate-100 text-sm">Account Configuration</span>
        </div>
        <Field label="Starting Account Balance" hint="The balance you started trading with. All P/L is calculated relative to this.">
          <div className="flex gap-2">
            <span className="flex items-center px-3 bg-slate-800 border border-slate-700 rounded-xl text-amber-400 font-semibold text-sm shrink-0">{cur}</span>
            <input type="number" step="0.01" min="0" value={bal} onChange={(e) => { setBal(e.target.value); setSaved(false); }}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50" />
          </div>
        </Field>
        <Field label="Account Currency">
          <div className="grid grid-cols-4 gap-2">
            {CURRENCIES.map(({ symbol }) => (
              <button key={symbol} onClick={() => { setCur(symbol); setSaved(false); }}
                className={cx("py-2.5 rounded-xl text-sm font-semibold border transition",
                  cur === symbol ? "bg-amber-500/15 border-amber-500/40 text-amber-400" : "bg-slate-900 border-slate-700 text-slate-400")}>
                {symbol}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-600 mt-1.5">{CURRENCIES.find((c) => c.symbol === cur)?.label}</div>
        </Field>
        <button onClick={save} className={cx("w-full py-3 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2",
          saved ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400" : "bg-amber-500 hover:bg-amber-400 text-slate-950")}>
          {saved ? <><Check size={16} /> Saved!</> : "Save Account Settings"}
        </button>
      </Card>

      <Card className="border-slate-800/50">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-2">How balance is calculated</div>
        <ul className="space-y-1.5">
          <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400">▸</span>Current Balance = Starting Balance + sum of all closed trade P/L</li>
          <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400">▸</span>Each winning trade adds its P/L to your balance automatically</li>
          <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400">▸</span>Each losing trade deducts its P/L (losses are negative P/L)</li>
          <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400">▸</span>Enter position sizes in your account currency for accurate tracking</li>
          <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400">▸</span>Open trades are not counted until you add an exit price</li>
        </ul>
      </Card>
    </div>
  );
}

/* ============================================================
   DASHBOARD — MORNING CHECK-IN
   ============================================================ */
function emptyCheckin(date) {
  return {
    id: null, date, mood: 5, confidence: 5, stress: 5, energy: 5,
    dailyGoal: "", dailyLossLimit: "", notes: "",
    checklist: { news: false, bias: false, plan: false, risk: false, setup: false },
  };
}

function RatingSlider({ label, value, onChange, icon: Icon }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
          {Icon && <Icon size={13} className="text-amber-400" />}{label}
        </span>
        <span className="text-sm font-semibold text-amber-400">{value}/10</span>
      </div>
      <input type="range" min="1" max="10" value={value} onChange={(e) => onChange(parseInt(e.target.value))} className="w-full accent-amber-500" />
    </div>
  );
}

const CHECKLIST_FIELDS = [
  ["news", "Economic news checked"],
  ["bias", "Market bias defined"],
  ["plan", "Trading plan reviewed"],
  ["risk", "Risk limits confirmed"],
  ["setup", "Trading setup confirmed"],
];

function MorningCheckIn({ data, setData }) {
  const today = todayISO();
  const existing = data.checkins.find((c) => c.date === today) || null;
  const [editing, setEditing] = useState(!existing);
  const [form, setForm] = useState(existing || emptyCheckin(today));

  useEffect(() => {
    setForm(existing || emptyCheckin(today));
    if (!existing) setEditing(true);
  }, [existing ? existing.id : null]);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleCheck = (k) => setForm((f) => ({ ...f, checklist: { ...f.checklist, [k]: !f.checklist[k] } }));

  const save = () => {
    setData((d) => {
      const exists = d.checkins.some((c) => c.date === today);
      const record = { ...form, id: form.id || uid(), date: today };
      const checkins = exists ? d.checkins.map((c) => (c.date === today ? record : c)) : [...d.checkins, record];
      return { ...d, checkins };
    });
    setEditing(false);
  };

  if (!editing && existing) {
    const checklistDone = Object.values(existing.checklist || {}).filter(Boolean).length;
    return (
      <Card className="border-amber-500/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            <span className="font-semibold text-slate-100 text-sm">Morning Check-In</span>
          </div>
          <button onClick={() => { setForm(existing); setEditing(true); }} className="text-xs text-amber-400 font-medium flex items-center gap-1">
            <Pencil size={12} /> Edit
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center mb-3">
          <div><div className="text-sm font-semibold text-slate-200">{existing.mood}/10</div><div className="text-[10px] text-slate-500">Mood</div></div>
          <div><div className="text-sm font-semibold text-slate-200">{existing.confidence}/10</div><div className="text-[10px] text-slate-500">Confidence</div></div>
          <div><div className="text-sm font-semibold text-slate-200">{existing.stress}/10</div><div className="text-[10px] text-slate-500">Stress</div></div>
          <div><div className="text-sm font-semibold text-slate-200">{existing.energy}/10</div><div className="text-[10px] text-slate-500">Energy</div></div>
        </div>
        {existing.dailyGoal && <p className="text-xs text-slate-400 mb-1"><span className="text-slate-500">Goal: </span>{existing.dailyGoal}</p>}
        <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
          <span>Pre-market checklist</span>
          <Pill tone={checklistDone === 5 ? "emerald" : "amber"}>{checklistDone}/5 complete</Pill>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/20">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-amber-400" />
        <span className="font-semibold text-slate-100 text-sm">Morning Check-In</span>
        <span className="text-[11px] text-slate-500">— {today}</span>
      </div>
      <RatingSlider label="Psychological Mood" value={form.mood} onChange={(v) => setForm((f) => ({ ...f, mood: v }))} icon={Smile} />
      <RatingSlider label="Confidence" value={form.confidence} onChange={(v) => setForm((f) => ({ ...f, confidence: v }))} icon={Trophy} />
      <RatingSlider label="Stress Level" value={form.stress} onChange={(v) => setForm((f) => ({ ...f, stress: v }))} icon={AlertCircle} />
      <RatingSlider label="Energy Level" value={form.energy} onChange={(v) => setForm((f) => ({ ...f, energy: v }))} icon={Zap} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Daily trading goal"><TextInput value={form.dailyGoal} onChange={setField("dailyGoal")} placeholder="e.g. 2 A+ setups only" /></Field>
        <Field label="Daily loss limit"><TextInput value={form.dailyLossLimit} onChange={setField("dailyLossLimit")} placeholder="e.g. 2% of account" /></Field>
      </div>
      <Field label="Emotional state notes"><TextArea value={form.notes} onChange={setField("notes")} placeholder="How are you feeling before the session?" /></Field>
      <div className="mb-3">
        <div className="text-xs font-medium text-slate-400 mb-1.5">Pre-Market Checklist</div>
        <div className="space-y-1.5">
          {CHECKLIST_FIELDS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
              <input type="checkbox" checked={form.checklist[key]} onChange={() => toggleCheck(key)} className="accent-amber-500" />
              {label}
            </label>
          ))}
        </div>
      </div>
      <button onClick={save} className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2.5 rounded-xl text-sm transition">
        Save Check-In
      </button>
    </Card>
  );
}

/* ============================================================
   DASHBOARD — YOUR EDGE PANEL
   ============================================================ */
function EdgeRow({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-800/70 last:border-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon size={15} className="text-amber-400 shrink-0" />
        <span className="text-sm text-slate-300">{label}</span>
      </div>
      <div className="text-right min-w-0">
        <div className="text-sm font-semibold text-slate-100 truncate">{value}</div>
        {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function YourEdgePanel({ a }) {
  return (
    <Card>
      <SectionTitle sub="What's working, based on your closed trades">Your Edge</SectionTitle>
      <EdgeRow icon={Trophy} label="Best Strategy" value={a.bestStrategy ? a.bestStrategy.label : "—"} sub={a.bestStrategy ? fmtSigned(a.bestStrategy.pnl) : "Tag a strategy on your trades"} />
      <EdgeRow icon={Layers} label="Best Setup" value={a.bestSetup ? a.bestSetup.label : "—"} sub={a.bestSetup ? fmtSigned(a.bestSetup.pnl) : "Tag a setup on your trades"} />
      <EdgeRow icon={Calendar} label="Best Trading Day" value={a.bestDay ? a.bestDay.label : "—"} sub={a.bestDay ? fmtSigned(a.bestDay.pnl) : "—"} />
      <EdgeRow icon={CalendarDays} label="Best Trading Session" value={a.bestSession ? a.bestSession.label : "—"} sub={a.bestSession ? fmtSigned(a.bestSession.pnl) : "Tag a session on your trades"} />
      <EdgeRow icon={Target} label="Highest Win-Rate Market" value={a.bestMarket ? a.bestMarket.label : "—"} sub={a.bestMarket ? fmtPct(a.bestMarket.winRate) : "—"} />
      <EdgeRow icon={DollarSign} label="Most Profitable Asset" value={a.bestSymbol ? a.bestSymbol.label : "—"} sub={a.bestSymbol ? fmtSigned(a.bestSymbol.pnl) : "—"} />
      <div className="mt-3 pt-3 border-t border-slate-800/70">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-2 flex items-center gap-1.5">
          <Sparkles size={12} />Personal Trading Strengths
        </div>
        <ul className="space-y-1.5">
          {a.strengths.map((s, i) => (
            <li key={i} className="text-sm text-slate-300 flex gap-2"><CheckCircle2 size={14} className="text-emerald-400/80 mt-0.5 shrink-0" />{s}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/* ============================================================
   DASHBOARD — DETAILED STATISTICS
   ============================================================ */
function DetailedStatsPanel({ a }) {
  const streakLabel = a.currentStreakType ? `${a.currentStreakLength} ${a.currentStreakType}${a.currentStreakLength > 1 ? "s" : ""}` : "—";
  return (
    <Card>
      <SectionTitle sub="The full breakdown behind your numbers">Detailed Statistics</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatCard label="Gross Profit" value={fmtSigned(a.grossProfit)} tone="emerald" icon={TrendingUp} />
        <StatCard label="Gross Loss" value={fmtSigned(-a.grossLoss)} tone="rose" icon={TrendingDown} />
        <StatCard label="Net Profit" value={fmtSigned(a.netProfit)} tone={a.netProfit >= 0 ? "emerald" : "rose"} icon={DollarSign} />
        <StatCard label="Trade Quality Score" value={a.qualityScore === null ? "—" : a.qualityScore} sub="0–100 composite" icon={Gauge} />
        <StatCard label="Best Win Streak" value={a.bestWinStreak} tone="emerald" icon={Flame} />
        <StatCard label="Worst Loss Streak" value={a.bestLossStreak} tone="rose" icon={Flame} />
        <StatCard label="Current Streak" value={streakLabel} tone={a.currentStreakType === "Win" ? "emerald" : a.currentStreakType === "Loss" ? "rose" : "slate"} icon={Activity} />
        <StatCard label="Avg Trade Duration" value={formatMinutes(a.avgHoldMinutes)} icon={ClipboardList} />
        <StatCard label="Broker Fees" value={fmt2(a.totalFees)} icon={DollarSign} />
        <StatCard label="Commissions" value={fmt2(a.totalCommission)} icon={DollarSign} />
      </div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-2">Risk Exposure</div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Avg Risk / Trade" value={a.avgRiskPct === null ? "—" : a.avgRiskPct.toFixed(2) + "%"} icon={ShieldAlert} />
        <StatCard label="Max Risk Taken" value={a.maxRiskPct === null ? "—" : a.maxRiskPct.toFixed(2) + "%"} icon={AlertCircle} />
        <StatCard label="Open Exposure" value={a.openRiskExposure.toFixed(2) + "%"} tone={a.openRiskExposure > 0 ? "amber" : "slate"} icon={ShieldAlert} />
      </div>
    </Card>
  );
}

/* ============================================================
   DASHBOARD — TRADING CALENDAR
   ============================================================ */
function TradingCalendar({ a }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);

  const dayMap = useMemo(() => {
    const map = {};
    a.computedTrades.forEach((t) => {
      if (!t.date) return;
      (map[t.date] = map[t.date] || []).push(t);
    });
    return map;
  }, [a.computedTrades]);

  const weeks = useMemo(() => getMonthMatrix(year, month), [year, month]);

  const monthStats = useMemo(() => {
    let tradingDays = 0, best = null, worst = null, closedCount = 0, winCount = 0, monthPnl = 0, tradesCount = 0;
    Object.entries(dayMap).forEach(([iso, list]) => {
      const d = new Date(iso + "T12:00:00");
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      tradingDays++;
      tradesCount += list.length;
      const pnl = list.reduce((s, t) => s + (t.c.pnl || 0), 0);
      monthPnl += pnl;
      list.forEach((t) => { if (t.c.result) { closedCount++; if (t.c.result === "Win") winCount++; } });
      if (!best || pnl > best.pnl) best = { iso, pnl };
      if (!worst || pnl < worst.pnl) worst = { iso, pnl };
    });
    return { tradingDays, best, worst, winRate: closedCount ? (winCount / closedCount) * 100 : null, monthPnl, tradesCount };
  }, [dayMap, year, month]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };
  const monthLabelStr = new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <Card>
      <SectionTitle sub="Tap any day to see its trades">Trading Calendar</SectionTitle>
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1.5 rounded-lg bg-slate-800 text-slate-300"><ChevronLeft size={16} /></button>
        <span className="text-sm font-medium text-slate-200">{monthLabelStr}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg bg-slate-800 text-slate-300"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="text-center text-[10px] text-slate-500 font-medium">{d}</div>)}
      </div>
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((cell, ci) => {
              if (!cell.inMonth) return <div key={ci} className="h-12 rounded-lg" />;
              const list = dayMap[cell.iso] || [];
              const pnl = list.reduce((s, t) => s + (t.c.pnl || 0), 0);
              const tone = !list.length ? "bg-slate-900 border-slate-800" : pnl > 0 ? "bg-emerald-500/15 border-emerald-500/40" : pnl < 0 ? "bg-rose-500/15 border-rose-500/40" : "bg-slate-800 border-slate-700";
              return (
                <button key={ci} onClick={() => list.length && setSelectedDay(cell.iso)}
                  className={cx("h-12 rounded-lg border flex flex-col items-center justify-center", tone, list.length && "active:scale-95")}>
                  <span className="text-[10px] text-slate-400">{cell.dayNum}</span>
                  {list.length > 0 && <span className={cx("text-[10px] font-semibold", pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{pnl >= 0 ? "+" : ""}{Math.round(pnl)}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800/70 text-center">
        <div><div className="text-xs font-semibold text-slate-200">{monthStats.tradingDays}</div><div className="text-[10px] text-slate-500">Trading Days</div></div>
        <div><div className="text-xs font-semibold text-slate-200">{monthStats.winRate === null ? "—" : fmtPct(monthStats.winRate)}</div><div className="text-[10px] text-slate-500">Win Rate</div></div>
        <div><div className={cx("text-xs font-semibold", monthStats.monthPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtSigned(monthStats.monthPnl)}</div><div className="text-[10px] text-slate-500">Month P/L</div></div>
        <div><div className="text-xs font-semibold text-emerald-400">{monthStats.best ? fmtDay(monthStats.best.iso) : "—"}</div><div className="text-[10px] text-slate-500">Best Day</div></div>
        <div><div className="text-xs font-semibold text-rose-400">{monthStats.worst ? fmtDay(monthStats.worst.iso) : "—"}</div><div className="text-[10px] text-slate-500">Worst Day</div></div>
        <div><div className="text-xs font-semibold text-slate-200">{monthStats.tradesCount}</div><div className="text-[10px] text-slate-500">Trades</div></div>
      </div>

      <Modal open={!!selectedDay} onClose={() => setSelectedDay(null)} title={selectedDay ? fmtDay(selectedDay) : ""}>
        {selectedDay && (dayMap[selectedDay] || []).map((t) => (
          <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-slate-800/70 last:border-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {t.side === "Sell" ? <TrendingDown size={15} className="text-rose-400 shrink-0" /> : <TrendingUp size={15} className="text-emerald-400 shrink-0" />}
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-200 truncate">{t.symbol || "—"}</div>
                <div className="text-[11px] text-slate-500">{t.market}{t.session ? ` · ${t.session}` : ""}</div>
              </div>
            </div>
            <div className="text-right">
              <div className={cx("text-sm font-semibold", t.c.pnl === null ? "text-slate-500" : t.c.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtSigned(t.c.pnl)}</div>
              <Pill tone={RESULT_TONE[t.c.result || "Open"]}>{t.c.result || "Open"}</Pill>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-slate-600 mt-3">Edit or delete trades from the Journal tab.</p>
      </Modal>
    </Card>
  );
}

/* ============================================================
   DASHBOARD — EQUITY CURVE
   ============================================================ */
function EquityCurve({ closedTrades }) {
  const curveData = useMemo(() => {
    const sorted = [...closedTrades].filter((t) => t.date).sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    return sorted.map((t) => {
      running += t.c.pnl || 0;
      return { date: t.date, pnl: Math.round(running * 100) / 100, sym: t.symbol };
    });
  }, [closedTrades]);

  if (!curveData.length) return (
    <Card>
      <SectionTitle sub="Cumulative P/L over time">Equity Curve</SectionTitle>
      <EmptyState icon={TrendingUp} title="No closed trades yet" sub="Your equity curve will appear here as you log closed trades." />
    </Card>
  );

  const isGreen = curveData[curveData.length - 1]?.pnl >= 0;
  return (
    <Card>
      <SectionTitle sub="Cumulative net P/L, all time">Equity Curve</SectionTitle>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={curveData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: "#94a3b8" }}
              formatter={(v) => [fmtSigned(v), "Cumulative P/L"]}
            />
            <Line type="monotone" dataKey="pnl" stroke={isGreen ? "#34d399" : "#f87171"} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/* ============================================================
   DASHBOARD — TODAY'S TRADING PLAN WIDGET
   ============================================================ */
function TodaysPlanWidget({ master }) {
  const sessions = [
    { name: "Pre London", timeUK: master.preLondonTime || "6:30am – 9:30am UK", color: "amber" },
    { name: "London", timeUK: master.londonTime || "8:00am – 12:00pm UK", color: "sky" },
  ];
  const focusPairs = (master.focusPairs || "XAUUSD, GBPJPY").split(",").map((s) => s.trim()).filter(Boolean);
  const dailyTarget = master.dailyTarget || "2%";
  const weeklyTarget = master.weeklyTarget || "7%";
  const monthlyTarget = master.monthlyTarget || "20%";
  const maxDailyLoss = master.maxDailyLoss || "3%";

  return (
    <Card className="border-amber-500/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <CalendarDays size={15} className="text-amber-400" />
          </div>
          <span className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Today's Trading Plan</span>
        </div>
        <span className="text-[11px] text-slate-500">{todayISO()}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {sessions.map((s) => (
          <div key={s.name} className={cx("rounded-xl border p-3", s.color === "amber" ? "bg-amber-500/5 border-amber-500/20" : "bg-sky-500/5 border-sky-500/20")}>
            <div className={cx("text-xs font-bold mb-0.5", s.color === "amber" ? "text-amber-400" : "text-sky-400")}>{s.name}</div>
            <div className="text-[11px] text-slate-400 leading-relaxed">{s.timeUK}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 mb-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-2">Focus Pairs</div>
        <div className="flex flex-wrap gap-1.5">
          {focusPairs.map((p) => (
            <span key={p} className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">{p}</span>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-3 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Maximum Daily Risk</div>
            <div className="text-lg font-bold text-rose-400 mt-0.5">{maxDailyLoss}</div>
          </div>
          <ShieldAlert size={22} className="text-rose-400/50" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-center">
          <div className="text-sm font-bold text-emerald-400">{dailyTarget}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Daily Goal</div>
        </div>
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-center">
          <div className="text-sm font-bold text-emerald-400">{weeklyTarget}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Weekly Goal</div>
        </div>
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-center">
          <div className="text-sm font-bold text-emerald-400">{monthlyTarget}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Monthly Goal</div>
        </div>
      </div>
    </Card>
  );
}

/* ============================================================
   DASHBOARD — TRADING RULES PANEL
   ============================================================ */
const TRADING_RULES = {
  fundamental: [
    "Buy with the trend — confirm HTF direction first",
    "Focus on 30m and 1H timeframes for entry",
    "Trade only valid support and resistance zones",
    "Wait for full candle close confirmation before entry",
    "Trade clean candles only — avoid indecision wicks",
    "Avoid gaps — don't trade directly into gap zones",
    "Breakout must break AND close beyond S/R level",
  ],
  range: [
    { label: "20+ pips", note: "Good — take the setup", tone: "emerald" },
    { label: "15–20 pips", note: "Acceptable — proceed with caution", tone: "amber" },
    { label: "Below 15 pips", note: "Avoid — range too tight", tone: "rose" },
  ],
  sl: [
    { label: "Below 20 pips", note: "Ideal stop-loss", tone: "emerald" },
    { label: "20–30 pips", note: "Acceptable stop-loss", tone: "amber" },
    { label: "Above 30 pips", note: "No Trade — risk too large", tone: "rose" },
  ],
  tp: [
    "Target logical HTF levels — don't set arbitrary TPs",
    "Secure profits around rejection wicks",
    "Secure 80% of position after 10–15 pips in profit",
    "Leave runner only when HTF trend is confirmed",
  ],
};

function RuleRow({ text, tone }) {
  const dot = { emerald: "bg-emerald-400", amber: "bg-amber-400", rose: "bg-rose-400", slate: "bg-slate-500" }[tone || "slate"];
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={cx("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", dot)} />
      <span className="text-sm text-slate-300 leading-snug">{text}</span>
    </div>
  );
}

function RuleCard({ label, note, tone }) {
  const styles = {
    emerald: "bg-emerald-500/8 border-emerald-500/25 text-emerald-400",
    amber: "bg-amber-500/8 border-amber-500/25 text-amber-400",
    rose: "bg-rose-500/8 border-rose-500/25 text-rose-400",
  };
  return (
    <div className={cx("rounded-xl border px-3 py-2.5 flex items-center justify-between", styles[tone] || styles.slate)}>
      <span className="font-semibold text-sm">{label}</span>
      <span className="text-xs text-slate-400">{note}</span>
    </div>
  );
}

function TradingRulesPanel() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center">
            <ListChecks size={15} className="text-amber-400" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Trading Rules</div>
            <div className="text-[11px] text-slate-500">Tap to expand your core rules</div>
          </div>
        </div>
        <ChevronDown size={16} className={cx("text-slate-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-amber-400 font-semibold mb-2">Fundamental Rules</div>
            {TRADING_RULES.fundamental.map((r, i) => <RuleRow key={i} text={r} tone="slate" />)}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-amber-400 font-semibold mb-2">Range Rules</div>
            <div className="space-y-1.5">
              {TRADING_RULES.range.map((r, i) => <RuleCard key={i} {...r} />)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-amber-400 font-semibold mb-2">Stop Loss Rules</div>
            <div className="space-y-1.5">
              {TRADING_RULES.sl.map((r, i) => <RuleCard key={i} {...r} />)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-amber-400 font-semibold mb-2">Take Profit Rules</div>
            {TRADING_RULES.tp.map((r, i) => <RuleRow key={i} text={r} tone="slate" />)}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   DASHBOARD — CANDLE CONFIRMATION CHECKLIST
   ============================================================ */
const CANDLE_CHECKS = [
  { id: "htf_trend", label: "HTF trend confirmed", desc: "Higher timeframe direction is clear" },
  { id: "sr_confirmed", label: "Support / Resistance confirmed", desc: "Clean, tested level on H1 or above" },
  { id: "candle_close", label: "Healthy candle close", desc: "Full body close, not a wick or doji" },
  { id: "volume", label: "Volume present", desc: "Increased volume at the zone" },
  { id: "range_ok", label: "Range acceptable", desc: "20+ pip range — 15–20 acceptable" },
  { id: "no_consol", label: "No consolidation", desc: "Price is moving, not chopping sideways" },
  { id: "no_htf_level", label: "No nearby major HTF level", desc: "No overhead S/R within the target range" },
];

function CandleChecklist() {
  const [checks, setChecks] = useState({});
  const toggle = (id) => setChecks((c) => ({ ...c, [id]: !c[id] }));
  const done = CANDLE_CHECKS.filter((c) => checks[c.id]).length;
  const allDone = done === CANDLE_CHECKS.length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center">
            <CheckCircle2 size={15} className="text-emerald-400" />
          </div>
          <div>
            <div className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Candle Confirmation</div>
            <div className="text-[11px] text-slate-500">Pre-trade checklist</div>
          </div>
        </div>
        <div className="text-right">
          <div className={cx("text-sm font-bold", allDone ? "text-emerald-400" : "text-amber-400")}>{done}/{CANDLE_CHECKS.length}</div>
          {allDone && <div className="text-[10px] text-emerald-400">Ready to trade</div>}
        </div>
      </div>
      <div className="space-y-2">
        {CANDLE_CHECKS.map((c) => (
          <button key={c.id} onClick={() => toggle(c.id)} className={cx(
            "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition",
            checks[c.id] ? "bg-emerald-500/8 border-emerald-500/30" : "bg-slate-900 border-slate-800"
          )}>
            <div className={cx("w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
              checks[c.id] ? "bg-emerald-500 border-emerald-500" : "border-slate-600")}>
              {checks[c.id] && <Check size={12} className="text-slate-950 font-bold" />}
            </div>
            <div>
              <div className={cx("text-sm font-medium", checks[c.id] ? "text-emerald-400" : "text-slate-200")}>{c.label}</div>
              <div className="text-[11px] text-slate-500">{c.desc}</div>
            </div>
          </button>
        ))}
      </div>
      {done > 0 && (
        <button onClick={() => setChecks({})} className="mt-3 text-xs text-slate-500 hover:text-slate-300 w-full text-center py-1.5">
          Reset checklist
        </button>
      )}
    </Card>
  );
}

/* ============================================================
   DASHBOARD — TRADER MINDSET WIDGET
   ============================================================ */
function TraderMindset() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  const quote = TRADER_QUOTES[dayIndex % TRADER_QUOTES.length];
  const tomorrow = TRADER_QUOTES[(dayIndex + 1) % TRADER_QUOTES.length];

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1c1400 100%)", border: "1px solid rgba(251,191,36,0.2)" }}>
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-amber-400" />
          <span className="text-[11px] uppercase tracking-wide text-amber-400/80 font-semibold">Trader Mindset</span>
          <span className="ml-auto text-[10px] text-slate-600">Daily · changes at midnight</span>
        </div>
        <blockquote className="text-base font-medium text-slate-100 leading-relaxed mb-2" style={{ fontFamily: "'Sora', sans-serif" }}>
          "{quote.q}"
        </blockquote>
        <cite className="text-xs text-amber-400/70 not-italic">— {quote.src}</cite>
      </div>
      <div className="px-5 py-2.5 border-t border-slate-800/60 flex items-center gap-2">
        <span className="text-[10px] text-slate-600">Tomorrow:</span>
        <span className="text-[11px] text-slate-500 italic truncate">"{tomorrow.q}"</span>
      </div>
    </div>
  );
}

/* ============================================================
   DASHBOARD — DAILY RULES REMINDER
   ============================================================ */
function DailyRulesReminder() {
  const rules = useMemo(() => getDailyItems(ALL_RULE_REMINDERS, 4), []);
  const [checked, setChecked] = useState({});
  const toggle = (i) => setChecked((c) => ({ ...c, [i]: !c[i] }));

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListChecks size={15} className="text-amber-400" />
          <span className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Today's Rules</span>
        </div>
        <span className="text-[11px] text-slate-500">4 daily reminders</span>
      </div>
      <div className="space-y-2">
        {rules.map((rule, i) => (
          <button key={i} onClick={() => toggle(i)}
            className={cx("w-full flex items-center gap-3 p-3 rounded-xl border text-left transition",
              checked[i] ? "bg-amber-500/8 border-amber-500/25" : "bg-slate-900 border-slate-800")}>
            <div className={cx("w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition",
              checked[i] ? "bg-amber-500 border-amber-500" : "border-slate-600")}>
              {checked[i] && <Check size={11} className="text-slate-950" />}
            </div>
            <span className={cx("text-sm leading-snug", checked[i] ? "text-amber-400 line-through" : "text-slate-300")}>{rule}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ============================================================
   DASHBOARD — AI INSIGHTS (STATIC RULE-BASED)
   ============================================================ */
function AIInsights({ a, account }) {
  const cur = (account || {}).currency || "€";

  const insights = useMemo(() => {
    const out = [];

    // Streak insight
    if (a.currentStreakType === "Win" && a.currentStreakLength >= 2)
      out.push({ icon: Flame, color: "text-emerald-400", text: `You're on a ${a.currentStreakLength}-win streak. Stay disciplined — don't let confidence drift into overtrading.` });
    else if (a.currentStreakType === "Loss" && a.currentStreakLength >= 2)
      out.push({ icon: ShieldAlert, color: "text-rose-400", text: `${a.currentStreakLength} consecutive losses. Consider a review session before your next trade.` });

    // Best day insight
    if (a.bestDay)
      out.push({ icon: CalendarDays, color: "text-sky-400", text: `You perform best on ${a.bestDay.label}s. Look for A+ setups on this day first.` });

    // Win rate insight
    if (a.winRate !== null && a.winRate >= 60)
      out.push({ icon: Target, color: "text-emerald-400", text: `Your win rate of ${fmtPct(a.winRate)} is strong. Make sure you're also protecting gains — profit factor matters more than win rate alone.` });
    else if (a.winRate !== null && a.winRate < 45)
      out.push({ icon: AlertCircle, color: "text-amber-400", text: `Win rate is ${fmtPct(a.winRate)}. Focus on taking only A+ setups and cutting losers faster — quality over quantity.` });

    // Best session
    if (a.bestSession)
      out.push({ icon: Activity, color: "text-amber-400", text: `Your ${a.bestSession.label} session trades are most profitable. Prioritise this window.` });

    // Best setup
    if (a.bestSetup && a.bestSetup.pnl > 0)
      out.push({ icon: Layers, color: "text-sky-400", text: `"${a.bestSetup.label}" is your best-performing setup (${fmtBal(a.bestSetup.pnl, cur)} net P/L). Stick to what works.` });

    // Risk insight
    if (a.avgRiskPct !== null && a.avgRiskPct > 2)
      out.push({ icon: ShieldAlert, color: "text-rose-400", text: `Average risk per trade is ${a.avgRiskPct.toFixed(2)}% — above the 1–2% SRC guideline. Consider reducing size.` });

    // Profit factor
    if (a.profitFactor !== null && a.profitFactor !== Infinity && a.profitFactor >= 2)
      out.push({ icon: TrendingUp, color: "text-emerald-400", text: `Profit factor of ${fmt2(a.profitFactor)} shows your winners are outperforming your losers. Keep protecting those wins.` });

    // Quality score
    if (a.qualityScore !== null && a.qualityScore >= 70)
      out.push({ icon: Trophy, color: "text-amber-400", text: `Trade Quality Score: ${a.qualityScore}/100. You're executing with discipline.` });

    // Default
    if (!out.length)
      out.push({ icon: Sparkles, color: "text-slate-400", text: `Log a few more closed trades and your personal AI insights will appear here — strengths, patterns, and risk alerts.` });

    return out.slice(0, 4);
  }, [a, cur]);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center">
          <Sparkles size={14} className="text-purple-400" />
        </div>
        <div>
          <div className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Trading Insights</div>
          <div className="text-[11px] text-slate-500">Your edge, from your data</div>
        </div>
      </div>
      <div className="space-y-3">
        {insights.map((ins, i) => (
          <div key={i} className="flex items-start gap-3">
            <ins.icon size={15} className={cx(ins.color, "mt-0.5 shrink-0")} />
            <p className="text-sm text-slate-300 leading-snug">{ins.text}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function Dashboard({ data, setData, goTo }) {
  const a = useMemo(() => computeAnalytics(data), [data.trades, data.strategies, data.setups]);
  const acc = data.account || { startingBalance: 1000, currency: "€" };
  const cur = acc.currency || "€";
  const recentTrades = [...a.computedTrades].sort((x, y) => (y.date || "").localeCompare(x.date || "")).slice(0, 5);

  const kpiRow = [
    { label: "Daily P/L", value: fmtBalSigned(a.dayPnl, cur), tone: a.dayPnl >= 0 ? "emerald" : "rose" },
    { label: "Win Rate", value: a.winRate === null ? "—" : fmtPct(a.winRate), tone: a.winRate === null ? "slate" : a.winRate >= 50 ? "emerald" : "rose" },
    { label: "Profit Factor", value: a.profitFactor === null ? "—" : a.profitFactor === Infinity ? "∞" : fmt2(a.profitFactor), tone: a.profitFactor === null ? "slate" : a.profitFactor >= 1 ? "emerald" : "rose" },
    { label: "Avg R:R", value: a.avgRR === null ? "—" : fmt2(a.avgRR) + "R" },
    { label: "Total Trades", value: a.totalTrades, sub: `${a.closedCount} closed` },
    { label: "Quality Score", value: a.qualityScore === null ? "—" : a.qualityScore + "/100" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Crown size={17} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>SRC Trading OS</h1>
            <p className="text-[11px] text-slate-500">{todayISO()}</p>
          </div>
        </div>
        <button onClick={() => goTo("more", "Account")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-amber-400">
          <Pencil size={12} /> Account
        </button>
      </div>

      {/* #1 — Account Balance Card (largest, most important) */}
      <AccountBalanceCard account={acc} a={a} />

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-2">
        {kpiRow.map((k, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-center">
            <div className={cx("text-sm font-bold leading-tight", {
              emerald: "text-emerald-400", rose: "text-rose-400", amber: "text-amber-400"
            }[k.tone] || "text-slate-100")} style={{ fontFamily: "'Sora', sans-serif" }}>{k.value}</div>
            {k.sub && <div className="text-[10px] text-slate-600">{k.sub}</div>}
            <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Morning Check-In */}
      <MorningCheckIn data={data} setData={setData} />

      {/* Trader Mindset — daily quote */}
      <TraderMindset />

      {/* Daily Rules Reminder */}
      <DailyRulesReminder />

      {/* Today's Trading Plan */}
      <TodaysPlanWidget master={data.plans.master} />

      {/* Trading Rules */}
      <TradingRulesPanel />

      {/* Position Size Calculator */}
      <Card>
        <PositionSizeCalc account={acc} />
      </Card>

      {/* AI Insights */}
      <AIInsights a={a} account={acc} />

      {/* Candle Checklist */}
      <CandleChecklist />

      {/* Trading Calendar */}
      <TradingCalendar a={a} />

      {/* Recent Trades */}
      <Card>
        <SectionTitle action={<button onClick={() => goTo("journal")} className="text-xs text-amber-400 font-medium">View all →</button>}>Recent Trades</SectionTitle>
        {recentTrades.length ? (
          <div className="space-y-0">
            {recentTrades.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-slate-800/60 last:border-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  {t.side === "Sell" ? <TrendingDown size={15} className="text-rose-400 shrink-0" /> : <TrendingUp size={15} className="text-emerald-400 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-200">{t.symbol || "—"}</div>
                    <div className="text-[11px] text-slate-500">{t.date}{t.session ? ` · ${t.session}` : ""}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cx("text-sm font-semibold", t.c.pnl === null ? "text-slate-500" : t.c.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtBalSigned(t.c.pnl, cur)}</span>
                  <Pill tone={RESULT_TONE[t.c.result || "Open"]}>{t.c.result || "Open"}</Pill>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="No trades yet" sub="Tap Log Trade in the Journal tab to get started." />
        )}
      </Card>

      {/* Your Edge */}
      <YourEdgePanel a={a} />

      {/* Detailed Stats */}
      <DetailedStatsPanel a={a} />
    </div>
  );
}


/* ============================================================
   JOURNAL — TRADE FORM
   ============================================================ */
function emptyTrade() {
  return {
    id: null, date: todayISO(), symbol: "", market: "Forex", side: "Buy",
    entry: "", exit: "", sl: "", tp: "", riskPct: "", positionSize: "",
    strategyId: "", setupId: "", notes: "", attachments: [],
    session: "", entryTime: "", exitDate: "", exitTime: "", fees: "", commission: "",
    tradeType: "Normal",
  };
}

function TradeForm({ open, onClose, onSave, initial, setups, strategies, account }) {
  const [form, setForm] = useState(emptyTrade());
  const [step, setStep] = useState(0);
  useEffect(() => { setForm(initial || emptyTrade()); setStep(0); }, [initial, open]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const live = useMemo(() => computeTrade(form), [form]);

  const acc = account || { startingBalance: 1000, currency: "€" };
  const cur = acc.currency || "€";
  const riskPctNum = parseFloat(form.riskPct);
  const riskAmt = !isNaN(riskPctNum) && acc.startingBalance ? (riskPctNum / 100) * parseFloat(acc.startingBalance) : null;

  const save = () => {
    if (!form.symbol.trim()) return;
    onSave({ ...form, id: form.id || uid() });
  };

  const STEPS = ["Setup", "Entry", "Risk", "Notes", "Preview"];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Sticky header with back navigation */}
      <div className="border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onClose} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>{initial ? "Edit Trade" : "Log Trade"}</h2>
          {form.symbol && <p className="text-[11px] text-slate-500">{form.symbol} · {form.side} · {form.date}</p>}
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-amber-400">{fmtBal(parseFloat(acc.startingBalance) + (live.pnl || 0), cur)}</div>
          <div className="text-[10px] text-slate-600">Balance</div>
        </div>
      </div>

      {/* Step tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950 shrink-0">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)}
            className={cx("flex-1 py-2.5 text-xs font-medium transition border-b-2",
              step === i ? "border-amber-500 text-amber-400" : "border-transparent text-slate-500")}>
            {s}
          </button>
        ))}
      </div>

      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto p-4 pb-32">

        {/* Step 0: Setup */}
        {step === 0 && (
          <div className="space-y-0">
            <Field label="Symbol">
              <SymbolSelector value={form.symbol} onChange={(v) => setForm((f) => ({ ...f, symbol: v }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><TextInput type="date" value={form.date} onChange={set("date")} /></Field>
              <Field label="Market">
                <Select value={form.market} onChange={set("market")}>
                  {MARKET_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Direction">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm((f) => ({ ...f, side: "Buy" }))}
                  className={cx("py-3 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2",
                    form.side === "Buy" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" : "bg-slate-900 border-slate-700 text-slate-500")}>
                  <TrendingUp size={16} /> Buy / Long
                </button>
                <button type="button" onClick={() => setForm((f) => ({ ...f, side: "Sell" }))}
                  className={cx("py-3 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2",
                    form.side === "Sell" ? "bg-rose-500/15 border-rose-500/40 text-rose-400" : "bg-slate-900 border-slate-700 text-slate-500")}>
                  <TrendingDown size={16} /> Sell / Short
                </button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Trade Type">
                <div className="grid grid-cols-2 gap-2">
                  {["Normal", "Impulse"].map((t) => (
                    <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, tradeType: t }))}
                      className={cx("py-2 rounded-xl text-xs font-medium border",
                        form.tradeType === t ? "bg-amber-500/15 border-amber-500/40 text-amber-400" : "bg-slate-900 border-slate-700 text-slate-500")}>
                      {t}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Session">
                <Select value={form.session} onChange={set("session")}>
                  <option value="">Select session...</option>
                  {SESSION_OPTIONS.filter((s) => s !== "Unspecified").map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Setup used">
                <Select value={form.setupId} onChange={set("setupId")}>
                  <option value="">None</option>
                  {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Strategy">
                <Select value={form.strategyId} onChange={set("strategyId")}>
                  <option value="">None</option>
                  {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            </div>
          </div>
        )}

        {/* Step 1: Entry */}
        {step === 1 && (
          <div className="space-y-0">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Entry Price"><TextInput type="number" step="any" placeholder="0.00000" value={form.entry} onChange={set("entry")} /></Field>
              <Field label="Exit Price" hint="Leave blank if still open"><TextInput type="number" step="any" placeholder="0.00000" value={form.exit} onChange={set("exit")} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stop Loss"><TextInput type="number" step="any" placeholder="0.00000" value={form.sl} onChange={set("sl")} /></Field>
              <Field label="Take Profit"><TextInput type="number" step="any" placeholder="0.00000" value={form.tp} onChange={set("tp")} /></Field>
            </div>

            {/* Inline Position Size Auto-Calculator */}
            {(() => {
              const ps = calcPositionSize({ symbol: form.symbol, accountBalance: acc.startingBalance, riskPct: form.riskPct || "1", entry: form.entry, sl: form.sl });
              if (!ps) return null;
              return (
                <div className="rounded-2xl bg-sky-500/5 border border-sky-500/20 p-4 mb-2">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <Calculator size={14} className="text-sky-400" />
                      <span className="text-[11px] uppercase tracking-wide text-sky-400 font-semibold">Position Size Auto-Calc</span>
                    </div>
                    <span className="text-[11px] text-slate-500">{form.symbol} · {ps.spec.category}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="text-center bg-slate-900 rounded-xl p-2.5">
                      <div className="text-sm font-bold text-emerald-400">{ps.roundedLots.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-500">Lots</div>
                    </div>
                    <div className="text-center bg-slate-900 rounded-xl p-2.5">
                      <div className="text-sm font-bold text-sky-400">
                        {ps.units < 1000 ? ps.units.toFixed(2) : Math.round(ps.units).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-500">{ps.spec.unit || "units"}</div>
                    </div>
                    <div className="text-center bg-slate-900 rounded-xl p-2.5">
                      <div className="text-sm font-bold text-rose-400">{fmtBal(ps.riskAmount, cur)}</div>
                      <div className="text-[10px] text-slate-500">Risk</div>
                    </div>
                    <div className="text-center bg-slate-900 rounded-xl p-2.5">
                      <div className="text-sm font-bold text-slate-200">
                        {ps.pipDistance < 1 ? ps.pipDistance.toFixed(1) : Math.round(ps.pipDistance).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-500">{ps.pipLabel}</div>
                    </div>
                    <div className="text-center bg-slate-900 rounded-xl p-2.5">
                      <div className="text-sm font-bold text-amber-400">{fmtBal(ps.actualRisk, cur)}</div>
                      <div className="text-[10px] text-slate-500">Actual Risk</div>
                    </div>
                    <div className="text-center bg-slate-900 rounded-xl p-2.5">
                      <div className="text-sm font-bold text-slate-200">{fmtBal(ps.spec.pipValuePerLot, "$")}</div>
                      <div className="text-[10px] text-slate-500">Pip Val/Lot</div>
                    </div>
                  </div>
                  <button onClick={() => setForm((f) => ({ ...f, positionSize: ps.roundedLots.toFixed(2) }))}
                    className="w-full py-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 text-xs font-semibold hover:bg-sky-500/25 transition">
                    ↓ Apply {ps.roundedLots.toFixed(2)} lots to position size
                  </button>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Entry Time" hint="Enables hold-time stats"><TextInput type="time" value={form.entryTime} onChange={set("entryTime")} /></Field>
              <Field label="Exit Time"><TextInput type="time" value={form.exitTime} onChange={set("exitTime")} /></Field>
            </div>
            <Field label="Exit Date" hint="Only if trade closed on a different day">
              <TextInput type="date" value={form.exitDate} onChange={set("exitDate")} />
            </Field>
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 mt-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-3">Live Trade Calculation</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <div className={cx("text-lg font-semibold", live.pnl === null ? "text-slate-500" : live.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{live.pnl === null ? "—" : fmtBal(live.pnl, cur)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">P/L</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <div className="text-lg font-semibold text-slate-200">{live.plannedRR === null ? "—" : fmt2(live.plannedRR) + "R"}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Planned R:R</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <div className={cx("text-lg font-semibold", live.rMultiple === null ? "text-slate-500" : live.rMultiple >= 0 ? "text-emerald-400" : "text-rose-400")}>{live.rMultiple === null ? "—" : fmtSigned(live.rMultiple, "R")}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">R-Multiple</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <Pill tone={RESULT_TONE[live.result || "Open"]}>{live.result || "Open"}</Pill>
                  <div className="text-[10px] text-slate-500 mt-1">Result</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Risk */}
        {step === 2 && (
          <div className="space-y-0">
            {/* Balance & Risk Calculator */}
            <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-4 mb-4">
              <div className="text-[11px] uppercase tracking-wide text-amber-400/80 font-semibold mb-3">Risk Calculator</div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-sm font-bold text-slate-100">{fmtBal(parseFloat(acc.startingBalance), cur)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Account Balance</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-amber-400">{form.riskPct ? form.riskPct + "%" : "—"}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Risk %</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-rose-400">{riskAmt !== null ? fmtBal(riskAmt, cur) : "—"}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Risk Amount</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Risk %" hint="% of account risked"><TextInput type="number" step="any" placeholder="1" value={form.riskPct} onChange={set("riskPct")} /></Field>
              <Field label="Position Size" hint="Units or lots"><TextInput type="number" step="any" placeholder="1.0" value={form.positionSize} onChange={set("positionSize")} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fees"><TextInput type="number" step="any" placeholder="0.00" value={form.fees} onChange={set("fees")} /></Field>
              <Field label="Commission"><TextInput type="number" step="any" placeholder="0.00" value={form.commission} onChange={set("commission")} /></Field>
            </div>
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 mt-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-3">Risk Rules Reminder</div>
              <ul className="space-y-2">
                <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400 shrink-0">▸</span>1% base risk per trade, 2% absolute ceiling</li>
                <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400 shrink-0">▸</span>3% maximum daily loss before stopping</li>
                <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400 shrink-0">▸</span>Cut 50–75% on adverse structure breaks mid-trade</li>
                <li className="text-xs text-slate-400 flex gap-2"><span className="text-amber-400 shrink-0">▸</span>Stop below/above the entry candle for most setups</li>
              </ul>
            </div>
          </div>
        )}

        {/* Step 3: Notes */}
        {step === 3 && (
          <div className="space-y-0">
            <Field label="Trade Notes">
              <TextArea placeholder="What did you see? How did you execute? What would you do differently? Paste in your pre-trade analysis here..." value={form.notes} onChange={set("notes")} className="min-h-[140px]" />
            </Field>
            <Field label="Screenshots / Attachments">
              <Attachments items={form.attachments} onChange={(items) => setForm((f) => ({ ...f, attachments: items }))} />
            </Field>
          </div>
        )}

        {/* Step 4: Preview */}
        {step === 4 && (() => {
          const ps = calcPositionSize({ symbol: form.symbol, accountBalance: acc.startingBalance, riskPct: form.riskPct || "0", entry: form.entry, sl: form.sl });
          const potProfit = ps && live.plannedRR ? (ps.riskAmount * live.plannedRR) : null;
          const toneMap = { Win: "text-emerald-400", Loss: "text-rose-400", Breakeven: "text-slate-400" };
          return (
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Trade Summary</div>
                <div className="text-xl font-bold mt-1" style={{ fontFamily: "'Sora', sans-serif" }}>
                  <span className="text-slate-100">{form.symbol || "—"}</span>
                  <span className="mx-2 text-slate-600">·</span>
                  <span className={form.side === "Buy" ? "text-emerald-400" : "text-rose-400"}>{form.side}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{form.date} · {form.session || "Session not set"}</div>
              </div>

              <div className="rounded-2xl border border-amber-500/20 overflow-hidden" style={{ background: "linear-gradient(135deg,#0f172a 0%,#1a1000 100%)" }}>
                {[
                  [{ label: "Entry Price", value: form.entry || "—", col: "text-slate-100" }, { label: "Stop Loss", value: form.sl || "—", col: "text-rose-400" }],
                  [{ label: "Take Profit", value: form.tp || "—", col: "text-emerald-400" }, { label: "Exit Price", value: form.exit || "Open", col: live.result === "Win" ? "text-emerald-400" : live.result === "Loss" ? "text-rose-400" : "text-slate-400" }],
                  [{ label: "Risk Amount", value: ps ? fmtBal(ps.riskAmount, cur) : (form.riskPct ? form.riskPct + "%" : "—"), col: "text-rose-400" }, { label: "Potential Profit", value: potProfit ? fmtBal(potProfit, cur) : "—", col: "text-emerald-400" }],
                  [{ label: "Risk : Reward", value: live.plannedRR !== null ? "1 : " + fmt2(live.plannedRR) : "—", col: "text-sky-400" }, { label: "R-Multiple", value: live.rMultiple !== null ? fmtSigned(live.rMultiple, "R") : "—", col: live.rMultiple !== null && live.rMultiple >= 0 ? "text-emerald-400" : "text-rose-400" }],
                  [{ label: "Lot Size", value: ps ? ps.roundedLots.toFixed(2) + " lots" : (form.positionSize || "—"), col: "text-amber-400" }, { label: "SL Distance", value: ps ? Math.round(ps.pipDistance).toLocaleString() + " " + ps.pipLabel : "—", col: "text-slate-300" }],
                  [{ label: "Realised P/L", value: live.pnl !== null ? fmtBal(live.pnl, cur) : "Pending", col: live.pnl === null ? "text-slate-500" : live.pnl >= 0 ? "text-emerald-400" : "text-rose-400" }, { label: "Result", value: live.result || "Open", col: toneMap[live.result] || "text-sky-400" }],
                ].map((row, ri) => (
                  <div key={ri} className="grid grid-cols-2 divide-x divide-slate-800/60 border-b border-slate-800/60 last:border-0">
                    {row.map(({ label, value, col }, ci) => (
                      <div key={ci} className="px-4 py-3">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
                        <div className={cx("text-sm font-bold", col)}>{value}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Market", value: form.market },
                  { label: "Session", value: form.session || "—" },
                  { label: "Trade Type", value: form.tradeType },
                ].map((item, i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-center">
                    <div className="text-xs font-semibold text-slate-200">{item.value}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>

              {form.notes ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Notes</div>
                  <p className="text-xs text-slate-400 leading-relaxed">{form.notes}</p>
                </div>
              ) : null}

              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5">
                <p className="text-xs text-amber-400/80">Review complete. Tap <strong>Save Trade</strong> below to log this trade and update your balance automatically.</p>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Sticky footer — navigation + save */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur border-t border-slate-800 p-4 flex gap-3">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)} className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-medium text-sm flex items-center justify-center gap-1.5">
            <ChevronLeft size={16} /> Back
          </button>
        ) : (
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-medium text-sm flex items-center justify-center gap-1.5">
            <X size={16} /> Cancel
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)} className="flex-2 flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-1.5">
            {step === STEPS.length - 2 ? "Review Trade" : "Next"} <ChevronRight size={16} />
          </button>
        ) : (
          <button onClick={save} disabled={!form.symbol.trim()} className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            <Check size={16} /> {initial ? "Save Changes" : "Save Trade"}
          </button>
        )}
      </div>
    </div>
  );
}


/* ============================================================
   JOURNAL TAB
   ============================================================ */
function JournalTab({ data, setData }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [marketFilter, setMarketFilter] = useState("All");
  const [resultFilter, setResultFilter] = useState("All");
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const trades = useMemo(() => {
    let list = [...data.trades].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (marketFilter !== "All") list = list.filter((t) => t.market === marketFilter);
    if (resultFilter !== "All") list = list.filter((t) => (computeTrade(t).result || "Open") === resultFilter);
    return list;
  }, [data.trades, marketFilter, resultFilter]);

  const save = (trade) => {
    setData((d) => {
      const exists = d.trades.some((t) => t.id === trade.id);
      const trades = exists ? d.trades.map((t) => (t.id === trade.id ? trade : t)) : [...d.trades, trade];
      return { ...d, trades };
    });
    setFormOpen(false);
    setEditing(null);
  };

  const remove = (id) => {
    setData((d) => ({ ...d, trades: d.trades.filter((t) => t.id !== id) }));
    setConfirmId(null);
  };

  /* TradeForm is now full-page — render it as an overlay on top of journal */
  if (formOpen) {
    return <TradeForm open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} onSave={save} initial={editing} setups={data.setups} strategies={data.strategies} account={data.account} />;
  }

  if (csvImportOpen) {
    return (
      <CsvImportModal
        onClose={() => setCsvImportOpen(false)}
        onImport={(imported) => {
          setData((d) => ({ ...d, trades: [...(d.trades || []), ...imported] }));
          setCsvImportOpen(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SectionTitle sub={`${trades.length} trade${trades.length === 1 ? "" : "s"}`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setCsvImportOpen(true)} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs px-3 py-2 rounded-xl">
              <Upload size={13} /> Import CSV
            </button>
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs px-3 py-2 rounded-xl">
              <Plus size={14} /> Log Trade
            </button>
          </div>
        }>
        Trade Journal
      </SectionTitle>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)} className="!w-auto text-xs py-1.5">
          <option value="All">All Markets</option>
          {MARKET_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="!w-auto text-xs py-1.5">
          <option value="All">All Results</option>
          <option value="Win">Win</option>
          <option value="Loss">Loss</option>
          <option value="Breakeven">Breakeven</option>
          <option value="Open">Open</option>
        </Select>
      </div>

      {trades.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No trades logged yet" sub="Tap Log Trade to record your first entry." action={
          <button onClick={() => setFormOpen(true)} className="mt-3 flex items-center gap-1.5 bg-amber-500 text-slate-950 font-semibold text-sm px-4 py-2.5 rounded-xl mx-auto">
            <Plus size={16} /> Log First Trade
          </button>
        } />
      ) : (
        <div className="space-y-2.5">
          {trades.map((t) => {
            const c = computeTrade(t);
            return (
              <Card key={t.id} onClick={() => { setEditing(t); setFormOpen(true); }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {t.side === "Sell" ? <TrendingDown size={16} className="text-rose-400 mt-0.5 shrink-0" /> : <TrendingUp size={16} className="text-emerald-400 mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-100">{t.symbol || "Untitled"}</span>
                        {t.tradeType && t.tradeType !== "Normal" && <Pill tone="amber">{t.tradeType}</Pill>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                        <Calendar size={11} /> {t.date}
                        {t.session && <><span>·</span>{t.session}</>}
                        <span>·</span>{t.market}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone={RESULT_TONE[c.result || "Open"]}>{c.result || "Open"}</Pill>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmId(t.id); }} className="p-1 text-slate-600 hover:text-rose-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800/70 text-center">
                  <div>
                    <div className={cx("text-sm font-semibold", c.pnl === null ? "text-slate-500" : c.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtSigned(c.pnl)}</div>
                    <div className="text-[10px] text-slate-600">P/L</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-300">{c.plannedRR === null ? "—" : fmt2(c.plannedRR) + "R"}</div>
                    <div className="text-[10px] text-slate-600">Planned R:R</div>
                  </div>
                  <div>
                    <div className={cx("text-sm font-semibold", c.rMultiple === null ? "text-slate-500" : c.rMultiple >= 0 ? "text-emerald-400" : "text-rose-400")}>{c.rMultiple === null ? "—" : fmtSigned(c.rMultiple, "R")}</div>
                    <div className="text-[10px] text-slate-600">R-Multiple</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog open={!!confirmId} title="Delete trade?" body="This trade and any attachments will be permanently removed."
        onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
    </div>
  );
}

/* ============================================================
   LIBRARY — SETUP FORM & PANEL
   ============================================================ */
const SETUP_TAG_OPTIONS = ["Forex", "Stocks", "Crypto", "Futures"];

function emptySetup() {
  return {
    id: null, name: "", tags: [], trend: "", entry: "",
    stop: STANDARD_TEMPLATE.stop, target: STANDARD_TEMPLATE.target, midTrade: STANDARD_TEMPLATE.midTrade,
    exception: false, checklist: [], notes: "", attachments: [],
    image: null, marketBias: "", setupType: "",
  };
}

const MARKET_BIAS_OPTIONS = ["Bullish", "Bearish", "Neutral"];
const SETUP_TYPE_OPTIONS  = ["Retest", "Breakout", "Liquidity", "Trend"];

/* Single hero-image uploader used by the "Create Setup from Image" flow */
function HeroImageUpload({ image, onChange }) {
  const inputRef = useRef(null);
  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 3.5 * 1024 * 1024) {
      onChange({ tooBig: true, name: file.name });
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    onChange(dataUrl);
  };

  if (image && typeof image === "string") {
    return (
      <div className="relative rounded-2xl overflow-hidden border border-slate-800 mb-4 group">
        <img src={image} alt="Chart" className="w-full max-h-72 object-contain bg-slate-950" />
        <div className="absolute top-2 right-2 flex gap-1.5">
          <button onClick={() => inputRef.current?.click()} className="p-2 rounded-lg bg-slate-950/80 border border-slate-700 text-slate-300 hover:text-amber-400">
            <Pencil size={14} />
          </button>
          <button onClick={() => onChange(null)} className="p-2 rounded-lg bg-slate-950/80 border border-slate-700 text-slate-300 hover:text-rose-400">
            <Trash2 size={14} />
          </button>
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
      </div>
    );
  }

  return (
    <button onClick={() => inputRef.current?.click()}
      className="w-full mb-4 rounded-2xl border-2 border-dashed border-slate-700 hover:border-amber-500/50 bg-slate-900/50 py-10 flex flex-col items-center gap-2 transition">
      <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
        <ImageIcon size={20} className="text-slate-500" />
      </div>
      <span className="text-sm font-medium text-slate-300">Upload Chart Image</span>
      <span className="text-[11px] text-slate-500">Optional · builds your setup page around it</span>
      {image?.tooBig && <span className="text-[11px] text-rose-400 mt-1">"{image.name}" is over 3.5MB — try a smaller screenshot</span>}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
    </button>
  );
}

function SetupForm({ onClose, onSave, onBack, initial, mode, goTo }) {
  const [form, setForm] = useState({ ...emptySetup(), ...(initial || {}) });
  const [newCheck, setNewCheck] = useState("");
  const [openSection, setOpenSection] = useState(mode === "fromImage" ? "entry" : null);
  useEffect(() => { setForm({ ...emptySetup(), ...(initial || {}) }); }, [initial]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addCheck = () => {
    if (!newCheck.trim()) return;
    setForm((f) => ({ ...f, checklist: [...f.checklist, { id: uid(), text: newCheck.trim(), done: false }] }));
    setNewCheck("");
  };
  const removeCheck = (id) => setForm((f) => ({ ...f, checklist: f.checklist.filter((c) => c.id !== id) }));

  const save = () => { if (!form.name.trim()) return; onSave({ ...form, id: form.id || uid() }); };

  const pageTitle = mode === "fromImage" ? "Create Setup from Image" : mode === "edit" ? "Edit Setup" : "New Setup";
  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "Library", onClick: () => goTo("library", "Setups") },
    { label: "Setup Library", onClick: () => goTo("library", "Setups") },
    { label: pageTitle },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={mode === "edit" ? "Save" : "Create"} saveDisabled={!form.name.trim()} goTo={goTo}>
      <HeroImageUpload image={form.image} onChange={(img) => setForm((f) => ({ ...f, image: img }))} />

      {mode === "fromImage" && (
        <div className="rounded-xl bg-sky-500/8 border border-sky-500/20 px-3 py-2.5 mb-4 flex items-center gap-2">
          <Sparkles size={14} className="text-sky-400 shrink-0" />
          <p className="text-xs text-sky-400/90">Template sections generated below — fill them in based on what your chart shows.</p>
        </div>
      )}

      <Field label="Setup name"><TextInput value={form.name} onChange={set("name")} placeholder="e.g. Breakout A+" /></Field>
      <Field label="Market tags"><TagToggle options={SETUP_TAG_OPTIONS} value={form.tags} onChange={(v) => setForm((f) => ({ ...f, tags: v }))} /></Field>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <span className="block text-xs font-medium text-slate-400 mb-1.5">Market Bias</span>
          <div className="grid grid-cols-3 gap-1.5">
            {MARKET_BIAS_OPTIONS.map((b) => (
              <button key={b} onClick={() => setForm((f) => ({ ...f, marketBias: f.marketBias === b ? "" : b }))}
                className={cx("py-2 rounded-lg text-[11px] font-semibold border transition",
                  form.marketBias === b
                    ? b === "Bullish" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                    : b === "Bearish" ? "bg-rose-500/15 border-rose-500/40 text-rose-400"
                    : "bg-slate-700 border-slate-600 text-slate-200"
                    : "bg-slate-900 border-slate-800 text-slate-500")}>
                {b}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="block text-xs font-medium text-slate-400 mb-1.5">Setup Type</span>
          <Select value={form.setupType} onChange={set("setupType")}>
            <option value="">Select type...</option>
            {SETUP_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 mb-4 text-sm text-slate-300">
        <input type="checkbox" checked={form.exception} onChange={(e) => setForm((f) => ({ ...f, exception: e.target.checked }))} className="accent-amber-500" />
        Exception to the standard management template
      </label>

      <div className="space-y-2.5">
        <Accordion id="entry" open={openSection} onToggle={setOpenSection} title="Entry Explanation" icon={Target}>
          <TextArea value={form.entry} onChange={set("entry")} placeholder="When and why do you enter this setup?" className="min-h-[100px]" />
        </Accordion>

        <Accordion id="market_context" open={openSection} onToggle={setOpenSection} title="Market Context" icon={BarChart3}>
          <TextArea value={form.trend} onChange={set("trend")} placeholder="What trend / structure / context is required for this setup to be valid?" className="min-h-[100px]" />
        </Accordion>

        <Accordion id="sl" open={openSection} onToggle={setOpenSection} title="Stop Loss" icon={ShieldAlert}>
          <TextArea value={form.stop} onChange={set("stop")} className="min-h-[80px]" />
        </Accordion>

        <Accordion id="tp" open={openSection} onToggle={setOpenSection} title="Take Profit" icon={Target}>
          <TextArea value={form.target} onChange={set("target")} className="min-h-[80px]" />
        </Accordion>

        <Accordion id="midtrade" open={openSection} onToggle={setOpenSection} title="Mid-Trade Risk Rule" icon={Activity}>
          <TextArea value={form.midTrade} onChange={set("midTrade")} className="min-h-[80px]" />
        </Accordion>

        <Accordion id="checklist" open={openSection} onToggle={setOpenSection} title={`Checklist (${form.checklist.length})`} icon={ListChecks}>
          <div className="space-y-1.5 mb-2">
            {form.checklist.map((c) => (
              <div key={c.id} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
                <span className="text-sm text-slate-300 flex-1">{c.text}</span>
                <button onClick={() => removeCheck(c.id)} className="text-slate-600 hover:text-rose-400"><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <TextInput value={newCheck} onChange={(e) => setNewCheck(e.target.value)} placeholder="Add checklist item..." onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCheck())} />
            <button onClick={addCheck} className="px-3 rounded-xl bg-slate-800 text-slate-300"><Plus size={16} /></button>
          </div>
        </Accordion>

        <Accordion id="notes" open={openSection} onToggle={setOpenSection} title="Personal Notes" icon={FileText}>
          <TextArea value={form.notes} onChange={set("notes")} placeholder="Your own observations, exceptions, reminders..." className="min-h-[100px]" />
        </Accordion>

        <Accordion id="attachments" open={openSection} onToggle={setOpenSection} title={`Additional Chart Examples (${form.attachments.length})`} icon={ImageIcon}>
          <Attachments items={form.attachments} onChange={(items) => setForm((f) => ({ ...f, attachments: items }))} />
        </Accordion>
      </div>
    </FullPageShell>
  );
}

function SetupsPanel({ data, setData, goTo }) {
  const [open, setOpen] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formMode, setFormMode] = useState("create");
  const [confirmId, setConfirmId] = useState(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const imageInputRef = useRef(null);

  const save = (setup) => {
    setData((d) => {
      const exists = d.setups.some((s) => s.id === setup.id);
      const setups = exists ? d.setups.map((s) => (s.id === setup.id ? setup : s)) : [...d.setups, setup];
      return { ...d, setups };
    });
    setFormOpen(false); setEditing(null);
  };
  const remove = (id) => { setData((d) => ({ ...d, setups: d.setups.filter((s) => s.id !== id) })); setConfirmId(null); };

  const startCreate = () => { setEditing(null); setFormMode("create"); setFormOpen(true); };
  const startEdit = (s) => { setEditing(s); setFormMode("edit"); setFormOpen(true); };
  const startFromImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    let image = null;
    if (file.size <= 3.5 * 1024 * 1024) image = await fileToDataUrl(file);
    setEditing({ ...emptySetup(), name: "", image });
    setFormMode("fromImage");
    setFormOpen(true);
  };

  if (formOpen) {
    return (
      <SetupForm
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onBack={() => { setFormOpen(false); setEditing(null); }}
        onSave={save}
        initial={editing}
        mode={formMode}
        goTo={goTo}
      />
    );
  }

  return (
    <div className="space-y-3">
      <SectionTitle sub={`${data.setups.length} named setups`}
        action={
          <div className="flex gap-2">
            <button onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-1.5 bg-sky-500/15 border border-sky-500/30 text-sky-400 text-xs font-semibold px-3 py-2 rounded-xl">
              <ImageIcon size={13} /> From Image
            </button>
            <IconBtn icon={Plus} tone="amber" label="New" onClick={startCreate} />
          </div>
        }>
        Setup Library
      </SectionTitle>
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { startFromImage(e.target.files[0]); e.target.value = ""; }} />

      <Accordion id="std-template" open={showTemplate ? "std-template" : null} onToggle={(v) => setShowTemplate(!!v)} title="Standard Management Template" icon={Sparkles}
        badge={<Pill tone="amber">Reference</Pill>}>
        <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Entry — </span>{STANDARD_TEMPLATE.entry}</p>
        <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Stop — </span>{STANDARD_TEMPLATE.stop}</p>
        <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Target — </span>{STANDARD_TEMPLATE.target}</p>
        <p className="text-sm text-slate-300"><span className="text-amber-400 font-medium">Mid-trade — </span>{STANDARD_TEMPLATE.midTrade}</p>
      </Accordion>

      <div className="space-y-2.5">
        {data.setups.map((s) => (
          <Accordion key={s.id} id={s.id} open={open} onToggle={setOpen} title={s.name}
            badge={s.exception && <Pill tone="rose">Exception</Pill>}>
            {s.image && <img src={s.image} alt={s.name} className="w-full max-h-56 object-contain bg-slate-950 rounded-xl border border-slate-800 mb-3" />}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {s.tags.map((t) => <Pill key={t} tone="sky">{t}</Pill>)}
              {s.marketBias && <Pill tone={s.marketBias === "Bullish" ? "emerald" : s.marketBias === "Bearish" ? "rose" : "slate"}>{s.marketBias}</Pill>}
              {s.setupType && <Pill tone="amber">{s.setupType}</Pill>}
            </div>
            <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Context — </span>{s.trend}</p>
            <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Entry — </span>{s.entry}</p>
            <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Stop — </span>{s.stop}</p>
            <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Target — </span>{s.target}</p>
            <p className="text-sm text-slate-300 mb-3"><span className="text-amber-400 font-medium">Mid-trade — </span>{s.midTrade}</p>
            {s.checklist.length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1.5">Checklist</div>
                <ul className="space-y-1">
                  {s.checklist.map((c) => (
                    <li key={c.id} className="text-sm text-slate-400 flex gap-2"><CheckCircle2 size={14} className="text-amber-500/70 mt-0.5 shrink-0" />{c.text}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.notes && <p className="text-sm text-slate-400 italic mb-2">{s.notes}</p>}
            <AttachmentGrid items={s.attachments} />
            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800/70">
              <button onClick={() => startEdit(s)} className="flex items-center gap-1.5 text-xs text-slate-300 px-3 py-1.5 rounded-lg bg-slate-800"><Pencil size={12} /> Edit</button>
              <button onClick={() => setConfirmId(s.id)} className="flex items-center gap-1.5 text-xs text-rose-400 px-3 py-1.5 rounded-lg bg-rose-500/10"><Trash2 size={12} /> Delete</button>
            </div>
          </Accordion>
        ))}
      </div>

      <ConfirmDialog open={!!confirmId} title="Delete setup?" body="This setup will be permanently removed from your library."
        onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
    </div>
  );
}


/* ============================================================
   LIBRARY — STRATEGY FORM & PANEL
   ============================================================ */
function emptyStrategy() {
  return { id: null, name: "", description: "", marketType: "", timeframe: "", entryConditions: "", exitConditions: "", riskRules: "", notes: "", attachments: [] };
}

function StrategyForm({ onClose, onBack, onSave, initial, goTo }) {
  const [form, setForm] = useState(initial || emptyStrategy());
  useEffect(() => { setForm(initial || emptyStrategy()); }, [initial]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = () => { if (!form.name.trim()) return; onSave({ ...form, id: form.id || uid() }); };

  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "Library", onClick: () => goTo("library", "Strategies") },
    { label: "Strategy Library", onClick: () => goTo("library", "Strategies") },
    { label: initial ? "Edit Strategy" : "New Strategy" },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={initial ? "Save" : "Create"} saveDisabled={!form.name.trim()} goTo={goTo}>
      <Field label="Strategy name"><TextInput value={form.name} onChange={set("name")} /></Field>
      <Field label="Description"><TextArea value={form.description} onChange={set("description")} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Market type"><TextInput value={form.marketType} onChange={set("marketType")} placeholder="Forex, Crypto..." /></Field>
        <Field label="Timeframe"><TextInput value={form.timeframe} onChange={set("timeframe")} placeholder="15m, 4H..." /></Field>
      </div>
      <Field label="Entry conditions"><TextArea value={form.entryConditions} onChange={set("entryConditions")} /></Field>
      <Field label="Exit conditions"><TextArea value={form.exitConditions} onChange={set("exitConditions")} /></Field>
      <Field label="Risk rules"><TextArea value={form.riskRules} onChange={set("riskRules")} /></Field>
      <Field label="Notes"><TextArea value={form.notes} onChange={set("notes")} /></Field>
      <Field label="Attachments">
        <Attachments items={form.attachments} onChange={(items) => setForm((f) => ({ ...f, attachments: items }))} />
      </Field>
    </FullPageShell>
  );
}

function StrategiesPanel({ data, setData, goTo }) {
  const [open, setOpen] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const save = (strategy) => {
    setData((d) => {
      const exists = d.strategies.some((s) => s.id === strategy.id);
      const strategies = exists ? d.strategies.map((s) => (s.id === strategy.id ? strategy : s)) : [...d.strategies, strategy];
      return { ...d, strategies };
    });
    setFormOpen(false); setEditing(null);
  };
  const remove = (id) => { setData((d) => ({ ...d, strategies: d.strategies.filter((s) => s.id !== id) })); setConfirmId(null); };

  if (formOpen) {
    return <StrategyForm onClose={() => { setFormOpen(false); setEditing(null); }} onBack={() => { setFormOpen(false); setEditing(null); }} onSave={save} initial={editing} goTo={goTo} />;
  }

  return (
    <div className="space-y-3">
      <SectionTitle sub="Build & refine your own playbooks" action={<IconBtn icon={Plus} tone="amber" label="New" onClick={() => { setEditing(null); setFormOpen(true); }} />}>
        Strategy Library
      </SectionTitle>
      <div className="space-y-2.5">
        {data.strategies.map((s) => (
          <Accordion key={s.id} id={s.id} open={open} onToggle={setOpen} title={s.name} icon={BarChart3}>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {s.marketType && <Pill tone="sky">{s.marketType}</Pill>}
              {s.timeframe && <Pill tone="slate">{s.timeframe}</Pill>}
            </div>
            {s.description && <p className="text-sm text-slate-300 mb-3">{s.description}</p>}
            <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Entry — </span>{s.entryConditions}</p>
            <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Exit — </span>{s.exitConditions}</p>
            <p className="text-sm text-slate-300 mb-3"><span className="text-amber-400 font-medium">Risk — </span>{s.riskRules}</p>
            {s.notes && <p className="text-sm text-slate-400 italic mb-2">{s.notes}</p>}
            <AttachmentGrid items={s.attachments} />
            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800/70">
              <button onClick={() => { setEditing(s); setFormOpen(true); }} className="flex items-center gap-1.5 text-xs text-slate-300 px-3 py-1.5 rounded-lg bg-slate-800"><Pencil size={12} /> Edit</button>
              <button onClick={() => setConfirmId(s.id)} className="flex items-center gap-1.5 text-xs text-rose-400 px-3 py-1.5 rounded-lg bg-rose-500/10"><Trash2 size={12} /> Delete</button>
            </div>
          </Accordion>
        ))}
      </div>
      <ConfirmDialog open={!!confirmId} title="Delete strategy?" body="This strategy will be permanently removed."
        onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
    </div>
  );
}

/* ============================================================
   LIBRARY TAB (wraps Setups / Strategies)
   ============================================================ */
function LibraryTab({ data, setData, subTab, setSubTab, goTo }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 bg-slate-900 border border-slate-800 rounded-xl p-1">
        {["Setups", "Strategies"].map((s) => (
          <button key={s} onClick={() => setSubTab(s)}
            className={cx("flex-1 py-2 rounded-lg text-sm font-medium transition", subTab === s ? "bg-amber-500 text-slate-950" : "text-slate-400")}>
            {s}
          </button>
        ))}
      </div>
      {subTab === "Setups" ? <SetupsPanel data={data} setData={setData} goTo={goTo} /> : <StrategiesPanel data={data} setData={setData} goTo={goTo} />}
    </div>
  );
}

/* ============================================================
   ACADEMY — PRICE ACTION
   ============================================================ */
function ChecklistView() {
  const groups = {};
  CHECKLIST_MASTER.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          <div className="text-amber-400 font-semibold text-sm mb-1.5">{group}</div>
          <ul className="space-y-1.5">
            {items.map((c, i) => (
              <li key={i} className="text-sm text-slate-300 leading-relaxed flex gap-2">
                <CheckCircle2 size={14} className="text-amber-500/70 mt-0.5 shrink-0" />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PriceActionAcademy() {
  const [open, setOpen] = useState("overview");
  return (
    <div className="space-y-2.5">
      {ACADEMY_MODULES.map((m) => (
        <Accordion key={m.id} id={m.id} open={open} onToggle={setOpen} title={m.title} icon={ICONS[m.icon]}>
          {renderBlocks(m.blocks)}
          {m.id === "checklist" && <ChecklistView />}
        </Accordion>
      ))}
    </div>
  );
}

/* ============================================================
   ACADEMY — SMART MONEY CONCEPTS
   ============================================================ */
function SmcTopicCard({ topic, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(topic.notes);

  useEffect(() => { setNotes(topic.notes); }, [topic.notes]);

  const commit = () => { if (notes !== topic.notes) onUpdate({ ...topic, notes }); };

  return (
    <Accordion id={topic.id} open={open ? topic.id : null} onToggle={(v) => setOpen(!!v)} title={topic.term} icon={Brain}>
      <p className="text-sm text-slate-300 leading-relaxed mb-3">{topic.definition}</p>
      <Field label="Your notes">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commit} placeholder="Add your own examples or chart notes..." />
      </Field>
      <Field label="Chart examples">
        <Attachments items={topic.attachments} onChange={(items) => onUpdate({ ...topic, attachments: items })} />
      </Field>
    </Accordion>
  );
}

function SmartMoneyAcademy({ data, setData }) {
  const update = (topic) => {
    setData((d) => ({ ...d, smc: d.smc.map((t) => (t.id === topic.id ? topic : t)) }));
  };
  return (
    <div className="space-y-2.5">
      <Card className="bg-amber-500/5 border-amber-500/20">
        <p className="text-xs text-slate-400 leading-relaxed">
          Core terminology for reading institutional order-flow. Pairs naturally with the SRC market-structure read (HH/HL, BOPCH/BOPCL) in the Price Action Academy — add your own notes &amp; chart screenshots to each term as you study it.
        </p>
      </Card>
      {data.smc.map((t) => <SmcTopicCard key={t.id} topic={t} onUpdate={update} />)}
    </div>
  );
}

/* ============================================================
   ACADEMY TAB
   ============================================================ */
function AcademyTab({ data, setData, subTab, setSubTab }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 bg-slate-900 border border-slate-800 rounded-xl p-1">
        {["Price Action", "Smart Money"].map((s) => (
          <button key={s} onClick={() => setSubTab(s)}
            className={cx("flex-1 py-2 rounded-lg text-sm font-medium transition", subTab === s ? "bg-amber-500 text-slate-950" : "text-slate-400")}>
            {s}
          </button>
        ))}
      </div>
      <SectionTitle sub={subTab === "Price Action" ? "The full SRC reference guide" : "Order-flow terminology & your notes"}>
        {subTab === "Price Action" ? "Price Action Academy" : "Smart Money Concepts"}
      </SectionTitle>
      {subTab === "Price Action" ? <PriceActionAcademy /> : <SmartMoneyAcademy data={data} setData={setData} />}
    </div>
  );
}

/* ============================================================
   MORE — TRADING PLANS
   ============================================================ */
function MasterPlanCard({ master, onSave }) {
  const [form, setForm] = useState(master);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setForm(master); setDirty(false); }, [master]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setDirty(true); };

  return (
    <Card className="border-amber-500/20">
      <div className="flex items-center gap-2 mb-3">
        <Crown size={16} className="text-amber-400" />
        <span className="font-semibold text-slate-100 text-sm">Master Plan</span>
      </div>
      <Field label="Core goals"><TextArea value={form.goals} onChange={set("goals")} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Monthly target"><TextInput value={form.monthlyTarget} onChange={set("monthlyTarget")} /></Field>
        <Field label="Weekly target"><TextInput value={form.weeklyTarget} onChange={set("weeklyTarget")} /></Field>
        <Field label="Daily target"><TextInput value={form.dailyTarget} onChange={set("dailyTarget")} /></Field>
      </div>
      <Field label="Max risk per trade"><TextInput value={form.maxRiskPerTrade} onChange={set("maxRiskPerTrade")} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Max daily loss"><TextInput value={form.maxDailyLoss} onChange={set("maxDailyLoss")} /></Field>
        <Field label="Max weekly loss"><TextInput value={form.maxWeeklyLoss} onChange={set("maxWeeklyLoss")} /></Field>
      </div>
      {dirty && (
        <button onClick={() => { onSave(form); setDirty(false); }} className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2.5 rounded-xl text-sm transition mt-1">
          Save Master Plan
        </button>
      )}
    </Card>
  );
}

function emptyCustomPlan() {
  return { id: null, name: "", marketConditions: "", entryRules: "", exitRules: "", riskRules: "", psychologyRules: "", attachments: [] };
}

function PlanForm({ onClose, onBack, onSave, initial, goTo }) {
  const [form, setForm] = useState(initial || emptyCustomPlan());
  useEffect(() => { setForm(initial || emptyCustomPlan()); }, [initial]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = () => { if (!form.name.trim()) return; onSave({ ...form, id: form.id || uid() }); };

  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "More", onClick: () => goTo("more", "Plans") },
    { label: "Trading Plans", onClick: () => goTo("more", "Plans") },
    { label: initial ? "Edit Plan" : "New Plan" },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={initial ? "Save" : "Create"} saveDisabled={!form.name.trim()} goTo={goTo}>
      <Field label="Plan name"><TextInput value={form.name} onChange={set("name")} /></Field>
      <Field label="Market conditions to trade"><TextArea value={form.marketConditions} onChange={set("marketConditions")} /></Field>
      <Field label="Entry rules"><TextArea value={form.entryRules} onChange={set("entryRules")} /></Field>
      <Field label="Exit rules"><TextArea value={form.exitRules} onChange={set("exitRules")} /></Field>
      <Field label="Risk rules"><TextArea value={form.riskRules} onChange={set("riskRules")} /></Field>
      <Field label="Psychology rules"><TextArea value={form.psychologyRules} onChange={set("psychologyRules")} /></Field>
      <Field label="Attachments">
        <Attachments items={form.attachments} onChange={(items) => setForm((f) => ({ ...f, attachments: items }))} />
      </Field>
    </FullPageShell>
  );
}

function PlansPanel({ data, setData, goTo }) {
  const [open, setOpen] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const saveMaster = (master) => setData((d) => ({ ...d, plans: { ...d.plans, master } }));
  const savePlan = (plan) => {
    setData((d) => {
      const exists = d.plans.custom.some((p) => p.id === plan.id);
      const custom = exists ? d.plans.custom.map((p) => (p.id === plan.id ? plan : p)) : [...d.plans.custom, plan];
      return { ...d, plans: { ...d.plans, custom } };
    });
    setFormOpen(false); setEditing(null);
  };
  const removePlan = (id) => {
    setData((d) => ({ ...d, plans: { ...d.plans, custom: d.plans.custom.filter((p) => p.id !== id) } }));
    setConfirmId(null);
  };

  if (formOpen) {
    return <PlanForm onClose={() => { setFormOpen(false); setEditing(null); }} onBack={() => { setFormOpen(false); setEditing(null); }} onSave={savePlan} initial={editing} goTo={goTo} />;
  }

  return (
    <div className="space-y-3">
      <SectionTitle sub="One master plan, unlimited custom plans" action={<IconBtn icon={Plus} tone="amber" label="New" onClick={() => { setEditing(null); setFormOpen(true); }} />}>
        Trading Plans
      </SectionTitle>
      <MasterPlanCard master={data.plans.master} onSave={saveMaster} />
      {data.plans.custom.map((p) => (
        <Accordion key={p.id} id={p.id} open={open} onToggle={setOpen} title={p.name} icon={ClipboardList}>
          <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Market conditions — </span>{p.marketConditions}</p>
          <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Entry — </span>{p.entryRules}</p>
          <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Exit — </span>{p.exitRules}</p>
          <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Risk — </span>{p.riskRules}</p>
          <p className="text-sm text-slate-300 mb-3"><span className="text-amber-400 font-medium">Psychology — </span>{p.psychologyRules}</p>
          <AttachmentGrid items={p.attachments} />
          <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800/70">
            <button onClick={() => { setEditing(p); setFormOpen(true); }} className="flex items-center gap-1.5 text-xs text-slate-300 px-3 py-1.5 rounded-lg bg-slate-800"><Pencil size={12} /> Edit</button>
            <button onClick={() => setConfirmId(p.id)} className="flex items-center gap-1.5 text-xs text-rose-400 px-3 py-1.5 rounded-lg bg-rose-500/10"><Trash2 size={12} /> Delete</button>
          </div>
        </Accordion>
      ))}
      <ConfirmDialog open={!!confirmId} title="Delete plan?" body="This trading plan will be permanently removed."
        onConfirm={() => removePlan(confirmId)} onCancel={() => setConfirmId(null)} />
    </div>
  );
}

/* ============================================================
   MORE — TRADING PSYCHOLOGY
   ============================================================ */
function emptyMistake() {
  return { id: null, date: todayISO(), mistake: "", cause: "", solution: "", attachments: [] };
}

function MistakeForm({ onClose, onBack, onSave, initial, goTo }) {
  const [form, setForm] = useState(initial || emptyMistake());
  useEffect(() => { setForm(initial || emptyMistake()); }, [initial]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = () => { if (!form.mistake.trim()) return; onSave({ ...form, id: form.id || uid() }); };

  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "More", onClick: () => goTo("more", "Psychology") },
    { label: "Psychology", onClick: () => goTo("more", "Psychology") },
    { label: initial ? "Edit Entry" : "Log Mistake" },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={initial ? "Save" : "Log Entry"} saveDisabled={!form.mistake.trim()} goTo={goTo}>
      <Field label="Date"><TextInput type="date" value={form.date} onChange={set("date")} /></Field>
      <Field label="What happened"><TextArea value={form.mistake} onChange={set("mistake")} /></Field>
      <Field label="Root cause"><TextArea value={form.cause} onChange={set("cause")} /></Field>
      <Field label="Solution / fix going forward"><TextArea value={form.solution} onChange={set("solution")} /></Field>
      <Field label="Screenshot"><Attachments items={form.attachments} onChange={(items) => setForm((f) => ({ ...f, attachments: items }))} /></Field>
    </FullPageShell>
  );
}

function PsychologyPanel({ data, setData, goTo }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [refOpen, setRefOpen] = useState(false);

  const save = (m) => {
    setData((d) => {
      const exists = d.psychology.some((x) => x.id === m.id);
      const psychology = exists ? d.psychology.map((x) => (x.id === m.id ? m : x)) : [...d.psychology, m];
      return { ...d, psychology };
    });
    setFormOpen(false); setEditing(null);
  };
  const remove = (id) => { setData((d) => ({ ...d, psychology: d.psychology.filter((x) => x.id !== id) })); setConfirmId(null); };
  const sorted = [...data.psychology].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (formOpen) {
    return <MistakeForm onClose={() => { setFormOpen(false); setEditing(null); }} onBack={() => { setFormOpen(false); setEditing(null); }} onSave={save} initial={editing} goTo={goTo} />;
  }

  return (
    <div className="space-y-3">
      <SectionTitle sub="Learn from losses without spiraling" action={<IconBtn icon={Plus} tone="amber" label="Log" onClick={() => { setEditing(null); setFormOpen(true); }} />}>
        Trading Psychology
      </SectionTitle>

      <Accordion id="psych-ref" open={refOpen ? "psych-ref" : null} onToggle={(v) => setRefOpen(!!v)} title="SRC Reference — Learning From Losses" icon={Brain}>
        <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Common causes — </span>Forcing trades outside your edge, moving stops, revenge trading after a loss, oversizing after a win streak.</p>
        <p className="text-sm text-slate-300 mb-2"><span className="text-amber-400 font-medium">Emotional reactions — </span>Frustration, the urge to immediately "win it back," doubting a sound process because of one bad outcome.</p>
        <p className="text-sm text-slate-300"><span className="text-amber-400 font-medium">Constructive response — </span>Review the trade dispassionately, as if it belonged to someone else. Ask whether the process was followed, not just whether it won. Wait one full candle before re-entering after a loss.</p>
      </Accordion>

      {sorted.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No mistakes logged" sub="Track recurring patterns so you can fix them once, not every time." />
      ) : (
        <div className="space-y-2.5">
          {sorted.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><Calendar size={11} />{m.date}</div>
                <div className="flex gap-1.5">
                  <button onClick={() => { setEditing(m); setFormOpen(true); }} className="p-1 text-slate-600 hover:text-amber-400"><Pencil size={13} /></button>
                  <button onClick={() => setConfirmId(m.id)} className="p-1 text-slate-600 hover:text-rose-400"><Trash2 size={13} /></button>
                </div>
              </div>
              <p className="text-sm text-slate-200 font-medium mb-1.5">{m.mistake}</p>
              {m.cause && <p className="text-xs text-slate-400 mb-1"><span className="text-slate-500">Cause: </span>{m.cause}</p>}
              {m.solution && <p className="text-xs text-emerald-400/90"><span className="text-slate-500">Fix: </span>{m.solution}</p>}
              <AttachmentGrid items={m.attachments} />
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!confirmId} title="Delete entry?" body="This psychology log entry will be permanently removed."
        onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
    </div>
  );
}

/* ============================================================
   MORE — KNOWLEDGE VAULT
   ============================================================ */
function emptyNote() {
  return { id: null, title: "", folder: "General", body: "", attachments: [] };
}

function NoteForm({ onClose, onBack, onSave, initial, folders, goTo }) {
  const [form, setForm] = useState(initial || emptyNote());
  const [customFolder, setCustomFolder] = useState("");
  useEffect(() => { setForm(initial || emptyNote()); setCustomFolder(""); }, [initial]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = () => {
    if (!form.title.trim()) return;
    const folder = customFolder.trim() || form.folder || "General";
    onSave({ ...form, folder, id: form.id || uid() });
  };

  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "More", onClick: () => goTo("more", "Vault") },
    { label: "Knowledge Vault", onClick: () => goTo("more", "Vault") },
    { label: initial ? "Edit Note" : "New Note" },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={initial ? "Save" : "Create"} saveDisabled={!form.title.trim()} goTo={goTo}>
      <Field label="Title"><TextInput value={form.title} onChange={set("title")} /></Field>
      <Field label="Folder">
        <Select value={form.folder} onChange={set("folder")}>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          <option value="__new__">+ New folder...</option>
        </Select>
      </Field>
      {form.folder === "__new__" && (
        <Field label="New folder name"><TextInput value={customFolder} onChange={(e) => setCustomFolder(e.target.value)} /></Field>
      )}
      <Field label="Content"><TextArea value={form.body} onChange={set("body")} className="min-h-[160px]" /></Field>
      <Field label="Attachments"><Attachments items={form.attachments} onChange={(items) => setForm((f) => ({ ...f, attachments: items }))} /></Field>
    </FullPageShell>
  );
}

function VaultPanel({ data, setData, goTo }) {
  const [open, setOpen] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [activeFolder, setActiveFolder] = useState("All");

  const folders = useMemo(() => {
    const set = new Set(data.vault.map((n) => n.folder || "General"));
    return Array.from(set);
  }, [data.vault]);

  const save = (note) => {
    setData((d) => {
      const exists = d.vault.some((n) => n.id === note.id);
      const vault = exists ? d.vault.map((n) => (n.id === note.id ? note : n)) : [...d.vault, note];
      return { ...d, vault };
    });
    setFormOpen(false); setEditing(null);
  };
  const remove = (id) => { setData((d) => ({ ...d, vault: d.vault.filter((n) => n.id !== id) })); setConfirmId(null); };

  const visible = activeFolder === "All" ? data.vault : data.vault.filter((n) => n.folder === activeFolder);
  const grouped = {};
  visible.forEach((n) => { (grouped[n.folder || "General"] = grouped[n.folder || "General"] || []).push(n); });

  if (formOpen) {
    return <NoteForm onClose={() => { setFormOpen(false); setEditing(null); }} onBack={() => { setFormOpen(false); setEditing(null); }} onSave={save} initial={editing} folders={folders.length ? folders : ["General"]} goTo={goTo} />;
  }

  return (
    <div className="space-y-3">
      <SectionTitle sub="Your personal trading wiki" action={<IconBtn icon={Plus} tone="amber" label="New" onClick={() => { setEditing(null); setFormOpen(true); }} />}>
        Knowledge Vault
      </SectionTitle>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button onClick={() => setActiveFolder("All")} className={cx("px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap", activeFolder === "All" ? "bg-amber-500 border-amber-500 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-400")}>All</button>
        {folders.map((f) => (
          <button key={f} onClick={() => setActiveFolder(f)} className={cx("px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap", activeFolder === f ? "bg-amber-500 border-amber-500 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-400")}>{f}</button>
        ))}
      </div>

      {Object.entries(grouped).map(([folder, notes]) => (
        <div key={folder}>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1.5 px-1 flex items-center gap-1.5"><BookMarked size={12} />{folder}</div>
          <div className="space-y-2.5">
            {notes.map((n) => (
              <Accordion key={n.id} id={n.id} open={open} onToggle={setOpen} title={n.title} icon={FileText}>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line mb-3">{n.body}</p>
                <AttachmentGrid items={n.attachments} />
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800/70">
                  <button onClick={() => { setEditing(n); setFormOpen(true); }} className="flex items-center gap-1.5 text-xs text-slate-300 px-3 py-1.5 rounded-lg bg-slate-800"><Pencil size={12} /> Edit</button>
                  <button onClick={() => setConfirmId(n.id)} className="flex items-center gap-1.5 text-xs text-rose-400 px-3 py-1.5 rounded-lg bg-rose-500/10"><Trash2 size={12} /> Delete</button>
                </div>
              </Accordion>
            ))}
          </div>
        </div>
      ))}

      <ConfirmDialog open={!!confirmId} title="Delete note?" body="This note will be permanently removed."
        onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
    </div>
  );
}

/* ============================================================
   MORE — BACKUP
   ============================================================ */
function BackupPanel({ data, setData }) {
  const [copyOk, setCopyOk] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [confirmImport, setConfirmImport] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const exportText = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1800);
    } catch (e) { /* clipboard may be unavailable */ }
  };

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid format");
      setData({
        trades: parsed.trades || [],
        setups: parsed.setups || [],
        strategies: parsed.strategies || [],
        plans: parsed.plans || seedPlans(),
        psychology: parsed.psychology || [],
        vault: parsed.vault || [],
        smc: parsed.smc || seedSMC(),
        checkins: parsed.checkins || [],
        account: parsed.account || { startingBalance: 1000, currency: "€" },
      });
      setImportText(""); setImportError(""); setConfirmImport(false);
    } catch (e) {
      setImportError("Couldn't parse that JSON — check it was copied in full.");
      setConfirmImport(false);
    }
  };

  const doClear = () => { setData(DEFAULT_DATA()); setConfirmClear(false); };

  return (
    <div className="space-y-4">
      <SectionTitle sub="Your data lives in this artifact's storage">Backup &amp; Restore</SectionTitle>

      <Card>
        <div className="flex items-center gap-2 mb-2"><Download size={15} className="text-amber-400" /><span className="font-medium text-slate-100 text-sm">Export</span></div>
        <p className="text-xs text-slate-500 mb-2.5">Copy this JSON somewhere safe — paste it back in below to restore.</p>
        <TextArea readOnly value={exportText} className="min-h-[120px] text-[11px] font-mono" />
        <button onClick={copy} className="w-full mt-2.5 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-2.5 rounded-xl text-sm transition">
          {copyOk ? <><Check size={14} className="text-emerald-400" /> Copied</> : <><Copy size={14} /> Copy to clipboard</>}
        </button>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-2"><Upload size={15} className="text-amber-400" /><span className="font-medium text-slate-100 text-sm">Import</span></div>
        <p className="text-xs text-slate-500 mb-2.5">Paste previously exported JSON. This will overwrite your current data.</p>
        <TextArea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste exported JSON here..." className="min-h-[100px] text-[11px] font-mono" />
        {importError && <p className="text-xs text-rose-400 mt-1.5">{importError}</p>}
        <button onClick={() => importText.trim() && setConfirmImport(true)} className="w-full mt-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2.5 rounded-xl text-sm transition">
          Import &amp; Overwrite
        </button>
      </Card>

      <Card className="border-rose-500/20">
        <div className="flex items-center gap-2 mb-2"><RotateCcw size={15} className="text-rose-400" /><span className="font-medium text-slate-100 text-sm">Reset</span></div>
        <p className="text-xs text-slate-500 mb-2.5">Clears all trades, plans, notes &amp; psychology logs and restores the original SRC seed content.</p>
        <button onClick={() => setConfirmClear(true)} className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium py-2.5 rounded-xl text-sm transition">
          Clear All Data
        </button>
      </Card>

      <ConfirmDialog open={confirmImport} title="Overwrite all data?" body="Your current trades, setups, plans, and notes will be replaced with the imported data."
        onConfirm={doImport} onCancel={() => setConfirmImport(false)} />
      <ConfirmDialog open={confirmClear} title="Clear everything?" body="This restores the app to its original SRC starter content and cannot be undone."
        onConfirm={doClear} onCancel={() => setConfirmClear(false)} />
    </div>
  );
}

/* ============================================================
   MORE TAB (wraps Plans / Psychology / Vault / Backup)
   ============================================================ */
function MoreTab({ data, setData, subTab, setSubTab, goTo }) {
  const tabs = ["Account", "Plans", "Psychology", "Vault", "Backup", "Report"];

  if (subTab === "Report") {
    return <PerformanceReport data={data} onClose={() => setSubTab("Account")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((t) => (
          <button key={t} onClick={() => setSubTab(t)}
            className={cx("px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition", subTab === t ? "bg-amber-500 text-slate-950" : "bg-slate-900 border border-slate-800 text-slate-400")}>
            {t}
          </button>
        ))}
      </div>
      {subTab === "Account" && <AccountSettings data={data} setData={setData} />}
      {subTab === "Plans" && <PlansPanel data={data} setData={setData} goTo={goTo} />}
      {subTab === "Psychology" && <PsychologyPanel data={data} setData={setData} goTo={goTo} />}
      {subTab === "Vault" && <VaultPanel data={data} setData={setData} goTo={goTo} />}
      {subTab === "Backup" && <BackupPanel data={data} setData={setData} />}
    </div>
  );
}

/* ============================================================
   GLOBAL SEARCH
   ============================================================ */
function SearchOverlay({ data, onClose, onJump }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out = [];
    data.trades.forEach((t) => {
      const hay = [t.symbol, t.market, t.notes].join(" ").toLowerCase();
      if (hay.includes(term)) out.push({ type: "Trade", icon: ClipboardList, title: t.symbol || "Untitled trade", sub: t.date, go: () => onJump("journal") });
    });
    data.setups.forEach((s) => {
      const hay = [s.name, s.trend, s.notes, ...(s.tags || [])].join(" ").toLowerCase();
      if (hay.includes(term)) out.push({ type: "Setup", icon: Layers, title: s.name, sub: "Library · Setups", go: () => onJump("library", "Setups") });
    });
    data.strategies.forEach((s) => {
      const hay = [s.name, s.description, s.entryConditions, s.exitConditions].join(" ").toLowerCase();
      if (hay.includes(term)) out.push({ type: "Strategy", icon: BarChart3, title: s.name, sub: "Library · Strategies", go: () => onJump("library", "Strategies") });
    });
    data.plans.custom.forEach((p) => {
      const hay = [p.name, p.marketConditions, p.entryRules].join(" ").toLowerCase();
      if (hay.includes(term)) out.push({ type: "Plan", icon: ClipboardList, title: p.name, sub: "More · Plans", go: () => onJump("more", "Plans") });
    });
    data.vault.forEach((n) => {
      const hay = [n.title, n.body, n.folder].join(" ").toLowerCase();
      if (hay.includes(term)) out.push({ type: "Vault Note", icon: BookMarked, title: n.title, sub: `Vault · ${n.folder}`, go: () => onJump("more", "Vault") });
    });
    data.smc.forEach((t) => {
      const hay = [t.term, t.definition, t.notes].join(" ").toLowerCase();
      if (hay.includes(term)) out.push({ type: "Smart Money", icon: Brain, title: t.term, sub: "Academy · Smart Money", go: () => onJump("academy", "Smart Money") });
    });
    ACADEMY_MODULES.forEach((m) => {
      const hay = JSON.stringify(m.blocks).toLowerCase() + " " + m.title.toLowerCase();
      if (hay.includes(term)) out.push({ type: "Academy", icon: GraduationCap, title: m.title, sub: "Academy · Price Action", go: () => onJump("academy", "Price Action") });
    });
    data.psychology.forEach((p) => {
      const hay = [p.mistake, p.cause, p.solution].join(" ").toLowerCase();
      if (hay.includes(term)) out.push({ type: "Psychology", icon: ShieldAlert, title: p.mistake, sub: "More · Psychology", go: () => onJump("more", "Psychology") });
    });
    return out.slice(0, 40);
  }, [q, data]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      <div className="flex items-center gap-2 p-4 border-b border-slate-800">
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-200"><ArrowLeft size={20} /></button>
        <div className="flex-1 flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5">
          <Search size={16} className="text-slate-500" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trades, setups, plans, vault..."
            className="flex-1 bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-600" />
          {q && <button onClick={() => setQ("")}><X size={15} className="text-slate-500" /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {q.trim() === "" ? (
          <EmptyState icon={Search} title="Search everything" sub="Trades, setups, strategies, plans, vault notes, SMC terms & the academy guide." />
        ) : results.length === 0 ? (
          <EmptyState icon={Search} title="No matches" sub={`Nothing found for "${q}"`} />
        ) : (
          <div className="space-y-2">
            {results.map((r, i) => (
              <Card key={i} onClick={() => { r.go(); onClose(); }} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                  <r.icon size={16} className="text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-200 truncate">{r.title}</div>
                  <div className="text-[11px] text-slate-500">{r.sub}</div>
                </div>
                <Pill tone="slate">{r.type}</Pill>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const NAV_ITEMS = [
  { key: "home", label: "Home", icon: Home },
  { key: "journal", label: "Journal", icon: BookOpen },
  { key: "library", label: "Library", icon: Layers },
  { key: "academy", label: "Academy", icon: GraduationCap },
  { key: "more", label: "More", icon: MoreHorizontal },
];

export default function App() {
  const [data, setDataRaw] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [librarySubTab, setLibrarySubTab] = useState("Setups");
  const [academySubTab, setAcademySubTab] = useState("Price Action");
  const [moreSubTab, setMoreSubTab] = useState("Plans");
  const [searchOpen, setSearchOpen] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setDataRaw({ ...DEFAULT_DATA(), ...parsed, account: parsed.account || { startingBalance: 1000, currency: "€" } });
        } else {
          setDataRaw(DEFAULT_DATA());
        }
      } catch (e) {
        setDataRaw(DEFAULT_DATA());
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const setData = (updater) => {
    setDataRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        storage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      }, 400);
      return next;
    });
  };

  const goTo = (tab, sub) => {
    setActiveTab(tab);
    if (tab === "library" && sub) setLibrarySubTab(sub);
    if (tab === "academy" && sub) setAcademySubTab(sub);
    if (tab === "more" && sub) setMoreSubTab(sub);
  };

  if (!loaded || !data) {
    return (
      <div className="h-screen w-full bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Crown size={28} className="text-amber-400 animate-pulse" />
          <span className="text-slate-500 text-sm">Loading your trading OS...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-slate-950 flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 bg-slate-950/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <Crown size={18} className="text-amber-400" />
          <span className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>SRC Trading OS</span>
        </div>
        <button onClick={() => setSearchOpen(true)} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400">
          <Search size={17} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        {activeTab === "home" && <Dashboard data={data} setData={setData} goTo={goTo} />}
        {activeTab === "journal" && <JournalTab data={data} setData={setData} />}
        {activeTab === "library" && <LibraryTab data={data} setData={setData} subTab={librarySubTab} setSubTab={setLibrarySubTab} goTo={goTo} />}
        {activeTab === "academy" && <AcademyTab data={data} setData={setData} subTab={academySubTab} setSubTab={setAcademySubTab} />}
        {activeTab === "more" && <MoreTab data={data} setData={setData} subTab={moreSubTab} setSubTab={setMoreSubTab} goTo={goTo} />}
      </div>

      <div className="grid grid-cols-5 border-t border-slate-800 bg-slate-950/95 backdrop-blur shrink-0">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button key={item.key} onClick={() => setActiveTab(item.key)} className="flex flex-col items-center justify-center gap-1 py-2.5">
              <Icon size={19} className={isActive ? "text-amber-400" : "text-slate-500"} />
              <span className={cx("text-[10px] font-medium", isActive ? "text-amber-400" : "text-slate-500")}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {searchOpen && <SearchOverlay data={data} onClose={() => setSearchOpen(false)} onJump={goTo} />}
    </div>
  );
}
