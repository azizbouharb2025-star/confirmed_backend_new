#!/bin/bash
# Backend deploy script
# Runs as: ubuntu user under PM2 webhook process
# Logs go to $HOME/logs/ which ubuntu always owns

set -e

LOG_DIR="$HOME/logs"
LOG_FILE="$LOG_DIR/deploy-backend.log"
DEPLOY_DIR="/var/www/confirmed.tn/confirmed_backend_new"

mkdir -p "$LOG_DIR"

exec >> "$LOG_FILE" 2>&1

echo ""
echo "========================================"
echo "Backend deploy started: $(date)"
echo "========================================"

cd "$DEPLOY_DIR"

echo "→ Pulling latest code..."
git pull origin main

echo "→ Installing dependencies..."
npm ci --prefer-offline

echo "→ Restarting PM2 process..."
pm2 restart confirmed-backend --update-env || pm2 start ecosystem.config.js --env production

echo "→ Saving PM2 process list..."
pm2 save

echo "✓ Backend deploy completed: $(date)"
