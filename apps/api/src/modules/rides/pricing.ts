import { env } from '../../config/env.js';

/**
 * Fare estimate (in MRU) from straight-line distance.
 * The route is usually ~30% longer than crow-flies, hence ROUTE_MULTIPLIER.
 * Always at least MIN_FARE_MRU.
 *
 * Result is always an integer (MRU). All money in this codebase is MRU
 * since migration 0017 — the legacy khoums unit (1 MRU = 5 khoums) was
 * removed because the conversion was a constant source of bugs.
 */
export function estimateFareMru(distanceMetersStraightLine: number): {
  fareMru: number;
  distanceEstimateM: number;
} {
  const distanceEstimateM = Math.round(distanceMetersStraightLine * env.ROUTE_MULTIPLIER);
  const raw = env.BASE_FARE_MRU + (distanceEstimateM / 1000) * env.PER_KM_MRU;
  const fareMru = Math.max(env.MIN_FARE_MRU, Math.round(raw));
  return { fareMru, distanceEstimateM };
}

/**
 * Compute the commission (in MRU) from a final fare and rate basis points.
 * Rounded down so the platform never "takes more than agreed".
 */
export function commissionMru(fareMru: number, rateBps: number): number {
  return Math.floor((fareMru * rateBps) / 10_000);
}
