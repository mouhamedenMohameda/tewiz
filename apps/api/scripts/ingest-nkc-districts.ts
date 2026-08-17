/**
 * Fetch Nouakchott's moughataa boundaries into nkc_districts.
 *
 *   pnpm --filter @tewiz/api ingest:districts
 *
 * Idempotent: re-running replaces each polygon it can fetch and leaves the rest
 * untouched, so a partial run is safe to repeat.
 *
 * WHY THIS EXISTS: the voice-dataset assigner used to decide "is this POI in
 * the district the tester declared" from a centre plus a radius, then from a
 * Voronoi partition of those centres. Both put the Arafat neighbourhood
 * Elveloudja in El Mina, because a district is an area with a surveyed edge and
 * neither model has an edge. See db/migrations/0084_nkc_districts.sql.
 *
 * THE VALIDATION IS THE POINT. Nominatim will return a street, a building or a
 * neighbouring commune that happens to share a name, and a wrong polygon is far
 * worse than a missing one: it silently misassigns every POI inside it. So a
 * polygon is REJECTED unless it contains the district's published reference
 * point. Districts without a published point are ingested unvalidated and
 * reported as such — the operator can then eyeball them rather than assume.
 */
import { pool } from '../src/db/pool.js';

/** Nominatim asks for a real identifying User-Agent; sending none gets blocked. */
const USER_AGENT = 'tewiz-district-ingest/1.0 (+https://tewiz-api.radar-mr.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** Nominatim's usage policy is one request per second. Respect it. */
const REQUEST_INTERVAL_MS = 1100;

interface District {
  code: string;
  /** Query strings tried in order until one returns a valid polygon. */
  queries: string[];
  nameFr: string;
  nameAr: string | null;
  /** Published centroid, when one was available. Used to validate the polygon. */
  reference: { lat: number; lng: number } | null;
}

const DISTRICTS: District[] = [
  {
    code: 'tevragh_zeina',
    queries: ['Tevragh Zeina, Nouakchott, Mauritanie', 'Tevragh-Zeina, Mauritania'],
    nameFr: 'Tevragh-Zeina',
    nameAr: 'تفرغ زينة',
    reference: null,
  },
  {
    code: 'ksar',
    queries: ['Ksar, Nouakchott, Mauritanie', 'El Ksar, Nouakchott'],
    nameFr: 'Ksar',
    nameAr: 'لكصر',
    reference: null,
  },
  {
    code: 'sebkha',
    queries: ['Sebkha, Nouakchott, Mauritanie'],
    nameFr: 'Sebkha',
    nameAr: 'السبخة',
    reference: null,
  },
  {
    code: 'dar_naim',
    queries: ['Dar Naim, Nouakchott, Mauritanie', 'Dar-Naim, Mauritania'],
    nameFr: 'Dar Naim',
    nameAr: 'دار النعيم',
    reference: null,
  },
  {
    code: 'riyad',
    queries: ['Riyad, Nouakchott, Mauritanie', 'Riyadh, Nouakchott'],
    nameFr: 'Riyad',
    nameAr: 'الرياض',
    reference: { lat: 18.0107, lng: -15.9553 },
  },
  {
    code: 'arafat',
    queries: ['Arafat, Nouakchott, Mauritanie'],
    nameFr: 'Arafat',
    nameAr: 'عرفات',
    reference: { lat: 18.0464, lng: -15.9719 },
  },
  {
    code: 'toujounine',
    queries: ['Toujounine, Nouakchott, Mauritanie', 'Toujouonine, Mauritania'],
    nameFr: 'Toujounine',
    nameAr: 'توجنين',
    reference: { lat: 18.0833, lng: -15.9000 },
  },
  {
    code: 'el_mina',
    queries: ['El Mina, Nouakchott, Mauritanie', 'Elmina, Nouakchott'],
    nameFr: 'El Mina',
    nameAr: 'الميناء',
    reference: { lat: 18.0650, lng: -15.9771 },
  },
  {
    code: 'teyarett',
    queries: ['Teyarett, Nouakchott, Mauritanie', 'Teyarett, Mauritania'],
    nameFr: 'Teyarett',
    nameAr: 'تيارت',
    reference: { lat: 18.1278, lng: -15.9392 },
  },
];

interface NominatimHit {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  category?: string;
  type?: string;
  geojson?: { type: string; coordinates: unknown };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function search(query: string): Promise<NominatimHit[]> {
  const url = `${NOMINATIM}?${new URLSearchParams({
    q: query,
    format: 'jsonv2',
    polygon_geojson: '1',
    limit: '10',
    countrycodes: 'mr',
  })}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for "${query}"`);
  return (await res.json()) as NominatimHit[];
}

/**
 * Accept ONLY an administrative boundary with an area geometry.
 *
 * Requiring an area is not enough, and the gap was not theoretical: querying
 * "Tevragh Zeina, Nouakchott" returns the Bibliothèque Nationale and the Musée
 * National as polygons BEFORE the moughataa. Tevragh-Zeina has no published
 * reference point, so the containment check is skipped for it — an area-only
 * filter would have stored a library's footprint as the boundary of a district
 * of 11 km, and every POI outside that building would have been excluded from
 * its own moughataa.
 *
 * category=boundary + type=administrative is the authoritative signal, and it
 * was present for all nine moughataas when this was checked.
 */
