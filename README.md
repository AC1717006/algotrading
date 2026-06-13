# AlgoTrading Platform

Production-ready algorithmic trading platform built with Node.js, TypeScript, PostgreSQL, and Next.js — integrated with the Upstox API.

---

## Architecture

```
algo-trading-platform/
├── backend/                       # Node.js + TypeScript API server
│   ├── prisma/
│   │   └── schema.prisma          # 9-table PostgreSQL schema
│   └── src/
│       ├── config/                # Zod-validated env config
│       ├── database/              # Prisma client + seed
│       ├── middleware/            # Auth, rate limiter, error handler, audit log
│       ├── modules/
│       │   ├── auth/              # JWT login, refresh, RBAC
│       │   ├── broker/            # Upstox client + OAuth
│       │   ├── trading/           # Paper engine + Live engine + service
│       │   ├── risk/              # Risk manager, circuit breaker
│       │   ├── strategies/        # EMA, RSI, MACD, Breakout, Custom + engine
│       │   ├── market-data/       # Historical candles, live quotes, WebSocket
│       │   ├── notifications/     # Telegram alerts
│       │   ├── settings/          # Key-value settings
│       │   └── logs/              # System + audit logs
│       ├── routes/                # Route aggregator
│       ├── types/                 # Shared TypeScript types
│       └── utils/                 # Logger, technical indicators
│
├── frontend/                      # Next.js 14 dashboard
│   └── src/
│       ├── app/
│       │   ├── login/             # Login page
│       │   └── dashboard/
│       │       ├── page.tsx       # Overview + live feed
│       │       ├── strategies/    # Strategy management
│       │       ├── trades/        # Order & trade history
│       │       ├── logs/          # System & audit logs
│       │       └── settings/      # Risk settings, token update
│       ├── components/            # Sidebar, StatCard
│       ├── hooks/                 # useWebSocket
│       ├── lib/                   # Axios API client, auth helpers
│       └── store/                 # Zustand auth store
│
├── deployment/
│   ├── ecosystem.config.js        # PM2 config (backend + frontend)
│   ├── nginx.conf                 # Nginx reverse proxy + SSL
│   ├── aws-deploy.sh              # One-shot EC2 setup script
│   └── update.sh                  # Zero-downtime update script
│
└── .github/workflows/
    └── deploy.yml                 # CI: lint → test → build → SSH deploy
```

---

## Quick Start (Local)

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis (optional, for caching)

### 1. Clone & configure

```bash
git clone https://github.com/YOUR_USERNAME/algo-trading-platform.git
cd algo-trading-platform
cp .env.example backend/.env
# Edit backend/.env with your credentials
```

### 2. Database setup

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
```

### 3. Start backend

```bash
npm run dev          # from backend/ directory
# API: http://localhost:4000
# Docs: http://localhost:4000/api-docs
```

### 4. Start frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Min 32-char random secret |
| `UPSTOX_API_KEY` | Upstox developer API key |
| `UPSTOX_API_SECRET` | Upstox developer API secret |
| `UPSTOX_ACCESS_TOKEN` | Daily access token from Upstox |
| `UPSTOX_REDIRECT_URI` | OAuth callback URL |
| `TELEGRAM_BOT_TOKEN` | (Optional) Telegram bot token |
| `TELEGRAM_CHAT_ID` | (Optional) Telegram chat ID |
| `PAPER_TRADING_INITIAL_BALANCE` | Starting paper balance (default: 1000000) |

---

## Strategies

| Strategy | Type | Description |
|---|---|---|
| EMA Crossover | `EMA_CROSSOVER` | Fast/slow EMA cross signals |
| RSI Reversal | `RSI` | Oversold/overbought mean reversion |
| MACD Crossover | `MACD` | MACD/signal line cross near zero |
| Breakout | `BREAKOUT` | Price + volume breakout from range |
| Custom | `CUSTOM` | EMA trend filter + RSI entry + MACD confirm |

Each strategy supports: entry/exit conditions, stop loss %, target %, max position value, trailing stop.

---

## API Endpoints

Full Swagger UI at `/api-docs`

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login → JWT tokens |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Current user |
| GET | `/api/broker/validate` | Check Upstox token |
| GET | `/api/broker/account` | Profile, funds, positions, holdings |
| GET | `/api/trading/mode` | Current mode (PAPER/LIVE) |
| PUT | `/api/trading/mode` | Switch mode (Admin) |
| POST | `/api/trading/orders` | Place order |
| GET | `/api/trading/orders` | List orders |
| GET | `/api/trading/trades` | List trades |
| GET | `/api/trading/summary` | Dashboard summary |
| GET | `/api/strategies` | List strategies |
| POST | `/api/strategies` | Create strategy |
| POST | `/api/strategies/:id/enable` | Enable + start strategy |
| POST | `/api/strategies/:id/disable` | Disable + stop strategy |
| GET | `/api/market/candles` | Historical OHLCV |
| GET | `/api/market/quotes` | Live quotes |
| GET | `/api/logs` | System logs |
| GET | `/api/logs/audit` | Audit logs |
| GET | `/api/settings` | All settings |
| PUT | `/api/settings/:key` | Update setting |
| GET | `/api/health` | Health check |

---

## WebSocket

Connect: `ws://localhost:4000/ws?token=<access_token>`

