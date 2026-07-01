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
import { CAPTAIN_ALERT_SOUND_MODES } from '@tewiz/shared-types';
import type { AuthedRequest } from '../../middleware/auth.js';
import { audit } from './audit.js';
import {
  getPricingSettings,
  updatePricingSettings,
  type PricingSettings,
} from './app-settings.service.js';
import { notifyCaptainsBonusConfigChanged } from '../notifications/notifications.service.js';

export const adminSettingsRouter = Router();

adminSettingsRouter.get('/', async (_req, res) => {
  const settings = await getPricingSettings();
  res.json(settings);
});

const patchBody = z.object({
  // Sanity bounds — keep someone from typing 999999 by mistake.
  baseFareMru:                      z.number().int().min(0).max(10_000).optional(),
  perKmMru:                         z.number().int().min(0).max(10_000).optional(),
  minFareMru:                       z.number().int().min(0).max(10_000).optional(),
  colisBaseFareMru:                 z.number().int().min(0).max(10_000).optional(),
  colisPerKmMru:                    z.number().int().min(0).max(10_000).optional(),
  colisMinFareMru:                  z.number().int().min(0).max(10_000).optional(),
  defaultCommissionBps:             z.number().int().min(0).max(5_000).optional(),
  colisCommissionBps:               z.number().int().min(0).max(5_000).optional(),
  intercityPricingEnabled:          z.boolean().optional(),
  intercityBaseFareMru:             z.number().int().min(0).max(100_000).optional(),
  intercityTier1LimitKm:            z.number().int().min(1).max(2_000).optional(),
  intercityTier2LimitKm:            z.number().int().min(2).max(3_000).optional(),
  intercityTier1PerKmMru:           z.number().int().min(0).max(10_000).optional(),
  intercityTier2PerKmMru:           z.number().int().min(0).max(10_000).optional(),
  intercityTier3PerKmMru:           z.number().int().min(0).max(10_000).optional(),
  intercitySharedDefaultSeats:      z.number().int().min(2).max(20).optional(),
  intercitySharedMinSeatFareMru:    z.number().int().min(0).max(10_000).optional(),
  intercityCommissionBps:           z.number().int().min(0).max(5_000).optional(),
  // 1_000 m .. 1_000_000 m (1 km .. 1000 km). Stored as meters, edited as km
  // in the admin UI.
  longDistanceThresholdM:           z.number().int().min(1_000).max(1_000_000).optional(),
  operatorPassengerCommissionBps:   z.number().int().min(0).max(5_000).optional(),
  operatorColisCommissionBps:       z.number().int().min(0).max(5_000).optional(),
  // 0 disables auto-cancel ; otherwise between 60 s (1 min) and 3 600 s (1 h).
  searchingTimeoutS:                z.number().int().refine(
                                      (n) => n === 0 || (n >= 60 && n <= 3_600),
                                      'Must be 0 or between 60 and 3600',
                                    ).optional(),
  // Commission bonus knobs (migration 0028).
  commissionBonusEnabled:           z.boolean().optional(),
  commissionBonusThresholdMru:      z.number().int().min(1).max(1_000_000).optional(),
  commissionBonusWindowDays:        z.number().int().min(1).max(365).optional(),
  commissionBonusRewardDays:        z.number().int().min(1).max(365).optional(),
  // Open rides ("course ouverte") — metered fare knobs (migration 0030).
  allowOpenRides:                   z.boolean().optional(),
  openBaseFareMru:                  z.number().int().min(0).max(10_000).optional(),
  openPerKmMru:                     z.number().int().min(0).max(10_000).optional(),
  openPerMinuteMru:                 z.number().int().min(0).max(1_000).optional(),
  openMinFareMru:                   z.number().int().min(0).max(10_000).optional(),
  // Feature flag for the reviewer demo-login buttons (migration 0031).
  showDemoButtons:                  z.boolean().optional(),
  captainAlertSoundMode:            z.enum(CAPTAIN_ALERT_SOUND_MODES).optional(),
  captainAlertRepeatIntervalS:      z.number().int().min(1).max(15).optional(),
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

  // If any bonus knob changed, fan out a broadcast notification so every
  // captain learns the new rules. Fire-and-forget — the settings update
  // already succeeded and shouldn't be rolled back by a push hiccup.
  const bonusChanged =
    before.commissionBonusEnabled       !== after.commissionBonusEnabled ||
    before.commissionBonusThresholdMru  !== after.commissionBonusThresholdMru ||
    before.commissionBonusWindowDays    !== after.commissionBonusWindowDays ||
    before.commissionBonusRewardDays    !== after.commissionBonusRewardDays;
  if (bonusChanged) {
    void notifyCaptainsBonusConfigChanged({
      enabled: after.commissionBonusEnabled,
      thresholdMru: after.commissionBonusThresholdMru,
      windowDays: after.commissionBonusWindowDays,
      rewardDays: after.commissionBonusRewardDays,
      adminId,
    });
  }

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
