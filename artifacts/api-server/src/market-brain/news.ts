import type { ScannerConfig } from "@workspace/api-zod";
import { fetchJson, type EconomicEvent } from "./providers";
import type { NewsCheck } from "./evaluation";

let cache: { events: EconomicEvent[]; at: number } | null = null;
export async function newsCheck(
  symbol: string,
  config: ScannerConfig,
  now: number,
): Promise<NewsCheck> {
  try {
    if (!cache || now - cache.at > 15 * 60_000) {
      // Same calendar source already used by the app; unlike the display-only route,
      // a failed/malformed response must not become an empty, supposedly safe calendar.
      const raw = await fetchJson(
        "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      );
      if (!Array.isArray(raw) || !raw.length)
        throw new Error("Calendar coverage unavailable");
      const events: EconomicEvent[] = raw.map((r: Record<string, string>) => ({
        title: r.title,
        currency: r.country,
        time: Date.parse(r.date),
        impact: r.impact?.toLowerCase() as EconomicEvent["impact"],
      }));
      if (
        events.some((e) => !Number.isFinite(e.time) || !e.currency || !e.title)
      )
        throw new Error("Calendar malformed");
      const week = (t: number) => {
        const d = new Date(t);
        d.setUTCDate(d.getUTCDate() - d.getUTCDay());
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime();
      };
      if (!events.some((e) => week(e.time) === week(now)))
        throw new Error("Calendar is stale");
      cache = { events, at: now };
    }
    const currencies = [
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "CHF",
      "CAD",
      "AUD",
      "NZD",
    ].filter((c) => symbol.includes(c));
    if (/NAS100|US30|SPX|US500/.test(symbol)) currencies.push("USD");
    if (/GER40|DE40/.test(symbol)) currencies.push("EUR");
    if (/UK100/.test(symbol)) currencies.push("GBP");
    // Unknown symbol-to-economy mapping cannot claim a safe news filter.
    if (!currencies.length)
      return {
        status: "unavailable",
        checkedAt: new Date(cache.at).toISOString(),
        events: [],
      };
    const related = cache.events.filter(
      (e) => e.impact === "high" && currencies.includes(e.currency),
    );
    const blocked = related.filter(
      (e) =>
        now >= e.time - config.newsBeforeMinutes * 60_000 &&
        now <= e.time + config.newsAfterMinutes * 60_000,
    );
    return {
      status: blocked.length ? "blocked" : "safe",
      checkedAt: new Date(cache.at).toISOString(),
      events: related
        .filter((e) => e.time >= now - config.newsAfterMinutes * 60_000)
        .slice(0, 8),
    };
  } catch {
    return {
      status: "unavailable",
      checkedAt: new Date(now).toISOString(),
      events: [],
    };
  }
}