Subscribe to symbols:
```json
{ "type": "SUBSCRIBE", "symbols": ["NSE_EQ|INE009A01021"] }
```

Incoming message types: `QUOTE`, `ORDER_UPDATE`, `POSITION_UPDATE`, `SIGNAL`, `ALERT`

---

## AWS Deployment

### Required GitHub Secrets

| Secret | Value |
|---|---|
| `EC2_HOST` | EC2 public IP or domain |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Private SSH key (PEM content) |
| `NEXT_PUBLIC_API_URL` | `https://your-domain.com/api` |
| `NEXT_PUBLIC_WS_URL` | `wss://your-domain.com/ws` |
| `TELEGRAM_BOT_TOKEN` | For deploy notifications |
| `TELEGRAM_CHAT_ID` | For deploy notifications |

### First-time EC2 Setup

```bash
# SSH into EC2
ssh -i your-key.pem ubuntu@your-ec2-ip

# Download and run setup script
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/algo-trading-platform/main/deployment/aws-deploy.sh | bash
```

### PM2 Commands

```bash
pm2 status              # Process status
pm2 logs                # All logs
pm2 logs algo-backend   # Backend logs only
pm2 restart algo-backend
pm2 monit               # CPU/memory dashboard
```

---

## Risk Management

- **Daily loss limit** — halts new orders when daily P&L drops below threshold
- **Max trades / day** — caps order count per user per day
- **Max position size** — limits order value as % of account equity
- **Circuit breaker** — permanent halt for the session when losses exceed threshold
- **Stop loss** — auto-triggered for paper positions; strategy-configured for live
- **Trailing stop** — configurable per strategy

---

## Security

- Helmet.js HTTP security headers
- CORS restricted to frontend origin
- JWT authentication with refresh tokens
- Role-based access control (ADMIN / TRADER / VIEWER)
- Rate limiting: 500 req/15min globally, 10 logins/15min, 10 orders/sec
- Full audit logging for all state-changing operations
- All secrets via environment variables — never hardcoded

---

## Default Admin

After `npm run db:seed`:

- Email: `admin@algotrader.com`
- Password: `ChangeMe@123`

**Change immediately after first login.**
# AlgoTrader — Aaj Ka Kaam Ka Summary
**Date:** 12 June 2026  
**Server:** ajayalgotrader.duckdns.org (EC2 Mumbai)  
**Stack:** Next.js 14 + Node.js + TypeScript + PostgreSQL + Upstox API

---

## 🔧 Problem 1 — Upstox Token 401 Error (Fixed)
**Problem:** Backend 401 error de raha tha — Upstox access token expire ho gaya tha  
**Fix:** Token DB mein manually update kiya:
```sql
UPDATE settings SET value='<new_token>', updated_at=NOW() 
WHERE key='upstox_access_token';
```
**Result:** Backend quotes 200 return karne laga ✅

---

## 🎨 Task 1 — Dashboard UI Redesign
**Files Changed:**
- `frontend/src/app/globals.css` — CSS variables + typography
- `frontend/src/components/Sidebar.tsx` — Labels + active state + role badge
- `frontend/src/app/dashboard/layout.tsx` — Layout update
- `frontend/src/components/StatCard.tsx` — Icons + color coding
- `frontend/src/components/Header.tsx` — **New file**

**New Header Features:**
- AlgoTrader v1.0 logo
- Live IST clock (updates every second)
- Market Open/Closed pill — Green 09:15–15:30 IST weekdays, Red otherwise
- PAPER/LIVE mode toggle
- Broker connection status dot

