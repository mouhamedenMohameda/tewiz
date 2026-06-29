/**
 * Pricing & commission settings, loaded from the single-row `app_settings`
 * table.
 *
 * Reads are hot-pathed (every booking calls them), so we cache the row in
 * memory for `CACHE_TTL_MS`. Writes bust the cache immediately so the
 * admin who just clicked "Save" sees the new values on the very next ride.
 *
 * Returned values are always integers (MRU) or basis points (commission).
 */

import { pool } from '../../db/pool.js';

export interface PricingSettings {
  baseFareMru: number;
  perKmMru: number;
  minFareMru: number;
  // Colis-specific tariff (migration 0019). Operators reported that package
  // runs cost less to perform than passenger rides, so they get their own
  // base fare / per-km / minimum. Commission was already differentiated.
  colisBaseFareMru: number;
  colisPerKmMru: number;
  colisMinFareMru: number;
  defaultCommissionBps: number;
  colisCommissionBps: number;
  // Migration 0022. Threshold above which a ride is considered long-distance
  // and only dispatched to captains who opted in (captains.accepts_long_distance).
  longDistanceThresholdM: number;
  // Migration 0022. Dedicated commission for rides created by an admin
  // operator (passenger called by phone). Defaults to the same rate as the
  // standard commission until the admin sets a different value.
  operatorPassengerCommissionBps: number;
  operatorColisCommissionBps: number;
  // Migration 0025. A ride in 'searching' longer than this is auto-cancelled
  // by the background expiry job. 0 disables the job.
  searchingTimeoutS: number;
  // Migration 0028. Captain commission bonus: when a captain pays X MRU of
  // commission within Y days, their commission is halved for Z days.
  commissionBonusEnabled: boolean;
  commissionBonusThresholdMru: number;
  commissionBonusWindowDays: number;
  commissionBonusRewardDays: number;
  // Migration 0030. Open rides ("course ouverte") — no upfront destination,
  // metered fare = open_base + km × open_per_km + min × open_per_minute,
  // floored at open_min_fare.
  allowOpenRides: boolean;
  openBaseFareMru: number;
  openPerKmMru: number;
  openPerMinuteMru: number;
  openMinFareMru: number;
  // Migration 0031. Show the one-tap reviewer demo-login buttons on the welcome
  // and login screens. Flip to true before an App Store / Play submission,
  // back to false once the build is approved.
  showDemoButtons: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { value: PricingSettings; loadedAt: number } | null = null;

interface Row {
  base_fare_mru: number;
  per_km_mru: number;
  min_fare_mru: number;
  colis_base_fare_mru: number;
  colis_per_km_mru: number;
  colis_min_fare_mru: number;
  default_commission_bps: number;
  colis_commission_bps: number;
  long_distance_threshold_m: number;
  operator_passenger_commission_bps: number;
  operator_colis_commission_bps: number;
  searching_timeout_s: number;
  commission_bonus_enabled: boolean;
  commission_bonus_threshold_mru: number;
  commission_bonus_window_days: number;
  commission_bonus_reward_days: number;
  allow_open_rides: boolean;
  open_base_fare_mru: number;
  open_per_km_mru: number;
  open_per_minute_mru: number;
  open_min_fare_mru: number;
  show_demo_buttons: boolean;
  updated_at: Date;
  updated_by: string | null;
}

function toSettings(r: Row): PricingSettings {
  return {
    baseFareMru: r.base_fare_mru,
    perKmMru: r.per_km_mru,
    minFareMru: r.min_fare_mru,
    colisBaseFareMru: r.colis_base_fare_mru,
    colisPerKmMru: r.colis_per_km_mru,
    colisMinFareMru: r.colis_min_fare_mru,
    defaultCommissionBps: r.default_commission_bps,
    colisCommissionBps: r.colis_commission_bps,
    longDistanceThresholdM: r.long_distance_threshold_m,
    operatorPassengerCommissionBps: r.operator_passenger_commission_bps,
    operatorColisCommissionBps: r.operator_colis_commission_bps,
    searchingTimeoutS: r.searching_timeout_s,
    commissionBonusEnabled: r.commission_bonus_enabled,
    commissionBonusThresholdMru: r.commission_bonus_threshold_mru,
    commissionBonusWindowDays: r.commission_bonus_window_days,
    commissionBonusRewardDays: r.commission_bonus_reward_days,
    allowOpenRides: r.allow_open_rides,
    openBaseFareMru: r.open_base_fare_mru,
    openPerKmMru: r.open_per_km_mru,
    openPerMinuteMru: r.open_per_minute_mru,
    openMinFareMru: r.open_min_fare_mru,
    showDemoButtons: r.show_demo_buttons,
    updatedAt: r.updated_at.toISOString(),
    updatedBy: r.updated_by,
  };
}

export async function getPricingSettings(): Promise<PricingSettings> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  const { rows } = await pool.query<Row>(
    `SELECT base_fare_mru, per_km_mru, min_fare_mru,
            colis_base_fare_mru, colis_per_km_mru, colis_min_fare_mru,
            default_commission_bps, colis_commission_bps,
            long_distance_threshold_m,
            operator_passenger_commission_bps, operator_colis_commission_bps,
            searching_timeout_s,
            commission_bonus_enabled, commission_bonus_threshold_mru,
            commission_bonus_window_days, commission_bonus_reward_days,
            allow_open_rides, open_base_fare_mru, open_per_km_mru,
            open_per_minute_mru, open_min_fare_mru,
            show_demo_buttons,
            updated_at, updated_by
       FROM app_settings WHERE id = 1`,
  );
  if (!rows[0]) {
    // Row should exist via migration seed; if not we fail loudly rather
    // than silently using zeros.
    throw new Error('app_settings row missing — migration 0018 not applied?');
  }
  const value = toSettings(rows[0]);
  cache = { value, loadedAt: Date.now() };
  return value;
}

