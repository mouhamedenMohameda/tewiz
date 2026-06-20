/**
 * Admin endpoints to read and update pricing / commission knobs.
 *
 *   GET  /admin/settings  — current values
 *   PUT  /admin/settings  — patch one or more knobs (Zod-validated)
 *
 * Mounted under the admin router so admin role is already enforced.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../../middleware/auth.js';
import { audit } from './audit.js';
import {
  getPricingSettings,
  updatePricingSettings,
  type PricingSettings,
} from './app-settings.service.js';

export const adminSettingsRouter = Router();

adminSettingsRouter.get('/', async (_req, res) => {
  const settings = await getPricingSettings();
  res.json(settings);
});

const patchBody = z.object({
  // Sanity bounds — keep someone from typing 999999 by mistake.
  baseFareMru:           z.number().int().min(0).max(10_000).optional(),
  perKmMru:              z.number().int().min(0).max(10_000).optional(),
  minFareMru:            z.number().int().min(0).max(10_000).optional(),
  colisBaseFareMru:      z.number().int().min(0).max(10_000).optional(),
  colisPerKmMru:         z.number().int().min(0).max(10_000).optional(),
  colisMinFareMru:       z.number().int().min(0).max(10_000).optional(),
  defaultCommissionBps:  z.number().int().min(0).max(5_000).optional(),
  colisCommissionBps:    z.number().int().min(0).max(5_000).optional(),
}).refine(
  (b) => Object.values(b).some((v) => v !== undefined),
  { message: 'At least one field is required' },
);

adminSettingsRouter.put('/', async (req, res) => {
  const adminId = req.user!.id;
  const patch = patchBody.parse(req.body);

  const before = await getPricingSettings();
  const after = await updatePricingSettings(adminId, patch);

  await audit({
    adminId,
    action: 'app_settings.update',
    targetType: 'app_settings',
    targetId: null,
    before: changedFields(before, after),
    after: changedFields(after, before),
  });

  res.json(after);
});

/** Subset of `a` whose keys differ from `b` — keeps the audit log compact. */
function changedFields(a: PricingSettings, b: PricingSettings): Partial<PricingSettings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(a) as (keyof PricingSettings)[]) {
    if (a[key] !== b[key]) out[key] = a[key];
  }
  return out;
}
