import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { notifyProvidersRoadside } from '../push/expo-push.js';

/**
 * Roadside assistance ("Assistance Routière") — an on-demand SOS flow.
 *
 * A stranded driver broadcasts location + problem; opted-in providers near them
 * get an urgent push and the first to accept wins (atomic, like ride accept).
 * The search radius auto-expands until someone accepts or the timeout is hit,
 * after which the request becomes 'unresolved' and the app offers the human
 * hotline ("numéro vert").
 */

export const PROBLEM_TYPES = [
  'pneu', 'batterie', 'essence', 'moteur', 'remorquage', 'accident', 'autre',
] as const;
export type ProblemType = typeof PROBLEM_TYPES[number];

export type RoadsideStatus =
  'searching' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' | 'unresolved';

interface RoadsideConfig {
  enabled: boolean;
  initialRadiusM: number;
  radiusStepM: number;
  maxRadiusM: number;
  expandIntervalS: number;
  timeoutS: number;
  leadFeeMru: number;
  hotlinePhone: string | null;
}

async function getConfig(): Promise<RoadsideConfig> {
  const { rows } = await pool.query<{
    roadside_assistance_enabled: boolean;
    roadside_initial_radius_m: number;
    roadside_radius_step_m: number;
    roadside_max_radius_m: number;
    roadside_expand_interval_s: number;
    roadside_request_timeout_s: number;
    roadside_lead_fee_mru: number;
    roadside_hotline_phone: string | null;
  }>(
    `SELECT roadside_assistance_enabled, roadside_initial_radius_m, roadside_radius_step_m,
            roadside_max_radius_m, roadside_expand_interval_s, roadside_request_timeout_s,
            roadside_lead_fee_mru, roadside_hotline_phone
       FROM app_settings WHERE id = 1`,
  );
  const r = rows[0]!;
  return {
    enabled: r.roadside_assistance_enabled,
    initialRadiusM: r.roadside_initial_radius_m,
    radiusStepM: r.roadside_radius_step_m,
    maxRadiusM: r.roadside_max_radius_m,
    expandIntervalS: r.roadside_expand_interval_s,
    timeoutS: r.roadside_request_timeout_s,
    leadFeeMru: r.roadside_lead_fee_mru,
    hotlinePhone: r.roadside_hotline_phone,
  };
}

export interface CreateRoadsideInput {
  problemType: ProblemType;
  lat: number;
  lng: number;
  addressLabel?: string;
  note?: string;
  photoUrl?: string;
  radiusM?: number;
}

export interface RoadsideRequestDTO {
  id: string;
  problemType: ProblemType;
  note: string | null;
  addressLabel: string | null;
  status: RoadsideStatus;
  location: { lat: number; lng: number };
  searchRadiusM: number;
  createdAt: string;
  provider: {
    name: string;
    phone: string;
    ratingAvg: number | null;
    location: { lat: number; lng: number } | null;
  } | null;
  hotlinePhone: string | null;
}

interface RequestRow {
  id: string;
  requester_id: string;
  problem_type: ProblemType;
  note: string | null;
  address_label: string | null;
  status: RoadsideStatus;
  search_radius_m: number;
  provider_id: string | null;
  provider_phone: string | null;
  requester_phone: string | null;
  lat: number;
  lng: number;
  created_at: Date;
  provider_name: string | null;
  provider_rating: string | null;
  provider_lat: number | null;
  provider_lng: number | null;
}

const REQUEST_SELECT = `
  r.id, r.requester_id, r.problem_type, r.note, r.address_label, r.status,
  r.search_radius_m, r.provider_id, r.provider_phone, r.requester_phone,
  ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
  r.created_at,
  pu.full_name AS provider_name,
  pc.rating_avg AS provider_rating,
  ST_Y(ps.location::geometry) AS provider_lat,
  ST_X(ps.location::geometry) AS provider_lng`;

const REQUEST_JOINS = `
  LEFT JOIN users        pu ON pu.id = r.provider_id
  LEFT JOIN captains     pc ON pc.user_id = r.provider_id
  LEFT JOIN captain_state ps ON ps.captain_id = r.provider_id`;

