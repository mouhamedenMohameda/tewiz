import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { riderRidesRouter } from '../rides/rider-rides.routes.js';
import { riderFavoritesRouter } from '../favorites/favorites.routes.js';
import { riderRecurringRouter } from '../recurring/rider.routes.js';

export const riderRouter = Router();
riderRouter.use(requireAuth, requireRole('rider'));

// All rider-facing endpoints live under /rider/...
riderRouter.use('/rides', riderRidesRouter);
riderRouter.use('/favorites', riderFavoritesRouter);
riderRouter.use('/recurring-rides', riderRecurringRouter);
