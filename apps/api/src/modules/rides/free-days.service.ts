/**
 * Captain "free days" — the runtime side of migration 0086.
 *
 * Rule (admin-tunable via app_settings):
 *   - Every ISO week each captain gets `free_days_per_week` randomly-drawn
 *     days on which their commission is 0 — they keep the whole fare.
 *   - The draw is server-side and applied at ride completion, so a captain
 *     running an old build gets the waiver exactly like everyone else. The
 *     mobile app never decides anything here.
 *
 * The draw obeys two constraints, in priority order:
 *   1. NO REPEAT week-over-week — a weekday that was free for this captain
 *      last week is not eligible this week, so the perk stays unpredictable
 *      and nobody can plan their heavy days around it.
 *   2. LOAD SPREADING — among the eligible days, prefer those with the fewest
 *      captains already assigned in that same week, so the whole fleet never
 *      ends up free on the same day (which would wipe out a full day of
 *      commission at once). Ties are broken randomly.
 * Each constraint is relaxed, in that order, only when honouring it would
 * make the draw impossible.
 *
 * A week is drawn once and never re-rolled: the (captain_id, free_date)
 * primary key makes every insert idempotent, so a replayed cron pass or two
 * concurrent ride completions can't hand out extra days.
 *
 * Disabling the feature stops the waiver immediately (unlike the commission
 * bonus, which is honoured until expiry) — it is the admin's kill switch.
 *
 * MANUAL GRANTS (source = 'admin')
 *   A day given by hand from the admin panel is a GIFT ON TOP of the weekly
 *   quota, not a substitute for it: only `source = 'auto'` rows count against
 *   `free_days_per_week`, so gifting Thursday doesn't quietly cancel the day
 *   the captain was going to be drawn anyway. That's what an admin clicking
 *   "offrir un jour" means. Manual days do still feed the two draw
 *   constraints — they occupy their date for the fleet-spreading count, and
 *   they block their weekday from repeating next week — because from the
 *   captain's side a free day is a free day, whoever granted it.
 *   Consequently `free_days_per_week = 0` pauses the automatic draw while
 *   manual grants keep working.
 *
 * Mauritania is UTC+0 year-round, so UTC dates are local calendar days.
 */

import type { PoolClient } from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { notifyCaptainFreeDays } from '../notifications/notifications.service.js';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for a Date, in UTC. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's local (= UTC) calendar day as `YYYY-MM-DD`. */
export function today(): string {
  return toIsoDate(new Date());
}

/** Monday of the ISO week containing `isoDate`, as `YYYY-MM-DD`. */
export function weekStartOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  // getUTCDay(): 0 = Sunday … 6 = Saturday. Shift so Monday is 0.
  const offset = (d.getUTCDay() + 6) % 7;
  return toIsoDate(new Date(d.getTime() - offset * DAY_MS));
}

