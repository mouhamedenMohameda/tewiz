import { env } from '../../config/env.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import type { RideType } from '@tewiz/shared-types';

export type FarePricingMode = 'solo' | 'shared';

export interface FareEstimateOptions {
  pricingMode?: FarePricingMode;
  sharedSeats?: number;
}

export interface IntercityTariff {
  baseFareMru: number;
  tier1LimitKm: number;
  tier2LimitKm: number;
  tier1PerKmMru: number;
  tier2PerKmMru: number;
  tier3PerKmMru: number;
  sharedDefaultSeats: number;
  sharedMinSeatFareMru: number;
  minFareMru: number;
}

/** Arrondit au multiple de 5 supérieur (ex: 312 → 315, 315 → 315, 316 → 320). */
function roundUpToNearest5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function intercityDistanceChargeMru(km: number, cfg: {
  tier1LimitKm: number;
  tier2LimitKm: number;
  tier1PerKmMru: number;
  tier2PerKmMru: number;
  tier3PerKmMru: number;
}): number {
  const d = Math.max(0, km);
  const tier1Km = Math.min(d, cfg.tier1LimitKm);
  const tier2Km = Math.max(0, Math.min(d, cfg.tier2LimitKm) - cfg.tier1LimitKm);
  const tier3Km = Math.max(0, d - cfg.tier2LimitKm);
  return (
    tier1Km * cfg.tier1PerKmMru +
    tier2Km * cfg.tier2PerKmMru +
    tier3Km * cfg.tier3PerKmMru
  );
}

export function intercityFareMru(
  distanceEstimateM: number,
  tariff: IntercityTariff,
  options: FareEstimateOptions = {},
): {
  fareMru: number;
  pricingModeApplied: FarePricingMode;
  sharedSeatsApplied: number | null;
  soloFareMru: number;
} {
  const km = Math.max(0, distanceEstimateM) / 1000;
  const rawSolo = tariff.baseFareMru + intercityDistanceChargeMru(km, {
    tier1LimitKm: tariff.tier1LimitKm,
    tier2LimitKm: tariff.tier2LimitKm,
    tier1PerKmMru: tariff.tier1PerKmMru,
    tier2PerKmMru: tariff.tier2PerKmMru,
    tier3PerKmMru: tariff.tier3PerKmMru,
  });
  const soloFareMru = roundUpToNearest5(Math.max(tariff.minFareMru, rawSolo));

  if (options.pricingMode === 'shared') {
    const seats = clampInt(options.sharedSeats ?? tariff.sharedDefaultSeats, 2, 20);
    const sharedRaw = soloFareMru / seats;
    const fareMru = roundUpToNearest5(Math.max(tariff.sharedMinSeatFareMru, sharedRaw));
    return {
      fareMru,
      pricingModeApplied: 'shared',
      sharedSeatsApplied: seats,
      soloFareMru,
    };
  }

  return {
    fareMru: soloFareMru,
    pricingModeApplied: 'solo',
    sharedSeatsApplied: null,
    soloFareMru,
  };
}

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
  options: FareEstimateOptions = {},
): Promise<{
  fareMru: number;
  distanceEstimateM: number;
  pricingModeApplied: FarePricingMode;
  sharedSeatsApplied: number | null;
  soloFareMru: number | null;
  isIntercityPricing: boolean;
}> {
  const s = await getPricingSettings();
  const distanceEstimateM = Math.round(distanceMetersStraightLine * env.ROUTE_MULTIPLIER);
  const requestedMode: FarePricingMode = options.pricingMode ?? 'solo';

  const isIntercity =
    rideType === 'passenger' &&
    s.intercityPricingEnabled &&
    distanceEstimateM >= s.longDistanceThresholdM;

  if (isIntercity) {
    const quote = intercityFareMru(distanceEstimateM, {
      baseFareMru: s.intercityBaseFareMru,
      tier1LimitKm: s.intercityTier1LimitKm,
      tier2LimitKm: s.intercityTier2LimitKm,
      tier1PerKmMru: s.intercityTier1PerKmMru,
      tier2PerKmMru: s.intercityTier2PerKmMru,
      tier3PerKmMru: s.intercityTier3PerKmMru,
      sharedDefaultSeats: s.intercitySharedDefaultSeats,
      sharedMinSeatFareMru: s.intercitySharedMinSeatFareMru,
      minFareMru: s.minFareMru,
    }, {
      pricingMode: requestedMode,
      sharedSeats: options.sharedSeats,
    });

    return {
      fareMru: quote.fareMru,
      distanceEstimateM,
      pricingModeApplied: quote.pricingModeApplied,
      sharedSeatsApplied: quote.sharedSeatsApplied,
      soloFareMru: quote.soloFareMru,
      isIntercityPricing: true,
    };
  }

  const tariff = rideType === 'colis'
    ? { base: s.colisBaseFareMru, perKm: s.colisPerKmMru, min: s.colisMinFareMru }
    : { base: s.baseFareMru,      perKm: s.perKmMru,      min: s.minFareMru      };
  const raw = tariff.base + (distanceEstimateM / 1000) * tariff.perKm;
  const fareMru = roundUpToNearest5(Math.max(tariff.min, raw));
  return {
    fareMru,
    distanceEstimateM,
    pricingModeApplied: 'solo',
    sharedSeatsApplied: null,
    soloFareMru: null,
    isIntercityPricing: false,
  };
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
  return roundUpToNearest5(Math.max(tariff.minFareMru, raw));
}
