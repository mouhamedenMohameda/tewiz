import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { debitWallet } from '../wallet/wallet.service.js';
import { sendNotification } from '../notifications/notifications.service.js';

/**
 * Car rental ("Location Auto") — a dedicated catalog + date-based booking
 * module with the same trust engine as Ervdni (carpooling), extended for a
 * high-value object that physically leaves AND comes back.
 *
 * Listing stays free. Each booking is a timestamped receipt. Contact is
 * revealed only after acceptance. Two OTP checkpoints prove the car really
 * left (pickup) and really came back (return); the success commission is
 * charged from the owner wallet only on the confirmed return. Deposit is
 * tracked (cash, hand to hand — the app records the agreement, never holds the
 * money), état-des-lieux photos give objective damage evidence, and a bilateral
 * rating + no-show/no-return deterrent disciplines both sides.
 */

export type Transmission = 'auto' | 'manual';
export type CarStatus = 'active' | 'paused' | 'removed';
export type BookingStatus =
  | 'pending' | 'confirmed' | 'declined' | 'cancelled'
  | 'in_progress' | 'completed' | 'no_show' | 'no_return' | 'disputed';

export interface CarInput {
  title: string;
  brandModel?: string;
  year?: number;
  city: string;
  pricePerDayMru: number;
  depositMru?: number;
  withDriver?: boolean;
  driverDayRateMru?: number;
  transmission?: Transmission;
  seats?: number;
  description?: string;
  photos?: string[];
}

export interface CarListItem {
  id: string;
  title: string;
  brandModel: string | null;
  year: number | null;
  city: string;
  pricePerDayMru: number;
  depositMru: number;
  withDriver: boolean;
  driverDayRateMru: number | null;
  transmission: Transmission | null;
  seats: number | null;
  photos: string[];
  ownerName: string;
  ownerRating: number | null;
  ownerRatingCount: number;
}

export interface CarDetail extends CarListItem {
  description: string | null;
  status: CarStatus;
}

interface CarRow {
  id: string;
  owner_id: string;
  title: string;
  brand_model: string | null;
  year: number | null;
  city: string;
  price_per_day_mru: number;
  deposit_mru: number;
  with_driver: boolean;
  driver_day_rate_mru: number | null;
  transmission: Transmission | null;
  seats: number | null;
  description: string | null;
  photos: string[];
  status: CarStatus;
  owner_name: string | null;
  owner_rating: string | null;
  owner_rating_count: number | null;
}

const CAR_SELECT = `
  c.id, c.owner_id, c.title, c.brand_model, c.year, c.city, c.price_per_day_mru,
  c.deposit_mru, c.with_driver, c.driver_day_rate_mru, c.transmission, c.seats,
  c.description, c.photos, c.status,
  u.full_name AS owner_name,
  u.car_rental_rating_avg AS owner_rating,
  u.car_rental_rating_count AS owner_rating_count`;
const CAR_JOINS = `
  JOIN users u ON u.id = c.owner_id`;

function toDetail(r: CarRow): CarDetail {
  return {
    id: r.id,
    title: r.title,
    brandModel: r.brand_model,
    year: r.year,
    city: r.city,
    pricePerDayMru: r.price_per_day_mru,
    depositMru: r.deposit_mru,
    withDriver: r.with_driver,
    driverDayRateMru: r.driver_day_rate_mru,
    transmission: r.transmission,
    seats: r.seats,
    photos: r.photos,
    ownerName: r.owner_name ?? 'Propriétaire',
    ownerRating: r.owner_rating != null ? Number(r.owner_rating) : null,
    ownerRatingCount: r.owner_rating_count ?? 0,
    description: r.description,
    status: r.status,
  };
}

function toListItem(r: CarRow): CarListItem {
  const d = toDetail(r);
  const { description: _d, status: _s, ...item } = d;
  return item;
}

function dayCount(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e)) {
    throw new HttpError(400, 'invalid_dates', 'Dates invalides');
  }
  return Math.floor((e - s) / 86_400_000) + 1; // inclusive
}

function genOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// --- Owner: manage cars ---

