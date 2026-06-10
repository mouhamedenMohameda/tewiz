import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { riderRidesRouter } from '../rides/rider-rides.routes.js';
import { riderFavoritesRouter } from '../favorites/favorites.routes.js';
import { riderRecurringRouter } from '../recurring/rider.routes.js';
import { voiceRouter } from '../voice/voice.routes.js';

export const riderRouter = Router();
// A captain is also a rider: they can book rides, manage favorites, etc.
// from inside the mobile app. So /rider/* accepts both 'rider' and 'captain'.
riderRouter.use(requireAuth, requireRole('rider', 'captain'));

// All rider-facing endpoints live under /rider/...
riderRouter.use('/rides', riderRidesRouter);
riderRouter.use('/favorites', riderFavoritesRouter);
riderRouter.use('/recurring-rides', riderRecurringRouter);

// Voice-to-Location: rider records audio → main API proxies to
// voice-location-api with the server-side key. See voice.routes.ts.
riderRouter.use('/', voiceRouter);
