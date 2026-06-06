#!/usr/bin/env bash
# Initial setup for a fresh Contabo VPS (Ubuntu 22.04 / 24.04 / Debian 12).
# Run as root on the VPS:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/scripts/setup-contabo.sh | bash
# Or copy-paste sections manually the first time so you can read what happens.
#
# What this does:
#   1. System update
#   2. Create non-root deploy user 'tewiz'
#   3. Install Node.js 20 (for the API in prod)
#   4. Install PostgreSQL 16 + PostGIS 3 (from official PGDG repo)
#   5. Install Redis 7
#   6. Create the 'tewiz' database + user, enable PostGIS
#   7. Configure UFW firewall (SSH only, plus 80/443 for later)
#   8. Configure fail2ban
#   9. Bind Postgres + Redis to localhost ONLY (no public exposure)

set -euo pipefail

# --- Configuration: change these before running ---
DEPLOY_USER="tewiz"
DB_NAME="tewiz"
DB_USER="tewiz"
# Generate a strong password:  openssl rand -base64 32
DB_PASSWORD="${DB_PASSWORD:-CHANGE_ME_BEFORE_RUNNING}"

if [ "$DB_PASSWORD" = "CHANGE_ME_BEFORE_RUNNING" ]; then
  echo "ERROR: Set DB_PASSWORD before running, e.g.:"
  echo "  DB_PASSWORD=\"\$(openssl rand -base64 32)\" bash setup-contabo.sh"
  exit 1
fi

echo "==> 1/9 System update"
apt update && apt upgrade -y
apt install -y curl wget gnupg lsb-release ca-certificates ufw fail2ban git unzip

echo "==> 2/9 Create deploy user '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  mkdir -p "/home/$DEPLOY_USER/.ssh"
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/"
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    chmod 700 "/home/$DEPLOY_USER/.ssh"
    chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
fi

echo "==> 3/9 Install Node.js 20"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
  npm install -g pnpm@9
fi

echo "==> 4/9 Install PostgreSQL 16 + PostGIS"
if ! command -v psql >/dev/null 2>&1; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  apt update
  apt install -y postgresql-16 postgresql-16-postgis-3
  systemctl enable --now postgresql
fi

echo "==> 5/9 Install Redis"
if ! command -v redis-server >/dev/null 2>&1; then
  apt install -y redis-server
  systemctl enable --now redis-server
fi

echo "==> 6/9 Create database + user"
sudo -u postgres psql <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
EOF

if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

sudo -u postgres psql -d "$DB_NAME" <<EOF
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF

echo "==> 7/9 Bind Postgres + Redis to localhost only"
PG_CONF="/etc/postgresql/16/main/postgresql.conf"
sed -i "s/^#\?listen_addresses\s*=.*/listen_addresses = 'localhost'/" "$PG_CONF"
systemctl restart postgresql

REDIS_CONF="/etc/redis/redis.conf"
sed -i 's/^#\?bind .*/bind 127.0.0.1 ::1/' "$REDIS_CONF"
sed -i 's/^#\?protected-mode .*/protected-mode yes/' "$REDIS_CONF"
systemctl restart redis-server

echo "==> 8/9 Configure UFW firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable

echo "==> 9/9 Configure fail2ban"
systemctl enable --now fail2ban

echo ""
echo "================================================================"
echo "  Setup complete."
echo "================================================================"
echo ""
echo "  Database:  postgres://$DB_USER:****@localhost:5432/$DB_NAME"
echo "  Redis:     redis://localhost:6379"
echo "  SSH user:  $DEPLOY_USER  (root login should still work for now)"
echo ""
echo "  From your laptop, develop using an SSH tunnel:"
echo "    ssh -L 5432:localhost:5432 -L 6379:localhost:6379 root@<VPS_IP>"
echo ""
echo "  Then in your .env:"
echo "    DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo "    REDIS_URL=redis://localhost:6379"
echo ""
echo "  SECURITY TODO:"
echo "    1. Disable root SSH login once $DEPLOY_USER works:"
echo "         sed -i 's/^#\\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config"
echo "         systemctl restart ssh"
echo "    2. Save the DB password somewhere safe — it's not stored again."
echo "================================================================"
