import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { debitWallet } from '../wallet/wallet.service.js';
import { sendNotification } from '../notifications/notifications.service.js';

export interface PublishTripInput {
  originCity: string;
  destinationCity: string;
  departureAt: string;
  totalSeats: number;
  pricePerSeatMru: number;
  driverPhone?: string;
  notes?: string;
  boost?: boolean;
}

export interface TripListItem {
  id: string;
  originCity: string;
  destinationCity: string;
  departureAt: string;
  totalSeats: number;
  availableSeats: number;
  pricePerSeatMru: number;
  notes: string | null;
  isBoosted: boolean;
  boostedUntil: string | null;
  driverName: string;
}

export interface TripDetail extends TripListItem {
  driverId: string;
  driverPhone?: string;
  publicationFeeMru: number;
  boostFeeMru: number;
  viewsCount: number;
  status: 'active' | 'full' | 'expired' | 'cancelled';
  createdAt: string;
}

interface TripRow {
  id: string;
  driver_id: string;
  origin_city: string;
  destination_city: string;
  departure_at: Date;
  total_seats: number;
  available_seats: number;
  price_per_seat_mru: number;
  driver_phone: string;
  notes: string | null;
  publication_fee_mru: number;
  boost_fee_mru: number;
  is_boosted: boolean;
  boosted_until: Date | null;
  views_count: number;
  status: 'active' | 'full' | 'expired' | 'cancelled';
  created_at: Date;
  driver_name: string | null;
}

