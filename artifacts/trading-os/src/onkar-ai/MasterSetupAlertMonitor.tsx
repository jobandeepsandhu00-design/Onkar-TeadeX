import { useCallback, useEffect, useState } from "react";
import type { ScannerSnapshot } from "@workspace/api-zod";
import { Check, X } from "lucide-react";
import { brainRequest } from "../market-brain/api";
import { MasterSetupAlertBridge } from "./MasterSetupAlertBridge";

export default function MasterSetupAlertMonitor() {
  const [snapshot, setSnapshot] = useState<ScannerSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const showAlert = useCallback((next: string) => setMessage(next), []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const next = await brainRequest<ScannerSnapshot>(
          "",
          "GET",
          undefined,
          controller.signal,
        );
        setSnapshot(next);
      } catch {
        // The existing scanner surfaces connection errors; alert delivery stays silent.
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 12_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <>
      <MasterSetupAlertBridge snapshot={snapshot} onAlert={showAlert} />
      {message ? (
        <div className="oai-toast oai-master-alert-toast" role="alert">
          <Check size={17} />
          <span>{message}</span>
          <button
            aria-label="Dismiss Master AI alert"
            onClick={() => setMessage("")}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </>
  );
}
