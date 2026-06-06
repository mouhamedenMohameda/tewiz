# Tewiz

Ride-hailing platform for Mauritania.

Three apps, one backend, manual KYC, prepaid commission wallet (Bankily/Masrivi top-ups), and a set of features tailored to Mauritanian context: going-home mode, package delivery, recurring rides, favorite captains, blocked-roads map, demand heatmap, and booking-for-someone-else via SMS.

## Stack

- **Backend** — Node 20 + TypeScript, Express, Zod, `pg` (raw SQL), Redis, JWT
- **Database** — PostgreSQL 16 + PostGIS
- **Mobile apps** — React Native (Expo) — captain, rider _(placeholders for now)_
- **Admin** — Next.js _(placeholder for now)_
- **Maps** — Mapbox
- **Monorepo** — pnpm workspaces

## Project layout

```
apps/
  api/            # Express + TypeScript backend
  captain-app/    # Expo (to scaffold later)
  rider-app/      # Expo (to scaffold later)
  admin-web/      # Next.js (to scaffold later)
packages/
  shared-types/   # TS types shared across apps
db/
  migrations/     # Raw SQL migrations (node-pg-migrate)
docs/             # Design notes, runbooks
scripts/          # Dev helpers
```

## Getting started

Postgres+PostGIS and Redis run on a **Contabo VPS** (no Docker locally).
See [docs/contabo-setup.md](docs/contabo-setup.md) for the one-time server setup.

Once the VPS is set up:

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file and set DATABASE_URL with your DB password
cp .env.example .env

# 3. Open the SSH tunnel to the VPS (leave this terminal running)
ssh -L 5432:localhost:5432 -L 6379:localhost:6379 root@5.189.153.144
# Or, with ~/.ssh/config set up: ssh tewiz-db

# 4. In another terminal: run migrations
pnpm db:migrate

# 5. Start the API
pnpm dev
```

API runs at http://localhost:3000. Health check: `GET /health`.

## Domain glossary

- **NNI** — Numéro National d'Identification (Mauritanian national ID)
- **Carte grise** — vehicle registration certificate
- **Vignette** — annual road tax sticker
- **Visite technique** — vehicle technical inspection certificate
- **MRU** — Mauritanian Ouguiya (currency). 1 MRU = 5 **khoums**.
  In code, all amounts are stored in khoums as integers.
- **Captain** — driver
- **Rider** — passenger booking the ride
- **Booker** — the user who books a ride; may differ from passenger (see "course pour quelqu'un d'autre")

## Money

All monetary values are stored as **integer khoums**. Never use floats.
Format on display: `formatMru(khoums)` → `"205 MRU"`.

## Features

See [docs/features.md](docs/features.md).
