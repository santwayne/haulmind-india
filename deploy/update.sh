#!/usr/bin/env bash
# Pull the latest main and restart with zero manual steps:  bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only origin main
(cd backend && npm ci --omit=dev)
(cd frontend && npm ci && npm run build)
pm2 reload haulmind-india
sleep 3
curl -fsS localhost:5000/api/v1/health && echo && echo "✅ Updated"