function toDTO(row: RequestRow, hotlinePhone: string | null): RoadsideRequestDTO {
  const accepted = row.provider_id != null &&
    (row.status === 'accepted' || row.status === 'in_progress' || row.status === 'completed');
  return {
    id: row.id,
    problemType: row.problem_type,
    note: row.note,
    addressLabel: row.address_label,
    status: row.status,
    location: { lat: row.lat, lng: row.lng },
    searchRadiusM: row.search_radius_m,
    createdAt: row.created_at.toISOString(),
    provider: accepted
      ? {
          name: row.provider_name ?? 'Dépanneur',
          phone: row.provider_phone ?? '',
          ratingAvg: row.provider_rating != null ? Number(row.provider_rating) : null,
          location: row.provider_lat != null && row.provider_lng != null
            ? { lat: row.provider_lat, lng: row.provider_lng }
            : null,
        }
      : null,
    hotlinePhone: row.status === 'unresolved' ? hotlinePhone : null,
  };
}

/**
 * User ids of opted-in providers who are online, within `radiusM` of the
 * request, whose specialties match the problem (empty = all), aren't the
 * requester, and haven't declined this request.
 */
async function eligibleProviders(requestId: string, radiusM: number): Promise<{
  ids: string[];
  nearestM: number | null;
}> {
  const { rows } = await pool.query<{ captain_id: string; dist_m: number }>(
    `
    WITH req AS (
      SELECT id, requester_id, location, problem_type
        FROM roadside_requests WHERE id = $1
    )
    SELECT s.captain_id,
           ST_Distance(s.location, req.location)::int AS dist_m
      FROM captain_state s
      JOIN captains c ON c.user_id = s.captain_id
      CROSS JOIN req
     WHERE s.presence = 'online'
       AND s.location IS NOT NULL
       AND ST_DWithin(s.location, req.location, $2)
       AND c.offers_roadside = true
       AND (cardinality(c.roadside_specialties) = 0
            OR req.problem_type = ANY (c.roadside_specialties))
       AND s.captain_id <> req.requester_id
       AND NOT EXISTS (
         SELECT 1 FROM roadside_declines d
          WHERE d.request_id = req.id AND d.captain_id = s.captain_id
       )
     ORDER BY dist_m ASC`,
    [requestId, radiusM],
  );
  return {
    ids: rows.map((r) => r.captain_id),
    nearestM: rows[0]?.dist_m ?? null,
  };
}

/** Fire-and-forget push to all currently-eligible providers for a request. */
async function dispatch(requestId: string, radiusM: number, problemType: ProblemType): Promise<number> {
  const { ids, nearestM } = await eligibleProviders(requestId, radiusM);
  if (ids.length > 0) {
    void notifyProvidersRoadside(ids, { id: requestId, problemType, distanceM: nearestM })
      .catch((err) => console.warn('[roadside] push failed', err));
  }
  return ids.length;
}

export async function createRequest(requesterId: string, input: CreateRoadsideInput): Promise<{
  request: RoadsideRequestDTO;
  providersNotified: number;
}> {
  const cfg = await getConfig();
  if (!cfg.enabled) {
    throw new HttpError(403, 'roadside_disabled', 'Le service Assistance Routière est désactivé');
  }

  // One active SOS at a time.
  const existing = await pool.query(
    `SELECT 1 FROM roadside_requests
      WHERE requester_id = $1 AND status IN ('searching','accepted','in_progress')
      LIMIT 1`,
    [requesterId],
  );
  if (existing.rows[0]) {
    throw new HttpError(409, 'roadside_active', 'Vous avez déjà une demande en cours');
  }

  const radius = Math.min(input.radiusM ?? cfg.initialRadiusM, cfg.maxRadiusM);

  const { rows } = await pool.query<RequestRow>(
    `WITH ins AS (
       INSERT INTO roadside_requests (
         requester_id, location, address_label, problem_type, note, photo_url,
         search_radius_m, lead_fee_mru,
         requester_phone
       )
       VALUES (
         $1, ST_SetSRID(ST_MakePoint($3,$2),4326)::geography, $4, $5, $6, $7,
         $8, $9,
         (SELECT phone FROM users WHERE id = $1)
       )
       RETURNING *
     )
     SELECT ${REQUEST_SELECT}
       FROM ins r ${REQUEST_JOINS}`,
    [
      requesterId, input.lat, input.lng, input.addressLabel ?? null,
      input.problemType, input.note ?? null, input.photoUrl ?? null,
      radius, cfg.leadFeeMru,
    ],
  );
  const row = rows[0]!;
  const providersNotified = await dispatch(row.id, radius, input.problemType);
  return { request: toDTO(row, cfg.hotlinePhone), providersNotified };
}

