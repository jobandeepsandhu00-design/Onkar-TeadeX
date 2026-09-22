export const LIVE_REFRESH_EVENT = "onkar-live-refresh";

const DATA_REFRESH_INTERVAL_MS = 30_000;
const APP_UPDATE_INTERVAL_MS = 60_000;

export function requestLiveRefresh() {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    document.visibilityState !== "visible" ||
    !navigator.onLine
  )
    return;
  window.dispatchEvent(new Event(LIVE_REFRESH_EVENT));
}

export function installAutomaticRefresh() {
  if (typeof window === "undefined" || typeof document === "undefined")
    return () => undefined;

  let disposed = false;
  const updateServiceWorker = async () => {
    if (disposed || !("serviceWorker" in navigator) || !navigator.onLine)
      return;
    const registration = await navigator.serviceWorker
      .getRegistration()
      .catch(() => undefined);
    await registration?.update().catch(() => undefined);
  };
  const resume = () => {
    if (document.visibilityState !== "visible") return;
    requestLiveRefresh();
    void updateServiceWorker();
  };

  const dataTimer = window.setInterval(
    requestLiveRefresh,
    DATA_REFRESH_INTERVAL_MS,
  );
  const updateTimer = window.setInterval(
    () => void updateServiceWorker(),
    APP_UPDATE_INTERVAL_MS,
  );
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", resume);
  window.setTimeout(resume, 0);

  return () => {
    disposed = true;
    window.clearInterval(dataTimer);
    window.clearInterval(updateTimer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("pageshow", resume);
  };
}
