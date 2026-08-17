/**
 * Assigned-places selection.
 *
 * Picks the concrete pickup/destination POIs a tester is asked to speak, so
 * the gold label is fixed BEFORE the recording rather than chosen after it.
 * See migration 0082 for why that matters and what it costs.
 *
 * Three rules drive the choice:
 *
 *   * KNOWN PLACES. A tester who has never heard of the assigned POI either
 *     guesses or skips; the first produces noise labelled as ground truth. So
 *     candidates are drawn at random from the most POPULAR matches rather than
 *     uniformly from the corpus.
 *
 *   * UNAMBIGUOUS BY DEFAULT. A POI whose name is shared with others is only
 *     assigned when the scenario's difficulty axis is deliberately 'homonym' —
 *     that is the case the pipeline must be tested on, and the only case where
 *     the ambiguity is the point rather than an accident.
 *
 *   * A REAL TRIP. Pickup near the assigned moughataa, destination anywhere in
 *     the city but at least MIN_TRIP_M away, so the pair produces a distance
 *     the fare estimator can actually price.
 */

import { pool } from '../../db/pool.js';
import { SCENARIO_ZONES, zoneCentre, type Scenario } from './scenario.js';

/** Generous box around Nouakchott — destinations may sit anywhere inside it. */
const CITY_BOX = { minLat: 17.90, maxLat: 18.25, minLng: -16.10, maxLng: -15.80 };

/**
 * Bounding box around a zone centre used only to PREFILTER candidates before
 * the exact test below. Generous on purpose — it must not exclude a POI that
 * genuinely belongs to the zone, merely spare the planner a full scan.
 */
const ZONE_PREFILTER_KM = 8;

/**
 * Does a POI belong to the declared moughataa?
 *
 * Answered against the real administrative polygon in nkc_districts when one
 * has been ingested (see migration 0084 and scripts/ingest-nkc-districts.ts),
 * and only then falls back to the nearest-centroid partition below.
 *
 * The history matters, because two approximations were tried and both failed in
 * the field. A RADIUS around a centre could not work: the real centroids of
 * Arafat and El Mina sit 2.1 km apart, so any radius wide enough to offer a
 * useful choice of places reached into the neighbour. A VORONOI partition of the
 * same centres removed the overlap but not the error, because a moughataa is not
 * a disc and its edge is not equidistant between two centres — places near any
 * boundary still landed on the wrong side. Both modelled a district as a point
 * plus a rule, when a district is an area with a surveyed edge.
 *
 * The centroid fallback is kept only so a district whose polygon has not been
 * fetched still yields assignments instead of an error. It carries the same
 * boundary error as before; the ingester reports which districts are in that
 * state.
 */
const NEAREST_CENTROID_SQL = `
  (SELECT z.code
     FROM (VALUES ${SCENARIO_ZONES.map(
    (z) => `('${z.code}', ${z.lat}::float8, ${z.lng}::float8)`,
  ).join(', ')}) AS z(code, zlat, zlng)
    ORDER BY (candidates.lat - z.zlat) * (candidates.lat - z.zlat)
           + ((candidates.lng - z.zlng) * cos(radians(candidates.lat)))
           * ((candidates.lng - z.zlng) * cos(radians(candidates.lat)))
    LIMIT 1)
`;

/**
 * Membership test for one declared zone code.
 *
 * Reads as: if a polygon exists for this district, the POI must be inside it;
 * if none does, fall back to the nearest centroid. Written as a single SQL
 * expression so the planner can use the GiST index on nkc_districts.geom.
 */
