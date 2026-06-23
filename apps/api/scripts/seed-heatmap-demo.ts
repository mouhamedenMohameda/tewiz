/**
 * Seed fake ride pickups around Nouakchott to demo the captain heatmap.
 *
 *   pnpm --filter @tewiz/api seed:heatmap          # insert ~1000 fake rides
 *   pnpm --filter @tewiz/api seed:heatmap clean    # delete the fake rides
 *
 * Picks ~10 realistic Nouakchott hotspots, samples Gaussian-noisy pickups
 * around each (denser at hot ones), spreads requested_at across the last
 * 2 hours so they all fall inside the heatmap window, and triggers an
 * immediate recompute so the result shows up in the app without waiting
 * for the 5-min cron.
 *
 * All fake rides carry pickup_label = '[seed:heatmap]' so the cleanup pass
 * can target them surgically without touching real data.
 */
import { pool } from '../src/db/pool.js';
import * as heatmap from '../src/modules/heatmap/heatmap.service.js';

const SEED_LABEL = '[seed:heatmap]';
const TOTAL_RIDES = 1000;

interface Hotspot {
  name: string;
  lat: number;
  lng: number;
  sigmaDeg: number;   // standard deviation in degrees (~0.005 ≈ 500 m)
  weight: number;     // share of total rides
}

// Nouakchott hotspots — rough coordinates of major activity zones.
const HOTSPOTS: Hotspot[] = [
  { name: 'Marche Capitale',    lat: 18.0900, lng: -15.9750, sigmaDeg: 0.004, weight: 20 },
  { name: 'Tevragh Zeina',      lat: 18.0853, lng: -15.9900, sigmaDeg: 0.006, weight: 18 },
  { name: 'Carrefour BMD',      lat: 18.0760, lng: -15.9700, sigmaDeg: 0.004, weight: 12 },
  { name: 'Ksar',               lat: 18.0700, lng: -15.9930, sigmaDeg: 0.005, weight: 10 },
  { name: 'Université',         lat: 18.1180, lng: -15.9700, sigmaDeg: 0.005, weight: 9 },
  { name: 'Sebkha',             lat: 18.1000, lng: -15.9650, sigmaDeg: 0.005, weight: 8 },
  { name: 'El Mina',            lat: 18.0500, lng: -15.9500, sigmaDeg: 0.006, weight: 7 },
  { name: 'Arafat',             lat: 18.0600, lng: -15.9300, sigmaDeg: 0.006, weight: 6 },
  { name: 'Riyadh',             lat: 18.0420, lng: -15.9450, sigmaDeg: 0.005, weight: 5 },
  { name: 'Aeroport',           lat: 18.0980, lng: -15.9000, sigmaDeg: 0.003, weight: 5 },
];

// Box-Muller: one sample from N(0,1).
function gaussian(): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pickHotspot(): Hotspot {
  const totalW = HOTSPOTS.reduce((s, h) => s + h.weight, 0);
  let r = Math.random() * totalW;
  for (const h of HOTSPOTS) {
    r -= h.weight;
    if (r <= 0) return h;
  }
  return HOTSPOTS[0]!;
}

async function clean(): Promise<void> {
  const r = await pool.query(
    `DELETE FROM rides WHERE pickup_label = $1`,
    [SEED_LABEL],
  );
  console.log(`Deleted ${r.rowCount ?? 0} seed rides.`);
}

async function ensureDemoUser(): Promise<string> {
  // Reuse any existing user as booker. Real users aren't touched: we only
  // need a valid FK target. If the DB has no users at all, prompt the user
  // to seed an admin first.
  const r = await pool.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
  if (r.rows[0]) return r.rows[0].id;
  throw new Error(
    'No users found in DB. Run `pnpm --filter @tewiz/api seed:admin <phone>` first.',
  );
}

async function seed(): Promise<void> {
  const bookerId = await ensureDemoUser();

  // Pre-generate all rides client-side, then bulk-insert in one round-trip
  // per chunk to keep the script fast.
  const rows: Array<{
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    requestedAt: Date;
  }> = [];

  for (let i = 0; i < TOTAL_RIDES; i++) {
    const h = pickHotspot();
    rows.push({
      pickupLat: h.lat + gaussian() * h.sigmaDeg,
      pickupLng: h.lng + gaussian() * h.sigmaDeg,
      // Dropoff doesn't influence the heatmap, but it's NOT NULL — pick a
      // random Nouakchott-wide point so the data still looks plausible.
      dropoffLat: 18.07 + Math.random() * 0.08,
      dropoffLng: -15.99 + Math.random() * 0.08,
      // Spread requested_at across the last 2 hours so every fake ride
      // falls inside the heatmap's WINDOW_MINUTES filter.
      requestedAt: new Date(Date.now() - Math.random() * 110 * 60_000),
    });
  }

  const CHUNK = 200;
  for (let off = 0; off < rows.length; off += CHUNK) {
    const slice = rows.slice(off, off + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const r of slice) {
      values.push(
        `($${p++}, ST_SetSRID(ST_MakePoint($${p++}, $${p++}), 4326)::geography,
          ST_SetSRID(ST_MakePoint($${p++}, $${p++}), 4326)::geography,
          $${p++}, $${p++}, $${p++}, $${p++})`,
      );
      params.push(
        bookerId,
        r.pickupLng, r.pickupLat,
        r.dropoffLng, r.dropoffLat,
        SEED_LABEL,
        'cancelled_by_system',  // keep them out of dispatch queues
        700,                      // commission_rate_bps (NOT NULL)
        r.requestedAt,
      );
    }
    await pool.query(
      `INSERT INTO rides
         (booker_id, pickup_location, dropoff_location, pickup_label, status, commission_rate_bps, requested_at)
       VALUES ${values.join(', ')}`,
      params,
    );
    process.stdout.write(`.`);
  }
  process.stdout.write('\n');

  console.log(`Inserted ${rows.length} fake rides across ${HOTSPOTS.length} hotspots.`);

  console.log('Recomputing heatmap…');
  const r = await heatmap.compute();
  console.log(`Heatmap rebuilt: ${r.cells} cells from ${r.recentRides} recent rides.`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'clean') {
    await clean();
  } else {
    await seed();
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
