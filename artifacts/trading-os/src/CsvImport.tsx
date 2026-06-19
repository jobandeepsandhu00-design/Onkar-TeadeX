import React, { useState, useRef } from "react";
import { Upload, Download, X, CheckCircle2, AlertCircle, FileText } from "lucide-react";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cx = (...a: (string | boolean | undefined | null)[]) => a.filter(Boolean).join(" ");

/* ─── Trade shape (mirrors App.tsx) ─────────────────────────────────────── */
export interface ImportedTrade {
  id: string;
  date: string;
  symbol: string;
  market: string;
  side: string;
  entry: string;
  exit: string;
  sl: string;
  tp: string;
  positionSize: string;
  riskPct: string;
  fees: string;
  commission: string;
  session: string;
  entryTime: string;
  exitDate: string;
  exitTime: string;
  strategyId: string;
  setupId: string;
  notes: string;
  attachments: never[];
}

/* ─── CSV parsing ────────────────────────────────────────────────────────── */
type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  // Detect delimiter: tab if any header cell contains a tab, else comma
  const delim = lines[0].includes("\t") ? "\t" : ",";

  const headers = lines[0].split(delim).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delim).map((c) => c.replace(/^"|"$/g, "").trim());
    if (cells.every((c) => c === "")) continue;
    const row: Row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** Normalize header name to lowercase with no spaces/dots for comparison */
const n = (s: string) => s.toLowerCase().replace(/[\s._/#]/g, "");

type FormatId = "mt4" | "mt5" | "generic" | "unknown";

function detectFormat(headers: string[]): FormatId {
  const hn = headers.map(n);
  // MT4: has "openprice" or "opentime" + "closeprice"
  if (hn.includes("openprice") && hn.includes("closeprice")) return "mt4";
  if (hn.includes("opentime") && hn.includes("closeprice")) return "mt4";
  // MT5 deal-based: has "entry" col containing "in"/"out"
  if (hn.includes("entry") && hn.includes("deal")) return "mt5";
  // Generic (our template): has "entry" + "exit" + "side"
  if (hn.includes("entry") && hn.includes("exit") && hn.includes("side")) return "generic";
  return "unknown";
}

/* ─── Parse MT4 history statement (one row = one round-trip trade) ───────── */
function parseMt4Row(row: Row): ImportedTrade | null {
  const get = (keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(row).find((h) => n(h) === n(k));
      if (found !== undefined && row[found].trim()) return row[found].trim();
    }
    return "";
  };

  const type = get(["Type"]).toLowerCase();
  if (type === "balance" || type === "credit" || type === "") return null; // skip non-trades

  // Parse MT4 date "2024.01.15 09:30" or "2024.01.15 09:30:00"
  const parseDateTime = (raw: string) => {
    if (!raw) return { date: "", time: "" };
    const [datePart, timePart = ""] = raw.split(" ");
    const date = datePart.replace(/\./g, "-");
    const time = timePart.slice(0, 5); // "HH:MM"
    return { date, time };
  };

  const open = parseDateTime(get(["Open Time", "OpenTime"]));
  const close = parseDateTime(get(["Close Time", "CloseTime"]));

  const side = type.includes("sell") ? "Sell" : "Buy";

  const symbol = get(["Symbol", "Item"]).toUpperCase();
  const market = guessMarket(symbol);

  const commission = get(["Commission"]);
  const swap = get(["Swap"]);
  const profit = get(["Profit", "Net Profit", "NetProfit"]);

  // total fees = |commission| + |swap|
  const feesNum =
    (Math.abs(parseFloat(commission) || 0) + Math.abs(parseFloat(swap) || 0)).toFixed(2);

  return {
    id: uid(),
    date: open.date,
    symbol,
    market,
    side,
    entry: get(["Open Price", "OpenPrice"]),
    exit: get(["Close Price", "ClosePrice"]),
    sl: get(["S/L", "SL", "StopLoss"]),
    tp: get(["T/P", "TP", "TakeProfit"]),
    positionSize: get(["Size", "Lots", "Volume"]),
    riskPct: "",
    fees: feesNum,
    commission: commission,
    session: "",
    entryTime: open.time,
    exitDate: close.date !== open.date ? close.date : "",
    exitTime: close.time,
    strategyId: "",
    setupId: "",
    notes: profit ? `Profit: ${profit}` : "",
    attachments: [],
  };
}

/* ─── Parse generic template CSV ─────────────────────────────────────────── */
function parseGenericRow(row: Row): ImportedTrade | null {
  const get = (keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(row).find((h) => n(h) === n(k));
      if (found !== undefined && row[found].trim()) return row[found].trim();
    }
    return "";
  };

  const symbol = get(["symbol", "pair", "instrument"]).toUpperCase();
  if (!symbol) return null;

  const side = get(["side", "direction", "type"]);
  const normSide = side.toLowerCase().startsWith("s") ? "Sell" : "Buy";

  const rawDate = get(["date", "open date", "opendate", "trade date"]);
  const date = rawDate.includes(".") ? rawDate.replace(/\./g, "-") : rawDate;
  const market = get(["market", "asset class", "assetclass"]) || guessMarket(symbol);

  return {
    id: uid(),
    date,
    symbol,
    market,
    side: normSide,
    entry: get(["entry", "open price", "openprice"]),
    exit: get(["exit", "close price", "closeprice"]),
    sl: get(["sl", "stop", "stoploss", "s/l"]),
    tp: get(["tp", "target", "takeprofit", "t/p"]),
    positionSize: get(["size", "lots", "volume", "qty", "quantity", "positionsize"]),
    riskPct: get(["risk%", "risk pct", "riskpct", "risk"]),
    fees: get(["fees", "fee"]),
    commission: get(["commission", "comm"]),
    session: get(["session"]),
    entryTime: get(["entry time", "entrytime", "open time", "opentime"]),
    exitDate: get(["exit date", "exitdate", "close date", "closedate"]),
    exitTime: get(["exit time", "exittime", "close time", "closetime"]),
    strategyId: "",
    setupId: "",
    notes: get(["notes", "note", "comment", "comments"]),
    attachments: [],
  };
}

