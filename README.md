# SRC Trading OS

A full-stack Forex trading journal and operating system. Log trades, track P&L, size positions correctly, monitor daily risk limits in real time, and study from the built-in academy and blueprint library.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind v4 (PWA) |
| Backend | Node.js 24 + Express 5 |
| Database | Supabase PostgreSQL |
| Monorepo | pnpm workspaces |
| Auth | Supabase Auth |

---

## Project layout

```
├── artifacts/
│   ├── trading-os/       # React/Vite frontend
│   └── api-server/       # Express API
├── api/                  # Vercel serverless API entrypoint
├── lib/
│   ├── db/               # Drizzle ORM schema + PostgreSQL pool
│   └── api-spec/         # OpenAPI spec + generated types
├── vercel.json           # Vercel build config (frontend)
├── railway.json          # Optional standalone Railway API config
└── pnpm-workspace.yaml
```

---

## Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and fill in environment variables
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Edit .env: set DATABASE_URL and SESSION_SECRET

# 3. Push database schema
pnpm --filter @workspace/db run push

# 4. Start API server (port 5000)
pnpm --filter @workspace/api-server run dev

# 5. Start frontend (new terminal)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/trading-os run dev
```

Open http://localhost:3000

---

## Deploy to GitHub + Vercel

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create src-trading-os --public --push
# or: git remote add origin https://github.com/you/src-trading-os.git && git push -u origin main
```

### Step 2 — Deploy the application on Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import your GitHub repo
2. Vercel picks up `vercel.json` automatically — no root directory change needed
3. In Vercel → Project Settings → Environment Variables, add:

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SESSION_SECRET` | Long random value used only by the temporary legacy read service |
| `DATABASE_URL` | Legacy PostgreSQL connection used only during the rollback window |
| `GEMINI_API_KEY` | Gemini key for the AI import assistant |
| `TWELVE_DATA_API_KEY` | Optional Twelve Data key for live backtest candles |
| `NODE_ENV` | `production` |

   Variables prefixed with `VITE_` are included in the browser bundle. Never
   configure `SUPABASE_SERVICE_ROLE_KEY` with a `VITE_` prefix.

4. Click **Deploy**. Vercel serves the SPA and the Express API from the same
   origin; `/api/*` requests are handled by the Node.js serverless function.

5. Confirm `GET https://your-project.vercel.app/api/healthz` returns
   `{"status":"ok"}` and then add the production URL to Supabase Auth's allowed
   redirect URLs.

---

## Environment variables reference

### API server

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | JWT signing secret (long random string) |
| `PORT` | — | Default 5000 (set automatically by Railway) |
| `GEMINI_API_KEY` | For AI import | Server-only Gemini credential |
| `TWELVE_DATA_API_KEY` | No | Server-only market data credential |

### Frontend (`artifacts/trading-os/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase browser-safe publishable key |

The frontend uses same-origin `/api` requests, so no separate API base URL is
required on Vercel.

---

## Key features

- **Trading Journal** — log trades with entry/exit/SL/TP, photos, notes, mood rating
- **Position Size Calculator** — accurate pip values for Gold (XAUUSD), all JPY pairs at current rates, Forex, Indices, Oil, Crypto
- **Live Risk Monitor** — automatic fullscreen alert when today's total loss breaches the daily loss limit
- **Performance Analytics** — win rate, profit factor, R-multiple, streaks, heatmap calendar
- **Setup Library** — save and review your own trade setups
- **Forex Blueprint** — 20 educational cards across 6 categories
- **Academy** — trading education content
- **Trading Plans** — master plan + custom strategies
- **Prop Firm Tracker** — track challenge progress vs. daily/overall loss limits
- **PWA** — installable as a mobile app (Add to Home Screen on iOS/Android)

---

## Commands

```bash
pnpm install                                    # install all workspace deps
pnpm run typecheck                              # full TypeScript check
pnpm run build                                  # typecheck + build all packages
pnpm --filter @workspace/db run push            # push DB schema (dev only)
pnpm --filter @workspace/api-server run build   # build API server
pnpm --filter @workspace/trading-os run build   # build frontend
```
