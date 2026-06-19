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
  defaultCommissionBps: number;
  colisCommissionBps: number;
  updatedAt: string;
  updatedBy: string | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { value: PricingSettings; loadedAt: number } | null = null;

interface Row {
  base_fare_mru: number;
  per_km_mru: number;
  min_fare_mru: number;
  default_commission_bps: number;
  colis_commission_bps: number;
  updated_at: Date;
  updated_by: string | null;
}

function toSettings(r: Row): PricingSettings {
  return {
    baseFareMru: r.base_fare_mru,
    perKmMru: r.per_km_mru,
    minFareMru: r.min_fare_mru,
    defaultCommissionBps: r.default_commission_bps,
    colisCommissionBps: r.colis_commission_bps,
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
            default_commission_bps, colis_commission_bps,
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
  defaultCommissionBps?: number;
  colisCommissionBps?: number;
}

export async function updatePricingSettings(
  adminId: string,
  patch: PricingSettingsPatch,
): Promise<PricingSettings> {
  const { rows } = await pool.query<Row>(
    `UPDATE app_settings
        SET base_fare_mru           = COALESCE($1, base_fare_mru),
            per_km_mru              = COALESCE($2, per_km_mru),
            min_fare_mru            = COALESCE($3, min_fare_mru),
            default_commission_bps  = COALESCE($4, default_commission_bps),
            colis_commission_bps    = COALESCE($5, colis_commission_bps),
            updated_at              = now(),
            updated_by              = $6
      WHERE id = 1
      RETURNING base_fare_mru, per_km_mru, min_fare_mru,
                default_commission_bps, colis_commission_bps,
                updated_at, updated_by`,
    [
      patch.baseFareMru ?? null,
      patch.perKmMru ?? null,
      patch.minFareMru ?? null,
      patch.defaultCommissionBps ?? null,
      patch.colisCommissionBps ?? null,
      adminId,
    ],
  );
  cache = null;
  return toSettings(rows[0]!);
}
