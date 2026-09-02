/**
 * L'abonnement Captain vu du mobile (migration 0089) — deux routes.
 *
 *   GET  /captain/subscription           → où j'en suis, ce que je peux acheter
 *   POST /captain/subscription/purchase  → j'achète une formule
 *
 * Le corps de la requête ne porte QUE le nom de la formule : le prix et la
 * durée sont relus côté serveur. Le mobile propose, le serveur facture.
 *
 * Le parent (captainRouter) a déjà appliqué requireAuth + requireRole('captain').
 */

import { Router } from 'express';
import { z } from 'zod';
import * as svc from './subscription.service.js';

export const captainSubscriptionRouter = Router();

captainSubscriptionRouter.get('/', async (req, res) => {
  res.json(await svc.getSubscriptionStatus(req.user!.id));
});

const purchaseBody = z.object({
  plan: z.enum(['week', 'month']),
});

captainSubscriptionRouter.post('/purchase', async (req, res) => {
  const { plan } = purchaseBody.parse(req.body ?? {});
  res.json(await svc.purchaseSubscription(req.user!.id, plan));
});