function toTripDetail(row: TripRow): TripDetail {
  return {
    id: row.id,
    driverId: row.driver_id,
    originCity: row.origin_city,
    destinationCity: row.destination_city,
    departureAt: row.departure_at.toISOString(),
    totalSeats: row.total_seats,
    availableSeats: row.available_seats,
    pricePerSeatMru: row.price_per_seat_mru,
    notes: row.notes,
    isBoosted: row.is_boosted,
    boostedUntil: row.boosted_until?.toISOString() ?? null,
    driverName: row.driver_name ?? 'Conducteur',
    publicationFeeMru: row.publication_fee_mru,
    boostFeeMru: row.boost_fee_mru,
    viewsCount: row.views_count,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

function toTripListItem(row: TripRow): TripListItem {
  const detail = toTripDetail(row);
  return {
    id: detail.id,
    originCity: detail.originCity,
    destinationCity: detail.destinationCity,
    departureAt: detail.departureAt,
    totalSeats: detail.totalSeats,
    availableSeats: detail.availableSeats,
    pricePerSeatMru: detail.pricePerSeatMru,
    notes: detail.notes,
    isBoosted: detail.isBoosted,
    boostedUntil: detail.boostedUntil,
    driverName: detail.driverName,
  };
}

function normalizeCity(city: string): string {
  return city.trim().replace(/\s+/g, ' ');
}

export async function publishTrip(driverId: string, input: PublishTripInput): Promise<TripDetail> {
  const settings = await getPricingSettings();
  if (!settings.carpoolingEnabled) {
    throw new HttpError(403, 'carpooling_disabled', 'Le covoiturage est desactive pour le moment');
  }

  const departureDate = new Date(input.departureAt);
  if (Number.isNaN(departureDate.getTime())) {
    throw new HttpError(400, 'invalid_departure', 'Date de depart invalide');
  }
  if (departureDate.getTime() < Date.now() + 30 * 60 * 1000) {
    throw new HttpError(400, 'departure_too_soon', 'Le depart doit etre dans au moins 30 minutes');
  }

  const boost = input.boost === true;
  const publicationFeeMru = settings.carpoolingPublicationFee;
  const boostFeeMru = boost ? settings.carpoolingBoostFee : 0;
  const totalFeeMru = publicationFeeMru + boostFeeMru;

  return withTx(async (client) => {
    const userRes = await client.query<{
      role: 'admin' | 'rider' | 'captain';
      phone: string | null;
      full_name: string | null;
    }>(
      `SELECT role, phone, full_name FROM users WHERE id = $1`,
      [driverId],
    );
    const user = userRes.rows[0];
    if (!user) {
      throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
    }
    if (user.role !== 'captain') {
      throw new HttpError(403, 'captain_only', 'Seuls les chauffeurs peuvent publier un trajet');
    }

    const phone = input.driverPhone?.trim() || user.phone;
    if (!phone) {
      throw new HttpError(400, 'driver_phone_required', 'Numero de telephone conducteur requis');
    }

    const walletRes = await client.query<{ balance_mru: string }>(
      `SELECT balance_mru FROM wallets WHERE captain_id = $1 FOR UPDATE`,
      [driverId],
    );
    const balanceMru = Number(walletRes.rows[0]?.balance_mru ?? '0');
    if (balanceMru < totalFeeMru) {
      throw new HttpError(402, 'insufficient_wallet', 'Solde insuffisant');
    }

    await debitWallet({
      captainId: driverId,
      amountMru: totalFeeMru,
      type: 'carpooling_publication',
      reason: boost ? 'Publication covoiturage + boost' : 'Publication covoiturage',
      createdBy: driverId,
    }, client);

    const inserted = await client.query<TripRow>(
      `INSERT INTO carpooling_trips (
          driver_id, origin_city, destination_city, departure_at,
          total_seats, available_seats, price_per_seat_mru,
          driver_phone, notes, publication_fee_mru, boost_fee_mru,
          is_boosted, boosted_until
       )
       VALUES (
          $1, $2, $3, $4,
          $5, $5, $6,
          $7, $8, $9, $10,
          $11, CASE WHEN $11 THEN now() + interval '24 hours' ELSE NULL END
       )
       RETURNING id, driver_id, origin_city, destination_city, departure_at,
                 total_seats, available_seats, price_per_seat_mru,
                 driver_phone, notes, publication_fee_mru, boost_fee_mru,
                 is_boosted, boosted_until, views_count, status, created_at,
                 $12::text AS driver_name`,
      [
        driverId,
        normalizeCity(input.originCity),
        normalizeCity(input.destinationCity),
        departureDate.toISOString(),
        input.totalSeats,
        input.pricePerSeatMru,
        phone,
        input.notes?.trim() || null,
        totalFeeMru,
        boostFeeMru,
        boost,
        user.full_name,
      ],
    );

    return toTripDetail(inserted.rows[0]!);
  });
}

export async function listTrips(filters: {
  origin?: string;
  destination?: string;
  date?: string;
}): Promise<TripListItem[]> {
  const clauses = [`t.status = 'active'`, `t.departure_at > now()`];
  const params: unknown[] = [];

  if (filters.origin?.trim()) {
    params.push(`%${filters.origin.trim()}%`);
    clauses.push(`t.origin_city ILIKE $${params.length}`);
  }
  if (filters.destination?.trim()) {
    params.push(`%${filters.destination.trim()}%`);
    clauses.push(`t.destination_city ILIKE $${params.length}`);
  }
  if (filters.date) {
    params.push(filters.date);
    clauses.push(`t.departure_at::date = $${params.length}::date`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query<TripRow>(
    `SELECT t.id, t.driver_id, t.origin_city, t.destination_city, t.departure_at,
            t.total_seats, t.available_seats, t.price_per_seat_mru, t.driver_phone,
            t.notes, t.publication_fee_mru, t.boost_fee_mru, t.is_boosted,
            t.boosted_until, t.views_count, t.status, t.created_at,
            u.full_name AS driver_name
       FROM carpooling_trips t
       JOIN users u ON u.id = t.driver_id
       ${where}
      ORDER BY
        (t.is_boosted = true AND (t.boosted_until IS NULL OR t.boosted_until > now())) DESC,
        t.boosted_until DESC NULLS LAST,
        t.departure_at ASC`,
    params,
  );
  return rows.map(toTripListItem);
}

export async function getTripById(tripId: string): Promise<TripDetail | null> {
  const { rows } = await pool.query<TripRow>(
    `SELECT t.id, t.driver_id, t.origin_city, t.destination_city, t.departure_at,
            t.total_seats, t.available_seats, t.price_per_seat_mru, t.driver_phone,
            t.notes, t.publication_fee_mru, t.boost_fee_mru, t.is_boosted,
            t.boosted_until, t.views_count, t.status, t.created_at,
            u.full_name AS driver_name
       FROM carpooling_trips t
       JOIN users u ON u.id = t.driver_id
      WHERE t.id = $1`,
    [tripId],
  );
  return rows[0] ? toTripDetail(rows[0]) : null;
}

export async function revealDriverContact(tripId: string, viewerId: string): Promise<{
  driverPhone: string;
  driverName: string;
}> {
  const { rows } = await pool.query<{
    driver_id: string;
    driver_phone: string;
    driver_name: string | null;
    origin_city: string;
    destination_city: string;
  }>(
    `UPDATE carpooling_trips t
        SET views_count = views_count + 1
       FROM users u
      WHERE t.id = $1
        AND t.driver_id = u.id
      RETURNING t.driver_id, t.driver_phone, u.full_name AS driver_name,
                t.origin_city, t.destination_city`,
    [tripId],
  );
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, 'trip_not_found', 'Trajet introuvable');
  }

  if (viewerId !== row.driver_id) {
    void sendNotification({
      target: { type: 'user', userId: row.driver_id },
      title: 'Nouveau contact covoiturage',
      body: `Quelqu'un s'interesse a votre trajet ${row.origin_city} -> ${row.destination_city}.`,
      type: 'info',
      data: { feature: 'carpooling', tripId },
      sentBy: null,
    }).catch(() => {});
  }

  return {
    driverPhone: row.driver_phone,
    driverName: row.driver_name ?? 'Conducteur',
  };
}

export async function updateTripSeats(
  tripId: string,
  driverId: string,
  availableSeats: number,
): Promise<TripDetail> {
  const { rows } = await pool.query<TripRow>(
    `UPDATE carpooling_trips t
        SET available_seats = $3,
            status = CASE
              WHEN status = 'cancelled' THEN 'cancelled'
              WHEN status = 'expired' THEN 'expired'
              WHEN $3 = 0 THEN 'full'
              ELSE 'active'
            END
       FROM users u
      WHERE t.id = $1
        AND t.driver_id = $2
        AND t.driver_id = u.id
        AND $3 >= 0
        AND $3 <= t.total_seats
      RETURNING t.id, t.driver_id, t.origin_city, t.destination_city, t.departure_at,
                t.total_seats, t.available_seats, t.price_per_seat_mru, t.driver_phone,
                t.notes, t.publication_fee_mru, t.boost_fee_mru, t.is_boosted,
                t.boosted_until, t.views_count, t.status, t.created_at,
                u.full_name AS driver_name`,
    [tripId, driverId, availableSeats],
  );

  if (!rows[0]) {
    throw new HttpError(404, 'trip_not_found', 'Trajet introuvable ou mise a jour invalide');
  }
  return toTripDetail(rows[0]);
}

export async function listMyTrips(driverId: string): Promise<TripDetail[]> {
  const { rows } = await pool.query<TripRow>(
    `SELECT t.id, t.driver_id, t.origin_city, t.destination_city, t.departure_at,
            t.total_seats, t.available_seats, t.price_per_seat_mru, t.driver_phone,
            t.notes, t.publication_fee_mru, t.boost_fee_mru, t.is_boosted,
            t.boosted_until, t.views_count, t.status, t.created_at,
            u.full_name AS driver_name
       FROM carpooling_trips t
       JOIN users u ON u.id = t.driver_id
      WHERE t.driver_id = $1
      ORDER BY t.created_at DESC`,
    [driverId],
  );
  return rows.map(toTripDetail);
}

export async function cancelMyTrip(tripId: string, driverId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE carpooling_trips
        SET status = 'cancelled'
      WHERE id = $1 AND driver_id = $2 AND status <> 'cancelled'`,
    [tripId, driverId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listAdminTrips(limit = 500): Promise<Array<TripDetail & { driverPhone: string }>> {
  const { rows } = await pool.query<TripRow>(
    `SELECT t.id, t.driver_id, t.origin_city, t.destination_city, t.departure_at,
            t.total_seats, t.available_seats, t.price_per_seat_mru, t.driver_phone,
            t.notes, t.publication_fee_mru, t.boost_fee_mru, t.is_boosted,
            t.boosted_until, t.views_count, t.status, t.created_at,
            u.full_name AS driver_name
       FROM carpooling_trips t
       JOIN users u ON u.id = t.driver_id
      ORDER BY t.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({ ...toTripDetail(row), driverPhone: row.driver_phone }));
}

export async function getAdminStats(): Promise<{
  totalTrips: number;
  totalRevenueMru: number;
  totalBoostRevenueMru: number;
  avgViews: number;
}> {
  const { rows } = await pool.query<{
    total_trips: string;
    total_revenue_mru: string;
    total_boost_revenue_mru: string;
    avg_views: string;
  }>(
    `SELECT COUNT(*)::text AS total_trips,
            COALESCE(SUM(publication_fee_mru), 0)::text AS total_revenue_mru,
            COALESCE(SUM(boost_fee_mru), 0)::text AS total_boost_revenue_mru,
            COALESCE(AVG(views_count), 0)::text AS avg_views
       FROM carpooling_trips`,
  );
  const row = rows[0];
  return {
    totalTrips: Number(row?.total_trips ?? 0),
    totalRevenueMru: Number(row?.total_revenue_mru ?? 0),
    totalBoostRevenueMru: Number(row?.total_boost_revenue_mru ?? 0),
    avgViews: Number(row?.avg_views ?? 0),
  };
}

export async function expireTrips(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE carpooling_trips
        SET status = 'expired'
      WHERE status IN ('active', 'full')
        AND departure_at < now() - interval '1 hour'`,
  );
  return rowCount ?? 0;
}

export async function sendDepartureReminders(): Promise<number> {
  const { rows } = await pool.query<{
    id: string;
    driver_id: string;
    origin_city: string;
    destination_city: string;
    views_count: number;
  }>(
    `SELECT id, driver_id, origin_city, destination_city, views_count
       FROM carpooling_trips
      WHERE status IN ('active', 'full')
        AND reminder_sent_at IS NULL
        AND departure_at BETWEEN now() + interval '1 hour 45 minutes'
                            AND now() + interval '2 hours 15 minutes'
      ORDER BY departure_at ASC
      LIMIT 500`,
  );

  if (rows.length === 0) return 0;

  for (const row of rows) {
    void sendNotification({
      target: { type: 'user', userId: row.driver_id },
      title: 'Rappel covoiturage',
      body: `Votre trajet ${row.origin_city} -> ${row.destination_city} part dans environ 2h. ${row.views_count} personne(s) ont vu votre numero.`,
      type: 'info',
      data: { feature: 'carpooling', tripId: row.id },
      sentBy: null,
    }).catch(() => {});
  }

  const ids = rows.map((r) => r.id);
  await pool.query(
    `UPDATE carpooling_trips
        SET reminder_sent_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );

  return ids.length;
}

const CRON_INTERVAL_MS = 60 * 60 * 1000;

export function startCarpoolingCron() {
  const tick = async () => {
    try {
      const expired = await expireTrips();
      const reminded = await sendDepartureReminders();
      if (expired > 0 || reminded > 0) {
        // eslint-disable-next-line no-console
        console.log(`[carpooling] expired=${expired}, reminded=${reminded}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[carpooling] cron tick failed', err);
    }
  };

  setTimeout(tick, 20_000);
  setInterval(tick, CRON_INTERVAL_MS).unref();
}
