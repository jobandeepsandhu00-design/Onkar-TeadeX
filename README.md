# SRC Trading OS

A full-stack Forex trading journal and operating system. Log trades, track P&L, size positions correctly, monitor daily risk limits in real time, and study from the built-in academy and blueprint library.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind v4 (PWA) |
| Backend | Node.js 24 + Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Monorepo | pnpm workspaces |
| Auth | JWT (bcrypt passwords) |

---

## Project layout

```
├── artifacts/
│   ├── trading-os/       # React/Vite frontend  →  deploy to Vercel
│   └── api-server/       # Express API          →  deploy to Railway
├── lib/
│   ├── db/               # Drizzle ORM schema + PostgreSQL pool
│   └── api-spec/         # OpenAPI spec + generated types
├── vercel.json           # Vercel build config (frontend)
├── railway.json          # Railway deploy config (API)
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

## Deploy to GitHub + Vercel + Railway

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create src-trading-os --public --push
# or: git remote add origin https://github.com/you/src-trading-os.git && git push -u origin main
```

### Step 2 — Deploy the API on Railway

1. Go to [railway.app](https://railway.app) → New Project
2. **Add PostgreSQL** plugin — copy the `DATABASE_URL` it provides
3. **Deploy from GitHub repo** (select this repo)
4. In Railway project settings → Variables, add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | *(from Railway Postgres plugin)* |
| `SESSION_SECRET` | *(any long random string)* |
| `NODE_ENV` | `production` |

5. Railway uses `railway.json` automatically — the API will be live at `https://your-project.railway.app`

6. **Run the DB migration** once from Railway's shell tab:
```bash
pnpm --filter @workspace/db run push
```

### Step 3 — Deploy the frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import your GitHub repo
2. Vercel picks up `vercel.json` automatically — no root directory change needed
3. In Vercel → Project Settings → Environment Variables, add:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://your-project.railway.app` *(your Railway URL)* |

4. Click **Deploy** — frontend is live at `https://your-project.vercel.app`

---

## Environment variables reference

### API server (`artifacts/api-server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | JWT signing secret (long random string) |
| `PORT` | — | Default 5000 (set automatically by Railway) |

### Frontend (`artifacts/trading-os/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | ✅ prod | Base URL of deployed API server (no trailing slash) |

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
