import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { sendNotification } from '../notifications/notifications.service.js';

/**
 * Car rental ("Location Auto") — a dedicated catalog + date-based booking
 * module. Any user lists a vehicle; renters request specific dates; the owner
 * confirms/declines. On confirmation both phone numbers are revealed. No
 * commission — deposit/payment are handled directly between the two parties.
 */

export type Transmission = 'auto' | 'manual';
export type CarStatus = 'active' | 'paused' | 'removed';
export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed';

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
}

const CAR_SELECT = `
  c.id, c.owner_id, c.title, c.brand_model, c.year, c.city, c.price_per_day_mru,
  c.deposit_mru, c.with_driver, c.driver_day_rate_mru, c.transmission, c.seats,
  c.description, c.photos, c.status,
  u.full_name AS owner_name, cap.rating_avg AS owner_rating`;
const CAR_JOINS = `
  JOIN users u ON u.id = c.owner_id
  LEFT JOIN captains cap ON cap.user_id = c.owner_id`;

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

export interface RenterBookingDTO {
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
  ownerName: string;
  ownerPhone: string | null;
  createdAt: string;
}

export async function requestBooking(renterId: string, input: BookingInput): Promise<RenterBookingDTO> {
  const days = dayCount(input.startDate, input.endDate);
  const car = await pool.query<{
    owner_id: string; status: CarStatus; price_per_day_mru: number;
    with_driver: boolean; driver_day_rate_mru: number | null;
  }>(
    `SELECT owner_id, status, price_per_day_mru, with_driver, driver_day_rate_mru
       FROM car_listings WHERE id = $1`,
    [input.listingId],
  );
  const c = car.rows[0];
  if (!c || c.status !== 'active') throw new HttpError(404, 'car_unavailable', 'Voiture indisponible');
  if (c.owner_id === renterId) throw new HttpError(400, 'own_car', 'Vous ne pouvez pas réserver votre propre voiture');
  const withDriver = input.withDriver === true;
  if (withDriver && !c.with_driver) throw new HttpError(400, 'no_driver', 'Cette voiture est sans chauffeur');
  const total = days * c.price_per_day_mru + (withDriver ? days * (c.driver_day_rate_mru ?? 0) : 0);

  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO car_bookings (listing_id, renter_id, start_date, end_date, days, with_driver, total_mru)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [input.listingId, renterId, input.startDate, input.endDate, days, withDriver, total],
  );

  void sendNotification({
    target: { type: 'user', userId: c.owner_id },
    title: 'Nouvelle demande de location',
    body: `Une demande de réservation (${days} jour${days > 1 ? 's' : ''}) attend votre confirmation.`,
    type: 'info',
    data: { feature: 'car_rental', bookingId: rows[0]!.id },
    sentBy: null,
  }).catch(() => {});

  return (await getMyBookings(renterId)).find((b) => b.id === rows[0]!.id)!;
}