function isAdministrativeArea(hit: NominatimHit): boolean {
  const t = hit.geojson?.type;
  const isArea = t === 'Polygon' || t === 'MultiPolygon';
  return isArea && hit.category === 'boundary' && hit.type === 'administrative';
}

/**
 * Does the candidate polygon contain the district's published centroid?
 *
 * Delegated to PostGIS rather than reimplemented: point-in-polygon on a
 * multipolygon with holes is exactly the kind of geometry one should not write
 * by hand.
 */
async function polygonContains(
  geojson: unknown,
  point: { lat: number; lng: number },
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT ST_Covers(
              -- ST_SetSRID is not redundant: ST_GeomFromGeoJSON is documented to
              -- return 4326, but has not done so across every PostGIS version,
              -- and a geometry left at SRID 0 cast to geography fails quietly
              -- rather than loudly.
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))::geography,
              ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
            ) AS ok`,
    [JSON.stringify(geojson), point.lng, point.lat],
  );
  return rows[0]?.ok === true;
}

interface Outcome {
  code: string;
  status: 'validated' | 'unvalidated' | 'rejected' | 'not_found';
  detail: string;
}

async function ingest(district: District): Promise<Outcome> {
  for (const query of district.queries) {
    let hits: NominatimHit[];
    try {
      hits = await search(query);
    } catch (e) {
      console.error(`  [${district.code}] ${String(e)}`);
      await sleep(REQUEST_INTERVAL_MS);
      continue;
    }
    await sleep(REQUEST_INTERVAL_MS);

    const areas = hits.filter(isAdministrativeArea);
    if (areas.length === 0) continue;

    for (const hit of areas) {
      // With a reference point the polygon must contain it; without one we take
      // the first area and say so, rather than pretend it was checked.
      if (district.reference) {
        const ok = await polygonContains(hit.geojson, district.reference);
        if (!ok) continue;
      }

      await pool.query(
        `INSERT INTO nkc_districts
           (code, name_fr, name_ar, geom, reference_lat, reference_lng, source, osm_id, fetched_at)
         VALUES ($1, $2, $3,
                 ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))::geography,
                 $5, $6, $7, $8, now())
         ON CONFLICT (code) DO UPDATE
           SET name_fr = EXCLUDED.name_fr,
               name_ar = EXCLUDED.name_ar,
               geom = EXCLUDED.geom,
               reference_lat = EXCLUDED.reference_lat,
               reference_lng = EXCLUDED.reference_lng,
               source = EXCLUDED.source,
               osm_id = EXCLUDED.osm_id,
               fetched_at = now()`,
        [
          district.code, district.nameFr, district.nameAr,
          JSON.stringify(hit.geojson),
          district.reference?.lat ?? null, district.reference?.lng ?? null,
          `nominatim:${hit.osm_type ?? '?'}`, hit.osm_id ?? null,
        ],
      );

      return {
        code: district.code,
        status: district.reference ? 'validated' : 'unvalidated',
        detail: `${hit.display_name ?? query} (${hit.geojson?.type})`,
      };
    }

    // Areas existed but none contained the reference point — the name matched
    // something else. Worth reporting rather than silently trying the next query.
    if (district.reference) {
      return {
        code: district.code,
        status: 'rejected',
        detail: `${areas.length} zone(s) trouvée(s), aucune ne contient le point de référence`,
      };
    }
  }

  return { code: district.code, status: 'not_found', detail: 'aucune géométrie de zone' };
}

async function main() {
  console.log(`[districts] ${DISTRICTS.length} moughataas à récupérer\n`);
  const outcomes: Outcome[] = [];

  for (const district of DISTRICTS) {
    console.log(`[districts] ${district.code} ...`);
    outcomes.push(await ingest(district));
  }

  const label: Record<Outcome['status'], string> = {
    validated: 'OK (validé par le point de référence)',
    unvalidated: 'OK (non validé — pas de point de référence)',
    rejected: 'REJETÉ',
    not_found: 'INTROUVABLE',
  };

  console.log('\n  résultat');
  console.log('  ─────────────────────────────────────────────');
  for (const o of outcomes) {
    console.log(`  ${o.code.padEnd(15)} ${label[o.status]}`);
    console.log(`  ${' '.repeat(15)} ${o.detail}`);
  }

  const stored = outcomes.filter((o) => o.status === 'validated' || o.status === 'unvalidated');
  console.log(`\n  ${stored.length}/${DISTRICTS.length} polygones en base.`);

  const missing = outcomes.filter((o) => o.status !== 'validated' && o.status !== 'unvalidated');
  if (missing.length > 0) {
    console.log('\n  Les quartiers manquants retombent sur le partage par centroïde,');
    console.log('  qui est approximatif aux frontières. Relancez, ou fournissez');
    console.log('  leur polygone à la main.');
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
