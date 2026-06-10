/**
 * POI resolver — turns an ExtractedPlace (primary name + landmarks) into
 * a ranked list of geographic candidates from the local POI corpus.
 *
 * Algorithm:
 *   1. Trigram-match `primary` against voiceloc_pois.search_text and keep
 *      the top N candidates by similarity (N=25 default).
 *   2. For each landmark, do the same and keep the best single match.
 *   3. For each candidate, compute the minimum distance to any matched
 *      landmark.
 *   4. Score = similarity_weight * sim + landmark_bonus(distance)
 *      + small popularity term.
 *   5. Return the top K (K=5 default) ranked descending.
 *
 * Output candidates also carry a `confidence` derived from the score so
 * the API layer can decide whether to ask the user to disambiguate.
 */

import { pool } from '../db/pool.js';
import type { ExtractedPlace } from './extractor.js';

export interface ResolverCandidate {
  poi_id: number;
  name: string;
  name_fr: string | null;
  name_ar: string | null;
  osm_kind: string;
  osm_value: string | null;
  lat: number;
  lng: number;
  google_place_id: string | null;
  popularity: number;
  /** trigram similarity for the primary name (0..1) */
  similarity: number;
  /** meters from this candidate to the nearest matched landmark (null if no landmark matched) */
  distance_to_landmarks_m: number | null;
  /** combined ranking score (higher = better) */
  score: number;
  /** confidence bucket derived from score */
  confidence: 'high' | 'medium' | 'low';
}

export interface ResolverResult {
  /** Top candidate (= candidates[0]) for convenience; null if none. */
  top: ResolverCandidate | null;
  /** Up to TOP_K candidates ranked best-first. */
  candidates: ResolverCandidate[];
  /** True when the caller should ask the user to disambiguate. */
  needs_confirmation: boolean;
  /** Landmarks that were successfully matched in the corpus. */
  matched_landmarks: Array<{ query: string; name: string; lat: number; lng: number; similarity: number }>;
}

const TOP_K = 5;
const PRIMARY_FETCH_LIMIT = 25;
const MIN_SIMILARITY = 0.18;

// Tuning knobs
const W_SIM = 1.0;       // weight on name similarity
const W_POPULARITY = 0.0008; // small bump for popular POIs (popularity is 0..150ish)
const LANDMARK_FULL_BONUS = 0.35;   // <500 m
const LANDMARK_NEAR_BONUS = 0.20;   // <1.5 km
const LANDMARK_MILD_BONUS = 0.08;   // <4 km

// Confirmation thresholds (permissive)
const CONFIRM_TOP_BELOW = 0.70;     // ask if top score < this
const CONFIRM_GAP_RATIO = 0.85;     // ask if candidates[1].score/candidates[0].score >= this

// ---------------------------------------------------------------------------
// Distance helper (Haversine, returns meters)
// ---------------------------------------------------------------------------

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function confidenceFromScore(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Single trigram lookup (used for both primary and landmarks)
// ---------------------------------------------------------------------------

interface PoiRowFromDb {
  id: number;
  name_default: string;
  name_fr: string | null;
  name_ar: string | null;
  osm_kind: string;
  osm_value: string | null;
  lat: number;
  lng: number;
  popularity: number;
  google_place_id: string | null;
  similarity: number;
}

async function trigramSearch(query: string, limit: number, minSim: number): Promise<PoiRowFromDb[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // GREATEST(similarity, word_similarity) lets short Arabic queries match
  // long bilingual POI names (e.g. "أم قصر" → "Carrefour Oum Ghasser
  // كرفور أم قصر" where word_similarity is high but full similarity is
  // diluted by the extra characters).
  const { rows } = await pool.query<PoiRowFromDb>(
    `SELECT id, name_default, name_fr, name_ar,
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
    [q, limit],
  );
  return rows.filter((r) => r.similarity >= minSim);
}

// ---------------------------------------------------------------------------
// Main: resolve an ExtractedPlace into ranked candidates
// ---------------------------------------------------------------------------

export async function resolvePlace(place: ExtractedPlace): Promise<ResolverResult> {
  // 1. Fetch primary candidates. Try Claude's "primary" string first;
  //    if it returns nothing (often the case when Claude romanizes Arabic
  //    place names into academic forms that don't match our corpus, e.g.
  //    "Umm Al-Qasoor" vs the local "Oum Ghasser"), fall back to the
  //    raw_phrase which still contains the original Arabic/French.
  let primaryRows = await trigramSearch(place.primary, PRIMARY_FETCH_LIMIT, MIN_SIMILARITY);
  if (primaryRows.length === 0 && place.raw_phrase) {
    primaryRows = await trigramSearch(place.raw_phrase, PRIMARY_FETCH_LIMIT, MIN_SIMILARITY);
  }

  // 2. Resolve each landmark to its single best POI (if any).
  const matched_landmarks: ResolverResult['matched_landmarks'] = [];
  for (const lm of place.landmarks) {
    const best = (await trigramSearch(lm, 1, 0.25))[0];
    if (best) {
      matched_landmarks.push({
        query: lm,
        name: best.name_fr ?? best.name_default,
        lat: best.lat,
        lng: best.lng,
        similarity: best.similarity,
      });
    }
  }

  // 3. Score each primary candidate.
  const scored: ResolverCandidate[] = primaryRows.map((r) => {
    let landmarkDist: number | null = null;
    if (matched_landmarks.length > 0) {
      landmarkDist = Math.min(
        ...matched_landmarks.map((lm) =>
          distanceMeters({ lat: r.lat, lng: r.lng }, { lat: lm.lat, lng: lm.lng }),
        ),
      );
    }

    let bonus = 0;
    if (landmarkDist !== null) {
      if (landmarkDist <= 500) bonus = LANDMARK_FULL_BONUS;
      else if (landmarkDist <= 1500) bonus = LANDMARK_NEAR_BONUS;
      else if (landmarkDist <= 4000) bonus = LANDMARK_MILD_BONUS;
    }

    const score = W_SIM * r.similarity + W_POPULARITY * r.popularity + bonus;
    return {
      poi_id: r.id,
      name: r.name_fr ?? r.name_default,
      name_fr: r.name_fr,
      name_ar: r.name_ar,
      osm_kind: r.osm_kind,
      osm_value: r.osm_value,
      lat: r.lat,
      lng: r.lng,
      google_place_id: r.google_place_id,
      popularity: r.popularity,
      similarity: r.similarity,
      distance_to_landmarks_m: landmarkDist,
      score,
      confidence: confidenceFromScore(score),
    };
  });

  // 4. Sort, slice to top K.
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, TOP_K);

  // 5. Decide whether to ask for confirmation (permissive policy).
  let needs_confirmation = false;
  if (candidates.length === 0) {
    needs_confirmation = false;
  } else {
    const top = candidates[0]!;
    const runnerUp = candidates[1];
    if (top.score < CONFIRM_TOP_BELOW) needs_confirmation = true;
    else if (runnerUp && runnerUp.score / top.score >= CONFIRM_GAP_RATIO) needs_confirmation = true;
  }

  return {
    top: candidates[0] ?? null,
    candidates,
    needs_confirmation,
    matched_landmarks,
  };
}
