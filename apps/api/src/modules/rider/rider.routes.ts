import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { riderRidesRouter } from '../rides/rider-rides.routes.js';
import { riderFavoritesRouter } from '../favorites/favorites.routes.js';
import { riderRecurringRouter } from '../recurring/rider.routes.js';
import { riderVoiceRidesRouter } from '../voice-rides/rider-voice-rides.routes.js';
// Retired (Phase 2): the fully-automated voice-to-location proxy. Superseded
// by the human-in-the-loop /voice-rides flow. Kept on disk for rollback.
// import { voiceRouter } from '../voice/voice.routes.js';

export const riderRouter = Router();
// A captain is also a rider: they can book rides, manage favorites, etc.
// from inside the mobile app. So /rider/* accepts both 'rider' and 'captain'.
riderRouter.use(requireAuth, requireRole('rider', 'captain'));

// All rider-facing endpoints live under /rider/...
riderRouter.use('/rides', riderRidesRouter);
riderRouter.use('/favorites', riderFavoritesRouter);
riderRouter.use('/recurring-rides', riderRecurringRouter);

// Voice-first rides (human-in-the-loop): rider records a voice memo, an admin
// listens and places the ride. See voice-rides/.
riderRouter.use('/voice-rides', riderVoiceRidesRouter);

// Retired (Phase 2): the old automated voice-to-location proxy
// (/rider/voice-to-location[/confirm]). The POI corpus + auto-seed logic it
// relied on now lives in voice-rides/poi.service.ts. Re-enable by restoring
// the import and this mount if we ever need the automated pipeline back.
// riderRouter.use('/', voiceRouter);
