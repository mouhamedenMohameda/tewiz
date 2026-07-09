import type pg from 'pg';
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
  driverRatingAvg?: number;
  driverRatingCount?: number;
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
  driver_rating_avg?: string | null;
  driver_rating_count?: number;
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
    driverRatingAvg: row.driver_rating_avg != null ? Number(row.driver_rating_avg) : 0,
    driverRatingCount: row.driver_rating_count ?? 0,
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

    // Publishing is free (totalFee is 0 unless the driver opted into a paid
    // boost). We only touch the wallet when there is actually a fee to charge,
    // so a driver never risks money just to post a trip.
    if (totalFeeMru > 0) {
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
    }

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
  excludeDriverId?: string;
}): Promise<TripListItem[]> {
  const clauses = [`t.status = 'active'`, `t.departure_at > now()`];
  const params: unknown[] = [];

  if (filters.excludeDriverId) {
    params.push(filters.excludeDriverId);
    clauses.push(`t.driver_id <> $${params.length}`);
  }

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
            u.full_name AS driver_name,
            u.carpooling_rating_avg AS driver_rating_avg,
            u.carpooling_rating_count AS driver_rating_count
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

/* ================================================================== */
/*  Bookings — the trust layer                                         */
/*                                                                     */
/*  Every seat request is a row (timestamped receipt). Contact is      */
/*  revealed only once the driver accepts. The trip is closed with an  */
/*  OTP the passenger holds and the driver enters — the proof the ride */
/*  really happened. Commission is charged from the driver wallet only */
/*  on that confirmed completion.                                      */
/* ================================================================== */

export type BookingStatus =
  | 'requested' | 'accepted' | 'declined'
  | 'cancelled' | 'completed' | 'no_show' | 'expired';

export interface BookingView {
  id: string;
  tripId: string;
  status: BookingStatus;
  seats: number;
  fareMru: number;
  commissionMru: number;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  // Trip context
  originCity: string;
  destinationCity: string;
  departureAt: string;
  pricePerSeatMru: number;
  // Counterpart identity
  driverName: string;
  passengerName: string;
  // Revealed only after acceptance, and only to the relevant side
  driverPhone: string | null;
  passengerPhone: string | null;
  otpCode: string | null;
  // Ratings (available once completed). ratedByMe = the viewer already rated
  // the counterpart; counterpart* = the other person's overall reputation.
  ratedByMe: boolean;
  counterpartRatingAvg: number;
  counterpartRatingCount: number;
}

interface BookingRow {
  id: string;
  trip_id: string;
  passenger_id: string;
  seats: number;
  status: BookingStatus;
  otp_code: string | null;
  fare_mru: number;
  commission_mru: number;
  created_at: Date;
  accepted_at: Date | null;
  completed_at: Date | null;
  driver_id: string;
  origin_city: string;
  destination_city: string;
  departure_at: Date;
  price_per_seat_mru: number;
  driver_phone: string;
  driver_name: string | null;
  passenger_name: string | null;
  passenger_phone: string | null;
  driver_rating_avg: string | null;
  driver_rating_count: number;
  passenger_rating_avg: string | null;
  passenger_rating_count: number;
  rated_by_passenger: boolean;
  rated_by_driver: boolean;
}

const BOOKING_SELECT = `
  SELECT b.id, b.trip_id, b.passenger_id, b.seats, b.status, b.otp_code,
         b.fare_mru, b.commission_mru, b.created_at, b.accepted_at, b.completed_at,
         t.driver_id, t.origin_city, t.destination_city, t.departure_at,
         t.price_per_seat_mru, t.driver_phone,
         du.full_name AS driver_name,
         pu.full_name AS passenger_name, pu.phone AS passenger_phone,
         du.carpooling_rating_avg AS driver_rating_avg,
         du.carpooling_rating_count AS driver_rating_count,
         pu.carpooling_rating_avg AS passenger_rating_avg,
         pu.carpooling_rating_count AS passenger_rating_count,
         EXISTS (SELECT 1 FROM carpooling_ratings r
                  WHERE r.booking_id = b.id AND r.role = 'passenger') AS rated_by_passenger,
         EXISTS (SELECT 1 FROM carpooling_ratings r
                  WHERE r.booking_id = b.id AND r.role = 'driver') AS rated_by_driver
    FROM carpooling_bookings b
    JOIN carpooling_trips t ON t.id = b.trip_id
    JOIN users du ON du.id = t.driver_id
    JOIN users pu ON pu.id = b.passenger_id`;

function mapBookingRow(row: BookingRow, viewer: 'driver' | 'passenger'): BookingView {
  const revealed = row.status === 'accepted' || row.status === 'completed';
  return {
    id: row.id,
    tripId: row.trip_id,
    status: row.status,
    seats: row.seats,
    fareMru: row.fare_mru,
    commissionMru: row.commission_mru,
    createdAt: row.created_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    originCity: row.origin_city,
    destinationCity: row.destination_city,
    departureAt: row.departure_at.toISOString(),
    pricePerSeatMru: row.price_per_seat_mru,
    driverName: row.driver_name ?? 'Conducteur',
    passengerName: row.passenger_name ?? 'Passager',
    // Passenger sees the driver phone; driver sees the passenger phone — only
    // once accepted.
    driverPhone: viewer === 'passenger' && revealed ? row.driver_phone : null,
    passengerPhone: viewer === 'driver' && revealed ? row.passenger_phone : null,
    // The passenger holds the code and reads it to the driver at pickup.
    otpCode: viewer === 'passenger' && row.status === 'accepted' ? row.otp_code : null,
    ratedByMe: viewer === 'passenger' ? row.rated_by_passenger : row.rated_by_driver,
    counterpartRatingAvg: Number(
      viewer === 'passenger' ? row.driver_rating_avg : row.passenger_rating_avg,
    ) || 0,
    counterpartRatingCount:
      viewer === 'passenger' ? row.driver_rating_count : row.passenger_rating_count,
  };
}

async function fetchBookingView(
  executor: Pick<pg.PoolClient, 'query'>,
  bookingId: string,
  viewer: 'driver' | 'passenger',
): Promise<BookingView> {
  const { rows } = await executor.query<BookingRow>(
    `${BOOKING_SELECT} WHERE b.id = $1`,
    [bookingId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'booking_not_found', 'Reservation introuvable');
  return mapBookingRow(row, viewer);
}

function genOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function requestBooking(
  passengerId: string,
  tripId: string,
  seats: number,
): Promise<BookingView> {
  const settings = await getPricingSettings();
  if (!settings.carpoolingEnabled) {
    throw new HttpError(403, 'carpooling_disabled', 'Le covoiturage est desactive pour le moment');
  }

  return withTx(async (client) => {
    const tripRes = await client.query<{
      driver_id: string;
      status: string;
      departure_at: Date;
      available_seats: number;
      price_per_seat_mru: number;
      origin_city: string;
      destination_city: string;
    }>(
      `SELECT driver_id, status, departure_at, available_seats,
              price_per_seat_mru, origin_city, destination_city
         FROM carpooling_trips
        WHERE id = $1
        FOR UPDATE`,
      [tripId],
    );
    const trip = tripRes.rows[0];
    if (!trip) throw new HttpError(404, 'trip_not_found', 'Trajet introuvable');
    if (trip.driver_id === passengerId) {
      throw new HttpError(400, 'own_trip', 'Vous ne pouvez pas reserver votre propre trajet');
    }
    if (trip.status !== 'active') {
      throw new HttpError(409, 'trip_not_active', "Ce trajet n'est plus disponible");
    }
    if (trip.departure_at.getTime() < Date.now()) {
      throw new HttpError(409, 'trip_departed', 'Ce trajet est deja parti');
    }
    if (trip.available_seats < seats) {
      throw new HttpError(409, 'not_enough_seats', 'Plus assez de places disponibles');
    }

    // No-show deterrent: block a passenger who piled up no-shows in the last
    // 30 days. Rolling window, so it clears itself. 0 = disabled.
    if (settings.carpoolingNoShowLimit > 0) {
      const ns = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
           FROM carpooling_bookings
          WHERE passenger_id = $1
            AND status = 'no_show'
            AND created_at > now() - interval '30 days'`,
        [passengerId],
      );
      if (Number(ns.rows[0]?.cnt ?? 0) >= settings.carpoolingNoShowLimit) {
        throw new HttpError(
          403,
          'too_many_no_shows',
          "Trop d'absences recentes. Vous ne pouvez pas reserver pour le moment.",
        );
      }
    }

    const fareMru = trip.price_per_seat_mru * seats;
    let bookingId: string;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO carpooling_bookings (trip_id, passenger_id, seats, fare_mru)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [tripId, passengerId, seats, fareMru],
      );
      bookingId = inserted.rows[0]!.id;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(409, 'already_requested', 'Vous avez deja une demande en cours pour ce trajet');
      }
      throw err;
    }

    // Timestamped receipt — the driver can no longer claim "I received nothing".
    void sendNotification({
      target: { type: 'user', userId: trip.driver_id },
      title: 'Nouvelle demande Ervdni',
      body: `Demande de ${seats} place(s) : ${trip.origin_city} -> ${trip.destination_city}.`,
      type: 'info',
      data: { feature: 'carpooling', tripId, bookingId, kind: 'booking_requested' },
      sentBy: null,
    }).catch(() => {});

    return fetchBookingView(client, bookingId, 'passenger');
  });
}

export async function listPassengerBookings(passengerId: string): Promise<BookingView[]> {
  const { rows } = await pool.query<BookingRow>(
    `${BOOKING_SELECT}
      WHERE b.passenger_id = $1
      ORDER BY b.created_at DESC
      LIMIT 100`,
    [passengerId],
  );
  return rows.map((r) => mapBookingRow(r, 'passenger'));
}

export async function listDriverBookings(driverId: string): Promise<BookingView[]> {
  const { rows } = await pool.query<BookingRow>(
    `${BOOKING_SELECT}
      WHERE t.driver_id = $1
      ORDER BY
        CASE b.status WHEN 'requested' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
        b.created_at DESC
      LIMIT 200`,
    [driverId],
  );
  return rows.map((r) => mapBookingRow(r, 'driver'));
}

/** Lock a booking + its trip together, verifying the actor is the driver. */
async function lockDriverBooking(
  client: pg.PoolClient,
  bookingId: string,
  driverId: string,
) {
  const { rows } = await client.query<{
    status: BookingStatus;
    seats: number;
    fare_mru: number;
    otp_code: string | null;
    passenger_id: string;
    trip_id: string;
    driver_id: string;
    trip_status: string;
    available_seats: number;
    origin_city: string;
    destination_city: string;
  }>(
    `SELECT b.status, b.seats, b.fare_mru, b.otp_code, b.passenger_id,
            t.id AS trip_id, t.driver_id, t.status AS trip_status,
            t.available_seats, t.origin_city, t.destination_city
       FROM carpooling_bookings b
       JOIN carpooling_trips t ON t.id = b.trip_id
      WHERE b.id = $1
      FOR UPDATE OF b, t`,
    [bookingId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'booking_not_found', 'Reservation introuvable');
  if (row.driver_id !== driverId) {
    throw new HttpError(403, 'not_your_trip', "Cette reservation ne concerne pas votre trajet");
  }
  return row;
}

export async function acceptBooking(driverId: string, bookingId: string): Promise<BookingView> {
  return withTx(async (client) => {
    const b = await lockDriverBooking(client, bookingId, driverId);
    if (b.status !== 'requested') {
      throw new HttpError(409, 'not_pending', "Cette demande n'est plus en attente");
    }
    if (b.available_seats < b.seats) {
      throw new HttpError(409, 'not_enough_seats', 'Plus assez de places disponibles');
    }

    const otp = genOtp();
    await client.query(
      `UPDATE carpooling_bookings
          SET status = 'accepted', accepted_at = now(), otp_code = $2
        WHERE id = $1`,
      [bookingId, otp],
    );
    await client.query(
      `UPDATE carpooling_trips
          SET available_seats = available_seats - $2,
              status = CASE WHEN available_seats - $2 <= 0 THEN 'full' ELSE status END
        WHERE id = $1`,
      [b.trip_id, b.seats],
    );

    void sendNotification({
      target: { type: 'user', userId: b.passenger_id },
      title: 'Demande acceptee ✅',
      body: `Votre place ${b.origin_city} -> ${b.destination_city} est confirmee. Ouvrez l'app pour le contact et votre code.`,
      type: 'info',
      data: { feature: 'carpooling', tripId: b.trip_id, bookingId, kind: 'booking_accepted' },
      sentBy: null,
    }).catch(() => {});

    return fetchBookingView(client, bookingId, 'driver');
  });
}

export async function declineBooking(driverId: string, bookingId: string): Promise<BookingView> {
  return withTx(async (client) => {
    const b = await lockDriverBooking(client, bookingId, driverId);
    if (b.status !== 'requested') {
      throw new HttpError(409, 'not_pending', "Cette demande n'est plus en attente");
    }
    await client.query(
      `UPDATE carpooling_bookings
          SET status = 'declined', declined_at = now()
        WHERE id = $1`,
      [bookingId],
    );
    void sendNotification({
      target: { type: 'user', userId: b.passenger_id },
      title: 'Demande refusee',
      body: `Votre demande ${b.origin_city} -> ${b.destination_city} a ete refusee.`,
      type: 'info',
      data: { feature: 'carpooling', tripId: b.trip_id, bookingId, kind: 'booking_declined' },
      sentBy: null,
    }).catch(() => {});
    return fetchBookingView(client, bookingId, 'driver');
  });
}

export async function completeBooking(
  driverId: string,
  bookingId: string,
  otp: string,
): Promise<BookingView> {
  const settings = await getPricingSettings();
  return withTx(async (client) => {
    const b = await lockDriverBooking(client, bookingId, driverId);
    if (b.status !== 'accepted') {
      throw new HttpError(409, 'not_accepted', "Cette reservation n'est pas en cours");
    }
    if (!b.otp_code || b.otp_code !== otp.trim()) {
      throw new HttpError(400, 'invalid_otp', 'Code de confirmation incorrect');
    }

    const commissionMru = Math.round((b.fare_mru * settings.carpoolingCommissionBps) / 10_000);
    if (commissionMru > 0) {
      // Wallet may go negative to the soft floor; we never block a confirmed
      // ride on balance.
      await debitWallet({
        captainId: driverId,
        amountMru: commissionMru,
        type: 'carpooling_commission',
        reason: `Commission Ervdni ${b.origin_city} -> ${b.destination_city}`,
        createdBy: driverId,
      }, client);
    }

    await client.query(
      `UPDATE carpooling_bookings
          SET status = 'completed', completed_at = now(), commission_mru = $2
        WHERE id = $1`,
      [bookingId, commissionMru],
    );

    void sendNotification({
      target: { type: 'user', userId: b.passenger_id },
      title: 'Trajet confirme',
      body: `Votre trajet ${b.origin_city} -> ${b.destination_city} est termine. Merci !`,
      type: 'info',
      data: { feature: 'carpooling', tripId: b.trip_id, bookingId, kind: 'booking_completed' },
      sentBy: null,
    }).catch(() => {});

    return fetchBookingView(client, bookingId, 'driver');
  });
}

export async function markBookingNoShow(driverId: string, bookingId: string): Promise<BookingView> {
  return withTx(async (client) => {
    const b = await lockDriverBooking(client, bookingId, driverId);
    if (b.status !== 'accepted') {
      throw new HttpError(409, 'not_accepted', "Cette reservation n'est pas en cours");
    }
    await client.query(
      `UPDATE carpooling_bookings
          SET status = 'no_show'
        WHERE id = $1`,
      [bookingId],
    );
    // Release the held seat back to the trip.
    await client.query(
      `UPDATE carpooling_trips
          SET available_seats = LEAST(available_seats + $2, total_seats),
              status = CASE WHEN status = 'full' THEN 'active' ELSE status END
        WHERE id = $1`,
      [b.trip_id, b.seats],
    );
    void sendNotification({
      target: { type: 'user', userId: b.passenger_id },
      title: 'Trajet marque absent',
      body: `Le conducteur a signale votre absence pour ${b.origin_city} -> ${b.destination_city}. Les absences repetees peuvent bloquer vos reservations.`,
      type: 'info',
      data: { feature: 'carpooling', tripId: b.trip_id, bookingId, kind: 'booking_no_show' },
      sentBy: null,
    }).catch(() => {});
    return fetchBookingView(client, bookingId, 'driver');
  });
}

export async function cancelBooking(userId: string, bookingId: string): Promise<BookingView> {
  return withTx(async (client) => {
    const { rows } = await client.query<{
      status: BookingStatus;
      seats: number;
      passenger_id: string;
      trip_id: string;
      driver_id: string;
      origin_city: string;
      destination_city: string;
    }>(
      `SELECT b.status, b.seats, b.passenger_id,
              t.id AS trip_id, t.driver_id, t.origin_city, t.destination_city
         FROM carpooling_bookings b
         JOIN carpooling_trips t ON t.id = b.trip_id
        WHERE b.id = $1
        FOR UPDATE OF b, t`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) throw new HttpError(404, 'booking_not_found', 'Reservation introuvable');

    const isPassenger = b.passenger_id === userId;
    const isDriver = b.driver_id === userId;
    if (!isPassenger && !isDriver) {
      throw new HttpError(403, 'not_your_booking', "Cette reservation ne vous concerne pas");
    }
    if (b.status !== 'requested' && b.status !== 'accepted') {
      throw new HttpError(409, 'not_cancellable', "Cette reservation ne peut plus etre annulee");
    }

    const wasAccepted = b.status === 'accepted';
    const by = isPassenger ? 'passenger' : 'driver';
    await client.query(
      `UPDATE carpooling_bookings
          SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2
        WHERE id = $1`,
      [bookingId, by],
    );
    if (wasAccepted) {
      // Give the seat back.
      await client.query(
        `UPDATE carpooling_trips
            SET available_seats = LEAST(available_seats + $2, total_seats),
                status = CASE WHEN status = 'full' THEN 'active' ELSE status END
          WHERE id = $1`,
        [b.trip_id, b.seats],
      );
    }

    const notifyUserId = isPassenger ? b.driver_id : b.passenger_id;
    void sendNotification({
      target: { type: 'user', userId: notifyUserId },
      title: 'Reservation annulee',
      body: `Une reservation ${b.origin_city} -> ${b.destination_city} a ete annulee.`,
      type: 'info',
      data: { feature: 'carpooling', tripId: b.trip_id, bookingId, kind: 'booking_cancelled' },
      sentBy: null,
    }).catch(() => {});

    return fetchBookingView(client, bookingId, isPassenger ? 'passenger' : 'driver');
  });
}

export async function rateBooking(
  userId: string,
  bookingId: string,
  stars: number,
  comment: string | null,
): Promise<BookingView> {
  return withTx(async (client) => {
    const { rows } = await client.query<{
      status: BookingStatus;
      passenger_id: string;
      driver_id: string;
    }>(
      `SELECT b.status, b.passenger_id, t.driver_id
         FROM carpooling_bookings b
         JOIN carpooling_trips t ON t.id = b.trip_id
        WHERE b.id = $1
        FOR UPDATE OF b`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) throw new HttpError(404, 'booking_not_found', 'Reservation introuvable');
    if (b.status !== 'completed') {
      throw new HttpError(409, 'not_completed', 'Vous ne pouvez noter qu\'un trajet termine');
    }

    let role: 'passenger' | 'driver';
    let rateeId: string;
    if (userId === b.passenger_id) {
      role = 'passenger';
      rateeId = b.driver_id;
    } else if (userId === b.driver_id) {
      role = 'driver';
      rateeId = b.passenger_id;
    } else {
      throw new HttpError(403, 'not_your_booking', 'Cette reservation ne vous concerne pas');
    }

    try {
      await client.query(
        `INSERT INTO carpooling_ratings (booking_id, rater_id, ratee_id, role, stars, comment)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bookingId, userId, rateeId, role, stars, comment],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(409, 'already_rated', 'Vous avez deja note ce trajet');
      }
      throw err;
    }

    // Recompute the ratee's reputation from all their carpooling ratings.
    await client.query(
      `UPDATE users u
          SET carpooling_rating_count = agg.cnt,
              carpooling_rating_avg   = agg.avg
         FROM (
           SELECT COUNT(*)::int AS cnt,
                  COALESCE(ROUND(AVG(stars), 2), 0) AS avg
             FROM carpooling_ratings
            WHERE ratee_id = $1
         ) agg
        WHERE u.id = $1`,
      [rateeId],
    );

    return fetchBookingView(client, bookingId, role);
  });
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