/** The seven dates of the week starting at `weekStart`. */
function datesOfWeek(weekStart: string): string[] {
  const base = new Date(`${weekStart}T00:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, i) => toIsoDate(new Date(base + i * DAY_MS)));
}

/** 0 = Monday … 6 = Sunday. */
function weekdayIndex(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function shiftWeek(weekStart: string, weeks: number): string {
  return toIsoDate(new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + weeks * 7 * DAY_MS));
}

/** Fisher–Yates, so equal-load candidates are picked with no positional bias. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Where a free day came from. See MANUAL GRANTS in the header. */
export type FreeDaySource = 'auto' | 'admin';

export interface FreeDayRow {
  date: string;
  source: FreeDaySource;
}

async function selectWeek(
  client: PoolClient,
  captainId: string,
  weekStart: string,
): Promise<FreeDayRow[]> {
  const { rows } = await client.query<{ free_date: Date; source: FreeDaySource }>(
    `SELECT free_date, source FROM captain_free_days
      WHERE captain_id = $1 AND week_start = $2::date
      ORDER BY free_date`,
    [captainId, weekStart],
  );
  return rows.map((r) => ({ date: toIsoDate(r.free_date), source: r.source }));
}

/** Only auto-drawn days count against `free_days_per_week`. */
function autoCount(rows: FreeDayRow[]): number {
  return rows.filter((r) => r.source === 'auto').length;
}

export interface WeekDraw {
  /** Every free day this captain holds for the week, auto and manual alike. */
  days: string[];
  /** Only the days inserted by this call — what a notification should announce. */
  newDays: string[];
}

/**
 * Draw (or top up) a captain's free days for one week. Idempotent.
 *
 * `notBefore` clamps the draw to days that haven't happened yet: a captain
 * whose week is drawn lazily on Thursday can only win Thursday→Sunday, since
 * a free Monday that already passed would be worth nothing to them.
 *
 * Must run inside a transaction — it takes a transaction-scoped advisory lock
 * on (captain, week) so two concurrent completions can't both draw.
 */
export async function drawWeek(
  client: PoolClient,
  captainId: string,
  weekStart: string,
  perWeek: number,
  notBefore: string,
): Promise<WeekDraw> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `captain_free_days:${captainId}:${weekStart}`,
  ]);

  // Re-read under the lock: another completion may have drawn while we waited.
  const existing = await selectWeek(client, captainId, weekStart);
  const heldDates = existing.map((r) => r.date);
  // Manual gifts don't eat into the quota — only auto-drawn days do.
  const need = perWeek - autoCount(existing);
  if (need <= 0) return { days: heldDates, newDays: [] };

  const held = new Set(heldDates);
  const candidates = datesOfWeek(weekStart).filter((d) => d >= notBefore && !held.has(d));
  if (candidates.length === 0) return { days: heldDates, newDays: [] };

  // Constraint 1 — weekdays that were free last week are not eligible,
  // whoever granted them.
  const lastWeek = await selectWeek(client, captainId, shiftWeek(weekStart, -1));
  const usedWeekdays = new Set(lastWeek.map((r) => weekdayIndex(r.date)));

  // Constraint 2 — how many captains are already free on each day this week.
  const { rows: loadRows } = await client.query<{ free_date: Date; n: string }>(
    `SELECT free_date, COUNT(*) AS n FROM captain_free_days
      WHERE week_start = $1::date
      GROUP BY free_date`,
    [weekStart],
  );
  const load = new Map(loadRows.map((r) => [toIsoDate(r.free_date), Number(r.n)]));

  // Shuffle first, then sort by load: Array.prototype.sort is stable, so equal
  // loads keep their shuffled (i.e. random) order.
  const byLoad = (days: string[]) =>
    shuffle(days).sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0));

  const eligible = candidates.filter((d) => !usedWeekdays.has(weekdayIndex(d)));
  const relaxed = candidates.filter((d) => usedWeekdays.has(weekdayIndex(d)));
  // `relaxed` only ever gets used when the no-repeat rule alone can't fill the
  // quota (short week after a lazy draw, or per_week close to 7).
  const picked = [...byLoad(eligible), ...byLoad(relaxed)].slice(0, need);
  if (picked.length === 0) return { days: heldDates, newDays: [] };

  const { rows: inserted } = await client.query<{ free_date: Date }>(
    `INSERT INTO captain_free_days (captain_id, free_date, week_start, source)
     SELECT $1::uuid, d::date, $2::date, 'auto' FROM unnest($3::date[]) AS d
     ON CONFLICT (captain_id, free_date) DO NOTHING
     RETURNING free_date`,
    [captainId, weekStart, picked],
  );
  const newDays = inserted.map((r) => toIsoDate(r.free_date));
  return { days: [...heldDates, ...newDays].sort(), newDays };
}

export interface FreeDayResolution {
  /** True when today is a free day → commission must be waived. */
  isFreeToday: boolean;
  /** Days drawn by this very call, for a best-effort "heads up" push. */
  newlyDrawn: string[];
}

/**
 * Decide whether the ride being completed right now falls on a free day,
 * drawing the captain's week on the fly if the weekly job hasn't run.
 *
 * Call inside the completion transaction, before the wallet debit.
 */
export async function resolveFreeDayOnCompletion(
  client: PoolClient,
  captainId: string,
): Promise<FreeDayResolution> {
  const settings = await getPricingSettings();
  if (!settings.freeDaysEnabled) return { isFreeToday: false, newlyDrawn: [] };

  const day = today();
  const weekStart = weekStartOf(day);

  const held = await selectWeek(client, captainId, weekStart);
  let days = held.map((r) => r.date);
  let newlyDrawn: string[] = [];
  if (autoCount(held) < settings.freeDaysPerWeek) {
    const draw = await drawWeek(client, captainId, weekStart, settings.freeDaysPerWeek, day);
    days = draw.days;
    newlyDrawn = draw.newDays;
  }

  return { isFreeToday: days.includes(day), newlyDrawn };
}

/**
 * Weekly job — draw the current week for every active captain up front, so
 * captains learn their free days on Monday morning instead of discovering
 * them when a ride happens to complete. Idempotent: safe to run daily, and
 * safe to replay.
 *
 * Suggested schedule: every day at 00:05 Africa/Nouakchott (a daily run also
 * covers captains activated mid-week).
 */
export async function drawFreeDaysForAllCaptains(): Promise<{
  enabled: boolean;
  weekStart: string;
  captainsProcessed: number;
  daysDrawn: number;
  drawn: { captainId: string; days: string[] }[];
}> {
  const settings = await getPricingSettings();
  const day = today();
  const weekStart = weekStartOf(day);
  if (!settings.freeDaysEnabled || settings.freeDaysPerWeek <= 0) {
    return { enabled: false, weekStart, captainsProcessed: 0, daysDrawn: 0, drawn: [] };
  }

  const { rows: captains } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM captains WHERE status = 'active'`,
  );

  const drawn: { captainId: string; days: string[] }[] = [];
  let daysDrawn = 0;
  for (const { user_id: captainId } of captains) {
    // One transaction per captain: the advisory lock is held for the length of
    // a single draw instead of the whole fleet sweep.
    const draw = await withTx((client) =>
      drawWeek(client, captainId, weekStart, settings.freeDaysPerWeek, day),
    );
    if (draw.newDays.length > 0) {
      daysDrawn += draw.newDays.length;
      drawn.push({ captainId, days: draw.newDays });
      // Push, not just an inbox row: captains on an old build have no screen
      // for this, and the notification is how they learn about the perk.
      // Awaited so a fleet-wide sweep doesn't open hundreds of parallel sends.
      await notifyCaptainFreeDays(captainId, draw.newDays);
    }
  }

  return {
    enabled: true,
    weekStart,
    captainsProcessed: captains.length,
    daysDrawn,
    drawn,
  };
}

