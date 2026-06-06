# Contabo VPS setup

Your VPS: **Cloud VPS 20 SSD** at `5.189.153.144` (EU region).
Default user: `root`.

## Step 1 — Connect to the VPS

From your Mac:

```bash
ssh root@5.189.153.144
```

If this is the first SSH connection, Contabo emailed you the root password. Change it immediately:

```bash
passwd
```

Even better: set up SSH key authentication (do this **before** running the setup script, so the script can copy your key to the new deploy user):

```bash
# On your Mac, if you don't already have an SSH key:
ssh-keygen -t ed25519 -C "your.email@example.com"

# Copy it to the VPS:
ssh-copy-id root@5.189.153.144
```

## Step 2 — Verify the OS

```bash
cat /etc/os-release
```

The setup script assumes Ubuntu 22.04 / 24.04 or Debian 12 (all `apt`-based).
If you see something else (AlmaLinux, Rocky, CentOS), tell Claude — we'll adapt.

## Step 3 — Run the setup script

Generate a strong DB password and run the script:

```bash
# Still on the VPS as root:
cd /root
curl -O https://raw.githubusercontent.com/YOUR_REPO/main/scripts/setup-contabo.sh
# Or scp it from your Mac:
#   scp scripts/setup-contabo.sh root@5.189.153.144:/root/

chmod +x setup-contabo.sh
DB_PASSWORD="$(openssl rand -base64 32)" bash setup-contabo.sh
```

**Important:** copy the password from the final output and save it (password manager).

What the script does:
1. Updates the system
2. Creates a non-root `tewiz` user (sudo)
3. Installs Node 20 + pnpm
4. Installs PostgreSQL 16 + PostGIS
5. Installs Redis 7
6. Creates the `tewiz` database + extensions
7. **Binds Postgres + Redis to localhost only** (not exposed publicly)
8. Configures UFW firewall (SSH + 80 + 443 only)
9. Configures fail2ban

## Step 4 — Develop from your Mac via SSH tunnel

You don't expose Postgres to the internet. Instead, open a tunnel from your Mac:

```bash
ssh -L 5432:localhost:5432 -L 6379:localhost:6379 root@5.189.153.144
```

Leave that terminal open. In another terminal, your local API connects to `localhost:5432` — but the traffic is actually forwarded over SSH to the VPS.

Your `.env` on the Mac:

```
DATABASE_URL=postgres://tewiz:YOUR_PASSWORD@localhost:5432/tewiz
REDIS_URL=redis://localhost:6379
```

### Tip — persistent tunnel

Add this to `~/.ssh/config` on your Mac so you can just run `ssh tewiz-db`:

```
Host tewiz-db
  HostName 5.189.153.144
  User root
  LocalForward 5432 localhost:5432
  LocalForward 6379 localhost:6379
  ServerAliveInterval 60
```

Then: `ssh tewiz-db` opens the tunnel.

## Step 5 — Lock down SSH

Once your non-root user works (test it: `ssh tewiz@5.189.153.144`), disable root login:

```bash
# On the VPS:
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

After this, only key-based login as `tewiz` works. Test it from a **new** terminal before closing your current root session, otherwise you can lock yourself out.

## Step 6 — Run the migrations

From your Mac (with the SSH tunnel open):

```bash
pnpm db:migrate
```

This applies all SQL files in `db/migrations/` to your Contabo Postgres.

## Later: deploying the API in production

When ready to put the API in front of real users:
- Build the API on your Mac, copy to VPS
- Or `git pull` on the VPS and `pnpm install && pnpm build`
- Run it under `systemd` (we'll write the unit file when we get there)
- Put `nginx` in front for TLS (Let's Encrypt) on ports 80/443

## Backups

Critical. Set up daily `pg_dump` to a separate location:

```bash
# On the VPS — add to crontab (crontab -e):
0 3 * * * pg_dump -U tewiz tewiz | gzip > /var/backups/tewiz-$(date +\%F).sql.gz
0 4 * * * find /var/backups/ -name "tewiz-*.sql.gz" -mtime +14 -delete
```

Also consider enabling Contabo's "Auto Backup" add-on (panel → Add-Ons).
