import { env } from '../../config/env.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import type { RideType } from '@tewiz/shared-types';

/**
 * Fare estimate (in MRU) from straight-line distance.
 * The route is usually ~30% longer than crow-flies, hence ROUTE_MULTIPLIER.
 * Always at least the configured minimum fare.
 *
 * Result is always an integer (MRU). All money in this codebase is MRU
 * since migration 0017 — the legacy khoums unit (1 MRU = 5 khoums) was
 * removed because the conversion was a constant source of bugs.
 *
 * Base fare, per-km and minimum fare come from the admin-editable
 * `app_settings` row (migration 0018 / 0019). Each ride type carries its own
 * tariff trio — colis runs are typically cheaper than passenger rides because
 * the captain doesn't carry a person and can chain several. The route
 * multiplier stays in env because it's a geometry constant, not a business knob.
 */
export async function estimateFareMru(
  distanceMetersStraightLine: number,
  rideType: RideType = 'passenger',
): Promise<{
  fareMru: number;
  distanceEstimateM: number;
}> {
  const s = await getPricingSettings();
  const distanceEstimateM = Math.round(distanceMetersStraightLine * env.ROUTE_MULTIPLIER);
  const tariff = rideType === 'colis'
    ? { base: s.colisBaseFareMru, perKm: s.colisPerKmMru, min: s.colisMinFareMru }
    : { base: s.baseFareMru,      perKm: s.perKmMru,      min: s.minFareMru      };
  const raw = tariff.base + (distanceEstimateM / 1000) * tariff.perKm;
  const fareMru = Math.max(tariff.min, Math.round(raw));
  return { fareMru, distanceEstimateM };
}

/**
 * Compute the commission (in MRU) from a final fare and rate basis points.
 * Rounded down so the platform never "takes more than agreed".
 */
export function commissionMru(fareMru: number, rateBps: number): number {
  return Math.floor((fareMru * rateBps) / 10_000);
}

/**
 * Tariff snapshot for an open (metered) ride. Stored on the ride row at
 * creation so admin changes to app_settings mid-ride don't change the price
 * the rider was quoted.
 */
export interface OpenTariff {
  baseFareMru: number;
  perKmMru: number;
  perMinuteMru: number;
  minFareMru: number;
}

/**
 * Compute the metered fare for an open ride.
 *
 *   fare = max(min, base + km × perKm + min × perMinute)
 *
 * Always returns an integer (MRU). Used for the live in-progress display and
 * for the final fare at completion. The "fiable" guarantee comes from
 * upstream: distance is summed server-side from accepted GPS pings, duration
 * from started_at → now/completed_at.
 */
export function openFareMru(
  tariff: OpenTariff,
  distanceM: number,
  durationS: number,
): number {
  const km = Math.max(0, distanceM) / 1000;
  const min = Math.max(0, durationS) / 60;
  const raw = tariff.baseFareMru + km * tariff.perKmMru + min * tariff.perMinuteMru;
  return Math.max(tariff.minFareMru, Math.round(raw));
}