export interface CaptainFreeDaysView {
  enabled: boolean;
  perWeek: number;
  weekStart: string;
  today: string;
  /** True when the captain pays no commission on rides completed right now. */
  isFreeToday: boolean;
  /** This week's free days, past ones included. */
  days: string[];
  /** The next free day from today on, or null once the week is spent. */
  nextFreeDay: string | null;
}

/**
 * Read-only view for the captain app (and the admin captain detail page).
 * Never draws — a captain opening the screen shouldn't trigger a draw for a
 * week they may not work in.
 */
export async function getCaptainFreeDays(captainId: string): Promise<CaptainFreeDaysView> {
  const settings = await getPricingSettings();
  const day = today();
  const weekStart = weekStartOf(day);
  const { rows } = await pool.query<{ free_date: Date }>(
    `SELECT free_date FROM captain_free_days
      WHERE captain_id = $1 AND week_start = $2::date
      ORDER BY free_date`,
    [captainId, weekStart],
  );
  const days = rows.map((r) => toIsoDate(r.free_date));
  // Manual gifts are days like any other from the captain's point of view, so
  // the app shows them alongside the drawn ones without distinction.
  return {
    enabled: settings.freeDaysEnabled,
    perWeek: settings.freeDaysPerWeek,
    weekStart,
    today: day,
    isFreeToday: settings.freeDaysEnabled && days.includes(day),
    days,
    nextFreeDay: settings.freeDaysEnabled ? days.find((d) => d >= day) ?? null : null,
  };
}

// ── Manual grants (admin panel) ──────────────────────────────────────────────

/** How far ahead an admin may gift a day. Keeps typos out of 2087. */
const GRANT_HORIZON_DAYS = 90;

