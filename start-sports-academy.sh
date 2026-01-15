#!/usr/bin/env bash
set -euo pipefail

APP_NAME="sports-academy"
APP_PATH="/home/burghan/projects/sports-academy/server/app.js"
DB_PATH="/home/burghan/projects/sports-academy/database/sports-dev.db"
PORT="4101"
PM2_HOME_DIR="/home/burghan/.pm2"

pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pkill -f "PM2 v" >/dev/null 2>&1 || true
pkill -f "$APP_PATH" >/dev/null 2>&1 || true

rm -f "$PM2_HOME_DIR/dump.pm2" "$PM2_HOME_DIR/dump.pm2.bak"

if ss -ltn 2>/dev/null | rg -q ":${PORT}\b"; then
  echo "Port ${PORT} is in use. Stop the other process first." >&2
  exit 1
fi

DB_PATH="$DB_PATH" PORT="$PORT" pm2 start "$APP_PATH" --name "$APP_NAME" --update-env
