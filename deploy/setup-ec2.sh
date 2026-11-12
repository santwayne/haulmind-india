#!/usr/bin/env bash
# One-time setup of HaulMind India on a fresh Ubuntu 22.04 / 24.04 EC2 instance.
#   ssh ubuntu@EC2-IP
#   git clone https://github.com/santwayne/haulmind-india.git && cd haulmind-india
#   bash deploy/setup-ec2.sh
# It stops before anything that needs your input (.env values, domain, first owner password).
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "▶ HaulMind India setup in $APP_DIR"

# 1. Node 20, Nginx, PM2
if ! command -v node >/dev/null || [[ "$(node -v)" != v2* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y nginx
command -v pm2 >/dev/null || sudo npm install -g pm2
sudo mkdir -p /var/log/haulmind && sudo chown "$USER" /var/log/haulmind

# 2. Backend config
cd "$APP_DIR/backend"
if [ ! -f .env ]; then
  cp .env.example .env
  # a long random JWT secret so logins cannot be forged
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  echo
  echo "✋ Edit backend/.env now: MONGO_URI, COMPANY_NAME, CORS_ORIGIN, PUBLIC_TRACK_URL, BACKUP_DIR"
  echo "   then run this script again."
  exit 0
fi
npm ci --omit=dev
mkdir -p uploads/pod "$(grep -E '^BACKUP_DIR=' .env | cut -d= -f2- || echo ./backups)"

# 3. Frontend build (company name shown on login / sidebar)
cd "$APP_DIR/frontend"
if [ ! -f .env ]; then
  COMPANY=$(grep -E '^COMPANY_NAME=' ../backend/.env | cut -d= -f2-)
  echo "VITE_COMPANY_NAME=${COMPANY:-TCL Logistics}" > .env
fi
npm ci
npm run build

# 4. First data (branches, owner login) – only if the database is empty
cd "$APP_DIR/backend"
if [ "${SKIP_SEED:-}" != "1" ]; then
  echo "▶ Seeding branches + owner login (skipped automatically if an owner exists)"
  npm run seed
fi

# 5. Start with PM2 and keep it running after reboot
cd "$APP_DIR"
pm2 startOrReload deploy/ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

# 6. Nginx
if [ ! -f /etc/nginx/sites-available/haulmind ]; then
  sudo cp deploy/nginx-haulmind.conf /etc/nginx/sites-available/haulmind
  sudo ln -sf /etc/nginx/sites-available/haulmind /etc/nginx/sites-enabled/haulmind
  sudo rm -f /etc/nginx/sites-enabled/default
  echo "✋ Put your domain in /etc/nginx/sites-available/haulmind (YOUR-DOMAIN)"
fi
sudo nginx -t && sudo systemctl reload nginx

echo
echo "✅ Running. Check:  curl -s localhost:5000/api/v1/health"
echo "   HTTPS:           sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d YOUR-DOMAIN"