function guessMarket(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.includes("BTC") || s.includes("ETH") || s.includes("XRP") || s.includes("SOL")) return "Crypto";
  if (s.startsWith("XAU") || s.startsWith("XAG") || s.includes("GOLD") || s.includes("SILVER")) return "Metals";
  if (s.includes("US30") || s.includes("NAS") || s.includes("SPX") || s.includes("DAX") || s.includes("UK100") || s.includes("INDEX")) return "Indices";
  if (s.includes("OIL") || s.includes("WTI") || s.includes("BRENT")) return "Commodities";
  // Major/minor forex pair heuristic
  const FIATS = ["EUR","USD","GBP","JPY","CHF","CAD","AUD","NZD","SGD","HKD","NOK","SEK","DKK","ZAR","MXN","CNY"];
  const matches = FIATS.filter((f) => s.includes(f));
  if (matches.length >= 2) return "Forex";
  return "Forex"; // default
}

/* ─── Main component ─────────────────────────────────────────────────────── */
interface CsvImportProps {
  onClose: () => void;
  onImport: (trades: ImportedTrade[]) => void;
}

const TEMPLATE_CSV = `date,symbol,market,side,entry,exit,sl,tp,size,riskPct,fees,commission,session,entryTime,exitDate,exitTime,notes
2024-01-15,EURUSD,Forex,Buy,1.09500,1.09700,1.09200,1.09800,0.10,1,2.00,2.00,London,09:30,,10:15,Clean breakout setup
2024-01-16,XAUUSD,Metals,Sell,2025.50,2018.30,2030.00,2010.00,0.05,1,1.50,1.50,New York,14:00,,15:30,
`;

