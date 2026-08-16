/**
 * Voice-dataset collection service.
 *
 * Ground-truth corpus for evaluating the Hassaniya voice-to-ride pipeline.
 * See db/migrations/0080_voice_dataset.sql for why the gold labels are POI
 * ids, why no rider GPS is stored, and how the stratification axes work.
 */

import crypto from 'node:crypto';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import {
  SCENARIO_STRUCTURES,
  SCENARIO_NOISES,
  SCENARIO_LANGUAGES,
  SCENARIO_DIFFICULTIES,
  SCENARIO_ZONE_CODES,
  zoneCentre,
  type ScenarioStructure,
  type ScenarioNoise,
  type ScenarioLanguage,
  type ScenarioDifficulty,
} from './scenario.js';

// ────────────────────────────────────────────────────────────────────────────
// POI lookup

export interface PoiOption {
  id: number;
  /** Display name, French spelling preferred (that is how riders say them). */
  label: string;
  nameAr: string | null;
  kind: string;
  lat: number;
  lng: number;
}

interface PoiRow {
  id: string;
  label: string;
  name_ar: string | null;
  kind: string;
  lat: number;
  lng: number;
}

function shapePoi(r: PoiRow): PoiOption {
  return {
    // bigserial arrives as a string from pg (it can exceed 2^53); the POI
    // table is far below that bound, so a Number is safe and keeps the wire
    // shape convenient for the client.
    id: Number(r.id),
    label: r.label,
    nameAr: r.name_ar,
    kind: r.kind,
    lat: r.lat,
    lng: r.lng,
  };
}

const POI_SELECT = `
  id,
  COALESCE(NULLIF(name_fr, ''), name_default) AS label,
  name_ar,
  COALESCE(osm_value, osm_kind) AS kind,
  lat, lng
`;

/**
 * Fuzzy POI search over the voiceloc_pois corpus, for the annotation picker.
 *
 * Ranked by trigram similarity first and popularity second, so a query that
 * matches several same-named POIs surfaces the prominent one first — which is
 * usually, though not always, the one the tester meant. The homonym scenario
 * exists precisely because "usually" is not "always", so the picker shows the
 * neighbourhood alongside each result rather than relying on rank alone.
 */
export async function searchPois(query: string, limit = 20): Promise<PoiOption[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const { rows } = await pool.query<PoiRow>(
    `SELECT ${POI_SELECT}
       FROM voiceloc_pois
      WHERE search_text ILIKE '%' || $1 || '%'
         OR similarity(search_text, $1) > 0.25
      ORDER BY similarity(search_text, $1) DESC, popularity DESC
      LIMIT $2`,
    [q, limit],
  );
  return rows.map(shapePoi);
}

/**
 * Popular POIs near a zone centre, used for the one-tap chips.
 *
 * Scoped to the assigned zone on purpose. Chips drawn from "most used in the
 * dataset so far" would be more convenient and actively harmful: they would
 * feed the corpus back into itself and concentrate it on the handful of places
 * already over-represented. Zone-scoping makes the convenient choice also the
 * diversifying one.
 */
export async function zonePois(zone: string, limit = 24): Promise<PoiOption[]> {
  const centre = zoneCentre(zone);
  if (!centre) return [];

  // ~3 km box. PostGIS is not available on voiceloc_pois (see migration 0012),
  // so this is a plain lat/lng window served by the btree indexes; at
  // Nouakchott's latitude the degree-to-km ratio is close enough that a square
  // window needs no correction beyond the cos(lat) factor on longitude.
  const dLat = 3 / 111;
  const dLng = 3 / (111 * Math.cos((centre.lat * Math.PI) / 180));

  const { rows } = await pool.query<PoiRow>(
    `SELECT ${POI_SELECT}
       FROM voiceloc_pois
      WHERE lat BETWEEN $1 AND $2
        AND lng BETWEEN $3 AND $4
      ORDER BY popularity DESC
      LIMIT $5`,
    [centre.lat - dLat, centre.lat + dLat, centre.lng - dLng, centre.lng + dLng, limit],
  );
  return rows.map(shapePoi);
}

