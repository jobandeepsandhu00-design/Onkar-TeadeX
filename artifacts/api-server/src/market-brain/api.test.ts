import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import router from "../routes/market-brain";
import knowledgeRouter from "../routes/knowledge";
import jarvisRouter from "../routes/jarvis";
import { scannerToolInputSchema } from "@workspace/api-zod";

test("all private scanner APIs reject anonymous requests", async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(knowledgeRouter);
  app.use(jarvisRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [method, path] of [
      ["GET", "/onkar-ai/jarvis/capabilities"],
      ["GET", "/onkar-ai/jarvis/history"],
      ["GET", "/onkar-ai/jarvis/commands/00000000-0000-4000-8000-000000000001"],
      ["POST", "/onkar-ai/jarvis/commands"],
      [
        "POST",
        "/onkar-ai/jarvis/commands/00000000-0000-4000-8000-000000000001",
      ],
      ["GET", "/market-brain"],
      [
        "GET",
        "/market-brain/candidates/00000000-0000-4000-8000-000000000001/paper-dry-run",
      ],
      ["GET", "/market-brain/notifications"],
      [
        "GET",
        "/market-brain/notifications/00000000-0000-4000-8000-000000000001/events",
      ],
      [
        "POST",
        "/market-brain/notifications/00000000-0000-4000-8000-000000000001/state",
      ],
      ["POST", "/market-brain/notifications/actions/read-all"],
      ["DELETE", "/market-brain/notifications"],
      ["DELETE", "/market-brain/notifications/read"],
      ["PUT", "/market-brain/notification-preferences"],
      ["GET", "/onkar-ai/knowledge"],
      ["GET", "/onkar-ai/knowledge/search?q=wickfill"],
      ["POST", "/onkar-ai/knowledge/sync"],
      ["PATCH", "/onkar-ai/knowledge/00000000-0000-4000-8000-000000000001"],
      ["PUT", "/onkar-ai/learning/preferences"],
      ["GET", "/market-brain/shared-market?symbol=XAUUSD&timeframe=15m"],
      ["GET", "/market-brain/candle-closures?symbol=XAUUSD"],
      ["PUT", "/market-brain/config"],
      ["POST", "/market-brain/strategies"],
      ["POST", "/market-brain/strategies/sync-library"],
      ["POST", "/market-brain/scan"],
      ["POST", "/market-brain/webhook-key"],
      ["POST", "/market-brain/chat"],
      ["POST", "/onkar-ai/master"],
      ["POST", "/market-brain/backtest"],
      ["GET", "/market-brain/cron"],
      ["POST", "/market-brain/cron"],
    ]) {
      const response = await fetch(url + path, { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const webhook = await fetch(`${url}/tradingview/webhook/not-a-uuid`, {
      method: "POST",
    });
    assert.equal(webhook.status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("AI tools reject arbitrary database queries and user impersonation", () => {
  assert.equal(
    scannerToolInputSchema.safeParse({ name: "execute_sql", query: "select *" })
      .success,
    false,
  );
  assert.equal(
    scannerToolInputSchema.safeParse({
      name: "get_journal_statistics",
      userId: "someone-else",
    }).success,
    false,
  );
  assert.equal(
    scannerToolInputSchema.safeParse({ name: "get_journal_statistics" })
      .success,
    true,
  );
});