export interface AdminFreeDay {
  date: string;
  source: FreeDaySource;
  createdAt: string;
  /** False once the day has passed — the UI greys it out instead of hiding it. */
  upcoming: boolean;
}

/**
 * Every free day a captain holds from today up to the grant horizon, for the
 * admin captain card. Past days are deliberately excluded: the card is a
 * "what does this captain still have coming" view, not an audit trail (the
 * audit log and `rides.commission_free_day` cover history).
 */
export async function listCaptainFreeDaysForAdmin(captainId: string): Promise<{
  captainId: string;
  enabled: boolean;
  perWeek: number;
  today: string;
  days: AdminFreeDay[];
}> {
  const settings = await getPricingSettings();
  const day = today();
  const { rows } = await pool.query<{ free_date: Date; source: FreeDaySource; created_at: Date }>(
    `SELECT free_date, source, created_at FROM captain_free_days
      WHERE captain_id = $1 AND free_date >= $2::date
      ORDER BY free_date`,
    [captainId, day],
  );
  return {
    captainId,
    enabled: settings.freeDaysEnabled,
    perWeek: settings.freeDaysPerWeek,
    today: day,
    days: rows.map((r) => ({
      date: toIsoDate(r.free_date),
      source: r.source,
      createdAt: r.created_at.toISOString(),
      upcoming: toIsoDate(r.free_date) >= day,
    })),
  };
}

export class FreeDayGrantError extends Error {}

/**
 * Gift one commission-free day to a captain (source = 'admin').
 *
 * Rejects past dates — a day that is already over can't be made free
 * retroactively, and silently accepting one would let an admin believe they
 * compensated a captain when they didn't. Idempotent on a day the captain
 * already holds: `granted` comes back false and nothing changes, including an
 * auto-drawn day, which is never rewritten as a manual one.
 */
export async function grantFreeDay(
  captainId: string,
  date: string,
): Promise<{ granted: boolean; date: string; alreadyHeld: FreeDaySource | null }> {
  const day = today();
  if (date < day) {
    throw new FreeDayGrantError('Impossible d’offrir une journée déjà passée.');
  }
  if (date > toIsoDate(new Date(Date.now() + GRANT_HORIZON_DAYS * DAY_MS))) {
    throw new FreeDayGrantError(`La date doit être dans les ${GRANT_HORIZON_DAYS} prochains jours.`);
  }

  return withTx(async (client) => {
    const { rows: captain } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM captains WHERE user_id = $1`,
      [captainId],
    );
    if (captain.length === 0) throw new FreeDayGrantError('Captain introuvable.');

    const { rows: inserted } = await client.query<{ free_date: Date }>(
      `INSERT INTO captain_free_days (captain_id, free_date, week_start, source)
       VALUES ($1::uuid, $2::date, $3::date, 'admin')
       ON CONFLICT (captain_id, free_date) DO NOTHING
       RETURNING free_date`,
      [captainId, date, weekStartOf(date)],
    );
    if (inserted.length > 0) return { granted: true, date, alreadyHeld: null };

    const { rows: existing } = await client.query<{ source: FreeDaySource }>(
      `SELECT source FROM captain_free_days WHERE captain_id = $1 AND free_date = $2::date`,
      [captainId, date],
    );
    return { granted: false, date, alreadyHeld: existing[0]?.source ?? null };
  });
}

/**
 * Take back a free day the captain hasn't used yet.
 *
 * Only future days: today is already in progress, and rides completed under
 * the waiver were debited 0 — removing the row wouldn't claw that back, it
 * would just make the ledger disagree with the ride's `commission_free_day`
 * flag. Auto-drawn days can be revoked too (an admin fixing a bad week), but
 * the week is NOT re-rolled — the captain simply has one day fewer.
 */
export async function revokeFreeDay(
  captainId: string,
  date: string,
): Promise<{ revoked: boolean; date: string }> {
  if (date <= today()) {
    throw new FreeDayGrantError(
      'Une journée en cours ou passée ne peut plus être retirée.',
    );
  }
  const { rowCount } = await pool.query(
    `DELETE FROM captain_free_days WHERE captain_id = $1 AND free_date = $2::date`,
    [captainId, date],
  );
  return { revoked: (rowCount ?? 0) > 0, date };
}
