#!/usr/bin/env bash
# Runs the Upstox token-refresh script immediately for testing.
#
# Usage:
#   bash /home/ubuntu/algotrading/scripts/test-token-refresh.sh

set -euo pipefail

SCRIPT_DIR="/home/ubuntu/algotrading/scripts"
LOG_DIR="/home/ubuntu/logs"

mkdir -p "${LOG_DIR}"

echo "Running auto-token-refresh.js — output also logged to ${LOG_DIR}/token-refresh.log"
node "${SCRIPT_DIR}/auto-token-refresh.js" 2>&1 | tee -a "${LOG_DIR}/token-refresh.log"
