/**
 * GET /captain/bonus  — captain's view of the commission bonus state.
 *
 * Returns counter + threshold + window/bonus dates so the mobile home/wallet
 * screen can render the progress card ("750 / 1000 MRU — plus que 250 pour
 * débloquer ton bonus") or the active-bonus banner ("Bonus actif jusqu'au …").
 *
 * Parent (captainRouter) already enforces requireAuth + requireRole('captain').
 */

import { Router } from 'express';
import { type AuthedRequest } from '../../middleware/auth.js';
import { getCaptainBonusProgress } from '../rides/commission-bonus.service.js';

export const captainBonusRouter = Router();

captainBonusRouter.get('/', async (req, res) => {
  res.json(await getCaptainBonusProgress(req.user!.id));
});
