/**
 * POST /v1/voice-to-location/confirm
 *
 * Records the user's chosen pickup or destination after they were asked
 * to pick from the candidates returned by /v1/voice-to-location.
 *
 * Body:
 *   {
 *     "request_id": "uuid",        // returned by /voice-to-location
 *     "side":       "pickup" | "destination",
 *     "place_id":   "osm:N" | "manual:N" | "ChIJ..." | null,   // null = free-text pick
 *     "lat":        number,
 *     "lng":        number,
 *     "name":       "Carrefour Oum Ghasser"    // optional but recommended
 *   }
 *
 * On success:
 *   - Insert into voiceloc_confirmations.
 *   - Bump popularity of the matching voiceloc_pois row.
 *   - If the chosen place was a Google result that isn't in the corpus
 *     yet, auto-seed it now (the confirm is a strong "this is real"
 *     signal even if the original geocoder skipped auto-seeding due to
 *     quality gates).
 *
 * Returns:
 *   { ok: true, confirmation_id, popularity_updated, seeded }
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireApiKey } from '../middleware/auth.js';
import { findRequestById, insertConfirmation } from '../db/requests.js';
import { autoSeedFromGoogle, bumpPopularity } from '../services/auto-seed.js';
import type { GeocodeResult } from '../services/geocoder.js';

export const confirmRouter = Router();

const BodySchema = z.object({
  request_id: z.string().uuid(),
  side: z.enum(['pickup', 'destination']),
  place_id: z.string().nullable().optional(),
  lat: z.number(),
  lng: z.number(),
  name: z.string().nullable().optional(),
});

// The shape of each side block we stored in voiceloc_requests.{pickup,destination}.
interface StoredCandidate {
  poi_id: number;
  name: string;
  lat: number;
  lng: number;
  google_place_id: string | null;
}
interface StoredSide {
  candidates?: StoredCandidate[];
  location?: { place_id: string; lat: number; lng: number; precision: string; types: string[]; address: string } | null;
  source?: 'local' | 'google' | 'none';
}

function findRank(stored: StoredSide | null, placeId: string | null): { rank: number | null; wasTop: boolean | null } {
  if (!stored || !stored.candidates || !placeId) return { rank: null, wasTop: null };
  const idx = stored.candidates.findIndex((c) => {
    if (placeId.startsWith('osm:')) return `osm:${c.poi_id}` === placeId;
    if (placeId.startsWith('manual:')) return `manual:${c.poi_id}` === placeId;
    return c.google_place_id === placeId;
  });
  if (idx < 0) return { rank: null, wasTop: null };
  return { rank: idx, wasTop: idx === 0 };
}

function inferSource(placeId: string | null): 'local' | 'google' | 'manual' | 'free_text' {
  if (!placeId) return 'free_text';
  if (placeId.startsWith('osm:')) return 'local';
  if (placeId.startsWith('manual:')) return 'manual';
  return 'google';
}

confirmRouter.post(
  '/v1/voice-to-location/confirm',
  requireApiKey,
  async (req: Request, res: Response, next) => {
    try {
      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_body',
          message: 'Body must include request_id, side, lat, lng. place_id and name are optional.',
          issues: parsed.error.flatten(),
        });
        return;
      }
      const { request_id, side, place_id, lat, lng, name } = parsed.data;

      // 1. Load the original request and check it belongs to the calling API key.
      const orig = await findRequestById(request_id);
      if (!orig) {
        res.status(404).json({ error: 'request_not_found' });
        return;
      }
      if (orig.api_key_id !== req.apiKey!.id) {
        res.status(403).json({ error: 'request_belongs_to_different_key' });
        return;
      }
      if (orig.expires_at.getTime() < Date.now()) {
        res.status(410).json({ error: 'request_expired' });
        return;
      }

      const sideBlock = (side === 'pickup' ? orig.pickup : orig.destination) as StoredSide | null;
      const { rank, wasTop } = findRank(sideBlock, place_id ?? null);
      const source = inferSource(place_id ?? null);

      // 2. Insert the confirmation row.
      const inserted = await insertConfirmation({
        requestId: request_id,
        side,
        chosenPlaceId: place_id ?? null,
        chosenLat: lat,
        chosenLng: lng,
        chosenName: name ?? null,
        wasTopCandidate: wasTop,
        candidateRank: rank,
        source,
      });

      // 3. Reward / seed the corpus.
      let popularity_updated = false;
      let seeded: 'seeded' | 'updated' | 'skipped_already_in_corpus' | 'skipped_low_quality' | 'not_applicable' = 'not_applicable';

      if (place_id) {
        const bump = await bumpPopularity(place_id, 5);
        popularity_updated = bump.updated;

        // If the user confirmed a Google result that we didn't auto-seed
        // earlier (because it failed the quality gate), seed it now — the
        // confirm is itself a quality signal.
        if (!bump.updated && source === 'google') {
          // Reconstruct a minimal GeocodeResult from the stored location
          // block so autoSeedFromGoogle has something to seed.
          const loc = sideBlock?.location;
          if (loc && loc.place_id === place_id) {
            const synthetic: GeocodeResult = {
              lat,
              lng,
              formatted_address: name ? `${name}, Nouakchott, Mauritanie` : loc.address,
              place_id,
              location_type: 'ROOFTOP',           // forced high — user confirmed
              types: loc.types,
              precision: 'high',
              viewport_diagonal_m: 0,             // forced small — user confirmed
            };
            const outcome = await autoSeedFromGoogle(orig.transcript ?? '', synthetic);
            seeded = outcome.status;
            // After seed, popularity is already at 25; bump again as the
            // user just voted for it.
            await bumpPopularity(place_id, 5).catch(() => undefined);
          }
        }
      }

      res.status(200).json({
        ok: true,
        confirmation_id: inserted.id,
        candidate_rank: rank,
        was_top_candidate: wasTop,
        source,
        popularity_updated,
        seeded,
      });
    } catch (err) {
      next(err);
    }
  },
);
