import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "@workspace/db";

const router = Router();
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET is required for the legacy read-only rollback service.");

type LegacyRequest = Request & { legacyUserId: number; legacyUserEmail: string };

function requireLegacyAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, secret, { audience: "trading-os-legacy-read" }) as { uid: number; email: string };
    (req as LegacyRequest).legacyUserId = payload.uid;
    (req as LegacyRequest).legacyUserEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

router.post("/legacy-read/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) return void res.status(400).json({ error: "Email and password are required." });
  const { rows } = await pool.query("select id,email,password_hash from users where lower(email)=$1", [email]);
  const user = rows[0] as { id: number; email: string; password_hash: string } | undefined;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return void res.status(401).json({ error: "Invalid email or password." });
  }
  const token = jwt.sign({ uid: user.id, email: user.email }, secret, {
    audience: "trading-os-legacy-read",
    expiresIn: "1h",
  });
  res.json({ token, user: { id: user.id, email: user.email }, readOnly: true });
});

router.get("/legacy-read/auth/me", requireLegacyAuth, (req, res) => {
  const legacy = req as LegacyRequest;
  res.json({ user: { id: legacy.legacyUserId, email: legacy.legacyUserEmail }, readOnly: true });
});

router.get("/legacy-read/state", requireLegacyAuth, async (req, res) => {
  const { rows } = await pool.query("select data,updated_at from app_state where user_id=$1", [
    (req as LegacyRequest).legacyUserId,
  ]);
  res.json({ value: rows[0]?.data ?? null, updatedAt: rows[0]?.updated_at ?? null, readOnly: true });
});

export default router;