**Sidebar Changes:**
- Width: 80px → 200px
- Labels: Overview, Strategies, Trade History, Logs
- Active page: Blue left-border highlight
- Role badge (ADMIN) at bottom

**Stat Cards:**
- Icons added (💰📈📊🔢)
- Color coded borders
- Indian number formatting (₹)

---

## 📊 Task 2 — Live Watchlist
**File Created:** `frontend/src/components/Watchlist.tsx`

**Features:**
- 10 default symbols pre-loaded
- Auto-refresh every 5 seconds via `/api/market/quotes`
- "Market Closed — Showing LTP" badge when market is closed
- Add symbol modal (search + manual instrument key)
- Hover to remove symbol
- localStorage persistence — survives page refresh
- Row click → loads historical chart
- Last updated timestamp shown

**Default Symbols:**
```
NSE_INDEX|Nifty 50, NSE_INDEX|Nifty Bank, BSE_INDEX|SENSEX
NSE_EQ|INE009A01021 (Reliance), NSE_EQ|INE040A01034 (TCS)
NSE_EQ|INE062A01020 (Infosys), NSE_EQ|INE090A01021 (HDFC Bank)
NSE_EQ|INE467B01029 (Asian Paints), MCX_FO|466583 (Gold)
MCX_FO|464150 (Silver)
```

---

## 📈 Task 3 — Historical Data
### Backend — New API Endpoint
**File:** `backend/src/modules/market-data/market-data.routes.ts`

```
GET /api/market/history?symbol=NSE_EQ|INE009A01021&interval=1minute&days=7
```
- Upstox historical candles API call
- 30-day chunks merge (3 calls for 90 days)
- Redis cache 6 hours TTL
- Returns: `{ success, data: { symbol, interval, candles[], total } }`

**Candle Format (Upstox):**
```
[timestamp_string, open, high, low, close, volume, oi]
```

### Frontend — Historical Chart
**File Created:** `frontend/src/components/HistoricalChart.tsx`
- `lightweight-charts` by TradingView (free)
- Candlestick + Volume panes
- Interval switching: 1m, 5m, 15m, 1h, 1d
- Summary stats (Open, High, Low, Last, 3M Return)
- CSV export button

**Issue Pending:** React hydration error #418/#423 — `lightweight-charts` SSR issue  
**Fix Needed:** Dynamic import with `ssr: false` in Next.js

---

## 🗄️ Task 4 — Historical Data Save to PostgreSQL

### New Table Created
```sql
CREATE TABLE historical_candles (
  id          BIGSERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL,
  interval    TEXT NOT NULL,
  ts          BIGINT NOT NULL,        -- Unix ms timestamp
  open        DOUBLE PRECISION NOT NULL,
  high        DOUBLE PRECISION NOT NULL,
  low         DOUBLE PRECISION NOT NULL,
  close       DOUBLE PRECISION NOT NULL,
  volume      BIGINT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, interval, ts)
);
```

**Prisma Model Added** (`prisma/schema.prisma`):
```prisma
model HistoricalCandle {
  id        BigInt   @id @default(autoincrement())
  symbol    String
  interval  String
  ts        BigInt
  open      Float
  high      Float
  low       Float
  close     Float
  volume    BigInt
  createdAt DateTime @default(now()) @map("created_at")
  @@unique([symbol, interval, ts])
  @@map("historical_candles")
}
```

### New Service File
**File:** `backend/src/modules/market-data/candle-store.service.ts`

**Functions:**
- `saveCandles(symbol, interval, days)` — Upstox se fetch karke DB mein save
- `saveAllWatchlistCandles(interval, days)` — 8 symbols ke liye bulk save
- `getCandlesFromDB(symbol, interval, fromTs, toTs)` — DB se fetch
- `getCandleStats()` — Per symbol stats

### Daily Cron Job
**Added in:** `backend/src/server.ts`  
**Schedule:** Every weekday 3:45 PM IST (10:15 UTC)
```typescript
cron.default.schedule('15 10 * * 1-5', async () => {
  await saveAllWatchlistCandles('1minute', 1);
});
```

