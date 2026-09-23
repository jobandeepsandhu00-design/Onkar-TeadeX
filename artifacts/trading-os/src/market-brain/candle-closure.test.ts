import assert from "node:assert/strict";
import test from "node:test";
import { candleClosureClock, formatCandleCountdown } from "./candle-closure";

const at = (time: string) => Date.parse(time);

test("15M, 30M, 1H and 4H clocks align to UTC candle boundaries", () => {
  const now = at("2026-09-23T10:07:00Z");
  for (const [timeframe, open, next] of [
    ["15m", "2026-09-23T09:45:00Z", "2026-09-23T10:15:00Z"],
    ["30m", "2026-09-23T09:30:00Z", "2026-09-23T10:30:00Z"],
    ["1h", "2026-09-23T09:00:00Z", "2026-09-23T11:00:00Z"],
    ["4h", "2026-09-23T04:00:00Z", "2026-09-23T12:00:00Z"],
  ] as const) {
    const clock = candleClosureClock(timeframe, at(open), now);
    assert.equal(clock.state, "verified");
    assert.equal(clock.nextScheduledCloseAt, at(next));
  }
});

test("a boundary never confirms a candle until a closed provider bar is stored", () => {
  const now = at("2026-09-23T10:30:01Z");
  const prior = candleClosureClock("30m", at("2026-09-23T09:30:00Z"), now);
  assert.equal(prior.state, "awaiting");
  assert.equal(prior.lastClosedAt, at("2026-09-23T10:00:00Z"));
  const updated = candleClosureClock("30m", at("2026-09-23T10:00:00Z"), now);
  assert.equal(updated.state, "verified");
});

test("stale, missing, cached and future data never look verified", () => {
  const now = at("2026-09-23T12:01:00Z");
  assert.equal(candleClosureClock("15m", at("2026-09-23T10:00:00Z"), now).state, "stale");
  assert.equal(candleClosureClock("15m", null, now).state, "unavailable");
  assert.equal(candleClosureClock("15m", at("2026-09-23T11:45:00Z"), now, false).state, "stale");
  assert.equal(candleClosureClock("15m", at("2026-09-23T12:00:00Z"), now).state, "unavailable");
  assert.equal(formatCandleCountdown(8 * 60_000), "08:00");
});
