import { env } from '../../config/env.js';

/**
 * Fare estimate (in khoums) from straight-line distance.
 * The route is usually ~30% longer than crow-flies, hence ROUTE_MULTIPLIER.
 * Always at least MIN_FARE_KHOUMS.
 *
 * Result is always an integer (khoums).
 */
export function estimateFareKhoums(distanceMetersStraightLine: number): {
  fareKhoums: number;
  distanceEstimateM: number;
} {
  const distanceEstimateM = Math.round(distanceMetersStraightLine * env.ROUTE_MULTIPLIER);
  const raw = env.BASE_FARE_KHOUMS + (distanceEstimateM / 1000) * env.PER_KM_KHOUMS;
  const fareKhoums = Math.max(env.MIN_FARE_KHOUMS, Math.round(raw));
  return { fareKhoums, distanceEstimateM };
}

/**
 * Compute the commission (in khoums) from a final fare and rate basis points.
 * Rounded down so the platform never "takes more than agreed".
 */
export function commissionKhoums(fareKhoums: number, rateBps: number): number {
  return Math.floor((fareKhoums * rateBps) / 10_000);
}