export async function getMyBookings(renterId: string): Promise<RenterBookingDTO[]> {
  const { rows } = await pool.query<{
    id: string; start_date: Date; end_date: Date; days: number; with_driver: boolean;
    total_mru: number; status: BookingStatus; created_at: Date;
    car_title: string; city: string; photos: string[]; owner_name: string | null; owner_phone: string | null;
  }>(
    `SELECT b.id, b.start_date, b.end_date, b.days, b.with_driver, b.total_mru, b.status, b.created_at,
            c.title AS car_title, c.city, c.photos,
            u.full_name AS owner_name,
            CASE WHEN b.status = 'confirmed' THEN u.phone ELSE NULL END AS owner_phone
       FROM car_bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users u ON u.id = c.owner_id
      WHERE b.renter_id = $1
      ORDER BY b.created_at DESC`,
    [renterId],
  );
  return rows.map((r) => ({
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
    ownerName: r.owner_name ?? 'Propriétaire',
    ownerPhone: r.owner_phone,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function cancelBooking(id: string, renterId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE car_bookings SET status = 'cancelled'
      WHERE id = $1 AND renter_id = $2 AND status IN ('pending','confirmed')`,
    [id, renterId],
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Owner: booking requests ---

export interface OwnerBookingDTO {
  id: string;
  carTitle: string;
  startDate: string;
  endDate: string;
  days: number;
  withDriver: boolean;
  totalMru: number;
  status: BookingStatus;
  renterName: string;
  renterPhone: string | null;
  createdAt: string;
}

export async function listIncomingBookings(ownerId: string): Promise<OwnerBookingDTO[]> {
  const { rows } = await pool.query<{
    id: string; start_date: Date; end_date: Date; days: number; with_driver: boolean;
    total_mru: number; status: BookingStatus; created_at: Date;
    car_title: string; renter_name: string | null; renter_phone: string | null;
  }>(
    `SELECT b.id, b.start_date, b.end_date, b.days, b.with_driver, b.total_mru, b.status, b.created_at,
            c.title AS car_title,
            ru.full_name AS renter_name,
            CASE WHEN b.status = 'confirmed' THEN ru.phone ELSE NULL END AS renter_phone
       FROM car_bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users ru ON ru.id = b.renter_id
      WHERE c.owner_id = $1
      ORDER BY (b.status = 'pending') DESC, b.created_at DESC`,
    [ownerId],
  );
  return rows.map((r) => ({
    id: r.id,
    carTitle: r.car_title,
    startDate: r.start_date.toISOString().slice(0, 10),
    endDate: r.end_date.toISOString().slice(0, 10),
    days: r.days,
    withDriver: r.with_driver,
    totalMru: r.total_mru,
    status: r.status,
    renterName: r.renter_name ?? 'Client',
    renterPhone: r.renter_phone,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function respondBooking(id: string, ownerId: string, action: 'confirm' | 'decline'): Promise<OwnerBookingDTO> {
  // Verify ownership + fetch the booking dates for the overlap guard.
  const b = await pool.query<{ listing_id: string; start_date: Date; end_date: Date; status: BookingStatus; renter_id: string }>(
    `SELECT b.listing_id, b.start_date, b.end_date, b.status, b.renter_id
       FROM car_bookings b JOIN car_listings c ON c.id = b.listing_id
      WHERE b.id = $1 AND c.owner_id = $2`,
    [id, ownerId],
  );
  const row = b.rows[0];
  if (!row) throw new HttpError(404, 'booking_not_found', 'Demande introuvable');
  if (row.status !== 'pending') throw new HttpError(409, 'not_pending', 'Cette demande a déjà été traitée');

  if (action === 'confirm') {
    // Guard against double-booking the same car on overlapping confirmed dates.
    const clash = await pool.query(
      `SELECT 1 FROM car_bookings
        WHERE listing_id = $1 AND status = 'confirmed' AND id <> $2
          AND daterange(start_date, end_date, '[]') && daterange($3, $4, '[]')
        LIMIT 1`,
      [row.listing_id, id, row.start_date, row.end_date],
    );
    if (clash.rows[0]) throw new HttpError(409, 'dates_taken', 'Ces dates sont déjà réservées');
  }

  const newStatus: BookingStatus = action === 'confirm' ? 'confirmed' : 'declined';
  await pool.query(
    `UPDATE car_bookings SET status = $2, responded_at = now() WHERE id = $1`,
    [id, newStatus],
  );

  void sendNotification({
    target: { type: 'user', userId: row.renter_id },
    title: action === 'confirm' ? 'Réservation confirmée ✅' : 'Réservation refusée',
    body: action === 'confirm'
      ? 'Le propriétaire a confirmé. Vous pouvez voir son numéro dans « Mes réservations ».'
      : 'Le propriétaire n\'a pas pu confirmer votre demande.',
    type: 'info',
    data: { feature: 'car_rental', bookingId: id },
    sentBy: null,
  }).catch(() => {});

  return (await listIncomingBookings(ownerId)).find((x) => x.id === id)!;
}
