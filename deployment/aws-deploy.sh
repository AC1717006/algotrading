#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# AWS EC2 Deployment Script — AlgoTrading Platform
# Ubuntu 22.04 LTS | Run once after EC2 launch
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/home/ubuntu/algo-trading"
LOG_DIR="/home/ubuntu/logs"

echo "=== [1/9] System update ==="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "=== [2/9] Install Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential git curl

echo "=== [3/9] Install PM2 ==="
sudo npm install -g pm2

echo "=== [4/9] Install PostgreSQL 16 ==="
sudo apt-get install -y postgresql-16 postgresql-client-16
sudo systemctl enable postgresql
sudo systemctl start postgresql

echo "=== [5/9] Install Redis ==="
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

echo "=== [6/9] Install Nginx ==="
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx

echo "=== [7/9] Create PostgreSQL database ==="
sudo -u postgres psql -c "CREATE USER algotrader WITH PASSWORD 'change_this_password';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE algotrading OWNER algotrader;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE algotrading TO algotrader;" 2>/dev/null || true

echo "=== [8/9] Create log directory ==="
mkdir -p "$LOG_DIR"

echo "=== [9/9] Clone and build application ==="
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR" && git pull
else
  git clone https://github.com/YOUR_USERNAME/algo-trading-platform.git "$APP_DIR"
fi

cd "$APP_DIR"

# Backend
echo "--- Installing backend dependencies ---"
cd backend
cp ../.env.example .env
echo "⚠  Edit $APP_DIR/backend/.env with your real secrets before continuing."
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run build

# Frontend
echo "--- Installing frontend dependencies ---"
cd ../frontend
npm install
NEXT_PUBLIC_API_URL=https://your-domain.com/api \
NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws \
npm run build

# PM2
echo "--- Starting PM2 processes ---"
cd "$APP_DIR"
cp deployment/ecosystem.config.js .
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup | tail -1 | sudo bash

# Nginx
echo "--- Configuring Nginx ---"
sudo cp deployment/nginx.conf /etc/nginx/sites-available/algotrading
sudo ln -sf /etc/nginx/sites-available/algotrading /etc/nginx/sites-enabled/algotrading
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "
============================================================
  Deployment complete!

  Next steps:
  1. Edit $APP_DIR/backend/.env with real secrets
  2. Replace 'your-domain.com' in nginx.conf with your domain
  3. Run: sudo certbot --nginx -d your-domain.com
  4. Restart backend: pm2 restart algo-backend

  PM2 commands:
    pm2 status          — view process status
    pm2 logs            — tail all logs
    pm2 restart all     — restart everything
    pm2 monit           — live monitoring
============================================================
"