export async function createCar(ownerId: string, input: CarInput): Promise<CarDetail> {
  if (input.withDriver && (input.driverDayRateMru == null || input.driverDayRateMru < 0)) {
    throw new HttpError(400, 'driver_rate_required', 'Indiquez le tarif chauffeur/jour');
  }
  const { rows } = await pool.query<CarRow>(
    `WITH ins AS (
       INSERT INTO car_listings (
         owner_id, title, brand_model, year, city, price_per_day_mru, deposit_mru,
         with_driver, driver_day_rate_mru, transmission, seats, description, photos
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *
     )
     SELECT ${CAR_SELECT} FROM ins c ${CAR_JOINS}`,
    [
      ownerId, input.title.trim(), input.brandModel?.trim() || null, input.year ?? null,
      input.city.trim(), input.pricePerDayMru, input.depositMru ?? 0,
      input.withDriver ?? false, input.withDriver ? input.driverDayRateMru : null,
      input.transmission ?? null, input.seats ?? null, input.description?.trim() || null,
      input.photos ?? [],
    ],
  );
  return toDetail(rows[0]!);
}

export async function updateCar(id: string, ownerId: string, patch: Partial<CarInput> & { status?: CarStatus }): Promise<CarDetail> {
  const { rows } = await pool.query<CarRow>(
    `WITH upd AS (
       UPDATE car_listings SET
         title = COALESCE($3, title),
         brand_model = COALESCE($4, brand_model),
         year = COALESCE($5, year),
         city = COALESCE($6, city),
         price_per_day_mru = COALESCE($7, price_per_day_mru),
         deposit_mru = COALESCE($8, deposit_mru),
         with_driver = COALESCE($9, with_driver),
         driver_day_rate_mru = COALESCE($10, driver_day_rate_mru),
         transmission = COALESCE($11, transmission),
         seats = COALESCE($12, seats),
         description = COALESCE($13, description),
         photos = COALESCE($14, photos),
         status = COALESCE($15, status),
         updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND status <> 'removed'
       RETURNING *
     )
     SELECT ${CAR_SELECT} FROM upd c ${CAR_JOINS}`,
    [
      id, ownerId, patch.title ?? null, patch.brandModel ?? null, patch.year ?? null,
      patch.city ?? null, patch.pricePerDayMru ?? null, patch.depositMru ?? null,
      patch.withDriver ?? null, patch.driverDayRateMru ?? null, patch.transmission ?? null,
      patch.seats ?? null, patch.description ?? null, patch.photos ?? null, patch.status ?? null,
    ],
  );
  if (!rows[0]) throw new HttpError(404, 'car_not_found', 'Voiture introuvable');
  return toDetail(rows[0]);
}

export async function listMyCars(ownerId: string): Promise<CarDetail[]> {
  const { rows } = await pool.query<CarRow>(
    `SELECT ${CAR_SELECT} FROM car_listings c ${CAR_JOINS}
      WHERE c.owner_id = $1 AND c.status <> 'removed'
      ORDER BY c.created_at DESC`,
    [ownerId],
  );
  return rows.map(toDetail);
}

// --- Renter: browse + book ---

export async function browseCars(filters: {
  city?: string; maxPricePerDay?: number; withDriver?: boolean; search?: string;
  excludeOwnerId?: string;
}): Promise<CarListItem[]> {
  const clauses = [`c.status = 'active'`];
  const params: unknown[] = [];
  if (filters.city?.trim()) { params.push(`%${filters.city.trim()}%`); clauses.push(`c.city ILIKE $${params.length}`); }
  if (filters.maxPricePerDay != null) { params.push(filters.maxPricePerDay); clauses.push(`c.price_per_day_mru <= $${params.length}`); }
  if (filters.withDriver != null) { params.push(filters.withDriver); clauses.push(`c.with_driver = $${params.length}`); }
  if (filters.search?.trim()) { params.push(`%${filters.search.trim()}%`); clauses.push(`(c.title ILIKE $${params.length} OR c.brand_model ILIKE $${params.length})`); }
  if (filters.excludeOwnerId) { params.push(filters.excludeOwnerId); clauses.push(`c.owner_id <> $${params.length}`); }

  const { rows } = await pool.query<CarRow>(
    `SELECT ${CAR_SELECT} FROM car_listings c ${CAR_JOINS}
      WHERE ${clauses.join(' AND ')}
      ORDER BY c.created_at DESC
      LIMIT 100`,
    params,
  );
  return rows.map(toListItem);
}