### Data Saved Today
```
Symbol               | Interval | Candles | From       | To
NSE_EQ|INE009A01021  | 1minute  | 1875    | 2026-06-05 | 2026-06-11  (Reliance)
NSE_EQ|INE040A01034  | 1minute  | 1875    | 2026-06-05 | 2026-06-11  (TCS)
NSE_EQ|INE062A01020  | 1minute  | 1875    | 2026-06-05 | 2026-06-11  (Infosys)
NSE_EQ|INE090A01021  | 1minute  | 1875    | 2026-06-05 | 2026-06-11  (HDFC Bank)
NSE_EQ|INE467B01029  | 1minute  | 1875    | 2026-06-05 | 2026-06-11  (Asian Paints)
NSE_EQ|INE585B01010  | 1minute  | 1875    | 2026-06-05 | 2026-06-11  (SBI)
NSE_EQ|INE669C01036  | 1minute  | 1875    | 2026-06-05 | 2026-06-11  (ICICI Bank)
TOTAL: 13,125 candles
```

---

## 🐛 Issues Fixed During Day

| Issue | Cause | Fix |
|-------|-------|-----|
| `git pull` fail | Local `package-lock.json` modified | `git stash && git pull` |
| Frontend 502 Bad Gateway | `.next/standalone/server.js` path galat | `ecosystem.config.js` mein path fix |
| `npm run build` Killed (code 137) | EC2 memory full | `sudo swapon /swapfile` — 1GB swap add |
| React error #418/#423 | `lightweight-charts` SSR incompatible | Pending fix — dynamic import |
| `permission denied for table` | Table `postgres` user ne banayi, `algouser` ko access nahi | `GRANT ALL PRIVILEGES ON TABLE historical_candles TO algouser` |
| Candle save `0/1875` | Above permission issue | Fixed with GRANT |
| `INE148A01014` 400 error | ITC instrument key invalid/expired | Remove from watchlist ya sahi key use karo |

---

## 📦 New Dependencies Added
```
Backend:  node-cron, @types/node-cron
Frontend: lightweight-charts (v5)
```

---

## 🔄 Deployment Steps Done
```bash
# Backend
cd backend && npm install && npm run build
pm2 restart algo-backend

# Frontend  
cd frontend && npm install && npm run build
cp -r .next/static .next/standalone/frontend/.next/static
pm2 restart algo-frontend

pm2 save
```

---

## ✅ Current System Status
```
Process         Status    Uptime   Memory
algo-backend    online    ✅        ~80MB (2 cluster instances)
algo-frontend   online    ✅        ~47MB
```

**GitHub:** https://github.com/AC1717006/algotrading (19+ commits)  
**Live URL:** https://ajayalgotrader.duckdns.org/dashboard

---

## 📋 Kal Ke Liye Pending Tasks

1. **Upstox Token Update** — Daily 6 AM se pehle token refresh karna hai
   ```sql
   UPDATE settings SET value='<new_token>', updated_at=NOW() 
   WHERE key='upstox_access_token';
   pm2 restart algo-backend
   ```

2. **Historical Chart Fix** — React hydration error
   - `HistoricalChart.tsx` ko dynamic import karna hai `ssr: false` ke saath
   - Dashboard page mein fix

3. **ITC Symbol Fix** — `INE148A01014` 400 error
   - Sahi instrument key dhundho Upstox portal pe

4. **Watchlist Live Prices** — Kal market open hone par (9:15 AM) verify karo
   - Prices `—` se actual numbers mein aane chahiye

5. **Trade Analysis Feature** — Historical candles + trades ko join karke analysis dashboard banana

6. **Auto Token Refresh** — Script already hai (`scripts/` folder mein)
   - Cron job laga do daily token auto-refresh ke liye

---

## 💡 Architecture Summary

```
Browser
  │
  ├── Next.js Frontend (Port 3000)
  │     ├── Dashboard Page
  │     ├── Watchlist (polls every 5s)
  │     └── HistoricalChart (lightweight-charts)
  │
  └── Nginx (Reverse Proxy + SSL)
        │
        ├── /api/* → Backend (Port 4000)
        │     ├── Auth (JWT)
        │     ├── Market Data (Upstox API)
        │     ├── Historical Candles (DB + Redis cache)
        │     ├── Trading Engine (Paper/Live)
        │     ├── Strategy Engine (EMA, RSI, MACD)
        │     └── WebSocket (Live feed)
        │
        └── /* → Frontend
        
Database: PostgreSQL
  ├── users, orders, trades, positions
  ├── strategies, signals
  ├── settings (Upstox token yahan store hota hai)
  ├── audit_logs, system_logs
  └── historical_candles (NEW — 13,125 rows)

Cache: Redis
  └── Historical candle data (6h TTL)
```