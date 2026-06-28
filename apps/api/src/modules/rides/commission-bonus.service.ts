/**
 * Captain commission bonus — the runtime side of migration 0028.
 *
 * Rule (admin-tunable via app_settings):
 *   - When a captain accumulates `threshold_mru` of commission paid within
 *     `window_days`, their commission is halved (÷2) for `reward_days`.
 *   - During the active bonus the counter is FROZEN — no accumulation. At
 *     bonus expiry the counter resets to 0; the next commission paid opens
 *     a fresh Y-day window.
 *   - If the Y-day window elapses without reaching the threshold, counter
 *     and window also reset.
 *   - Disabling the feature does NOT terminate an already-active bonus.
 *
 * Called from `completeRide()` inside the same transaction so the wallet
 * debit and the bonus state update are atomic.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

export interface BonusApplication {
  /** Effective commission MRU to debit (halved if bonus active). */
  effectiveCommissionMru: number;
  /** True when the bonus was applied on this ride. */
  bonusApplied: boolean;
  /** True when this ride pushed the captain over the threshold. */
  bonusJustEarned: boolean;
  /** When the captain's bonus expires (unchanged if no bonus active). */
  bonusUntil: Date | null;
}

interface CaptainRow {
  commission_counter_mru: number;
  commission_window_started_at: Date | null;
  commission_bonus_until: Date | null;
}

/**
 * Apply the bonus rule on a freshly-completed ride. Returns the effective
 * commission that should actually be debited, and updates `captains` state.
 *
 * Always call inside the same transaction as the wallet debit.
 */
export async function applyBonusOnCompletion(
  client: PoolClient,
  captainId: string,
  baseCommissionMru: number,
): Promise<BonusApplication> {
  // Lock the captain row to serialize concurrent completions for the same
  // captain (rare but possible if two callbacks fire close together).
  const { rows } = await client.query<CaptainRow>(
    `SELECT commission_counter_mru, commission_window_started_at, commission_bonus_until
       FROM captains
      WHERE user_id = $1
      FOR UPDATE`,
    [captainId],
  );
  const captain = rows[0];
  if (!captain) {
    // Defensive: ride was assigned to a non-captain somehow. Bail out
    // gracefully — caller will debit the base commission.
    return {
      effectiveCommissionMru: baseCommissionMru,
      bonusApplied: false,
      bonusJustEarned: false,
      bonusUntil: null,
    };
  }

  const now = new Date();
  const settings = await getPricingSettings();

  // ── 1. Bonus currently active → halve commission, freeze counter ──────────
  // We honor an in-flight bonus even if the admin has since disabled the
  // feature; captains keep what they earned until expiry.
  if (captain.commission_bonus_until && captain.commission_bonus_until > now) {
    const halved = Math.floor(baseCommissionMru / 2);
    return {
      effectiveCommissionMru: halved,
      bonusApplied: true,
      bonusJustEarned: false,
      bonusUntil: captain.commission_bonus_until,
    };
  }

  // ── 2. Feature disabled → never accumulate, never reward ──────────────────
  if (!settings.commissionBonusEnabled) {
    return {
      effectiveCommissionMru: baseCommissionMru,
      bonusApplied: false,
      bonusJustEarned: false,
      bonusUntil: null,
    };
  }

  // ── 3. Bonus not active → accumulate ──────────────────────────────────────
  const windowMs = settings.commissionBonusWindowDays * 24 * 60 * 60 * 1000;
  const windowExpired =
    captain.commission_window_started_at !== null &&
    now.getTime() - captain.commission_window_started_at.getTime() > windowMs;

  // Reset counter if window expired (or if a previous bonus just ended, in
  // which case window_started_at was cleared and the next ride opens a fresh
  // window — see WHERE clause below).
  let newCounter = windowExpired ? baseCommissionMru : captain.commission_counter_mru + baseCommissionMru;
  let newWindowStart: Date | null = windowExpired || !captain.commission_window_started_at
    ? now
    : captain.commission_window_started_at;
  let newBonusUntil: Date | null = null;
  let justEarned = false;

  // ── 4. Threshold reached → activate the bonus ─────────────────────────────
  if (newCounter >= settings.commissionBonusThresholdMru) {
    newBonusUntil = new Date(now.getTime() + settings.commissionBonusRewardDays * 24 * 60 * 60 * 1000);
    newCounter = 0;
    newWindowStart = null; // re-opens on the first ride after bonus ends
    justEarned = true;
  }

  await client.query(
    `UPDATE captains
        SET commission_counter_mru       = $2,
            commission_window_started_at = $3,
            commission_bonus_until       = $4
      WHERE user_id = $1`,
    [captainId, newCounter, newWindowStart, newBonusUntil],
  );

  return {
    effectiveCommissionMru: baseCommissionMru,
    bonusApplied: false,
    bonusJustEarned: justEarned,
    bonusUntil: newBonusUntil,
  };
}

export interface CaptainBonusProgress {
  enabled: boolean;
  thresholdMru: number;
  windowDays: number;
  rewardDays: number;
  counterMru: number;
  windowStartedAt: string | null;
  windowEndsAt: string | null;
  bonusActive: boolean;
  bonusUntil: string | null;
}

/**
 * Read-only view of where a captain stands in the bonus cycle. Powers the
 * captain mobile progress card and the admin captain-detail page.
 */
export async function getCaptainBonusProgress(captainId: string): Promise<CaptainBonusProgress> {
  const settings = await getPricingSettings();
  const { rows } = await pool.query<CaptainRow>(
    `SELECT commission_counter_mru, commission_window_started_at, commission_bonus_until
       FROM captains WHERE user_id = $1`,
    [captainId],
  );
  const c = rows[0] ?? {
    commission_counter_mru: 0,
    commission_window_started_at: null,
    commission_bonus_until: null,
  };
  const now = Date.now();
  const bonusActive = !!c.commission_bonus_until && c.commission_bonus_until.getTime() > now;
  const windowEnds = c.commission_window_started_at
    ? new Date(c.commission_window_started_at.getTime() + settings.commissionBonusWindowDays * 86_400_000)
    : null;
  return {
    enabled: settings.commissionBonusEnabled,
    thresholdMru: settings.commissionBonusThresholdMru,
    windowDays: settings.commissionBonusWindowDays,
    rewardDays: settings.commissionBonusRewardDays,
    counterMru: c.commission_counter_mru,
    windowStartedAt: c.commission_window_started_at?.toISOString() ?? null,
    windowEndsAt: windowEnds?.toISOString() ?? null,
    bonusActive,
    bonusUntil: c.commission_bonus_until?.toISOString() ?? null,
  };
}