export async function getCarDetail(id: string): Promise<CarDetail | null> {
  const { rows } = await pool.query<CarRow>(
    `SELECT ${CAR_SELECT} FROM car_listings c ${CAR_JOINS} WHERE c.id = $1`,
    [id],
  );
  return rows[0] ? toDetail(rows[0]) : null;
}

export interface BookingInput {
  listingId: string;
  startDate: string;
  endDate: string;
  withDriver?: boolean;
}

/* ================================================================== */
/*  Bookings — the trust layer                                         */
/*                                                                     */
/*  demande -> acceptée -> voiture remise (OTP remise) -> en cours     */
/*          -> voiture rendue (OTP retour) -> terminée -> notation      */
/* ================================================================== */

interface BaseBookingDTO {
  id: string;
  carTitle: string;
  carPhoto: string | null;
  city: string;
  startDate: string;
  endDate: string;
  days: number;
  withDriver: boolean;
  totalMru: number;
  status: BookingStatus;
  depositMru: number;
  depositTaken: boolean;
  depositReturned: boolean;
  commissionMru: number;
  pickupPhotos: string[];
  returnPhotos: string[];
  pickedUpAt: string | null;
  returnedAt: string | null;
  createdAt: string;
  // Rating: ratedByMe = the viewer already rated the counterpart;
  // counterpart* = the other person's overall car-rental reputation.
  ratedByMe: boolean;
  counterpartRatingAvg: number;
  counterpartRatingCount: number;
}

export interface RenterBookingDTO extends BaseBookingDTO {
  ownerName: string;
  ownerPhone: string | null;
  // The renter holds the pickup code and reads it to the owner at handover.
  pickupOtp: string | null;
}

export interface OwnerBookingDTO extends BaseBookingDTO {
  renterName: string;
  renterPhone: string | null;
  // The owner holds the return code and reads it to the renter at return.
  returnOtp: string | null;
}

interface BookingRow {
  id: string;
  listing_id: string;
  renter_id: string;
  owner_id: string;
  start_date: Date;
  end_date: Date;
  days: number;
  with_driver: boolean;
  total_mru: number;
  status: BookingStatus;
  pickup_otp: string | null;
  return_otp: string | null;
  commission_mru: number;
  deposit_mru: number;
  deposit_taken: boolean;
  deposit_returned: boolean;
  pickup_photos: string[];
  return_photos: string[];
  picked_up_at: Date | null;
  returned_at: Date | null;
  created_at: Date;
  car_title: string;
  city: string;
  photos: string[];
  owner_name: string | null;
  owner_phone: string | null;
  owner_rating_avg: string | null;
  owner_rating_count: number;
  renter_name: string | null;
  renter_phone: string | null;
  renter_rating_avg: string | null;
  renter_rating_count: number;
  rated_by_renter: boolean;
  rated_by_owner: boolean;
}

// Phones are revealed to the counterpart only during the active window
// (accepted through the rental). The pickup OTP is shown to the renter while
// the booking is confirmed; the return OTP to the owner while in progress.
const BOOKING_SELECT = `
  SELECT b.id, b.listing_id, b.renter_id, c.owner_id,
         b.start_date, b.end_date, b.days, b.with_driver, b.total_mru, b.status,
         b.pickup_otp, b.return_otp, b.commission_mru,
         b.deposit_mru, b.deposit_taken, b.deposit_returned,
         b.pickup_photos, b.return_photos, b.picked_up_at, b.returned_at, b.created_at,
         c.title AS car_title, c.city, c.photos,
         ou.full_name AS owner_name, ou.phone AS owner_phone,
         ou.car_rental_rating_avg AS owner_rating_avg,
         ou.car_rental_rating_count AS owner_rating_count,
         ru.full_name AS renter_name, ru.phone AS renter_phone,
         ru.car_rental_rating_avg AS renter_rating_avg,
         ru.car_rental_rating_count AS renter_rating_count,
         EXISTS (SELECT 1 FROM car_rental_ratings r
                  WHERE r.booking_id = b.id AND r.role = 'renter') AS rated_by_renter,
         EXISTS (SELECT 1 FROM car_rental_ratings r
                  WHERE r.booking_id = b.id AND r.role = 'owner') AS rated_by_owner
    FROM car_bookings b
    JOIN car_listings c ON c.id = b.listing_id
    JOIN users ou ON ou.id = c.owner_id
    JOIN users ru ON ru.id = b.renter_id`;

