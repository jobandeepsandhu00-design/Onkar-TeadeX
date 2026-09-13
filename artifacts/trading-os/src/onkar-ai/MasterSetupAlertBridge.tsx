import { useEffect, useRef, useState } from "react";
import {
  timeframeMs,
  type ScannerCandidate,
  type ScannerSnapshot,
} from "@workspace/api-zod";
import { agentRuntime } from "./agent-runtime";
import { agentVoice } from "./agent-voice";

const LEDGER_KEY = "onkar-master-alert-delivery-v1";
const terminal = new Set(["INVALIDATED", "EXPIRED"]);
const confirmed = new Set(["READY", "TRIGGERED", "COMPLETED"]);

export function isConfirmedClosedCandidate(
  candidate: ScannerCandidate,
  now = Date.now(),
) {
  const duration = timeframeMs[candidate.timeframe as keyof typeof timeframeMs];
  const candleAt = Date.parse(candidate.last_candle_at);
  return Boolean(
    confirmed.has(candidate.state) &&
    !candidate.staleNow &&
    !candidate.payload.stale &&
    duration &&
    Number.isFinite(candleAt) &&
    candleAt + duration <= now,
  );
}

export function masterAlertKey(candidate: ScannerCandidate) {
  return `${candidate.id}:${candidate.last_candle_at}:confirmed`;
}

export function claimConfirmedAlert(
  candidate: ScannerCandidate,
  kind: string,
  ledger: Set<string>,
  now = Date.now(),
) {
  if (kind !== "setup_ready" || !isConfirmedClosedCandidate(candidate, now))
    return false;
  const key = masterAlertKey(candidate);
  if (ledger.has(key)) return false;
  ledger.add(key);
  return true;
}

export function masterAlertCopy(candidate: ScannerCandidate) {
  const direction = candidate.payload.direction === "short" ? "SELL" : "BUY";
  const setup = candidate.payload.strategyName || "approved setup";
  const warning =
    candidate.payload.risk?.warnings?.[0] ||
    candidate.payload.warnings?.[0] ||
    "Review stop loss, position size, spread, and news before any trade.";
  return {
    title: `Master AI · ${candidate.symbol} ${direction} confirmed`,
    body: `${candidate.timeframe} · ${setup}. ${warning}`,
    spoken: `Master AI confirmed setup alert. ${candidate.symbol}, ${candidate.timeframe}, ${setup}, ${direction} direction, confirmation status confirmed. Important risk warning: ${warning} This is analysis, not an instruction to execute.`,
  };
}

function readLedger() {
  if (typeof localStorage === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) || "[]");
    return new Set<string>(Array.isArray(parsed) ? parsed.slice(-200) : []);
  } catch {
    return new Set<string>();
  }
}

function persistLedger(ledger: Set<string>) {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify([...ledger].slice(-200)));
  } catch {
    /* Notification dedupe remains in memory when storage is unavailable. */
  }
}

export async function requestMasterNotificationPermission() {
  if (!("Notification" in window)) return "unsupported" as const;
  if (Notification.permission === "granted") return "granted" as const;
  return Notification.requestPermission();
}

async function notify(title: string, body: string, tag: string) {
  if (!("Notification" in window) || Notification.permission !== "granted")
    return;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration) {
      await registration.showNotification(title, {
        body,
        tag,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
      });
      return;
    }
    new Notification(title, { body, tag, icon: "/icon-192.png" });
  } catch {
    // In-app delivery remains the source of truth when OS notifications fail.
  }
}

export function MasterSetupAlertBridge({
  snapshot,
  onAlert,
}: {
  snapshot: ScannerSnapshot | null;
  onAlert(message: string): void;
}) {
  const [ledger] = useState(readLedger);
  const cancelled = useRef(new Set<string>());

  useEffect(() => {
    agentVoice.initialize();
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const candidates = new Map(
      snapshot.candidates.map((candidate) => [candidate.id, candidate]),
    );

    for (const candidate of snapshot.candidates) {
      if (terminal.has(candidate.state)) {
        if (cancelled.current.has(candidate.id)) continue;
        cancelled.current.add(candidate.id);
        agentVoice.cancelAlert(candidate.id);
        agentRuntime.report("setup", "warning", "Setup invalidated", true);
      } else cancelled.current.delete(candidate.id);
    }

    for (const alert of [...snapshot.alerts].reverse()) {
      if (alert.kind !== "setup_ready") continue;
      const candidate = candidates.get(alert.candidate_id);
      if (!candidate || !claimConfirmedAlert(candidate, alert.kind, ledger))
        continue;
      const key = masterAlertKey(candidate);
      persistLedger(ledger);

      const copy = masterAlertCopy(candidate);
      agentRuntime.report(
        "setup",
        "success",
        "Confirmed on closed candle",
        true,
      );
      agentRuntime.report(
        "master",
        "alert",
        "Delivering confirmed setup",
        true,
      );
      onAlert(`${copy.title}. ${copy.body}`);
      void notify(copy.title, copy.body, key);
      // A newer confirmation for the same candidate supersedes queued older-candle speech.
      agentVoice.cancelAlert(candidate.id);
      agentVoice.enqueueAlert({
        key,
        candidateId: candidate.id,
        text: copy.spoken,
        priority: candidate.payload.risk?.allowed === false ? 95 : 60,
      });
    }
  }, [snapshot, onAlert, ledger]);

  return null;
}