// ────────────────────────────────────────────────────────────────────────────
// Samples

export type SampleStatus = 'collected' | 'validated' | 'rejected';

interface SampleRow {
  id: string;
  collector_user_id: string;
  audio_mime: string;
  audio_duration_s: number | null;
  pickup_poi_id: string | null;
  pickup_label: string | null;
  destination_poi_id: string | null;
  destination_label: string | null;
  is_open: boolean;
  transcript_gold: string | null;
  scenario_structure: string;
  scenario_noise: string;
  scenario_language: string;
  scenario_difficulty: string;
  scenario_zone: string;
  speaker_gender: string | null;
  speaker_age_band: string | null;
  status: SampleStatus;
  review_note: string | null;
  split: string | null;
  created_at: Date;
}

// audio_key is deliberately absent from the public shape: the storage key is
// resolved server-side by the audio route, the same way voice_ride_requests
// handles it.
const SAMPLE_COLUMNS = `
  s.id, s.collector_user_id, s.audio_mime, s.audio_duration_s,
  s.pickup_poi_id,
  COALESCE(NULLIF(p.name_fr, ''), p.name_default) AS pickup_label,
  s.destination_poi_id,
  COALESCE(NULLIF(d.name_fr, ''), d.name_default) AS destination_label,
  s.is_open, s.transcript_gold,
  s.scenario_structure, s.scenario_noise, s.scenario_language,
  s.scenario_difficulty, s.scenario_zone,
  s.speaker_gender, s.speaker_age_band,
  s.status, s.review_note, s.split, s.created_at
`;

// Split out from SAMPLE_FROM so the review query can apply the same joins to a
// CTE instead of to the table — see reviewSample for why that matters.
const SAMPLE_JOINS = `
  LEFT JOIN voiceloc_pois p ON p.id = s.pickup_poi_id
  LEFT JOIN voiceloc_pois d ON d.id = s.destination_poi_id
`;

const SAMPLE_FROM = `FROM voice_dataset_samples s ${SAMPLE_JOINS}`;

function shape(r: SampleRow) {
  return {
    id: r.id,
    collectorUserId: r.collector_user_id,
    audioMime: r.audio_mime,
    audioDurationS: r.audio_duration_s,
    pickup: r.pickup_poi_id
      ? { poiId: Number(r.pickup_poi_id), label: r.pickup_label }
      : null,
    destination: r.destination_poi_id
      ? { poiId: Number(r.destination_poi_id), label: r.destination_label }
      : null,
    isOpen: r.is_open,
    transcriptGold: r.transcript_gold,
    scenario: {
      structure: r.scenario_structure,
      noise: r.scenario_noise,
      language: r.scenario_language,
      difficulty: r.scenario_difficulty,
      zone: r.scenario_zone,
    },
    speaker: { gender: r.speaker_gender, ageBand: r.speaker_age_band },
    status: r.status,
    reviewNote: r.review_note,
    split: r.split,
    createdAt: r.created_at,
  };
}

export type DatasetSample = ReturnType<typeof shape>;

export interface CreateSampleInput {
  collectorUserId: string;
  audio: { buffer: Buffer; mimetype: string };
  durationS?: number;
  pickupPoiId: number | null;
  destinationPoiId: number | null;
  isOpen: boolean;
  transcriptGold: string | null;
  structure: ScenarioStructure;
  noise: ScenarioNoise;
  language: ScenarioLanguage;
  difficulty: ScenarioDifficulty;
  zone: string;
  speakerGender: string | null;
  speakerAgeBand: string | null;
}

/**
 * Validate the annotation against itself before it reaches the database.
 *
 * The table carries the same invariants as CHECK constraints, but a constraint
 * violation surfaces as an opaque 500. These produce a 400 naming the field,
 * which is what the annotation screen needs in order to point at the control
 * the tester has to fix.
 */