const REVEALED: BookingStatus[] = ['confirmed', 'in_progress'];

function toBase(r: BookingRow, counterpart: 'owner' | 'renter'): BaseBookingDTO {
  return {
    id: r.id,
    carTitle: r.car_title,
    carPhoto: r.photos[0] ?? null,
    city: r.city,
    startDate: r.start_date.toISOString().slice(0, 10),
    endDate: r.end_date.toISOString().slice(0, 10),
    days: r.days,
    withDriver: r.with_driver,
    totalMru: r.total_mru,
    status: r.status,
    depositMru: r.deposit_mru,
    depositTaken: r.deposit_taken,
    depositReturned: r.deposit_returned,
    commissionMru: r.commission_mru,
    pickupPhotos: r.pickup_photos,
    returnPhotos: r.return_photos,
    pickedUpAt: r.picked_up_at?.toISOString() ?? null,
    returnedAt: r.returned_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    ratedByMe: counterpart === 'owner' ? r.rated_by_renter : r.rated_by_owner,
    counterpartRatingAvg: Number(
      counterpart === 'owner' ? r.owner_rating_avg : r.renter_rating_avg,
    ) || 0,
    counterpartRatingCount:
      counterpart === 'owner' ? r.owner_rating_count : r.renter_rating_count,
  };
}

function toRenterBooking(r: BookingRow): RenterBookingDTO {
  const revealed = REVEALED.includes(r.status);
  return {
    ...toBase(r, 'owner'),
    ownerName: r.owner_name ?? 'Propriétaire',
    ownerPhone: revealed ? r.owner_phone : null,
    pickupOtp: r.status === 'confirmed' ? r.pickup_otp : null,
  };
}

function toOwnerBooking(r: BookingRow): OwnerBookingDTO {
  const revealed = REVEALED.includes(r.status);
  return {
    ...toBase(r, 'renter'),
    renterName: r.renter_name ?? 'Client',
    renterPhone: revealed ? r.renter_phone : null,
    returnOtp: r.status === 'in_progress' ? r.return_otp : null,
  };
}

async function renterBookingView(
  executor: Pick<pg.PoolClient, 'query'>,
  bookingId: string,
): Promise<RenterBookingDTO> {
  const { rows } = await executor.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [bookingId]);
  if (!rows[0]) throw new HttpError(404, 'booking_not_found', 'Réservation introuvable');
  return toRenterBooking(rows[0]);
}

async function ownerBookingView(
  executor: Pick<pg.PoolClient, 'query'>,
  bookingId: string,
): Promise<OwnerBookingDTO> {
  const { rows } = await executor.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [bookingId]);
  if (!rows[0]) throw new HttpError(404, 'booking_not_found', 'Réservation introuvable');
  return toOwnerBooking(rows[0]);
}

