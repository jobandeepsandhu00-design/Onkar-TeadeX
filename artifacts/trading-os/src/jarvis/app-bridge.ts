import type { JarvisDestination, JarvisIntent } from "@workspace/api-zod";
export type ChartCommand = Extract<JarvisIntent, { kind: "CHART" }>;
export type JarvisAppContext = {
  page: string;
  account: string | null;
  accountId: string | null;
};
type Bridge = {
  navigate(destination: JarvisDestination): void;
  context(): JarvisAppContext;
  hasPendingSave(): boolean;
};
let bridge: Bridge | null = null;
let chartSelection: ChartCommand | null = null;
const navigationHistory: JarvisDestination[] = [];
const chartListeners = new Set<(command: ChartCommand) => void>();
export function installJarvisBridge(value: Bridge) {
  bridge = value;
  return () => {
    if (bridge === value) bridge = null;
  };
}
export function jarvisContext() {
  return (
    bridge?.context() ?? { page: "unavailable", account: null, accountId: null }
  );
}
export async function navigateJarvis(
  destination: JarvisDestination,
  recordHistory = true,
) {
  if (!bridge)
    throw new Error(
      "The app is still loading. Try again when your dashboard is ready.",
    );
  if (bridge.hasPendingSave())
    throw new Error(
      "Your changes are still saving. Wait for them to finish before navigating.",
    );
  // Conservatively protect form drafts that have not entered the app's autosave yet.
  if (
    document.querySelector('[data-jarvis-dirty="true"]') &&
    !window.confirm("You may have unsaved form edits. Leave this screen?")
  )
    throw new Error("Navigation canceled; your screen is unchanged.");
  if (recordHistory) {
    const page = bridge.context().page;
    const previous: JarvisDestination | undefined =
      page === "TradeX / home"
        ? "tradex"
        : page.startsWith("TradeX / journal")
          ? "journal"
          : page.startsWith("TradeX / backtest")
            ? "backtests"
            : page.startsWith("TradeX / library")
              ? "setups"
              : page.startsWith("TradeX / academy")
                ? "library"
                : page.startsWith("TradeX / more / Performance")
                  ? "performance"
                  : page === "/onkar-ai"
                    ? "onkar"
                    : (
                        {
                          assistant: "command",
                          scanner: "scanner",
                          charts: "charts",
                          knowledge: "knowledge",
                          evolution: "evolution",
                          integrations: "connections",
                          risk: "risk",
                          settings: "settings",
                          news: "news",
                        } as Record<string, JarvisDestination>
                      )[page.split("/")[2]];
    if (previous) navigationHistory.push(previous);
    if (navigationHistory.length > 20) navigationHistory.shift();
  }
  bridge.navigate(destination);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  return jarvisContext();
}
export async function backJarvis() {
  const destination = navigationHistory.at(-1);
  if (!destination)
    throw new Error(
      "There is no previous Jarvis navigation in this session. Say which screen to open.",
    );
  const result = await navigateJarvis(destination, false);
  navigationHistory.pop();
  return result;
}
export function publishJarvisChart(command: ChartCommand) {
  chartSelection = { ...chartSelection, ...command };
  for (const listener of chartListeners) listener(command);
}
export function getJarvisChart() {
  return chartSelection;
}
export function subscribeJarvisChart(
  listener: (command: ChartCommand) => void,
) {
  chartListeners.add(listener);
  return () => {
    chartListeners.delete(listener);
  };
}
export const JARVIS_ENABLED = import.meta.env.VITE_JARVIS_ENABLED !== "false";
