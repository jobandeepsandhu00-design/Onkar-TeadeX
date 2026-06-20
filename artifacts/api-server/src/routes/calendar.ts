import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface CalendarEvent {
  title: string;
  country: string;
  date: string;
  time: string;
  impact: string;
  forecast: string;
  previous: string;
  actual: string;
}

let cache: { data: CalendarEvent[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function fetchWeek(url: string): Promise<CalendarEvent[]> {
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "SRCTradingOS/1.0" },
    });
    if (!res.ok) return [];
    return (await res.json()) as CalendarEvent[];
  } catch {
    return [];
  }
}

router.get("/calendar", async (_req, res) => {
  try {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return void res.json({ events: cache.data, cachedAt: cache.fetchedAt });
    }

    const [thisWeek, nextWeek] = await Promise.all([
      fetchWeek("https://nfs.faireconomy.media/ff_calendar_thisweek.json"),
      fetchWeek("https://nfs.faireconomy.media/ff_calendar_nextweek.json"),
    ]);

    const combined = [...thisWeek, ...nextWeek].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    cache = { data: combined, fetchedAt: Date.now() };
    res.json({ events: combined, cachedAt: cache.fetchedAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch calendar data" });
  }
});

export default router;