export async function requestBooking(renterId: string, input: BookingInput): Promise<RenterBookingDTO> {
  const days = dayCount(input.startDate, input.endDate);
  const settings = await getPricingSettings();

  return withTx(async (client) => {
    const car = await client.query<{
      owner_id: string; status: CarStatus; price_per_day_mru: number;
      with_driver: boolean; driver_day_rate_mru: number | null; deposit_mru: number;
    }>(
      `SELECT owner_id, status, price_per_day_mru, with_driver, driver_day_rate_mru, deposit_mru
         FROM car_listings WHERE id = $1`,
      [input.listingId],
    );
    const c = car.rows[0];
    if (!c || c.status !== 'active') throw new HttpError(404, 'car_unavailable', 'Voiture indisponible');
    if (c.owner_id === renterId) throw new HttpError(400, 'own_car', 'Vous ne pouvez pas réserver votre propre voiture');
    const withDriver = input.withDriver === true;
    if (withDriver && !c.with_driver) throw new HttpError(400, 'no_driver', 'Cette voiture est sans chauffeur');

    // No-show / no-return deterrent: block a renter who piled up absences or
    // non-returns in the last 30 days. Rolling window, so it clears itself.
    if (settings.carRentalNoShowLimit > 0) {
      const ns = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
           FROM car_bookings
          WHERE renter_id = $1
            AND status IN ('no_show', 'no_return')
            AND created_at > now() - interval '30 days'`,
        [renterId],
      );
      if (Number(ns.rows[0]?.cnt ?? 0) >= settings.carRentalNoShowLimit) {
        throw new HttpError(
          403,
          'too_many_no_shows',
          "Trop d'absences récentes. Vous ne pouvez pas réserver pour le moment.",
        );
      }
    }

    const total = days * c.price_per_day_mru + (withDriver ? days * (c.driver_day_rate_mru ?? 0) : 0);

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO car_bookings (listing_id, renter_id, start_date, end_date, days, with_driver, total_mru, deposit_mru)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.listingId, renterId, input.startDate, input.endDate, days, withDriver, total, c.deposit_mru],
    );

    // Timestamped receipt — the owner can no longer claim "I received nothing".
    void sendNotification({
      target: { type: 'user', userId: c.owner_id },
      title: 'Nouvelle demande de location',
      body: `Une demande de réservation (${days} jour${days > 1 ? 's' : ''}) attend votre confirmation.`,
      type: 'info',
      data: { feature: 'car_rental', bookingId: rows[0]!.id, kind: 'booking_requested' },
      sentBy: null,
    }).catch(() => {});

    return renterBookingView(client, rows[0]!.id);
  });
}

export async function getMyBookings(renterId: string): Promise<RenterBookingDTO[]> {
  const { rows } = await pool.query<BookingRow>(
    `${BOOKING_SELECT} WHERE b.renter_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
    [renterId],
  );
  return rows.map(toRenterBooking);
}

export async function cancelBooking(id: string, renterId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE car_bookings SET status = 'cancelled', cancelled_by = 'renter'
      WHERE id = $1 AND renter_id = $2 AND status IN ('pending','confirmed')`,
    [id, renterId],
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Owner: booking requests ---

export async function listIncomingBookings(ownerId: string): Promise<OwnerBookingDTO[]> {
  const { rows } = await pool.query<BookingRow>(
    `${BOOKING_SELECT}
      WHERE c.owner_id = $1
      ORDER BY
        CASE b.status
          WHEN 'pending' THEN 0
          WHEN 'confirmed' THEN 1
          WHEN 'in_progress' THEN 2
          ELSE 3
        END,
        b.created_at DESC
      LIMIT 200`,
    [ownerId],
  );
  return rows.map(toOwnerBooking);
}

/** Lock a booking + its listing together, verifying the actor owns the car. */
async function lockOwnerBooking(client: pg.PoolClient, bookingId: string, ownerId: string) {
  const { rows } = await client.query<{
    status: BookingStatus;
    renter_id: string;
    owner_id: string;
    listing_id: string;
    start_date: Date;
    end_date: Date;
    pickup_otp: string | null;
    return_otp: string | null;
    total_mru: number;
  }>(
    `SELECT b.status, b.renter_id, c.owner_id, b.listing_id, b.start_date, b.end_date,
            b.pickup_otp, b.return_otp, b.total_mru
       FROM car_bookings b
       JOIN car_listings c ON c.id = b.listing_id
      WHERE b.id = $1
      FOR UPDATE OF b`,
    [bookingId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'booking_not_found', 'Demande introuvable');
  if (row.owner_id !== ownerId) {
    throw new HttpError(403, 'not_your_car', 'Cette réservation ne concerne pas votre voiture');
  }
  return row;
}

export async function respondBooking(id: string, ownerId: string, action: 'confirm' | 'decline'): Promise<OwnerBookingDTO> {
  return withTx(async (client) => {
    const row = await lockOwnerBooking(client, id, ownerId);
    if (row.status !== 'pending') {
      throw new HttpError(409, 'not_pending', 'Cette demande a déjà été traitée');
    }

    if (action === 'confirm') {
      const clash = await client.query(
        `SELECT 1 FROM car_bookings
          WHERE listing_id = $1 AND status IN ('confirmed','in_progress') AND id <> $2
            AND daterange(start_date, end_date, '[]') && daterange($3, $4, '[]')
          LIMIT 1
          FOR UPDATE`,
        [row.listing_id, id, row.start_date, row.end_date],
      );
      if (clash.rows[0]) throw new HttpError(409, 'dates_taken', 'Ces dates sont déjà réservées');

      // Pickup OTP is minted now; the renter holds it and reads it to the owner
      // at handover (owner enters it -> in_progress).
      await client.query(
        `UPDATE car_bookings SET status = 'confirmed', responded_at = now(), pickup_otp = $2 WHERE id = $1`,
        [id, genOtp()],
      );
    } else {
      await client.query(
        `UPDATE car_bookings SET status = 'declined', responded_at = now() WHERE id = $1`,
        [id],
      );
    }

    void sendNotification({
      target: { type: 'user', userId: row.renter_id },
      title: action === 'confirm' ? 'Réservation confirmée ✅' : 'Réservation refusée',
      body: action === 'confirm'
        ? 'Le propriétaire a confirmé. Ouvrez « Mes réservations » pour son numéro et votre code de remise.'
        : "Le propriétaire n'a pas pu confirmer votre demande.",
      type: 'info',
      data: { feature: 'car_rental', bookingId: id, kind: action === 'confirm' ? 'booking_confirmed' : 'booking_declined' },
      sentBy: null,
    }).catch(() => {});

    return ownerBookingView(client, id);
  });
}

/** Owner enters the renter's pickup code -> the car is handed over. */
export async function pickupBooking(
  ownerId: string,
  bookingId: string,
  otp: string,
  photos: string[],
): Promise<OwnerBookingDTO> {
  return withTx(async (client) => {
    const b = await lockOwnerBooking(client, bookingId, ownerId);
    if (b.status !== 'confirmed') {
      throw new HttpError(409, 'not_confirmed', "Cette réservation n'est pas confirmée");
    }
    if (!b.pickup_otp || b.pickup_otp !== otp.trim()) {
      throw new HttpError(400, 'invalid_otp', 'Code de remise incorrect');
    }

    // Deposit is handed to the owner in cash now (the app only records the
    // agreement). The return OTP is minted for the end of the rental.
    await client.query(
      `UPDATE car_bookings
          SET status = 'in_progress', picked_up_at = now(),
              deposit_taken = true, pickup_photos = $2, return_otp = $3
        WHERE id = $1`,
      [bookingId, photos, genOtp()],
    );

    void sendNotification({
      target: { type: 'user', userId: b.renter_id },
      title: 'Location démarrée 🚗',
      body: 'Le propriétaire a validé la remise du véhicule. Bon trajet !',
      type: 'info',
      data: { feature: 'car_rental', bookingId, kind: 'booking_picked_up' },
      sentBy: null,
    }).catch(() => {});

    return ownerBookingView(client, bookingId);
  });
}

/** Charge the success commission from the owner wallet. Owners who aren't
 * captains have no wallet — we can't charge them via the captain ledger, so we
 * record 0 and let the return complete anyway. */
async function chargeOwnerCommission(
  client: pg.PoolClient,
  ownerId: string,
  fareMru: number,
  commissionBps: number,
): Promise<number> {
  const commissionMru = Math.round((fareMru * commissionBps) / 10_000);
  if (commissionMru <= 0) return 0;
  try {
    await debitWallet({
      captainId: ownerId,
      amountMru: commissionMru,
      type: 'car_rental_commission',
      reason: 'Commission location auto',
      createdBy: ownerId,
    }, client);
    return commissionMru;
  } catch (err) {
    if ((err as { code?: string }).code === 'no_wallet') return 0;
    throw err;
  }
}

/** Renter enters the owner's return code -> the car is back, commission charged. */
export async function returnBooking(
  renterId: string,
  bookingId: string,
  otp: string,
  photos: string[],
): Promise<RenterBookingDTO> {
  const settings = await getPricingSettings();
  return withTx(async (client) => {
    const { rows } = await client.query<{
      status: BookingStatus; renter_id: string; owner_id: string;
      return_otp: string | null; total_mru: number;
    }>(
      `SELECT b.status, b.renter_id, c.owner_id, b.return_otp, b.total_mru
         FROM car_bookings b JOIN car_listings c ON c.id = b.listing_id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) throw new HttpError(404, 'booking_not_found', 'Réservation introuvable');
    if (b.renter_id !== renterId) throw new HttpError(403, 'not_your_booking', 'Cette réservation ne vous concerne pas');
    if (b.status !== 'in_progress') throw new HttpError(409, 'not_in_progress', "Cette location n'est pas en cours");
    if (!b.return_otp || b.return_otp !== otp.trim()) {
      throw new HttpError(400, 'invalid_otp', 'Code de retour incorrect');
    }

    const commissionMru = await chargeOwnerCommission(client, b.owner_id, b.total_mru, settings.carRentalCommissionBps);

    await client.query(
      `UPDATE car_bookings
          SET status = 'completed', returned_at = now(),
              commission_mru = $2,
              return_photos = array_cat(return_photos, $3::text[])
        WHERE id = $1`,
      [bookingId, commissionMru, photos],
    );

    void sendNotification({
      target: { type: 'user', userId: b.owner_id },
      title: 'Voiture rendue ✅',
      body: "Le locataire a validé le retour. Pensez à restituer la caution s'il n'y a pas de dégât.",
      type: 'info',
      data: { feature: 'car_rental', bookingId, kind: 'booking_completed' },
      sentBy: null,
    }).catch(() => {});

    return renterBookingView(client, bookingId);
  });
}