export async function getCurrentForRequester(requesterId: string): Promise<RoadsideRequestDTO | null> {
  const cfg = await getConfig();
  const { rows } = await pool.query<RequestRow>(
    `SELECT ${REQUEST_SELECT}
       FROM roadside_requests r ${REQUEST_JOINS}
      WHERE r.requester_id = $1
        AND (r.status IN ('searching','accepted','in_progress')
             OR (r.status = 'unresolved' AND r.created_at > now() - interval '1 hour'))
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [requesterId],
  );
  return rows[0] ? toDTO(rows[0], cfg.hotlinePhone) : null;
}

export async function cancelRequest(id: string, requesterId: string, reason?: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE roadside_requests
        SET status = 'cancelled', cancel_reason = $3
      WHERE id = $1 AND requester_id = $2
        AND status IN ('searching','accepted','in_progress','unresolved')`,
    [id, requesterId, reason ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Provider side ---

export interface ProviderInboxItem {
  id: string;
  problemType: ProblemType;
  note: string | null;
  addressLabel: string | null;
  location: { lat: number; lng: number };
  distanceM: number;
  requesterName: string;
  createdAt: string;
}

export async function providerInbox(captainId: string, lat: number, lng: number): Promise<ProviderInboxItem[]> {
  const { rows } = await pool.query<{
    id: string; problem_type: ProblemType; note: string | null; address_label: string | null;
    lat: number; lng: number; dist_m: number; requester_name: string | null; created_at: Date;
  }>(
    `
    WITH me AS (SELECT ST_SetSRID(ST_MakePoint($2,$1),4326)::geography AS pt),
    cap AS (SELECT offers_roadside, roadside_specialties FROM captains WHERE user_id = $3)
    SELECT r.id, r.problem_type, r.note, r.address_label,
           ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
           ST_Distance(r.location, me.pt)::int AS dist_m,
           u.full_name AS requester_name, r.created_at
      FROM roadside_requests r
      CROSS JOIN me
      CROSS JOIN cap
      JOIN users u ON u.id = r.requester_id
     WHERE r.status = 'searching'
       AND cap.offers_roadside = true
       AND ST_DWithin(r.location, me.pt, r.search_radius_m)
       AND (cardinality(cap.roadside_specialties) = 0
            OR r.problem_type = ANY (cap.roadside_specialties))
       AND r.requester_id <> $3
       AND NOT EXISTS (
         SELECT 1 FROM roadside_declines d WHERE d.request_id = r.id AND d.captain_id = $3
       )
     ORDER BY dist_m ASC
     LIMIT 20`,
    [lat, lng, captainId],
  );
  return rows.map((r) => ({
    id: r.id,
    problemType: r.problem_type,
    note: r.note,
    addressLabel: r.address_label,
    location: { lat: r.lat, lng: r.lng },
    distanceM: r.dist_m,
    requesterName: r.requester_name ?? 'Conducteur',
    createdAt: r.created_at.toISOString(),
  }));
}

export interface AcceptResult {
  requestId: string;
  problemType: ProblemType;
  note: string | null;
  location: { lat: number; lng: number };
  addressLabel: string | null;
  requesterName: string;
  requesterPhone: string;
}

export async function acceptRequest(id: string, captainId: string): Promise<AcceptResult> {
  // First-to-accept wins: the WHERE status='searching' guard makes this atomic.
  const { rows } = await pool.query<{
    problem_type: ProblemType; note: string | null; address_label: string | null;
    lat: number; lng: number; requester_name: string | null; requester_phone: string | null;
  }>(
    `UPDATE roadside_requests r
        SET status = 'accepted', provider_id = $2, accepted_at = now(),
            provider_phone = (SELECT phone FROM users WHERE id = $2)
       FROM users ru
      WHERE r.id = $1 AND r.status = 'searching' AND ru.id = r.requester_id
      RETURNING r.problem_type, r.note, r.address_label,
                ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
                ru.full_name AS requester_name, r.requester_phone`,
    [id, captainId],
  );
  const row = rows[0];
  if (!row) {
    throw new HttpError(409, 'already_taken', 'Cette demande a déjà été prise ou annulée');
  }
  return {
    requestId: id,
    problemType: row.problem_type,
    note: row.note,
    location: { lat: row.lat, lng: row.lng },
    addressLabel: row.address_label,
    requesterName: row.requester_name ?? 'Conducteur',
    requesterPhone: row.requester_phone ?? '',
  };
}

export async function declineRequest(id: string, captainId: string): Promise<void> {
  await pool.query(
    `INSERT INTO roadside_declines (request_id, captain_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, captainId],
  );
}

export async function updateProviderStatus(
  id: string, captainId: string, status: 'in_progress' | 'completed',
): Promise<boolean> {
  const r = await pool.query(
    `UPDATE roadside_requests
        SET status = $3,
            completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END
      WHERE id = $1 AND provider_id = $2
        AND status IN ('accepted','in_progress')`,
    [id, captainId, status],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function setProviderProfile(
  captainId: string, offersRoadside: boolean, specialties: ProblemType[],
): Promise<{ offersRoadside: boolean; specialties: ProblemType[] }> {
  const { rows } = await pool.query<{ offers_roadside: boolean; roadside_specialties: ProblemType[] }>(
    `UPDATE captains
        SET offers_roadside = $2, roadside_specialties = $3
      WHERE user_id = $1
      RETURNING offers_roadside, roadside_specialties`,
    [captainId, offersRoadside, specialties],
  );
  if (!rows[0]) {
    throw new HttpError(404, 'not_a_captain', 'Profil chauffeur introuvable');
  }
  return { offersRoadside: rows[0].offers_roadside, specialties: rows[0].roadside_specialties };
}

export async function getProviderProfile(captainId: string): Promise<{
  offersRoadside: boolean; specialties: ProblemType[];
}> {
  const { rows } = await pool.query<{ offers_roadside: boolean; roadside_specialties: ProblemType[] }>(
    `SELECT offers_roadside, roadside_specialties FROM captains WHERE user_id = $1`,
    [captainId],
  );
  if (!rows[0]) throw new HttpError(404, 'not_a_captain', 'Profil chauffeur introuvable');
  return { offersRoadside: rows[0].offers_roadside, specialties: rows[0].roadside_specialties };
}

/**
 * Widen the search of still-unaccepted requests and re-dispatch; give up
 * (→ 'unresolved') once past the max radius AND the timeout. Runs on a short
 * interval, mirroring the ride-expiry / carpooling crons.
 */
export async function expandAndExpire(): Promise<{ expanded: number; unresolved: number }> {
  const cfg = await getConfig();
  const { rows } = await pool.query<{
    id: string; problem_type: ProblemType; search_radius_m: number; age_s: number;
  }>(
    `SELECT id, problem_type, search_radius_m,
            EXTRACT(EPOCH FROM (now() - last_expanded_at))::int AS age_s
       FROM roadside_requests
      WHERE status = 'searching'`,
  );

  let expanded = 0;
  let unresolved = 0;
  for (const r of rows) {
    const totalAge = await pool.query<{ age_s: number }>(
      `SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS age_s
         FROM roadside_requests WHERE id = $1`,
      [r.id],
    );
    const overallAgeS = totalAge.rows[0]?.age_s ?? 0;

    if (r.search_radius_m >= cfg.maxRadiusM && overallAgeS >= cfg.timeoutS) {
      await pool.query(`UPDATE roadside_requests SET status = 'unresolved' WHERE id = $1 AND status = 'searching'`, [r.id]);
      unresolved++;
      continue;
    }
    if (r.age_s >= cfg.expandIntervalS && r.search_radius_m < cfg.maxRadiusM) {
      const next = Math.min(r.search_radius_m + cfg.radiusStepM, cfg.maxRadiusM);
      await pool.query(
        `UPDATE roadside_requests SET search_radius_m = $2, last_expanded_at = now()
          WHERE id = $1 AND status = 'searching'`,
        [r.id, next],
      );
      await dispatch(r.id, next, r.problem_type);
      expanded++;
    }
  }
  return { expanded, unresolved };
}

const CRON_INTERVAL_MS = 15_000;

export function startRoadsideCron() {
  const tick = async () => {
    try {
      const { expanded, unresolved } = await expandAndExpire();
      if (expanded > 0 || unresolved > 0) {
        console.log(`[roadside] expanded=${expanded}, unresolved=${unresolved}`);
      }
    } catch (err) {
      console.warn('[roadside] cron tick failed', err);
    }
  };
  setTimeout(tick, 12_000);
  setInterval(tick, CRON_INTERVAL_MS).unref();
}
