import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "./auth";

const router = Router();

router.get("/state", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const { rows } = await pool.query(
    "SELECT data FROM app_state WHERE user_id = $1",
    [userId]
  );
  const data = rows[0]?.data ?? null;
  res.json({ value: data === null ? null : JSON.stringify(data) });
});

router.put("/state", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const { value } = req.body || {};
  if (typeof value !== "string")
    return void res
      .status(400)
      .json({ error: "value (JSON string) required." });

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return void res
      .status(400)
      .json({ error: "value must be valid JSON." });
  }

  await pool.query(
    `INSERT INTO app_state (user_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, parsed]
  );
  res.json({ ok: true });
});

export default router;