/** Owner attaches return-state photos and marks the deposit given back. */
export async function confirmReturn(
  ownerId: string,
  bookingId: string,
  photos: string[],
): Promise<OwnerBookingDTO> {
  return withTx(async (client) => {
    const b = await lockOwnerBooking(client, bookingId, ownerId);
    if (b.status !== 'completed') {
      throw new HttpError(409, 'not_completed', "Cette location n'est pas terminée");
    }
    await client.query(
      `UPDATE car_bookings
          SET deposit_returned = true,
              return_photos = array_cat(return_photos, $2::text[])
        WHERE id = $1`,
      [bookingId, photos],
    );
    void sendNotification({
      target: { type: 'user', userId: b.renter_id },
      title: 'Caution restituée',
      body: 'Le propriétaire a confirmé la restitution de la caution.',
      type: 'info',
      data: { feature: 'car_rental', bookingId, kind: 'deposit_returned' },
      sentBy: null,
    }).catch(() => {});
    return ownerBookingView(client, bookingId);
  });
}

/** Renter never showed for the handover. */
export async function markNoShow(ownerId: string, bookingId: string): Promise<OwnerBookingDTO> {
  return withTx(async (client) => {
    const b = await lockOwnerBooking(client, bookingId, ownerId);
    if (b.status !== 'confirmed') {
      throw new HttpError(409, 'not_confirmed', "Cette réservation n'est pas confirmée");
    }
    await client.query(`UPDATE car_bookings SET status = 'no_show' WHERE id = $1`, [bookingId]);
    void sendNotification({
      target: { type: 'user', userId: b.renter_id },
      title: 'Absence signalée',
      body: 'Le propriétaire a signalé votre absence. Les absences répétées peuvent bloquer vos réservations.',
      type: 'info',
      data: { feature: 'car_rental', bookingId, kind: 'booking_no_show' },
      sentBy: null,
    }).catch(() => {});
    return ownerBookingView(client, bookingId);
  });
}

