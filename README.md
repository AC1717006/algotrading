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