export default function CsvImportModal({ onClose, onImport }: CsvImportProps) {
  const [csv, setCsv] = useState("");
  const [parsed, setParsed] = useState<ImportedTrade[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [format, setFormat] = useState<FormatId>("unknown");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsv(ev.target?.result as string ?? "");
    reader.readAsText(file);
  };

  const handleParse = () => {
    setError(null);
    setParsed(null);
    if (!csv.trim()) { setError("Paste or upload a CSV first."); return; }
    const rows = parseCsv(csv);
    if (rows.length === 0) { setError("No data rows found. Check the CSV has headers + at least one row."); return; }

    const headers = Object.keys(rows[0]);
    const fmt = detectFormat(headers);
    setFormat(fmt);

    if (fmt === "unknown") {
      setError(
        "Couldn't identify this CSV format. Supported: MT4/MT5 history statements, or the generic template (download below). Make sure the header row is included."
      );
      return;
    }

    let trades: ImportedTrade[] = [];
    let skip = 0;
    for (const row of rows) {
      const t = fmt === "generic" ? parseGenericRow(row) : parseMt4Row(row);
      if (t) trades.push(t);
      else skip++;
    }

    if (trades.length === 0) {
      setError("CSV was parsed but no valid trades were found. Make sure it contains trade rows (not just deposits/balance entries).");
      return;
    }

    setParsed(trades);
    setSkipped(skip);
  };

  const handleConfirm = () => {
    if (!parsed) return;
    onImport(parsed);
    onClose();
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "src-trade-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmtId: Record<FormatId, string> = {
    mt4: "MT4 / MT5",
    mt5: "MT5",
    generic: "Generic template",
    unknown: "Unknown",
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
        <div className="flex items-center gap-2">
          <Upload size={16} className="text-amber-400" />
          <span className="font-semibold text-slate-100 text-sm">Import Trades from CSV</span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1"><X size={18} /></button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl w-full mx-auto">

        {/* Format guide */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs text-slate-400">
          <p className="font-medium text-slate-300">Supported formats</p>
          <ul className="space-y-1 list-disc list-inside">
            <li><span className="text-slate-200">MT4 / MT5 account statement</span> — export from MT4/MT5 → Account History → right-click → Save as Report (CSV/HTM). Tab or comma-delimited.</li>
            <li><span className="text-slate-200">Generic template</span> — our own CSV layout with custom fields. <button onClick={downloadTemplate} className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 ml-1"><Download size={11} />Download template</button></li>
          </ul>
        </div>

        {/* Upload / paste */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-400">Paste CSV text or upload a file</span>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded-lg px-2.5 py-1"
            >
              <FileText size={12} /> Upload file
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
          </div>
          <textarea
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setParsed(null); setError(null); }}
            placeholder={"Paste CSV content here…\n\nExample (MT4):\n#\tOpen Time\tType\tSize\tSymbol\tOpen Price\tS/L\tT/P\tClose Time\tClose Price\tCommission\tSwap\tProfit\n1\t2024.01.15 09:30\tbuy\t0.10\tEURUSD\t1.09500\t1.09200\t1.09800\t2024.01.15 10:15\t1.09700\t-2.00\t0.00\t200.00"}
            className="w-full h-44 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-[11px] font-mono text-slate-300 placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 resize-none"
          />
        </div>

        {/* Parse button */}
        <button
          onClick={handleParse}
          className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-sm rounded-xl transition"
        >
          Parse & Preview
        </button>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 bg-rose-900/20 border border-rose-800/40 rounded-xl p-3 text-rose-300 text-xs">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Preview table */}
        {parsed && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">
                {parsed.length} trade{parsed.length !== 1 ? "s" : ""} ready to import
                {skipped > 0 && <span className="text-slate-500 ml-1">({skipped} non-trade rows skipped)</span>}
              </span>
              {format !== "unknown" && (
                <span className="ml-auto text-[11px] text-slate-500 bg-slate-800 rounded-md px-2 py-0.5">{fmtId[format]}</span>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-[11px] text-slate-300">
                <thead>
                  <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                    {["Date", "Symbol", "Side", "Market", "Entry", "Exit", "S/L", "T/P", "Size", "Session", "Fees"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((t) => (
                    <tr key={t.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                      <td className="px-2.5 py-2 whitespace-nowrap">{t.date}</td>
                      <td className="px-2.5 py-2 font-medium text-slate-100 whitespace-nowrap">{t.symbol}</td>
                      <td className={cx("px-2.5 py-2 font-semibold whitespace-nowrap", t.side === "Buy" ? "text-emerald-400" : "text-rose-400")}>{t.side}</td>
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{t.market}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{t.entry || "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{t.exit || "—"}</td>
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{t.sl || "—"}</td>
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{t.tp || "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{t.positionSize || "—"}</td>
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{t.session || "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{t.fees || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300">
              Trades will be <strong>added</strong> to your existing journal — nothing will be overwritten.
            </div>

            <button
              onClick={handleConfirm}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-xl transition"
            >
              Import {parsed.length} Trade{parsed.length !== 1 ? "s" : ""} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