/** The car was not returned. Serious — flags the booking for admin review. */
export async function markNoReturn(ownerId: string, bookingId: string): Promise<OwnerBookingDTO> {
  return withTx(async (client) => {
    const b = await lockOwnerBooking(client, bookingId, ownerId);
    if (b.status !== 'in_progress') {
      throw new HttpError(409, 'not_in_progress', "Cette location n'est pas en cours");
    }
    await client.query(`UPDATE car_bookings SET status = 'no_return' WHERE id = $1`, [bookingId]);
    void sendNotification({
      target: { type: 'user', userId: b.renter_id },
      title: 'Non-retour signalé ⚠️',
      body: 'Le propriétaire a signalé que la voiture n\'a pas été rendue. Rendez-la au plus vite pour éviter un blocage.',
      type: 'info',
      data: { feature: 'car_rental', bookingId, kind: 'booking_no_return' },
      sentBy: null,
    }).catch(() => {});
    return ownerBookingView(client, bookingId);
  });
}

/** Either side opens a dispute (damage, state, deposit) with photo evidence. */
export async function openDispute(
  userId: string,
  bookingId: string,
  photos: string[],
): Promise<OwnerBookingDTO | RenterBookingDTO> {
  return withTx(async (client) => {
    const { rows } = await client.query<{
      status: BookingStatus; renter_id: string; owner_id: string;
    }>(
      `SELECT b.status, b.renter_id, c.owner_id
         FROM car_bookings b JOIN car_listings c ON c.id = b.listing_id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) throw new HttpError(404, 'booking_not_found', 'Réservation introuvable');
    const isOwner = b.owner_id === userId;
    const isRenter = b.renter_id === userId;
    if (!isOwner && !isRenter) throw new HttpError(403, 'not_your_booking', 'Cette réservation ne vous concerne pas');
    if (b.status !== 'in_progress' && b.status !== 'completed') {
      throw new HttpError(409, 'not_disputable', 'Cette réservation ne peut pas faire l\'objet d\'un litige');
    }

    await client.query(
      `UPDATE car_bookings
          SET status = 'disputed',
              return_photos = array_cat(return_photos, $2::text[])
        WHERE id = $1`,
      [bookingId, photos],
    );

    const counterpartId = isOwner ? b.renter_id : b.owner_id;
    void sendNotification({
      target: { type: 'user', userId: counterpartId },
      title: 'Litige ouvert',
      body: "Un litige a été ouvert sur une location. Un administrateur va l'examiner.",
      type: 'info',
      data: { feature: 'car_rental', bookingId, kind: 'booking_disputed' },
      sentBy: null,
    }).catch(() => {});

    return isOwner ? ownerBookingView(client, bookingId) : renterBookingView(client, bookingId);
  });
}

export async function rateBooking(
  userId: string,
  bookingId: string,
  stars: number,
  comment: string | null,
): Promise<OwnerBookingDTO | RenterBookingDTO> {
  return withTx(async (client) => {
    const { rows } = await client.query<{
      status: BookingStatus; renter_id: string; owner_id: string;
    }>(
      `SELECT b.status, b.renter_id, c.owner_id
         FROM car_bookings b JOIN car_listings c ON c.id = b.listing_id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) throw new HttpError(404, 'booking_not_found', 'Réservation introuvable');
    if (b.status !== 'completed') {
      throw new HttpError(409, 'not_completed', 'Vous ne pouvez noter qu\'une location terminée');
    }

    let role: 'renter' | 'owner';
    let rateeId: string;
    if (userId === b.renter_id) { role = 'renter'; rateeId = b.owner_id; }
    else if (userId === b.owner_id) { role = 'owner'; rateeId = b.renter_id; }
    else throw new HttpError(403, 'not_your_booking', 'Cette réservation ne vous concerne pas');

    try {
      await client.query(
        `INSERT INTO car_rental_ratings (booking_id, rater_id, ratee_id, role, stars, comment)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bookingId, userId, rateeId, role, stars, comment],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(409, 'already_rated', 'Vous avez déjà noté cette location');
      }
      throw err;
    }

    // Recompute the ratee's car-rental reputation from all their ratings.
    await client.query(
      `UPDATE users u
          SET car_rental_rating_count = agg.cnt,
              car_rental_rating_avg   = agg.avg
         FROM (
           SELECT COUNT(*)::int AS cnt,
                  COALESCE(ROUND(AVG(stars), 2), 0) AS avg
             FROM car_rental_ratings
            WHERE ratee_id = $1
         ) agg
        WHERE u.id = $1`,
      [rateeId],
    );

    return role === 'owner' ? ownerBookingView(client, bookingId) : renterBookingView(client, bookingId);
  });
}
