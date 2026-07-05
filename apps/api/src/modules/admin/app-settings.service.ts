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

import type { CaptainAlertSoundMode } from '@tewiz/shared-types';
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
  // Inter-city pricing (migration 0034). Above longDistanceThresholdM, use a
  // dedicated tiered passenger tariff and optional shared-seat mode.
  intercityPricingEnabled: boolean;
  intercityBaseFareMru: number;
  intercityTier1LimitKm: number;
  intercityTier2LimitKm: number;
  intercityTier1PerKmMru: number;
  intercityTier2PerKmMru: number;
  intercityTier3PerKmMru: number;
  intercitySharedDefaultSeats: number;
  intercitySharedMinSeatFareMru: number;
  intercityCommissionBps: number;
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
  // Night pricing window. When enabled, fares are multiplied during the
  // configured local-hour interval.
  nightPricingEnabled: boolean;
  nightPriceMultiplier: number;
  nightPriceStartHour: number;
  nightPriceEndHour: number;
  carpoolingEnabled: boolean;
  carpoolingPublicationFee: number;
  carpoolingBoostFee: number;
  // Migration 0031. Show the one-tap reviewer demo-login buttons on the welcome
  // and login screens. Flip to true before an App Store / Play submission,
  // back to false once the build is approved.
  showDemoButtons: boolean;
  captainAlertSoundMode: CaptainAlertSoundMode;
  captainAlertRepeatIntervalS: number;
  captainAlertSoundUrl: string | null;
  gpsFraudSevereMode: boolean;
  // Migration 0041. Partner program: cap on the SUM of commission shares paid
  // on a single ride, dedicated commission rates for partner-created rides
  // (same model as operator_*), and fraud-scan thresholds.
  partnerTotalShareCapBps: number;
  restaurantPassengerCommissionBps: number;
  restaurantColisCommissionBps: number;
  partnerPassengerCommissionBps: number;
  partnerColisCommissionBps: number;
  partnerFraudPairMaxRides7d: number;
  partnerFraudMinDistanceM: number;
  partnerFraudMaxCreationsPerHour: number;
  privateDriverEnabled: boolean;
  privateDriverHourlyRateMru: number;
  privateDriverMinHours: number;
  privateDriverCommissionBps: number;
  convoyageEnabled: boolean;
  convoyageBaseFareMru: number;
  convoyagePerKmMru: number;
  convoyageMinFareMru: number;
  convoyageCommissionBps: number;
  carRentalEnabled: boolean;
  carRentalDailyRateMru: number;
  carRentalCommissionBps: number;
  roadsideAssistanceEnabled: boolean;
  roadsideAssistanceBaseFareMru: number;
  roadsideAssistanceCommissionBps: number;
  lightMovingEnabled: boolean;
  lightMovingBaseFareMru: number;
  lightMovingPerKmMru: number;
  lightMovingMinFareMru: number;
  lightMovingCommissionBps: number;
  intercityFreightEnabled: boolean;
  intercityFreightBaseFareMru: number;
  intercityFreightPerKmMru: number;
  intercityFreightMinFareMru: number;
  intercityFreightCommissionBps: number;
  equipmentRentalEnabled: boolean;
  equipmentRentalDailyRateMru: number;
  equipmentRentalCommissionBps: number;
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
  intercity_pricing_enabled: boolean;
  intercity_base_fare_mru: number;
  intercity_tier1_limit_km: number;
  intercity_tier2_limit_km: number;
  intercity_tier1_per_km_mru: number;
  intercity_tier2_per_km_mru: number;
  intercity_tier3_per_km_mru: number;
  intercity_shared_default_seats: number;
  intercity_shared_min_seat_fare_mru: number;
  intercity_commission_bps: number;
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
  night_pricing_enabled: boolean;
  night_price_multiplier: string;
  night_price_start_hour: number;
  night_price_end_hour: number;
  carpooling_enabled: boolean;
  carpooling_publication_fee: number;
  carpooling_boost_fee: number;
  show_demo_buttons: boolean;
  captain_alert_sound_mode: CaptainAlertSoundMode;
  captain_alert_repeat_interval_s: number;
  captain_alert_sound_url: string | null;
  gps_fraud_severe_mode: boolean;
  partner_total_share_cap_bps: number;
  restaurant_passenger_commission_bps: number;
  restaurant_colis_commission_bps: number;
  partner_passenger_commission_bps: number;
  partner_colis_commission_bps: number;
  partner_fraud_pair_max_rides_7d: number;
  partner_fraud_min_distance_m: number;
  partner_fraud_max_creations_per_hour: number;
  private_driver_enabled: boolean;
  private_driver_hourly_rate_mru: number;
  private_driver_min_hours: number;
  private_driver_commission_bps: number;
  convoyage_enabled: boolean;
  convoyage_base_fare_mru: number;
  convoyage_per_km_mru: number;
  convoyage_min_fare_mru: number;
  convoyage_commission_bps: number;
  car_rental_enabled: boolean;
  car_rental_daily_rate_mru: number;
  car_rental_commission_bps: number;
  roadside_assistance_enabled: boolean;
  roadside_assistance_base_fare_mru: number;
  roadside_assistance_commission_bps: number;
  light_moving_enabled: boolean;
  light_moving_base_fare_mru: number;
  light_moving_per_km_mru: number;
  light_moving_min_fare_mru: number;
  light_moving_commission_bps: number;
  intercity_freight_enabled: boolean;
  intercity_freight_base_fare_mru: number;
  intercity_freight_per_km_mru: number;
  intercity_freight_min_fare_mru: number;
  intercity_freight_commission_bps: number;
  equipment_rental_enabled: boolean;
  equipment_rental_daily_rate_mru: number;
  equipment_rental_commission_bps: number;
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
    intercityPricingEnabled: r.intercity_pricing_enabled,
    intercityBaseFareMru: r.intercity_base_fare_mru,
    intercityTier1LimitKm: r.intercity_tier1_limit_km,
    intercityTier2LimitKm: r.intercity_tier2_limit_km,
    intercityTier1PerKmMru: r.intercity_tier1_per_km_mru,
    intercityTier2PerKmMru: r.intercity_tier2_per_km_mru,
    intercityTier3PerKmMru: r.intercity_tier3_per_km_mru,
    intercitySharedDefaultSeats: r.intercity_shared_default_seats,
    intercitySharedMinSeatFareMru: r.intercity_shared_min_seat_fare_mru,
    intercityCommissionBps: r.intercity_commission_bps,
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
    nightPricingEnabled: r.night_pricing_enabled,
    nightPriceMultiplier: Number(r.night_price_multiplier),
    nightPriceStartHour: r.night_price_start_hour,
    nightPriceEndHour: r.night_price_end_hour,
    carpoolingEnabled: r.carpooling_enabled,
    carpoolingPublicationFee: r.carpooling_publication_fee,
    carpoolingBoostFee: r.carpooling_boost_fee,
    showDemoButtons: r.show_demo_buttons,
    captainAlertSoundMode: r.captain_alert_sound_mode,
    captainAlertRepeatIntervalS: r.captain_alert_repeat_interval_s,
    captainAlertSoundUrl: r.captain_alert_sound_url,
    gpsFraudSevereMode: r.gps_fraud_severe_mode,
    partnerTotalShareCapBps: r.partner_total_share_cap_bps,
    restaurantPassengerCommissionBps: r.restaurant_passenger_commission_bps,
    restaurantColisCommissionBps: r.restaurant_colis_commission_bps,
    partnerPassengerCommissionBps: r.partner_passenger_commission_bps,
    partnerColisCommissionBps: r.partner_colis_commission_bps,
    partnerFraudPairMaxRides7d: r.partner_fraud_pair_max_rides_7d,
    partnerFraudMinDistanceM: r.partner_fraud_min_distance_m,
    partnerFraudMaxCreationsPerHour: r.partner_fraud_max_creations_per_hour,
    privateDriverEnabled: r.private_driver_enabled,
    privateDriverHourlyRateMru: r.private_driver_hourly_rate_mru,
    privateDriverMinHours: r.private_driver_min_hours,
    privateDriverCommissionBps: r.private_driver_commission_bps,
    convoyageEnabled: r.convoyage_enabled,
    convoyageBaseFareMru: r.convoyage_base_fare_mru,
    convoyagePerKmMru: r.convoyage_per_km_mru,
    convoyageMinFareMru: r.convoyage_min_fare_mru,
    convoyageCommissionBps: r.convoyage_commission_bps,
    carRentalEnabled: r.car_rental_enabled,
    carRentalDailyRateMru: r.car_rental_daily_rate_mru,
    carRentalCommissionBps: r.car_rental_commission_bps,
    roadsideAssistanceEnabled: r.roadside_assistance_enabled,
    roadsideAssistanceBaseFareMru: r.roadside_assistance_base_fare_mru,
    roadsideAssistanceCommissionBps: r.roadside_assistance_commission_bps,
    lightMovingEnabled: r.light_moving_enabled,
    lightMovingBaseFareMru: r.light_moving_base_fare_mru,
    lightMovingPerKmMru: r.light_moving_per_km_mru,
    lightMovingMinFareMru: r.light_moving_min_fare_mru,
    lightMovingCommissionBps: r.light_moving_commission_bps,
    intercityFreightEnabled: r.intercity_freight_enabled,
    intercityFreightBaseFareMru: r.intercity_freight_base_fare_mru,
    intercityFreightPerKmMru: r.intercity_freight_per_km_mru,
    intercityFreightMinFareMru: r.intercity_freight_min_fare_mru,
    intercityFreightCommissionBps: r.intercity_freight_commission_bps,
    equipmentRentalEnabled: r.equipment_rental_enabled,
    equipmentRentalDailyRateMru: r.equipment_rental_daily_rate_mru,
    equipmentRentalCommissionBps: r.equipment_rental_commission_bps,
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
          intercity_pricing_enabled,
          intercity_base_fare_mru,
          intercity_tier1_limit_km,
          intercity_tier2_limit_km,
          intercity_tier1_per_km_mru,
          intercity_tier2_per_km_mru,
          intercity_tier3_per_km_mru,
          intercity_shared_default_seats,
          intercity_shared_min_seat_fare_mru,
          intercity_commission_bps,
            long_distance_threshold_m,
            operator_passenger_commission_bps, operator_colis_commission_bps,
            searching_timeout_s,
            commission_bonus_enabled, commission_bonus_threshold_mru,
            commission_bonus_window_days, commission_bonus_reward_days,
            allow_open_rides, open_base_fare_mru, open_per_km_mru,
            open_per_minute_mru, open_min_fare_mru,
            night_pricing_enabled, night_price_multiplier,
            night_price_start_hour, night_price_end_hour,
            carpooling_enabled, carpooling_publication_fee,
            carpooling_boost_fee,
            show_demo_buttons,
              captain_alert_sound_mode, captain_alert_repeat_interval_s,
              captain_alert_sound_url,
                  gps_fraud_severe_mode,
            partner_total_share_cap_bps,
            restaurant_passenger_commission_bps, restaurant_colis_commission_bps,
            partner_passenger_commission_bps, partner_colis_commission_bps,
            partner_fraud_pair_max_rides_7d, partner_fraud_min_distance_m,
            partner_fraud_max_creations_per_hour,
            private_driver_enabled, private_driver_hourly_rate_mru,
            private_driver_min_hours, private_driver_commission_bps,
            convoyage_enabled, convoyage_base_fare_mru,
            convoyage_per_km_mru, convoyage_min_fare_mru,
            convoyage_commission_bps,
            car_rental_enabled, car_rental_daily_rate_mru,
            car_rental_commission_bps,
            roadside_assistance_enabled, roadside_assistance_base_fare_mru,
            roadside_assistance_commission_bps,
            light_moving_enabled, light_moving_base_fare_mru,
            light_moving_per_km_mru, light_moving_min_fare_mru,
            light_moving_commission_bps,
            intercity_freight_enabled, intercity_freight_base_fare_mru,
            intercity_freight_per_km_mru, intercity_freight_min_fare_mru,
            intercity_freight_commission_bps,
            equipment_rental_enabled, equipment_rental_daily_rate_mru,
            equipment_rental_commission_bps,
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
  intercityPricingEnabled?: boolean;
  intercityBaseFareMru?: number;
  intercityTier1LimitKm?: number;
  intercityTier2LimitKm?: number;
  intercityTier1PerKmMru?: number;
  intercityTier2PerKmMru?: number;
  intercityTier3PerKmMru?: number;
  intercitySharedDefaultSeats?: number;
  intercitySharedMinSeatFareMru?: number;
  intercityCommissionBps?: number;
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
  nightPricingEnabled?: boolean;
  nightPriceMultiplier?: number;
  nightPriceStartHour?: number;
  nightPriceEndHour?: number;
  carpoolingEnabled?: boolean;
  carpoolingPublicationFee?: number;
  carpoolingBoostFee?: number;
  showDemoButtons?: boolean;
  captainAlertSoundMode?: CaptainAlertSoundMode;
  captainAlertRepeatIntervalS?: number;
  captainAlertSoundUrl?: string | null;
  gpsFraudSevereMode?: boolean;
  partnerTotalShareCapBps?: number;
  restaurantPassengerCommissionBps?: number;
  restaurantColisCommissionBps?: number;
  partnerPassengerCommissionBps?: number;
  partnerColisCommissionBps?: number;
  partnerFraudPairMaxRides7d?: number;
  partnerFraudMinDistanceM?: number;
  partnerFraudMaxCreationsPerHour?: number;
  privateDriverEnabled?: boolean;
  privateDriverHourlyRateMru?: number;
  privateDriverMinHours?: number;
  privateDriverCommissionBps?: number;
  convoyageEnabled?: boolean;
  convoyageBaseFareMru?: number;
  convoyagePerKmMru?: number;
  convoyageMinFareMru?: number;
  convoyageCommissionBps?: number;
  carRentalEnabled?: boolean;
  carRentalDailyRateMru?: number;
  carRentalCommissionBps?: number;
  roadsideAssistanceEnabled?: boolean;
  roadsideAssistanceBaseFareMru?: number;
  roadsideAssistanceCommissionBps?: number;
  lightMovingEnabled?: boolean;
  lightMovingBaseFareMru?: number;
  lightMovingPerKmMru?: number;
  lightMovingMinFareMru?: number;
  lightMovingCommissionBps?: number;
  intercityFreightEnabled?: boolean;
  intercityFreightBaseFareMru?: number;
  intercityFreightPerKmMru?: number;
  intercityFreightMinFareMru?: number;
  intercityFreightCommissionBps?: number;
  equipmentRentalEnabled?: boolean;
  equipmentRentalDailyRateMru?: number;
  equipmentRentalCommissionBps?: number;
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
          intercity_pricing_enabled         = COALESCE($9, intercity_pricing_enabled),
          intercity_base_fare_mru           = COALESCE($10, intercity_base_fare_mru),
          intercity_tier1_limit_km          = COALESCE($11, intercity_tier1_limit_km),
          intercity_tier2_limit_km          = COALESCE($12, intercity_tier2_limit_km),
          intercity_tier1_per_km_mru        = COALESCE($13, intercity_tier1_per_km_mru),
          intercity_tier2_per_km_mru        = COALESCE($14, intercity_tier2_per_km_mru),
          intercity_tier3_per_km_mru        = COALESCE($15, intercity_tier3_per_km_mru),
          intercity_shared_default_seats    = COALESCE($16, intercity_shared_default_seats),
          intercity_shared_min_seat_fare_mru = COALESCE($17, intercity_shared_min_seat_fare_mru),
          intercity_commission_bps          = COALESCE($18, intercity_commission_bps),
          long_distance_threshold_m         = COALESCE($19, long_distance_threshold_m),
          operator_passenger_commission_bps = COALESCE($20, operator_passenger_commission_bps),
          operator_colis_commission_bps     = COALESCE($21, operator_colis_commission_bps),
          searching_timeout_s               = COALESCE($22, searching_timeout_s),
          commission_bonus_enabled          = COALESCE($23, commission_bonus_enabled),
          commission_bonus_threshold_mru    = COALESCE($24, commission_bonus_threshold_mru),
          commission_bonus_window_days      = COALESCE($25, commission_bonus_window_days),
          commission_bonus_reward_days      = COALESCE($26, commission_bonus_reward_days),
          allow_open_rides                  = COALESCE($27, allow_open_rides),
          open_base_fare_mru                = COALESCE($28, open_base_fare_mru),
          open_per_km_mru                   = COALESCE($29, open_per_km_mru),
          open_per_minute_mru               = COALESCE($30, open_per_minute_mru),
          open_min_fare_mru                 = COALESCE($31, open_min_fare_mru),
          night_pricing_enabled             = COALESCE($32, night_pricing_enabled),
          night_price_multiplier            = COALESCE($33, night_price_multiplier),
          night_price_start_hour            = COALESCE($34, night_price_start_hour),
          night_price_end_hour              = COALESCE($35, night_price_end_hour),
          carpooling_enabled                = COALESCE($50, carpooling_enabled),
          carpooling_publication_fee        = COALESCE($51, carpooling_publication_fee),
          carpooling_boost_fee              = COALESCE($52, carpooling_boost_fee),
          show_demo_buttons                 = COALESCE($37, show_demo_buttons),
          captain_alert_sound_mode          = COALESCE($38, captain_alert_sound_mode),
          captain_alert_repeat_interval_s   = COALESCE($39, captain_alert_repeat_interval_s),
          captain_alert_sound_url           = COALESCE($40, captain_alert_sound_url),
          gps_fraud_severe_mode             = COALESCE($41, gps_fraud_severe_mode),
          partner_total_share_cap_bps       = COALESCE($42, partner_total_share_cap_bps),
          restaurant_passenger_commission_bps = COALESCE($43, restaurant_passenger_commission_bps),
          restaurant_colis_commission_bps   = COALESCE($44, restaurant_colis_commission_bps),
          partner_passenger_commission_bps  = COALESCE($45, partner_passenger_commission_bps),
          partner_colis_commission_bps      = COALESCE($46, partner_colis_commission_bps),
          partner_fraud_pair_max_rides_7d   = COALESCE($47, partner_fraud_pair_max_rides_7d),
          partner_fraud_min_distance_m      = COALESCE($48, partner_fraud_min_distance_m),
          partner_fraud_max_creations_per_hour = COALESCE($49, partner_fraud_max_creations_per_hour),
          private_driver_enabled             = COALESCE($53, private_driver_enabled),
          private_driver_hourly_rate_mru     = COALESCE($54, private_driver_hourly_rate_mru),
          private_driver_min_hours           = COALESCE($55, private_driver_min_hours),
          private_driver_commission_bps      = COALESCE($56, private_driver_commission_bps),
          convoyage_enabled                  = COALESCE($57, convoyage_enabled),
          convoyage_base_fare_mru            = COALESCE($58, convoyage_base_fare_mru),
          convoyage_per_km_mru               = COALESCE($59, convoyage_per_km_mru),
          convoyage_min_fare_mru             = COALESCE($60, convoyage_min_fare_mru),
          convoyage_commission_bps           = COALESCE($61, convoyage_commission_bps),
          car_rental_enabled                 = COALESCE($62, car_rental_enabled),
          car_rental_daily_rate_mru          = COALESCE($63, car_rental_daily_rate_mru),
          car_rental_commission_bps          = COALESCE($64, car_rental_commission_bps),
          roadside_assistance_enabled        = COALESCE($65, roadside_assistance_enabled),
          roadside_assistance_base_fare_mru  = COALESCE($66, roadside_assistance_base_fare_mru),
          roadside_assistance_commission_bps = COALESCE($67, roadside_assistance_commission_bps),
          light_moving_enabled               = COALESCE($68, light_moving_enabled),
          light_moving_base_fare_mru         = COALESCE($69, light_moving_base_fare_mru),
          light_moving_per_km_mru            = COALESCE($70, light_moving_per_km_mru),
          light_moving_min_fare_mru          = COALESCE($71, light_moving_min_fare_mru),
          light_moving_commission_bps        = COALESCE($72, light_moving_commission_bps),
          intercity_freight_enabled          = COALESCE($73, intercity_freight_enabled),
          intercity_freight_base_fare_mru    = COALESCE($74, intercity_freight_base_fare_mru),
          intercity_freight_per_km_mru       = COALESCE($75, intercity_freight_per_km_mru),
          intercity_freight_min_fare_mru     = COALESCE($76, intercity_freight_min_fare_mru),
          intercity_freight_commission_bps   = COALESCE($77, intercity_freight_commission_bps),
          equipment_rental_enabled           = COALESCE($78, equipment_rental_enabled),
          equipment_rental_daily_rate_mru    = COALESCE($79, equipment_rental_daily_rate_mru),
          equipment_rental_commission_bps    = COALESCE($80, equipment_rental_commission_bps),
            updated_at                        = now(),
          updated_by                        = $36
      WHERE id = 1
      RETURNING base_fare_mru, per_km_mru, min_fare_mru,
                colis_base_fare_mru, colis_per_km_mru, colis_min_fare_mru,
                default_commission_bps, colis_commission_bps,
            intercity_pricing_enabled,
            intercity_base_fare_mru,
            intercity_tier1_limit_km,
            intercity_tier2_limit_km,
            intercity_tier1_per_km_mru,
            intercity_tier2_per_km_mru,
            intercity_tier3_per_km_mru,
            intercity_shared_default_seats,
            intercity_shared_min_seat_fare_mru,
            intercity_commission_bps,
                long_distance_threshold_m,
                operator_passenger_commission_bps, operator_colis_commission_bps,
                searching_timeout_s,
                commission_bonus_enabled, commission_bonus_threshold_mru,
                commission_bonus_window_days, commission_bonus_reward_days,
                allow_open_rides, open_base_fare_mru, open_per_km_mru,
                open_per_minute_mru, open_min_fare_mru,
                night_pricing_enabled, night_price_multiplier,
                night_price_start_hour, night_price_end_hour,
                carpooling_enabled, carpooling_publication_fee,
                carpooling_boost_fee,
                show_demo_buttons,
                captain_alert_sound_mode, captain_alert_repeat_interval_s,
                captain_alert_sound_url,
                gps_fraud_severe_mode,
                partner_total_share_cap_bps,
                restaurant_passenger_commission_bps, restaurant_colis_commission_bps,
                partner_passenger_commission_bps, partner_colis_commission_bps,
                partner_fraud_pair_max_rides_7d, partner_fraud_min_distance_m,
                partner_fraud_max_creations_per_hour,
                private_driver_enabled, private_driver_hourly_rate_mru,
                private_driver_min_hours, private_driver_commission_bps,
                convoyage_enabled, convoyage_base_fare_mru,
                convoyage_per_km_mru, convoyage_min_fare_mru,
                convoyage_commission_bps,
                car_rental_enabled, car_rental_daily_rate_mru,
                car_rental_commission_bps,
                roadside_assistance_enabled, roadside_assistance_base_fare_mru,
                roadside_assistance_commission_bps,
                light_moving_enabled, light_moving_base_fare_mru,
                light_moving_per_km_mru, light_moving_min_fare_mru,
                light_moving_commission_bps,
                intercity_freight_enabled, intercity_freight_base_fare_mru,
                intercity_freight_per_km_mru, intercity_freight_min_fare_mru,
                intercity_freight_commission_bps,
                equipment_rental_enabled, equipment_rental_daily_rate_mru,
                equipment_rental_commission_bps,
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
      patch.intercityPricingEnabled ?? null,
      patch.intercityBaseFareMru ?? null,
      patch.intercityTier1LimitKm ?? null,
      patch.intercityTier2LimitKm ?? null,
      patch.intercityTier1PerKmMru ?? null,
      patch.intercityTier2PerKmMru ?? null,
      patch.intercityTier3PerKmMru ?? null,
      patch.intercitySharedDefaultSeats ?? null,
      patch.intercitySharedMinSeatFareMru ?? null,
      patch.intercityCommissionBps ?? null,
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
      patch.nightPricingEnabled ?? null,
      patch.nightPriceMultiplier ?? null,
      patch.nightPriceStartHour ?? null,
      patch.nightPriceEndHour ?? null,
      adminId,
      patch.showDemoButtons ?? null,
      patch.captainAlertSoundMode ?? null,
      patch.captainAlertRepeatIntervalS ?? null,
      patch.captainAlertSoundUrl ?? null,
      patch.gpsFraudSevereMode ?? null,
      patch.partnerTotalShareCapBps ?? null,
      patch.restaurantPassengerCommissionBps ?? null,
      patch.restaurantColisCommissionBps ?? null,
      patch.partnerPassengerCommissionBps ?? null,
      patch.partnerColisCommissionBps ?? null,
      patch.partnerFraudPairMaxRides7d ?? null,
      patch.partnerFraudMinDistanceM ?? null,
      patch.partnerFraudMaxCreationsPerHour ?? null,
      patch.carpoolingEnabled ?? null,
      patch.carpoolingPublicationFee ?? null,
      patch.carpoolingBoostFee ?? null,
      patch.privateDriverEnabled ?? null,
      patch.privateDriverHourlyRateMru ?? null,
      patch.privateDriverMinHours ?? null,
      patch.privateDriverCommissionBps ?? null,
      patch.convoyageEnabled ?? null,
      patch.convoyageBaseFareMru ?? null,
      patch.convoyagePerKmMru ?? null,
      patch.convoyageMinFareMru ?? null,
      patch.convoyageCommissionBps ?? null,
      patch.carRentalEnabled ?? null,
      patch.carRentalDailyRateMru ?? null,
      patch.carRentalCommissionBps ?? null,
      patch.roadsideAssistanceEnabled ?? null,
      patch.roadsideAssistanceBaseFareMru ?? null,
      patch.roadsideAssistanceCommissionBps ?? null,
      patch.lightMovingEnabled ?? null,
      patch.lightMovingBaseFareMru ?? null,
      patch.lightMovingPerKmMru ?? null,
      patch.lightMovingMinFareMru ?? null,
      patch.lightMovingCommissionBps ?? null,
      patch.intercityFreightEnabled ?? null,
      patch.intercityFreightBaseFareMru ?? null,
      patch.intercityFreightPerKmMru ?? null,
      patch.intercityFreightMinFareMru ?? null,
      patch.intercityFreightCommissionBps ?? null,
      patch.equipmentRentalEnabled ?? null,
      patch.equipmentRentalDailyRateMru ?? null,
      patch.equipmentRentalCommissionBps ?? null,
    ],
  );
  cache = null;
  return toSettings(rows[0]!);
}
