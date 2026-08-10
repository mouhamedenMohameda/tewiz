import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { perUserLimiter } from '../../middleware/rate-limit.js';
import { searchPlaces } from './geocode.service.js';

export const geocodeRouter = Router();
// requireAuth first so the limiter can key on the user id rather than the
// carrier-NAT address every mobile client shares.
geocodeRouter.use(requireAuth);
geocodeRouter.use(
  perUserLimiter({
    windowMs: 15 * 60 * 1000,
    limit: env.GEOCODE_RATE_LIMIT,
    message: 'Trop de recherches. Patientez quelques minutes.',
  }),
);

const querySchema = z.object({
  q: z.string().min(2).max(120),
  // Bias results toward a point, "lng,lat".
  proximity: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

/**
 * GET /geocode/search?q=...&proximity=lng,lat
 * Uses Google Places (New) Text Search when GOOGLE_PLACES_API_KEY is set,
 * otherwise falls back to Nominatim. Results are restricted to Mauritania.
 */
geocodeRouter.get('/search', async (req, res) => {
  const q = querySchema.parse(req.query);
  const results = await searchPlaces(q);
  res.json({ results });
});