function validateAnnotation(input: CreateSampleInput): void {
  if (input.isOpen && input.destinationPoiId !== null) {
    throw new HttpError(
      400,
      'open_ride_has_destination',
      'An open ride cannot carry a destination.',
    );
  }
  if (!input.isOpen && input.pickupPoiId === null && input.destinationPoiId === null) {
    throw new HttpError(
      400,
      'no_ground_truth',
      'Annotate at least a pickup or a destination, or mark the sample as an open ride.',
    );
  }
  if (input.structure === 'open_ride' && !input.isOpen) {
    throw new HttpError(
      400,
      'structure_mismatch',
      'Structure "open_ride" requires the open-ride flag.',
    );
  }
  if (
    input.structure === 'round_trip'
    && (input.pickupPoiId === null || input.destinationPoiId === null)
  ) {
    throw new HttpError(
      400,
      'round_trip_needs_both',
      'A round trip needs both a pickup and a destination.',
    );
  }
  if (input.pickupPoiId !== null && input.pickupPoiId === input.destinationPoiId) {
    throw new HttpError(
      400,
      'identical_endpoints',
      'Pickup and destination are the same place.',
    );
  }
}

export async function createSample(input: CreateSampleInput): Promise<DatasetSample> {
  validateAnnotation(input);

  const id = crypto.randomUUID();
  const mime = input.audio.mimetype || 'audio/m4a';
  const audioKey = `voice-dataset/${id}.m4a`;

  // Write the audio first, then insert. If the insert fails, drop the
  // orphaned object so a rejected annotation does not leak storage — same
  // ordering as createVoiceRideRequest.
  await defaultStorage.put(audioKey, input.audio.buffer, mime);

  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO voice_dataset_samples (
         id, collector_user_id, audio_key, audio_mime, audio_duration_s,
         pickup_poi_id, destination_poi_id, is_open, transcript_gold,
         scenario_structure, scenario_noise, scenario_language,
         scenario_difficulty, scenario_zone,
         speaker_gender, speaker_age_band
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        id, input.collectorUserId, audioKey, mime, input.durationS ?? null,
        input.pickupPoiId, input.destinationPoiId, input.isOpen, input.transcriptGold,
        input.structure, input.noise, input.language,
        input.difficulty, input.zone,
        input.speakerGender, input.speakerAgeBand,
      ],
    );
    if (!rows[0]) throw new Error('Insert returned no row');
  } catch (e) {
    await defaultStorage.delete(audioKey).catch(() => {
      // Best effort. A leaked object is recoverable (keys not referenced by
      // any row are orphans by definition); failing the request here would
      // hide the real insert error behind a cleanup error.
    });
    // A bad POI id is the one failure a tester can actually cause and fix,
    // so translate it instead of letting it surface as a 500.
    if ((e as { code?: string }).code === '23503') {
      throw new HttpError(400, 'unknown_poi', 'Pickup or destination POI does not exist.');
    }
    throw e;
  }

  return getSampleForCollector(id, input.collectorUserId);
}

