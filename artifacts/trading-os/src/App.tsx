import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Home, BookOpen, Layers, GraduationCap, Search, Plus, X, TrendingUp, TrendingDown,
  Target, Percent, BarChart3, Calendar, Tag, ChevronDown, ChevronRight, Trash2, Pencil,
  Upload, Image as ImageIcon, FileText, Crown, AlertTriangle, CheckCircle2, ListChecks,
  BookMarked, Brain, ShieldAlert, Download, RotateCcw, Filter, Paperclip, ChevronUp,
  ChevronLeft, MoreHorizontal, Wallet, ClipboardList, ArrowLeft, Copy, Check, Sparkles,
  Trophy, Flame, Gauge, DollarSign, Smile, Zap, AlertCircle, CalendarDays, Activity, Calculator,
  Play, Eye, EyeOff, Repeat2, Clock, Lock, Shield, LogOut, GripVertical, RefreshCw
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
} from "recharts";
import { storage, getToken } from "./api";
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

  // If the user entered a manual P/L (from their broker), always use that
  const manualPnlNum = t.manualPnl !== undefined && t.manualPnl !== "" ? parseFloat(t.manualPnl) : null;
  if (manualPnlNum !== null && !isNaN(manualPnlNum)) {
    pnl = manualPnlNum;
    if (riskPerUnit && !isNaN(entry) && !isNaN(exit)) {
      rMultiple = ((exit - entry) * dir) / riskPerUnit;
      if (entry !== 0) pctMove = ((exit - entry) / Math.abs(entry)) * dir * 100;
    }
    if (pnl > 0.0000001) result = "Win";
    else if (pnl < -0.0000001) result = "Loss";
    else result = "Breakeven";
  } else if (!isNaN(entry) && !isNaN(exit)) {
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

function syncChallengeBalances(d: any) {
  const today = todayISO();
  return (d.propChallenges || []).map((c: any) => {
    if (c.status !== "active") return c;

    const prevLogs = [...(c.dailyLog || [])]
      .filter((e: any) => e.date < today)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    const baseBalance = prevLogs.length > 0
      ? parseFloat(prevLogs[prevLogs.length - 1].balance) || parseFloat(c.accountSize) || 0
      : parseFloat(c.accountSize) || 0;

    const todayTrades = (d.trades || []).filter((t: any) => t.date === today);
    const hasTodayTrades = todayTrades.length > 0;
    const todayPnl = todayTrades.reduce((sum: number, t: any) => sum + (computeTrade(t).pnl || 0), 0);

    const todayEntry = (c.dailyLog || []).find((e: any) => e.date === today);

    if (!hasTodayTrades) {
      if (todayEntry && todayEntry.auto) {
        return { ...c, dailyLog: (c.dailyLog || []).filter((e: any) => e.date !== today) };
      }
      return c;
    }

    if (todayEntry && !todayEntry.auto) return c;

    const newBalance = parseFloat((baseBalance + todayPnl).toFixed(2));
    const existingLog = (c.dailyLog || []).filter((e: any) => e.date !== today);
    const newLog = [...existingLog, { date: today, balance: String(newBalance), note: "", auto: true }]
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    return { ...c, dailyLog: newLog };
  });
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

const DEFAULT_SETTINGS = () => ({
  /* ── Dashboard visibility ── */
  dashVisibility: {
    moolMantar:      true,
    liveTicker:      true,
    marketOverview:  true,
    marketSessions:  true,
    accountOverview: true,
    todaysFocus:     true,
    propChallenges:  true,
    thisWeek:        true,
    riskTools:       true,
    recentTrades:    true,
    insightsEdge:    true,
    setupLibrary:    true,
    marketCalendar:  true,
    statistics:      true,
    reference:       true,
    activeTrades:    true,
  },
  dashSectionOrder: ["moolMantar","liveTicker","activeTrades","marketOverview","marketSessions","accountOverview","todaysFocus","propChallenges","thisWeek","riskTools","recentTrades","insightsEdge","setupLibrary","marketCalendar","statistics","reference"],
  /* ── Theme ── */
  accentColor: "#f59e0b",
  cardBg: "#0f172a",
  borderColor: "#1e293b",
  /* ── Journal / Trade Defaults ── */
  defaultMarket:    "Forex",
  defaultSide:      "Buy",
  defaultSession:   "",
  defaultRiskPct:   "1",
  defaultTradeType: "Normal",
  defaultSymbol:    "",
  /* ── Risk Rules ── */
  maxDailyLossPct:  "3",
  maxRiskPerTrade:  "2",
  maxTradesPerDay:  "",
  maxOpenTrades:    "",
  singleTradeLossAlertPct: "3",
  /* ── Display ── */
  dateFormat:   "DD/MM/YYYY",
  timeFormat:   "24h",
  pnlDisplay:   "currency",
  compactMode:  false,
  /* ── App Behaviour ── */
  showQuickLogFAB: true,
  defaultTab:      "home",
  showSearchBar:   true,
  /* ── Navigation visibility ── */
  navVisibility: {
    journal: true,
    library: true,
    academy: true,
    more:    true,
  },
  /* ── More sub-tab visibility ── */
  moreTabVisibility: {
    Account:    true,
    Session:    true,
    Plans:      true,
    Psychology: true,
    Vault:      true,
    Prop:       true,
    Backup:     true,
    Report:     true,
  },
  /* ── Notification toggles ── */
  notifications: {
    dailyLossLimit:        true,
    singleTradeLoss:       true,
    overtradingWarning:    true,
    maxOpenTrades:         true,
    losingStreak:          true,
    winningStreak:         true,
    winRateDropping:       true,
    profitFactorBelow1:    true,
    propDailyLossApproach: true,
    propDailyLossHit:      true,
    propTargetReached:     true,
    propMaxDrawdown:       true,
    drawdownWarning:       true,
    newAllTimeHigh:        true,
    bigWin:                true,
    bigLoss:               true,
    ungradedTrades:        true,
    weeklyGreen:           true,
    weeklyRed:             true,
    monthlyReview:         true,
    tradesMilestone:       true,
    psychologyReminder:    true,
    vaultReminder:         true,
    dailyGoalHit:          true,
    bestSetupAlert:        true,
  },
});

const DEFAULT_DATA = () => ({
  trades: [],
  setups: seedSetups(),
  strategies: seedStrategies(),
  plans: seedPlans(),
  psychology: [],
  vault: seedVault(),
  smc: seedSMC(),
  checkins: [],
  preSession: [],
  account: { startingBalance: 1000, currency: "€" },
  tradingAccounts: [],
  propChallenges: [],
  sessionPlans: [],
  settings: DEFAULT_SETTINGS(),
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
  useEffect(() => {
    if (!onBack) return;
    window.history.pushState({ srcFullPage: true }, "");
    const handlePop = (e: PopStateEvent) => {
      e.preventDefault();
      onBack();
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

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
const TRADING_PLATFORMS = ["MT4", "MT5", "TradingView", "cTrader", "IBKR", "Pepperstone", "IC Markets", "XM", "FXCM", "Exness", "Bybit", "Binance", "Other"];
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
// JPY_NOTE: pip value for JPY pairs ≈ 100,000 × 0.01 / USDJPY.
// At USDJPY ≈ 153 this is ~$6.54. Updated from legacy $9 (USDJPY ≈ 111 era).
const JPY_PIP_VAL = 6.5; // approximate at USDJPY ~153 — verify with broker
const JPY_NOTE = "Pip val ≈ $6.5 (varies with USDJPY rate)";

const INSTRUMENT_SPECS = {
  // ── Forex Majors ─────────────────────────────────────────
  // USD-quoted pairs: pip value = 100,000 × 0.0001 = $10/lot (fixed)
  EURUSD: { pipSize: 0.0001, pipValuePerLot: 10,   contractSize: 100000, unit: "units", category: "Forex" },
  GBPUSD: { pipSize: 0.0001, pipValuePerLot: 10,   contractSize: 100000, unit: "units", category: "Forex" },
  AUDUSD: { pipSize: 0.0001, pipValuePerLot: 10,   contractSize: 100000, unit: "units", category: "Forex" },
  NZDUSD: { pipSize: 0.0001, pipValuePerLot: 10,   contractSize: 100000, unit: "units", category: "Forex" },
  // Non-USD quote: pip value varies; approximate used
  USDCHF: { pipSize: 0.0001, pipValuePerLot: 9.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $9.4 (varies with USDCHF)" },
  USDCAD: { pipSize: 0.0001, pipValuePerLot: 7.3,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $7.3 (varies with USDCAD)" },
  // JPY pairs: pip = 0.01; value = 100,000 × 0.01 / USDJPY ≈ $6.5 at USDJPY 153
  USDJPY: { pipSize: 0.01,   pipValuePerLot: JPY_PIP_VAL, contractSize: 100000, unit: "units", category: "Forex", note: JPY_NOTE },
  // ── Forex Crosses ─────────────────────────────────────────
  EURGBP: { pipSize: 0.0001, pipValuePerLot: 12.7, contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $12.7 (varies with GBPUSD)" },
  EURJPY: { pipSize: 0.01,   pipValuePerLot: JPY_PIP_VAL, contractSize: 100000, unit: "units", category: "Forex", note: JPY_NOTE },
  EURCHF: { pipSize: 0.0001, pipValuePerLot: 9.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $9.4 (varies with USDCHF)" },
  EURAUD: { pipSize: 0.0001, pipValuePerLot: 6.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $6.4 (varies with AUDUSD)" },
  EURNZD: { pipSize: 0.0001, pipValuePerLot: 6.0,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $6.0 (varies with NZDUSD)" },
  EURCAD: { pipSize: 0.0001, pipValuePerLot: 7.3,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $7.3 (varies with USDCAD)" },
  GBPJPY: { pipSize: 0.01,   pipValuePerLot: JPY_PIP_VAL, contractSize: 100000, unit: "units", category: "Forex", note: JPY_NOTE },
  GBPCHF: { pipSize: 0.0001, pipValuePerLot: 9.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $9.4 (varies with USDCHF)" },
  GBPAUD: { pipSize: 0.0001, pipValuePerLot: 6.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $6.4 (varies with AUDUSD)" },
  GBPNZD: { pipSize: 0.0001, pipValuePerLot: 6.0,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $6.0 (varies with NZDUSD)" },
  GBPCAD: { pipSize: 0.0001, pipValuePerLot: 7.3,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $7.3 (varies with USDCAD)" },
  AUDJPY: { pipSize: 0.01,   pipValuePerLot: JPY_PIP_VAL, contractSize: 100000, unit: "units", category: "Forex", note: JPY_NOTE },
  NZDJPY: { pipSize: 0.01,   pipValuePerLot: JPY_PIP_VAL, contractSize: 100000, unit: "units", category: "Forex", note: JPY_NOTE },
  CADJPY: { pipSize: 0.01,   pipValuePerLot: JPY_PIP_VAL, contractSize: 100000, unit: "units", category: "Forex", note: JPY_NOTE },
  CHFJPY: { pipSize: 0.01,   pipValuePerLot: JPY_PIP_VAL, contractSize: 100000, unit: "units", category: "Forex", note: JPY_NOTE },
  AUDNZD: { pipSize: 0.0001, pipValuePerLot: 6.0,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $6.0 (varies with NZDUSD)" },
  AUDCAD: { pipSize: 0.0001, pipValuePerLot: 7.3,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $7.3 (varies with USDCAD)" },
  AUDCHF: { pipSize: 0.0001, pipValuePerLot: 9.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $9.4 (varies with USDCHF)" },
  NZDCAD: { pipSize: 0.0001, pipValuePerLot: 7.3,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $7.3 (varies with USDCAD)" },
  NZDCHF: { pipSize: 0.0001, pipValuePerLot: 9.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $9.4 (varies with USDCHF)" },
  CADCHF: { pipSize: 0.0001, pipValuePerLot: 9.4,  contractSize: 100000, unit: "units", category: "Forex", note: "Pip val ≈ $9.4 (varies with USDCHF)" },
  // ── Gold & Silver ─────────────────────────────────────────
  // XAUUSD: 1 lot = 100 oz. Pip = $0.10/oz move. Pip value = 100 × $0.10 = $10/lot.
  // A $15 stop = 150 pts. Lots = risk / (150 × $10).
  XAUUSD: { pipSize: 0.10,  pipValuePerLot: 10,   contractSize: 100, unit: "oz", category: "Gold",
    note: "1 lot = 100 oz · 1 pt = $0.10/oz move · $10/lot" },
  // XAGUSD: 1 lot = 5000 oz. Pip = $0.001. Pip value = 5000 × $0.001 = $5/lot.
  XAGUSD: { pipSize: 0.001,  pipValuePerLot: 5,    contractSize: 5000, unit: "oz", category: "Silver",
    note: "1 lot = 5000 oz · pip val $5/lot" },
  // ── Oil ───────────────────────────────────────────────────
  // 1 lot = 1000 barrels. Pip = $0.01. Pip value = 1000 × $0.01 = $10/lot.
  USOIL:  { pipSize: 0.01,  pipValuePerLot: 10,   contractSize: 1000, unit: "barrels", category: "Oil",
    note: "1 lot = 1000 bbl · pip val $10/lot" },
  UKOIL:  { pipSize: 0.01,  pipValuePerLot: 10,   contractSize: 1000, unit: "barrels", category: "Oil",
    note: "1 lot = 1000 bbl · pip val $10/lot" },
  // ── Indices — these are CFD/broker-specific ───────────────
  // Most retail brokers: 1 standard lot CFD = $1 per point for US30/NAS100
  US30:   { pipSize: 1,     pipValuePerLot: 1,    contractSize: 1, unit: "contracts", category: "Indices",
    note: "1 pt = $1/lot (verify with broker)" },
  NAS100: { pipSize: 0.1,   pipValuePerLot: 1,    contractSize: 1, unit: "contracts", category: "Indices",
    note: "0.1 pt = $1/lot (verify with broker)" },
  SPX500: { pipSize: 0.1,   pipValuePerLot: 10,   contractSize: 1, unit: "contracts", category: "Indices",
    note: "0.1 pt = $10/lot (verify with broker)" },
  DAX40:  { pipSize: 0.1,   pipValuePerLot: 1,    contractSize: 1, unit: "contracts", category: "Indices",
    note: "0.1 pt = $1/lot (verify with broker)" },
  FTSE100:{ pipSize: 0.1,   pipValuePerLot: 10,   contractSize: 1, unit: "contracts", category: "Indices",
    note: "0.1 pt = $10/lot (verify with broker)" },
  // ── Crypto ────────────────────────────────────────────────
  BTCUSD: { pipSize: 1,     pipValuePerLot: 1,    contractSize: 1, unit: "BTC", category: "Crypto",
    note: "$1 per lot per $1 move (verify with broker)" },
  ETHUSD: { pipSize: 0.01,  pipValuePerLot: 1,    contractSize: 1, unit: "ETH", category: "Crypto" },
  SOLUSD: { pipSize: 0.001, pipValuePerLot: 1,    contractSize: 1, unit: "SOL", category: "Crypto" },
};

function getSpec(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  return INSTRUMENT_SPECS[upper] || null;
}

/* ── Quick SL/TP pip helper ── */
function getPipInfo(symbol: string): { pip: number; dec: number; label: string } {
  const s = (symbol || "").toUpperCase();
  if (/JPY/.test(s)) return { pip: 0.01, dec: 3, label: "pips" };
  if (/XAU|GOLD/.test(s)) return { pip: 0.1, dec: 2, label: "pts" };
  if (/XAG|SILVER/.test(s)) return { pip: 0.001, dec: 4, label: "pts" };
  if (/US30|DJI|DOW|US100|NAS(100)?|NDX|US500|SP(X|500)|DAX|FTSE|CAC|NIKKEI/.test(s)) return { pip: 1, dec: 0, label: "pts" };
  if (/OIL|WTI|BRENT/.test(s)) return { pip: 0.01, dec: 3, label: "pts" };
  if (/BTC|ETH|SOL|XRP|ADA|LTC/.test(s)) return { pip: 1, dec: 0, label: "pts" };
  return { pip: 0.0001, dec: 5, label: "pips" };
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
   NOTIFICATION ENGINE
   ============================================================ */
type OTXNotif = {
  id: string;
  key: string;        // matches DEFAULT_SETTINGS().notifications key
  title: string;
  body: string;
  tone: "rose" | "amber" | "emerald" | "sky" | "violet" | "slate";
  icon: string;       // emoji
  ts: number;         // Date.now() when generated
  read: boolean;
};

function computeNotifications(data: any, enabled: Record<string, boolean>): OTXNotif[] {
  const notifs: OTXNotif[] = [];
  const push = (key: string, id: string, title: string, body: string, tone: OTXNotif["tone"], icon: string) => {
    if (enabled[key] === false) return;
    notifs.push({ id, key, title, body, tone, icon, ts: Date.now(), read: false });
  };

  const today = todayISO();
  const a = computeAnalytics(data);
  const acc = data.account || { startingBalance: 1000, currency: "€" };
  const startBal = parseFloat(String(acc.startingBalance)) || 0;
  const cur = acc.currency || "€";
  const settings = { ...DEFAULT_SETTINGS(), ...(data.settings || {}) };
  const trades = data.trades || [];
  const closed = a.closedTrades || [];

  const todayTrades = closed.filter((t: any) => t.date === today);
  const todayPnl = todayTrades.reduce((s: number, t: any) => s + (t.c?.pnl || 0), 0);
  const todayCount = trades.filter((t: any) => t.date === today).length;
  const openTrades = trades.filter((t: any) => !t.exit).length;
  const weekStart = (() => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const weekTrades = closed.filter((t: any) => t.date >= weekStart && t.date <= today);
  const weekPnl = weekTrades.reduce((s: number, t: any) => s + (t.c?.pnl || 0), 0);

  /* ── RISK ALERTS ── */
  const maxDailyLossPct = parseFloat(settings.maxDailyLossPct || "") || 0;
  if (maxDailyLossPct > 0 && startBal > 0) {
    const limitAmt = (maxDailyLossPct / 100) * startBal;
    const todayLoss = Math.max(0, -todayPnl);
    if (todayLoss >= limitAmt) {
      push("dailyLossLimit", "daily_loss_hit", "🛑 Daily Loss Limit Hit",
        `You've lost ${cur}${todayLoss.toFixed(2)} today — max allowed: ${cur}${limitAmt.toFixed(2)} (${maxDailyLossPct}%). Stop trading.`, "rose", "🛑");
    }
  }

  const singleAlertPct = parseFloat(settings.singleTradeLossAlertPct || "") || 3;
  if (startBal > 0) {
    const sortedToday = [...todayTrades].sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
    const lastLoss = sortedToday.find((t: any) => (t.c?.pnl || 0) < 0);
    if (lastLoss) {
      const pct = (Math.abs(lastLoss.c.pnl) / startBal) * 100;
      if (pct >= singleAlertPct) {
        push("singleTradeLoss", "single_trade_loss", "⚠ Large Single-Trade Loss",
          `${lastLoss.symbol || "A trade"} lost ${cur}${Math.abs(lastLoss.c.pnl).toFixed(2)} (${pct.toFixed(1)}% of account). Was this in your plan?`, "rose", "⚠");
      }
    }
  }

  const maxTrades = parseInt(settings.maxTradesPerDay || "") || 0;
  if (maxTrades > 0 && todayCount >= maxTrades) {
    push("overtradingWarning", "overtrading", "⚠ Max Trades Reached",
      `You've placed ${todayCount} trades today — your limit is ${maxTrades}. No more trades.`, "amber", "⚠");
  }

  const maxOpen = parseInt(settings.maxOpenTrades || "") || 0;
  if (maxOpen > 0 && openTrades >= maxOpen) {
    push("maxOpenTrades", "max_open", "⚠ Max Open Trades",
      `${openTrades} trades currently open — your limit is ${maxOpen}. Close some before opening new ones.`, "amber", "⚠");
  }

  /* ── STREAKS ── */
  const streak = a.currentStreakLength || 0;
  const streakType = a.currentStreakType;
  if (streakType === "Loss" && streak >= 3) {
    push("losingStreak", "losing_streak", "🩸 Losing Streak",
      `${streak} consecutive losses. Step back, review your entries, and reset your mindset before the next trade.`, "rose", "🩸");
  }
  if (streakType === "Win" && streak >= 3) {
    push("winningStreak", "winning_streak", "🔥 Winning Streak",
      `${streak} wins in a row! Stay disciplined — don't let confidence turn into overtrading.`, "emerald", "🔥");
  }

  /* ── EDGE / ANALYTICS ALERTS ── */
  const last10 = closed.slice(-10);
  if (last10.length >= 5) {
    const wr10 = last10.filter((t: any) => t.c?.result === "Win").length / last10.length * 100;
    if (wr10 < 40) {
      push("winRateDropping", "wr_drop", "📉 Win Rate Dropping",
        `Last 10 trades: ${wr10.toFixed(0)}% win rate. Review your setup criteria — your edge may be slipping.`, "amber", "📉");
    }
  }

  if (a.profitFactor !== null && a.profitFactor !== Infinity && a.profitFactor < 1 && closed.length >= 5) {
    push("profitFactorBelow1", "pf_below1", "🚨 Profit Factor Below 1",
      `Profit factor is ${a.profitFactor.toFixed(2)} — you're losing more than you're making. System review needed.`, "rose", "🚨");
  }

  /* ── PROP CHALLENGE ALERTS ── */
  (data.propChallenges || []).filter((c: any) => c.status === "active").forEach((ch: any) => {
    const size = parseFloat(ch.accountSize) || 0;
    const maxDD = parseFloat(ch.maxDrawdown) || 0;
    const dailyDD = parseFloat(ch.dailyDrawdown) || 0;
    const target = parseFloat(ch.profitTarget) || 0;
    const logs = ch.dailyLog || [];
    const lastBal = logs.length ? parseFloat(logs[logs.length - 1].balance) || size : size;
    const todayLog = logs.find((l: any) => l.date === today);
    const todayLoss = todayLog ? Math.max(0, size - parseFloat(todayLog.balance || "0")) : 0;

    if (dailyDD > 0 && size > 0) {
      const dailyLimitAmt = (dailyDD / 100) * size;
      if (todayLoss >= dailyLimitAmt) {
        push("propDailyLossHit", `prop_daily_hit_${ch.id}`, `🛑 Prop Daily Loss Hit — ${ch.name}`,
          `Daily drawdown limit reached on "${ch.name}". STOP trading immediately to protect the account.`, "rose", "🛑");
      } else if (todayLoss >= dailyLimitAmt * 0.8) {
        push("propDailyLossApproach", `prop_daily_approach_${ch.id}`, `⚠ Prop DD Limit Approaching — ${ch.name}`,
          `You're 80%+ into your daily drawdown limit on "${ch.name}". Trade with extreme caution.`, "amber", "⚠");
      }
    }

    if (target > 0 && size > 0 && lastBal >= size + (target / 100) * size) {
      push("propTargetReached", `prop_target_${ch.id}`, `🏆 Prop Target Reached — ${ch.name}`,
        `"${ch.name}" has hit its profit target! Request payout or move to the next phase.`, "emerald", "🏆");
    }

    if (maxDD > 0 && size > 0) {
      const maxDDamt = (maxDD / 100) * size;
      const totalLoss = size - lastBal;
      if (totalLoss >= maxDDamt * 0.9) {
        push("propMaxDrawdown", `prop_maxdd_${ch.id}`, `🚨 Prop Max Drawdown — ${ch.name}`,
          `"${ch.name}" is within 10% of max drawdown limit. One bad trade could fail the challenge.`, "rose", "🚨");
      }
    }
  });

  /* ── ACCOUNT HEALTH ── */
  if (startBal > 0 && closed.length >= 5) {
    const peak = closed.reduce((p: number, t: any) => {
      return Math.max(p, startBal + closed.slice(0, closed.indexOf(t) + 1).reduce((s: number, x: any) => s + (x.c?.pnl || 0), 0));
    }, startBal);
    const current = startBal + a.totalPnl;
    const ddPct = peak > 0 ? ((peak - current) / peak) * 100 : 0;
    if (ddPct >= 5) {
      push("drawdownWarning", "account_drawdown", "⚠ Account Drawdown",
        `You're ${ddPct.toFixed(1)}% below your account peak. Review position sizing and risk management.`, "amber", "⚠");
    }
    if (current > peak && peak > startBal) {
      push("newAllTimeHigh", "ath", "🚀 New Account High!",
        `Account is at ${cur}${current.toFixed(2)} — a new all-time high. Stay disciplined and keep compounding.`, "emerald", "🚀");
    }
  }

  /* ── TRADE QUALITY ── */
  const last5Trades = [...trades].sort((a: any, b: any) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  const bigWin = last5Trades.find((t: any) => { const c = computeTrade(t); return c.rMultiple !== null && c.rMultiple >= 3; });
  if (bigWin) {
    const c = computeTrade(bigWin);
    push("bigWin", "big_win", "💰 Big Winner!",
      `${bigWin.symbol || "Last trade"} hit +${c.rMultiple?.toFixed(1)}R — ${cur}${(c.pnl || 0).toFixed(2)}. Great execution!`, "emerald", "💰");
  }
  const bigLoss = last5Trades.find((t: any) => { const c = computeTrade(t); return c.rMultiple !== null && c.rMultiple <= -2; });
  if (bigLoss) {
    const c = computeTrade(bigLoss);
    push("bigLoss", "big_loss", "🩸 Large Loss",
      `${bigLoss.symbol || "Last trade"} lost ${c.rMultiple?.toFixed(1)}R — ${cur}${Math.abs(c.pnl || 0).toFixed(2)}. Debrief this trade.`, "rose", "🩸");
  }

  const ungradedCount = trades.filter((t: any) => !t.grade && t.exit).length;
  if (ungradedCount >= 3) {
    push("ungradedTrades", "ungraded", "📝 Ungraded Trades",
      `${ungradedCount} closed trades have no grade. Review and score them to track your execution quality.`, "sky", "📝");
  }

  /* ── WEEKLY REVIEW ── */
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 5) {
    if (weekPnl > 0 && weekTrades.length > 0) {
      push("weeklyGreen", "weekly_green", "✅ Green Week!",
        `You finished this week +${cur}${weekPnl.toFixed(2)} with ${weekTrades.length} closed trades. Well done!`, "emerald", "✅");
    }
    if (weekPnl < 0 && weekTrades.length > 0) {
      push("weeklyRed", "weekly_red", "📉 Red Week",
        `This week closed at ${cur}${weekPnl.toFixed(2)}. Review your mistakes this weekend before trading Monday.`, "rose", "📉");
    }
  }

  /* ── MONTHLY REVIEW ── */
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  if (new Date().getDate() === daysInMonth) {
    push("monthlyReview", "monthly_review", "📋 Month Ending Tomorrow",
      `Do your monthly performance review before the month closes. Check statistics and set goals for next month.`, "sky", "📋");
  }

  /* ── MILESTONES ── */
  const milestones = [10, 25, 50, 100, 250, 500, 1000];
  const milestone = milestones.find((m) => trades.length === m);
  if (milestone) {
    push("tradesMilestone", `milestone_${milestone}`, `🎯 ${milestone} Trades Logged!`,
      `You've now logged ${milestone} trades in Onkar TradeX. Check your Statistics to see how your edge has evolved.`, "violet", "🎯");
  }

  /* ── HABIT REMINDERS ── */
  const lastPsych = (data.psychology || []).slice().sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""))[0];
  if (!lastPsych || (today > (lastPsych.date || "") && (new Date(today).getTime() - new Date(lastPsych.date || today).getTime()) / 86400000 >= 7)) {
    push("psychologyReminder", "psych_reminder", "🧠 Psychology Log",
      `No mindset entry in the last 7 days. Log how you're feeling about your trading — mental edge matters.`, "violet", "🧠");
  }

  const lastVault = (data.vault || []).slice().sort((a: any, b: any) => (b.updatedAt || b.id || "").localeCompare(a.updatedAt || a.id || ""))[0];
  if (!lastVault || (new Date(today).getTime() - new Date(lastVault.updatedAt || lastVault.id?.slice(0, 10) || today).getTime()) / 86400000 >= 14) {
    push("vaultReminder", "vault_reminder", "📒 Vault Review",
      `Your vault hasn't been updated in 14+ days. Review your notes and knowledge base to stay sharp.`, "slate", "📒");
  }

  /* ── DAILY GOAL ── */
  const todayCheckin = (data.checkins || []).find((c: any) => c.date === today);
  const dailyGoalAmt = parseFloat(todayCheckin?.dailyGoal || "") || 0;
  if (dailyGoalAmt > 0 && todayPnl >= dailyGoalAmt) {
    push("dailyGoalHit", "daily_goal_hit", "✅ Daily Goal Hit!",
      `Today's P&L (${cur}${todayPnl.toFixed(2)}) has reached your daily goal of ${cur}${dailyGoalAmt.toFixed(2)}. Consider stopping here.`, "emerald", "✅");
  }

  /* ── BEST SETUP ── */
  if (a.bestSetup && a.bestSetup.pnl > 0 && a.bestSetup.count >= 3) {
    push("bestSetupAlert", "best_setup", "🏅 Your Best Setup",
      `"${a.bestSetup.label}" is your most profitable setup with ${cur}${a.bestSetup.pnl.toFixed(2)} P&L across ${a.bestSetup.count} trades. Trade it more.`, "emerald", "🏅");
  }

  return notifs;
}

/* ============================================================
   NOTIFICATION CENTRE UI
   ============================================================ */
const NOTIF_TONE_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  rose:    { bg: "rgba(239,68,68,0.08)",    border: "rgba(239,68,68,0.25)",    text: "#f87171" },
  amber:   { bg: "rgba(245,158,11,0.08)",   border: "rgba(245,158,11,0.25)",   text: "#fbbf24" },
  emerald: { bg: "rgba(16,185,129,0.08)",   border: "rgba(16,185,129,0.25)",   text: "#34d399" },
  sky:     { bg: "rgba(14,165,233,0.08)",   border: "rgba(14,165,233,0.25)",   text: "#38bdf8" },
  violet:  { bg: "rgba(139,92,246,0.08)",   border: "rgba(139,92,246,0.25)",   text: "#a78bfa" },
  slate:   { bg: "rgba(100,116,139,0.08)",  border: "rgba(100,116,139,0.25)",  text: "#94a3b8" },
};

function NotificationCentre({ notifs, onMarkAllRead, onDismiss, onClose, accent }: any) {
  const unread = notifs.filter((n: OTXNotif) => !n.read).length;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-200"><ArrowLeft size={20} /></button>
          <div>
            <h2 className="text-base font-semibold text-slate-100">Notifications</h2>
            <p className="text-[11px] text-slate-500">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
          </div>
        </div>
        {notifs.length > 0 && (
          <button onClick={onMarkAllRead} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200">
            Mark all read
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {notifs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <span className="text-4xl">🔔</span>
            <p className="text-slate-400 font-medium">No notifications right now</p>
            <p className="text-slate-600 text-sm">Alerts will appear here as you trade — risk limits, streaks, milestones and more.</p>
          </div>
        )}
        {notifs.map((n: OTXNotif) => {
          const s = NOTIF_TONE_STYLES[n.tone] || NOTIF_TONE_STYLES.slate;
          return (
            <div key={n.id}
              className="relative flex gap-3 p-3.5 rounded-2xl border transition"
              style={{ background: n.read ? "transparent" : s.bg, borderColor: n.read ? "#1e293b" : s.border }}>
              {!n.read && <div className="absolute top-3 right-3 w-2 h-2 rounded-full" style={{ background: s.text }} />}
              <div className="text-xl leading-none pt-0.5 shrink-0">{n.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-100 leading-snug">{n.title}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{n.body}</p>
              </div>
              <button onClick={() => onDismiss(n.id)} className="text-slate-700 hover:text-slate-500 shrink-0 mt-0.5"><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Bell button with badge ── */
function NotifBell({ count, onClick, accent }: any) {
  return (
    <button onClick={onClick} className="relative p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center text-slate-950"
          style={{ background: accent || "#f59e0b" }}>
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

/* ── Toast notification bar ── */
function NotifToast({ notif, onDismiss }: { notif: OTXNotif; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [notif.id]);
  const s = NOTIF_TONE_STYLES[notif.tone] || NOTIF_TONE_STYLES.slate;
  return (
    <div className="fixed top-4 left-4 right-4 z-[999] flex items-start gap-3 p-3.5 rounded-2xl border shadow-2xl shadow-black/60 animate-[slideDown_0.3s_ease]"
      style={{ background: "#0f172a", borderColor: s.border }}>
      <span className="text-lg leading-none shrink-0">{notif.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug" style={{ color: s.text }}>{notif.title}</p>
        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{notif.body}</p>
      </div>
      <button onClick={onDismiss} className="text-slate-600 hover:text-slate-400 shrink-0"><X size={14} /></button>
    </div>
  );
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

  const spec = getSpec(sym);
  const isGold = sym === "XAUUSD";

  const tpCalc = useMemo(() => {
    if (!rrNum || !entry || !sl) return null;
    const e = parseFloat(entry), s = parseFloat(sl);
    if (isNaN(e) || isNaN(s)) return null;
    const dist = Math.abs(e - s);
    const rawTp = direction === "Buy" ? e + dist * rrNum : e - dist * rrNum;
    const potProfit = effectiveRiskAmt * rrNum;
    // Round TP to nearest pip/point for this instrument
    const pSize = spec?.pipSize ?? 0.00001;
    const decimals = Math.max(0, Math.round(-Math.log10(pSize)));
    const tp = parseFloat(rawTp.toFixed(decimals));
    return { tp, potProfit, decimals };
  }, [rrNum, entry, sl, direction, effectiveRiskAmt, spec]);

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
              <div className="text-sm font-bold text-sky-400">{tpCalc.tp.toFixed(tpCalc.decimals)}</div>
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
          {spec?.note && (
            <div className="rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 flex items-center gap-2">
              <span className="text-slate-500 text-sm">ℹ</span>
              <span className="text-[11px] text-slate-400">{spec.category} · {spec.note}</span>
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

/* ── Trading Accounts Manager ── */
function TradingAccountsManager({ data, setData }: any) {
  const accounts: any[] = data.tradingAccounts || [];
  const emptyTA = () => ({ alias: "", accountNumber: "", platform: "MT4", accountType: "Live", currency: "USD" });
  const [form, setForm] = useState<any>(emptyTA());
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const setF = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    if (!form.accountNumber.trim()) return;
    if (editId) {
      setData((d: any) => ({ ...d, tradingAccounts: (d.tradingAccounts || []).map((a: any) => a.id === editId ? { ...form, id: editId } : a) }));
    } else {
      setData((d: any) => ({ ...d, tradingAccounts: [...(d.tradingAccounts || []), { ...form, id: uid() }] }));
    }
    setForm(emptyTA()); setEditId(null); setOpen(false);
  };

  const del = (id: string) => {
    if (!confirm("Remove this account?")) return;
    setData((d: any) => ({ ...d, tradingAccounts: (d.tradingAccounts || []).filter((a: any) => a.id !== id) }));
  };

  const startEdit = (a: any) => {
    setForm({ alias: a.alias || "", accountNumber: a.accountNumber, platform: a.platform, accountType: a.accountType, currency: a.currency });
    setEditId(a.id); setOpen(true);
  };

  const PLAT_CLR: Record<string, string> = { MT4: "#4fc3f7", MT5: "#29b6f6", TradingView: "#2196f3", cTrader: "#00bcd4", IBKR: "#ff7043" };
  const TYPE_CLS: Record<string, string> = {
    Live: "bg-emerald-500/15 text-emerald-400",
    Demo: "bg-amber-500/15 text-amber-400",
    Prop: "bg-sky-500/15 text-sky-400",
    Challenge: "bg-purple-500/15 text-purple-400",
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-amber-400" />
          <span className="font-semibold text-slate-100 text-sm">Trading Accounts</span>
          {accounts.length > 0 && (
            <span className="text-[10px] bg-slate-800 text-slate-400 rounded-full px-2 py-0.5 font-medium">{accounts.length}</span>
          )}
        </div>
        {!open && (
          <button onClick={() => { setForm(emptyTA()); setEditId(null); setOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 transition">
            <Plus size={12} /> Add Account
          </button>
        )}
      </div>

      {/* Add/Edit form */}
      {open && (
        <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 mb-4 space-y-3">
          <div className="text-xs font-semibold text-amber-400">{editId ? "Edit Account" : "➕ New Trading Account"}</div>
          <Field label="Account Number / Login ID">
            <TextInput placeholder="e.g. 12345678" value={form.accountNumber} onChange={setF("accountNumber")} />
          </Field>
          <Field label="Nickname" hint="Optional — e.g. My FTMO Live">
            <TextInput placeholder="My Live Account" value={form.alias} onChange={setF("alias")} />
          </Field>
          <Field label="Platform / Broker">
            <TextInput list="ta-plat-list" placeholder="MT4, MT5, TradingView..." value={form.platform} onChange={setF("platform")} />
            <datalist id="ta-plat-list">
              {TRADING_PLATFORMS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account Type">
              <Select value={form.accountType} onChange={setF("accountType")}>
                {["Live", "Demo", "Prop", "Challenge"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onChange={setF("currency")}>
                {["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SGD"].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => { setOpen(false); setEditId(null); setForm(emptyTA()); }}
              className="py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm font-medium hover:bg-slate-800 transition">
              Cancel
            </button>
            <button onClick={save} disabled={!form.accountNumber.trim()}
              className="py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-40 transition">
              {editId ? "Save Changes" : "Add Account"}
            </button>
          </div>
        </div>
      )}

      {/* Account list */}
      {accounts.length === 0 && !open ? (
        <div className="text-center py-6">
          <div className="text-3xl mb-2">🏦</div>
          <div className="text-slate-500 text-sm font-medium">No accounts yet</div>
          <div className="text-[11px] text-slate-600 mt-1 leading-relaxed">
            Add your MT4/MT5 or broker account numbers<br />to tag your trades and prop challenges
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a: any) => {
            const platClr = PLAT_CLR[a.platform] || "#64748b";
            return (
              <div key={a.id} className="flex items-center gap-3 bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-800">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-slate-100 tracking-wide">{a.accountNumber}</span>
                    {a.alias && <span className="text-xs text-slate-500 truncate">{a.alias}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border"
                      style={{ color: platClr, borderColor: platClr + "40", background: platClr + "18" }}>
                      {a.platform}
                    </span>
                    <span className={cx("text-[10px] px-1.5 py-0.5 rounded-md font-medium", TYPE_CLS[a.accountType] || "bg-slate-800 text-slate-400")}>
                      {a.accountType}
                    </span>
                    <span className="text-[10px] text-slate-600">{a.currency}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(a)} className="p-1.5 rounded-lg text-slate-600 hover:text-amber-400 hover:bg-slate-800 transition">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => del(a.id)} className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 transition">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
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
      <TradingAccountsManager data={data} setData={setData} />
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
   DASHBOARD — PRE-SESSION CHECKLIST (with streak tracking)
   ============================================================ */
const PRE_SESSION_ITEMS = [
  { key: "news",    label: "Economic news checked",    desc: "High-impact news on ForexFactory reviewed" },
  { key: "bias",    label: "Market bias confirmed",    desc: "HTF analysis done — direction is clear" },
  { key: "session", label: "Session window set",       desc: "Trading hours confirmed, timer ready" },
  { key: "risk",    label: "Risk limit confirmed",     desc: "Max loss today decided and accepted" },
  { key: "plan",    label: "Trading plan reviewed",    desc: "Rules fresh in mind" },
  { key: "mindset", label: "Mindset check passed",     desc: "Calm, patient, ready to wait for A+ setups" },
];

function emptyPreSession(date) {
  return { date, items: { news: false, bias: false, session: false, risk: false, plan: false, mindset: false } };
}

function preSessionStreak(logs, todayStr) {
  let streak = 0;
  const dt = new Date(todayStr + "T12:00:00");
  // only count today if all done
  while (true) {
    const dStr = dt.toISOString().slice(0, 10);
    const log = logs.find((l) => l.date === dStr);
    const allDone = log && PRE_SESSION_ITEMS.every((i) => log.items[i.key]);
    if (!allDone) break;
    streak++;
    dt.setDate(dt.getDate() - 1);
  }
  return streak;
}

function PreSessionChecklist({ data, setData }) {
  const today = todayISO();
  const logs = data.preSession || [];
  const existing = logs.find((l) => l.date === today) || null;
  const [items, setItems] = useState((existing || emptyPreSession(today)).items);

  useEffect(() => {
    setItems((existing || emptyPreSession(today)).items);
  }, [today]);

  const toggle = (key) => {
    const next = { ...items, [key]: !items[key] };
    setItems(next);
    setData((d) => {
      const prev = d.preSession || [];
      const record = { date: today, items: next };
      const idx = prev.findIndex((l) => l.date === today);
      const updated = idx >= 0 ? prev.map((l, i) => (i === idx ? record : l)) : [...prev, record];
      return { ...d, preSession: updated };
    });
  };

  const done = PRE_SESSION_ITEMS.filter((i) => items[i.key]).length;
  const total = PRE_SESSION_ITEMS.length;
  const allDone = done === total;
  const streak = preSessionStreak(logs.map((l) => l.date === today ? { ...l, items } : l), today);

  // last 7 days mini-history
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - (6 - i));
    const dStr = d.toISOString().slice(0, 10);
    const log = dStr === today ? { date: today, items } : logs.find((l) => l.date === dStr);
    const complete = log && PRE_SESSION_ITEMS.every((it) => log.items[it.key]);
    const partial = log && PRE_SESSION_ITEMS.some((it) => log.items[it.key]) && !complete;
    return { date: dStr, complete, partial, isToday: dStr === today };
  });

  return (
    <Card className={allDone ? "border-emerald-500/25" : "border-amber-500/20"}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cx("w-7 h-7 rounded-lg flex items-center justify-center", allDone ? "bg-emerald-500/15" : "bg-amber-500/15")}>
            <ListChecks size={15} className={allDone ? "text-emerald-400" : "text-amber-400"} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>Pre-Session Checklist</div>
            <div className="text-[10px] text-slate-500">{today}</div>
          </div>
        </div>
        {/* Streak badge */}
        <div className={cx("flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold", streak > 0 ? "bg-amber-500/15 text-amber-400" : "bg-slate-800 text-slate-500")}>
          <Flame size={13} className={streak > 0 ? "text-amber-400" : "text-slate-600"} />
          {streak > 0 ? `${streak}-day streak` : "No streak"}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-500 font-medium">{done}/{total} complete</span>
          <span className="text-[10px] font-semibold" style={{ color: allDone ? "#34d399" : done > 0 ? "#f59e0b" : "#475569" }}>
            {allDone ? "Ready to trade ✓" : done > 0 ? "In progress…" : "Not started"}
          </span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${(done / total) * 100}%`, background: allDone ? "#34d399" : "#f59e0b" }}
          />
        </div>
      </div>

      {/* Checklist items */}
      <div className="space-y-1.5 mb-3">
        {PRE_SESSION_ITEMS.map(({ key, label, desc }) => {
          const checked = items[key];
          return (
            <button key={key} onClick={() => toggle(key)}
              className={cx(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition",
                checked
                  ? "bg-emerald-500/8 border-emerald-500/20 hover:bg-emerald-500/12"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              )}>
              <div className={cx("w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center shrink-0 transition",
                checked ? "border-emerald-500 bg-emerald-500" : "border-slate-600")}>
                {checked && <CheckCircle2 size={11} className="text-slate-950" strokeWidth={3} />}
              </div>
              <div className="min-w-0">
                <div className={cx("text-sm font-medium leading-tight", checked ? "text-emerald-400 line-through decoration-emerald-500/40" : "text-slate-200")}>{label}</div>
                <div className="text-[10px] text-slate-600 mt-0.5 truncate">{desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 7-day history */}
      <div className="border-t border-slate-800 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Last 7 days</span>
        </div>
        <div className="flex gap-1.5 justify-between">
          {last7.map(({ date, complete, partial, isToday }) => {
            const day = new Date(date + "T12:00:00").toLocaleString("en-US", { weekday: "narrow" });
            return (
              <div key={date} className="flex flex-col items-center gap-1">
                <div className={cx("w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition",
                  complete ? "bg-emerald-500 text-slate-950" :
                  partial  ? "bg-amber-500/40 text-amber-300" :
                  isToday  ? "bg-slate-800 border border-slate-600 text-slate-300" :
                             "bg-slate-900 text-slate-700")}>
                  {complete ? "✓" : partial ? "·" : isToday ? day : day}
                </div>
                <span className={cx("text-[9px]", isToday ? "text-amber-400 font-semibold" : "text-slate-600")}>{day}</span>
              </div>
            );
          })}
        </div>
      </div>
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
/* ============================================================
   DASHBOARD — LIVE RISK MONITOR
   ============================================================ */
const PAIR_CURRENCIES: Record<string, [string, string]> = {
  EURUSD: ["EUR","USD"], GBPUSD: ["GBP","USD"], AUDUSD: ["AUD","USD"],
  NZDUSD: ["NZD","USD"], USDCAD: ["USD","CAD"], USDCHF: ["USD","CHF"],
  USDJPY: ["USD","JPY"], EURJPY: ["EUR","JPY"], GBPJPY: ["GBP","JPY"],
  AUDJPY: ["AUD","JPY"], NZDJPY: ["NZD","JPY"], CADJPY: ["CAD","JPY"],
  EURGBP: ["EUR","GBP"], XAUUSD: ["XAU","USD"], XAGUSD: ["XAG","USD"],
  EURAUD: ["EUR","AUD"], GBPAUD: ["GBP","AUD"], GBPCAD: ["GBP","CAD"],
  EURCAD: ["EUR","CAD"], AUDCAD: ["AUD","CAD"], AUDNZD: ["AUD","NZD"],
  GBPNZD: ["GBP","NZD"], EURNZD: ["EUR","NZD"], CHFJPY: ["CHF","JPY"],
  AUDCHF: ["AUD","CHF"], GBPCHF: ["GBP","CHF"], EURCHF: ["EUR","CHF"],
};

function OpenRiskTracker({ data, a, acc }) {
  const cur = acc.currency || "€";
  const startBal = parseFloat(acc.startingBalance) || 1000;
  const openTrades = (data.trades || []).filter((t) => !t.exit && t.symbol);

  // Total open risk
  const totalRiskPct = openTrades.reduce((s, t) => s + (parseFloat(t.riskPct) || 0), 0);
  const totalRiskAmt = (totalRiskPct / 100) * startBal;

  // Daily loss limit from master plan
  const maxDailyLossStr = data.plans?.master?.maxDailyLoss || "";
  const maxDailyLossPct = parseFloat(maxDailyLossStr) || null;
  const maxDailyLossAmt = maxDailyLossPct !== null ? (maxDailyLossPct / 100) * startBal : null;
  const dayLossAmt = Math.max(0, -((a.dayPnl) || 0));
  const dayLossPct = startBal > 0 ? (dayLossAmt / startBal) * 100 : 0;
  const dayLossUsedPct = maxDailyLossPct ? Math.min(100, (dayLossPct / maxDailyLossPct) * 100) : 0;
  const isAtLimit   = !!maxDailyLossPct && dayLossPct >= maxDailyLossPct;
  const isNearLimit = !!maxDailyLossPct && !isAtLimit && dayLossPct >= maxDailyLossPct * 0.75;

  // Currency correlation detection
  const currencyExposure: Record<string, string[]> = {};
  openTrades.forEach((t) => {
    const sym = (t.symbol || "").toUpperCase().replace("/", "");
    const pair = PAIR_CURRENCIES[sym];
    if (!pair) return;
    const [base, quote] = pair;
    const isLong = t.side === "Buy";
    if (!currencyExposure[base]) currencyExposure[base] = [];
    if (!currencyExposure[quote]) currencyExposure[quote] = [];
    currencyExposure[base].push(isLong ? "Long" : "Short");
    currencyExposure[quote].push(isLong ? "Short" : "Long");
  });
  const correlationWarnings: string[] = [];
  Object.entries(currencyExposure).forEach(([ccy, dirs]) => {
    const longs  = dirs.filter((d) => d === "Long").length;
    const shorts = dirs.filter((d) => d === "Short").length;
    if (longs  >= 2) correlationWarnings.push(`${longs}× Long ${ccy}`);
    if (shorts >= 2) correlationWarnings.push(`${shorts}× Short ${ccy}`);
  });

  if (openTrades.length === 0 && maxDailyLossPct === null) return null;

  return (
    <Card className={isAtLimit ? "border-rose-500/40" : isNearLimit ? "border-amber-500/30" : "border-slate-700/60"}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cx("w-7 h-7 rounded-lg flex items-center justify-center",
            isAtLimit ? "bg-rose-500/20" : "bg-sky-500/15")}>
            <ShieldAlert size={14} className={isAtLimit ? "text-rose-400" : "text-sky-400"} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>Live Risk Monitor</div>
            <div className="text-[10px] text-slate-500">{openTrades.length} open position{openTrades.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={cx("text-sm font-bold",
            totalRiskPct === 0 ? "text-slate-500" :
            totalRiskPct > 5  ? "text-rose-400" :
            totalRiskPct > 3  ? "text-amber-400" : "text-slate-200")}>
            {totalRiskPct > 0 ? totalRiskPct.toFixed(1) + "% at risk" : "—"}
          </div>
          {totalRiskAmt > 0 && <div className="text-[9px] text-slate-600">{cur}{totalRiskAmt.toFixed(2)} exposed</div>}
        </div>
      </div>

      {/* Daily loss limit bar */}
      {maxDailyLossPct !== null && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-500 font-medium">Daily Loss Limit</span>
            <span className={cx("text-[10px] font-semibold",
              isAtLimit ? "text-rose-400" : isNearLimit ? "text-amber-400" : "text-slate-400")}>
              {cur}{dayLossAmt.toFixed(2)} used · limit {cur}{maxDailyLossAmt!.toFixed(2)} ({maxDailyLossPct}%)
            </span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${dayLossUsedPct}%`, background: isAtLimit ? "#f43f5e" : isNearLimit ? "#f59e0b" : "#475569" }} />
          </div>
          {isAtLimit   && <p className="text-[10px] text-rose-400 font-semibold mt-1.5">⛔ Daily loss limit hit — stop trading for today.</p>}
          {isNearLimit && <p className="text-[10px] text-amber-400 mt-1.5">⚠ Approaching daily loss limit — be very selective.</p>}
        </div>
      )}

      {/* Open positions */}
      {openTrades.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {openTrades.map((t) => {
            const rPct = parseFloat(t.riskPct) || null;
            const rAmt = rPct !== null ? (rPct / 100) * startBal : null;
            const isHigh = rPct !== null && rPct > 3;
            return (
              <div key={t.id}
                className={cx("flex items-center justify-between rounded-xl px-3 py-2 border",
                  isHigh ? "bg-rose-500/5 border-rose-500/15" : "bg-slate-900 border-slate-800")}>
                <div className="flex items-center gap-2 min-w-0">
                  {t.side === "Buy"
                    ? <TrendingUp  size={13} className="text-emerald-400 shrink-0" />
                    : <TrendingDown size={13} className="text-rose-400 shrink-0" />}
                  <span className="text-xs font-semibold text-slate-200">{t.symbol}</span>
                  <span className={cx("text-[10px] font-medium", t.side === "Buy" ? "text-emerald-500" : "text-rose-500")}>{t.side}</span>
                  {t.entry && <span className="text-[10px] text-slate-600 truncate">@ {t.entry}</span>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {rPct !== null ? (
                    <>
                      <span className={cx("text-xs font-bold", isHigh ? "text-rose-400" : rPct > 2 ? "text-amber-400" : "text-slate-300")}>
                        {rPct.toFixed(1)}%
                      </span>
                      {rAmt !== null && <span className="text-[10px] text-slate-600">{cur}{rAmt.toFixed(0)}</span>}
                    </>
                  ) : (
                    <span className="text-[10px] text-slate-600 italic">no risk%</span>
                  )}
                </div>
              </div>
            );
          })}
          {/* Total row */}
          {totalRiskAmt > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-800/50 mt-1">
              <span className="text-[11px] text-slate-500 font-medium">Total exposed</span>
              <span className={cx("text-[11px] font-bold",
                totalRiskPct > 5 ? "text-rose-400" : totalRiskPct > 3 ? "text-amber-400" : "text-slate-300")}>
                {cur}{totalRiskAmt.toFixed(2)} · {totalRiskPct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Correlation warnings */}
      {correlationWarnings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-slate-800">
          <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">Corr:</span>
          {correlationWarnings.map((w, i) => (
            <span key={i} className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-medium">
              ⚠ {w}
            </span>
          ))}
        </div>
      )}

      {openTrades.length === 0 && (
        <p className="text-[11px] text-slate-600 mt-1">Open a trade in the Journal without an exit price to track it here.</p>
      )}
    </Card>
  );
}

/* ============================================================
   DASHBOARD — WEEKLY ACCOUNTABILITY SUMMARY
   ============================================================ */
function WeeklySummary({ data, a, cur, goTo }) {
  const today = todayISO();
  const nowDate = new Date(today + "T12:00:00");
  const dow = nowDate.getDay(); // 0=Sun, 1=Mon…
  const daysSinceMon = (dow + 6) % 7;
  const monDate = new Date(nowDate); monDate.setDate(nowDate.getDate() - daysSinceMon);
  const sunDate = new Date(monDate); sunDate.setDate(monDate.getDate() + 6);
  const weekStart = monDate.toISOString().slice(0, 10);
  const weekEnd   = sunDate.toISOString().slice(0, 10);
  const isSunday  = dow === 0;

  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekLabel = `${fmt(monDate)} – ${fmt(sunDate)}`;

  // This week's closed trades
  const weekTrades = a.closedTrades.filter((t) => t.date >= weekStart && t.date <= today);
  const weekWins   = weekTrades.filter((t) => t.c.result === "Win").length;
  const weekPnl    = weekTrades.reduce((s, t) => s + (t.c.pnl || 0), 0);
  const weekWR     = weekTrades.length ? (weekWins / weekTrades.length) * 100 : null;

  // Best / worst trade this week
  const byPnl   = [...weekTrades].sort((a, b) => (b.c.pnl || 0) - (a.c.pnl || 0));
  const bestT   = byPnl[0] || null;
  const worstT  = byPnl[byPnl.length - 1] || null;

  // Prep streak (consecutive days Mon→today with all 6 items done)
  const logs = data.preSession || [];
  let prepDays = 0;
  for (let i = 0; i <= daysSinceMon; i++) {
    const d = new Date(monDate); d.setDate(monDate.getDate() + i);
    const dStr = d.toISOString().slice(0, 10);
    if (dStr > today) break;
    const log = logs.find((l) => l.date === dStr);
    const allDone = log && PRE_SESSION_ITEMS.every((it) => log.items[it.key]);
    if (allDone) prepDays++;
  }
  const tradingDays = daysSinceMon + (dow === 0 ? 0 : 1); // Mon-Fri days elapsed

  // Top mistake this week
  const mistakeCounts: Record<string, number> = {};
  weekTrades.forEach((t) => {
    (t.mistakes || []).forEach((m: string) => {
      mistakeCounts[m] = (mistakeCounts[m] || 0) + 1;
    });
  });
  const topMistake = Object.entries(mistakeCounts).sort(([, a], [, b]) => b - a)[0] || null;

  // Grade distribution this week
  const gradeCount: Record<string, number> = {};
  weekTrades.forEach((t) => { if (t.grade) gradeCount[t.grade] = (gradeCount[t.grade] || 0) + 1; });
  const reviewedCount = Object.values(gradeCount).reduce((s, v) => s + v, 0);

  // Tone based on P/L and win rate
  const isGreenWeek = weekPnl > 0;
  const weekStatus =
    weekTrades.length === 0 ? "No trades yet this week" :
    isSunday && isGreenWeek ? "Green week — well done! 🏆" :
    isSunday && !isGreenWeek ? "Tough week. Review & reset 💪" :
    isGreenWeek ? "Positive week so far 📈" : "In the red — stay disciplined 🔒";

  return (
    <Card className={isGreenWeek && weekTrades.length > 0 ? "border-emerald-500/20" : "border-slate-700/60"}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cx("w-7 h-7 rounded-lg flex items-center justify-center",
            isGreenWeek && weekTrades.length > 0 ? "bg-emerald-500/15" : "bg-slate-800")}>
            <CalendarDays size={14} className={isGreenWeek && weekTrades.length > 0 ? "text-emerald-400" : "text-slate-400"} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>
              Weekly Summary
            </div>
            <div className="text-[10px] text-slate-500">{weekLabel}</div>
          </div>
        </div>
        {isSunday && <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">Review Day</span>}
      </div>

      {/* Status line */}
      <p className="text-xs text-slate-400 mb-3">{weekStatus}</p>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
          <div className={cx("text-sm font-bold", weekPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {weekTrades.length ? fmtSigned(weekPnl, cur) : "—"}
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">Week P/L</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
          <div className="text-sm font-bold text-slate-200">{weekTrades.length}</div>
          <div className="text-[9px] text-slate-600 mt-0.5">Trades</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
          <div className={cx("text-sm font-bold", weekWR === null ? "text-slate-500" : weekWR >= 50 ? "text-emerald-400" : "text-rose-400")}>
            {weekWR !== null ? fmtPct(weekWR) : "—"}
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">Win Rate</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
          <div className={cx("text-sm font-bold", prepDays === tradingDays ? "text-amber-400" : "text-slate-400")}>
            {prepDays}/{tradingDays}
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">Prep Days</div>
        </div>
      </div>

      {/* Best / worst trade */}
      {(bestT || worstT) && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {bestT && (
            <div className="bg-emerald-500/8 border border-emerald-500/15 rounded-xl px-2.5 py-2">
              <div className="text-[9px] text-slate-500 uppercase font-semibold mb-0.5">Best Trade</div>
              <div className="text-xs font-bold text-emerald-400">{fmtSigned(bestT.c.pnl, cur)}</div>
              <div className="text-[10px] text-slate-500">{bestT.symbol} · {bestT.date}</div>
            </div>
          )}
          {worstT && worstT.id !== bestT?.id && (
            <div className="bg-rose-500/8 border border-rose-500/15 rounded-xl px-2.5 py-2">
              <div className="text-[9px] text-slate-500 uppercase font-semibold mb-0.5">Worst Trade</div>
              <div className="text-xs font-bold text-rose-400">{fmtSigned(worstT.c.pnl, cur)}</div>
              <div className="text-[10px] text-slate-500">{worstT.symbol} · {worstT.date}</div>
            </div>
          )}
        </div>
      )}

      {/* Top mistake + review progress */}
      <div className="flex items-center justify-between pt-2.5 border-t border-slate-800">
        <div className="flex items-center gap-2">
          {topMistake ? (
            <div>
              <span className="text-[9px] text-slate-500 uppercase font-semibold">Top Mistake </span>
              <span className="text-[10px] text-rose-400 font-medium">{topMistake[0]}</span>
              <span className="text-[10px] text-slate-600"> ×{topMistake[1]}</span>
            </div>
          ) : weekTrades.length > 0 ? (
            <span className="text-[10px] text-slate-500">No mistakes tagged this week 🎯</span>
          ) : (
            <span className="text-[10px] text-slate-600">Log trades to build your weekly summary</span>
          )}
        </div>
        {reviewedCount > 0 ? (
          <span className="text-[10px] text-slate-500">{reviewedCount} reviewed</span>
        ) : weekTrades.length > 0 ? (
          <button onClick={() => goTo("journal")}
            className="text-[10px] text-amber-400 font-medium hover:underline">
            Review trades →
          </button>
        ) : null}
      </div>
    </Card>
  );
}

/* ── Prop Challenges Dashboard Card ── */
function PropChallengesDashCard({ data, goTo }) {
  const challenges: any[] = (data.propChallenges || []);
  const active   = challenges.filter((c: any) => c.status !== "passed" && c.status !== "failed");
  const anyFailed = challenges.some((c: any) => { const m = computePropChallenge(c); return m.hasFailed; });
  const anyPassed = !anyFailed && challenges.some((c: any) => { const m = computePropChallenge(c); return m.hasPassed; });
  const anyWarning = !anyFailed && !anyPassed && challenges.some((c: any) => { const m = computePropChallenge(c); return m.hasWarning; });

  if (challenges.length === 0) {
    return (
      <button onClick={() => goTo("more", "Prop")}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-950 border border-slate-800 border-dashed rounded-2xl text-left hover:border-amber-500/30 transition">
        <Trophy size={18} className="text-amber-400/50 shrink-0" />
        <div>
          <p className="text-sm font-medium text-slate-500">No prop challenges yet</p>
          <p className="text-[11px] text-slate-700">Tap to add your first FTMO, The5ers, or custom challenge →</p>
        </div>
      </button>
    );
  }

  const cardBorder = anyFailed
    ? "border-rose-500/50 shadow-rose-900/30 shadow-lg"
    : anyPassed ? "border-emerald-500/40"
    : anyWarning ? "border-amber-500/30"
    : "border-slate-800";

  return (
    <div className={cx("bg-slate-950 rounded-2xl overflow-hidden border", cardBorder)}>
      {/* Breach banner across the top if any challenge failed */}
      {anyFailed && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-500/15 border-b border-rose-500/30">
          <div className="w-2 h-2 rounded-full bg-rose-400 animate-pulse shrink-0" />
          <span className="text-[11px] font-bold text-rose-300 uppercase tracking-wide">⛔ Breach Detected — Limit Violated</span>
          <ChevronRight size={12} className="text-rose-400 ml-auto" />
        </div>
      )}
      {anyPassed && (
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
          <span className="text-[11px] font-bold text-emerald-400">🏆 Challenge Passed! Tap to review</span>
        </div>
      )}
      {anyWarning && !anyFailed && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="text-[11px] font-bold text-amber-400">⚠ Warning — Approaching Limit</span>
        </div>
      )}

      <button onClick={() => goTo("more", "Prop")}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-900/40 transition">
        <div className="flex items-center gap-2">
          <Trophy size={15} className={anyFailed ? "text-rose-400" : anyPassed ? "text-emerald-400" : "text-amber-400"} />
          <span className="text-sm font-semibold text-slate-200" style={{ fontFamily: "'Sora', sans-serif" }}>Prop Challenges</span>
          {active.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-bold">
              {active.length} active
            </span>
          )}
        </div>
        <ChevronRight size={14} className="text-slate-600" />
      </button>

      <div className="divide-y divide-slate-800/60">
        {challenges.slice(0, 3).map((ch: any) => {
          const m = computePropChallenge(ch);
          const statusColor = m.hasFailed ? "text-rose-400" : m.hasPassed ? "text-emerald-400" : m.hasWarning ? "text-amber-400" : "text-sky-400";
          const statusLabel = m.hasFailed ? "⛔ FAILED" : m.hasPassed ? "🏆 PASSED" : m.hasWarning ? "⚠ WARNING" : "✅ On Track";
          const rowBg = m.hasFailed ? "bg-rose-500/5" : m.hasPassed ? "bg-emerald-500/5" : "";
          return (
            <button key={ch.id} onClick={() => goTo("more", "Prop")}
              className={cx("w-full px-4 py-3 text-left hover:bg-slate-900/30 transition", rowBg)}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-semibold text-slate-300 truncate">{ch.name || ch.firm}</span>
                  <span className="text-[9px] text-slate-600 ml-1.5">{ch.firm} · {ch.currency} {parseFloat(ch.accountSize || "0").toLocaleString()}</span>
                </div>
                <span className={cx("text-[9px] font-extrabold shrink-0 ml-2", statusColor)}>{statusLabel}</span>
              </div>
              {/* Breach reason */}
              {m.hasFailed && (
                <div className="mb-1.5 px-2 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <span className="text-[9px] text-rose-300 font-semibold">
                    {m.dailyLossViolated ? "Daily loss limit exceeded" : m.totalDrawdownViolated ? "Max drawdown exceeded" : "Challenge deadline passed"}
                  </span>
                </div>
              )}
              {/* Profit progress */}
              <div className="mb-1">
                <div className="flex justify-between text-[9px] text-slate-600 mb-0.5">
                  <span>Profit ({ch.profitTargetPct}% target)</span>
                  <span className={m.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {m.totalPnlPct >= 0 ? "+" : ""}{m.totalPnlPct.toFixed(2)}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${m.profitProgress}%` }} />
                </div>
              </div>
              {/* Drawdown */}
              <div>
                <div className="flex justify-between text-[9px] text-slate-600 mb-0.5">
                  <span>Drawdown ({ch.maxTotalDrawdownPct}% max)</span>
                  <span className={m.totalDrawdownViolated ? "text-rose-400" : m.totalDrawdownProgress >= 75 ? "text-amber-400" : "text-slate-500"}>
                    {m.currentDrawdownPct.toFixed(2)}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${m.totalDrawdownProgress}%`, background: m.totalDrawdownViolated ? "#f43f5e" : m.totalDrawdownProgress >= 75 ? "#f59e0b" : "#475569" }} />
                </div>
              </div>
              {m.daysRemaining !== null && !m.hasPassed && !m.hasFailed && (
                <p className="text-[9px] text-slate-600 mt-1">{m.daysRemaining}d remaining on deadline</p>
              )}
            </button>
          );
        })}
        {challenges.length > 3 && (
          <button onClick={() => goTo("more", "Prop")} className="w-full px-4 py-2 text-center text-[10px] text-amber-400 hover:bg-slate-900/30">
            View all {challenges.length} challenges →
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Forex Market Session Clock (Vienna / CEST) ── */
const FX_SESSIONS = [
  { name: "Sydney",      short: "SYD", utcOpen: 22 * 60, utcClose:  7 * 60, spansMidnight: true,  color: "sky"     },
  { name: "Tokyo",       short: "TYO", utcOpen:  0 * 60, utcClose:  9 * 60, spansMidnight: false, color: "violet"  },
  { name: "Pre-London",  short: "PRE", utcOpen:  7 * 60, utcClose:  8 * 60, spansMidnight: false, color: "amber"   },
  { name: "London",      short: "LON", utcOpen:  8 * 60, utcClose: 17 * 60, spansMidnight: false, color: "emerald" },
  { name: "New York",    short: "NY",  utcOpen: 13 * 60, utcClose: 22 * 60, spansMidnight: false, color: "blue"    },
];

function fxIsOpen(s: typeof FX_SESSIONS[0], utcNow: number) {
  if (s.spansMidnight) return utcNow >= s.utcOpen || utcNow < s.utcClose;
  return utcNow >= s.utcOpen && utcNow < s.utcClose;
}

function fxMinsUntil(target: number, utcNow: number) {
  let d = target - utcNow;
  if (d < 0) d += 24 * 60;
  return d;
}

function fxFmt(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function ForexMarketClock() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const viennaStr = now.toLocaleTimeString("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const viennaDate = now.toLocaleDateString("en-GB", { timeZone: "Europe/Vienna", weekday: "long", day: "numeric", month: "short" });

  const tzLabel = (() => {
    const parts = now.toLocaleTimeString("en-GB", { timeZone: "Europe/Vienna", timeZoneName: "short" }).split(" ");
    return parts[parts.length - 1] || "CEST";
  })();

  const utcNow = now.getUTCHours() * 60 + now.getUTCMinutes();

  const sessions = FX_SESSIONS.map((s) => {
    const open = fxIsOpen(s, utcNow);
    const minsToOpen  = open  ? null : fxMinsUntil(s.utcOpen, utcNow);
    const minsToClose = !open ? null : fxMinsUntil(s.utcClose, utcNow);
    return { ...s, open, minsToOpen, minsToClose };
  });

  const londonOpen = sessions.find((s) => s.name === "London")?.open;
  const nyOpen     = sessions.find((s) => s.name === "New York")?.open;
  const overlap    = londonOpen && nyOpen;

  const sessionDot: Record<string, string> = {
    sky: "bg-sky-400", violet: "bg-violet-400", amber: "bg-amber-400",
    emerald: "bg-emerald-400", blue: "bg-blue-400",
  };
  const sessionText: Record<string, string> = {
    sky: "text-sky-400", violet: "text-violet-400", amber: "text-amber-400",
    emerald: "text-emerald-400", blue: "text-blue-400",
  };
  const sessionBg: Record<string, string> = {
    sky: "bg-sky-500/10 border-sky-500/30", violet: "bg-violet-500/10 border-violet-500/30",
    amber: "bg-amber-500/10 border-amber-500/30", emerald: "bg-emerald-500/10 border-emerald-500/30",
    blue: "bg-blue-500/10 border-blue-500/30",
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      {/* Vienna clock header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Clock size={15} className="text-amber-400" />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-medium">Vienna, Austria</div>
            <div className="text-[11px] text-slate-400">{viennaDate}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-slate-100 tabular-nums tracking-tight" style={{ fontFamily: "'Sora', sans-serif" }}>{viennaStr}</div>
          <div className="text-[10px] text-amber-400 font-semibold">{tzLabel}</div>
        </div>
      </div>

      {/* Overlap banner */}
      {overlap && (
        <div className="mx-3 mt-3 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-emerald-400">London / New York Overlap — highest liquidity</span>
        </div>
      )}

      {/* Session rows */}
      <div className="p-3 space-y-2">
        {sessions.map((s) => (
          <div key={s.name}
            className={cx("flex items-center justify-between px-3 py-2.5 rounded-xl border transition",
              s.open ? sessionBg[s.color] : "bg-slate-950 border-slate-800/60")}>
            <div className="flex items-center gap-2.5">
              <div className={cx("w-2 h-2 rounded-full shrink-0", s.open ? sessionDot[s.color] + " shadow-sm" : "bg-slate-700")}
                style={s.open ? { boxShadow: `0 0 6px var(--tw-shadow-color)` } : {}} />
              <div>
                <span className={cx("text-xs font-semibold", s.open ? sessionText[s.color] : "text-slate-500")}>{s.name}</span>
                <span className="text-[9px] text-slate-700 ml-1.5 font-mono">{s.short}</span>
              </div>
            </div>
            <div className="text-right">
              {s.open ? (
                <div>
                  <span className={cx("text-[10px] font-bold uppercase tracking-wide", sessionText[s.color])}>OPEN</span>
                  <span className="text-[10px] text-slate-500 ml-1.5">closes in {fxFmt(s.minsToClose!)}</span>
                </div>
              ) : (
                <div>
                  <span className="text-[10px] font-medium text-slate-600">CLOSED</span>
                  <span className="text-[10px] text-slate-700 ml-1.5">opens in {fxFmt(s.minsToOpen!)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashSectionLabel({ children, visible, onToggle, editMode, onMoveUp, onMoveDown, isFirst, isLast }: {
  children: React.ReactNode; visible?: boolean; onToggle?: () => void;
  editMode?: boolean; onMoveUp?: () => void; onMoveDown?: () => void; isFirst?: boolean; isLast?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 pt-2">
      {editMode && (
        <div className="flex flex-col">
          <button onClick={onMoveUp} disabled={isFirst}
            className="p-0.5 rounded text-slate-600 hover:text-amber-400 disabled:opacity-20 transition">
            <ChevronUp size={13} />
          </button>
          <button onClick={onMoveDown} disabled={isLast}
            className="p-0.5 rounded text-slate-600 hover:text-amber-400 disabled:opacity-20 transition">
            <ChevronDown size={13} />
          </button>
        </div>
      )}
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{children}</span>
      <div className="flex-1 h-px bg-slate-800" />
      {!editMode && onToggle && (
        <button onClick={onToggle}
          className={cx("transition p-1 rounded-lg", visible !== false ? "text-slate-600 hover:text-amber-400" : "text-amber-500 hover:text-amber-300")}
          title={visible !== false ? "Hide section" : "Show section"}>
          {visible !== false ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      )}
    </div>
  );
}

/* ── Animated Candlestick Hero Chart ── */
/* ── Forex session definitions (UTC hours) ── */
const SESSIONS = [
  { name: "Tokyo",   start: 0,  end: 9,  color: "#818cf8", glow: "#6366f133" },
  { name: "London",  start: 8,  end: 17, color: "#38bdf8", glow: "#0ea5e933" },
  { name: "New York",start: 13, end: 22, color: "#fb923c", glow: "#f9731633" },
] as const;

function useUtcNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useSessionCountdown() {
  const now = useUtcNow();
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;

  /* Find what's happening right now and what's next */
  const events: { label: string; hUTC: number; color: string }[] = [
    { label: "Tokyo Open",    hUTC: 0,  color: "#818cf8" },
    { label: "Tokyo Close",   hUTC: 9,  color: "#818cf8" },
    { label: "London Open",   hUTC: 8,  color: "#38bdf8" },
    { label: "London Close",  hUTC: 17, color: "#38bdf8" },
    { label: "NY Open",       hUTC: 13, color: "#fb923c" },
    { label: "NY Close",      hUTC: 22, color: "#fb923c" },
    { label: "Overlap Start", hUTC: 13, color: "#f59e0b" },
    { label: "Overlap End",   hUTC: 17, color: "#f59e0b" },
  ];

  /* Deduplicate hours, keep unique next upcoming */
  const seen = new Set<number>();
  const upcoming = events
    .filter(e => { if (seen.has(e.hUTC)) return false; seen.add(e.hUTC); return true; })
    .map(e => {
      let diff = e.hUTC - utcH;
      if (diff < 0) diff += 24;
      return { ...e, diffH: diff };
    })
    .sort((a, b) => a.diffH - b.diffH)[0];

  if (!upcoming) return null;

  const totalSec = Math.round(upcoming.diffH * 3600);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const fmt = h > 0
    ? `${h}h ${m.toString().padStart(2,"0")}m ${s.toString().padStart(2,"0")}s`
    : `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;

  return { label: upcoming.label, fmt, color: upcoming.color, urgency: totalSec < 900 };
}

function AnimatedCandlestickChart() {
  const TOTAL = 40;
  const REPLAY_SPEED = 110; // ms per candle reveal

  /* tick drives both reveal (mod TOTAL) and live-tick animation */
  const [tick, setTick] = useState(0);
  const [liveTick, setLiveTick] = useState(0);
  const now = useUtcNow();

  useEffect(() => {
    const replay = setInterval(() => setTick((t) => t + 1), REPLAY_SPEED);
    const live   = setInterval(() => setLiveTick((t) => t + 1), 60);
    return () => { clearInterval(replay); clearInterval(live); };
  }, []);

  /* Generate a realistic trending candle series */
  const allCandles = useMemo(() => {
    const moves = [
      1.2,-0.5,1.8,-0.9,0.7,2.1,-0.6,1.4,-1.1,2.6,
      -0.4,1.9,-1.3,0.5,-1.8,1.3,0.6,-0.8,2.4,-1.5,
      0.8,-0.3,1.6,-1.0,2.0,-0.7,1.1,-0.6,1.5,0.4,
      2.2,-1.7,0.9,-0.4,1.3,-1.2,2.8,-0.5,1.7,0.3,
    ];
    let price = 100;
    return moves.map((move, i) => {
      const volatility = 1.8 + (i % 5) * 0.5;
      const open  = price;
      const close = price + move * volatility;
      const span  = Math.abs(close - open);
      const high  = Math.max(open, close) + span * 0.4 + 0.5;
      const low   = Math.min(open, close) - span * 0.3 - 0.4;
      price = close;
      return { open, close, high, low };
    });
  }, []);

  /* Replay: reveal candles one-by-one then loop */
  const phase   = tick % (TOTAL + 12); // 12 blank frames between loops
  const visible = Math.min(phase, TOTAL);

  /* SVG dimensions */
  const W = 400, H = 140;
  const PAD_L = 0, PAD_R = 0, PAD_T = 14, PAD_B = 24;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const displayCandles = allCandles.slice(0, TOTAL);
  const highs = displayCandles.map((c) => c.high);
  const lows  = displayCandles.map((c) => c.low);
  const maxP  = Math.max(...highs) + 0.5;
  const minP  = Math.min(...lows)  - 0.5;
  const range = maxP - minP || 1;
  const toY   = (p: number) => PAD_T + chartH - ((p - minP) / range) * chartH;

  const cw = chartW / TOTAL;
  const bw = cw * 0.52;

  /* Live-tick: animate last candle's close up/down */
  const lastCandle = displayCandles[visible - 1];
  const liveClose = lastCandle
    ? lastCandle.close + Math.sin(liveTick * 0.18) * 1.4
    : 0;
  const liveHigh = lastCandle
    ? Math.max(lastCandle.high, liveClose) + Math.abs(Math.sin(liveTick * 0.11)) * 0.6
    : 0;
  const liveLow = lastCandle
    ? Math.min(lastCandle.low, liveClose) - Math.abs(Math.sin(liveTick * 0.09)) * 0.5
    : 0;

  /* Current UTC hour for session bands */
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;

  /* Map UTC hour → X position across chart (0-23h spans full width) */
  const hourToX = (h: number) => (h / 24) * W;

  /* Active sessions right now */
  const activeSessions = SESSIONS.filter((s) => utcH >= s.start && utcH < s.end);

  /* Bid/ask spread flicker for live price line */
  const spread = 0.12 + Math.abs(Math.sin(liveTick * 0.3)) * 0.08;
  const bidY   = toY(liveClose);
  const askY   = toY(liveClose + spread);

  /* Current price cursor X (last visible candle) */
  const cursorX = visible > 0 ? PAD_L + (visible - 0.5) * cw : null;

  return (
    <div className="relative w-full" style={{ height: 210 }}>
      {/* ── Session legend row ── */}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-3 px-1 pb-1 z-10" style={{ top: 0 }}>
        {SESSIONS.map((s) => {
          const active = utcH >= s.start && utcH < s.end;
          return (
            <div key={s.name} className={cx("flex items-center gap-1 text-[9px] font-bold transition-all", active ? "opacity-100" : "opacity-30")}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color, boxShadow: active ? `0 0 4px ${s.color}` : "none" }} />
              <span style={{ color: s.color }}>{s.name}</span>
              {active && <span className="text-[8px] font-normal opacity-70">{s.start}:00–{s.end}:00 UTC</span>}
            </div>
          );
        })}
        <div className="ml-auto text-[9px] text-slate-500 font-mono">
          {now.getUTCHours().toString().padStart(2,"0")}:{now.getUTCMinutes().toString().padStart(2,"0")} UTC
        </div>
      </div>

      {/* ── Main SVG chart ── */}
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full" style={{ top: 16, height: H }}
        preserveAspectRatio="none">

        {/* Session band overlays */}
        {SESSIONS.map((s) => {
          const x1 = hourToX(s.start);
          const x2 = hourToX(s.end);
          const isActive = utcH >= s.start && utcH < s.end;
          return (
            <rect key={s.name} x={x1} y={PAD_T} width={x2 - x1} height={chartH}
              fill={s.glow} opacity={isActive ? 1 : 0.35} />
          );
        })}

        {/* London/NY overlap band (higher intensity) */}
        {(() => {
          const x1 = hourToX(13), x2 = hourToX(17);
          const isActive = utcH >= 13 && utcH < 17;
          return <rect x={x1} y={PAD_T} width={x2 - x1} height={chartH}
            fill="#fb923c18" opacity={isActive ? 1 : 0.5} />;
        })()}

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD_L} y1={PAD_T + chartH * f} x2={W} y2={PAD_T + chartH * f}
            stroke="#1e293b" strokeWidth={0.6} strokeDasharray="3 4" />
        ))}

        {/* Candles */}
        {displayCandles.slice(0, visible).map((c, i) => {
          const cx   = PAD_L + i * cw + cw / 2;
          const isLast = i === visible - 1;
          const open  = c.open;
          const close = isLast ? liveClose : c.close;
          const high  = isLast ? liveHigh  : c.high;
          const low   = isLast ? liveLow   : c.low;
          const bull  = close >= open;
          const color = bull ? "#10b981" : "#f43f5e";
          const bodyTop = toY(Math.max(open, close));
          const bodyH   = Math.max(1.5, Math.abs(toY(open) - toY(close)));

          /* Fade-in the newest candle */
          const opacity = isLast ? 1 : i < visible - 3 ? 0.8 : 0.65 + (i - (visible - 3)) * 0.05;

          return (
            <g key={i} opacity={opacity}>
              {/* Wick */}
              <line x1={cx} y1={toY(high)} x2={cx} y2={toY(low)}
                stroke={color} strokeWidth={isLast ? 1.1 : 0.8}
                style={isLast ? { filter: `drop-shadow(0 0 2px ${color})` } : undefined} />
              {/* Body */}
              <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH}
                fill={color} rx={1}
                style={isLast ? { filter: `drop-shadow(0 0 5px ${color}88)` } : undefined} />
            </g>
          );
        })}

        {/* Live price horizontal line (bid) */}
        {visible > 0 && cursorX != null && (
          <>
            <line x1={PAD_L} y1={bidY} x2={cursorX} y2={bidY}
              stroke="#f59e0b" strokeWidth={0.6} strokeDasharray="3 3" opacity={0.7} />
            {/* Ask line */}
            <line x1={PAD_L} y1={askY} x2={cursorX} y2={askY}
              stroke="#f59e0b" strokeWidth={0.4} strokeDasharray="2 4" opacity={0.35} />
            {/* Current UTC time cursor vertical line */}
            <line x1={hourToX(utcH)} y1={PAD_T} x2={hourToX(utcH)} y2={PAD_T + chartH}
              stroke="#f59e0b" strokeWidth={0.8} opacity={0.5} strokeDasharray="2 3" />
          </>
        )}

        {/* Price label on right edge */}
        {visible > 0 && (
          <g>
            <rect x={W - 38} y={bidY - 6} width={37} height={12} rx={3}
              fill="#f59e0b" opacity={0.92} />
            <text x={W - 19.5} y={bidY + 4} textAnchor="middle"
              fill="#000" fontSize={7} fontWeight="bold" fontFamily="monospace">
              {(1.08 + (liveClose - 100) * 0.0001).toFixed(5)}
            </text>
          </g>
        )}

        {/* Session time labels at bottom */}
        {SESSIONS.map((s) => (
          <text key={s.name} x={hourToX(s.start) + 2} y={H - 4}
            fill={s.color} fontSize={6.5} opacity={0.6} fontFamily="monospace">
            {s.start}h
          </text>
        ))}
        <text x={W - 3} y={H - 4} textAnchor="end"
          fill="#475569" fontSize={6} fontFamily="monospace">24h UTC</text>
      </svg>

      {/* Active session glow pills at bottom */}
      {activeSessions.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-2 pb-0.5">
          {activeSessions.map((s) => (
            <div key={s.name} className="px-2 py-0.5 rounded-full text-[8px] font-bold animate-pulse"
              style={{ background: `${s.color}22`, border: `1px solid ${s.color}55`, color: s.color }}>
              {s.name} OPEN
            </div>
          ))}
          {utcH >= 13 && utcH < 17 && (
            <div className="px-2 py-0.5 rounded-full text-[8px] font-bold"
              style={{ background: "#fb923c22", border: "1px solid #fb923c55", color: "#fb923c" }}>
              ⚡ LDN/NY Overlap
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Best Setups Dashboard Card ── */
function BestSetupsCard({ data, goTo }: { data: any; goTo: (tab: string, sub?: string) => void }) {
  const setups: any[] = data.setups || [];

  if (setups.length === 0) {
    return (
      <button onClick={() => goTo("library", "Setups")}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-950 border border-slate-800 border-dashed rounded-2xl text-left hover:border-amber-500/30 transition">
        <Layers size={18} className="text-amber-400/50 shrink-0" />
        <div>
          <p className="text-sm font-medium text-slate-500">No setups saved yet</p>
          <p className="text-[11px] text-slate-700">Build your setup library — tap to add your first →</p>
        </div>
      </button>
    );
  }

  const featured = setups.slice(0, 6);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
      <button onClick={() => goTo("library", "Setups")}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-900/40 transition">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-amber-400" />
          <span className="text-sm font-semibold text-slate-200" style={{ fontFamily: "'Sora', sans-serif" }}>Setup Library</span>
          <span className="px-1.5 py-0.5 rounded-lg bg-slate-800 text-slate-500 text-[9px] font-bold">{setups.length}</span>
        </div>
        <ChevronRight size={14} className="text-slate-600" />
      </button>
      <div className="flex gap-2 px-3 pb-3 overflow-x-auto no-scrollbar">
        {featured.map((s: any) => (
          <button key={s.id} onClick={() => goTo("library", "Setups")}
            className="flex-shrink-0 w-28 rounded-xl overflow-hidden border border-slate-800/80 bg-slate-900 text-left hover:border-amber-500/30 transition active:scale-95">
            <div className="w-full h-14 overflow-hidden bg-slate-800 flex items-center justify-center">
              {s.image ? (
                <img src={s.image} alt={s.name} className="w-full h-full object-cover" />
              ) : (s.photos && s.photos.length > 0) ? (
                <img src={s.photos[0]} alt={s.name} className="w-full h-full object-cover" />
              ) : (
                <Layers size={16} className="text-slate-600" />
              )}
            </div>
            <div className="px-2 py-1.5">
              <div className="text-[10px] font-semibold text-slate-200 truncate leading-tight">{s.name}</div>
              {s.setupType && (
                <div className="text-[9px] text-amber-400/70 truncate">{s.setupType}</div>
              )}
              {s.marketBias && (
                <div className={cx("text-[9px] font-semibold mt-0.5",
                  s.marketBias === "Bullish" ? "text-emerald-500/70" : s.marketBias === "Bearish" ? "text-rose-500/70" : "text-slate-500")}>
                  {s.marketBias}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Hero chart top bar — session countdown + personal stats ── */
function HeroTopBar({ a, cur }: { a: any; cur: string }) {
  const countdown = useSessionCountdown();
  const now = useUtcNow();
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  const activeSessions = SESSIONS.filter(s => utcH >= s.start && utcH < s.end);
  const sessionLabel = activeSessions.length > 0
    ? activeSessions.map(s => s.name).join(" + ") + " Session"
    : "Markets Closed";
  const sessionColor = activeSessions.length > 0 ? activeSessions[0].color : "#475569";

  return (
    <div className="relative px-4 pt-4 pb-2">
      {/* row 1: session status + P&L */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[9px] text-amber-400/50 uppercase tracking-widest font-bold mb-1">
            Market Overview · Replay + Live Tick
          </div>
          {/* Active session badge */}
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: sessionColor, boxShadow: `0 0 6px ${sessionColor}` }} />
            <span className="text-sm font-black text-slate-100" style={{ fontFamily: "'Sora', sans-serif", color: sessionColor }}>
              {sessionLabel}
            </span>
          </div>
          <div className="text-[10px] text-slate-600 font-mono">
            {now.getUTCHours().toString().padStart(2,"0")}:{now.getUTCMinutes().toString().padStart(2,"0")} UTC
          </div>
        </div>
        <div className="text-right">
          <div className={cx("text-xl font-black font-mono", a.dayPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {a.dayPnl >= 0 ? "+" : ""}{fmtBalSigned(a.dayPnl, cur)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Today P&amp;L</div>
          <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
            WR {a.winRate !== null ? fmtPct(a.winRate) : "—"}
          </div>
        </div>
      </div>

      {/* row 2: countdown timer */}
      {countdown && (
        <div className={cx(
          "flex items-center gap-2 px-3 py-2 rounded-xl border w-full",
          countdown.urgency
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-slate-700/60 bg-slate-900/60"
        )}>
          <Clock size={11} style={{ color: countdown.color }} className="shrink-0" />
          <span className="text-[10px] text-slate-400">Next:</span>
          <span className="text-[10px] font-semibold" style={{ color: countdown.color }}>{countdown.label}</span>
          <span className="ml-auto font-mono font-black text-sm tabular-nums" style={{ color: countdown.color,
            textShadow: countdown.urgency ? `0 0 8px ${countdown.color}` : "none" }}>
            {countdown.fmt}
          </span>
          {countdown.urgency && (
            <span className="text-[9px] text-amber-400 font-bold animate-pulse">⚠ SOON</span>
          )}
        </div>
      )}
    </div>
  );
}

const MOOL_MANTAR_PHRASES = [
  "ੴ  Ik Onkar",
  "Satnam",
  "Karta Purakh",
  "Nirbhau",
  "Nirvair",
  "Akaal Moorat",
  "Ajooni",
  "Saibhang",
  "Gur Prasad",
  "Jap",
  "Aad Sach",
  "Jugaad Sach",
  "Hai Bhi Sach",
  "Nanak Hosi Bhi Sach",
];

function MoolMantar() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const tick = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % MOOL_MANTAR_PHRASES.length);
        setVisible(true);
      }, 500);
    }, 2800);
    return () => clearInterval(tick);
  }, []);

  const phrase = MOOL_MANTAR_PHRASES[idx];
  const isFirst = idx === 0;

  return (
    <div className="rounded-2xl border border-amber-500/20 overflow-hidden"
      style={{ background: "linear-gradient(135deg, rgba(120,60,0,0.18) 0%, rgba(30,20,5,0.35) 100%)" }}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <div className="w-1 h-4 rounded-full bg-amber-500/60" />
        <span className="text-[9px] uppercase tracking-[0.2em] text-amber-500/70 font-semibold">Mool Mantar</span>
      </div>
      <div className="flex flex-col items-center justify-center px-4 pb-4 pt-1 min-h-[72px]">
        <p
          className="text-center font-semibold transition-all duration-500"
          style={{
            fontFamily: "'Sora', sans-serif",
            fontSize: isFirst ? "1.1rem" : "1.25rem",
            color: "#f59e0b",
            textShadow: "0 0 18px rgba(245,158,11,0.55), 0 0 40px rgba(245,158,11,0.2)",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(6px)",
            letterSpacing: isFirst ? "0.05em" : "0.02em",
          }}>
          {phrase}
        </p>
        {/* progress dots */}
        <div className="flex gap-1 mt-3">
          {MOOL_MANTAR_PHRASES.map((_, i) => (
            <div key={i} className="rounded-full transition-all duration-300"
              style={{
                width: i === idx ? 14 : 5,
                height: 4,
                background: i === idx ? "#f59e0b" : "rgba(245,158,11,0.2)",
              }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ACTIVE TRADE MONITOR
   ============================================================ */
function ActiveTradeMonitor({ data, acc }: any) {
  const cur = acc.currency || "€";
  const startBal = parseFloat(acc.startingBalance) || 0;
  const settings = data.settings || DEFAULT_SETTINGS();
  const accent = settings.accentColor || "#f59e0b";
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const [livePrices, setLivePrices] = useState<Record<string, any>>({});

  // Declare trade lists here so they are available to the useEffect dependency array below
  const allTrades: any[] = data.trades || [];
  const today = todayISO();
  const openTrades = allTrades.filter((t) => computeTrade(t).result === null);

  const fetchPricesForTrades = (trades: any[]) => {
    const syms = [...new Set(trades.map((t: any) => (t.symbol || "").toUpperCase()).filter(Boolean))] as string[];
    if (!syms.length) return;
    const token = getToken();
    const hdrs: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    syms.forEach((sym) => {
      fetch(`/api/market/price/${encodeURIComponent(sym)}`, { headers: hdrs })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setLivePrices((prev) => ({ ...prev, [sym]: d })); })
        .catch(() => {});
    });
  };

  useEffect(() => {
    if (!openTrades.length) { setLivePrices({}); return; }
    fetchPricesForTrades(openTrades);
    const iv = setInterval(() => fetchPricesForTrades(openTrades), 30000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrades.map((t: any) => t.symbol).join(",")]); // re-fetch when open trade symbols change
  const todayTrades = allTrades.filter((t) => t.date === today);
  const todayClosedPnl = todayTrades
    .filter((t) => computeTrade(t).result !== null)
    .reduce((s, t) => s + (computeTrade(t).pnl || 0), 0);

  const maxDailyLossPct = parseFloat(settings.maxDailyLossPct || "") || parseFloat(data.plans?.master?.maxDailyLoss || "") || 0;
  const maxRiskPerTrade = parseFloat(settings.maxRiskPerTrade || "") || 0;
  const maxTradesPerDay = parseInt(settings.maxTradesPerDay || "") || 0;
  const maxOpenTradesNum = parseInt(settings.maxOpenTrades || "") || 0;

  const todayLossPct = startBal > 0 ? (Math.max(0, -todayClosedPnl) / startBal) * 100 : 0;
  const todayOpenTrades = openTrades.filter((t) => t.date === today);
  const openRiskPct = todayOpenTrades.reduce((s, t) => s + (parseFloat(t.riskPct) || 0), 0);
  const totalRiskPct = todayLossPct + openRiskPct;
  const remainingPct = maxDailyLossPct > 0 ? Math.max(0, maxDailyLossPct - totalRiskPct) : null;
  const limitBreached = maxDailyLossPct > 0 && totalRiskPct >= maxDailyLossPct;
  const limitApproaching = maxDailyLossPct > 0 && totalRiskPct >= maxDailyLossPct * 0.8 && !limitBreached;
  const maxTradesHit = maxTradesPerDay > 0 && todayTrades.length >= maxTradesPerDay;
  const maxOpenHit = maxOpenTradesNum > 0 && openTrades.length >= maxOpenTradesNum;
  const canTrade = !limitBreached && !maxTradesHit && !maxOpenHit;

  function elapsedStr(t: any): string {
    if (!t.date || !t.entryTime) return "—";
    const entryDt = toDateTime(t.date, t.entryTime) as unknown as number;
    if (!entryDt) return "—";
    const mins = Math.floor((now - entryDt) / 60000);
    if (mins < 0) return "—";
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ${mins % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }

  const PLAT_CLR: Record<string, string> = {
    MT4: "#4fc3f7", MT5: "#29b6f6", TradingView: "#2196f3",
    cTrader: "#00bcd4", IBKR: "#ff7043", Binance: "#ffd600", Bybit: "#f7a600",
  };

  return (
    <div className="space-y-2">
      {/* ── Daily Risk Bar ── */}
      {maxDailyLossPct > 0 && (
        <div className={cx("rounded-2xl border p-4",
          limitBreached ? "bg-rose-500/10 border-rose-500/40" :
          limitApproaching ? "bg-amber-500/10 border-amber-500/30" :
          "bg-slate-900 border-slate-800")}>
          {limitBreached && (
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-rose-400 shrink-0" />
              <span className="text-sm font-bold text-rose-400">🚨 DAILY LIMIT REACHED — STOP TRADING</span>
            </div>
          )}
          {limitApproaching && (
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-amber-400 shrink-0" />
              <span className="text-sm font-semibold text-amber-400">⚠️ Approaching daily risk limit</span>
            </div>
          )}
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs font-semibold text-slate-400">Daily Risk Budget</span>
            <span className={cx("text-xs font-bold", limitBreached ? "text-rose-400" : "text-slate-200")}>
              {fmt2(totalRiskPct)}% / {fmt2(maxDailyLossPct)}%
            </span>
          </div>
          <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (totalRiskPct / maxDailyLossPct) * 100)}%`,
                background: limitBreached ? "#ef4444" : limitApproaching ? "#f59e0b" : accent,
              }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-slate-500">
              {fmt2(todayLossPct)}% realized · {fmt2(openRiskPct)}% open
            </span>
            {remainingPct !== null && (
              <span className="text-[10px] font-semibold" style={{ color: remainingPct > 0 ? "#34d399" : "#f87171" }}>
                {fmt2(remainingPct)}% left
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Status row ── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-lg font-bold" style={{ color: openTrades.length > 0 ? accent : "#64748b" }}>
            {openTrades.length}
          </div>
          <div className="text-[10px] text-slate-500 leading-tight">Open</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-base font-bold text-slate-200">
            {todayTrades.length}{maxTradesPerDay > 0 ? `/${maxTradesPerDay}` : ""}
          </div>
          <div className="text-[10px] text-slate-500 leading-tight">Today's trades</div>
        </div>
        <div className={cx("rounded-xl p-3 text-center border",
          canTrade ? "bg-emerald-500/10 border-emerald-500/30" : "bg-rose-500/10 border-rose-500/30")}>
          <div className={cx("text-sm font-bold", canTrade ? "text-emerald-400" : "text-rose-400")}>
            {canTrade ? "✓ Yes" : "✗ No"}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Can trade?</div>
        </div>
      </div>

      {/* ── Why can't trade ── */}
      {!canTrade && (
        <div className="bg-rose-500/8 border border-rose-500/25 rounded-xl px-3 py-2 space-y-0.5">
          {limitBreached && <div className="text-[11px] text-rose-400">• Daily loss limit of {fmt2(maxDailyLossPct)}% reached</div>}
          {maxTradesHit && <div className="text-[11px] text-rose-400">• Max {maxTradesPerDay} trades/day reached</div>}
          {maxOpenHit && <div className="text-[11px] text-rose-400">• Max {maxOpenTradesNum} open trades reached</div>}
        </div>
      )}

      {/* ── Open trade cards ── */}
      {openTrades.length === 0 ? (
        <Card>
          <div className="flex items-center gap-3 py-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
              <Activity size={16} className="text-slate-500" />
            </div>
            <div>
              <div className="text-sm text-slate-400 font-medium">No open positions</div>
              <div className="text-[11px] text-slate-600 mt-0.5">Log a trade without an exit price to track it here</div>
            </div>
          </div>
        </Card>
      ) : openTrades.map((t: any) => {
        const entry = parseFloat(t.entry);
        const sl = parseFloat(t.sl);
        const tp = parseFloat(t.tp);
        const hasEntry = !isNaN(entry);
        const hasSL = !isNaN(sl);
        const hasTP = !isNaN(tp);
        const rr = hasEntry && hasSL && hasTP ? Math.abs(tp - entry) / Math.abs(sl - entry) : null;
        const riskPctNum = parseFloat(t.riskPct) || 0;
        const riskAmt = startBal > 0 && riskPctNum > 0 ? (riskPctNum / 100) * startBal : null;
        const overLimit = maxRiskPerTrade > 0 && riskPctNum > maxRiskPerTrade;
        const platClr = PLAT_CLR[t.platform] || "#64748b";
        const elapsed = elapsedStr(t);
        const liveD = livePrices[(t.symbol || "").toUpperCase()] || null;
        const { pip, dec, label: pipLabel } = getPipInfo(t.symbol);
        const isLong = t.side === "Buy";

        return (
          <div key={t.id} className={cx("rounded-2xl border p-4",
            overLimit ? "border-rose-500/40 bg-rose-500/5" : limitBreached ? "border-amber-500/30 bg-amber-500/5" : "border-slate-700 bg-slate-900/80")}>

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="font-bold text-slate-100 text-base tracking-wide">{t.symbol || "—"}</span>
                <span className={cx("px-2 py-0.5 rounded-lg text-xs font-bold shrink-0",
                  t.side === "Buy" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400")}>
                  {t.side === "Buy" ? "▲ BUY" : "▼ SELL"}
                </span>
                {t.platform && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0"
                    style={{ color: platClr, borderColor: platClr + "40", background: platClr + "18" }}>
                    {t.platform}
                  </span>
                )}
                {t.market && t.market !== "Forex" && (
                  <span className="text-[10px] text-slate-500 bg-slate-800 rounded-md px-1.5 py-0.5 shrink-0">{t.market}</span>
                )}
              </div>
              {elapsed !== "—" && (
                <div className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0 ml-2">
                  <Clock size={10} />
                  <span>{elapsed}</span>
                </div>
              )}
            </div>

            {/* Price levels */}
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              <div className="bg-slate-800 rounded-xl p-2.5 text-center">
                <div className="text-[11px] font-mono font-bold text-slate-200">{hasEntry ? entry.toFixed(dec) : "—"}</div>
                <div className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wide">Entry</div>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5 text-center">
                <div className="text-[11px] font-mono font-bold text-rose-400">{hasSL ? sl.toFixed(dec) : "—"}</div>
                <div className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wide">SL</div>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5 text-center">
                <div className="text-[11px] font-mono font-bold text-emerald-400">{hasTP ? tp.toFixed(dec) : "—"}</div>
                <div className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wide">TP</div>
              </div>
            </div>

            {/* ── Live Price Panel ── */}
            {liveD && hasEntry && (() => {
              const livePrice: number = liveD.price;
              const rawPips = (livePrice - entry) / pip;
              const profitPips = isLong ? rawPips : -rawPips;
              const inProfit = profitPips > 0;
              const absPips = Math.abs(rawPips);
              const slPips   = hasSL ? Math.abs((livePrice - sl) / pip) : null;
              const tpPips   = hasTP ? Math.abs((livePrice - tp) / pip) : null;
              const todayPos = liveD.changePct >= 0;
              // Progress bar: where is price between SL and TP?
              const barPct = (hasSL && hasTP) ? (() => {
                const full = Math.abs(tp - sl);
                const pos  = livePrice - (isLong ? sl : tp);
                return Math.max(0, Math.min(100, (pos / (isLong ? full : -full)) * 100));
              })() : null;
              const spec = getSpec(t.symbol);
              const estimatedPnl = spec && t.positionSize
                ? (profitPips * parseFloat(t.positionSize) * spec.pipValuePerLot)
                : null;
              return (
                <div className={cx("rounded-xl border p-3 mb-2", inProfit ? "bg-emerald-500/6 border-emerald-500/20" : "bg-rose-500/6 border-rose-500/20")}>
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Live</span>
                    </div>
                    <span className={cx("text-[10px] font-semibold", todayPos ? "text-emerald-400" : "text-rose-400")}>
                      {todayPos ? "▲" : "▼"} {Math.abs(liveD.changePct).toFixed(2)}% today
                    </span>
                  </div>
                  {/* Three metric cells */}
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    <div className="bg-slate-900 rounded-lg p-2 text-center">
                      <div className={cx("font-mono text-sm font-black tracking-tight", inProfit ? "text-emerald-400" : "text-rose-400")}>
                        {livePrice.toFixed(dec)}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">Current Price</div>
                    </div>
                    <div className="bg-slate-900 rounded-lg p-2 text-center">
                      <div className={cx("font-mono text-sm font-bold", inProfit ? "text-emerald-400" : "text-rose-400")}>
                        {inProfit ? "+" : "-"}{absPips.toFixed(1)}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{pipLabel} from entry</div>
                    </div>
                    <div className="bg-slate-900 rounded-lg p-2 text-center">
                      <div className={cx("text-sm font-bold", inProfit ? "text-emerald-400" : "text-rose-400")}>
                        {estimatedPnl !== null ? (estimatedPnl >= 0 ? "+" : "") + estimatedPnl.toFixed(0) + cur : (inProfit ? "✓ Profit" : "✗ Loss")}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{estimatedPnl !== null ? "Est. P/L" : "Status"}</div>
                    </div>
                  </div>
                  {/* SL / TP distance */}
                  {(slPips !== null || tpPips !== null) && (
                    <div className="flex items-center gap-2 text-[10px] mb-1.5">
                      {slPips !== null && (
                        <span className={cx("font-medium", slPips < 5 ? "text-rose-400" : "text-slate-500")}>
                          SL: {slPips.toFixed(1)} {pipLabel} away{slPips < 5 ? " ⚠️" : ""}
                        </span>
                      )}
                      {tpPips !== null && (
                        <span className="text-slate-600">·</span>
                      )}
                      {tpPips !== null && (
                        <span className={cx("font-medium", tpPips < 3 ? "text-emerald-300" : "text-slate-500")}>
                          TP: {tpPips.toFixed(1)} {pipLabel} away{tpPips < 3 ? " 🎯" : ""}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Price progress bar: SL → TP */}
                  {barPct !== null && (
                    <div className="relative h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                        style={{ width: `${barPct}%`, background: inProfit ? "#34d399" : "#f87171" }} />
                      <div className="absolute inset-y-0 w-0.5 bg-amber-400 opacity-60"
                        style={{ left: `${barPct}%` }} />
                    </div>
                  )}
                  {barPct !== null && (
                    <div className="flex justify-between text-[9px] text-slate-700 mt-0.5">
                      <span>SL</span><span>TP</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {liveD === null && openTrades.length > 0 && (
              <div className="text-[10px] text-slate-700 text-center py-1 mb-2">Fetching live price…</div>
            )}

            {/* Risk + meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-1">
                <ShieldAlert size={12} className={overLimit ? "text-rose-400" : "text-slate-500"} />
                <span className={cx("text-xs font-semibold", overLimit ? "text-rose-400" : "text-slate-300")}>
                  {riskPctNum > 0 ? `${riskPctNum}% risk` : "No risk logged"}
                </span>
                {riskAmt !== null && <span className="text-xs text-slate-500">· {fmtBal(riskAmt, cur)}</span>}
              </div>
              {rr !== null && (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-slate-500">R:R</span>
                  <span className="font-bold text-amber-400">{fmt2(rr)}R</span>
                </div>
              )}
              {t.positionSize && <span className="text-[11px] text-slate-500">{t.positionSize} lots</span>}
              {t.session && <span className="text-[10px] text-slate-600 bg-slate-800 rounded-md px-1.5 py-0.5">{t.session}</span>}
            </div>

            {/* Over-limit warning */}
            {overLimit && (
              <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <div className="text-[11px] text-rose-400 font-medium">
                  ⚠️ Risk ({riskPctNum}%) exceeds your {maxRiskPerTrade}% per-trade limit — consider reducing size
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LiveMarketTicker() {
  // Priority pairs first — Gold and GBP/JPY are highlighted
  const TICKERS = [
    { sym: "XAUUSD",  label: "GOLD",     priority: true  },
    { sym: "GBPJPY",  label: "GBP/JPY",  priority: true  },
    { sym: "EURUSD",  label: "EUR/USD",  priority: false },
    { sym: "GBPUSD",  label: "GBP/USD",  priority: false },
    { sym: "USDJPY",  label: "USD/JPY",  priority: false },
    { sym: "EURJPY",  label: "EUR/JPY",  priority: false },
    { sym: "AUDUSD",  label: "AUD/USD",  priority: false },
    { sym: "USDCAD",  label: "USD/CAD",  priority: false },
    { sym: "USDCHF",  label: "USD/CHF",  priority: false },
    { sym: "EURGBP",  label: "EUR/GBP",  priority: false },
    { sym: "NZDUSD",  label: "NZD/USD",  priority: false },
    { sym: "CADJPY",  label: "CAD/JPY",  priority: false },
    { sym: "OIL",     label: "OIL WTI",  priority: false },
    { sym: "US30",    label: "DOW",      priority: false },
    { sym: "NAS100",  label: "NASDAQ",   priority: false },
    { sym: "BTCUSD",  label: "BTC",      priority: false },
  ];

  const [prices, setPrices] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  // Batch-fetch all symbols at once — only show ticker after all complete
  const fetchAll = async () => {
    const token = getToken();
    const hdrs: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const results = await Promise.allSettled(
      TICKERS.map(({ sym }) =>
        fetch(`/api/market/price/${encodeURIComponent(sym)}`, { headers: hdrs })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );
    const updated: Record<string, any> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) updated[TICKERS[i].sym] = r.value;
    });
    setPrices(updated);
    setLoading(false);
    setRefreshedAt(new Date());
  };

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 60_000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = TICKERS.filter((t) => prices[t.sym]);
  // Speed: ~4s per card, capped 30–90s
  const animDur = Math.min(90, Math.max(30, items.length * 4));

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
      <style>{`@keyframes otx-ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/50">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Live Markets</span>
          {!loading && items.length > 0 && (
            <span className="text-[10px] text-slate-700">{items.length} pairs</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {refreshedAt && (
            <span className="text-[10px] text-slate-700">
              {refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button onClick={fetchAll} className="text-slate-600 hover:text-amber-400 transition" title="Refresh">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex gap-4 px-4 py-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 w-24 bg-slate-800 rounded animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-3 text-[11px] text-slate-600">Unable to load market prices</div>
      ) : (
        <div className="overflow-hidden py-2">
          <div
            className="flex whitespace-nowrap"
            style={{ animation: `otx-ticker ${animDur}s linear infinite`, width: "max-content" }}
          >
            {[...items, ...items].map(({ sym, label, priority }, idx) => {
              const d = prices[sym];
              if (!d) return null;
              const { dec } = getPipInfo(sym);
              const bull = d.changePct > 0;
              const flat = Math.abs(d.changePct) < 0.01;
              const pctColor = flat ? "text-slate-500" : bull ? "text-emerald-400" : "text-rose-400";
              const trend = flat ? "FLAT" : bull ? "BULL" : "BEAR";
              const trendBg = flat
                ? "bg-slate-800 text-slate-500"
                : bull
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-rose-500/15 text-rose-400";

              return (
                <div
                  key={`${sym}-${idx}`}
                  className={cx(
                    "inline-flex items-center gap-3 px-4 border-r border-slate-800/40 shrink-0",
                    priority && "bg-slate-800/40"
                  )}
                >
                  {/* Priority star for Gold & GBP/JPY */}
                  {priority && <span className="text-amber-400 text-[9px] leading-none">★</span>}

                  <div>
                    {/* Symbol row */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={cx("text-[10px] font-bold uppercase tracking-wide", priority ? "text-amber-300" : "text-slate-400")}>
                        {label}
                      </span>
                      {/* BULL / BEAR / FLAT badge */}
                      <span className={cx("text-[9px] font-black px-1 py-0.5 rounded leading-none", trendBg)}>
                        {trend}
                      </span>
                    </div>

                    {/* Price + change */}
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-sm font-black text-slate-100 tracking-tight">
                        {d.price.toFixed(dec)}
                      </span>
                      <span className={cx("text-[10px] font-bold flex items-center gap-0.5", pctColor)}>
                        {!flat && (bull ? <TrendingUp size={8} /> : <TrendingDown size={8} />)}
                        {bull && !flat ? "+" : ""}{d.changePct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({ data, setData, goTo, onQuickLog }) {
  const a = useMemo(() => computeAnalytics(data), [data.trades, data.strategies, data.setups]);
  const acc = data.account || { startingBalance: 1000, currency: "€" };
  const cur = acc.currency || "€";
  const recentTrades = [...a.computedTrades].sort((x, y) => (y.date || "").localeCompare(x.date || "")).slice(0, 5);

  const settings = data.settings || DEFAULT_SETTINGS();
  const vis = { ...DEFAULT_SETTINGS().dashVisibility, ...(settings.dashVisibility || {}) };
  const toggle = (key: string) => setData((d: any) => {
    const s = d.settings || DEFAULT_SETTINGS();
    return { ...d, settings: { ...s, dashVisibility: { ...DEFAULT_SETTINGS().dashVisibility, ...(s.dashVisibility || {}), [key]: !(s.dashVisibility?.[key] ?? true) } } };
  });

  const [editLayout, setEditLayout] = useState(false);

  const sectionOrder: string[] = (() => {
    const allKeys = DASH_SECTION_META.map((m: any) => m.key);
    const stored = (settings.dashSectionOrder as string[] | undefined);
    if (stored && Array.isArray(stored) && stored.length === allKeys.length) return stored;
    return allKeys;
  })();

  const moveSection = (key: string, dir: -1 | 1) => {
    setData((d: any) => {
      const s = { ...DEFAULT_SETTINGS(), ...(d.settings || {}) };
      const allKeys = DASH_SECTION_META.map((m: any) => m.key);
      const order = (s.dashSectionOrder && Array.isArray(s.dashSectionOrder) && s.dashSectionOrder.length === allKeys.length)
        ? [...s.dashSectionOrder]
        : [...allKeys];
      const idx = order.indexOf(key);
      if (idx < 0) return d;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= order.length) return d;
      const next = [...order];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return { ...d, settings: { ...s, dashSectionOrder: next } };
    });
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const kpis = [
    { label: "Daily P/L",      value: fmtBalSigned(a.dayPnl, cur),                                                     tone: a.dayPnl >= 0 ? "emerald" : "rose" },
    { label: "Weekly P/L",     value: fmtBalSigned(a.weekPnl, cur),                                                    tone: a.weekPnl >= 0 ? "emerald" : "rose" },
    { label: "Win Rate",       value: a.winRate === null ? "—" : fmtPct(a.winRate),                                    tone: a.winRate === null ? "slate" : a.winRate >= 50 ? "emerald" : "rose" },
    { label: "Profit Factor",  value: a.profitFactor === null ? "—" : a.profitFactor === Infinity ? "∞" : fmt2(a.profitFactor), tone: a.profitFactor === null ? "slate" : a.profitFactor >= 1 ? "emerald" : "rose" },
    { label: "Avg R:R",        value: a.avgRR === null ? "—" : fmt2(a.avgRR) + "R",                                    tone: "slate" },
    { label: "Quality Score",  value: a.qualityScore === null ? "—" : a.qualityScore + "/100",                         tone: a.qualityScore !== null && a.qualityScore >= 70 ? "emerald" : a.qualityScore !== null ? "amber" : "slate" },
  ];

  const toneClass = { emerald: "text-emerald-400", rose: "text-rose-400", amber: "text-amber-400", slate: "text-slate-100" };

  const sectionContent: Record<string, React.ReactNode> = {
    moolMantar: <MoolMantar />,
    liveTicker: <LiveMarketTicker />,
    activeTrades: <ActiveTradeMonitor data={data} acc={acc} />,
    marketOverview: (
      <div className="relative rounded-2xl overflow-hidden border border-slate-800/60 shadow-2xl shadow-black/60"
        style={{ background: "linear-gradient(160deg,#070d1c 0%,#0b1525 60%,#070d1c 100%)", minHeight: 300 }}>
        <div className="absolute inset-0 opacity-30"
          style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 opacity-15 pointer-events-none"
          style={{ background: "radial-gradient(ellipse,#f59e0b 0%,transparent 70%)" }} />
        <HeroTopBar a={a} cur={cur} />
        <div className="relative px-2" style={{ height: 230 }}>
          <AnimatedCandlestickChart />
        </div>
        <div className="relative flex items-center justify-between px-4 py-3 border-t border-slate-800/60"
          style={{ background: "rgba(7,13,28,0.7)" }}>
          <div className="flex gap-4">
            <div>
              <div className="text-[8px] text-slate-600 uppercase tracking-wide">Trades</div>
              <div className="text-[11px] font-bold text-slate-300">{a.tradeCount ?? 0}</div>
            </div>
            <div>
              <div className="text-[8px] text-slate-600 uppercase tracking-wide">Best</div>
              <div className="text-[11px] font-bold text-emerald-400">{a.bestTrade != null ? fmtBalSigned(a.bestTrade, cur) : "—"}</div>
            </div>
            <div>
              <div className="text-[8px] text-slate-600 uppercase tracking-wide">Worst</div>
              <div className="text-[11px] font-bold text-rose-400">{a.worstTrade != null ? fmtBalSigned(a.worstTrade, cur) : "—"}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[8px] text-slate-600 uppercase tracking-wide">Local Time</div>
            <div className="text-[11px] font-mono text-slate-400">
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </div>
    ),
    marketSessions: <ForexMarketClock />,
    accountOverview: (
      <>
        <AccountBalanceCard account={acc} a={a} />
        <div className="grid grid-cols-3 gap-2">
          {kpis.map((k, ki) => (
            <div key={ki} className="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-center hover:border-slate-700 transition">
              <div className={cx("text-sm font-bold leading-tight", toneClass[k.tone] || "text-slate-100")}
                style={{ fontFamily: "'Sora', sans-serif" }}>{k.value}</div>
              <div className="text-[10px] text-slate-500 mt-1 leading-tight">{k.label}</div>
            </div>
          ))}
        </div>
      </>
    ),
    todaysFocus: (
      <>
        <SessionPlanDashCard data={data} goTo={goTo} />
        <MorningCheckIn data={data} setData={setData} />
        <PreSessionChecklist data={data} setData={setData} />
      </>
    ),
    propChallenges: <PropChallengesDashCard data={data} goTo={goTo} />,
    thisWeek: <WeeklySummary data={data} a={a} cur={cur} goTo={goTo} />,
    riskTools: (
      <>
        <OpenRiskTracker data={data} a={a} acc={acc} />
        <Card><PositionSizeCalc account={acc} /></Card>
      </>
    ),
    recentTrades: (
      <Card>
        <SectionTitle action={<button onClick={() => goTo("journal")} className="text-xs text-amber-400 font-medium">View all →</button>}>
          Last 5 Trades
        </SectionTitle>
        {recentTrades.length ? (
          <div className="space-y-0">
            {recentTrades.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-slate-800/60 last:border-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  {t.side === "Sell"
                    ? <TrendingDown size={15} className="text-rose-400 shrink-0" />
                    : <TrendingUp size={15} className="text-emerald-400 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-200">{t.symbol || "—"}</div>
                    <div className="text-[11px] text-slate-500">{t.date}{t.session ? ` · ${t.session}` : ""}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cx("text-sm font-semibold", t.c.pnl === null ? "text-slate-500" : t.c.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {fmtBalSigned(t.c.pnl, cur)}
                  </span>
                  <Pill tone={RESULT_TONE[t.c.result || "Open"]}>{t.c.result || "Open"}</Pill>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="No trades yet" sub="Tap Log Trade in the Journal tab to get started." />
        )}
      </Card>
    ),
    insightsEdge: (
      <>
        <AIInsights a={a} account={acc} />
        <YourEdgePanel a={a} />
      </>
    ),
    setupLibrary: <BestSetupsCard data={data} goTo={goTo} />,
    marketCalendar: (
      <>
        <EconomicCalendarWidget />
        <TradingCalendar a={a} />
      </>
    ),
    statistics: (
      <>
        <DetailedStatsPanel a={a} />
        <MistakeCostPanel trades={data.trades} />
      </>
    ),
    reference: (
      <>
        <TodaysPlanWidget master={data.plans.master} />
        <TradingRulesPanel />
        <CandleChecklist />
        <TraderMindset />
        <DailyRulesReminder />
      </>
    ),
  };

  return (
    <>
    <div className="space-y-3 pb-4">

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <img src="/onkar-tradex-logo.png" alt="Onkar TradeX" className="w-11 h-11 object-contain drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
          <div>
            <h1 className="text-base font-bold text-slate-100 leading-tight" style={{ fontFamily: "'Sora', sans-serif" }}>Onkar TradeX</h1>
            <p className="text-[11px] text-slate-500">{greeting} · {todayISO()}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setEditLayout((e) => !e)}
            className={cx(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition",
              editLayout
                ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-amber-400 hover:border-slate-700"
            )}
          >
            {editLayout ? <Check size={12} /> : <GripVertical size={12} />}
            {editLayout ? "Done" : "Reorder"}
          </button>
          <button onClick={() => goTo("more", "Account")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-amber-400 hover:border-slate-700 transition">
            <Pencil size={12} /> Account
          </button>
        </div>
      </div>

      {/* ── ORDERED SECTIONS ── */}
      {sectionOrder.map((key, i) => {
        const meta = DASH_SECTION_META.find((m: any) => m.key === key);
        if (!meta) return null;
        return (
          <React.Fragment key={key}>
            <DashSectionLabel
              visible={vis[key]}
              onToggle={!editLayout ? () => toggle(key) : undefined}
              editMode={editLayout}
              onMoveUp={() => moveSection(key, -1)}
              onMoveDown={() => moveSection(key, 1)}
              isFirst={i === 0}
              isLast={i === sectionOrder.length - 1}
            >
              {meta.label}
            </DashSectionLabel>
            {vis[key] !== false && sectionContent[key]}
          </React.Fragment>
        );
      })}

    </div>

    {/* ── Floating Quick-Log button ── */}
    {settings.showQuickLogFAB !== false && (
      <button
        onClick={onQuickLog}
        className="fixed bottom-20 right-4 z-50 w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 shadow-lg shadow-amber-900/40 flex items-center justify-center transition-all"
        style={{ background: "var(--otx-accent,#f59e0b)", boxShadow: "0 0 20px rgba(245,158,11,0.35)" }}
        aria-label="Log Trade"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>
    )}
    </>
  );
}


/* ============================================================
   JOURNAL — TRADE FORM
   ============================================================ */
function emptyTrade(settings?: any) {
  const s = settings || {};
  return {
    id: null, date: todayISO(),
    symbol:    s.defaultSymbol    || "",
    market:    s.defaultMarket    || "Forex",
    side:      s.defaultSide      || "Buy",
    entry: "", exit: "", sl: "", tp: "",
    riskPct:   s.defaultRiskPct   || "",
    positionSize: "",
    strategyId: "", setupId: "", notes: "", attachments: [],
    session:   s.defaultSession   || "",
    entryTime: "", exitDate: "", exitTime: "", fees: "", commission: "",
    tradeType: s.defaultTradeType || "Normal",
    grade: "", mistakes: [], reviewNotes: "", rulesViolated: false,
    manualPnl: "",
    platform: "",
    accountId: "",
  };
}

/* ────── Trade review constants ────── */
const TRADE_GRADES = ["A+", "A", "B", "C"];
const GRADE_CONFIG: Record<string, { ring: string; bg: string; label: string; text: string }> = {
  "A+": { ring: "border-emerald-500", bg: "bg-emerald-500/15",  text: "text-emerald-400", label: "Perfect execution"   },
  "A":  { ring: "border-green-500",   bg: "bg-green-500/15",    text: "text-green-400",   label: "Good execution"      },
  "B":  { ring: "border-amber-500",   bg: "bg-amber-500/15",    text: "text-amber-400",   label: "Decent, some flaws"  },
  "C":  { ring: "border-rose-500",    bg: "bg-rose-500/15",     text: "text-rose-400",    label: "Poor execution"      },
};
const MISTAKE_TAGS = [
  "FOMO entry", "Oversized", "No clear setup", "Exited early", "Moved SL",
  "Revenge trade", "News trap", "Wrong bias", "Chased price", "Poor R:R",
  "Entered without plan", "Held too long",
];

/* ────── Trade Review Panel ────── */
function TradeReviewPanel({ trade, onClose, onSave }) {
  const c = computeTrade(trade);
  const [grade, setGrade]   = useState(trade.grade || "");
  const [mistakes, setMistakes] = useState<string[]>(trade.mistakes || []);
  const [reviewNotes, setReviewNotes] = useState(trade.reviewNotes || "");
  const [rulesViolated, setRulesViolated] = useState<boolean>(!!trade.rulesViolated);

  const toggleMistake = (tag: string) =>
    setMistakes((prev) => prev.includes(tag) ? prev.filter((m) => m !== tag) : [...prev, tag]);

  const save = () => {
    onSave({ ...trade, grade, mistakes, reviewNotes, rulesViolated });
    onClose();
  };

  const gradeConf = grade ? GRADE_CONFIG[grade] : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onClose} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Trade Review</h2>
          <p className="text-[11px] text-slate-500">{trade.symbol} · {trade.date} · {c.result || "Open"}</p>
        </div>
        <button onClick={save}
          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm px-4 py-2 rounded-xl transition">
          Save Review
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-10 space-y-5">

        {/* Trade summary strip */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
            <div className={cx("text-sm font-bold", c.pnl === null ? "text-slate-500" : c.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {c.pnl !== null ? fmtSigned(c.pnl) : "—"}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">P/L</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
            <div className={cx("text-sm font-bold", c.rMultiple === null ? "text-slate-500" : c.rMultiple >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {c.rMultiple !== null ? fmtSigned(c.rMultiple, "R") : "—"}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">R-Multiple</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
            <div className="text-sm font-bold text-slate-200">{trade.session || trade.market || "—"}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Session</div>
          </div>
        </div>

        {/* Grade selector */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Execution Grade</div>
          <div className="grid grid-cols-4 gap-2">
            {TRADE_GRADES.map((g) => {
              const cfg = GRADE_CONFIG[g];
              const selected = grade === g;
              return (
                <button key={g} onClick={() => setGrade(grade === g ? "" : g)}
                  className={cx("py-3 rounded-xl border-2 text-center transition font-bold text-lg",
                    selected ? `${cfg.ring} ${cfg.bg} ${cfg.text}` : "border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-600")}>
                  {g}
                  {selected && <div className="text-[9px] font-normal mt-0.5">{cfg.label}</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mistake tags */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Mistake Tags</div>
            {mistakes.length > 0 && (
              <span className="text-[10px] text-rose-400 font-medium">{mistakes.length} tagged</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {MISTAKE_TAGS.map((tag) => {
              const active = mistakes.includes(tag);
              return (
                <button key={tag} onClick={() => toggleMistake(tag)}
                  className={cx("px-3 py-1.5 rounded-xl border text-xs font-medium transition",
                    active
                      ? "bg-rose-500/15 border-rose-500/40 text-rose-400"
                      : "bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300")}>
                  {active ? "✗ " : ""}{tag}
                </button>
              );
            })}
          </div>
          {mistakes.length === 0 && (
            <p className="text-[11px] text-slate-600 mt-2">No mistakes on this trade? Great execution 🎯</p>
          )}
        </div>

        {/* Rules violation toggle */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Rules Violation</div>
          <button
            onClick={() => setRulesViolated((v) => !v)}
            className={cx(
              "w-full flex items-center justify-between px-4 py-3.5 rounded-xl border-2 transition font-medium text-sm",
              rulesViolated
                ? "bg-rose-500/10 border-rose-500/50 text-rose-400"
                : "bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300"
            )}>
            <div className="flex items-center gap-2">
              <span className="text-base">{rulesViolated ? "🚨" : "✅"}</span>
              <div className="text-left">
                <div>{rulesViolated ? "Rules violated on this trade" : "No rules violated"}</div>
                <div className="text-[10px] font-normal opacity-70 mt-0.5">
                  {rulesViolated ? "This trade will count toward your violation P&L cost" : "Tap to flag if you broke a trading rule"}
                </div>
              </div>
            </div>
            <div className={cx("w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center",
              rulesViolated ? "bg-rose-500 border-rose-500" : "border-slate-600")}>
              {rulesViolated && <span className="text-white text-[10px] font-bold">✓</span>}
            </div>
          </button>
        </div>

        {/* Review notes */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Post-Trade Notes</div>
          <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={4}
            placeholder="What did you do well? What would you do differently next time?"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none resize-none focus:border-amber-500/50" />
        </div>

        {/* Original trade notes if any */}
        {trade.notes && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-1">Original Trade Notes</div>
            <p className="text-xs text-slate-400">{trade.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────── Mistake Cost Panel (analytics) ────── */
function MistakeCostPanel({ trades }) {
  const costMap: Record<string, { pnl: number; count: number }> = {};
  trades.forEach((t) => {
    const c = computeTrade(t);
    if (!t.mistakes || !t.mistakes.length) return;
    t.mistakes.forEach((tag: string) => {
      if (!costMap[tag]) costMap[tag] = { pnl: 0, count: 0 };
      costMap[tag].pnl += c.pnl || 0;
      costMap[tag].count++;
    });
  });

  const rows = Object.entries(costMap)
    .sort(([, a], [, b]) => a.pnl - b.pnl)
    .slice(0, 8);

  const graded = trades.filter((t) => t.grade);
  const gradeDist: Record<string, number> = {};
  graded.forEach((t) => { gradeDist[t.grade] = (gradeDist[t.grade] || 0) + 1; });

  // Rules violations summary
  const violated = trades.filter((t) => t.rulesViolated);
  const violationPnl = violated.reduce((s, t) => s + (computeTrade(t).pnl || 0), 0);
  const cleanTrades = trades.filter((t) => !t.rulesViolated && computeTrade(t).pnl !== null);
  const cleanPnl = cleanTrades.reduce((s, t) => s + (computeTrade(t).pnl || 0), 0);

  if (!rows.length && !graded.length && !violated.length) return null;

  return (
    <Card>
      <SectionTitle sub="Based on your post-trade reviews">Trade Review Insights</SectionTitle>

      {/* Rules violations summary */}
      {violated.length > 0 && (
        <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-400 uppercase tracking-wide">🚨 Rules Violations</span>
            <span className="text-[10px] text-slate-500">{violated.length} trade{violated.length !== 1 ? "s" : ""} flagged</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-950/60 rounded-lg px-3 py-2 text-center">
              <div className={cx("text-sm font-bold", violationPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {fmtSigned(violationPnl)}
              </div>
              <div className="text-[10px] text-slate-600 mt-0.5">P&L on violations</div>
            </div>
            <div className="bg-slate-950/60 rounded-lg px-3 py-2 text-center">
              <div className={cx("text-sm font-bold", cleanPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {fmtSigned(cleanPnl)}
              </div>
              <div className="text-[10px] text-slate-600 mt-0.5">P&L — rule-compliant</div>
            </div>
          </div>
          {violationPnl < 0 && (
            <p className="text-[10px] text-rose-400/80">
              Breaking your rules has cost you {fmtSigned(violationPnl)} — eliminate these trades and keep only the clean ones.
            </p>
          )}
          {violationPnl >= 0 && (
            <p className="text-[10px] text-slate-500">
              Your rule-break trades are in profit, but they add unnecessary risk. Track them over time.
            </p>
          )}
        </div>
      )}

      {/* Grade distribution */}
      {graded.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Execution Grades ({graded.length} reviewed)</div>
          <div className="flex gap-2">
            {TRADE_GRADES.map((g) => {
              const cnt = gradeDist[g] || 0;
              if (!cnt) return null;
              const cfg = GRADE_CONFIG[g];
              const pct = Math.round((cnt / graded.length) * 100);
              return (
                <div key={g} className={cx("flex-1 rounded-xl border px-2 py-2 text-center", cfg.ring, cfg.bg)}>
                  <div className={cx("text-base font-bold", cfg.text)}>{g}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{cnt} · {pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mistake cost table */}
      {rows.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Mistake Cost Breakdown</div>
          <div className="space-y-2">
            {rows.map(([tag, { pnl, count }]) => {
              const isLoss = pnl < 0;
              const barPct = rows.length ? Math.min(100, Math.abs(pnl) / Math.max(...rows.map(([, v]) => Math.abs(v.pnl))) * 100) : 0;
              return (
                <div key={tag}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-slate-300 font-medium">{tag}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-600">{count}×</span>
                      <span className={cx("text-xs font-semibold", isLoss ? "text-rose-400" : "text-emerald-400")}>
                        {fmtSigned(pnl)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: isLoss ? "#f87171" : "#34d399" }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-600 mt-3">Tag mistakes on your trades via the Review (★) button in the Journal to populate this.</p>
        </>
      )}

      {rows.length === 0 && graded.length > 0 && (
        <p className="text-xs text-slate-500 mt-1">No mistake tags yet. Open a trade in the Journal and tap ★ Review to tag what went wrong.</p>
      )}
    </Card>
  );
}

function TradeForm({ open, onClose, onSave, initial, setups, strategies, account, settings, tradingAccounts = [] }) {
  const [form, setForm] = useState(emptyTrade(settings));
  const [step, setStep] = useState(0);
  useEffect(() => { setForm(initial || emptyTrade(settings)); setStep(0); }, [initial, open]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const live = useMemo(() => computeTrade(form), [form]);

  const [livePrice, setLivePrice] = useState<{ price: number; bid: number | null; ask: number | null; change: number; changePct: number } | null>(null);
  const [livePriceLoading, setLivePriceLoading] = useState(false);
  const [livePriceError, setLivePriceError] = useState(false);

  const fetchLivePrice = (sym: string) => {
    if (!sym) return;
    setLivePriceLoading(true);
    setLivePriceError(false);
    const token = localStorage.getItem("src_auth_token");
    fetch(`/api/market/price/${encodeURIComponent(sym)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { setLivePrice(d); setLivePriceLoading(false); })
      .catch(() => { setLivePrice(null); setLivePriceLoading(false); setLivePriceError(true); });
  };

  useEffect(() => {
    if (step !== 1 || !form.symbol) { setLivePrice(null); setLivePriceError(false); return; }
    fetchLivePrice(form.symbol);
  }, [form.symbol, step]);

  const acc = account || { startingBalance: 1000, currency: "€" };
  const cur = acc.currency || "€";
  const riskPctNum = parseFloat(form.riskPct);
  const riskAmt = !isNaN(riskPctNum) && acc.startingBalance ? (riskPctNum / 100) * parseFloat(acc.startingBalance) : null;

  const save = () => {
    if (!form.symbol.trim()) return;
    onSave({ ...form, id: form.id || uid() });
  };

  const nf = (id: string) => (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); (document.getElementById(id) as HTMLElement | null)?.focus(); } };

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
          <div className="text-[10px] text-slate-500 font-medium">Step</div>
          <div className="text-base font-black text-amber-400 leading-tight">
            {step + 1}<span className="text-slate-600 font-normal text-xs"> / {STEPS.length}</span>
          </div>
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
            <Field label="Platform / Broker" hint="MT4, MT5, TradingView, or your broker name">
              <TextInput
                list="otx-platforms"
                type="text"
                placeholder="e.g. MT4, TradingView, Pepperstone..."
                value={form.platform || ""}
                onChange={set("platform")}
              />
              <datalist id="otx-platforms">
                {TRADING_PLATFORMS.map((p) => <option key={p} value={p} />)}
              </datalist>
            </Field>
            {(tradingAccounts as any[]).length > 0 && (
              <Field label="Trading Account" hint="Link this trade to one of your broker accounts">
                <Select value={form.accountId || ""} onChange={set("accountId")}>
                  <option value="">— No account selected —</option>
                  {(tradingAccounts as any[]).map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber}{a.alias ? ` · ${a.alias}` : ""} ({a.platform} · {a.accountType})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
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

            {/* ── Live Price Chip ── */}
            {form.symbol && (
              <div className={cx("rounded-2xl border p-3.5 mb-1",
                livePriceError ? "bg-slate-900 border-slate-800" :
                livePrice ? "bg-sky-500/8 border-sky-500/25" :
                "bg-slate-900 border-slate-800")}>
                {livePriceLoading && (
                  <div className="flex items-center gap-2">
                    <RefreshCw size={12} className="text-sky-400 animate-spin" />
                    <span className="text-xs text-slate-500">Fetching live price for {form.symbol}…</span>
                  </div>
                )}
                {livePriceError && !livePriceLoading && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={12} className="text-slate-600" />
                      <span className="text-xs text-slate-600">No live price available</span>
                    </div>
                    <button onClick={() => fetchLivePrice(form.symbol)}
                      className="text-[11px] text-sky-400 flex items-center gap-1 hover:text-sky-300">
                      <RefreshCw size={10} /> Retry
                    </button>
                  </div>
                )}
                {livePrice && !livePriceLoading && (() => {
                  const isIndex = form.market === "Indices";
                  const isCrypto = form.market === "Crypto";
                  const isJpy = (form.symbol || "").toUpperCase().includes("JPY");
                  const dec = isIndex || isCrypto ? 2 : isJpy ? 3 : 5;
                  const priceStr = livePrice.price.toFixed(dec);
                  const bidStr = livePrice.bid ? livePrice.bid.toFixed(dec) : null;
                  const askStr = livePrice.ask ? livePrice.ask.toFixed(dec) : null;
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                          <span className="text-[10px] text-sky-400 font-semibold uppercase tracking-wide">Live Price</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cx("text-[10px] font-semibold", livePrice.change >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {livePrice.change >= 0 ? "+" : ""}{livePrice.change.toFixed(dec)} ({livePrice.changePct >= 0 ? "+" : ""}{livePrice.changePct.toFixed(2)}%)
                          </span>
                          <button onClick={() => fetchLivePrice(form.symbol)}
                            className="text-slate-600 hover:text-slate-400 transition">
                            <RefreshCw size={10} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-end gap-3 mb-3">
                        <span className="text-2xl font-bold font-mono text-slate-100">{priceStr}</span>
                        {bidStr && askStr && (
                          <div className="text-[10px] leading-tight mb-0.5">
                            <div className="text-slate-500">Bid <span className="text-rose-400 font-mono font-semibold">{bidStr}</span></div>
                            <div className="text-slate-500">Ask <span className="text-emerald-400 font-mono font-semibold">{askStr}</span></div>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          onClick={() => setForm((f) => ({ ...f, entry: livePrice.ask ? String(livePrice.ask) : String(livePrice.price) }))}
                          className="py-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 text-[11px] font-bold hover:bg-sky-500/25 transition">
                          ↓ Use as Entry
                        </button>
                        <button
                          onClick={() => setForm((f) => ({ ...f, exit: String(livePrice.price) }))}
                          className="py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-bold hover:bg-slate-700 transition">
                          ↓ Use as Exit
                        </button>
                        <button
                          onClick={() => setForm((f) => ({
                            ...f,
                            sl: livePrice.bid ? String(livePrice.bid) : String(livePrice.price),
                            entry: livePrice.ask ? String(livePrice.ask) : String(livePrice.price),
                          }))}
                          className="py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-bold hover:bg-slate-700 transition">
                          ↓ Entry + SL
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Row 1: Entry + SL — the two prices a trader always knows first */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Entry Price">
                <TextInput id="tf-entry" type="number" inputMode="decimal" step="any" placeholder="0.00000"
                  enterKeyHint="next" value={form.entry} onChange={set("entry")} onKeyDown={nf("tf-sl")} />
              </Field>
              <Field label="Stop Loss">
                <TextInput id="tf-sl" type="number" inputMode="decimal" step="any" placeholder="0.00000"
                  enterKeyHint="next" value={form.sl} onChange={set("sl")} onKeyDown={nf("tf-tp")} />
              </Field>
            </div>

            {/* Quick SL strip — pip presets */}
            {(() => {
              const entry = parseFloat(form.entry);
              if (!entry || isNaN(entry)) return null;
              const { pip, dec, label } = getPipInfo(form.symbol);
              const isLong = form.side === "Buy";
              const SL_PIPS = [5, 10, 15, 20, 30, 50];
              return (
                <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-3 -mt-1 mb-1">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert size={11} className="text-rose-400" />
                    <span className="text-[10px] uppercase tracking-wide text-rose-400 font-semibold">Quick SL</span>
                    <span className={cx("text-[10px] font-medium ml-0.5", isLong ? "text-emerald-400" : "text-rose-400")}>
                      · {isLong ? "↓ Buy (SL below entry)" : "↑ Sell (SL above entry)"}
                    </span>
                    <span className="text-[10px] text-slate-700 ml-auto">1 {label} = {pip}</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {SL_PIPS.map((n) => {
                      const slPrice = isLong ? entry - n * pip : entry + n * pip;
                      const slStr = slPrice.toFixed(dec);
                      const active = form.sl === slStr;
                      return (
                        <button key={n} type="button" onClick={() => setForm((f) => ({ ...f, sl: slStr }))}
                          className={cx("px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition",
                            active
                              ? "bg-rose-500/25 border-rose-500/50 text-rose-300"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:border-rose-500/40 hover:text-rose-300")}>
                          {n} {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Row 2: TP + Exit price */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Take Profit">
                <TextInput id="tf-tp" type="number" inputMode="decimal" step="any" placeholder="0.00000"
                  enterKeyHint="next" value={form.tp} onChange={set("tp")} onKeyDown={nf("tf-exit")} />
              </Field>
              <Field label="Exit Price" hint="Leave blank if still open">
                <TextInput id="tf-exit" type="number" inputMode="decimal" step="any" placeholder="0.00000"
                  enterKeyHint="next" value={form.exit} onChange={set("exit")} onKeyDown={nf("tf-pnl")} />
              </Field>
            </div>

            {/* Quick TP strip — R:R presets */}
            {(() => {
              const entry = parseFloat(form.entry);
              const sl = parseFloat(form.sl);
              if (!entry || !sl || isNaN(entry) || isNaN(sl) || Math.abs(entry - sl) < 1e-10) return null;
              const { pip, dec, label } = getPipInfo(form.symbol);
              const isLong = form.side === "Buy";
              const slDist = Math.abs(entry - sl);
              const slPips = (slDist / pip).toFixed(1);
              const RR_PRESETS = [1, 1.5, 2, 3, 4];
              return (
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 -mt-1 mb-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Target size={11} className="text-emerald-400" />
                    <span className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold">Quick TP</span>
                    <span className="text-[10px] text-slate-600">· SL = {slPips} {label} from entry</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {RR_PRESETS.map((rr) => {
                      const tpPrice = isLong ? entry + rr * slDist : entry - rr * slDist;
                      const tpStr = tpPrice.toFixed(dec);
                      const active = form.tp === tpStr;
                      const potGain = rr * slDist;
                      return (
                        <button key={rr} type="button" onClick={() => setForm((f) => ({ ...f, tp: tpStr }))}
                          className={cx("flex flex-col items-center px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition",
                            active
                              ? "bg-emerald-500/25 border-emerald-500/50 text-emerald-300"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300")}>
                          <span>{rr}:1</span>
                          <span className="text-[9px] opacity-60 font-normal">{tpStr}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Actual P/L — the most important field */}
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/20 p-4 mb-1">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={13} className="text-emerald-400" />
                <span className="text-[11px] uppercase tracking-wide text-emerald-400 font-semibold">Actual P/L from Broker</span>
              </div>
              <TextInput
                id="tf-pnl" type="number" inputMode="decimal" step="any"
                placeholder="e.g. 250.00 or -120.00"
                enterKeyHint="next"
                value={form.manualPnl}
                onChange={(e) => setForm((f) => ({ ...f, manualPnl: e.target.value }))}
                onKeyDown={nf("tf-entryTime")}
              />
              <p className="text-[10px] text-slate-600 mt-1.5">Enter the exact profit/loss shown on your broker. Negative = loss. This drives all stats and balance.</p>
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
              <Field label="Entry Time" hint="Enables hold-time stats"><TextInput id="tf-entryTime" type="time" value={form.entryTime} onChange={set("entryTime")} /></Field>
              <Field label="Exit Time"><TextInput id="tf-exitTime" type="time" value={form.exitTime} onChange={set("exitTime")} /></Field>
            </div>
            <Field label="Exit Date" hint="Only if trade closed on a different day">
              <TextInput type="date" value={form.exitDate} onChange={set("exitDate")} />
            </Field>
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 mt-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-3">Live Trade Calculation</div>
              <div className="grid grid-cols-2 gap-3">
                <div className={cx("rounded-xl p-3 text-center", live.pnl !== null && form.manualPnl !== "" ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-800")}>
                  <div className={cx("text-lg font-semibold", live.pnl === null ? "text-slate-500" : live.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{live.pnl === null ? "—" : fmtBal(live.pnl, cur)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{form.manualPnl !== "" ? "P/L (broker)" : "P/L"}</div>
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
            {/* Quick Risk % buttons */}
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={11} className="text-amber-400" />
                <span className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">Quick Risk %</span>
                <span className="text-[10px] text-slate-600">· tap to set</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[0.25, 0.5, 1, 1.5, 2, 3].map((pct) => {
                  const bal = parseFloat(String(acc.startingBalance));
                  const amt = !isNaN(bal) && bal > 0 ? (pct / 100) * bal : null;
                  const active = form.riskPct === String(pct);
                  return (
                    <button key={pct} type="button"
                      onClick={() => setForm((f) => ({ ...f, riskPct: String(pct) }))}
                      className={cx("flex flex-col items-center px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition min-w-[44px]",
                        active
                          ? "bg-amber-500/25 border-amber-500/50 text-amber-300"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:border-amber-500/40 hover:text-amber-300")}>
                      <span>{pct}%</span>
                      {amt !== null && <span className="text-[9px] font-normal opacity-60">{cur}{Math.round(amt)}</span>}
                    </button>
                  );
                })}
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
/* ============================================================
   TRADE REPLAY MODE
   ============================================================ */
const REPLAY_STEPS = [
  { id: "setup",      title: "The Setup",        sub: "Reconstruct your context before looking at numbers" },
  { id: "entry",      title: "Your Entry",        sub: "Price levels and execution details" },
  { id: "management", title: "Trade Management",  sub: "What happened during the trade" },
  { id: "outcome",    title: "The Outcome",        sub: "The result — revealed" },
  { id: "review",     title: "Review & Reflect",   sub: "Grade your execution and log lessons" },
];

function TradeReplayModal({ trade, data, onClose, onSave }) {
  const [step, setStep] = useState(0);
  const [grade, setGrade] = useState(trade.grade || "");
  const [mistakes, setMistakes] = useState<string[]>(trade.mistakes || []);
  const [reviewNotes, setReviewNotes] = useState(trade.reviewNotes || "");
  const [rulesViolated, setRulesViolated] = useState(trade.rulesViolated || false);

  const c = computeTrade(trade);
  const setup = data.setups.find((s: any) => s.id === trade.setupId);
  const strategy = data.strategies.find((s: any) => s.id === trade.strategyId);

  const fmtPrice = (v: string) => v ? parseFloat(v).toFixed(5) : "—";
  const fmt2 = (n: number | null) => n !== null ? n.toFixed(2) : "—";

  const goNext = () => setStep((s) => Math.min(s + 1, REPLAY_STEPS.length - 1));
  const goPrev = () => setStep((s) => Math.max(s - 1, 0));

  const toggleMistake = (m: string) =>
    setMistakes((ms) => ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]);

  const handleSave = () => {
    onSave({ ...trade, grade, mistakes, reviewNotes, rulesViolated });
    onClose();
  };

  const ResultBanner = () => {
    if (!c.result) return <div className="text-slate-500 text-sm">Trade not yet closed</div>;
    const cfg = {
      Win:       { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-400", emoji: "🏆" },
      Loss:      { bg: "bg-rose-500/10 border-rose-500/30",       text: "text-rose-400",    emoji: "📉" },
      Breakeven: { bg: "bg-slate-800 border-slate-700",           text: "text-slate-300",   emoji: "⚖️" },
    }[c.result] || { bg: "bg-slate-800 border-slate-700", text: "text-slate-400", emoji: "—" };
    return (
      <div className={cx("rounded-2xl border px-6 py-5 text-center", cfg.bg)}>
        <div className="text-4xl mb-2">{cfg.emoji}</div>
        <div className={cx("text-3xl font-black tracking-tight mb-1", cfg.text)}>{c.result.toUpperCase()}</div>
        {c.rMultiple !== null && (
          <div className={cx("text-5xl font-black mt-2", cfg.text)}>
            {c.rMultiple >= 0 ? "+" : ""}{c.rMultiple.toFixed(2)}R
          </div>
        )}
        {c.netPnl !== null && (
          <div className="text-slate-400 text-sm mt-1">
            Net P/L: <span className={cfg.text}>{c.netPnl >= 0 ? "+" : ""}{c.netPnl.toFixed(2)}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-top pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Repeat2 size={16} className="text-amber-400" />
          <span className="text-sm font-semibold text-slate-200" style={{ fontFamily: "'Sora', sans-serif" }}>Trade Replay</span>
          <span className="text-xs text-slate-600">— {trade.symbol || "Untitled"} · {trade.date}</span>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200">
          <X size={16} />
        </button>
      </div>

      {/* Step dots */}
      <div className="flex items-center justify-center gap-2 py-3">
        {REPLAY_STEPS.map((s, i) => (
          <button key={s.id} onClick={() => setStep(i)}
            className={cx("rounded-full transition-all duration-300", i === step ? "w-6 h-2 bg-amber-500" : i < step ? "w-2 h-2 bg-amber-500/40" : "w-2 h-2 bg-slate-700")} />
        ))}
      </div>

      {/* Step label */}
      <div className="px-4 pb-3">
        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">{REPLAY_STEPS[step].title}</div>
        <div className="text-[10px] text-slate-500 mt-0.5">{REPLAY_STEPS[step].sub}</div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">

        {/* ── Step 0: Setup ── */}
        {step === 0 && (
          <div className="space-y-3">
            {/* Direction badge */}
            <div className={cx("rounded-2xl border px-5 py-4 text-center",
              trade.side === "Buy" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-rose-500/10 border-rose-500/30")}>
              <div className={cx("text-4xl font-black tracking-tighter", trade.side === "Buy" ? "text-emerald-400" : "text-rose-400")}>
                {trade.side === "Buy" ? "▲ BUY" : "▼ SELL"}
              </div>
              <div className="text-2xl font-bold text-slate-100 mt-1">{trade.symbol || "—"}</div>
            </div>
            {/* Details grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Date",     value: trade.date || "—" },
                { label: "Market",   value: trade.market || "—" },
                { label: "Session",  value: trade.session || "—" },
                { label: "Type",     value: trade.tradeType || "Normal" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
                  <div className="text-sm font-semibold text-slate-200">{value}</div>
                </div>
              ))}
            </div>
            {(setup || strategy) && (
              <div className="space-y-2">
                {setup && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Setup Used</div>
                    <div className="text-sm font-semibold text-slate-200">{setup.name}</div>
                    {setup.trend && <div className="text-[10px] text-slate-500 mt-0.5">Trend: {setup.trend}</div>}
                  </div>
                )}
                {strategy && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Strategy</div>
                    <div className="text-sm font-semibold text-slate-200">{strategy.name}</div>
                  </div>
                )}
              </div>
            )}
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-amber-400/70 italic">Before moving to the next step — recall your thesis. Why did you take this trade? What was your bias and what did price need to do to confirm your entry?</p>
            </div>
          </div>
        )}

        {/* ── Step 1: Entry ── */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Entry Price</div>
              <div className="text-4xl font-black text-slate-100 tracking-tight">{fmtPrice(trade.entry)}</div>
              {trade.entryTime && <div className="text-xs text-slate-500 mt-1">@ {trade.entryTime}</div>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Stop Loss",  value: fmtPrice(trade.sl),          color: "text-rose-400" },
                { label: "Take Profit", value: fmtPrice(trade.tp),          color: "text-emerald-400" },
                { label: "Planned R:R", value: c.plannedRR ? `1:${fmt2(c.plannedRR)}` : "—", color: "text-amber-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl px-2 py-2.5 text-center">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">{label}</div>
                  <div className={cx("text-sm font-bold", color)}>{value}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Risk %",       value: trade.riskPct ? `${trade.riskPct}%` : "—" },
                { label: "Position Size", value: trade.positionSize ? `${trade.positionSize} lots` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
                  <div className="text-sm font-semibold text-slate-200">{value}</div>
                </div>
              ))}
            </div>
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-amber-400/70 italic">Did you enter at your planned level? Was your stop loss in the right place? Was the R:R worth taking?</p>
            </div>
          </div>
        )}

        {/* ── Step 2: Management ── */}
        {step === 2 && (
          <div className="space-y-3">
            {trade.notes ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-3">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">Trade Notes</div>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{trade.notes}</p>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-4 text-center">
                <p className="text-slate-600 text-sm">No notes were logged for this trade.</p>
              </div>
            )}
            {trade.tradeType && trade.tradeType !== "Normal" && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">Trade Type</div>
                <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/20 text-amber-400 text-[10px] font-semibold">{trade.tradeType}</span>
              </div>
            )}
            {c.holdMinutes !== null && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Hold Duration</div>
                <div className="text-sm font-semibold text-slate-200">
                  {c.holdMinutes < 60 ? `${Math.round(c.holdMinutes)}m` : `${Math.floor(c.holdMinutes/60)}h ${Math.round(c.holdMinutes%60)}m`}
                </div>
              </div>
            )}
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-amber-400/70 italic">How did you manage this trade? Did you move your stop? Take partial profit? Close early? Before you see the outcome, reflect on your mid-trade decisions.</p>
            </div>
          </div>
        )}

        {/* ── Step 3: Outcome ── */}
        {step === 3 && (
          <div className="space-y-3">
            <ResultBanner />
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Exit Price</div>
                <div className="text-sm font-semibold text-slate-200">{fmtPrice(trade.exit)}</div>
                {trade.exitTime && <div className="text-[10px] text-slate-600">{trade.exitDate || trade.date} @ {trade.exitTime}</div>}
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Raw P/L</div>
                <div className={cx("text-sm font-semibold", c.pnl === null ? "text-slate-500" : c.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {c.pnl !== null ? `${c.pnl >= 0 ? "+" : ""}${c.pnl.toFixed(2)}` : "—"}
                </div>
              </div>
              {c.pctMove !== null && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Price Move</div>
                  <div className="text-sm font-semibold text-slate-200">{c.pctMove >= 0 ? "+" : ""}{c.pctMove.toFixed(4)}%</div>
                </div>
              )}
              {c.holdMinutes !== null && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Held For</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {c.holdMinutes < 60 ? `${Math.round(c.holdMinutes)}m` : `${Math.floor(c.holdMinutes/60)}h ${Math.round(c.holdMinutes%60)}m`}
                  </div>
                </div>
              )}
            </div>
            {trade.grade && (
              <div className={cx("rounded-xl border px-3 py-2.5", GRADE_CONFIG[trade.grade]?.bg, GRADE_CONFIG[trade.grade]?.ring)}>
                <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-0.5">Current Grade</div>
                <div className={cx("text-sm font-bold", GRADE_CONFIG[trade.grade]?.text)}>
                  {trade.grade} — {GRADE_CONFIG[trade.grade]?.label}
                </div>
              </div>
            )}
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-amber-400/70 italic">Now that you see the outcome — does it match what you expected? Does a win or loss change how you feel about your execution? The result doesn't define the quality of your process.</p>
            </div>
          </div>
        )}

        {/* ── Step 4: Review ── */}
        {step === 4 && (
          <div className="space-y-4">
            {/* Grade */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Execution Grade</div>
              <div className="grid grid-cols-4 gap-2">
                {TRADE_GRADES.map((g) => {
                  const cfg = GRADE_CONFIG[g];
                  return (
                    <button key={g} onClick={() => setGrade(grade === g ? "" : g)}
                      className={cx("py-3 rounded-xl border text-sm font-bold transition",
                        grade === g ? `${cfg.bg} ${cfg.ring} ${cfg.text}` : "bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600")}>
                      {g}
                    </button>
                  );
                })}
              </div>
              {grade && <p className="text-[10px] text-slate-500 mt-1.5">{GRADE_CONFIG[grade]?.label}</p>}
            </div>

            {/* Mistakes */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Mistake Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {MISTAKE_TAGS.map((m) => (
                  <button key={m} onClick={() => toggleMistake(m)}
                    className={cx("px-2.5 py-1 rounded-lg border text-[10px] font-medium transition",
                      mistakes.includes(m)
                        ? "bg-rose-500/15 border-rose-500/30 text-rose-400"
                        : "bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600")}>
                    {mistakes.includes(m) ? "✗ " : ""}{m}
                  </button>
                ))}
              </div>
            </div>

            {/* Review notes */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Lessons / Reflection</div>
              <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={4}
                placeholder="What did this trade teach you? What would you do differently next time?"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none resize-none focus:border-amber-500/50" />
            </div>

            {/* Rules violated */}
            <button onClick={() => setRulesViolated((v) => !v)}
              className={cx("w-full flex items-center justify-between px-4 py-3 rounded-xl border transition",
                rulesViolated ? "bg-rose-500/10 border-rose-500/30" : "bg-slate-900 border-slate-800")}>
              <span className="text-sm font-medium text-slate-300">Rules violated on this trade</span>
              <div className={cx("w-5 h-5 rounded border-2 flex items-center justify-center transition",
                rulesViolated ? "bg-rose-500 border-rose-500" : "border-slate-600")}>
                {rulesViolated && <Check size={12} className="text-white" />}
              </div>
            </button>

            <button onClick={handleSave}
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm py-3.5 rounded-xl transition">
              Save Review & Close
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3 px-4 pb-safe-bottom pb-6 pt-3 border-t border-slate-800">
        <button onClick={goPrev} disabled={step === 0}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 disabled:opacity-30 text-sm font-medium">
          <ChevronLeft size={15} /> Back
        </button>
        <div className="flex-1 text-center text-[10px] text-slate-600">
          Step {step + 1} of {REPLAY_STEPS.length}
        </div>
        {step < REPLAY_STEPS.length - 1 ? (
          <button onClick={goNext}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm">
            Next <ChevronRight size={15} />
          </button>
        ) : (
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-sm font-medium">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function JournalTab({ data, setData, autoOpen = false, onAutoOpenDone = () => {} }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (autoOpen) { setEditing(null); setFormOpen(true); onAutoOpenDone(); }
  }, [autoOpen]);
  const [confirmId, setConfirmId] = useState(null);
  const [marketFilter, setMarketFilter] = useState("All");
  const [resultFilter, setResultFilter] = useState("All");
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [reviewTrade, setReviewTrade] = useState(null);
  const [replayTrade, setReplayTrade] = useState(null);

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
      const nd = { ...d, trades };
      return { ...nd, propChallenges: syncChallengeBalances(nd) };
    });
    setFormOpen(false);
    setEditing(null);
  };

  const remove = (id) => {
    setData((d) => {
      const trades = d.trades.filter((t) => t.id !== id);
      const nd = { ...d, trades };
      return { ...nd, propChallenges: syncChallengeBalances(nd) };
    });
    setConfirmId(null);
  };

  /* TradeForm is now full-page — render it as an overlay on top of journal */
  if (formOpen) {
    return <TradeForm open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} onSave={save} initial={editing} setups={data.setups} strategies={data.strategies} account={data.account} settings={data.settings} tradingAccounts={data.tradingAccounts || []} />;
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

  const saveReview = (updated) => {
    setData((d) => ({ ...d, trades: d.trades.map((t) => (t.id === updated.id ? updated : t)) }));
    setReviewTrade(null);
  };

  if (reviewTrade) {
    return <TradeReviewPanel trade={reviewTrade} onClose={() => setReviewTrade(null)} onSave={saveReview} />;
  }

  if (replayTrade) {
    return (
      <TradeReplayModal
        trade={replayTrade}
        data={data}
        onClose={() => setReplayTrade(null)}
        onSave={(updated) => {
          setData((d: any) => ({ ...d, trades: d.trades.map((t: any) => t.id === updated.id ? updated : t) }));
          setReplayTrade(null);
        }} />
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
                  <div className="flex items-center gap-1.5">
                    <Pill tone={RESULT_TONE[c.result || "Open"]}>{c.result || "Open"}</Pill>
                    {c.result && (
                      <button onClick={(e) => { e.stopPropagation(); setReviewTrade(t); }}
                        title="Review this trade"
                        className={cx("p-1.5 rounded-lg border text-[11px] font-bold transition",
                          t.grade
                            ? `${GRADE_CONFIG[t.grade].bg} ${GRADE_CONFIG[t.grade].ring} ${GRADE_CONFIG[t.grade].text}`
                            : "bg-slate-900 border-slate-700 text-slate-500 hover:text-amber-400 hover:border-amber-500/40")}>
                        {t.grade || "★"}
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setReplayTrade(t); }}
                      title="Replay this trade"
                      className="p-1.5 rounded-lg border bg-slate-900 border-slate-700 text-slate-500 hover:text-amber-400 hover:border-amber-500/40 transition">
                      <Play size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmId(t.id); }} className="p-1 text-slate-600 hover:text-rose-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* Rules violation flag */}
                {t.rulesViolated && (
                  <div className="mt-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-[10px] font-semibold text-rose-400">
                      🚨 Rules violated
                    </span>
                  </div>
                )}
                {/* Mistake tags */}
                {t.mistakes && t.mistakes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.mistakes.map((m) => (
                      <span key={m} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-rose-500/10 border border-rose-500/20 text-rose-400">{m}</span>
                    ))}
                  </div>
                )}
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
    image: null, marketBias: "", setupType: "", photos: [] as any[],
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

/* Multi-photo gallery for setups — add/caption/remove */
function SetupPhotoGallery({ photos, onChange }: { photos: any[]; onChange: (p: any[]) => void }) {
  const inputRef = useRef<any>(null);
  const [captionId, setCaptionId] = useState<string | null>(null);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const added: any[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 4 * 1024 * 1024) continue;
      const url = await fileToDataUrl(file);
      added.push({ id: uid(), url, caption: "" });
    }
    onChange([...photos, ...added]);
  };

  const remove = (id: string) => onChange(photos.filter((p) => p.id !== id));
  const setCaption = (id: string, caption: string) =>
    onChange(photos.map((p) => (p.id === id ? { ...p, caption } : p)));

  return (
    <div>
      {photos.length === 0 ? (
        <button onClick={() => inputRef.current?.click()}
          className="w-full rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-500/50 bg-slate-900/50 py-8 flex flex-col items-center gap-2 transition">
          <ImageIcon size={22} className="text-slate-600" />
          <span className="text-sm text-slate-400 font-medium">Add chart screenshots</span>
          <span className="text-[11px] text-slate-600">Multiple photos supported · 4MB each max</span>
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {photos.map((ph) => (
            <div key={ph.id} className="relative group rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
              <img src={ph.url} alt={ph.caption || "Chart"} className="w-full h-28 object-cover" />
              <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition flex items-end p-1.5 gap-1">
                <button onClick={() => setCaptionId(captionId === ph.id ? null : ph.id)}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-amber-400">
                  <Pencil size={11} />
                </button>
                <button onClick={() => remove(ph.id)}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-rose-400">
                  <Trash2 size={11} />
                </button>
              </div>
              {ph.caption && (
                <div className="px-2 py-1 bg-slate-900/90 text-[10px] text-slate-400 truncate">{ph.caption}</div>
              )}
              {captionId === ph.id && (
                <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-slate-950/95">
                  <input autoFocus value={ph.caption}
                    onChange={(e) => setCaption(ph.id, e.target.value)}
                    onBlur={() => setCaptionId(null)}
                    onKeyDown={(e) => e.key === "Enter" && setCaptionId(null)}
                    className="w-full bg-transparent text-[11px] text-amber-400 outline-none border-b border-amber-500/40 pb-0.5"
                    placeholder="Add caption…" />
                </div>
              )}
            </div>
          ))}
          <button onClick={() => inputRef.current?.click()}
            className="rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-500/50 bg-slate-900/50 h-28 flex flex-col items-center justify-center gap-1 transition">
            <Plus size={16} className="text-slate-600" />
            <span className="text-[10px] text-slate-600">Add more</span>
          </button>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => addPhotos(e.target.files)} />
    </div>
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

  const save = () => { if (!(form.name || "").trim()) return; onSave({ ...form, id: form.id || uid() }); };

  const pageTitle = mode === "fromImage" ? "Create Setup from Image" : mode === "edit" ? "Edit Setup" : "New Setup";
  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "Library", onClick: () => goTo("library", "Setups") },
    { label: "Setup Library", onClick: () => goTo("library", "Setups") },
    { label: pageTitle },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={mode === "edit" ? "Save" : "Create"} saveDisabled={!(form.name || "").trim()} goTo={goTo}>

      {/* Chart Screenshots — always visible at top so they're never missed */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
          <ImageIcon size={11} /> Chart Screenshots
        </div>
        <SetupPhotoGallery photos={form.photos || []} onChange={(photos) => setForm((f) => ({ ...f, photos }))} />
      </div>

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

        <Accordion id="attachments" open={openSection} onToggle={setOpenSection} title={`Attachments (${form.attachments.length})`} icon={Paperclip}>
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
            {(s.photos || []).length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {(s.photos || []).map((ph: any) => (
                  <div key={ph.id} className="rounded-xl overflow-hidden border border-slate-800">
                    <img src={ph.url} alt={ph.caption || "Chart"} className="w-full h-24 object-cover bg-slate-950" />
                    {ph.caption && <div className="px-2 py-1 bg-slate-900 text-[10px] text-slate-400 truncate">{ph.caption}</div>}
                  </div>
                ))}
              </div>
            )}
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
  const save = () => { if (!(form.name || "").trim()) return; onSave({ ...form, id: form.id || uid() }); };

  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "Library", onClick: () => goTo("library", "Strategies") },
    { label: "Strategy Library", onClick: () => goTo("library", "Strategies") },
    { label: initial ? "Edit Strategy" : "New Strategy" },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={initial ? "Save" : "Create"} saveDisabled={!(form.name || "").trim()} goTo={goTo}>
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
   FOREX BLUEPRINT DATA
   ============================================================ */
const FOREX_BLUEPRINT_TOPICS = [
  // ── FOUNDATIONS ──────────────────────────────────────────
  {
    id: "what-is-forex",
    category: "Foundations",
    color: "emerald",
    title: "What is Forex Trading?",
    emoji: "🌍",
    summary: "Forex (Foreign Exchange) is the global decentralized marketplace where currencies are bought and sold. It is the largest and most liquid financial market in the world, operating 24 hours/day, 5 days/week.",
    keyPoints: [
      "Forex = speculating on the price movement of one currency relative to another",
      "Traded as currency pairs: EUR/USD, GBP/USD, USD/JPY, etc.",
      "Market is decentralized — no central exchange; trades happen over-the-counter (OTC)",
      "Over $6 trillion in daily trading volume — the most liquid market on earth",
      "Operates in 4 major sessions: Sydney, Tokyo, London, New York",
      "CFDs (Contracts for Difference) allow speculation without owning the underlying currency",
      "You can profit in both rising AND falling markets (buy or sell)",
    ],
    rules: [
      "Never trade a pair you don't understand the behavior of",
      "Know which session your pair is most active in",
      "Always use a regulated broker",
    ],
  },
  {
    id: "currency-pairs",
    category: "Foundations",
    color: "emerald",
    title: "Currency Pairs & Pips",
    emoji: "💱",
    summary: "Every Forex trade involves buying one currency while simultaneously selling another. The price of a pair tells you how much of the quote currency is needed to buy one unit of the base currency.",
    keyPoints: [
      "Base currency = first currency (EUR in EUR/USD); Quote currency = second (USD)",
      "Major pairs: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD — highest liquidity",
      "Minor pairs: EUR/GBP, EUR/AUD — no USD, decent liquidity",
      "Exotic pairs: USD/TRY, EUR/ZAR — lower liquidity, higher spreads, higher volatility",
      "Pip = smallest price increment (0.0001 for most pairs; 0.01 for JPY pairs)",
      "Spread = difference between Ask price (you buy) and Bid price (you sell)",
      "Ask price used when opening a buy; Bid price used when opening a sell",
    ],
    rules: [
      "Start with majors — tighter spreads, more analysis available",
      "Factor spread cost into every trade's risk calculation",
      "Know the pip value for each pair before sizing your position",
    ],
  },
  {
    id: "market-participants",
    category: "Foundations",
    color: "emerald",
    title: "Market Participants",
    emoji: "🏦",
    summary: "Multiple types of participants drive Forex price movement — from central banks and commercial banks down to retail traders like you. Understanding who moves the market helps you trade with the right context.",
    keyPoints: [
      "Central Banks: Set monetary policy, control interest rates — can move markets significantly",
      "Commercial Banks: Largest volume; execute trades for clients & themselves (interbank market)",
      "Hedge Funds & Investment Funds: Speculate with large capital; can create trends",
      "Multinational Corporations: Convert currencies for international business — predictable flows",
      "Retail Traders: Smallest portion of volume; trade via brokers using CFDs or spot Forex",
      "Market Makers (Brokers): Provide liquidity by offering bid/ask prices at all times",
    ],
    rules: [
      "Retail traders should trade WITH institutional flow, not against it",
      "News events = central bank actions — always be aware of the economic calendar",
      "High liquidity = tighter spreads = better fills for retail traders",
    ],
  },
  {
    id: "trading-edge",
    category: "Foundations",
    color: "emerald",
    title: "What is a Trading Edge?",
    emoji: "🎯",
    summary: "A trading edge is any technique, observation, or approach that gives you a statistical advantage over other market participants over hundreds of trades. Like a casino's house edge — it doesn't win every bet, but wins over time.",
    keyPoints: [
      "Edge = winning probability slightly better than 50/50 over a large sample of trades",
      "Casino analogy: European roulette gives casino a 51.35% edge vs player's 48.65% — the house always wins long-term",
      "In trading you DON'T need to win >50% of trades — your win rate × avg win must exceed loss rate × avg loss",
      "Edge comes from: key levels + candlestick patterns + market context + risk management combined",
      "A trading edge is only valid over hundreds of trades — judge it statistically, not trade-by-trade",
      "You must backtest your edge to verify it works before trading real capital",
    ],
    rules: [
      "Never judge your edge by a single trade outcome — only by statistics over 100+ trades",
      "Document every trade to measure your edge numerically",
      "A positive expected value strategy = (Win Rate × Avg Win) − (Loss Rate × Avg Loss) > 0",
    ],
    example: "If you win 40% of trades but make 3R when you win and lose 1R when you lose: Edge = (0.4 × 3) − (0.6 × 1) = 1.2 − 0.6 = 0.6R positive expectancy per trade.",
  },

  // ── MARKET STRUCTURE ──────────────────────────────────────
  {
    id: "market-trends",
    category: "Market Structure",
    color: "sky",
    title: "Market Trends",
    emoji: "📈",
    summary: "Price can move in 3 directions: up, down, or sideways. Identifying the correct trend is the first and most important step before executing any trade.",
    keyPoints: [
      "Uptrend: Series of Higher Highs (HH) and Higher Lows (HL) — bullish bias",
      "Downtrend: Series of Lower Highs (LH) and Lower Lows (LL) — bearish bias",
      "Sideways/Range: Price oscillates between a ceiling (resistance) and floor (support) — no clear trend",
      "Trends change when structure breaks: uptrend fails to make a new HH or breaks a HL",
      "Trading WITH the trend = higher probability setups (trend continuation)",
      "Trading AGAINST the trend = counter-trend/reversal = lower probability, needs stronger confirmation",
      "A strategy that works well in trending markets often struggles in ranging markets — know your environment",
    ],
    rules: [
      "Always identify the trend on your higher timeframe FIRST before looking for entries",
      "In an uptrend: look for acceptance of support & breaks of resistance",
      "In a downtrend: look for acceptance of resistance & breaks of support",
      "Assume the trend continues until clear evidence says otherwise",
    ],
    example: "EUR/USD on the 4H chart making HH and HL → bullish trend. Drop to 1H to find a buy setup at the next higher low / support zone.",
  },
  {
    id: "support-resistance",
    category: "Market Structure",
    color: "sky",
    title: "Support & Resistance",
    emoji: "📊",
    summary: "Support and resistance are horizontal price levels where the market has previously reversed or paused. They represent supply (resistance) and demand (support) zones that the market is likely to respect again.",
    keyPoints: [
      "Support = price level where buying interest historically emerged, stopping price from falling further",
      "Resistance = price level where selling interest historically emerged, stopping price from rising further",
      "The more times a level is tested, the stronger it becomes (and also the more likely to break eventually)",
      "Support can become resistance after a breakout (role reversal) — and vice versa",
      "Draw as ZONES (not exact lines) to account for wicks and slight price variations",
      "Key levels: swing highs, swing lows, round numbers (psychological levels), prior consolidation areas",
      "How to identify: identify swing highs/lows → draw short horizontal lines → extend to connect 2+ touches",
    ],
    rules: [
      "A level is valid when at least 2 significant price reactions have occurred at it",
      "Delete levels that have been clearly violated and not reacted to",
      "Support/resistance levels work on ALL timeframes — higher TF levels carry more weight",
      "Avoid drawing too many levels — focus on the most significant ones",
    ],
    example: "Price repeatedly bounces off 1.0800 on EUR/USD = strong support zone. Price violates it, pulls back to 1.0800, and now rejects from below = support has become resistance.",
  },
  {
    id: "trendlines",
    category: "Market Structure",
    color: "sky",
    title: "Trendlines",
    emoji: "📐",
    summary: "Trendlines are diagonal support (in uptrends) or resistance (in downtrends) lines drawn by connecting a series of swing lows or highs. They act as dynamic key levels.",
    keyPoints: [
      "Trendline = diagonal S/R — same concepts as horizontal S/R but angled",
      "Uptrend trendline: connect at least 2 swing lows → acts as SUPPORT → extended into future",
      "Downtrend trendline: connect at least 2 swing highs → acts as RESISTANCE → extended into future",
      "Rule: confirmed valid when price touches it a THIRD time",
      "Can be drawn using wicks, closing prices, or a combination of both",
      "Trendlines need ADJUSTMENT as new price data forms — do not force an old trendline on new data",
      "3 scenarios at a trendline: (1) Acceptance (bounce), (2) Break, (3) Retest after break",
      "Steep trendlines are less reliable than gradual ones — the shallower the angle, the more valid",
    ],
    rules: [
      "Do not force a trendline if the data points don't connect naturally",
      "A trendline break doesn't always mean a trend reversal — look for confirmation",
      "Adjust trendlines as price evolves rather than abandoning them entirely",
      "Trendlines work best when price approaches them in a gradual, orderly manner",
    ],
  },
  {
    id: "sr-scenarios",
    category: "Market Structure",
    color: "sky",
    title: "3 Trading Scenarios at S/R",
    emoji: "🎪",
    summary: "Every key level (horizontal S/R or trendline) presents 3 potential trading opportunities. Each has a different risk profile and timing.",
    keyPoints: [
      "Scenario 1 — ACCEPTANCE: Price reaches S/R zone and reverses. Enter in direction of rejection. Confirmation via candlestick pattern at the level.",
      "Scenario 2 — BREAKOUT: Price violates the S/R level with momentum. Enter in direction of break. Risk = fakeout. Volume confirms strength.",
      "Scenario 3 — RETEST: Price breaks S/R, continues, then pulls back to test the level from the other side. Previous resistance becomes support (and vice versa). Wait for acceptance candle at the retest level.",
      "Retest = lowest risk of the three (more confirmation) but may miss the initial move",
      "Breakout = fastest entry but highest fakeout risk",
      "Acceptance = most common — requires strong reversal candlestick at the zone",
      "Trend context determines which scenario to favor: uptrend → accept support + break resistance",
    ],
    rules: [
      "Always determine the trend first — it tells you which scenario to look for",
      "For breakouts: wait for a candle to CLOSE beyond the level, not just wick through it",
      "For retests: the retest candle must show clear rejection (pin bar or engulfing) at the old level",
      "Fakeouts are unavoidable — solid stop loss placement is your protection",
    ],
    example: "Uptrend. Price breaks above key resistance at 1.1000. Pulls back to 1.1000. Bullish engulfing candle forms as 1.1000 is now support → ENTER LONG with stop below 1.0980.",
  },

  // ── CANDLESTICK READING ───────────────────────────────────
  {
    id: "candlestick-basics",
    category: "Candlestick Reading",
    color: "amber",
    title: "Japanese Candlesticks Basics",
    emoji: "🕯️",
    summary: "Japanese candlesticks show four data points per timeframe: Open, High, Low, Close (OHLC). The body and wicks tell the story of the battle between buyers (bulls) and sellers (bears) during that period.",
    keyPoints: [
      "Body = difference between Open and Close price",
      "Bullish (green) candle: Close > Open — buyers won the period",
      "Bearish (red) candle: Close < Open — sellers won the period",
      "Upper wick = highest price reached during the period",
      "Lower wick = lowest price reached during the period",
      "Large body = strong directional momentum in that period",
      "Small body + long wicks = indecision / battle between bulls and bears",
      "No wick = price moved cleanly without being pushed back (strongest signal)",
    ],
    rules: [
      "Do not interpret every single candle — look for clusters and context",
      "Always read candles in context of: trend, key levels, and surrounding candles",
      "A single candle never gives the full picture — patterns of 2-3 candles are more meaningful",
    ],
  },
  {
    id: "candle-body-analysis",
    category: "Candlestick Reading",
    color: "amber",
    title: "Candlestick Body & Wick Analysis",
    emoji: "📏",
    summary: "The SIZE of the body tells you HOW STRONG the move was. The LENGTH of the wicks tells you HOW MUCH CONTEST there was. The POSITION of the body within the range tells you WHO WON.",
    keyPoints: [
      "LARGE body + small wicks = strong directional conviction, minimal contest",
      "SMALL body + large wicks = high contest, indecision — the fight is close",
      "LONG upper wick = bulls pushed high but bears rejected the move back down",
      "LONG lower wick = bears pushed low but bulls rejected the move back up",
      "Body in UPPER half of range = bullish strength despite any lower wick",
      "Body in LOWER half of range = bearish strength despite any upper wick",
      "Body in CENTER = balanced — indecision, neither side dominating",
      "Increasing body size in a trend = acceleration and momentum building",
      "Decreasing body size in a trend = momentum fading, possible reversal ahead",
    ],
    rules: [
      "Strong trend candle: large body, close near high (bull) or low (bear), tiny wicks",
      "Reversal signal: large wick in the direction of trend with close near opposite end",
      "Indecision: doji or spinning top — wait for next candle to confirm direction",
    ],
  },
  {
    id: "bullish-engulfing",
    category: "Candlestick Reading",
    color: "amber",
    title: "Bullish Engulfing Pattern",
    emoji: "🟢",
    summary: "One of the most reliable and common reversal patterns. A large bullish candle completely engulfs the body of the previous bearish candle, signaling a powerful shift from sellers to buyers.",
    keyPoints: [
      "2-candle pattern: Candle 1 = bearish | Candle 2 = bullish and engulfs Candle 1",
      "Occurs at the BOTTOM of a downtrend or at a support level",
      "Engulfing candle opens at or below the close of the previous candle",
      "Engulfing candle closes above the OPEN of the previous candle (real body engulf)",
      "Stronger version: engulfing candle closes above the TOTAL RANGE (high) of previous candle",
      "Quality: engulfing candle should close in top 1/3 or top 1/4 of its own range",
      "Size matters: a larger pattern relative to surrounding candles = stronger signal",
      "Confirmation is BUILT INTO the pattern (the engulfing candle IS the confirmation)",
    ],
    rules: [
      "Entry at Open: buy at open of candle AFTER the engulfing candle closes",
      "Entry at Break: place pending buy order 1 pip above the high of the engulfing candle",
      "Stop Loss: just below the TOTAL LOW of the entire 2-candle pattern",
      "Best used at a key support level, in a pullback within an uptrend, or at major S/R",
      "Context filter: ignore engulfing candles that appear mid-range with no key level nearby",
    ],
    example: "Price in downtrend hits support at 1.0800. Small bearish candle forms. Next candle opens below close and closes aggressively above the open of the previous bearish candle, engulfing it fully, and closes in top 25% of its range → strong buy signal.",
  },
  {
    id: "hammer",
    category: "Candlestick Reading",
    color: "amber",
    title: "Hammer (Bullish Pin Bar)",
    emoji: "🔨",
    summary: "The hammer is a single-candle reversal pattern with a long lower shadow and small body near the top. It signals that bears pushed price sharply down but bulls aggressively rejected the move and closed near the open.",
    keyPoints: [
      "1-candle pattern — requires CONFIRMATION from the following candle",
      "Body: small, located at the TOP of the candlestick range",
      "Lower shadow: at least 2× the size of the real body",
      "Upper shadow: none or very minimal (close to zero)",
      "Body can be green (stronger) or red (needs stronger confirmation)",
      "Occurs at the BOTTOM of a downtrend or at a support zone",
      "RED hammer: needs next candle to close BULLISH ABOVE the hammer body to be valid",
      "GREEN hammer: the hammer itself can self-confirm (body closes above previous candle's open)",
    ],
    rules: [
      "Never enter on the hammer candle itself — WAIT for confirmation close",
      "Entry at Open: buy at open of candle after confirmation closes bullishly",
      "Entry at Break: pending buy order 1 pip above the high of the confirmation candle",
      "Stop Loss: below the LOWER WICK of the hammer (with a small buffer)",
      "Larger hammer relative to surroundings = stronger reversal signal",
      "Best used at key support, psychological levels, or trendline bounces",
    ],
    example: "GBP/USD in downtrend. Price hits strong support at 1.2500. A candle forms with a tiny body near the top and a long lower shadow reaching 1.2430 (70 pips rejected). Next candle closes bullishly above the hammer body → confirmation → ENTER LONG.",
  },
  {
    id: "morning-star",
    category: "Candlestick Reading",
    color: "amber",
    title: "Morning Star",
    emoji: "⭐",
    summary: "The Morning Star is a powerful 3-candle bullish reversal pattern. It shows a decisive transition from bearish control to bullish control through a period of indecision in the middle.",
    keyPoints: [
      "3-candle pattern: Large bearish candle → Small indecision candle (Doji/Spinning Top) → Large bullish candle",
      "Candle 1: Large bearish candle — sellers in control",
      "Candle 2: Small body (Doji or small bullish/bearish candle) — indecision, neither side winning",
      "Candle 3: Large bullish candle closing above the MIDPOINT of Candle 1's real body",
      "The third candle is the confirmation — its body must reach at least 50% into Candle 1",
      "Occurs at the bottom of a downtrend",
      "The middle candle ideally gaps below Candle 1's close (more visible on daily charts)",
    ],
    rules: [
      "Entry: Buy at open of candle after Candle 3 closes (or at close of Candle 3)",
      "Stop Loss: Below the low of Candle 2 (the indecision candle)",
      "Stronger signal if it occurs at a key support level",
      "The larger Candle 3 relative to Candle 1, the more decisive the reversal",
    ],
  },
  {
    id: "bearish-engulfing",
    category: "Candlestick Reading",
    color: "amber",
    title: "Bearish Engulfing Pattern",
    emoji: "🔴",
    summary: "The mirror image of the Bullish Engulfing. A large bearish candle completely engulfs the previous bullish candle, signaling a powerful shift from buyers to sellers at a resistance zone.",
    keyPoints: [
      "2-candle pattern: Candle 1 = bullish | Candle 2 = bearish and engulfs Candle 1",
      "Occurs at the TOP of an uptrend or at a resistance level",
      "Bearish candle opens at or above the close of the previous candle",
      "Bearish candle closes below the OPEN of the previous candle (real body engulf)",
      "Stronger version: closes below the TOTAL RANGE (low) of the previous candle",
      "Quality: bearish candle should close in the bottom 1/3 or bottom 1/4 of its range",
      "The pattern itself is the confirmation — no additional candle needed",
    ],
    rules: [
      "Entry at Open: sell at open of candle AFTER the bearish engulfing candle closes",
      "Entry at Break: pending sell order 1 pip below the low of the engulfing candle",
      "Stop Loss: just above the TOTAL HIGH of the entire 2-candle pattern",
      "Best used at key resistance, in a pullback within a downtrend, or at major S/R",
    ],
    example: "Price rallies into a major resistance zone at 1.1200. A bullish candle forms. Next candle opens above the previous close and collapses, closing far below the open of the previous bullish candle → strong sell signal.",
  },
  {
    id: "shooting-star",
    category: "Candlestick Reading",
    color: "amber",
    title: "Shooting Star (Bearish Pin Bar)",
    emoji: "💫",
    summary: "The mirror image of the Hammer. A long upper shadow with a small body near the bottom signals that bulls pushed price up sharply, but bears aggressively rejected the move and closed near the open.",
    keyPoints: [
      "1-candle pattern — requires confirmation from the following candle",
      "Body: small, located at the BOTTOM of the candlestick range",
      "Upper shadow: at least 2× the size of the real body",
      "Lower shadow: none or very minimal",
      "Body can be red (stronger) or green (needs stronger confirmation)",
      "Occurs at the TOP of an uptrend or at a resistance zone",
      "RED shooting star: stronger signal — sellers dominated from open to close",
    ],
    rules: [
      "Wait for confirmation candle to close BEARISHLY below the shooting star body",
      "Entry at Open: sell at open of candle after bearish confirmation",
      "Entry at Break: pending sell order 1 pip below the low of the confirmation candle",
      "Stop Loss: above the UPPER WICK of the shooting star (with buffer)",
      "Best used at key resistance, psychological levels, or trendline rejections",
    ],
  },

  // ── TRADE EXECUTION ───────────────────────────────────────
  {
    id: "breakout-fakeout",
    category: "Trade Execution",
    color: "violet",
    title: "Breakout & Fakeout",
    emoji: "💥",
    summary: "A breakout occurs when price violates a key S/R level with conviction, suggesting the move will continue in the breakout direction. A fakeout is a false breakout where price reverses immediately after breaking the level.",
    keyPoints: [
      "Breakout: price closes BEYOND a key level (not just wicks through it)",
      "Valid breakout signals: strong momentum candle, high volume, wide spread from level",
      "Fakeout: price appears to break the level but reverses within 1-3 candles — trapping breakout traders",
      "Volume confirmation: high volume on breakout = more likely to be genuine",
      "Low volume breakout = higher fakeout risk",
      "Breakout traders risk being trapped in fakeouts — always use stop losses",
      "To avoid fakeouts: wait for candle CLOSE beyond level (not just wick), check volume",
      "Fakeouts are actually excellent trading opportunities for retest traders",
    ],
    rules: [
      "Never enter a breakout on a wick through the level — wait for CANDLE CLOSE",
      "Check volume: high volume breakout = more reliable",
      "Always have a stop loss — fakeouts WILL happen, it is unavoidable",
      "If you miss the initial breakout, wait for the retest instead",
    ],
    example: "EUR/USD repeatedly fails to break 1.1000 resistance. A strong bullish candle closes convincingly above 1.1000 on high volume → breakout entry. Stop loss below 1.0975. If price comes back to 1.1000 and holds → retest confirmation.",
  },
  {
    id: "retest-trading",
    category: "Trade Execution",
    color: "violet",
    title: "Retest Trading",
    emoji: "🔁",
    summary: "Retest trading is entering AFTER a breakout when price pulls back to test the broken level as new support or resistance. Lower risk than breakout entries — you get extra confirmation before entering.",
    keyPoints: [
      "After a bullish breakout: price pulls back to previous resistance → now support → enter long",
      "After a bearish breakout: price pulls back to previous support → now resistance → enter short",
      "The retest validates the role reversal of the level (S becomes R, or R becomes S)",
      "Wait for a reversal candlestick (hammer, engulfing) AT the retest level before entering",
      "Successful retest = the broken level holds on the pullback and price continues breakout direction",
      "Failed retest = price pushes through the broken level again (possible fakeout scenario)",
      "Retest trades: LOWER risk, MORE confirmation, but you may miss big moves if price doesn't pull back",
    ],
    rules: [
      "Do not enter at the broken level immediately — wait for a confirmation candle",
      "Stop loss below the retest level (for long) or above it (for short)",
      "Retest with a clear candlestick pattern = highest quality entry",
      "If price blasts through the retest level, the original breakout may have been a fakeout",
    ],
    example: "GBP/USD breaks below support at 1.2800. Price falls to 1.2720, then pulls back up to 1.2800. A bearish engulfing candle forms at 1.2800 (now resistance) → ENTER SHORT. Stop above 1.2825.",
  },
  {
    id: "entry-methods",
    category: "Trade Execution",
    color: "violet",
    title: "Entry Methods",
    emoji: "⏱️",
    summary: "Two primary entry techniques: Entry at Open (more immediate, lower R/R) and Entry at Break (higher confirmation, better R/R but requires monitoring or pending orders).",
    keyPoints: [
      "ENTRY AT OPEN: Buy/sell at the open of the candle immediately following your pattern's confirmation",
      "Entry at Open pros: immediate fill, no monitoring needed after placing order",
      "Entry at Open cons: slightly less confirmation, slightly worse price",
      "ENTRY AT BREAK: Place a pending order just above the high (long) or below the low (short) of the pattern",
      "Entry at Break pros: additional confirmation (price must prove itself), better R/R",
      "Entry at Break cons: requires monitoring or pending order setup; may not trigger if price reverses",
      "Market Order: executes immediately at current market price — for Entry at Open",
      "Limit/Stop Order: executes when price reaches a specific level — for Entry at Break",
    ],
    rules: [
      "For Entry at Break: place pending order 1 pip above the signal candle high (long) or 1 pip below the low (short)",
      "Always set stop loss and take profit BEFORE placing the entry order",
      "Entry at Open is simpler and preferred for beginners",
      "Entry at Break reduces fakeout risk but may miss some trades",
    ],
  },

  // ── RISK MANAGEMENT ──────────────────────────────────────
  {
    id: "risk-reward",
    category: "Risk Management",
    color: "rose",
    title: "Risk / Reward Ratio",
    emoji: "⚖️",
    summary: "The Risk/Reward ratio measures how much you stand to make vs. how much you risk on each trade. A positive R/R means you make more when you win than you lose when you lose — the cornerstone of profitable trading.",
    keyPoints: [
      "R/R = potential profit ÷ potential loss on a single trade",
      "Example: 1:2 R/R = risk 50 pips to potentially make 100 pips",
      "At 1:2 R/R, you only need a 34% win rate to break even",
      "At 1:3 R/R, you only need a 25% win rate to break even",
      "You do NOT need to win more than 50% of trades to be profitable with good R/R",
      "Minimum recommended R/R: 1:1.5 or 1:2 — avoid trades with R/R below 1:1",
      "R/R depends on your strategy — reversal setups can get higher R/R than continuation",
      "Use previous structure for stop loss & take profit levels rather than arbitrary pip amounts",
    ],
    rules: [
      "Only take trades with at least 1:1.5 R/R minimum (ideally 1:2 or better)",
      "Never move your stop loss to increase risk mid-trade (only move in your favor)",
      "Calculate R/R BEFORE entering any trade — if it doesn't meet your criteria, skip it",
      "Use the position size calculator to ensure your stop loss = your intended % risk",
    ],
    example: "Trade setup: Entry 1.0800, Stop Loss 1.0770 (30 pips risk), Take Profit 1.0860 (60 pips reward). R/R = 60/30 = 1:2. At 40% win rate: (0.4 × 60) − (0.6 × 30) = 24 − 18 = +6 pips per trade average.",
  },
  {
    id: "position-sizing",
    category: "Risk Management",
    color: "rose",
    title: "Position Sizing",
    emoji: "🎛️",
    summary: "Position sizing determines how many lots you trade so that a stop loss equals exactly your target % risk. This is non-negotiable — correct sizing protects your account from catastrophic losses.",
    keyPoints: [
      "General guideline: risk 0.5%–1% per trade for beginners; max 2%–3% for experienced traders",
      "Never risk more than 3% of account on a single trade",
      "Lot size is NOT fixed — it changes with every trade based on stop loss distance",
      "Formula: Lot Size = (Account × Risk%) ÷ (Stop Loss in pips × Pip value)",
      "Use a Position Size Calculator for every trade (myfxbook.com/forex-calculators/position-size)",
      "Example: $10,000 account, 1% risk = $100 max loss. 50-pip SL on EUR/USD → 0.2 lots",
      "Percentage-based risk grows your position during winning streaks and shrinks during losing streaks = compound effect",
      "Fixed dollar risk misses the compounding benefit and declines faster in drawdowns",
    ],
    rules: [
      "ALWAYS calculate position size before entering any trade — never guess",
      "Use percentage-based risk, not fixed dollar amounts",
      "Account for spread in your stop loss distance calculation",
      "The position size calculator must become a daily habit",
    ],
    example: "Account: $5,000. Risk: 1% = $50. Stop Loss: 40 pips on GBP/USD (pip value ≈ $1 per 0.01 lot = $10/lot). Lots = $50 ÷ (40 × $10) = $50 ÷ $400 = 0.125 lots ≈ 0.12 lots.",
  },
  {
    id: "drawdown",
    category: "Risk Management",
    color: "rose",
    title: "Drawdown Management",
    emoji: "📉",
    summary: "Drawdown is how far your account falls from its peak before recovering. Managing drawdowns is critical — the bigger the drawdown, the harder it is to recover. A 50% drawdown requires a 100% gain to break even.",
    keyPoints: [
      "Drawdown = (Peak balance − Current balance) ÷ Peak balance × 100%",
      "10% drawdown: needs 11.1% gain to recover",
      "25% drawdown: needs 33.3% gain to recover",
      "50% drawdown: needs 100% gain to recover — catastrophic",
      "Set a MAXIMUM DRAWDOWN limit based on your backtested strategy performance",
      "If max drawdown is hit: STOP trading, review strategy, identify what went wrong",
      "Daily/weekly loss limits prevent emotion-driven revenge trading",
      "Consecutive losing streaks are normal — even the best strategies face 5-10 loss streaks",
    ],
    rules: [
      "Define your max drawdown limit BEFORE you start live trading",
      "If daily loss limit is hit: stop for the day — come back tomorrow",
      "Never try to 'win it back' in the same session — this is revenge trading",
      "Track drawdown in your journal — if it exceeds backtested max, something changed",
    ],
  },
  {
    id: "risk-rules",
    category: "Risk Management",
    color: "rose",
    title: "Core Risk Rules",
    emoji: "🛡️",
    summary: "A complete set of risk management rules that must be embedded into your trading plan. These protect your account during losing streaks and preserve capital to keep you in the game.",
    keyPoints: [
      "Risk per trade: 0.5%–1% (beginners), max 2%–3% (experienced)",
      "Max open trades at once: e.g., 3 simultaneous positions = 3% total risk exposure",
      "Currency exposure limit: avoid multiple pairs with the same base currency (correlated risk)",
      "Maximum drawdown: derived from backtesting — if hit, stop and review",
      "Daily loss limit: stop trading for the day if X% is lost (prevents revenge trading)",
      "Never move SL in the wrong direction (to take more risk)",
      "Only move SL in your favor (to protect profits or break even)",
      "Protect profits with trailing stops or partial closes at 1:1 milestone",
    ],
    rules: [
      "Write ALL risk rules in your trading plan — they must be rules, not suggestions",
      "Following your risk rules is NOT optional — treat it like a professional obligation",
      "Losing streaks are normal — risk rules prevent them from ending your account",
      "Violating risk rules even once trains bad habits — hold the line",
    ],
  },

  // ── STRATEGY & PSYCHOLOGY ─────────────────────────────────
  {
    id: "backtesting",
    category: "Strategy & Psychology",
    color: "indigo",
    title: "Backtesting",
    emoji: "🔬",
    summary: "Backtesting is manually reviewing historical charts one candle at a time to test how your strategy would have performed in the past. It is one of the most underutilized and powerful tools in trading.",
    keyPoints: [
      "Purpose: prove your strategy works BEFORE risking real money",
      "Manual backtesting: rewind chart on TradingView/MetaTrader, play forward candle-by-candle, take every valid signal",
      "Target: 200–300+ trades minimum for statistically reliable results; 500–1,000 is ideal",
      "Track: P/L, win rate, max drawdown, open trades at once, R/R, entry times, currency pairs",
      "Backtesting also develops pattern recognition — hours on charts = massive skill acceleration",
      "Be HONEST: don't skip losing trades or invent reasons why a signal was 'not valid'",
      "Cheating in backtesting only hurts you in live trading",
      "Past performance does not guarantee future results — but it's the best tool available",
    ],
    rules: [
      "Record EVERY trade signal including losses — no cherry-picking",
      "Use a spreadsheet to log each trade: date, pair, direction, entry, SL, TP, result, notes",
      "Backtest across different market conditions: trending, ranging, high/low volatility",
      "Do not modify strategy rules DURING a backtest — adjust rules and re-test from scratch",
    ],
  },
  {
    id: "trading-plan",
    category: "Strategy & Psychology",
    color: "indigo",
    title: "The Trading Plan",
    emoji: "📋",
    summary: "A trading plan is the complete rulebook for your trading. It defines everything: what you trade, when you trade, how you enter and exit, and how you manage risk. Without a plan, you trade on emotion.",
    keyPoints: [
      "1. TRADING THESIS: What is the core reason you believe a trade opportunity exists? (trend + key level + pattern)",
      "2. MARKET SELECTION: Which pairs and timeframes does your strategy apply to?",
      "3. TIMEFRAME: Your analysis timeframe vs. your entry timeframe (top-down approach)",
      "4. INDICATORS: Which indicators (if any) do you use and what specific purpose do they serve?",
      "5. ENTRY: Exact conditions required to enter — be specific, nothing vague",
      "6. EXIT & TRADE MANAGEMENT: Fixed R/R or structure-based? Partial exits? Trailing stop?",
      "7. RISK: Risk per trade %, max open trades, max drawdown, daily loss limit, currency exposure limit",
      "8. OTHER RULES: News avoidance, trading hours, no-trading days, etc.",
    ],
    rules: [
      "Write your trading plan in full — it must be specific enough that another trader could follow it",
      "A plan is RULES, not guidelines — follow it without discretion unless you have a formal rule for discretion",
      "Review and update your plan after every 50–100 trades based on performance data",
      "If your plan says skip the trade — SKIP THE TRADE, no exceptions",
    ],
    example: "Bad plan: 'I'll buy when it looks like it's going up.' Good plan: '4H uptrend (HH/HL) confirmed. 1H price pulls back to previous resistance-turned-support. Bullish engulfing or hammer forms on 1H at that level. Entry at open of next candle. SL: 5 pips below pattern low. TP: next 4H resistance. Min R/R: 1:2. Risk: 1% per trade.'",
  },
  {
    id: "trading-psychology",
    category: "Strategy & Psychology",
    color: "indigo",
    title: "Trading Psychology",
    emoji: "🧠",
    summary: "Your biggest enemy in trading is yourself. Emotions — fear, greed, overconfidence, revenge — override your plan and destroy consistent profitability. Psychological discipline is a non-negotiable skill.",
    keyPoints: [
      "Revenge trading: taking impulsive trades after a loss to 'win it back' — breaks every rule, amplifies losses",
      "FOMO (Fear of Missing Out): chasing trades that have already moved — usually late entries with poor R/R",
      "Overconfidence: after a winning streak, risking more or breaking rules — wins are not skill guarantees",
      "Fear: avoiding valid trades after losses — leads to missed opportunities and inconsistency",
      "Tilt: emotional state where rational decision-making collapses — STOP trading immediately",
      "Discipline = following your rules when emotions say otherwise — this is what separates pros from amateurs",
      "Journaling: writing down emotions and thoughts after each trade builds self-awareness",
      "Process vs. outcome: a perfectly executed trade that loses is still a GOOD trade — judge the process",
    ],
    rules: [
      "If you feel emotional about a trade, do not take it — wait until you are calm",
      "After 2 consecutive losses: pause, review, breathe before the next trade",
      "Daily loss limit hit: close the platform — do not override this rule",
      "Never increase risk to recover losses — this is the fastest path to blowing an account",
      "Review your trade journal weekly to identify emotional patterns",
    ],
  },
];

/* ── Forex Blueprint helper components ── */
const BLUEPRINT_CATEGORY_COLORS: Record<string, string> = {
  Foundations: "emerald",
  "Market Structure": "sky",
  "Candlestick Reading": "amber",
  "Trade Execution": "violet",
  "Risk Management": "rose",
  "Strategy & Psychology": "indigo",
};
const BLUEPRINT_COLOR_MAP: Record<string, { bg: string; border: string; text: string; badge: string; dot: string; divider: string }> = {
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/25", text: "text-emerald-400", badge: "bg-emerald-500/20 text-emerald-300", dot: "bg-emerald-400", divider: "bg-emerald-500/20" },
  sky: { bg: "bg-sky-500/10", border: "border-sky-500/25", text: "text-sky-400", badge: "bg-sky-500/20 text-sky-300", dot: "bg-sky-400", divider: "bg-sky-500/20" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/25", text: "text-amber-400", badge: "bg-amber-500/20 text-amber-300", dot: "bg-amber-400", divider: "bg-amber-500/20" },
  violet: { bg: "bg-violet-500/10", border: "border-violet-500/25", text: "text-violet-400", badge: "bg-violet-500/20 text-violet-300", dot: "bg-violet-400", divider: "bg-violet-500/20" },
  rose: { bg: "bg-rose-500/10", border: "border-rose-500/25", text: "text-rose-400", badge: "bg-rose-500/20 text-rose-300", dot: "bg-rose-400", divider: "bg-rose-500/20" },
  indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/25", text: "text-indigo-400", badge: "bg-indigo-500/20 text-indigo-300", dot: "bg-indigo-400", divider: "bg-indigo-500/20" },
};

function BlueprintTopicCard({ topic }: { topic: typeof FOREX_BLUEPRINT_TOPICS[0] }) {
  const [open, setOpen] = useState(false);
  const c = BLUEPRINT_COLOR_MAP[topic.color] || BLUEPRINT_COLOR_MAP.amber;
  return (
    <div className={cx("rounded-xl border transition-all", c.border, open ? c.bg : "border-slate-800 bg-slate-900 hover:border-slate-700")}>
      <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left" onClick={() => setOpen(!open)}>
        <span className="text-xl shrink-0">{topic.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-100 text-sm leading-tight">{topic.title}</div>
          {!open && <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{topic.summary}</div>}
        </div>
        <span className={cx("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", c.badge)}>{topic.category}</span>
        <ChevronDown size={14} className={cx("text-slate-500 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-800/60 pt-3">
          <p className="text-sm text-slate-300 leading-relaxed">{topic.summary}</p>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Key Points</div>
            <ul className="space-y-1.5">
              {topic.keyPoints.map((pt, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-300 leading-relaxed">
                  <span className={cx("mt-1 w-1.5 h-1.5 rounded-full shrink-0", c.dot || "bg-amber-400")} />
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>
          {topic.rules && topic.rules.length > 0 && (
            <div className={cx("rounded-lg p-3 border", c.bg, c.border)}>
              <div className={cx("text-[10px] uppercase tracking-widest font-semibold mb-2", c.text)}>Trading Rules</div>
              <ul className="space-y-1.5">
                {topic.rules.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed">
                    <ShieldAlert size={11} className={cx("mt-0.5 shrink-0", c.text)} />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {topic.example && (
            <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5">Example</div>
              <p className="text-xs text-slate-400 italic leading-relaxed">{topic.example}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ForexBlueprintLibrary() {
  const [activeCategory, setActiveCategory] = useState("All");
  const categories = ["All", ...Array.from(new Set(FOREX_BLUEPRINT_TOPICS.map((t) => t.category)))];
  const filtered = activeCategory === "All" ? FOREX_BLUEPRINT_TOPICS : FOREX_BLUEPRINT_TOPICS.filter((t) => t.category === activeCategory);
  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-amber-500/10 to-yellow-600/5 border-amber-500/20">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📖</span>
          <div>
            <div className="font-bold text-slate-100 text-sm" style={{ fontFamily: "'Sora',sans-serif" }}>SRC Forex Blueprint</div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Complete reference guide: from Forex basics to advanced risk management. Based on the SRC Guide to Forex &amp; Technical Analysis. Tap any topic to expand.
            </p>
          </div>
        </div>
      </Card>
      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => {
          const color = BLUEPRINT_CATEGORY_COLORS[cat];
          const c = BLUEPRINT_COLOR_MAP[color || "amber"];
          return (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={cx("shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition",
                activeCategory === cat ? (c ? cx(c.bg, c.text, "border", c.border) : "bg-amber-500 text-slate-950") : "bg-slate-900 text-slate-400 border border-slate-800")}>
              {cat}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {filtered.map((topic) => <BlueprintTopicCard key={topic.id} topic={topic} />)}
      </div>
    </div>
  );
}

function ForexBlueprintAcademy() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const categories = ["All", ...Array.from(new Set(FOREX_BLUEPRINT_TOPICS.map((t) => t.category)))];
  const filtered = FOREX_BLUEPRINT_TOPICS.filter((t) => {
    const matchCat = activeCategory === "All" || t.category === activeCategory;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || t.title.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const byCat: Record<string, typeof FOREX_BLUEPRINT_TOPICS> = {};
  filtered.forEach((t) => { (byCat[t.category] = byCat[t.category] || []).push(t); });

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 bg-gradient-to-br from-slate-900 via-amber-950/20 to-slate-900 p-5">
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-8 translate-x-8" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <BookMarked size={16} className="text-amber-400" />
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-widest">Forex Blueprint</span>
          </div>
          <h2 className="text-lg font-bold text-slate-100" style={{ fontFamily: "'Sora',sans-serif" }}>A Guide Into The World of Forex & Technical Analysis</h2>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed max-w-sm">
            {FOREX_BLUEPRINT_TOPICS.length} topics across {categories.length - 1} categories — from market foundations through to risk management and psychology.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search topics…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
        />
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => {
          const color = BLUEPRINT_CATEGORY_COLORS[cat];
          const c = BLUEPRINT_COLOR_MAP[color || "amber"];
          return (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={cx("shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition",
                activeCategory === cat ? (c ? cx(c.bg, c.text, "border", c.border) : "bg-amber-500 text-slate-950") : "bg-slate-900 text-slate-400 border border-slate-800")}>
              {cat === "All" ? "All Topics" : cat}
            </button>
          );
        })}
      </div>

      {/* Topics grouped by category */}
      {Object.entries(byCat).length === 0 ? (
        <Card><p className="text-sm text-slate-500 text-center py-4">No topics match your search.</p></Card>
      ) : activeCategory === "All" ? (
        Object.entries(byCat).map(([cat, topics]) => {
          const color = BLUEPRINT_CATEGORY_COLORS[cat];
          const c = BLUEPRINT_COLOR_MAP[color || "amber"];
          return (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-2 pt-1">
                <div className={cx("h-px flex-1", c?.divider || "bg-amber-500/20")} />
                <span className={cx("text-[10px] uppercase tracking-widest font-bold px-2", c?.text || "text-amber-400")}>{cat}</span>
                <div className={cx("h-px flex-1", c?.divider || "bg-amber-500/20")} />
              </div>
              {topics.map((topic) => <BlueprintTopicCard key={topic.id} topic={topic} />)}
            </div>
          );
        })
      ) : (
        <div className="space-y-2">
          {filtered.map((topic) => <BlueprintTopicCard key={topic.id} topic={topic} />)}
        </div>
      )}
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
        {["Setups", "Strategies", "Forex Blueprint"].map((s) => (
          <button key={s} onClick={() => setSubTab(s)}
            className={cx("flex-1 py-2 rounded-lg text-xs font-medium transition", subTab === s ? "bg-amber-500 text-slate-950" : "text-slate-400")}>
            {s}
          </button>
        ))}
      </div>
      {subTab === "Setups" ? <SetupsPanel data={data} setData={setData} goTo={goTo} />
        : subTab === "Strategies" ? <StrategiesPanel data={data} setData={setData} goTo={goTo} />
        : <ForexBlueprintLibrary />}
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
/* ============================================================
   ACADEMY — PLAYBOOK TAB
   ============================================================ */
function SetupDetailModal({ setup, onClose }: { setup: any; onClose: () => void }) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const photos: any[] = setup.photos || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <span className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora',sans-serif" }}>{setup.name}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Hero image */}
          {setup.image && (
            <img src={setup.image} alt={setup.name} className="w-full max-h-56 object-contain bg-slate-950 rounded-xl border border-slate-800" />
          )}

          {/* Photo gallery */}
          {photos.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Chart Screenshots ({photos.length})</div>
              <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
                <img src={photos[photoIdx].url} alt={photos[photoIdx].caption || "Chart"} className="w-full max-h-52 object-contain" />
                {photos[photoIdx].caption && (
                  <div className="px-3 py-1.5 bg-slate-900 text-xs text-slate-400">{photos[photoIdx].caption}</div>
                )}
                {photos.length > 1 && (
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-t border-slate-800">
                    <button onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                      className="text-xs text-slate-400 hover:text-amber-400 px-2 py-1 rounded-lg bg-slate-800">◀</button>
                    <span className="text-[11px] text-slate-500">{photoIdx + 1} / {photos.length}</span>
                    <button onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                      className="text-xs text-slate-400 hover:text-amber-400 px-2 py-1 rounded-lg bg-slate-800">▶</button>
                  </div>
                )}
              </div>
              {photos.length > 1 && (
                <div className="flex gap-1.5 mt-1.5 overflow-x-auto pb-1">
                  {photos.map((ph, i) => (
                    <button key={ph.id} onClick={() => setPhotoIdx(i)}
                      className={cx("shrink-0 w-14 h-10 rounded-lg overflow-hidden border-2 transition",
                        i === photoIdx ? "border-amber-500" : "border-slate-800")}>
                      <img src={ph.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            {(setup.tags || []).map((t: string) => <Pill key={t} tone="sky">{t}</Pill>)}
            {setup.marketBias && <Pill tone={setup.marketBias === "Bullish" ? "emerald" : setup.marketBias === "Bearish" ? "rose" : "slate"}>{setup.marketBias}</Pill>}
            {setup.setupType && <Pill tone="amber">{setup.setupType}</Pill>}
            {setup.exception && <Pill tone="rose">Exception</Pill>}
          </div>

          {/* Fields */}
          {setup.trend && <div><span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Market Context</span><p className="text-sm text-slate-300 mt-1">{setup.trend}</p></div>}
          {setup.entry && <div><span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Entry</span><p className="text-sm text-slate-300 mt-1">{setup.entry}</p></div>}
          {setup.stop && <div><span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Stop Loss</span><p className="text-sm text-slate-300 mt-1">{setup.stop}</p></div>}
          {setup.target && <div><span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Take Profit</span><p className="text-sm text-slate-300 mt-1">{setup.target}</p></div>}
          {setup.midTrade && <div><span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Mid-Trade Rule</span><p className="text-sm text-slate-300 mt-1">{setup.midTrade}</p></div>}

          {/* Checklist */}
          {(setup.checklist || []).length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Checklist</div>
              <ul className="space-y-1">
                {setup.checklist.map((c: any) => (
                  <li key={c.id} className="flex gap-2 text-sm text-slate-400">
                    <CheckCircle2 size={14} className="text-amber-500/70 mt-0.5 shrink-0" />{c.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {setup.notes && <div><span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Notes</span><p className="text-sm text-slate-400 italic mt-1">{setup.notes}</p></div>}
        </div>
      </div>
    </div>
  );
}

function PlaybookAcademy({ data, goTo }: { data: any; goTo?: (tab: string, sub?: string) => void }) {
  const [selected, setSelected] = useState<any>(null);
  const setups: any[] = data.setups || [];

  if (setups.length === 0) {
    return (
      <div className="flex flex-col items-center py-14 gap-3">
        <BookMarked size={32} className="text-slate-700" />
        <p className="text-slate-500 text-sm">No setups yet</p>
        <p className="text-slate-600 text-xs text-center px-6">Create setups in Library → Setup Library to see your playbook here with photos.</p>
      </div>
    );
  }

  const hasNoPhotos = setups.every((s) => !(s.photos || []).length && !s.image);

  return (
    <div className="space-y-3">
      {hasNoPhotos && (
        <div className="rounded-xl bg-sky-500/8 border border-sky-500/20 px-3 py-2.5 flex items-start gap-2.5">
          <ImageIcon size={14} className="text-sky-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-sky-300 font-medium">No chart photos yet</p>
            <p className="text-[11px] text-sky-400/70 mt-0.5">To add photos: go to <strong>Library → Setup Library</strong>, tap a setup, press <strong>Edit</strong>, and upload screenshots at the top of the form.</p>
          </div>
          {goTo && (
            <button onClick={() => goTo("library", "Setups")}
              className="shrink-0 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
              Go →
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">Tap a setup to view full details and all chart screenshots.</p>
      <div className="grid grid-cols-2 gap-2.5">
        {setups.map((s) => {
          const thumb = (s.photos || [])[0]?.url || s.image || null;
          const photoCount = (s.photos || []).length;
          return (
            <button key={s.id} onClick={() => setSelected(s)}
              className="text-left rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden hover:border-amber-500/40 transition group">
              {thumb ? (
                <img src={thumb} alt={s.name} className="w-full h-24 object-cover bg-slate-950 group-hover:opacity-90 transition" />
              ) : (
                <div className="w-full h-24 bg-slate-950 flex flex-col items-center justify-center gap-1">
                  <ImageIcon size={18} className="text-slate-700" />
                  <span className="text-[10px] text-slate-700">No photo</span>
                </div>
              )}
              <div className="p-2.5">
                <div className="text-xs font-semibold text-slate-200 truncate mb-1">{s.name}</div>
                <div className="flex flex-wrap gap-1">
                  {s.setupType && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">{s.setupType}</span>}
                  {s.marketBias && <span className={cx("text-[10px] px-1.5 py-0.5 rounded-md border",
                    s.marketBias === "Bullish" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : s.marketBias === "Bearish" ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      : "bg-slate-800 text-slate-500 border-slate-700")}>{s.marketBias}</span>}
                  {photoCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center gap-0.5">
                      <ImageIcon size={9} />{photoCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {selected && <SetupDetailModal setup={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AcademyTab({ data, setData, subTab, setSubTab, goTo }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
        {["Price Action", "Smart Money", "Playbook", "Forex Blueprint"].map((s) => (
          <button key={s} onClick={() => setSubTab(s)}
            className={cx("flex-1 py-2 rounded-lg text-[10px] font-medium transition leading-tight", subTab === s ? "bg-amber-500 text-slate-950" : "text-slate-400")}>
            {s}
          </button>
        ))}
      </div>
      {subTab !== "Forex Blueprint" && (
        <SectionTitle sub={
          subTab === "Price Action" ? "The full SRC reference guide"
            : subTab === "Smart Money" ? "Order-flow terminology & your notes"
            : "Your named setups with photos"
        }>
          {subTab === "Price Action" ? "Price Action Academy" : subTab === "Smart Money" ? "Smart Money Concepts" : "Playbook"}
        </SectionTitle>
      )}
      {subTab === "Price Action" ? <PriceActionAcademy />
        : subTab === "Smart Money" ? <SmartMoneyAcademy data={data} setData={setData} />
        : subTab === "Playbook" ? <PlaybookAcademy data={data} goTo={goTo} />
        : <ForexBlueprintAcademy />}
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
  const save = () => { if (!(form.name || "").trim()) return; onSave({ ...form, id: form.id || uid() }); };

  const crumbs = [
    { label: "Dashboard", onClick: () => goTo("home") },
    { label: "More", onClick: () => goTo("more", "Plans") },
    { label: "Trading Plans", onClick: () => goTo("more", "Plans") },
    { label: initial ? "Edit Plan" : "New Plan" },
  ];

  return (
    <FullPageShell crumbs={crumbs} onBack={onBack} onClose={() => goTo("home")} onSave={save} saveLabel={initial ? "Save" : "Create"} saveDisabled={!(form.name || "").trim()} goTo={goTo}>
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
        preSession: parsed.preSession || [],
        account: parsed.account || { startingBalance: 1000, currency: "€" },
        tradingAccounts: parsed.tradingAccounts || [],
        propChallenges: parsed.propChallenges || [],
        sessionPlans: parsed.sessionPlans || [],
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
/* ============================================================
   ECONOMIC CALENDAR (Forex Factory proxy)
   ============================================================ */
const IMPACT_CFG: Record<string, { label: string; dot: string; badge: string; text: string; order: number }> = {
  High:   { label: "High",   dot: "bg-rose-500",   badge: "bg-rose-500/10 border-rose-500/30",   text: "text-rose-400",   order: 0 },
  Medium: { label: "Med",    dot: "bg-amber-500",  badge: "bg-amber-500/10 border-amber-500/25",  text: "text-amber-400",  order: 1 },
  Low:    { label: "Low",    dot: "bg-slate-500",  badge: "bg-slate-800 border-slate-700",         text: "text-slate-500",  order: 2 },
};

const CURRENCY_FLAGS: Record<string, string> = {
  USD:"🇺🇸", EUR:"🇪🇺", GBP:"🇬🇧", JPY:"🇯🇵", CAD:"🇨🇦",
  AUD:"🇦🇺", NZD:"🇳🇿", CHF:"🇨🇭", CNY:"🇨🇳", ALL:"🌍",
};

function parseEventDate(dateStr: string): Date {
  return new Date(dateStr);
}

function formatEventTime(dateStr: string, timeStr: string): string {
  if (!timeStr || timeStr === "Tentative" || timeStr === "All Day") return timeStr || "";
  try {
    const d = parseEventDate(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return timeStr; }
}

function useEconomicCalendar() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setEvents(json.events || []);
      setLastFetch(json.cachedAt || Date.now());
    } catch {
      setError("Unable to load calendar. Check your connection.");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  return { events, loading, error, reload: load, lastFetch };
}

function EconomicCalendarWidget() {
  const { events, loading, error, reload, lastFetch } = useEconomicCalendar();
  const [expanded, setExpanded] = useState(false);
  const [impactFilter, setImpactFilter] = useState<string>("High");
  const [currFilter, setCurrFilter] = useState<string>("All");

  const todayStr = todayISO();

  const filtered = useMemo(() => {
    return events.filter((e: any) => {
      const eDate = e.date ? e.date.slice(0, 10) : "";
      if (impactFilter !== "All" && e.impact !== impactFilter) return false;
      if (currFilter !== "All" && e.country !== currFilter) return false;
      return true;
    });
  }, [events, impactFilter, currFilter]);

  const todayEvents = useMemo(() =>
    filtered.filter((e: any) => e.date && e.date.slice(0, 10) === todayStr),
    [filtered, todayStr]);

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    filtered.forEach((e: any) => {
      const d = e.date ? e.date.slice(0, 10) : "Unknown";
      if (!map[d]) map[d] = [];
      map[d].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const allCurrencies = useMemo(() => {
    const s = new Set(events.map((e: any) => e.country).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [events]);

  const EventRow = ({ e }: { e: any }) => {
    const cfg = IMPACT_CFG[e.impact] || IMPACT_CFG.Low;
    const flag = CURRENCY_FLAGS[e.country] || "🌍";
    const time = formatEventTime(e.date, e.time);
    return (
      <div className="flex items-start gap-2.5 py-2 border-b border-slate-800/60 last:border-0">
        <div className="flex items-center gap-1.5 w-14 shrink-0">
          <div className={cx("w-2 h-2 rounded-full shrink-0 mt-0.5", cfg.dot)} />
          <span className="text-[10px] text-slate-500 font-medium">{time || "—"}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-300 leading-snug">{e.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-slate-500">{flag} {e.country}</span>
            <span className={cx("px-1.5 py-px rounded border text-[9px] font-bold", cfg.badge, cfg.text)}>{cfg.label}</span>
            {e.forecast && <span className="text-[10px] text-slate-500">F: <span className="text-slate-300">{e.forecast}</span></span>}
            {e.previous && <span className="text-[10px] text-slate-500">P: <span className="text-slate-400">{e.previous}</span></span>}
            {e.actual  && <span className="text-[10px] text-slate-500">A: <span className={cx("font-semibold", e.actual.startsWith("-") ? "text-rose-400" : "text-emerald-400")}>{e.actual}</span></span>}
          </div>
        </div>
      </div>
    );
  };

  const formatDayLabel = (dateStr: string) => {
    if (dateStr === todayStr) return "Today";
    const d = new Date(dateStr + "T12:00:00");
    const diff = Math.round((d.getTime() - new Date(todayStr + "T12:00:00").getTime()) / 86400000);
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <button onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-900/40 transition">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-amber-400" />
          <span className="text-sm font-semibold text-slate-200" style={{ fontFamily: "'Sora', sans-serif" }}>Economic Calendar</span>
          {todayEvents.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-lg bg-rose-500/15 border border-rose-500/25 text-rose-400 text-[9px] font-bold">
              {todayEvents.length} today
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastFetch && !expanded && (
            <span className="text-[10px] text-slate-600">
              {new Date(lastFetch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        </div>
      </button>

      {/* Collapsed: show today's high-impact events */}
      {!expanded && !loading && !error && todayEvents.length > 0 && (
        <div className="px-4 pb-3">
          {todayEvents.slice(0, 3).map((e: any, i: number) => {
            const cfg = IMPACT_CFG[e.impact] || IMPACT_CFG.Low;
            const flag = CURRENCY_FLAGS[e.country] || "🌍";
            return (
              <div key={i} className="flex items-center gap-2 py-1.5 border-b border-slate-800/40 last:border-0">
                <div className={cx("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
                <span className="text-[10px] text-slate-500 w-10 shrink-0">{e.time || "—"}</span>
                <span className="text-[10px] text-slate-400 truncate flex-1">{flag} {e.title}</span>
                <span className={cx("text-[9px] font-bold", cfg.text)}>{cfg.label}</span>
              </div>
            );
          })}
          {todayEvents.length > 3 && (
            <button onClick={() => setExpanded(true)} className="text-[10px] text-amber-400 mt-1.5">
              +{todayEvents.length - 3} more today →
            </button>
          )}
        </div>
      )}
      {!expanded && !loading && !error && todayEvents.length === 0 && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-slate-600">No {impactFilter === "All" ? "" : impactFilter.toLowerCase() + "-impact "}events today.</p>
        </div>
      )}
      {!expanded && loading && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-slate-600 animate-pulse">Loading calendar…</p>
        </div>
      )}
      {!expanded && error && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-rose-400">{error}</p>
        </div>
      )}

      {/* Expanded full view */}
      {expanded && (
        <div className="border-t border-slate-800">
          {/* Filters */}
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide shrink-0">Impact:</span>
              {["High", "Medium", "Low", "All"].map((imp) => (
                <button key={imp} onClick={() => setImpactFilter(imp)}
                  className={cx("px-2.5 py-1 rounded-lg border text-[10px] font-medium transition",
                    impactFilter === imp
                      ? "bg-amber-500 border-amber-500 text-slate-950"
                      : "bg-slate-900 border-slate-800 text-slate-500")}>
                  {imp}
                </button>
              ))}
              <button onClick={reload}
                className="ml-auto p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 hover:text-amber-400">
                <RotateCcw size={12} />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide shrink-0">Currency:</span>
              {["All", "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF"].map((c) => (
                <button key={c} onClick={() => setCurrFilter(c)}
                  className={cx("px-2 py-1 rounded-lg border text-[10px] font-medium transition",
                    currFilter === c
                      ? "bg-amber-500 border-amber-500 text-slate-950"
                      : "bg-slate-900 border-slate-800 text-slate-500")}>
                  {CURRENCY_FLAGS[c] || ""} {c}
                </button>
              ))}
            </div>
          </div>

          {/* Events list */}
          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-center text-slate-600 text-sm animate-pulse">Loading calendar data…</div>
            ) : error ? (
              <div className="px-4 py-6 text-center">
                <p className="text-rose-400 text-sm mb-3">{error}</p>
                <button onClick={reload} className="px-4 py-2 bg-amber-500 text-slate-950 rounded-xl text-sm font-bold">Retry</button>
              </div>
            ) : grouped.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-600 text-sm">No events match the current filters.</div>
            ) : (
              grouped.map(([date, dayEvents]) => (
                <div key={date} className={cx("px-4", date === todayStr ? "bg-amber-500/3" : "")}>
                  <div className={cx("flex items-center gap-2 py-2 border-b border-slate-800 sticky top-0",
                    date === todayStr ? "bg-slate-950" : "bg-slate-950")}>
                    <div className={cx("text-[10px] font-bold uppercase tracking-wider",
                      date === todayStr ? "text-amber-400" : date < todayStr ? "text-slate-600" : "text-slate-400")}>
                      {formatDayLabel(date)}
                    </div>
                    {date === todayStr && (
                      <span className="px-1.5 py-px rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[8px] font-bold">TODAY</span>
                    )}
                    <span className="text-[10px] text-slate-700 ml-auto">{dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}</span>
                  </div>
                  {dayEvents.map((e: any, i: number) => <EventRow key={i} e={e} />)}
                </div>
              ))
            )}
          </div>

          {lastFetch && (
            <div className="px-4 py-2 border-t border-slate-800">
              <p className="text-[9px] text-slate-700">Data from Forex Factory · Last updated {new Date(lastFetch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Refreshes every 30 min</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PROP FIRM CHALLENGE TRACKER
   ============================================================ */
const PROP_FIRM_PRESETS: Record<string, any> = {
  "FTMO":             { profitTargetPct:"10", maxDailyLossPct:"5",  maxTotalDrawdownPct:"10", minTradingDays:"4",  maxCalendarDays:"30", drawdownType:"initial"  },
  "The5ers":          { profitTargetPct:"8",  maxDailyLossPct:"4",  maxTotalDrawdownPct:"8",  minTradingDays:"0",  maxCalendarDays:"0",  drawdownType:"initial"  },
  "MyForexFunds":     { profitTargetPct:"8",  maxDailyLossPct:"5",  maxTotalDrawdownPct:"12", minTradingDays:"0",  maxCalendarDays:"0",  drawdownType:"trailing" },
  "FundedNext":       { profitTargetPct:"10", maxDailyLossPct:"5",  maxTotalDrawdownPct:"10", minTradingDays:"4",  maxCalendarDays:"30", drawdownType:"trailing" },
  "True Forex Funds": { profitTargetPct:"10", maxDailyLossPct:"5",  maxTotalDrawdownPct:"10", minTradingDays:"0",  maxCalendarDays:"30", drawdownType:"initial"  },
  "Apex":             { profitTargetPct:"9",  maxDailyLossPct:"3",  maxTotalDrawdownPct:"6",  minTradingDays:"0",  maxCalendarDays:"0",  drawdownType:"initial"  },
  "E8 Markets":       { profitTargetPct:"8",  maxDailyLossPct:"5",  maxTotalDrawdownPct:"8",  minTradingDays:"0",  maxCalendarDays:"0",  drawdownType:"initial"  },
  "Goatfunded":       { profitTargetPct:"10", maxDailyLossPct:"5",  maxTotalDrawdownPct:"10", minTradingDays:"0",  maxCalendarDays:"0",  drawdownType:"trailing" },
  "Custom":           {},
};

function emptyChallenge() {
  return {
    id: null, name: "", firm: "FTMO", phase: "Evaluation",
    accountSize: "100000", currency: "USD", accountId: "",
    profitTargetPct: "10", maxDailyLossPct: "5", maxTotalDrawdownPct: "10",
    drawdownType: "initial", minTradingDays: "4", maxCalendarDays: "30",
    startDate: todayISO(), status: "active", notes: "",
    customRules: [], dailyLog: [],
  };
}

function computePropChallenge(c: any) {
  const accountSize        = parseFloat(c.accountSize)        || 100000;
  const profitTargetPct    = parseFloat(c.profitTargetPct)    || 10;
  const maxDailyLossPct    = parseFloat(c.maxDailyLossPct)    || 5;
  const maxTotalDrawdownPct= parseFloat(c.maxTotalDrawdownPct)|| 10;
  const minTradingDays     = parseInt(c.minTradingDays)       || 0;
  const maxCalendarDays    = parseInt(c.maxCalendarDays)      || 0;

  const log = [...(c.dailyLog || [])].sort((a: any, b: any) => a.date.localeCompare(b.date));
  const lastEntry     = log[log.length - 1];
  const currentBalance = lastEntry ? (parseFloat(lastEntry.balance) || accountSize) : accountSize;
  const totalPnl       = currentBalance - accountSize;
  const totalPnlPct    = (totalPnl / accountSize) * 100;
  const profitTargetAmt= accountSize * profitTargetPct / 100;
  const profitProgress = profitTargetAmt > 0 ? Math.min(100, Math.max(0, (totalPnl / profitTargetAmt) * 100)) : 0;
  const profitTargetMet= totalPnl >= profitTargetAmt;

  // Daily loss — compare last two log entries
  let todayLossPct = 0, todayLoss = 0;
  if (log.length >= 2) {
    const diff = (parseFloat((log[log.length-1] as any).balance)||0) - (parseFloat((log[log.length-2] as any).balance)||0);
    todayLoss    = Math.max(0, -diff);
    todayLossPct = accountSize > 0 ? (todayLoss / accountSize) * 100 : 0;
  }
  const maxDailyLossAmt  = accountSize * maxDailyLossPct / 100;
  const dailyLossProgress= maxDailyLossPct > 0 ? Math.min(100, (todayLossPct / maxDailyLossPct) * 100) : 0;
  const dailyLossViolated= todayLossPct > maxDailyLossPct;

  // Total drawdown
  const maxTotalDrawdownAmt = accountSize * maxTotalDrawdownPct / 100;
  let currentDrawdown = 0;
  if (c.drawdownType === "trailing") {
    const balances = log.map((e: any) => parseFloat(e.balance) || accountSize);
    let peak = accountSize;
    balances.forEach((b: number) => { if (b > peak) peak = b; });
    currentDrawdown = Math.max(0, peak - currentBalance);
  } else {
    currentDrawdown = Math.max(0, accountSize - currentBalance);
  }
  const currentDrawdownPct    = accountSize > 0 ? (currentDrawdown / accountSize) * 100 : 0;
  const totalDrawdownProgress = maxTotalDrawdownPct > 0 ? Math.min(100, (currentDrawdownPct / maxTotalDrawdownPct) * 100) : 0;
  const totalDrawdownViolated = currentDrawdownPct > maxTotalDrawdownPct;

  // Trading days
  const daysTraded         = log.length;
  const minDaysMet         = minTradingDays === 0 || daysTraded >= minTradingDays;
  const tradingDaysProgress= minTradingDays > 0 ? Math.min(100, (daysTraded / minTradingDays) * 100) : 100;

  // Calendar / deadline
  const todayStr    = todayISO();
  const startDate   = c.startDate || todayStr;
  const daysElapsed = Math.max(0, Math.floor((new Date(todayStr).getTime() - new Date(startDate).getTime()) / 86400000));
  const daysRemaining = maxCalendarDays > 0 ? Math.max(0, maxCalendarDays - daysElapsed) : null;
  const deadlineProgress= maxCalendarDays > 0 ? Math.min(100, (daysElapsed / maxCalendarDays) * 100) : 0;
  const deadlineViolated= maxCalendarDays > 0 && daysElapsed >= maxCalendarDays && !profitTargetMet;

  const hasFailed  = c.status === "failed" || dailyLossViolated || totalDrawdownViolated || deadlineViolated;
  const hasPassed  = c.status === "passed" || (profitTargetMet && minDaysMet && !hasFailed);
  const hasWarning = !hasFailed && !hasPassed && (dailyLossProgress >= 75 || totalDrawdownProgress >= 75 || (daysRemaining !== null && daysRemaining <= 5));

  // Win days = days where balance improved vs previous day
  let winDays = 0;
  for (let i = 1; i < log.length; i++) {
    if ((parseFloat((log[i] as any).balance)||0) > (parseFloat((log[i-1] as any).balance)||0)) winDays++;
  }

  return {
    accountSize, profitTargetPct, maxDailyLossPct, maxTotalDrawdownPct,
    minTradingDays, maxCalendarDays, currentBalance, totalPnl, totalPnlPct,
    profitTargetAmt, profitProgress, profitTargetMet,
    todayLoss, todayLossPct, maxDailyLossAmt, dailyLossProgress, dailyLossViolated,
    currentDrawdown, currentDrawdownPct, maxTotalDrawdownAmt, totalDrawdownProgress, totalDrawdownViolated,
    daysTraded, minDaysMet, tradingDaysProgress,
    daysElapsed, daysRemaining, deadlineProgress, deadlineViolated,
    hasFailed, hasPassed, hasWarning, winDays, log,
  };
}

/* ── Prop Challenge Form ── */
function PropChallengeForm({ initial, onSave, onBack, tradingAccounts = [] }: any) {
  const [form, setForm] = useState(() => initial ? { ...initial } : emptyChallenge());
  const [newRule, setNewRule] = useState("");
  const set = (k: string) => (v: any) => setForm((f: any) => ({ ...f, [k]: v && typeof v === "object" && "target" in v ? v.target.value : v }));

  const applyPreset = (firm: string) => {
    const preset = PROP_FIRM_PRESETS[firm] || {};
    setForm((f: any) => ({
      ...f, firm, ...preset,
      name: firm !== "Custom" ? `${firm} ${f.phase || "Evaluation"}` : f.name,
    }));
  };

  const addRule = () => {
    const r = newRule.trim();
    if (!r) return;
    setForm((f: any) => ({ ...f, customRules: [...(f.customRules || []), r] }));
    setNewRule("");
  };
  const removeRule = (i: number) =>
    setForm((f: any) => ({ ...f, customRules: f.customRules.filter((_: any, idx: number) => idx !== i) }));

  const COMMON_RULES = [
    "No news trading", "No weekend holds", "Max 3 trades/day",
    "Only trade London/NY session", "No averaging down", "Minimum 1:2 R:R",
    "No overlapping positions", "Stop after 2 consecutive losses",
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400">
          <ArrowLeft size={16} />
        </button>
        <h2 className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>
          {initial?.id ? "Edit Challenge" : "New Challenge"}
        </h2>
      </div>

      {/* Firm selector with presets */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Prop Firm</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.keys(PROP_FIRM_PRESETS).map((firm) => (
            <button key={firm} onClick={() => applyPreset(firm)}
              className={cx("px-3 py-1.5 rounded-xl border text-xs font-medium transition",
                form.firm === firm
                  ? "bg-amber-500 border-amber-500 text-slate-950"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600")}>
              {firm}
            </button>
          ))}
        </div>
        {form.firm === "Custom" && (
          <TextInput value={form.name} onChange={set("name")} placeholder="Custom firm name" />
        )}
      </div>

      {/* Challenge name */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Challenge Name</div>
        <TextInput value={form.name} onChange={set("name")} placeholder="e.g. FTMO $100k Phase 1" />
      </div>

      {/* Phase + Currency */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Phase</div>
          <select value={form.phase} onChange={(e) => set("phase")(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500/50">
            {["Evaluation","Verification","Funded"].map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Currency</div>
          <select value={form.currency} onChange={(e) => set("currency")(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500/50">
            {["USD","EUR","GBP","CAD","AUD"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Account size + start date */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account Size"><TextInput value={form.accountSize} onChange={set("accountSize")} placeholder="100000" /></Field>
        <Field label="Start Date"><TextInput type="date" value={form.startDate} onChange={set("startDate")} /></Field>
      </div>

      {/* Trading account link */}
      {(tradingAccounts as any[]).length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Broker Account</div>
          <select value={form.accountId || ""} onChange={(e) => set("accountId")(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500/50">
            <option value="">— No account selected —</option>
            {(tradingAccounts as any[]).map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber}{a.alias ? ` · ${a.alias}` : ""} ({a.platform} · {a.accountType})
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-600 mt-1">Link this challenge to a specific broker account number</p>
        </div>
      )}

      {/* Targets */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Rules & Limits</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Profit Target %"><TextInput value={form.profitTargetPct} onChange={set("profitTargetPct")} placeholder="10" /></Field>
          <Field label="Max Daily Loss %"><TextInput value={form.maxDailyLossPct} onChange={set("maxDailyLossPct")} placeholder="5" /></Field>
          <Field label="Max Total Drawdown %"><TextInput value={form.maxTotalDrawdownPct} onChange={set("maxTotalDrawdownPct")} placeholder="10" /></Field>
          <Field label="Min Trading Days"><TextInput value={form.minTradingDays} onChange={set("minTradingDays")} placeholder="4" /></Field>
          <Field label="Max Calendar Days (0=none)"><TextInput value={form.maxCalendarDays} onChange={set("maxCalendarDays")} placeholder="30" /></Field>
        </div>
      </div>

      {/* Drawdown type */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Drawdown Type</div>
        <div className="flex gap-2">
          {["initial","trailing"].map((t) => (
            <button key={t} onClick={() => set("drawdownType")(t)}
              className={cx("flex-1 py-2.5 rounded-xl border text-xs font-medium capitalize transition",
                form.drawdownType === t ? "bg-amber-500/15 border-amber-500/50 text-amber-400" : "bg-slate-900 border-slate-800 text-slate-500")}>
              {t === "initial" ? "Static (from initial)" : "Trailing (from peak)"}
            </button>
          ))}
        </div>
      </div>

      {/* Custom rules */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Trading Rules</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {COMMON_RULES.map((r) => {
            const active = (form.customRules || []).includes(r);
            return (
              <button key={r} onClick={() => {
                if (active) removeRule((form.customRules || []).indexOf(r));
                else setForm((f: any) => ({ ...f, customRules: [...(f.customRules || []), r] }));
              }}
                className={cx("px-2.5 py-1 rounded-lg border text-[10px] font-medium transition",
                  active ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-slate-900 border-slate-800 text-slate-500")}>
                {active ? "✓ " : ""}{r}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input value={newRule} onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRule()}
            placeholder="Add custom rule…"
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-amber-500/50" />
          <button onClick={addRule} className="px-3 py-2 bg-amber-500 text-slate-950 rounded-xl font-semibold text-sm">Add</button>
        </div>
        {(form.customRules || []).filter((r: string) => !COMMON_RULES.includes(r)).map((r: string, i: number) => (
          <div key={i} className="flex items-center justify-between px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl mt-1.5 text-sm text-slate-300">
            {r}
            <button onClick={() => removeRule((form.customRules || []).indexOf(r))} className="text-slate-600 hover:text-rose-400"><X size={13} /></button>
          </div>
        ))}
      </div>

      {/* Notes */}
      <Field label="Notes">
        <textarea value={form.notes} onChange={(e) => set("notes")(e.target.value)} rows={3}
          placeholder="Any additional notes about this challenge…"
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none resize-none focus:border-amber-500/50" />
      </Field>

      <button onClick={() => onSave({ ...form, id: form.id || uid(), firm: form.firm === "Custom" ? form.name : form.firm })}
        disabled={!(form.name || "").trim()}
        className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-sm py-3 rounded-xl transition">
        {initial?.id ? "Save Changes" : "Create Challenge"}
      </button>
    </div>
  );
}

/* ── Prop Challenge Detail ── */
function PropChallengeDetail({ challenge, onBack, onEdit, onUpdateLog, onMarkStatus }) {
  const m = computePropChallenge(challenge);
  const cur = challenge.currency || "USD";
  const fmt = (n: number) => `${cur} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const [showLogForm, setShowLogForm] = useState(false);
  const [logBalance, setLogBalance] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logDate, setLogDate] = useState(todayISO());

  const submitLog = () => {
    if (!(logBalance || "").trim()) return;
    const entry = { date: logDate, balance: String(logBalance), note: logNote };
    const existing = (challenge.dailyLog || []).filter((e: any) => e.date !== logDate);
    onUpdateLog([...existing, entry].sort((a: any, b: any) => a.date.localeCompare(b.date)));
    setLogBalance(""); setLogNote(""); setLogDate(todayISO()); setShowLogForm(false);
  };

  const removeLog = (date: string) =>
    onUpdateLog((challenge.dailyLog || []).filter((e: any) => e.date !== date));

  const statusBanner = () => {
    if (m.hasFailed) {
      const reason = m.dailyLossViolated ? "Daily loss limit breached" : m.totalDrawdownViolated ? "Max drawdown exceeded" : "Challenge deadline passed";
      return { type: "failed" as const, bg: "bg-rose-500/15 border-rose-500/40", text: "text-rose-300", label: "⛔ CHALLENGE FAILED", sub: reason };
    }
    if (m.hasPassed) {
      return { type: "passed" as const, bg: "bg-emerald-500/15 border-emerald-500/40", text: "text-emerald-300", label: "🏆 CHALLENGE PASSED!", sub: `Profit target ${m.profitTargetPct}% met · ${m.daysTraded} trading days` };
    }
    if (m.hasWarning) {
      const reason = m.dailyLossProgress >= 75 ? `Daily loss at ${m.dailyLossProgress.toFixed(0)}% of limit` : m.totalDrawdownProgress >= 75 ? `Drawdown at ${m.totalDrawdownProgress.toFixed(0)}% of limit` : `Only ${m.daysRemaining} days left on deadline`;
      return { type: "warning" as const, bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-300", label: "⚠ APPROACHING LIMITS", sub: reason };
    }
    return { type: "ok" as const, bg: "bg-sky-500/10 border-sky-500/20", text: "text-sky-400", label: "✅ Active — On Track", sub: `${m.daysTraded} day${m.daysTraded !== 1 ? "s" : ""} logged · ${fmt(m.totalPnl)} P/L` };
  };
  const banner = statusBanner();

  const RuleBar = ({ label, value, max, progress, violated, warning, suffix = "" }: any) => {
    const color = violated ? "#f43f5e" : warning ? "#f59e0b" : "#22c55e";
    return (
      <div className={cx("rounded-xl border p-3", violated ? "bg-rose-500/5 border-rose-500/20" : warning ? "bg-amber-500/5 border-amber-500/15" : "bg-slate-900 border-slate-800")}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</span>
          <span className={cx("text-[10px] font-bold", violated ? "text-rose-400" : warning ? "text-amber-400" : "text-slate-300")}>
            {value}{suffix} / {max}{suffix}
          </span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progress}%`, background: color }} />
        </div>
        {violated && <p className="text-[9px] text-rose-400 mt-1 font-semibold">VIOLATED</p>}
      </div>
    );
  };

  // Chart data
  const chartData = [
    { date: challenge.startDate, balance: m.accountSize },
    ...m.log.map((e: any) => ({ date: e.date.slice(5), balance: parseFloat(e.balance) || m.accountSize })),
  ];

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-100 text-sm truncate" style={{ fontFamily: "'Sora', sans-serif" }}>{challenge.name || challenge.firm}</div>
          <div className="text-[10px] text-slate-500">{challenge.firm} · {challenge.phase} · {cur} {parseFloat(challenge.accountSize).toLocaleString()}</div>
        </div>
        <button onClick={onEdit} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400"><Pencil size={15} /></button>
      </div>

      {/* Status banner */}
      {banner.type === "failed" && (
        <div className="rounded-2xl border-2 border-rose-500/60 bg-rose-500/10 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3 bg-rose-500/15 border-b border-rose-500/30">
            <div className="w-3 h-3 rounded-full bg-rose-400 animate-pulse shrink-0" />
            <span className="text-rose-200 font-black text-sm tracking-wide uppercase">⛔ Challenge Failed</span>
          </div>
          <div className="px-4 py-3">
            <p className="text-rose-300 text-xs font-semibold mb-2">{banner.sub}</p>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {m.dailyLossViolated && <div className="px-2 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/20 text-rose-400">Daily Loss Breached<br /><span className="font-bold">{m.todayLossPct.toFixed(2)}% / {m.maxDailyLossPct}% limit</span></div>}
              {m.totalDrawdownViolated && <div className="px-2 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/20 text-rose-400">Max Drawdown Exceeded<br /><span className="font-bold">{m.currentDrawdownPct.toFixed(2)}% / {m.maxTotalDrawdownPct}% limit</span></div>}
              {m.deadlineViolated && <div className="px-2 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/20 text-rose-400">Deadline Expired<br /><span className="font-bold">{m.daysElapsed} / {m.maxCalendarDays} days</span></div>}
            </div>
          </div>
        </div>
      )}
      {banner.type === "passed" && (
        <div className="rounded-2xl border-2 border-emerald-500/50 bg-emerald-500/10 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3 bg-emerald-500/15 border-b border-emerald-500/30">
            <span className="text-emerald-200 font-black text-sm tracking-wide uppercase">🏆 Challenge Passed!</span>
          </div>
          <div className="px-4 py-3">
            <p className="text-emerald-300 text-xs font-semibold mb-1">{banner.sub}</p>
            <p className="text-[10px] text-emerald-500/70">Profit target reached — all rules satisfied.</p>
          </div>
        </div>
      )}
      {(banner.type === "warning" || banner.type === "ok") && (
        <div className={cx("rounded-xl border px-4 py-3", banner.bg)}>
          <div className={cx("font-bold text-sm", banner.text)}>{banner.label}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{banner.sub}</div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => onMarkStatus("passed")} className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">Mark Passed</button>
            <button onClick={() => onMarkStatus("failed")} className="px-3 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-semibold">Mark Failed</button>
          </div>
        </div>
      )}

      {/* Rule progress bars */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Challenge Rules Progress</div>
        <RuleBar
          label="Profit Target"
          value={m.totalPnlPct >= 0 ? `+${m.totalPnlPct.toFixed(2)}` : m.totalPnlPct.toFixed(2)}
          max={`+${m.profitTargetPct.toFixed(0)}`} suffix="%" progress={m.profitProgress}
          violated={false} warning={false} />
        <RuleBar
          label="Daily Loss (today)"
          value={m.todayLossPct.toFixed(2)} max={m.maxDailyLossPct.toFixed(0)} suffix="%"
          progress={m.dailyLossProgress} violated={m.dailyLossViolated} warning={m.dailyLossProgress >= 75 && !m.dailyLossViolated} />
        <RuleBar
          label={`Total Drawdown (${challenge.drawdownType === "trailing" ? "trailing" : "from initial"})`}
          value={m.currentDrawdownPct.toFixed(2)} max={m.maxTotalDrawdownPct.toFixed(0)} suffix="%"
          progress={m.totalDrawdownProgress} violated={m.totalDrawdownViolated} warning={m.totalDrawdownProgress >= 75 && !m.totalDrawdownViolated} />
        {m.minTradingDays > 0 && (
          <RuleBar
            label="Min Trading Days"
            value={m.daysTraded.toString()} max={m.minTradingDays.toString()} suffix=" days"
            progress={m.tradingDaysProgress} violated={false} warning={false} />
        )}
        {m.maxCalendarDays > 0 && (
          <RuleBar
            label="Calendar Days Used"
            value={m.daysElapsed.toString()} max={m.maxCalendarDays.toString()} suffix=" days"
            progress={m.deadlineProgress} violated={m.deadlineViolated}
            warning={m.daysRemaining !== null && m.daysRemaining <= 5 && !m.hasPassed} />
        )}
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Current Balance", value: fmt(m.currentBalance), color: m.currentBalance >= m.accountSize ? "text-emerald-400" : "text-rose-400" },
          { label: "Total P/L", value: (m.totalPnl >= 0 ? "+" : "") + fmt(m.totalPnl), color: m.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400" },
          { label: "Current Drawdown", value: `${m.currentDrawdownPct.toFixed(2)}%`, color: m.currentDrawdownPct > m.maxTotalDrawdownPct * 0.75 ? "text-rose-400" : "text-slate-200" },
          { label: "Win Days / Logged", value: `${m.winDays} / ${m.daysTraded}`, color: "text-slate-200" },
          { label: "Profit to Target", value: fmt(Math.max(0, m.profitTargetAmt - m.totalPnl)), color: "text-amber-400" },
          { label: "Days Remaining", value: m.daysRemaining !== null ? `${m.daysRemaining}d` : "—", color: m.daysRemaining !== null && m.daysRemaining <= 5 ? "text-rose-400" : "text-slate-200" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
            <div className={cx("text-sm font-bold", color)}>{value}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      {chartData.length > 1 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-3">Equity Curve</div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#475569" }} />
              <YAxis tick={{ fontSize: 9, fill: "#475569" }} width={60}
                tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [fmt(v), "Balance"]} />
              <Line type="monotone" dataKey="balance" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Custom rules checklist */}
      {(challenge.customRules || []).length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Trading Rules</div>
          <div className="space-y-1.5">
            {(challenge.customRules || []).map((rule: string, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                {rule}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Daily Balance Log</div>
          <button onClick={() => setShowLogForm((v) => !v)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-[10px] font-bold">
            <Plus size={11} /> Log Balance
          </button>
        </div>

        {showLogForm && (
          <div className="mb-3 p-3 bg-slate-800/60 rounded-xl space-y-2 border border-slate-700">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date"><TextInput type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} /></Field>
              <Field label={`Balance (${cur})`}><TextInput value={logBalance} onChange={(e) => setLogBalance(e.target.value)} placeholder="e.g. 102500" /></Field>
            </div>
            <Field label="Note (optional)"><TextInput value={logNote} onChange={(e) => setLogNote(e.target.value)} placeholder="e.g. Good London session" /></Field>
            <div className="flex gap-2">
              <button onClick={submitLog} disabled={!(logBalance || "").trim()} className="flex-1 py-2 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold disabled:opacity-40">Save Entry</button>
              <button onClick={() => setShowLogForm(false)} className="px-4 py-2 bg-slate-900 border border-slate-700 text-slate-400 rounded-xl text-xs">Cancel</button>
            </div>
          </div>
        )}

        {m.log.length === 0 ? (
          <p className="text-[11px] text-slate-600">No entries yet. Balance will auto-update when you log trades in the Trade Journal.</p>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {[...m.log].reverse().map((e: any, i: number) => {
              const prev = [...m.log].reverse()[i + 1];
              const diff = prev ? (parseFloat(e.balance) || 0) - (parseFloat(prev.balance) || 0) : null;
              return (
                <div key={e.date} className="flex items-center justify-between py-1.5 border-b border-slate-800/60 last:border-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-400 font-medium">{e.date}</span>
                    {e.auto && <span className="text-[9px] bg-sky-500/15 text-sky-400 border border-sky-500/30 rounded px-1 py-0.5 font-medium">Auto</span>}
                    {e.note && !e.auto && <span className="text-[10px] text-slate-600 ml-1">{e.note}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {diff !== null && (
                      <span className={cx("text-[10px] font-medium", diff >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {diff >= 0 ? "+" : ""}{diff.toFixed(2)}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-slate-200">{fmt(parseFloat(e.balance) || 0)}</span>
                    <button onClick={() => removeLog(e.date)} className="text-slate-700 hover:text-rose-400"><X size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      {challenge.notes && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Notes</div>
          <p className="text-xs text-slate-400">{challenge.notes}</p>
        </div>
      )}
    </div>
  );
}

/* ── Prop Challenges Panel (top-level) ── */
function PropChallengesPanel({ data, setData }) {
  const challenges: any[] = data.propChallenges || [];
  const [view, setView] = useState<"list"|"detail"|"form">("list");
  const [selected, setSelected] = useState<any>(null);

  const save = (ch: any) => {
    setData((d: any) => {
      const list = d.propChallenges || [];
      const exists = list.some((c: any) => c.id === ch.id);
      const propChallenges = exists
        ? list.map((c: any) => c.id === ch.id ? ch : c)
        : [...list, ch];
      return { ...d, propChallenges };
    });
    setSelected(ch);
    setView("detail");
  };

  const remove = (id: string) => {
    setData((d: any) => ({ ...d, propChallenges: (d.propChallenges || []).filter((c: any) => c.id !== id) }));
    setView("list");
  };

  const updateLog = (id: string, log: any[]) => {
    setData((d: any) => ({
      ...d,
      propChallenges: (d.propChallenges || []).map((c: any) => c.id === id ? { ...c, dailyLog: log } : c),
    }));
    setSelected((s: any) => s ? { ...s, dailyLog: log } : s);
  };

  const markStatus = (id: string, status: string) => {
    setData((d: any) => ({
      ...d,
      propChallenges: (d.propChallenges || []).map((c: any) => c.id === id ? { ...c, status } : c),
    }));
    setSelected((s: any) => s ? { ...s, status } : s);
  };

  // Sync selected with latest data
  const liveSelected = selected ? (challenges.find((c) => c.id === selected.id) || selected) : null;

  if (view === "form") {
    return (
      <PropChallengeForm
        initial={selected}
        onSave={save}
        onBack={() => setView(selected?.id ? "detail" : "list")}
        tradingAccounts={data.tradingAccounts || []} />
    );
  }

  if (view === "detail" && liveSelected) {
    return (
      <PropChallengeDetail
        challenge={liveSelected}
        onBack={() => setView("list")}
        onEdit={() => { setSelected(liveSelected); setView("form"); }}
        onUpdateLog={(log: any[]) => updateLog(liveSelected.id, log)}
        onMarkStatus={(status: string) => markStatus(liveSelected.id, status)} />
    );
  }

  // List view
  const PHASE_COLOR: Record<string, string> = {
    Evaluation: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    Verification: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Funded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle sub="Track your prop firm evaluations">Prop Challenges</SectionTitle>
        <button onClick={() => { setSelected(null); setView("form"); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition">
          <Plus size={13} /> New
        </button>
      </div>

      {challenges.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <Trophy size={32} className="text-amber-400/40 mx-auto mb-3" />
            <p className="text-slate-400 text-sm font-medium">No challenges yet</p>
            <p className="text-slate-600 text-xs mt-1 mb-4">Add your first prop firm challenge to start tracking your progress.</p>
            <button onClick={() => { setSelected(null); setView("form"); }}
              className="px-4 py-2 bg-amber-500 text-slate-950 rounded-xl text-sm font-bold">
              + Add Challenge
            </button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {challenges.map((ch) => {
            const m = computePropChallenge(ch);
            const statusColor = m.hasFailed ? "border-rose-500/30" : m.hasPassed ? "border-emerald-500/30" : m.hasWarning ? "border-amber-500/25" : "border-slate-700/60";
            return (
              <div key={ch.id} onClick={() => { setSelected(ch); setView("detail"); }}
                className={cx("rounded-2xl border bg-slate-950 p-4 cursor-pointer active:scale-[0.99] transition-transform", statusColor)}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>{ch.name || ch.firm}</span>
                      <span className={cx("px-1.5 py-0.5 rounded text-[9px] font-semibold border", PHASE_COLOR[ch.phase] || PHASE_COLOR.Evaluation)}>{ch.phase}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">{ch.firm} · {ch.currency} {parseFloat(ch.accountSize).toLocaleString()} · Started {ch.startDate}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cx("text-sm font-bold", m.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {m.totalPnl >= 0 ? "+" : ""}{m.totalPnlPct.toFixed(2)}%
                    </div>
                    <div className="text-[9px] text-slate-600">{m.daysTraded}d logged</div>
                  </div>
                </div>

                {/* Mini progress bars */}
                <div className="space-y-1.5">
                  <div>
                    <div className="flex justify-between text-[9px] text-slate-600 mb-0.5">
                      <span>Profit target ({ch.profitTargetPct}%)</span>
                      <span>{m.totalPnlPct >= 0 ? "+" : ""}{m.totalPnlPct.toFixed(2)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${m.profitProgress}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[9px] text-slate-600 mb-0.5">
                      <span>Drawdown used ({ch.maxTotalDrawdownPct}% limit)</span>
                      <span>{m.currentDrawdownPct.toFixed(2)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${m.totalDrawdownProgress}%`, background: m.totalDrawdownViolated ? "#f43f5e" : m.totalDrawdownProgress >= 75 ? "#f59e0b" : "#475569" }} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-800/60">
                  <span className={cx("text-[10px] font-semibold",
                    m.hasFailed ? "text-rose-400" : m.hasPassed ? "text-emerald-400" : m.hasWarning ? "text-amber-400" : "text-sky-400")}>
                    {m.hasFailed ? "⛔ Failed" : m.hasPassed ? "🏆 Passed" : m.hasWarning ? "⚠ Warning" : "✅ On Track"}
                  </span>
                  <div className="flex items-center gap-2">
                    {m.daysRemaining !== null && !m.hasPassed && !m.hasFailed && (
                      <span className="text-[10px] text-slate-500">{m.daysRemaining}d left</span>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); if (confirm("Delete this challenge?")) remove(ch.id); }}
                      className="text-slate-700 hover:text-rose-400 p-1"><Trash2 size={13} /></button>
                    <ChevronRight size={14} className="text-slate-600" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TRADE PLAN BUILDER — Daily Pre-Session Plan
   ============================================================ */
const SP_PAIRS = ["XAUUSD","EURUSD","GBPUSD","GBPJPY","USDJPY","AUDUSD","NZDUSD","USDCAD","USDCHF","EURJPY","EURCAD","EURGBP"];
const SP_SESSIONS = ["Pre-London","London","New York","Asia"];
const SP_CHECKLIST_DEFAULTS = [
  "Checked economic calendar for today",
  "Identified key S/R levels on H4 chart",
  "Confirmed session timing and volume windows",
  "Set max loss limit for today",
  "Reviewed yesterday's trades",
  "No unresolved emotional state from previous session",
  "News events noted and avoided",
];

function emptySessionPlan() {
  return {
    id: null,
    date: todayISO(),
    overallBias: "",
    biasNotes: "",
    pairsWatch: [] as string[],
    keyLevels: [] as any[],
    sessionFocus: [] as string[],
    maxTrades: "3",
    maxDailyLossAmt: "",
    newsToAvoid: [] as string[],
    analysis: "",
    mindset: "",
    checklist: SP_CHECKLIST_DEFAULTS.map((text) => ({ id: uid(), text, done: false })),
    setupIds: [] as string[],
  };
}

function SessionPlanForm({ initial, onSave, onBack, setups = [] }: { initial?: any; onSave: (p: any) => void; onBack: () => void; setups?: any[] }) {
  const [form, setForm] = useState<any>(() => initial ? { ...initial, keyLevels: initial.keyLevels || [], checklist: initial.checklist || SP_CHECKLIST_DEFAULTS.map((t) => ({ id: uid(), text: t, done: false })), setupIds: initial.setupIds || [] } : emptySessionPlan());
  const [setupModal, setSetupModal] = useState<any>(null);
  const [newNews, setNewNews] = useState("");
  const [newLevelPair, setNewLevelPair] = useState("XAUUSD");
  const [newLevelPrice, setNewLevelPrice] = useState("");
  const [newLevelType, setNewLevelType] = useState("Resistance");
  const [newLevelNote, setNewLevelNote] = useState("");
  const [newCheck, setNewCheck] = useState("");

  const togglePair = (p: string) => setForm((f: any) => ({ ...f, pairsWatch: f.pairsWatch.includes(p) ? f.pairsWatch.filter((x: string) => x !== p) : [...f.pairsWatch, p] }));
  const toggleSession = (s: string) => setForm((f: any) => ({ ...f, sessionFocus: f.sessionFocus.includes(s) ? f.sessionFocus.filter((x: string) => x !== s) : [...f.sessionFocus, s] }));
  const addNews = () => { if (!newNews.trim()) return; setForm((f: any) => ({ ...f, newsToAvoid: [...f.newsToAvoid, newNews.trim()] })); setNewNews(""); };
  const removeNews = (i: number) => setForm((f: any) => ({ ...f, newsToAvoid: f.newsToAvoid.filter((_: any, idx: number) => idx !== i) }));
  const addLevel = () => {
    if (!newLevelPrice.trim()) return;
    const lvl = { id: uid(), pair: newLevelPair, level: newLevelPrice, type: newLevelType, note: newLevelNote };
    setForm((f: any) => ({ ...f, keyLevels: [...f.keyLevels, lvl] }));
    setNewLevelPrice(""); setNewLevelNote("");
  };
  const removeLevel = (id: string) => setForm((f: any) => ({ ...f, keyLevels: f.keyLevels.filter((l: any) => l.id !== id) }));
  const addCheck = () => { if (!newCheck.trim()) return; setForm((f: any) => ({ ...f, checklist: [...f.checklist, { id: uid(), text: newCheck.trim(), done: false }] })); setNewCheck(""); };
  const removeCheck = (id: string) => setForm((f: any) => ({ ...f, checklist: f.checklist.filter((c: any) => c.id !== id) }));
  const save = () => { onSave({ ...form, id: form.id || uid() }); };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400"><ArrowLeft size={16} /></button>
        <h2 className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>{initial?.id ? "Edit Session Plan" : "New Session Plan"}</h2>
      </div>

      {/* Date */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Date</div>
        <TextInput type="date" value={form.date} onChange={(e: any) => setForm((f: any) => ({ ...f, date: e.target.value }))} />
      </div>

      {/* Market Bias */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Overall Market Bias</div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {["Bullish","Bearish","Neutral"].map((b) => (
            <button key={b} onClick={() => setForm((f: any) => ({ ...f, overallBias: f.overallBias === b ? "" : b }))}
              className={cx("py-2.5 rounded-xl text-xs font-semibold border transition",
                form.overallBias === b
                  ? b === "Bullish" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                    : b === "Bearish" ? "bg-rose-500/20 border-rose-500/40 text-rose-400"
                    : "bg-slate-700 border-slate-600 text-slate-300"
                  : "bg-slate-900 border-slate-800 text-slate-500")}>
              {b === "Bullish" ? "📈 Bullish" : b === "Bearish" ? "📉 Bearish" : "➡️ Neutral"}
            </button>
          ))}
        </div>
        <TextArea value={form.biasNotes} onChange={(e: any) => setForm((f: any) => ({ ...f, biasNotes: e.target.value }))}
          placeholder="Why this bias? Key confluences, trend direction, HTF structure..." className="min-h-[80px]" />
      </div>

      {/* Pairs to Watch */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Pairs to Watch</div>
        <div className="flex flex-wrap gap-1.5">
          {SP_PAIRS.map((p) => (
            <button key={p} onClick={() => togglePair(p)}
              className={cx("px-3 py-1.5 rounded-xl border text-xs font-medium transition",
                form.pairsWatch.includes(p) ? "bg-amber-500/15 border-amber-500/40 text-amber-400" : "bg-slate-900 border-slate-800 text-slate-500")}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Session Focus */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Session Focus</div>
        <div className="flex flex-wrap gap-2">
          {SP_SESSIONS.map((s) => (
            <button key={s} onClick={() => toggleSession(s)}
              className={cx("px-3 py-1.5 rounded-xl border text-xs font-medium transition",
                form.sessionFocus.includes(s) ? "bg-sky-500/15 border-sky-500/40 text-sky-400" : "bg-slate-900 border-slate-800 text-slate-500")}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Setups to Watch */}
      {setups.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Setups to Watch Today</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {setups.map((s: any) => {
              const selected = (form.setupIds || []).includes(s.id);
              const thumb = (s.photos || [])[0]?.url || s.image || null;
              return (
                <button key={s.id} onClick={() => {
                  setForm((f: any) => ({
                    ...f,
                    setupIds: selected ? (f.setupIds || []).filter((id: string) => id !== s.id) : [...(f.setupIds || []), s.id],
                  }));
                }}
                  className={cx("relative text-left rounded-2xl overflow-hidden border-2 transition",
                    selected ? "border-amber-500" : "border-slate-800 hover:border-slate-700")}>
                  {thumb ? (
                    <img src={thumb} alt={s.name} className="w-full h-20 object-cover bg-slate-950" />
                  ) : (
                    <div className="w-full h-20 bg-slate-950 flex items-center justify-center">
                      <ImageIcon size={16} className="text-slate-700" />
                    </div>
                  )}
                  <div className={cx("px-2 py-1.5", selected ? "bg-amber-500/10" : "bg-slate-900")}>
                    <div className="text-[11px] font-semibold text-slate-200 truncate">{s.name}</div>
                    {s.setupType && <div className="text-[10px] text-slate-500">{s.setupType}</div>}
                  </div>
                  {selected && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                      <CheckCircle2 size={10} className="text-slate-950" />
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setSetupModal(s); }}
                    className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-slate-950/70 text-[9px] text-slate-400 hover:text-amber-400">
                    Details
                  </button>
                </button>
              );
            })}
          </div>
          {(form.setupIds || []).length > 0 && (
            <p className="text-[11px] text-amber-400/80">
              {(form.setupIds || []).length} setup{(form.setupIds || []).length !== 1 ? "s" : ""} selected for today
            </p>
          )}
        </div>
      )}
      {setupModal && <SetupDetailModal setup={setupModal} onClose={() => setSetupModal(null)} />}

      {/* Key Levels */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Key S/R Levels</div>
        {form.keyLevels.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {form.keyLevels.map((lvl: any) => (
              <div key={lvl.id} className="flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
                <span className={cx("text-[10px] font-bold px-1.5 py-0.5 rounded", lvl.type === "Resistance" ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400")}>{lvl.type.slice(0, 3).toUpperCase()}</span>
                <span className="text-xs text-slate-500">{lvl.pair}</span>
                <span className="text-xs font-semibold text-slate-200 flex-1">{lvl.level}</span>
                {lvl.note && <span className="text-[10px] text-slate-600 truncate max-w-[80px]">{lvl.note}</span>}
                <button onClick={() => removeLevel(lvl.id)} className="text-slate-600 hover:text-rose-400"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={newLevelPair} onChange={(e) => setNewLevelPair(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-300 outline-none">
              {SP_PAIRS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={newLevelType} onChange={(e) => setNewLevelType(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-300 outline-none">
              <option>Resistance</option>
              <option>Support</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextInput placeholder="Price level" value={newLevelPrice} onChange={(e: any) => setNewLevelPrice(e.target.value)} />
            <TextInput placeholder="Note (optional)" value={newLevelNote} onChange={(e: any) => setNewLevelNote(e.target.value)} />
          </div>
          <button onClick={addLevel} className="w-full py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-xs hover:text-amber-400 hover:border-amber-500/30 transition">
            + Add Level
          </button>
        </div>
      </div>

      {/* Risk Rules */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Risk Rules for Today</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-600 mb-1">Max trades today</div>
            <TextInput type="number" min="1" placeholder="3" value={form.maxTrades} onChange={(e: any) => setForm((f: any) => ({ ...f, maxTrades: e.target.value }))} />
          </div>
          <div>
            <div className="text-[10px] text-slate-600 mb-1">Max daily loss ($)</div>
            <TextInput type="number" placeholder="e.g. 150" value={form.maxDailyLossAmt} onChange={(e: any) => setForm((f: any) => ({ ...f, maxDailyLossAmt: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* News to Avoid */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">News Events to Avoid</div>
        {form.newsToAvoid.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {form.newsToAvoid.map((n: string, i: number) => (
              <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {n}
                <button onClick={() => removeNews(i)} className="hover:text-rose-300"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <TextInput placeholder="e.g. NFP 8:30am, FOMC 2pm..." value={newNews}
            onChange={(e: any) => setNewNews(e.target.value)}
            onKeyDown={(e: any) => { if (e.key === "Enter") addNews(); }} className="flex-1" />
          <button onClick={addNews} className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-amber-400 text-xs">Add</button>
        </div>
      </div>

      {/* Pre-Market Analysis */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Pre-Market Analysis</div>
        <TextArea value={form.analysis} onChange={(e: any) => setForm((f: any) => ({ ...f, analysis: e.target.value }))}
          placeholder="Paste your full pre-session analysis here — HTF structure, confluences, what you're watching for, scenarios..." className="min-h-[120px]" />
      </div>

      {/* Mindset */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Mindset Check-In</div>
        <TextArea value={form.mindset} onChange={(e: any) => setForm((f: any) => ({ ...f, mindset: e.target.value }))}
          placeholder="How are you feeling today? Any concerns, emotional carry-over, or focus notes before you start trading..." className="min-h-[80px]" />
      </div>

      {/* Pre-Session Checklist */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Pre-Session Checklist</div>
        <div className="space-y-1.5 mb-2">
          {form.checklist.map((item: any) => (
            <div key={item.id} className="flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
              <span className="text-xs text-slate-400 flex-1">{item.text}</span>
              <button onClick={() => removeCheck(item.id)} className="text-slate-700 hover:text-rose-400"><X size={12} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <TextInput placeholder="Add custom checklist item..." value={newCheck}
            onChange={(e: any) => setNewCheck(e.target.value)}
            onKeyDown={(e: any) => { if (e.key === "Enter") addCheck(); }} className="flex-1" />
          <button onClick={addCheck} className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-amber-400 text-xs">Add</button>
        </div>
      </div>

      <button onClick={save}
        className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-2xl font-bold text-sm transition">
        {initial?.id ? "Save Changes" : "Save Plan"}
      </button>
    </div>
  );
}

function SessionPlanDetail({ plan, onBack, onEdit, onDelete, onUpdate }) {
  const [checklist, setChecklist] = useState<any[]>(plan.checklist || []);
  useEffect(() => { setChecklist(plan.checklist || []); }, [plan.id]);

  const toggleCheck = (id: string) => {
    const next = checklist.map((c: any) => c.id === id ? { ...c, done: !c.done } : c);
    setChecklist(next);
    onUpdate({ ...plan, checklist: next });
  };
  const done = checklist.filter((c: any) => c.done).length;
  const total = checklist.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const BIAS_COLOR = { Bullish: "text-emerald-400", Bearish: "text-rose-400", Neutral: "text-slate-400" };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400"><ArrowLeft size={16} /></button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Session Plan — {plan.date}</div>
          <div className="text-[10px] text-slate-500">{plan.sessionFocus?.join(" · ") || "All sessions"}</div>
        </div>
        <button onClick={onEdit} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400"><Pencil size={15} /></button>
        <button onClick={onDelete} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400"><Trash2 size={15} /></button>
      </div>

      {/* Bias */}
      {plan.overallBias && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Market Bias</div>
          <div className={cx("text-lg font-bold mb-1", BIAS_COLOR[plan.overallBias] || "text-slate-400")}>
            {plan.overallBias === "Bullish" ? "📈" : plan.overallBias === "Bearish" ? "📉" : "➡️"} {plan.overallBias}
          </div>
          {plan.biasNotes && <p className="text-xs text-slate-400 leading-relaxed">{plan.biasNotes}</p>}
        </div>
      )}

      {/* Pairs + Sessions */}
      <div className="grid grid-cols-2 gap-3">
        {plan.pairsWatch?.length > 0 && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Pairs</div>
            <div className="flex flex-wrap gap-1">
              {plan.pairsWatch.map((p: string) => (
                <span key={p} className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold">{p}</span>
              ))}
            </div>
          </div>
        )}
        {plan.sessionFocus?.length > 0 && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Sessions</div>
            <div className="flex flex-wrap gap-1">
              {plan.sessionFocus.map((s: string) => (
                <span key={s} className="px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px] font-semibold">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Risk Rules */}
      {(plan.maxTrades || plan.maxDailyLossAmt) && (
        <div className="grid grid-cols-2 gap-3">
          {plan.maxTrades && (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 text-center">
              <div className="text-xl font-bold text-amber-400">{plan.maxTrades}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Max Trades Today</div>
            </div>
          )}
          {plan.maxDailyLossAmt && (
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-3 text-center">
              <div className="text-xl font-bold text-rose-400">${parseFloat(plan.maxDailyLossAmt).toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Max Daily Loss</div>
            </div>
          )}
        </div>
      )}

      {/* Key Levels */}
      {plan.keyLevels?.length > 0 && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-3">Key S/R Levels</div>
          <div className="space-y-1.5">
            {plan.keyLevels.map((lvl: any) => (
              <div key={lvl.id} className="flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
                <span className={cx("text-[10px] font-bold px-1.5 py-0.5 rounded", lvl.type === "Resistance" ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400")}>{lvl.type.slice(0, 3).toUpperCase()}</span>
                <span className="text-[10px] text-slate-500">{lvl.pair}</span>
                <span className="text-xs font-semibold text-slate-200 flex-1">{lvl.level}</span>
                {lvl.note && <span className="text-[10px] text-slate-600">{lvl.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* News to Avoid */}
      {plan.newsToAvoid?.length > 0 && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">⚠️ News to Avoid</div>
          <div className="flex flex-wrap gap-1.5">
            {plan.newsToAvoid.map((n: string, i: number) => (
              <span key={i} className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">{n}</span>
            ))}
          </div>
        </div>
      )}

      {/* Analysis */}
      {plan.analysis && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Pre-Market Analysis</div>
          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{plan.analysis}</p>
        </div>
      )}

      {/* Mindset */}
      {plan.mindset && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">🧠 Mindset Check-In</div>
          <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{plan.mindset}</p>
        </div>
      )}

      {/* Checklist */}
      {checklist.length > 0 && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Pre-Session Checklist</div>
            <span className={cx("text-[10px] font-bold", pct === 100 ? "text-emerald-400" : "text-amber-400")}>{done}/{total} done</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-3">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="space-y-2">
            {checklist.map((item: any) => (
              <button key={item.id} onClick={() => toggleCheck(item.id)}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-700 transition text-left">
                <div className={cx("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition",
                  item.done ? "bg-emerald-500 border-emerald-500" : "border-slate-600")}>
                  {item.done && <Check size={10} className="text-white" />}
                </div>
                <span className={cx("text-xs flex-1", item.done ? "text-slate-600 line-through" : "text-slate-300")}>{item.text}</span>
              </button>
            ))}
          </div>
          {pct === 100 && (
            <div className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
              <p className="text-emerald-400 text-xs font-semibold">✅ All checks done — you're ready to trade!</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionPlanPanel({ data, setData }) {
  const plans: any[] = data.sessionPlans || [];
  const [view, setView] = useState<"list"|"form"|"detail">("list");
  const [selected, setSelected] = useState<any>(null);

  const save = (plan: any) => {
    setData((d: any) => {
      const list = d.sessionPlans || [];
      const exists = list.some((p: any) => p.id === plan.id);
      return { ...d, sessionPlans: exists ? list.map((p: any) => p.id === plan.id ? plan : p) : [...list, plan] };
    });
    setSelected(plan); setView("detail");
  };

  const del = (id: string) => {
    setData((d: any) => ({ ...d, sessionPlans: (d.sessionPlans || []).filter((p: any) => p.id !== id) }));
    setView("list");
  };

  const update = (plan: any) => {
    setData((d: any) => ({ ...d, sessionPlans: (d.sessionPlans || []).map((p: any) => p.id === plan.id ? plan : p) }));
    setSelected(plan);
  };

  const liveSelected = selected ? ((plans.find((p) => p.id === selected.id)) || selected) : null;

  if (view === "form") {
    return <SessionPlanForm initial={selected} onSave={save} onBack={() => setView(selected?.id ? "detail" : "list")} setups={data.setups || []} />;
  }

  if (view === "detail" && liveSelected) {
    return (
      <SessionPlanDetail
        plan={liveSelected}
        onBack={() => setView("list")}
        onEdit={() => { setSelected(liveSelected); setView("form"); }}
        onDelete={() => del(liveSelected.id)}
        onUpdate={update} />
    );
  }

  const today = todayISO();
  const todayPlan = plans.find((p) => p.date === today);
  const sorted = [...plans].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle sub="Pre-session planning & key levels">Trade Plan Builder</SectionTitle>
        <button onClick={() => { setSelected(null); setView("form"); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition">
          <Plus size={13} /> New Plan
        </button>
      </div>

      {/* Today callout */}
      {!todayPlan && (
        <button onClick={() => { setSelected(null); setView("form"); }}
          className="w-full flex items-center gap-3 px-4 py-3 bg-amber-500/5 border border-amber-500/20 border-dashed rounded-2xl hover:border-amber-500/40 transition text-left">
          <CalendarDays size={18} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-400">No plan for today yet</p>
            <p className="text-[11px] text-slate-600">Tap to create your pre-session plan before you start trading →</p>
          </div>
        </button>
      )}

      {plans.length === 0 ? (
        <div className="text-center py-10">
          <FileText size={32} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400 text-sm font-medium mb-1">No session plans yet</p>
          <p className="text-slate-600 text-xs">Build a plan before each session — bias, key levels, risk rules, news to avoid.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((plan) => {
            const isToday = plan.date === today;
            const doneCount = (plan.checklist || []).filter((c: any) => c.done).length;
            const totalCount = (plan.checklist || []).length;
            const BIAS_COLOR: Record<string,string> = { Bullish: "text-emerald-400", Bearish: "text-rose-400", Neutral: "text-slate-400" };
            return (
              <button key={plan.id} onClick={() => { setSelected(plan); setView("detail"); }}
                className={cx("w-full rounded-2xl border p-4 text-left hover:bg-slate-900/40 transition",
                  isToday ? "bg-amber-500/5 border-amber-500/20" : "bg-slate-950 border-slate-800")}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300">{plan.date}</span>
                    {isToday && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-bold">TODAY</span>}
                  </div>
                  {plan.overallBias && <span className={cx("text-xs font-bold", BIAS_COLOR[plan.overallBias])}>{plan.overallBias === "Bullish" ? "📈" : plan.overallBias === "Bearish" ? "📉" : "➡️"} {plan.overallBias}</span>}
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {(plan.pairsWatch || []).slice(0, 4).map((p: string) => (
                    <span key={p} className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-[9px] font-medium">{p}</span>
                  ))}
                  {plan.sessionFocus?.length > 0 && plan.sessionFocus.map((s: string) => (
                    <span key={s} className="px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/15 text-sky-500 text-[9px] font-medium">{s}</span>
                  ))}
                </div>
                {totalCount > 0 && (
                  <div>
                    <div className="flex justify-between text-[9px] text-slate-600 mb-0.5">
                      <span>Checklist</span><span>{doneCount}/{totalCount}</span>
                    </div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${totalCount > 0 ? (doneCount/totalCount)*100 : 0}%` }} />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionPlanDashCard({ data, goTo }) {
  const today = todayISO();
  const plans: any[] = data.sessionPlans || [];
  const todayPlan = plans.find((p) => p.date === today);
  const BIAS_COLOR: Record<string,string> = { Bullish: "text-emerald-400", Bearish: "text-rose-400", Neutral: "text-slate-400" };

  if (!todayPlan) {
    return (
      <button onClick={() => goTo("more", "Session")}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-950 border border-amber-500/20 border-dashed rounded-2xl text-left hover:border-amber-500/40 transition">
        <CalendarDays size={18} className="text-amber-400/60 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-400/80">Build today's session plan</p>
          <p className="text-[11px] text-slate-600">Bias · Key levels · Risk rules · Checklist →</p>
        </div>
      </button>
    );
  }

  const doneCount = (todayPlan.checklist || []).filter((c: any) => c.done).length;
  const totalCount = (todayPlan.checklist || []).length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <button onClick={() => goTo("more", "Session")}
      className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left hover:bg-slate-900/30 transition">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-amber-400" />
          <span className="text-sm font-semibold text-slate-200" style={{ fontFamily: "'Sora', sans-serif" }}>Today's Session Plan</span>
        </div>
        {todayPlan.overallBias ? (
          <span className={cx("text-xs font-bold", BIAS_COLOR[todayPlan.overallBias])}>
            {todayPlan.overallBias === "Bullish" ? "📈" : todayPlan.overallBias === "Bearish" ? "📉" : "➡️"} {todayPlan.overallBias}
          </span>
        ) : <ChevronRight size={14} className="text-slate-600" />}
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {(todayPlan.pairsWatch || []).map((p: string) => (
          <span key={p} className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold">{p}</span>
        ))}
        {(todayPlan.sessionFocus || []).map((s: string) => (
          <span key={s} className="px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px] font-semibold">{s}</span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {todayPlan.maxTrades && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-center">
            <div className="text-sm font-bold text-amber-400">{todayPlan.maxTrades}</div>
            <div className="text-[9px] text-slate-600">Max Trades</div>
          </div>
        )}
        {todayPlan.maxDailyLossAmt && (
          <div className="bg-rose-500/5 border border-rose-500/15 rounded-xl px-3 py-2 text-center">
            <div className="text-sm font-bold text-rose-400">${parseFloat(todayPlan.maxDailyLossAmt).toLocaleString()}</div>
            <div className="text-[9px] text-slate-600">Max Loss</div>
          </div>
        )}
      </div>
      {totalCount > 0 && (
        <div>
          <div className="flex justify-between text-[9px] text-slate-600 mb-1">
            <span>Pre-session checklist</span>
            <span className={pct === 100 ? "text-emerald-400 font-bold" : ""}>{doneCount}/{totalCount} {pct === 100 ? "✅ Ready!" : ""}</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct === 100 ? "#22c55e" : "#f59e0b" }} />
          </div>
        </div>
      )}
      {todayPlan.newsToAvoid?.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <AlertTriangle size={10} className="text-rose-400" />
          <span className="text-[9px] text-rose-400 font-medium">{todayPlan.newsToAvoid.length} news event{todayPlan.newsToAvoid.length > 1 ? "s" : ""} to avoid today</span>
        </div>
      )}
    </button>
  );
}

/* ============================================================
   SETTINGS PANEL
   ============================================================ */
const ACCENT_COLORS = [
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#3b82f6", label: "Blue" },
  { hex: "#10b981", label: "Emerald" },
  { hex: "#8b5cf6", label: "Violet" },
  { hex: "#f43f5e", label: "Rose" },
  { hex: "#06b6d4", label: "Cyan" },
  { hex: "#fb923c", label: "Orange" },
  { hex: "#a3e635", label: "Lime" },
];

const CARD_BG_OPTIONS = [
  { hex: "#0f172a", label: "Navy" },
  { hex: "#1c1917", label: "Stone" },
  { hex: "#111827", label: "Gray" },
  { hex: "#0a0a0a", label: "Pitch Black" },
  { hex: "#0f1923", label: "Deep Blue" },
  { hex: "#15161a", label: "Dark Slate" },
];

const DASH_SECTION_META = [
  { key: "moolMantar",      label: "Mool Mantar",           icon: "🙏" },
  { key: "liveTicker",      label: "Live Market Ticker",    icon: "📊" },
  { key: "activeTrades",    label: "Active Trades Monitor",  icon: "📡" },
  { key: "marketOverview",  label: "Market Overview Chart",  icon: "📈" },
  { key: "marketSessions",  label: "Forex Market Sessions",  icon: "🌍" },
  { key: "accountOverview", label: "Account Overview",       icon: "💰" },
  { key: "todaysFocus",     label: "Today's Focus",          icon: "🎯" },
  { key: "propChallenges",  label: "Prop Challenges",        icon: "🏆" },
  { key: "thisWeek",        label: "This Week",              icon: "📅" },
  { key: "riskTools",       label: "Risk & Tools",           icon: "⚖️" },
  { key: "recentTrades",    label: "Recent Trades",          icon: "📋" },
  { key: "insightsEdge",    label: "Insights & Edge",        icon: "💡" },
  { key: "setupLibrary",    label: "Setup Library",          icon: "📚" },
  { key: "marketCalendar",  label: "Market Calendar",        icon: "🗓️" },
  { key: "statistics",      label: "Statistics",             icon: "📊" },
  { key: "reference",       label: "Reference",              icon: "📖" },
];

/* ── small helpers ── */
function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-800/50 last:border-0 gap-3">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function ToggleSwitch({ on, onChange, accent }: { on: boolean; onChange: () => void; accent: string }) {
  return (
    <button onClick={onChange}
      className="w-12 h-6 rounded-full transition-all relative"
      style={{ background: on ? accent + "50" : "#1e293b", border: `1px solid ${on ? accent + "70" : "#334155"}` }}>
      <div className="absolute top-0.5 transition-all duration-200 w-5 h-5 rounded-full shadow"
        style={{ background: on ? accent : "#475569", left: on ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );
}
function ChipSelect({ options, value, onChange, accent }: { options: string[]; value: string; onChange: (v: string) => void; accent: string }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
          style={value === o ? { background: accent + "20", borderColor: accent + "60", color: accent } : { background: "#0f172a", borderColor: "#334155", color: "#94a3b8" }}>
          {o}
        </button>
      ))}
    </div>
  );
}

function SettingsPanel({ data, setData }) {
  const settings: any = { ...DEFAULT_SETTINGS(), ...(data.settings || {}) };
  const vis = { ...DEFAULT_SETTINGS().dashVisibility, ...(settings.dashVisibility || {}) };
  const navVis = { ...DEFAULT_SETTINGS().navVisibility, ...(settings.navVisibility || {}) };
  const moreVis = { ...DEFAULT_SETTINGS().moreTabVisibility, ...(settings.moreTabVisibility || {}) };
  const accent = settings.accentColor || "#f59e0b";
  const cardBg = settings.cardBg || "#0f172a";

  const upd = (patch: any) => setData((d: any) => ({ ...d, settings: { ...DEFAULT_SETTINGS(), ...(d.settings || {}), ...patch } }));
  const updNested = (key: string, subKey: string, val: any) => {
    setData((d: any) => {
      const s = { ...DEFAULT_SETTINGS(), ...(d.settings || {}) };
      return { ...d, settings: { ...s, [key]: { ...(s[key] || {}), [subKey]: val } } };
    });
  };

  const [openSection, setOpenSection] = useState<string>("theme");
  const toggle = (s: string) => setOpenSection((prev) => prev === s ? "" : s);

  const notifSettings = { ...DEFAULT_SETTINGS().notifications, ...(settings.notifications || {}) };
  const updNotif = (key: string, val: boolean) => {
    setData((d: any) => {
      const s = { ...DEFAULT_SETTINGS(), ...(d.settings || {}) };
      return { ...d, settings: { ...s, notifications: { ...DEFAULT_SETTINGS().notifications, ...(s.notifications || {}), [key]: val } } };
    });
  };

  const sections: { id: string; label: string; icon: string }[] = [
    { id: "theme",     label: "Theme & Colors",        icon: "🎨" },
    { id: "dashboard", label: "Dashboard Sections",     icon: "🏠" },
    { id: "journal",   label: "Journal Defaults",       icon: "📝" },
    { id: "risk",      label: "Risk Rules & Alerts",    icon: "⚠️" },
    { id: "display",   label: "Display Preferences",    icon: "🖥️" },
    { id: "behaviour", label: "App Behaviour",          icon: "⚙️" },
    { id: "nav",       label: "Navigation Visibility",  icon: "🧭" },
    { id: "notifs",    label: "Notifications",          icon: "🔔" },
  ];

  return (
    <div className="space-y-2 pb-8">

      {sections.map(({ id, label, icon }) => {
        const open = openSection === id;
        return (
          <div key={id} className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
            {/* Accordion header */}
            <button onClick={() => toggle(id)}
              className="w-full flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-lg">{icon}</span>
                <span className="text-sm font-semibold text-slate-200">{label}</span>
              </div>
              {open ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
            </button>

            {/* ── THEME & COLORS ── */}
            {open && id === "theme" && (
              <div className="px-4 pb-4 space-y-4 border-t border-slate-800">
                <div className="pt-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Accent Color</div>
                  <div className="grid grid-cols-4 gap-2">
                    {ACCENT_COLORS.map(({ hex, label: l }) => (
                      <button key={hex} onClick={() => upd({ accentColor: hex })}
                        className="flex flex-col items-center gap-1.5 py-3 rounded-xl border transition"
                        style={{ borderColor: accent === hex ? hex : "transparent", background: hex + "18" }}>
                        <div className="w-7 h-7 rounded-full" style={{ background: hex, boxShadow: accent === hex ? `0 0 12px ${hex}80` : "none" }} />
                        <span className="text-[10px] text-slate-400">{l}</span>
                        {accent === hex && <div className="w-1.5 h-1.5 rounded-full" style={{ background: hex }} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Card Background</div>
                  <div className="grid grid-cols-3 gap-2">
                    {CARD_BG_OPTIONS.map(({ hex, label: l }) => (
                      <button key={hex} onClick={() => upd({ cardBg: hex })}
                        className="flex flex-col items-center gap-1.5 py-3 rounded-xl border transition"
                        style={{ borderColor: cardBg === hex ? accent : "#1e293b", background: hex }}>
                        <span className="text-xs text-slate-300 font-medium">{l}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{hex}</span>
                        {cardBg === hex && <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── DASHBOARD SECTIONS ── */}
            {open && id === "dashboard" && (
              <div className="px-4 pb-4 border-t border-slate-800">
                {/* Show / Hide */}
                <div className="flex justify-between items-center pt-3 pb-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Show / Hide</span>
                  <button onClick={() => upd({ dashVisibility: DEFAULT_SETTINGS().dashVisibility })}
                    className="text-xs font-medium" style={{ color: accent }}>Show all</button>
                </div>
                {DASH_SECTION_META.map(({ key, label: l, icon: ic }) => {
                  const on = vis[key] !== false;
                  return (
                    <div key={key} className="flex items-center justify-between py-2.5 border-b border-slate-800/50 last:border-0">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm">{ic}</span>
                        <span className={cx("text-sm", on ? "text-slate-200" : "text-slate-500 line-through")}>{l}</span>
                      </div>
                      <ToggleSwitch on={on} accent={accent} onChange={() => updNested("dashVisibility", key, !on)} />
                    </div>
                  );
                })}
                {/* Section Order */}
                <div className="flex justify-between items-center pt-4 pb-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Section Order</span>
                  <button onClick={() => upd({ dashSectionOrder: DEFAULT_SETTINGS().dashSectionOrder })}
                    className="text-xs font-medium" style={{ color: accent }}>Reset</button>
                </div>
                {(() => {
                  const allKeys = DASH_SECTION_META.map((m) => m.key);
                  const stored = (settings.dashSectionOrder as string[] | undefined);
                  const order = (stored && Array.isArray(stored) && stored.length === allKeys.length) ? stored : allKeys;
                  const moveFn = (key: string, dir: -1 | 1) => {
                    const idx = order.indexOf(key);
                    if (idx < 0) return;
                    const newIdx = idx + dir;
                    if (newIdx < 0 || newIdx >= order.length) return;
                    const next = [...order];
                    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
                    upd({ dashSectionOrder: next });
                  };
                  return order.map((key, i) => {
                    const meta = DASH_SECTION_META.find((m) => m.key === key);
                    if (!meta) return null;
                    return (
                      <div key={key} className="flex items-center gap-3 py-2 border-b border-slate-800/50 last:border-0">
                        <span className="text-[11px] text-slate-600 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-sm shrink-0">{meta.icon}</span>
                        <span className="text-sm text-slate-300 flex-1 min-w-0">{meta.label}</span>
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button onClick={() => moveFn(key, -1)} disabled={i === 0}
                            className="p-1 rounded text-slate-600 hover:text-amber-400 disabled:opacity-20 transition">
                            <ChevronUp size={13} />
                          </button>
                          <button onClick={() => moveFn(key, 1)} disabled={i === order.length - 1}
                            className="p-1 rounded text-slate-600 hover:text-amber-400 disabled:opacity-20 transition">
                            <ChevronDown size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {/* ── JOURNAL DEFAULTS ── */}
            {open && id === "journal" && (
              <div className="px-4 pb-4 border-t border-slate-800">
                <SettingRow label="Default Market" sub="Auto-selected when you open Log Trade">
                  <ChipSelect options={MARKET_TYPES} value={settings.defaultMarket || "Forex"} onChange={(v) => upd({ defaultMarket: v })} accent={accent} />
                </SettingRow>
                <SettingRow label="Default Side" sub="Buy or Sell pre-selected">
                  <ChipSelect options={["Buy", "Sell"]} value={settings.defaultSide || "Buy"} onChange={(v) => upd({ defaultSide: v })} accent={accent} />
                </SettingRow>
                <SettingRow label="Default Session" sub="Pre-fill the session field">
                  <ChipSelect options={["", ...SESSION_OPTIONS.filter((s) => s !== "Unspecified")]} value={settings.defaultSession || ""} onChange={(v) => upd({ defaultSession: v })} accent={accent} />
                </SettingRow>
                <SettingRow label="Default Trade Type">
                  <ChipSelect options={["Normal", "Impulse"]} value={settings.defaultTradeType || "Normal"} onChange={(v) => upd({ defaultTradeType: v })} accent={accent} />
                </SettingRow>
                <SettingRow label="Default Risk %" sub="Pre-filled risk per trade">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {["0.5", "1", "1.5", "2", "2.5", "3"].map((v) => (
                      <button key={v} onClick={() => upd({ defaultRiskPct: v })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                        style={settings.defaultRiskPct === v ? { background: accent + "20", borderColor: accent + "60", color: accent } : { background: "#0f172a", borderColor: "#334155", color: "#94a3b8" }}>
                        {v}%
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow label="Default Symbol" sub="Auto-fill the symbol field (optional)">
                  <input value={settings.defaultSymbol || ""} onChange={(e) => upd({ defaultSymbol: e.target.value })}
                    placeholder="e.g. EURUSD"
                    className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-slate-500 text-right uppercase" />
                </SettingRow>
              </div>
            )}

            {/* ── RISK RULES ── */}
            {open && id === "risk" && (
              <div className="px-4 pb-4 border-t border-slate-800">
                <SettingRow label="Max Daily Loss %" sub="Triggers risk alert when breached (overrides master plan)">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {["1", "2", "3", "4", "5"].map((v) => (
                      <button key={v} onClick={() => upd({ maxDailyLossPct: v })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                        style={(settings.maxDailyLossPct || "3") === v ? { background: "#f43f5e20", borderColor: "#f43f5e60", color: "#f43f5e" } : { background: "#0f172a", borderColor: "#334155", color: "#94a3b8" }}>
                        {v}%
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow label="Max Risk Per Trade %" sub="Soft limit reminder on the form">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {["1", "2", "3", "5"].map((v) => (
                      <button key={v} onClick={() => upd({ maxRiskPerTrade: v })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                        style={(settings.maxRiskPerTrade || "2") === v ? { background: accent + "20", borderColor: accent + "60", color: accent } : { background: "#0f172a", borderColor: "#334155", color: "#94a3b8" }}>
                        {v}%
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow label="Single Trade Alert %" sub="Alert if one trade loses more than this">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {["1", "2", "3", "5"].map((v) => (
                      <button key={v} onClick={() => upd({ singleTradeLossAlertPct: v })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                        style={(settings.singleTradeLossAlertPct || "3") === v ? { background: "#f43f5e20", borderColor: "#f43f5e60", color: "#f43f5e" } : { background: "#0f172a", borderColor: "#334155", color: "#94a3b8" }}>
                        {v}%
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow label="Max Trades Per Day" sub="Reminder only (no hard block)">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {["", "1", "2", "3", "5", "10"].map((v) => (
                      <button key={v || "none"} onClick={() => upd({ maxTradesPerDay: v })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                        style={(settings.maxTradesPerDay || "") === v ? { background: accent + "20", borderColor: accent + "60", color: accent } : { background: "#0f172a", borderColor: "#334155", color: "#94a3b8" }}>
                        {v || "Off"}
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow label="Max Open Trades" sub="Warning when exceeded">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {["", "1", "2", "3", "5"].map((v) => (
                      <button key={v || "none"} onClick={() => upd({ maxOpenTrades: v })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                        style={(settings.maxOpenTrades || "") === v ? { background: accent + "20", borderColor: accent + "60", color: accent } : { background: "#0f172a", borderColor: "#334155", color: "#94a3b8" }}>
                        {v || "Off"}
                      </button>
                    ))}
                  </div>
                </SettingRow>
              </div>
            )}

            {/* ── DISPLAY ── */}
            {open && id === "display" && (
              <div className="px-4 pb-4 border-t border-slate-800">
                <SettingRow label="Date Format">
                  <ChipSelect options={["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]} value={settings.dateFormat || "DD/MM/YYYY"} onChange={(v) => upd({ dateFormat: v })} accent={accent} />
                </SettingRow>
                <SettingRow label="Time Format">
                  <ChipSelect options={["24h", "12h"]} value={settings.timeFormat || "24h"} onChange={(v) => upd({ timeFormat: v })} accent={accent} />
                </SettingRow>
                <SettingRow label="P&L Display" sub="How profit/loss shows in tables">
                  <ChipSelect options={["currency", "R-multiple", "both"]} value={settings.pnlDisplay || "currency"} onChange={(v) => upd({ pnlDisplay: v })} accent={accent} />
                </SettingRow>
                <SettingRow label="Compact Mode" sub="Smaller cards, denser layout">
                  <ToggleSwitch on={!!settings.compactMode} accent={accent} onChange={() => upd({ compactMode: !settings.compactMode })} />
                </SettingRow>
              </div>
            )}

            {/* ── APP BEHAVIOUR ── */}
            {open && id === "behaviour" && (
              <div className="px-4 pb-4 border-t border-slate-800">
                <SettingRow label="Quick-Log FAB Button" sub="Floating ＋ button on dashboard">
                  <ToggleSwitch on={settings.showQuickLogFAB !== false} accent={accent} onChange={() => upd({ showQuickLogFAB: !settings.showQuickLogFAB })} />
                </SettingRow>
                <SettingRow label="Search Button" sub="Search icon in top bar">
                  <ToggleSwitch on={settings.showSearchBar !== false} accent={accent} onChange={() => upd({ showSearchBar: !settings.showSearchBar })} />
                </SettingRow>
                <SettingRow label="Default Landing Tab" sub="Which tab opens on app start">
                  <ChipSelect options={["home", "journal", "library", "academy", "more"]} value={settings.defaultTab || "home"} onChange={(v) => upd({ defaultTab: v })} accent={accent} />
                </SettingRow>
                <div className="pt-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">More Menu Tabs</div>
                  {["Account", "Session", "Plans", "Psychology", "Vault", "Prop", "Backup", "Report"].map((t) => {
                    const on = moreVis[t] !== false;
                    return (
                      <div key={t} className="flex items-center justify-between py-2.5 border-b border-slate-800/50 last:border-0">
                        <span className={cx("text-sm", on ? "text-slate-200" : "text-slate-500")}>{t}</span>
                        <ToggleSwitch on={on} accent={accent} onChange={() => updNested("moreTabVisibility", t, !on)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── NAVIGATION VISIBILITY ── */}
            {open && id === "nav" && (
              <div className="px-4 pb-4 border-t border-slate-800">
                <div className="text-xs text-slate-500 pt-3 pb-2">Home and More tabs are always visible.</div>
                {[
                  { key: "journal", label: "Journal", icon: "📓" },
                  { key: "library", label: "Library", icon: "📚" },
                  { key: "academy", label: "Academy", icon: "🎓" },
                ].map(({ key, label: l, icon: ic }) => {
                  const on = navVis[key] !== false;
                  return (
                    <div key={key} className="flex items-center justify-between py-3 border-b border-slate-800/50 last:border-0">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm">{ic}</span>
                        <span className={cx("text-sm", on ? "text-slate-200" : "text-slate-500 line-through")}>{l}</span>
                      </div>
                      <ToggleSwitch on={on} accent={accent} onChange={() => updNested("navVisibility", key, !on)} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── NOTIFICATIONS ── */}
            {open && id === "notifs" && (
              <div className="px-4 pb-4 border-t border-slate-800">
                <div className="flex justify-between items-center pt-3 pb-2">
                  <span className="text-xs text-slate-500">Toggle which alerts appear as toasts and in the bell inbox</span>
                  <button onClick={() => {
                    Object.keys(DEFAULT_SETTINGS().notifications).forEach((k) => updNotif(k, true));
                  }} className="text-xs font-medium" style={{ color: accent }}>Enable all</button>
                </div>
                {([
                  { key: "dailyLossLimit",        icon: "🛑", label: "Daily Loss Limit Hit",           group: "Risk" },
                  { key: "singleTradeLoss",        icon: "⚠",  label: "Large Single-Trade Loss",        group: "Risk" },
                  { key: "overtradingWarning",     icon: "⚠",  label: "Max Trades Per Day Reached",     group: "Risk" },
                  { key: "maxOpenTrades",          icon: "⚠",  label: "Max Open Trades Reached",        group: "Risk" },
                  { key: "losingStreak",           icon: "🩸", label: "Losing Streak (3+ losses)",      group: "Streaks" },
                  { key: "winningStreak",          icon: "🔥", label: "Winning Streak (3+ wins)",       group: "Streaks" },
                  { key: "winRateDropping",        icon: "📉", label: "Win Rate Dropping",              group: "Edge" },
                  { key: "profitFactorBelow1",     icon: "🚨", label: "Profit Factor Below 1",          group: "Edge" },
                  { key: "bigWin",                 icon: "💰", label: "Big Winner (3R+)",               group: "Trades" },
                  { key: "bigLoss",                icon: "🩸", label: "Large Loss (2R+)",               group: "Trades" },
                  { key: "ungradedTrades",         icon: "📝", label: "Ungraded Trades Reminder",       group: "Trades" },
                  { key: "dailyGoalHit",           icon: "✅", label: "Daily Goal Reached",             group: "Trades" },
                  { key: "propDailyLossApproach",  icon: "⚠",  label: "Prop Daily DD Approaching",     group: "Prop" },
                  { key: "propDailyLossHit",       icon: "🛑", label: "Prop Daily Loss Limit Hit",      group: "Prop" },
                  { key: "propTargetReached",      icon: "🏆", label: "Prop Challenge Target Hit",      group: "Prop" },
                  { key: "propMaxDrawdown",        icon: "🚨", label: "Prop Max Drawdown Near",         group: "Prop" },
                  { key: "drawdownWarning",        icon: "⚠",  label: "Account Drawdown (5%+)",         group: "Account" },
                  { key: "newAllTimeHigh",         icon: "🚀", label: "New Account All-Time High",      group: "Account" },
                  { key: "weeklyGreen",            icon: "✅", label: "Green Week Summary",             group: "Weekly" },
                  { key: "weeklyRed",              icon: "📉", label: "Red Week Summary",               group: "Weekly" },
                  { key: "monthlyReview",          icon: "📋", label: "Monthly Review Reminder",        group: "Monthly" },
                  { key: "tradesMilestone",        icon: "🎯", label: "Trade Count Milestones",         group: "Monthly" },
                  { key: "bestSetupAlert",         icon: "🏅", label: "Best Setup Performance",         group: "Insights" },
                  { key: "psychologyReminder",     icon: "🧠", label: "Psychology Log Reminder",        group: "Habits" },
                  { key: "vaultReminder",          icon: "📒", label: "Vault Review Reminder",          group: "Habits" },
                ] as { key: string; icon: string; label: string; group: string }[]).reduce((acc: any[], item) => {
                  const last = acc[acc.length - 1];
                  if (!last || last.group !== item.group) acc.push({ group: item.group, items: [item] });
                  else last.items.push(item);
                  return acc;
                }, []).map(({ group, items }: any) => (
                  <div key={group} className="mb-3">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1 mt-2">{group}</div>
                    {items.map(({ key, icon: ic, label: l }: any) => {
                      const on = notifSettings[key] !== false;
                      return (
                        <div key={key} className="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm w-5 text-center">{ic}</span>
                            <span className={cx("text-sm", on ? "text-slate-200" : "text-slate-500")}>{l}</span>
                          </div>
                          <ToggleSwitch on={on} accent={accent} onChange={() => updNotif(key, !on)} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Reset */}
      <button onClick={() => setData((d: any) => ({ ...d, settings: DEFAULT_SETTINGS() }))}
        className="w-full py-3 rounded-xl border border-slate-700 text-slate-400 text-sm hover:border-rose-500/40 hover:text-rose-400 transition mt-2">
        ↺ Reset all settings to default
      </button>
    </div>
  );
}

/* ============================================================
   OWNER CONTROL PANEL
   ============================================================ */
const OWNER_PASSWORD = "1996";
const OWNER_SESSION_KEY = "otx_owner_unlocked";

function OwnerImport({ data, setData, accent, showToast }: any) {
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [confirmImport, setConfirmImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || typeof parsed !== "object") throw new Error("bad");
      setData((d: any) => ({
        ...DEFAULT_DATA(),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS(), ...(parsed.settings || {}), ...(d.settings || {}) },
        account: parsed.account || d.account || { startingBalance: 1000, currency: "€" },
      }));
      setImportText(""); setImportError(""); setConfirmImport(false);
      showToast("✅ Data imported successfully");
    } catch {
      setImportError("Invalid JSON — check the file wasn't truncated.");
      setConfirmImport(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setImportText((ev.target?.result as string) || ""); setImportError(""); };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle sub="Restore from a previously downloaded backup">Import Backup</SectionTitle>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
        <button onClick={() => fileRef.current?.click()}
          className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-600 hover:border-slate-500 text-slate-400 text-sm transition">
          <Upload size={15} /> Choose .json backup file
        </button>
        <TextArea value={importText} onChange={(e: any) => setImportText(e.target.value)}
          placeholder="Or paste JSON backup here..."
          className="min-h-[100px] text-[11px] font-mono mt-3" />
        {importError && <p className="text-xs text-rose-400 mt-1.5">{importError}</p>}
        <button onClick={() => importText.trim() && setConfirmImport(true)}
          className="w-full mt-3 py-3 rounded-xl font-semibold text-sm transition"
          style={{ background: importText.trim() ? accent : "#334155", color: importText.trim() ? "#0f172a" : "#64748b" }}
          disabled={!importText.trim()}>
          Import &amp; Restore
        </button>
      </Card>
      <ConfirmDialog open={confirmImport} title="Overwrite all data?"
        body="Your current trades, setups, plans, vault notes, and challenges will be replaced with the imported data."
        onConfirm={doImport} onCancel={() => setConfirmImport(false)} />
    </div>
  );
}

function OwnerPanel({ data, setData }: any) {
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(OWNER_SESSION_KEY) === "true"; } catch { return false; }
  });
  const [pin, setPin] = useState("");
  const [wrongPin, setWrongPin] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | { title: string; body: string; onConfirm: () => void }>(null);
  const [toast, setToast] = useState("");
  const [activeSection, setActiveSection] = useState("stats");
  const accent = (data as any)?.settings?.accentColor || "#f59e0b";

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const unlock = () => {
    if (pin === OWNER_PASSWORD) {
      setUnlocked(true);
      try { sessionStorage.setItem(OWNER_SESSION_KEY, "true"); } catch {}
      setPin(""); setWrongPin(false);
    } else {
      setWrongPin(true); setPin("");
    }
  };

  const lock = () => {
    setUnlocked(false);
    try { sessionStorage.removeItem(OWNER_SESSION_KEY); } catch {}
  };

  const downloadFile = (content: string, filename: string, type = "application/json") => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadFullBackup = () => {
    downloadFile(JSON.stringify(data, null, 2), `onkar-tradex-backup-${todayISO()}.json`);
    showToast("✅ Full backup downloaded");
  };

  const downloadTradesCSV = () => {
    const trades = (data as any).trades || [];
    const headers = ["date","symbol","market","side","session","entry","exit","sl","tp","riskPct","positionSize","tradeType","notes","grade","result","pnl","rMultiple"];
    const rows = trades.map((t: any) => {
      const c = computeTrade(t);
      return [t.date,t.symbol,t.market,t.side,t.session,t.entry,t.exit,t.sl,t.tp,t.riskPct,t.positionSize,t.tradeType,
        (t.notes||"").replace(/[\r\n,]+/g," "),t.grade||"",c.result||"",c.pnl??"",c.rMultiple??""
      ].join(",");
    });
    downloadFile([headers.join(","), ...rows].join("\n"), `onkar-tradex-trades-${todayISO()}.csv`, "text/csv");
    showToast("✅ Trades CSV downloaded");
  };

  const downloadSetupsCSV = () => {
    const setups = (data as any).setups || [];
    const headers = ["name","trend","entry","stop","target","notes"];
    const rows = setups.map((s: any) => [s.name,s.trend,s.entry,s.stop,s.target,(s.notes||"").replace(/[\r\n,]+/g," ")].join(","));
    downloadFile([headers.join(","), ...rows].join("\n"), `onkar-tradex-setups-${todayISO()}.csv`, "text/csv");
    showToast("✅ Setups CSV downloaded");
  };

  const downloadVaultTXT = () => {
    const vault = (data as any).vault || [];
    const content = vault.map((n: any) => `=== ${n.title} [${n.folder}] ===\n${n.body}\n`).join("\n\n");
    downloadFile(content, `onkar-tradex-vault-${todayISO()}.txt`, "text/plain");
    showToast("✅ Vault notes downloaded");
  };

  const downloadSettingsJSON = () => {
    downloadFile(JSON.stringify((data as any).settings || {}, null, 2), `onkar-tradex-settings-${todayISO()}.json`);
    showToast("✅ Settings downloaded");
  };

  const stats = useMemo(() => {
    const d = data as any;
    const trades = d.trades || [];
    const computed = trades.map((t: any) => computeTrade(t));
    const closed = computed.filter((c: any) => c.result !== null);
    const wins = closed.filter((c: any) => (c.pnl || 0) > 0);
    const totalPnl = closed.reduce((s: number, c: any) => s + (c.pnl || 0), 0);
    const totalBytes = JSON.stringify(d).length;
    return {
      totalTrades: trades.length,
      closedTrades: closed.length,
      wins: wins.length,
      totalPnl,
      setups: (d.setups || []).length,
      strategies: (d.strategies || []).length,
      vaultNotes: (d.vault || []).length,
      smcTerms: (d.smc || []).length,
      propChallenges: (d.propChallenges || []).length,
      dataKB: Math.round(totalBytes / 1024),
    };
  }, [data]);

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: accent + "20" }}>
          <Lock size={28} style={{ color: accent }} />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-slate-100" style={{ fontFamily: "'Sora', sans-serif" }}>Owner Control</h2>
          <p className="text-sm text-slate-500 mt-1">Enter your owner password to continue</p>
        </div>
        <div className="w-full max-w-xs space-y-3">
          <input
            type="password"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setWrongPin(false); }}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            placeholder="••••"
            className={cx(
              "w-full bg-slate-900 border rounded-xl px-4 py-3 text-slate-100 text-center text-2xl tracking-[0.5em] outline-none focus:border-slate-600 transition",
              wrongPin ? "border-rose-500" : "border-slate-700"
            )}
            autoFocus
          />
          {wrongPin && <p className="text-rose-400 text-sm text-center animate-pulse">Incorrect password</p>}
          <button onClick={unlock}
            className="w-full py-3 rounded-xl font-semibold text-slate-950 transition active:scale-95"
            style={{ background: accent }}>
            Unlock Owner Panel
          </button>
        </div>
      </div>
    );
  }

  const OWNER_SECTIONS = [
    { id: "stats",    label: "Stats",    icon: BarChart3 },
    { id: "backup",   label: "Backup",   icon: Download },
    { id: "import",   label: "Import",   icon: Upload },
    { id: "data",     label: "Data",     icon: Trash2 },
    { id: "settings", label: "Settings", icon: Shield },
  ];

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: accent + "25" }}>
            <Shield size={18} style={{ color: accent }} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">Owner Control</h2>
            <p className="text-[11px] text-slate-500">Full access · Session unlocked</p>
          </div>
        </div>
        <button onClick={lock}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-rose-400 transition">
          <Lock size={12} /> Lock
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {OWNER_SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveSection(id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition shrink-0"
            style={activeSection === id
              ? { background: accent, color: "#0f172a" }
              : { background: "#0f172a", border: "1px solid #1e293b", color: "#94a3b8" }}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {activeSection === "stats" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Total Trades",     value: stats.totalTrades,       tone: "accent" },
              { label: "Closed Trades",    value: stats.closedTrades,      tone: "slate" },
              { label: "Total Wins",       value: stats.wins,              tone: "emerald" },
              { label: "Total P&L",        value: `${stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}`, tone: stats.totalPnl >= 0 ? "emerald" : "rose" },
              { label: "Setups",           value: stats.setups,            tone: "slate" },
              { label: "Strategies",       value: stats.strategies,        tone: "slate" },
              { label: "Vault Notes",      value: stats.vaultNotes,        tone: "slate" },
              { label: "SMC Terms",        value: stats.smcTerms,          tone: "slate" },
              { label: "Prop Challenges",  value: stats.propChallenges,    tone: "slate" },
              { label: "Data Size",        value: `${stats.dataKB} KB`,    tone: "slate" },
            ].map(({ label, value, tone }) => (
              <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className={cx("text-xl font-bold",
                  tone === "accent" ? "" : tone === "emerald" ? "text-emerald-400" : tone === "rose" ? "text-rose-400" : "text-slate-100"
                )} style={tone === "accent" ? { color: accent } : {}}>{value}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-600 text-center pt-1">Onkar TradeX · Owner Build</p>
        </div>
      )}

      {activeSection === "backup" && (
        <div className="space-y-3">
          <Card>
            <SectionTitle sub={`Complete data snapshot · ${stats.dataKB} KB`}>Full Backup</SectionTitle>
            <div className="space-y-2 mt-3">
              <button onClick={downloadFullBackup}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900 transition text-left">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: accent + "20" }}>
                  <Download size={16} style={{ color: accent }} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-200">Download Full Backup</div>
                  <div className="text-[11px] text-slate-500">All data as onkar-tradex-backup.json</div>
                </div>
              </button>
              <button onClick={downloadSettingsJSON}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900 transition text-left">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-violet-500/10">
                  <FileText size={16} className="text-violet-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-200">Download Settings Only</div>
                  <div className="text-[11px] text-slate-500">Theme, risk rules &amp; defaults · .json</div>
                </div>
              </button>
            </div>
          </Card>
          <Card>
            <SectionTitle sub="Export individual sections as CSV / TXT">Export Data Files</SectionTitle>
            <div className="space-y-2 mt-3">
              {[
                { label: "Trades CSV",      sub: `${stats.totalTrades} trade${stats.totalTrades !== 1 ? "s" : ""}`,      fn: downloadTradesCSV,  color: "#10b981", Icon: BarChart3 },
                { label: "Setups CSV",      sub: `${stats.setups} setup${stats.setups !== 1 ? "s" : ""}`,                fn: downloadSetupsCSV,  color: "#3b82f6", Icon: Layers },
                { label: "Vault Notes TXT", sub: `${stats.vaultNotes} note${stats.vaultNotes !== 1 ? "s" : ""}`,         fn: downloadVaultTXT,   color: "#f59e0b", Icon: BookMarked },
              ].map(({ label, sub, fn, color, Icon }) => (
                <button key={label} onClick={fn}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900 transition text-left">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: color + "20" }}>
                    <Icon size={14} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200">{label}</div>
                    <div className="text-[11px] text-slate-500">{sub}</div>
                  </div>
                  <Download size={13} className="text-slate-600 shrink-0" />
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {activeSection === "import" && (
        <OwnerImport data={data} setData={setData} accent={accent} showToast={showToast} />
      )}

      {activeSection === "data" && (
        <div className="space-y-3">
          <Card>
            <SectionTitle sub="Remove specific data categories">Targeted Clear</SectionTitle>
            <div className="space-y-2 mt-3">
              {[
                { label: "Clear All Trades",       sub: `${stats.totalTrades} trades, check-ins & pre-sessions`,  fn: () => setData((d: any) => ({ ...d, trades: [], checkins: [], preSession: [] })),       tone: "rose" },
                { label: "Clear Vault Notes",       sub: `${stats.vaultNotes} notes (resets to starter content)`, fn: () => setData((d: any) => ({ ...d, vault: seedVault() })),                              tone: "amber" },
                { label: "Clear Psychology Log",    sub: "Remove all mistake & mindset entries",                   fn: () => setData((d: any) => ({ ...d, psychology: [] })),                                 tone: "violet" },
                { label: "Clear Prop Challenges",   sub: `${stats.propChallenges} challenge${stats.propChallenges !== 1 ? "s" : ""}`, fn: () => setData((d: any) => ({ ...d, propChallenges: [] })),          tone: "sky" },
              ].map(({ label, sub, fn, tone }) => (
                <button key={label}
                  onClick={() => setConfirmAction({ title: label + "?", body: sub + " — this cannot be undone.", onConfirm: () => { fn(); setConfirmAction(null); showToast("✅ Done"); } })}
                  className={cx("w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition text-left",
                    tone === "rose" ? "border-rose-500/20 hover:border-rose-500/40" :
                    tone === "amber" ? "border-amber-500/20 hover:border-amber-500/40" :
                    "border-slate-700 hover:border-slate-600"
                  )} style={{ background: "#0f172a" }}>
                  <Trash2 size={14} className={
                    tone === "rose" ? "text-rose-400" : tone === "amber" ? "text-amber-400" :
                    tone === "violet" ? "text-violet-400" : "text-sky-400"
                  } />
                  <div>
                    <div className="text-sm font-medium text-slate-200">{label}</div>
                    <div className="text-[11px] text-slate-500">{sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Card className="border-rose-500/20">
            <SectionTitle sub="Wipes everything and restores seed content">Factory Reset</SectionTitle>
            <p className="text-xs text-slate-500 mt-2 mb-3">
              All trades, plans, notes, vault, settings, psychology logs, and challenges will be permanently deleted.
              The app returns to its original starter state.
            </p>
            <button
              onClick={() => setConfirmAction({
                title: "Factory Reset?",
                body: "This will permanently delete ALL your data and restore the app to its original state. This cannot be undone.",
                onConfirm: () => { setData(DEFAULT_DATA()); setConfirmAction(null); showToast("✅ Factory reset complete"); }
              })}
              className="w-full py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold text-sm hover:bg-rose-500/20 transition">
              ⚠ Factory Reset — Delete Everything
            </button>
          </Card>
        </div>
      )}

      {activeSection === "settings" && (
        <SettingsPanel data={data} setData={setData} />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-100 shadow-xl pointer-events-none">
          {toast}
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog open={true}
          title={confirmAction.title}
          body={confirmAction.body}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)} />
      )}
    </div>
  );
}

function MoreTab({ data, setData, subTab, setSubTab, goTo }) {
  const ALL_TABS = ["Account", "Session", "Plans", "Psychology", "Vault", "Prop", "Backup", "Report", "Settings", "Owner"];
  const moreVis = (data as any)?.settings?.moreTabVisibility || {};
  const tabs = ALL_TABS.filter((t) => t === "Settings" || t === "Owner" || moreVis[t] !== false);
  const accent = (data as any)?.settings?.accentColor || "#f59e0b";

  if (subTab === "Report") {
    return <PerformanceReport data={data} onClose={() => setSubTab("Account")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((t) => (
          <button key={t} onClick={() => setSubTab(t)}
            className={cx("px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition flex items-center gap-1.5",
              subTab === t ? "text-slate-950" : "bg-slate-900 border border-slate-800 text-slate-400")}
            style={subTab === t ? { background: t === "Owner" ? accent : accent } : t === "Owner" ? { background: "#0f172a", border: "1px solid #334155" } : {}}>
            {t === "Owner" && <Lock size={11} className={subTab === t ? "text-slate-950" : "text-slate-500"} />}
            {t}
          </button>
        ))}
      </div>
      {subTab === "Account" && <AccountSettings data={data} setData={setData} />}
      {subTab === "Session" && <SessionPlanPanel data={data} setData={setData} />}
      {subTab === "Plans" && <PlansPanel data={data} setData={setData} goTo={goTo} />}
      {subTab === "Psychology" && <PsychologyPanel data={data} setData={setData} goTo={goTo} />}
      {subTab === "Vault" && <VaultPanel data={data} setData={setData} goTo={goTo} />}
      {subTab === "Prop" && <PropChallengesPanel data={data} setData={setData} />}
      {subTab === "Backup" && <BackupPanel data={data} setData={setData} />}
      {subTab === "Settings" && <SettingsPanel data={data} setData={setData} />}
      {subTab === "Owner" && <OwnerPanel data={data} setData={setData} />}
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

/* ============================================================
   LIVE RISK ALERT OVERLAY
   ============================================================ */
type RiskAlert = {
  type: "daily_loss" | "trade_loss";
  todayLossAmt: number;
  limitAmt: number;
  limitPct: number;
  currency: string;
  tradePnl?: number;
  tradeSymbol?: string;
  overByAmt: number;
  overByPct: number;
};

function RiskAlertOverlay({ alert, onDismiss }: { alert: RiskAlert; onDismiss: () => void }) {
  const isDailyBreach = alert.type === "daily_loss";
  const cur = alert.currency;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4"
      onClick={onDismiss}>
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        {/* Pulsing danger ring */}
        <div className="relative mb-4 flex justify-center">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-rose-500/20 animate-ping" />
          </div>
          <div className="relative w-16 h-16 rounded-full bg-rose-500/25 border-2 border-rose-500/60 flex items-center justify-center">
            <span className="text-3xl">⛔</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border-2 border-rose-500/60 rounded-2xl overflow-hidden shadow-2xl shadow-rose-500/20">
          {/* Red header stripe */}
          <div className="bg-gradient-to-r from-rose-600 to-rose-700 px-5 py-3.5">
            <div className="text-white font-bold text-base" style={{ fontFamily: "'Sora',sans-serif" }}>
              {isDailyBreach ? "⛔ Daily Loss Limit Breached" : "⛔ Trade Loss Alert"}
            </div>
            <div className="text-rose-200 text-xs mt-0.5">
              {isDailyBreach ? "Stop trading now — rule triggered" : "Loss exceeds per-trade risk threshold"}
            </div>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {isDailyBreach ? (
              <>
                {/* Big loss number */}
                <div className="text-center py-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1">Today's Total Loss</div>
                  <div className="text-4xl font-bold text-rose-400" style={{ fontFamily: "'Sora',sans-serif" }}>
                    -{cur}{alert.todayLossAmt.toFixed(2)}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">
                    Limit was {cur}{alert.limitAmt.toFixed(2)} ({alert.limitPct}%)
                  </div>
                </div>

                {/* Progress bar — full and over */}
                <div>
                  <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full w-full" />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>0</span>
                    <span className="text-rose-400 font-semibold">
                      {cur}{alert.overByAmt.toFixed(2)} OVER limit ({alert.overByPct.toFixed(1)}% over)
                    </span>
                    <span>Limit</span>
                  </div>
                </div>

                {/* What to do */}
                <div className="bg-rose-500/10 border border-rose-500/25 rounded-xl p-3.5 space-y-2">
                  <div className="text-xs font-semibold text-rose-300 uppercase tracking-widest">What to do now</div>
                  <ul className="space-y-1.5">
                    {["Close the platform — do NOT take any more trades today", "Log what happened and review the losses calmly", "Come back tomorrow with a clear head", "Do NOT revenge trade to recover losses"].map((r, i) => (
                      <li key={i} className="flex gap-2 text-xs text-slate-300">
                        <span className="text-rose-400 mt-0.5 shrink-0">▸</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <>
                <div className="text-center py-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1">Single Trade Loss</div>
                  <div className="text-4xl font-bold text-rose-400" style={{ fontFamily: "'Sora',sans-serif" }}>
                    -{cur}{Math.abs(alert.tradePnl || 0).toFixed(2)}
                  </div>
                  {alert.tradeSymbol && <div className="text-sm text-slate-400 mt-1">{alert.tradeSymbol}</div>}
                  <div className="text-sm text-slate-400 mt-1">
                    Exceeds {alert.limitPct}% risk ({cur}{alert.limitAmt.toFixed(2)})
                  </div>
                </div>
                <div className="bg-rose-500/10 border border-rose-500/25 rounded-xl p-3.5">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    This loss exceeded your per-trade risk limit. Review your position sizing rules and ensure every trade is sized according to your plan before entering.
                  </p>
                </div>
              </>
            )}

            {/* Dismiss button */}
            <button onClick={onDismiss}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm text-slate-300 font-medium transition">
              I understand — Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App({ onLogout }: { onLogout?: () => void } = {}) {
  const [data, setDataRaw] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [librarySubTab, setLibrarySubTab] = useState("Setups");
  const [academySubTab, setAcademySubTab] = useState("Price Action");
  const [moreSubTab, setMoreSubTab] = useState("Plans");
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [riskAlert, setRiskAlert] = useState<RiskAlert | null>(null);
  const dismissedAtRef = useRef<number>(0);
  const saveTimer = useRef(null);

  /* ── Notification state ── */
  const [notifCentreOpen, setNotifCentreOpen] = useState(false);
  const [notifs, setNotifs] = useState<OTXNotif[]>([]);
  const [toastQueue, setToastQueue] = useState<OTXNotif[]>([]);
  const prevNotifIds = useRef<Set<string>>(new Set());

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

  /* ── Accent color CSS variable injection ── */
  useEffect(() => {
    if (!data) return;
    const d = data as any;
    const accent = d.settings?.accentColor || "#f59e0b";
    const cardBg = d.settings?.cardBg || "#0f172a";
    document.documentElement.style.setProperty("--otx-accent", accent);
    document.documentElement.style.setProperty("--otx-card-bg", cardBg);
  }, [(data as any)?.settings?.accentColor, (data as any)?.settings?.cardBg]);

  /* ── Notification engine — re-runs whenever data changes ── */
  useEffect(() => {
    if (!data || !loaded) return;
    const enabled = { ...DEFAULT_SETTINGS().notifications, ...((data as any).settings?.notifications || {}) };
    const fresh = computeNotifications(data as any, enabled);
    setNotifs((prev) => {
      // preserve read state for existing notifs; add new ones as toasts
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const merged = fresh.map((n) => prevMap.has(n.id) ? { ...n, read: prevMap.get(n.id)!.read } : n);
      // find truly new ids (not seen before across any render)
      const newOnes = merged.filter((n) => !prevNotifIds.current.has(n.id));
      newOnes.forEach((n) => prevNotifIds.current.add(n.id));
      if (newOnes.length > 0) {
        setToastQueue((q) => [...q, ...newOnes].slice(-5)); // cap at 5 queued
      }
      return merged;
    });
  }, [data, loaded]);

  /* ── Live risk monitor — fires whenever trades or account change ── */
  useEffect(() => {
    if (!data || !loaded) return;

    const acc = data.account || { startingBalance: 1000, currency: "€" };
    const startBal = parseFloat(String(acc.startingBalance)) || 0;
    const cur = (acc.currency as string) || "€";
    if (startBal <= 0) return;

    const today = todayISO();
    const todayTrades = (data.trades || []).filter(
      (t: any) => t.date === today && computeTrade(t).result !== null
    );
    const todayNetPnl = todayTrades.reduce((s: number, t: any) => s + (computeTrade(t).pnl || 0), 0);
    const todayLossAmt = Math.max(0, -todayNetPnl);

    /* ── Check 1: Daily loss limit — settings override, then master plan ── */
    const settingsDailyPct = parseFloat((data as any).settings?.maxDailyLossPct || "") || 0;
    const planDailyPct     = parseFloat((data as any).plans?.master?.maxDailyLoss || "") || 0;
    const maxDailyLossPct  = settingsDailyPct || planDailyPct;

    if (maxDailyLossPct > 0) {
      const limitAmt = (maxDailyLossPct / 100) * startBal;
      if (todayLossAmt >= limitAmt && todayLossAmt > dismissedAtRef.current) {
        const overByAmt = todayLossAmt - limitAmt;
        const overByPct = limitAmt > 0 ? (overByAmt / limitAmt) * 100 : 0;
        setRiskAlert({ type: "daily_loss", todayLossAmt, limitAmt, limitPct: maxDailyLossPct, currency: cur, overByAmt, overByPct });
        return;
      }
      if (todayLossAmt < dismissedAtRef.current - 0.01) { dismissedAtRef.current = 0; setRiskAlert(null); }
      if (todayLossAmt < limitAmt) setRiskAlert(null);
    }

    /* ── Check 2: Single trade loss alert — threshold from settings (default 3%) ── */
    const singleAlertPct = parseFloat((data as any).settings?.singleTradeLossAlertPct || "") || 3;
    const sortedToday = [...todayTrades].sort((a: any, b: any) => (b.id || "").localeCompare(a.id || ""));
    const lastTrade = sortedToday[0];
    if (lastTrade) {
      const c = computeTrade(lastTrade);
      if (c.pnl !== null && c.pnl < 0) {
        const lossPct = (Math.abs(c.pnl) / startBal) * 100;
        if (maxDailyLossPct <= 0 && lossPct >= singleAlertPct) {
          const overByAmt = Math.abs(c.pnl) - (singleAlertPct / 100) * startBal;
          setRiskAlert({
            type: "trade_loss",
            todayLossAmt,
            limitAmt: (singleAlertPct / 100) * startBal,
            limitPct: singleAlertPct,
            currency: cur,
            tradePnl: c.pnl,
            tradeSymbol: lastTrade.symbol || "",
            overByAmt: Math.max(0, overByAmt),
            overByPct: Math.max(0, (overByAmt / ((singleAlertPct / 100) * startBal)) * 100),
          });
        }
      }
    }
  }, [data?.trades, data?.account, data?.plans, loaded]);

  if (!loaded || !data) {
    return (
      <div className="h-screen w-full bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/onkar-tradex-logo.png" alt="Onkar TradeX" className="w-16 h-16 object-contain animate-pulse drop-shadow-[0_0_20px_rgba(245,158,11,0.6)]" />
          <span className="text-slate-500 text-sm">Loading Onkar TradeX...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-slate-950" style={{ fontFamily: "'Inter', sans-serif", minHeight: "100dvh" }}>
      {/* Scrollable content — header scrolls with content, only bottom nav is fixed */}
      <div className="overflow-y-auto px-4 py-4"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "calc(72px + env(safe-area-inset-bottom))",
        }}>
        {/* Inline top header — scrolls away to give full screen to content */}
        {(() => {
          const accent = (data as any)?.settings?.accentColor || "#f59e0b";
          const unreadCount = notifs.filter((n) => !n.read).length;
          return (
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <img src="/onkar-tradex-logo.png" alt="Onkar TradeX" className="w-7 h-7 object-contain drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                <span className="font-semibold text-slate-100 text-sm" style={{ fontFamily: "'Sora', sans-serif" }}>Onkar TradeX</span>
              </div>
              <div className="flex items-center gap-1.5">
                <NotifBell count={unreadCount} accent={accent} onClick={() => {
                  setNotifCentreOpen(true);
                  setNotifs((n) => n.map((x) => ({ ...x, read: true })));
                }} />
                {(data as any)?.settings?.showSearchBar !== false && (
                  <button onClick={() => setSearchOpen(true)} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition">
                    <Search size={17} />
                  </button>
                )}
                {onLogout && (
                  <button onClick={onLogout} title="Log out"
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 transition">
                    <LogOut size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })()}
        {activeTab === "home" && <Dashboard data={data} setData={setData} goTo={goTo} onQuickLog={() => { setActiveTab("journal"); setQuickLogOpen(true); }} />}
        {activeTab === "journal" && <JournalTab data={data} setData={setData} autoOpen={quickLogOpen} onAutoOpenDone={() => setQuickLogOpen(false)} />}
        {activeTab === "library" && <LibraryTab data={data} setData={setData} subTab={librarySubTab} setSubTab={setLibrarySubTab} goTo={goTo} />}
        {activeTab === "academy" && <AcademyTab data={data} setData={setData} subTab={academySubTab} setSubTab={setAcademySubTab} goTo={goTo} />}
        {activeTab === "more" && <MoreTab data={data} setData={setData} subTab={moreSubTab} setSubTab={setMoreSubTab} goTo={goTo} />}
      </div>

      {/* Fixed bottom navigation — always visible, respects iPhone home indicator */}
      {(() => {
        const navVis = (data as any)?.settings?.navVisibility || {};
        const visibleNav = NAV_ITEMS.filter((it) => it.key === "home" || it.key === "more" || navVis[it.key] !== false);
        const cols = visibleNav.length;
        return (
          <div className={`fixed bottom-0 left-0 right-0 z-40 grid border-t border-slate-800 bg-slate-950/95 backdrop-blur`}
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, paddingBottom: "env(safe-area-inset-bottom)" }}>
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;
              return (
                <button key={item.key} onClick={() => setActiveTab(item.key)}
                  className="flex flex-col items-center justify-center gap-1 py-2.5">
                  <Icon size={19} style={{ color: isActive ? "var(--otx-accent,#f59e0b)" : undefined }} className={isActive ? "" : "text-slate-500"} />
                  <span className={cx("text-[10px] font-medium", isActive ? "" : "text-slate-500")}
                    style={{ color: isActive ? "var(--otx-accent,#f59e0b)" : undefined }}>{item.label}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {searchOpen && <SearchOverlay data={data} onClose={() => setSearchOpen(false)} onJump={goTo} />}

      {/* ── Notification Centre ── */}
      {notifCentreOpen && (
        <NotificationCentre
          notifs={notifs}
          accent={(data as any)?.settings?.accentColor || "#f59e0b"}
          onClose={() => setNotifCentreOpen(false)}
          onMarkAllRead={() => setNotifs((n) => n.map((x) => ({ ...x, read: true })))}
          onDismiss={(id: string) => setNotifs((n) => n.filter((x) => x.id !== id))}
        />
      )}

      {/* ── Toast queue — shows newest first, auto-dismisses ── */}
      {toastQueue.length > 0 && !notifCentreOpen && !riskAlert && (
        <NotifToast
          notif={toastQueue[0]}
          onDismiss={() => setToastQueue((q) => q.slice(1))}
        />
      )}

      {/* ── Live Risk Alert — auto fires when loss limit is breached ── */}
      {riskAlert && (
        <RiskAlertOverlay
          alert={riskAlert}
          onDismiss={() => {
            dismissedAtRef.current = riskAlert.todayLossAmt;
            setRiskAlert(null);
          }}
        />
      )}
    </div>
  );
}