function zoneMembershipSql(zone: string): string {
  const code = zone.replace(/'/g, "''");
  return `(
    CASE
      WHEN EXISTS (SELECT 1 FROM nkc_districts d WHERE d.code = '${code}')
      THEN EXISTS (
        SELECT 1 FROM nkc_districts d
         WHERE d.code = '${code}'
           AND ST_Covers(
                 d.geom,
                 ST_SetSRID(ST_MakePoint(candidates.lng, candidates.lat), 4326)::geography
               )
      )
      ELSE ${NEAREST_CENTROID_SQL} = '${code}'
    END
  )`;
}

/** Shortest trip worth pricing. Below this the fare is the base fare either way. */
const MIN_TRIP_M = 800;

/** How many popular candidates to sample from. Wide enough to vary, narrow
 *  enough that the result is a place people have actually heard of. */
const CANDIDATE_POOL = 40;

/**
 * Radius within which a category's local frequency is counted. Roughly district
 * scale, which is the granularity the card shows.
 */
const DESCRIPTOR_UNIQUE_RADIUS_M = 2000;

/**
 * How many POIs of the same category may sit within that radius and still be
 * assignable.
 *
 * This was 1 — strict uniqueness — introduced to stop "a school in Ksar", which
 * identifies nothing where Ksar has twenty. Measured against the real corpus
 * afterwards, that rule proved far too strong: 62 assignable places in the whole
 * city out of 838 landmark-grade ones, 3 of them in Ksar. Categories cluster in
 * a city, so nearly everything failed.
 *
 *     threshold   assignable, city-wide
 *     <= 1                62
 *     <= 2               120
 *     <= 3               160
 *     <= 5               227
 *     none               838
 *
 * 3 is the chosen balance. The tester tells apart at most three places of one
 * category, which landmarks quoted to 100-800 m do comfortably, and 160 places
 * over roughly 800 assignment slots means about five evenly spread uses each --
 * repetition that costs nothing, since the same place in another voice and
 * another noise is exactly what tests robustness. What had to be avoided was one
 * place taking 29 of 80 slots, which is what uniform sampling did.
 *
 * Raising it to 5 buys little where the corpus is already thin (Teyarett gains
 * nothing, Sebkha three) while making the descriptor markedly vaguer.
 */
const DESCRIPTOR_MAX_LOCAL = 3;

/** Landmarks shown to identify the place without naming it. */
const LANDMARK_RADIUS_M = 700;
/** Second sweep when the first finds nothing that avoids echoing the name. */
const LANDMARK_FALLBACK_RADIUS_M = 2500;
const LANDMARK_COUNT = 3;

/**
 * Categories a place must belong to before it can be assigned.
 *
 * The first version drew from raw OSM popularity and handed testers things like
 * "an electronics shop" (Aziz Telecom). That failed twice over:
 *
 *   * UNIDENTIFIABLE. Category plus district plus landmarks only pins a place
 *     down when the category is itself distinguishing. There is one maternity
 *     in Sebkha; there are fifty phone shops.
 *   * UNREALISTIC. No rider asks a taxi for "the electronics shop". They name
 *     landmarks — the maternity, Mgeysira market, Carrefour Madrid — so a
 *     corpus built on small shops tests speech the pipeline will never hear.
 *
 * Restricting to landmark-grade categories fixes both at once, and has a third
 * effect that resolves the tension in this whole screen: for these kinds the
 * descriptor and the spoken name converge. "A maternity · Sebkha" reads as
 * "the maternity in Sebkha" — identifying, without ever printing the label the
 * tester would otherwise read aloud.
 *
 * The long tail stays fully searchable in free mode; it is only barred from
 * being ASSIGNED.
 */
const ASSIGNABLE_KINDS = [
  // Neighbourhoods and localities — what riders name most often.
  'suburb', 'neighbourhood', 'quarter', 'city', 'town', 'village', 'locality',
  // Civic and health landmarks.
  'hospital', 'clinic', 'doctors', 'maternity', 'pharmacy',
  'university', 'college', 'school', 'kindergarten',
  'police', 'townhall', 'courthouse', 'post_office', 'prison', 'embassy',
  // Commerce at landmark scale — a market, not a stall.
  'marketplace', 'supermarket', 'mall',
  // Movement.
  'bus_station', 'taxi', 'fuel', 'aerodrome', 'airport', 'ferry_terminal',
  'crossing', 'junction', 'roundabout', 'motorway_junction',
  // Worship, leisure, hospitality.
  'place_of_worship', 'mosque', 'stadium', 'sports_centre', 'pitch', 'park',
  'hotel', 'restaurant',
] as const;

/** SQL fragment restricting candidates to the assignable categories. */
const ASSIGNABLE_FILTER = `kind = ANY(ARRAY[${
  ASSIGNABLE_KINDS.map((k) => `'${k}'`).join(',')
}])`;

export interface AssignedLandmark {
  /** Stable identity for list keys — two landmarks can share a label. */
  poiId: number;
  label: string;
  /** OSM name:ar, when tagged. The client prefers it in an Arabic interface. */
  nameAr: string | null;
  kind: string;
  distanceM: number;
}

export interface AssignedPlace {
  poiId: number;
  /**
   * Display label of the neighbourhood the POI sits in, from the nearest
   * neighbourhood POI in the corpus. Null when the POI is itself one.
   *
   * A LABEL, not a zone code — the client shows it verbatim. It is deliberately
   * finer than the scenario's moughataa: "Arafatt Secteur 1" situates a place,
   * "Arafat" barely does.
   */
  district: string | null;
  /** Arabic form of `district`, when OSM tags one. */
  districtAr: string | null;
  /** Withheld by the client until after recording — see migration 0082. */
  label: string;
  nameAr: string | null;
  kind: string;
  lat: number;
  lng: number;
  /** How many POIs in the corpus share this exact folded name. 1 = unique. */
  nameCount: number;
  /**
   * How many POIs of the SAME category sit within ~2 km. 1 means the descriptor
   * shown on screen designates a single place; up to DESCRIPTOR_MAX_LOCAL is
   * accepted, and the landmarks then carry the disambiguation.
   */
  descriptorCount: number;
  /** Times this POI already appears in the corpus. 0 = new vocabulary. */
  timesUsed: number;
  landmarks: AssignedLandmark[];
}

export interface Assignment {
  scenario: Scenario;
  pickup: AssignedPlace | null;
  destination: AssignedPlace | null;
  /** Straight-line metres between the two, when both are present. */
  tripDistanceM: number | null;
}

interface CandidateRow {
  id: string;
  label: string;
  name_ar: string | null;
  kind: string;
  lat: number;
  lng: number;
  name_count: number;
  descriptor_count: number;
  times_used: number;
}

/**
 * Folded-name frequency across the whole corpus, plus the display fields.
 *
 * Ambiguity is defined as an exact match on the ACCENT-FOLDED display name
 * (voiceloc_fold, migration 0081): "Carrefour Madrid" appearing three times is
 * the real failure mode, and a looser trigram definition would flag half the
 * "Carrefour …" family as ambiguous with each other, which they are not — a
 * rider saying "Carrefour Madrid" is not ambiguous at all.
 */
const CANDIDATE_CTE = `
  WITH usage AS (
    -- How often each POI has already been recorded, in either role. Rejected
    -- samples are excluded: they will never reach an evaluation split, so
    -- counting them would starve a place that has no usable recording yet.
    SELECT poi_id, COUNT(*)::int AS times_used FROM (
      SELECT pickup_poi_id AS poi_id FROM voice_dataset_samples
       WHERE status <> 'rejected' AND pickup_poi_id IS NOT NULL
      UNION ALL
      SELECT destination_poi_id FROM voice_dataset_samples
       WHERE status <> 'rejected' AND destination_poi_id IS NOT NULL
    ) u GROUP BY poi_id
  ),
  labelled AS (
    SELECT id,
           COALESCE(NULLIF(name_fr, ''), name_default) AS label,
           name_ar,
           COALESCE(osm_value, osm_kind) AS kind,
           lat, lng, popularity
      FROM voiceloc_pois
     WHERE length(COALESCE(NULLIF(name_fr, ''), name_default)) >= 3
  ),
  counts AS (
    SELECT voiceloc_fold(label) AS fold, COUNT(*)::int AS n
      FROM labelled GROUP BY 1
  ),
  candidates AS (
    SELECT l.*, c.n AS name_count, COALESCE(u.times_used, 0) AS times_used
      FROM labelled l
      JOIN counts c ON c.fold = voiceloc_fold(l.label)
      LEFT JOIN usage u ON u.poi_id = l.id
  )
`;

/**
 * Draw one POI inside a bounding box.
 *
 * `wantHomonym` flips the ambiguity filter. Both branches fall back to the
 * other side rather than returning nothing: a zone with no unique-named POI
 * should still yield an assignment, because an imperfect one beats a tester
 * staring at an error.
 */
async function drawPlace(opts: {
  box: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  wantHomonym: boolean;
  excludeId?: number;
  awayFrom?: { lat: number; lng: number; minMetres: number };
  /** Restrict to POIs whose nearest moughataa centroid is this one. */
  inZone?: string;
}): Promise<CandidateRow | null> {
  const params: unknown[] = [
    opts.box.minLat, opts.box.maxLat, opts.box.minLng, opts.box.maxLng,
    opts.excludeId ?? null,
  ];

  let distanceSql = '';
  if (opts.awayFrom) {
    // Degrees squared against a degree-converted threshold — cheap, and
    // monotonic in true distance at city scale.
    //
    // The cos(latitude) factor on the longitude term is NOT cosmetic: without
    // it a degree of longitude is treated as a degree of latitude, and a pair
    // separated mostly east-west clears an 800 m threshold at a true 760 m.
    // Measured: pairs came back at 773 m. metresBetween() below applies the
    // same factor, so both now speak the same metric — a filter and a
    // measurement that disagree is how a bound silently stops holding.
    const degrees = opts.awayFrom.minMetres / 111_000;
    params.push(opts.awayFrom.lat, opts.awayFrom.lng, degrees * degrees);
    const lat = `$${params.length - 2}`;
    const lng = `$${params.length - 1}`;
    distanceSql = `AND ((lat - ${lat}) * (lat - ${lat})
                      + ((lng - ${lng}) * cos(radians(${lat})))
                      * ((lng - ${lng}) * cos(radians(${lat}))))
                     > $${params.length}`;
  }

  const run = async (
    homonym: boolean, landmarkGrade: boolean, uniqueDescriptor: boolean,
  ): Promise<CandidateRow | null> => {
    const { rows } = await pool.query<CandidateRow>(
      `${CANDIDATE_CTE}
       SELECT id, label, name_ar, kind, lat, lng, name_count, descriptor_count,
              times_used FROM (
         SELECT p.*, (
           SELECT COUNT(*) FROM candidates c2
            WHERE c2.kind = p.kind
              AND c2.lat BETWEEN p.lat - ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000}
                             AND p.lat + ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000}
              AND c2.lng BETWEEN p.lng - ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000} / cos(radians(p.lat))
                             AND p.lng + ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000} / cos(radians(p.lat))
         )::int AS descriptor_count
         FROM (
           SELECT * FROM candidates
            WHERE lat BETWEEN $1 AND $2
              AND lng BETWEEN $3 AND $4
              AND ($5::bigint IS NULL OR id <> $5::bigint)
              AND name_count ${homonym ? '> 1' : '= 1'}
              ${opts.inZone ? `AND ${zoneMembershipSql(opts.inZone)}` : ''}
              ${landmarkGrade ? `AND ${ASSIGNABLE_FILTER}` : ''}
              ${distanceSql}
            ORDER BY popularity DESC
            LIMIT ${CANDIDATE_POOL}
         ) p
       ) pool
       ${uniqueDescriptor ? `WHERE descriptor_count <= ${DESCRIPTOR_MAX_LOCAL}` : ''}
       -- Coverage pressure on the place vocabulary: never-recorded POIs first,
       -- then the rarest. Measured before this existed, one POI took 29 of 80
       -- slots across 40 assignments — a small pool plus a uniform draw makes
       -- collisions the norm, not an edge case.
       --
       -- random() INSIDE the tier, not after it: taking the strict minimum
       -- would hand two testers recording at the same moment the identical
       -- place, deterministically — worse than the uniform draw it replaces.
       ORDER BY times_used ASC, random()
       LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  };

  // Preference order, most answerable first: a landmark-grade category whose
  // descriptor is locally unique, then a unique descriptor of any category,
  // then landmark-grade without uniqueness, then anything. Each relaxation
  // makes the place harder to recognise from its description alone — which is
  // why the screen offers to reveal the name rather than assuming the tester
  // will manage.
  return (await run(opts.wantHomonym, true, true))
    ?? (await run(!opts.wantHomonym, true, true))
    ?? (await run(opts.wantHomonym, false, true))
    ?? (await run(opts.wantHomonym, true, false))
    ?? (await run(!opts.wantHomonym, true, false))
    ?? (await run(!opts.wantHomonym, false, false));
}

/** Nearby POIs used to identify a place on screen without writing its name. */
async function landmarksFor(
  place: CandidateRow,
  districtLabel: string | null,
  radiusM: number = LANDMARK_RADIUS_M,
): Promise<AssignedLandmark[]> {
  const dLat = radiusM / 111_000;
  const dLng = dLat / Math.cos((place.lat * Math.PI) / 180);

  // DISTINCT ON the folded label: Nouakchott has several "Las Palmas", and
  // listing the same name twice tells the tester nothing while costing one of
  // the three slots. Keeping the NEAREST instance of each name is also the more
  // useful one to navigate by.
  const { rows } = await pool.query<{
    id: string; label: string; name_ar: string | null; kind: string; distance_m: number;
  }>(
    `${CANDIDATE_CTE}
     SELECT id, label, name_ar, kind, distance_m FROM (
       SELECT DISTINCT ON (voiceloc_fold(label))
              id, label, name_ar, kind, popularity,
              -- Equirectangular approximation: exact enough under a kilometre,
              -- and PostGIS is not available on this table (migration 0012).
              round(111000 * sqrt(
                (lat - $1) * (lat - $1)
                + ((lng - $2) * cos(radians($1))) * ((lng - $2) * cos(radians($1)))
              ))::int AS distance_m
         FROM candidates
        WHERE id <> $3::bigint
          AND lat BETWEEN $1 - $4 AND $1 + $4
          AND lng BETWEEN $2 - $5 AND $2 + $5
            -- A landmark must not SPELL OUT the name being withheld. Excluding
          -- only exact matches was not enough: the assigned place "Sebkha"
          -- came back flanked by "Stade Sebkha" and "Commissariat de Police de
          -- Sebkha", printing the answer above the record button. Containment
          -- in either direction is the real test.
          AND voiceloc_fold(label) NOT LIKE '%' || voiceloc_fold($6) || '%'
          AND voiceloc_fold($6) NOT LIKE '%' || voiceloc_fold(label) || '%'
          -- Nor repeat the district already shown on the card, which would
          -- spend one of three slots saying the same thing twice.
          AND ($8::text IS NULL OR voiceloc_fold(label) <> voiceloc_fold($8::text))
        ORDER BY voiceloc_fold(label), distance_m ASC
     ) d
     ORDER BY popularity DESC
     LIMIT $7`,
    [place.lat, place.lng, place.id, dLat, dLng, place.label, LANDMARK_COUNT,
      districtLabel],
  );

  // Filtering out every same-named neighbour can empty the list, and a card
  // with no district and no landmarks identifies nothing at all. One wider
  // sweep usually finds neighbours that do not echo the name; if even that
  // comes back empty the tester still has the reveal button, which is the
  // designed path for a place that cannot be described without naming it.
  if (rows.length === 0 && radiusM < LANDMARK_FALLBACK_RADIUS_M) {
    return landmarksFor(place, districtLabel, LANDMARK_FALLBACK_RADIUS_M);
  }

  return rows.map((r) => ({
    poiId: Number(r.id), label: r.label, nameAr: r.name_ar,
    kind: r.kind, distanceM: r.distance_m,
  }));
}

async function toPlace(row: CandidateRow): Promise<AssignedPlace> {
  // Resolved before the landmarks so they can exclude it.
  const district = await districtFor(row);
  return {
    poiId: Number(row.id),
    district: district?.label ?? null,
    districtAr: district?.nameAr ?? null,
    label: row.label,
    nameAr: row.name_ar,
    kind: row.kind,
    lat: row.lat,
    lng: row.lng,
    nameCount: row.name_count,
    descriptorCount: row.descriptor_count,
    timesUsed: row.times_used,
    landmarks: await landmarksFor(row, district?.label ?? null),
  };
}

/** OSM categories that ARE a district rather than sit inside one. */
const PLACE_KINDS = [
  'suburb', 'neighbourhood', 'quarter', 'locality', 'city', 'town', 'village',
];

const PLACE_KIND_FILTER = `kind = ANY(ARRAY[${
  PLACE_KINDS.map((k) => `'${k}'`).join(',')
}])`;

/** How far to look for the neighbourhood a POI sits in. */
const DISTRICT_RADIUS_M = 3000;

/**
 * The district a POI sits in, taken from the nearest neighbourhood POI.
 *
 * This replaced a nearest-moughataa-centre computation that labelled "Arafatt
 * Secteur 1 Extension" as El Mina. The bug was not the arithmetic: SCENARIO_ZONES
 * holds nine hand-set centres, documented as accurate to about a kilometre and
 * built to be a SEARCH ORIGIN — somewhere to draw candidates around. Using them
 * to CLASSIFY a point is a different job they cannot do, because a moughataa is
 * a wide polygon and its western edge is nearer the neighbour's centre than its
 * own.
 *
 * The corpus already carries real neighbourhoods as POIs with real positions,
 * so the nearest one is both correct and more precise than a moughataa —
 * "Arafatt Secteur 1" rather than "Arafat".
 *
 * Returns null when the POI is ITSELF a neighbourhood: naming the nearest one
 * would either echo its own name — defeating the point of withholding it — or
 * attach a neighbour's name to it. The category and the landmarks identify it
 * on their own.
 */
async function districtFor(
  place: CandidateRow,
): Promise<{ label: string; nameAr: string | null } | null> {
  if (PLACE_KINDS.includes(place.kind)) return null;

  const dLat = DISTRICT_RADIUS_M / 111_000;
  const dLng = dLat / Math.cos((place.lat * Math.PI) / 180);

  const { rows } = await pool.query<{ label: string; name_ar: string | null }>(
    `${CANDIDATE_CTE}
     SELECT label, name_ar FROM candidates
      WHERE ${PLACE_KIND_FILTER}
        AND id <> $3::bigint
        -- Explicit casts: with every operand a bare parameter, "$1 - $4" gives
        -- Postgres unknown minus unknown and it refuses to pick an operator.
        AND lat BETWEEN $1::float8 - $4::float8 AND $1::float8 + $4::float8
        AND lng BETWEEN $2::float8 - $5::float8 AND $2::float8 + $5::float8
      ORDER BY (lat - $1::float8) * (lat - $1::float8)
             + ((lng - $2::float8) * cos(radians($1::float8)))
             * ((lng - $2::float8) * cos(radians($1::float8))) ASC
      LIMIT 1`,
    [place.lat, place.lng, place.id, dLat, dLng],
  );
  const row = rows[0];
  return row ? { label: row.label, nameAr: row.name_ar } : null;
}

function metresBetween(a: AssignedPlace, b: AssignedPlace): number {
  const dLat = (a.lat - b.lat) * 111_000;
  const dLng = (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
}

/**
 * Build the full assignment for a scenario.
 *
 * Which endpoints are drawn follows the structure the scenario asks for, so a
 * "pickup_only" assignment never shows a destination the tester would then feel
 * obliged to mention.
 */
export async function buildAssignment(scenario: Scenario): Promise<Assignment> {
  const centre = zoneCentre(scenario.zone);
  const dLat = ZONE_PREFILTER_KM / 111;
  const dLng = centre ? dLat / Math.cos((centre.lat * Math.PI) / 180) : dLat;

  const pickupBox = centre
    ? {
      minLat: centre.lat - dLat, maxLat: centre.lat + dLat,
      minLng: centre.lng - dLng, maxLng: centre.lng + dLng,
    }
    : CITY_BOX;

  const wantHomonym = scenario.difficulty === 'homonym';
  const needsPickup = scenario.structure !== 'destination_only';
  const needsDestination = scenario.structure === 'from_to'
    || scenario.structure === 'round_trip'
    || scenario.structure === 'destination_only';

  const pickupRow = needsPickup
    ? await drawPlace({ box: pickupBox, wantHomonym, inZone: scenario.zone })
    : null;
  const pickup = pickupRow ? await toPlace(pickupRow) : null;

  const destinationRow = needsDestination
    ? await drawPlace({
      box: CITY_BOX,
      // Only one endpoint carries the homonym: two ambiguous places in one
      // request tests nothing in particular and is simply hard to speak.
      wantHomonym: wantHomonym && !pickup,
      excludeId: pickup?.poiId,
      ...(pickup
        ? { awayFrom: { lat: pickup.lat, lng: pickup.lng, minMetres: MIN_TRIP_M } }
        : {}),
    })
    : null;
  const destination = destinationRow ? await toPlace(destinationRow) : null;

  // Report the structure that was actually assignable, not the one asked for.
  // A sparse corner of the corpus can leave an endpoint undrawable, and a brief
  // announcing "from X to Y" while showing one place reads as a bug to the
  // tester — and would be recorded against the wrong structure label.
  let structure = scenario.structure;
  if (needsDestination && !destination) {
    structure = pickup ? 'pickup_only' : structure;
  } else if (needsPickup && !pickup && destination) {
    structure = 'destination_only';
  }

  return {
    scenario: { ...scenario, structure },
    pickup,
    destination,
    tripDistanceM: pickup && destination ? metresBetween(pickup, destination) : null,
  };
}