export async function getSampleForCollector(
  id: string,
  collectorUserId: string,
): Promise<DatasetSample> {
  const { rows } = await pool.query<SampleRow>(
    `SELECT ${SAMPLE_COLUMNS} ${SAMPLE_FROM}
      WHERE s.id = $1 AND s.collector_user_id = $2`,
    [id, collectorUserId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Sample not found');
  return shape(row);
}

/**
 * The collector's own samples, newest first.
 *
 * `pendingTranscriptOnly` backs the "transcripts left to write" queue: testers
 * are allowed to skip the transcript while recording (an Arabic phone keyboard
 * is slow enough that requiring it would cost more samples than it gains) and
 * come back to it later.
 */
export async function listSamplesForCollector(
  collectorUserId: string,
  opts: { pendingTranscriptOnly?: boolean; limit?: number } = {},
): Promise<DatasetSample[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { rows } = await pool.query<SampleRow>(
    `SELECT ${SAMPLE_COLUMNS} ${SAMPLE_FROM}
      WHERE s.collector_user_id = $1
        ${opts.pendingTranscriptOnly ? 'AND s.transcript_gold IS NULL' : ''}
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [collectorUserId, limit],
  );
  return rows.map(shape);
}

export async function setTranscript(
  id: string,
  collectorUserId: string,
  transcript: string,
): Promise<DatasetSample> {
  const text = transcript.trim();
  if (!text) throw new HttpError(400, 'empty_transcript', 'Transcript is empty.');

  const { rowCount } = await pool.query(
    `UPDATE voice_dataset_samples
        SET transcript_gold = $1
      WHERE id = $2 AND collector_user_id = $3`,
    [text, id, collectorUserId],
  );
  if (!rowCount) throw new HttpError(404, 'not_found', 'Sample not found');
  return getSampleForCollector(id, collectorUserId);
}

export interface CollectorStats {
  total: number;
  withTranscript: number;
  validated: number;
  rejected: number;
}

/** Contribution counters for the collection screen. */
export async function getCollectorStats(collectorUserId: string): Promise<CollectorStats> {
  const { rows } = await pool.query<{
    total: string; with_transcript: string; validated: string; rejected: string;
  }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(transcript_gold)::text AS with_transcript,
            COUNT(*) FILTER (WHERE status = 'validated')::text AS validated,
            COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected
       FROM voice_dataset_samples
      WHERE collector_user_id = $1`,
    [collectorUserId],
  );
  const r = rows[0]!;
  return {
    total: Number(r.total),
    withTranscript: Number(r.with_transcript),
    validated: Number(r.validated),
    rejected: Number(r.rejected),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Admin: review, audio, export

export interface AdminSampleFilters {
  status?: SampleStatus;
  split?: 'dev' | 'test' | 'none';
  collectorUserId?: string;
  limit?: number;
  offset?: number;
}

export async function listSamplesForAdmin(
  filters: AdminSampleFilters,
): Promise<{ items: DatasetSample[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`s.status = $${params.length}`);
  }
  if (filters.split === 'none') {
    where.push('s.split IS NULL');
  } else if (filters.split) {
    params.push(filters.split);
    where.push(`s.split = $${params.length}`);
  }
  if (filters.collectorUserId) {
    params.push(filters.collectorUserId);
    where.push(`s.collector_user_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM voice_dataset_samples s ${whereSql}`,
    params,
  );

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  params.push(limit, offset);

  const { rows } = await pool.query<SampleRow>(
    `SELECT ${SAMPLE_COLUMNS} ${SAMPLE_FROM}
     ${whereSql}
     ORDER BY s.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items: rows.map(shape), total: Number(totalRes.rows[0]!.count) };
}

/** Raw audio bytes for reviewer playback and for the export archive. */
export async function getSampleAudio(id: string): Promise<{ buffer: Buffer; mime: string }> {
  const { rows } = await pool.query<{ audio_key: string; audio_mime: string }>(
    `SELECT audio_key, audio_mime FROM voice_dataset_samples WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Sample not found');
  return { buffer: await defaultStorage.get(row.audio_key), mime: row.audio_mime };
}

export async function reviewSample(input: {
  id: string;
  reviewerId: string;
  status: 'validated' | 'rejected';
  note: string | null;
}): Promise<DatasetSample> {
  // Note the `FROM updated s` — the joins are applied to the CTE's returned
  // row, NOT re-read from the table. Every sub-statement of a CTE sees the same
  // snapshot, so a SELECT that re-reads voice_dataset_samples here would return
  // the row as it was BEFORE the update: the write lands, but the response
  // reports the old status. Selecting from `updated` returns the new row.
  const { rows } = await pool.query<SampleRow>(
    `WITH updated AS (
       UPDATE voice_dataset_samples
          SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = now()
        WHERE id = $4
        RETURNING *
     )
     SELECT ${SAMPLE_COLUMNS}
       FROM updated s
       ${SAMPLE_JOINS}`,
    [input.status, input.note, input.reviewerId, input.id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Sample not found');
  return shape(row);
}

/**
 * Assign validated-but-unsplit samples to dev / test.
 *
 * Split by collector, not by sample. Splitting at random puts recordings of
 * the same voice on both sides, and a model then scores well on the test split
 * partly by having memorised that speaker — the classic speaker-leakage
 * inflation. Grouping by collector keeps every voice wholly on one side, so
 * the test score measures generalisation to an unheard speaker, which is the
 * situation in production.
 *
 * `testRatio` is applied to collectors ordered by contribution, smallest
 * first, accumulating until the target share of samples is reached. That keeps
 * the test split close to the requested size even when contributions are very
 * uneven, which they always are.
 */
export async function assignSplits(testRatio = 0.5): Promise<{ dev: number; test: number }> {
  // One transaction around the read and both writes. The second UPDATE claims
  // "everything still unsplit" as dev, which is only correct relative to the
  // test assignment the first one just made: run them apart and a concurrent
  // call — or a failure between the two — leaves samples split by a rule nobody
  // chose. A split, once given, is never revisited, so there is no later pass
  // to repair it.
  return withTx(async (client) => {
    const { rows } = await client.query<{ collector_user_id: string; count: string }>(
      `SELECT collector_user_id, COUNT(*)::text AS count
         FROM voice_dataset_samples
        WHERE status = 'validated' AND split IS NULL
        GROUP BY collector_user_id
        ORDER BY COUNT(*) ASC`,
    );
    if (rows.length === 0) return { dev: 0, test: 0 };

    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
    const target = Math.round(total * testRatio);

    const testCollectors: string[] = [];
    let accumulated = 0;
    for (const r of rows) {
      if (accumulated >= target) break;
      testCollectors.push(r.collector_user_id);
      accumulated += Number(r.count);
    }

    // A single collector cannot own both splits — with one contributor there is
    // no speaker-disjoint split to make, so everything goes to dev and the test
    // split stays empty until a second voice exists.
    if (testCollectors.length === rows.length) testCollectors.pop();

    const { rowCount: testCount } = await client.query(
      `UPDATE voice_dataset_samples
          SET split = 'test'
        WHERE status = 'validated' AND split IS NULL
          AND collector_user_id = ANY($1::uuid[])`,
      [testCollectors],
    );
    const { rowCount: devCount } = await client.query(
      `UPDATE voice_dataset_samples
          SET split = 'dev'
        WHERE status = 'validated' AND split IS NULL`,
    );

    return { dev: devCount ?? 0, test: testCount ?? 0 };
  });
}

export interface ExportRow {
  id: string;
  audio: string;
  transcript_gold: string | null;
  pickup_poi_id: number | null;
  pickup_label: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_poi_id: number | null;
  destination_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  is_open: boolean;
  split: string | null;
  scenario: Record<string, string>;
  speaker: { collector: string; gender: string | null; age_band: string | null };
  duration_s: number | null;
}

/**
 * Rows for the JSONL export, validated samples only.
 *
 * The POI coordinates ride along so the evaluation harness can derive the
 * simulated rider position (gold pickup + 300-800 m jitter) and compute the
 * routed distance that feeds estimateFareMru() — without a second round-trip
 * to the POI table.
 *
 * `speaker.collector` is the collector's user id: the harness needs to know
 * which samples share a voice in order to verify the split really is
 * speaker-disjoint, and to report per-speaker accuracy.
 */
export async function exportRows(split?: 'dev' | 'test'): Promise<ExportRow[]> {
  const params: unknown[] = [];
  let splitSql = '';
  if (split) {
    params.push(split);
    splitSql = `AND s.split = $${params.length}`;
  }

  const { rows } = await pool.query<SampleRow & {
    pickup_lat: number | null; pickup_lng: number | null;
    destination_lat: number | null; destination_lng: number | null;
  }>(
    `SELECT ${SAMPLE_COLUMNS},
            p.lat AS pickup_lat, p.lng AS pickup_lng,
            d.lat AS destination_lat, d.lng AS destination_lng
     ${SAMPLE_FROM}
      WHERE s.status = 'validated' ${splitSql}
      ORDER BY s.created_at ASC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    audio: `audio/${r.id}.m4a`,
    transcript_gold: r.transcript_gold,
    pickup_poi_id: r.pickup_poi_id ? Number(r.pickup_poi_id) : null,
    pickup_label: r.pickup_label,
    pickup_lat: r.pickup_lat,
    pickup_lng: r.pickup_lng,
    destination_poi_id: r.destination_poi_id ? Number(r.destination_poi_id) : null,
    destination_label: r.destination_label,
    destination_lat: r.destination_lat,
    destination_lng: r.destination_lng,
    is_open: r.is_open,
    split: r.split,
    scenario: {
      structure: r.scenario_structure,
      noise: r.scenario_noise,
      language: r.scenario_language,
      difficulty: r.scenario_difficulty,
      zone: r.scenario_zone,
    },
    speaker: {
      collector: r.collector_user_id,
      gender: r.speaker_gender,
      age_band: r.speaker_age_band,
    },
    duration_s: r.audio_duration_s,
  }));
}

/** Storage keys for the audio files backing an export, keyed by sample id. */
export async function exportAudioKeys(
  split?: 'dev' | 'test',
): Promise<{ id: string; audioKey: string }[]> {
  const params: unknown[] = [];
  let splitSql = '';
  if (split) {
    params.push(split);
    splitSql = `AND split = $${params.length}`;
  }
  const { rows } = await pool.query<{ id: string; audio_key: string }>(
    `SELECT id, audio_key FROM voice_dataset_samples
      WHERE status = 'validated' ${splitSql}
      ORDER BY created_at ASC`,
    params,
  );
  return rows.map((r) => ({ id: r.id, audioKey: r.audio_key }));
}

// ────────────────────────────────────────────────────────────────────────────
// Enum guards (multipart fields arrive as strings)

export function parseStructure(v: unknown): ScenarioStructure {
  if (SCENARIO_STRUCTURES.includes(v as ScenarioStructure)) return v as ScenarioStructure;
  throw new HttpError(400, 'bad_structure', `structure must be one of: ${SCENARIO_STRUCTURES.join(', ')}`);
}

export function parseNoise(v: unknown): ScenarioNoise {
  if (SCENARIO_NOISES.includes(v as ScenarioNoise)) return v as ScenarioNoise;
  throw new HttpError(400, 'bad_noise', `noise must be one of: ${SCENARIO_NOISES.join(', ')}`);
}

export function parseLanguage(v: unknown): ScenarioLanguage {
  if (SCENARIO_LANGUAGES.includes(v as ScenarioLanguage)) return v as ScenarioLanguage;
  throw new HttpError(400, 'bad_language', `language must be one of: ${SCENARIO_LANGUAGES.join(', ')}`);
}

export function parseDifficulty(v: unknown): ScenarioDifficulty {
  if (SCENARIO_DIFFICULTIES.includes(v as ScenarioDifficulty)) return v as ScenarioDifficulty;
  throw new HttpError(400, 'bad_difficulty', `difficulty must be one of: ${SCENARIO_DIFFICULTIES.join(', ')}`);
}

export function parseZone(v: unknown): string {
  if (typeof v === 'string' && SCENARIO_ZONE_CODES.includes(v)) return v;
  throw new HttpError(400, 'bad_zone', `zone must be one of: ${SCENARIO_ZONE_CODES.join(', ')}`);
}