export interface PricingSettingsPatch {
  baseFareMru?: number;
  perKmMru?: number;
  minFareMru?: number;
  colisBaseFareMru?: number;
  colisPerKmMru?: number;
  colisMinFareMru?: number;
  defaultCommissionBps?: number;
  colisCommissionBps?: number;
  longDistanceThresholdM?: number;
  operatorPassengerCommissionBps?: number;
  operatorColisCommissionBps?: number;
  searchingTimeoutS?: number;
  commissionBonusEnabled?: boolean;
  commissionBonusThresholdMru?: number;
  commissionBonusWindowDays?: number;
  commissionBonusRewardDays?: number;
  allowOpenRides?: boolean;
  openBaseFareMru?: number;
  openPerKmMru?: number;
  openPerMinuteMru?: number;
  openMinFareMru?: number;
  showDemoButtons?: boolean;
}

export async function updatePricingSettings(
  adminId: string,
  patch: PricingSettingsPatch,
): Promise<PricingSettings> {
  const { rows } = await pool.query<Row>(
    `UPDATE app_settings
        SET base_fare_mru                     = COALESCE($1, base_fare_mru),
            per_km_mru                        = COALESCE($2, per_km_mru),
            min_fare_mru                      = COALESCE($3, min_fare_mru),
            colis_base_fare_mru               = COALESCE($4, colis_base_fare_mru),
            colis_per_km_mru                  = COALESCE($5, colis_per_km_mru),
            colis_min_fare_mru                = COALESCE($6, colis_min_fare_mru),
            default_commission_bps            = COALESCE($7, default_commission_bps),
            colis_commission_bps              = COALESCE($8, colis_commission_bps),
            long_distance_threshold_m         = COALESCE($9, long_distance_threshold_m),
            operator_passenger_commission_bps = COALESCE($10, operator_passenger_commission_bps),
            operator_colis_commission_bps     = COALESCE($11, operator_colis_commission_bps),
            searching_timeout_s               = COALESCE($12, searching_timeout_s),
            commission_bonus_enabled          = COALESCE($13, commission_bonus_enabled),
            commission_bonus_threshold_mru    = COALESCE($14, commission_bonus_threshold_mru),
            commission_bonus_window_days      = COALESCE($15, commission_bonus_window_days),
            commission_bonus_reward_days      = COALESCE($16, commission_bonus_reward_days),
            allow_open_rides                  = COALESCE($17, allow_open_rides),
            open_base_fare_mru                = COALESCE($18, open_base_fare_mru),
            open_per_km_mru                   = COALESCE($19, open_per_km_mru),
            open_per_minute_mru               = COALESCE($20, open_per_minute_mru),
            open_min_fare_mru                 = COALESCE($21, open_min_fare_mru),
            show_demo_buttons                 = COALESCE($23, show_demo_buttons),
            updated_at                        = now(),
            updated_by                        = $22
      WHERE id = 1
      RETURNING base_fare_mru, per_km_mru, min_fare_mru,
                colis_base_fare_mru, colis_per_km_mru, colis_min_fare_mru,
                default_commission_bps, colis_commission_bps,
                long_distance_threshold_m,
                operator_passenger_commission_bps, operator_colis_commission_bps,
                searching_timeout_s,
                commission_bonus_enabled, commission_bonus_threshold_mru,
                commission_bonus_window_days, commission_bonus_reward_days,
                allow_open_rides, open_base_fare_mru, open_per_km_mru,
                open_per_minute_mru, open_min_fare_mru,
                show_demo_buttons,
                updated_at, updated_by`,
    [
      patch.baseFareMru ?? null,
      patch.perKmMru ?? null,
      patch.minFareMru ?? null,
      patch.colisBaseFareMru ?? null,
      patch.colisPerKmMru ?? null,
      patch.colisMinFareMru ?? null,
      patch.defaultCommissionBps ?? null,
      patch.colisCommissionBps ?? null,
      patch.longDistanceThresholdM ?? null,
      patch.operatorPassengerCommissionBps ?? null,
      patch.operatorColisCommissionBps ?? null,
      patch.searchingTimeoutS ?? null,
      patch.commissionBonusEnabled ?? null,
      patch.commissionBonusThresholdMru ?? null,
      patch.commissionBonusWindowDays ?? null,
      patch.commissionBonusRewardDays ?? null,
      patch.allowOpenRides ?? null,
      patch.openBaseFareMru ?? null,
      patch.openPerKmMru ?? null,
      patch.openPerMinuteMru ?? null,
      patch.openMinFareMru ?? null,
      adminId,
      patch.showDemoButtons ?? null,
    ],
  );
  cache = null;
  return toSettings(rows[0]!);
}
