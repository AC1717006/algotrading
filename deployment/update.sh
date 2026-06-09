#!/bin/bash
# Quick update script — run after git pull on EC2
set -euo pipefail

APP_DIR="/home/ubuntu/algo-trading"
cd "$APP_DIR"

echo "=== Backend ==="
cd backend
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
npm run build

echo "=== Frontend ==="
cd ../frontend
npm ci --omit=dev
npm run build

echo "=== PM2 reload ==="
cd ..
pm2 reload ecosystem.config.js --env production --update-env

pm2 status
echo "=== Done ==="
