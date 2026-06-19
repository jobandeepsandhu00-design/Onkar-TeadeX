import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "@workspace/db";

const router = Router();

const JWT_SECRET =
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  "dev-only-insecure-secret";
const TOKEN_TTL = "30d";

const isEmail = (s: unknown): s is string =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function sign(user: { id: number; email: string }) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  } as jwt.SignOptions);
}

router.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password } = (req.body as Record<string, unknown>) || {};
  if (!isEmail(email))
    return void res.status(400).json({ error: "A valid email is required." });
  if (typeof password !== "string" || password.length < 6)
    return void res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });

  const lower = email.toLowerCase();
  const existing = await pool.query(
    "SELECT id FROM users WHERE lower(email) = $1",
    [lower]
  );
  if (existing.rowCount && existing.rowCount > 0)
    return void res
      .status(409)
      .json({ error: "An account with that email already exists." });

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
    [lower, hash]
  );
  const user = rows[0] as { id: number; email: string };
  await pool.query(
    "INSERT INTO app_state (user_id, data) VALUES ($1, NULL) ON CONFLICT (user_id) DO NOTHING",
    [user.id]
  );
  res.json({ token: sign(user), user: { id: user.id, email: user.email } });
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = (req.body as Record<string, unknown>) || {};
  if (!isEmail(email) || typeof password !== "string")
    return void res
      .status(400)
      .json({ error: "Email and password are required." });

  const { rows } = await pool.query(
    "SELECT id, email, password_hash FROM users WHERE lower(email) = $1",
    [email.toLowerCase()]
  );
  const user = rows[0] as
    | { id: number; email: string; password_hash: string }
    | undefined;
  if (!user)
    return void res.status(401).json({ error: "Invalid email or password." });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok)
    return void res.status(401).json({ error: "Invalid email or password." });

  res.json({ token: sign(user), user: { id: user.id, email: user.email } });
});

router.get("/auth/me", requireAuth, (req: Request, res: Response) => {
  const r = req as Request & { userId: number; userEmail: string };
  res.json({ user: { id: r.userId, email: r.userEmail } });
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = (req.headers as Record<string, string>)["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token)
    return void res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      uid: number;
      email: string;
    };
    (req as Request & { userId: number; userEmail: string }).userId =
      payload.uid;
    (req as Request & { userId: number; userEmail: string }).userEmail =
      payload.email;
    next();
  } catch {
    return void res.status(401).json({ error: "unauthorized" });
  }
}

export default router;
