/**
 * Persistence layer for voice request / confirmation tables.
 *
 *   voiceloc_requests       — full /voice-to-location response by request_id
 *   voiceloc_confirmations  — which candidate the user picked, after the fact
 */

import { pool } from './pool.js';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RequestInsert {
  apiKeyId: string;
  transcript: string | null;
  detectedLang: string | null;
  intent: string | null;
  pickup: unknown;       // the per-side response block as returned to the client
  destination: unknown;
}

export async function insertRequest(r: RequestInsert): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO voiceloc_requests
       (api_key_id, transcript, detected_lang, intent, pickup, destination)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING id`,
    [
      r.apiKeyId,
      r.transcript,
      r.detectedLang,
      r.intent,
      JSON.stringify(r.pickup),
      JSON.stringify(r.destination),
    ],
  );
  return { id: rows[0]!.id };
}

export interface RequestRow {
  id: string;
  api_key_id: string;
  transcript: string | null;
  detected_lang: string | null;
  intent: string | null;
  pickup: unknown;
  destination: unknown;
  expires_at: Date;
}

export async function findRequestById(id: string): Promise<RequestRow | null> {
  const { rows } = await pool.query<RequestRow>(
    `SELECT id, api_key_id, transcript, detected_lang, intent,
            pickup, destination, expires_at
       FROM voiceloc_requests
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Confirmations
// ---------------------------------------------------------------------------

export type Side = 'pickup' | 'destination';

export interface ConfirmationInsert {
  requestId: string;
  side: Side;
  chosenPlaceId: string | null;
  chosenLat: number;
  chosenLng: number;
  chosenName: string | null;
  wasTopCandidate: boolean | null;
  candidateRank: number | null;
  source: 'local' | 'google' | 'manual' | 'free_text';
}

export async function insertConfirmation(c: ConfirmationInsert): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO voiceloc_confirmations
       (request_id, side, chosen_place_id, chosen_lat, chosen_lng,
        chosen_name, was_top_candidate, candidate_rank, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      c.requestId,
      c.side,
      c.chosenPlaceId,
      c.chosenLat,
      c.chosenLng,
      c.chosenName,
      c.wasTopCandidate,
      c.candidateRank,
      c.source,
    ],
  );
  return { id: rows[0]!.id };
}
