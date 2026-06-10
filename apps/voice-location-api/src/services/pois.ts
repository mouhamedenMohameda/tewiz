/**
 * POI corpus service — backed by the voiceloc_pois table (ingested from
 * OpenStreetMap by scripts/ingest-poi-nouakchott.ts).
 *
 * Three consumers:
 *   - Whisper STT  → top-N popular names injected into the prompt to bias
 *                    transcription toward known local spellings.
 *   - Claude       → trigram-matched shortlist injected into the extractor
 *                    prompt so it can correct ambiguous transcripts
 *                    ("Ksar" → "Oum Ksar" when the speaker said so).
 *   - Geocoder     → exact / fuzzy local lookup before falling back to
 *                    Google. Saves a network round-trip and a billed call
 *                    for known POIs.
 */

import { pool } from '../db/pool.js';

export interface PoiRow {
  id: number;
  name_default: string;
  name_fr: string | null;
  name_ar: string | null;
  name_en: string | null;
  osm_kind: string;
  osm_value: string | null;
  lat: number;
  lng: number;
  popularity: number;
  google_place_id: string | null;
}

export interface PoiMatch extends PoiRow {
  /** trigram similarity score from pg_trgm, range 0..1 */
  similarity: number;
}

// ---------------------------------------------------------------------------
// Whisper hint cache
// ---------------------------------------------------------------------------

let cachedHint: { text: string; expiresAt: number } | null = null;
const HINT_TTL_MS = 5 * 60 * 1000; // 5 min — POIs don't change often

/**
 * Build a compact "place name list" string for Whisper's `prompt` field.
 * Whisper truncates the prompt to ~224 tokens — about 700-900 chars — so
 * we pick the highest-popularity POIs and stop just before the limit.
 *
 * We mix French and Arabic name variants so Whisper biases both ways
 * (the user might speak Hassaniya but expect a French place name, or
 * vice-versa).
 */
export async function getWhisperHint(): Promise<string> {
  if (cachedHint && cachedHint.expiresAt > Date.now()) {
    return cachedHint.text;
  }

  const { rows } = await pool.query<{
    name_default: string;
    name_fr: string | null;
    name_ar: string | null;
  }>(
    `SELECT name_default, name_fr, name_ar
       FROM voiceloc_pois
      ORDER BY popularity DESC, length(name_default) ASC
      LIMIT 200`,
  );

  // Budget ~800 chars to stay under Whisper's prompt limit.
  const MAX_CHARS = 800;
  const seen = new Set<string>();
  const parts: string[] = [];
  let total = 0;

  for (const r of rows) {
    for (const v of [r.name_fr, r.name_default, r.name_ar]) {
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      // +2 for ", "
      if (total + v.length + 2 > MAX_CHARS) {
        cachedHint = { text: parts.join(', ') + '.', expiresAt: Date.now() + HINT_TTL_MS };
        return cachedHint.text;
      }
      seen.add(key);
      parts.push(v);
      total += v.length + 2;
    }
  }

  cachedHint = { text: parts.join(', ') + '.', expiresAt: Date.now() + HINT_TTL_MS };
  return cachedHint.text;
}

// ---------------------------------------------------------------------------
// Trigram-based fuzzy search against the transcript
// ---------------------------------------------------------------------------

/**
 * Find POIs whose names fuzzily match the transcript. Used to feed Claude
 * a shortlist of "did the speaker mean any of these?" candidates so it
 * can correct ambiguous transcripts.
 *
 * Strategy: extract the n-grams of the transcript, run a trigram similarity
 * scan against voiceloc_pois.search_text, keep the top-K by score above a
 * minimum threshold.
 */
export async function fuzzyMatchTranscript(
  transcript: string,
  limit = 25,
  minSimilarity = 0.25,
): Promise<PoiMatch[]> {
  const q = transcript.trim().toLowerCase();
  if (!q) return [];

  // word_similarity finds the best contiguous extent in search_text that
  // matches the transcript — much better than similarity() when the
  // transcript is a short Arabic phrase and the POI name is a long
  // bilingual string (e.g. "Carrefour Oum Ghasser كرفور أم قصر").
  // The <% operator is indexed by our GIN trigram index.
  const { rows } = await pool.query<PoiMatch>(
    `SELECT id, name_default, name_fr, name_ar, name_en,
            osm_kind, osm_value, lat, lng, popularity, google_place_id,
            GREATEST(
              similarity(search_text, $1),
              word_similarity($1, search_text)
            ) AS similarity
       FROM voiceloc_pois
      WHERE search_text % $1
         OR $1 <% search_text
      ORDER BY similarity DESC, popularity DESC
      LIMIT $2`,
    [q, limit * 3],
  );

  return rows.filter((r) => r.similarity >= minSimilarity).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Local-first geocoding lookup
// ---------------------------------------------------------------------------

/**
 * Try to resolve a query against the local POI corpus before hitting
 * Google. Returns the single best match if its trigram similarity is
 * high enough (>= 0.45), otherwise null so the caller can fall back.
 */
export async function resolveLocal(query: string): Promise<PoiRow | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const { rows } = await pool.query<PoiMatch>(
    `SELECT id, name_default, name_fr, name_ar, name_en,
            osm_kind, osm_value, lat, lng, popularity, google_place_id,
            GREATEST(
              similarity(search_text, $1),
              word_similarity($1, search_text)
            ) AS similarity
       FROM voiceloc_pois
      WHERE search_text % $1
         OR $1 <% search_text
      ORDER BY similarity DESC, popularity DESC
      LIMIT 1`,
    [q],
  );

  const best = rows[0];
  if (!best || best.similarity < 0.45) return null;
  return best;
}

/** Format a POI row as a human-readable single-line summary for prompts. */
export function formatPoiForPrompt(p: PoiRow | PoiMatch): string {
  const names = [p.name_default, p.name_fr, p.name_ar]
    .filter((x, i, arr) => x && arr.indexOf(x) === i)
    .join(' / ');
  const kind = p.osm_value ? `${p.osm_kind}=${p.osm_value}` : p.osm_kind;
  return `${names} [${kind}]`;
}
