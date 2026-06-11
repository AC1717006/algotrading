#!/usr/bin/env bash
# Sets up the daily Upstox token-refresh cron job on the Ubuntu EC2 instance.
#
# Usage:
#   bash /home/ubuntu/algotrading/scripts/setup-cron.sh

set -euo pipefail

SCRIPT_DIR="/home/ubuntu/algotrading/scripts"
LOG_DIR="/home/ubuntu/logs"
# 8:30 AM IST = 03:00 UTC (IST is UTC+5:30)
CRON_CMD="0 3 * * 1-5 node ${SCRIPT_DIR}/auto-token-refresh.js >> ${LOG_DIR}/token-refresh.log 2>&1"

echo "── Installing system dependencies for headless Chrome (Puppeteer) ──"
sudo apt-get update -y
sudo apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
  libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
  libxss1 libxtst6 lsb-release wget xdg-utils

echo "── Installing Node dependencies ──"
cd "${SCRIPT_DIR}"
npm install puppeteer otplib pg dotenv axios

echo "── Creating log directory ──"
mkdir -p "${LOG_DIR}"

echo "── Adding cron job (8:30 AM IST = 3:00 AM UTC, Mon-Fri) ──"
( crontab -l 2>/dev/null | grep -vF "auto-token-refresh.js" ; echo "${CRON_CMD}" ) | crontab -

echo "── Current crontab ──"
crontab -l

echo
echo "Setup complete. Test it now with:"
echo "  bash ${SCRIPT_DIR}/test-token-refresh.sh"
