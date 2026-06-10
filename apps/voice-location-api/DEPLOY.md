# Voice-Location API — Deployment

The voice-location API runs **alongside the main Tewiz API** on the same
host (`tewiz-api.radar-mr.com`). It listens on `127.0.0.1:4100` and is
**not exposed to the public internet** — the main API proxies all
requests under `/rider/voice-to-location[/confirm]` with a server-side
`X-API-Key` the mobile app never sees.

## Topology

```
mobile app ──(JWT)──▶  tewiz-api.radar-mr.com  ──(X-API-Key)──▶  127.0.0.1:4100
                       (main API, public)                       (voice API, loopback only)
```

## Prerequisites on the host

The voice API shares the main API's:
- PostgreSQL database (`tewiz`) — same `DATABASE_URL`
- Node.js (≥ 20, for native `fetch` + `FormData`)
- pnpm

It additionally requires:
- `OPENAI_API_KEY`        (Whisper)
- `ANTHROPIC_API_KEY`     (Claude extraction)
- `GOOGLE_MAPS_API_KEY`   (Geocoding fallback; IP-restricted to the prod host)
- The `pg_trgm` Postgres extension (created automatically by the migration)

## First-time setup

1. Pull the repo on the prod host.
2. `pnpm install` at the repo root.
3. Apply migrations:
   ```bash
   psql "$DATABASE_URL" -f db/migrations/0012_voiceloc_pois.sql
   psql "$DATABASE_URL" -f db/migrations/0013_voiceloc_confirmations.sql
   ```
4. Seed the corpus:
   ```bash
   cd apps/voice-location-api
   pnpm ingest-pois           # OSM Nouakchott (~2 000 POIs, ~10 s)
   pnpm ingest-pois-manual    # manual seeds (Carrefour Oum Ghasser …)
   ```
5. Create a server-side API key for the main API:
   ```bash
   pnpm create-key --client "tewiz-main-api" --quota 0
   ```
   Copy the printed `vl_live_...` into the **main API**'s `.env` as
   `VOICE_API_KEY=...`.
6. Build the app:
   ```bash
   pnpm build       # tsc → dist/
   ```

## Running under PM2

If the main API already uses PM2, add the voice API to the same
ecosystem file. Example `ecosystem.config.cjs` block (alongside the
main API):

```js
module.exports = {
  apps: [
    {
      name: 'tewiz-api',
      cwd: '/srv/tewiz/apps/api',
      script: 'dist/index.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'tewiz-voice-api',
      cwd: '/srv/tewiz/apps/voice-location-api',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        VOICE_API_PORT: '4100',
        // VOICE_API_PORT is read by config.ts and binds to 0.0.0.0.
        // Behind nginx / a reverse proxy, this is fine because we
        // configure no public route for it. Optionally:
        //   net.ipv4.ip_local_port_range
        // or use HOST=127.0.0.1 if you fork the listener.
      },
    },
  ],
};
```

Start:
```bash
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

## Nginx — keep voice-API private

Do **not** add an upstream block for port 4100. The main API talks to it
over localhost. The reverse proxy only needs to forward `/rider/*` (and
the rest of the public API) to port 3000.

## Health check

The voice API exposes `/health`. Hit it from the host to confirm:
```bash
curl -fsS http://127.0.0.1:4100/health
```

The main API's `/health` will continue to be the externally-monitored
endpoint. The voice API has no public probe.

## Refresh schedule (recommended)

- **POI corpus** — `pnpm ingest-pois` monthly via cron (OSM data drifts
  but isn't volatile in Mauritania).
- **Manual seeds** — re-run `pnpm ingest-pois-manual` after editing
  `seeds/manual-pois.json` to add a missing landmark.
- **Requests TTL** — `voiceloc_requests` rows expire after 24 h. Add a
  daily `DELETE FROM voiceloc_requests WHERE expires_at < now()` if the
  table grows beyond ~1 M rows.

## Failure modes & fallbacks

| If… | The mobile app still works because… |
|---|---|
| Voice API process down | The main API proxy returns 502 → mobile shows the existing text/map search |
| Postgres down | Same as above (whole stack is down anyway) |
| OpenAI rate-limit | Voice request returns 5xx → mobile falls back to manual entry |
| Anthropic rate-limit | Same |
| Google Geocoding denied | Voice API still returns local-corpus matches; only unknown places fail |
| POI corpus empty | Geocoder always falls back to Google — slower but correct |
