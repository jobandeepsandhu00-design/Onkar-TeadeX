import test from "node:test";
import assert from "node:assert/strict";
import { NotificationService } from "../notifications/service";
import type { CandidateRow, ScannerStore } from "./store";

class MemoryStore {
  notifications: Array<Record<string, unknown>> = [];
  events: Array<Record<string, unknown>> = [];
  async request<T>(table: string, query: Record<string, string> = {}, method = "GET", body?: Record<string, unknown>) {
    if (table === "notifications" && method === "GET") {
      const item = this.notifications.find((row) => row.user_id === query.user_id?.slice(3) && row.event_key === query.event_key?.slice(3));
      return (item ? [item] : []) as T;
    }
    if (table === "notifications" && method === "POST") {
      let item = this.notifications.find((row) => row.user_id === body?.user_id && row.event_key === body?.event_key);
      if (item) Object.assign(item, body);
      else {
        item = { id: "00000000-0000-4000-8000-000000000001", ...body };
        this.notifications.push(item);
      }
      return [item] as T;
    }
    if (table === "notification_events" && method === "POST") {
      const duplicate = this.events.some((row) => row.notification_id === body?.notification_id && row.event_key === body?.event_key);
      if (!duplicate) this.events.push({ id: String(this.events.length + 1), ...body });
      return null as T;
    }
    throw new Error(`Unexpected ${method} ${table}`);
  }
}

const candidate = (state: CandidateRow["state"], score = 80): CandidateRow => ({
  id: "00000000-0000-4000-8000-000000000002",
  user_id: "00000000-0000-4000-8000-000000000003",
  config_id: "00000000-0000-4000-8000-000000000004",
  version_id: "00000000-0000-4000-8000-000000000005",
  symbol: "XAUUSD",
  timeframe: "30m",
  state,
  score,
  fingerprint: "fingerprint",
  last_candle_at: "2026-09-21T14:30:00.000Z",
  expires_at: "2026-09-22T14:30:00.000Z",
  plan: null,
  payload: {
    direction: "long",
    strategyName: "Pullback Impulse A+",
    marketBias: "bullish",
    rules: [{ id: "closed-candle", required: true, weight: 1, actual: false, expected: true, passed: false }],
    risk: { allowed: true, warnings: [], riskPercent: 0.5 },
    news: { status: "safe", events: [] },
    passed: 8,
    total: 9,
  },
} as unknown as CandidateRow);

test("notification service deduplicates a setup thread and retains lifecycle history", async () => {
  const store = new MemoryStore();
  const service = new NotificationService(store as unknown as ScannerStore);
  await service.candidate(candidate("WATCH"), "analysis_updated");
  await service.candidate(candidate("WATCH"), "analysis_updated");
  await service.candidate(candidate("READY", 100), "setup_ready");
  assert.equal(store.notifications.length, 1);
  assert.equal(store.events.length, 2);
  assert.equal(store.notifications[0].lifecycle_state, "READY");
  assert.equal(store.notifications[0].priority, "HIGH");
});
