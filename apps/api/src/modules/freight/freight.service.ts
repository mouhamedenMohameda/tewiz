import { pool, instrumentClient } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { sendNotification } from '../notifications/notifications.service.js';

/**
 * Intercity freight ("Fret Intercité") — a freight board. A carrier publishes a
 * scheduled trip (city→city, date, capacity, price/kg); a shipper requests
 * space for a cargo; the carrier confirms/declines within remaining capacity.
 * On confirmation both phones are revealed. No commission.
 */

export type TripStatus = 'active' | 'paused' | 'departed' | 'removed';
export type FreightBookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed';

export interface TripInput {
  originCity: string;
  destinationCity: string;
  departureDate: string;
  capacityKg: number;
  pricePerKgMru: number;
  minPriceMru?: number;
  vehicleType?: string;
  note?: string;
}

export interface TripListItem {
  id: string;
  originCity: string;
  destinationCity: string;
  departureDate: string;
  capacityKg: number;
  remainingKg: number;
  pricePerKgMru: number;
  minPriceMru: number;
  vehicleType: string | null;
  note: string | null;
  carrierName: string;
  carrierRating: number | null;
}

export interface TripDetail extends TripListItem {
  status: TripStatus;
}

interface TripRow {
  id: string;
  carrier_id: string;
  origin_city: string;
  destination_city: string;
  departure_date: Date;
  capacity_kg: number;
  price_per_kg_mru: number;
  min_price_mru: number;
  vehicle_type: string | null;
  note: string | null;
  status: TripStatus;
  carrier_name: string | null;
  carrier_rating: string | null;
  booked_kg: string | null;
}

const TRIP_SELECT = `
  t.id, t.carrier_id, t.origin_city, t.destination_city, t.departure_date,
  t.capacity_kg, t.price_per_kg_mru, t.min_price_mru, t.vehicle_type, t.note, t.status,
  u.full_name AS carrier_name, cap.rating_avg AS carrier_rating,
  (SELECT COALESCE(SUM(weight_kg),0) FROM freight_bookings b
    WHERE b.trip_id = t.id AND b.status = 'confirmed')::text AS booked_kg`;
const TRIP_JOINS = `
  JOIN users u ON u.id = t.carrier_id
  LEFT JOIN captains cap ON cap.user_id = t.carrier_id`;

function toDetail(r: TripRow): TripDetail {
  const remaining = r.capacity_kg - Number(r.booked_kg ?? 0);
  return {
    id: r.id,
    originCity: r.origin_city,
    destinationCity: r.destination_city,
    departureDate: r.departure_date.toISOString().slice(0, 10),
    capacityKg: r.capacity_kg,
    remainingKg: Math.max(0, remaining),
    pricePerKgMru: r.price_per_kg_mru,
    minPriceMru: r.min_price_mru,
    vehicleType: r.vehicle_type,
    note: r.note,
    carrierName: r.carrier_name ?? 'Transporteur',
    carrierRating: r.carrier_rating != null ? Number(r.carrier_rating) : null,
    status: r.status,
  };
}

function toListItem(r: TripRow): TripListItem {
  const { status: _s, ...item } = toDetail(r);
  return item;
}

function bookingTotal(weightKg: number, pricePerKg: number, minPrice: number): number {
  return Math.max(weightKg * pricePerKg, minPrice);
}

// --- Carrier: trips ---

export async function createTrip(carrierId: string, input: TripInput): Promise<TripDetail> {
  const { rows } = await pool.query<TripRow>(
    `WITH ins AS (
       INSERT INTO freight_trips (
         carrier_id, origin_city, destination_city, departure_date,
         capacity_kg, price_per_kg_mru, min_price_mru, vehicle_type, note
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *
     )
     SELECT ${TRIP_SELECT} FROM ins t ${TRIP_JOINS}`,
    [
      carrierId, input.originCity.trim(), input.destinationCity.trim(), input.departureDate,
      input.capacityKg, input.pricePerKgMru, input.minPriceMru ?? 0,
      input.vehicleType?.trim() || null, input.note?.trim() || null,
    ],
  );
  return toDetail(rows[0]!);
}

export async function updateTrip(id: string, carrierId: string, patch: Partial<TripInput> & { status?: TripStatus }): Promise<TripDetail> {
  const { rows } = await pool.query<TripRow>(
    `WITH upd AS (
       UPDATE freight_trips SET
         origin_city = COALESCE($3, origin_city),
         destination_city = COALESCE($4, destination_city),
         departure_date = COALESCE($5, departure_date),
         capacity_kg = COALESCE($6, capacity_kg),
         price_per_kg_mru = COALESCE($7, price_per_kg_mru),
         min_price_mru = COALESCE($8, min_price_mru),
         vehicle_type = COALESCE($9, vehicle_type),
         note = COALESCE($10, note),
         status = COALESCE($11, status),
         updated_at = now()
       WHERE id = $1 AND carrier_id = $2 AND status <> 'removed'
       RETURNING *
     )
     SELECT ${TRIP_SELECT} FROM upd t ${TRIP_JOINS}`,
    [
      id, carrierId, patch.originCity ?? null, patch.destinationCity ?? null,
      patch.departureDate ?? null, patch.capacityKg ?? null, patch.pricePerKgMru ?? null,
      patch.minPriceMru ?? null, patch.vehicleType ?? null, patch.note ?? null, patch.status ?? null,
    ],
  );
  if (!rows[0]) throw new HttpError(404, 'trip_not_found', 'Trajet introuvable');
  return toDetail(rows[0]);
}

export async function listMyTrips(carrierId: string): Promise<TripDetail[]> {
  const { rows } = await pool.query<TripRow>(
    `SELECT ${TRIP_SELECT} FROM freight_trips t ${TRIP_JOINS}
      WHERE t.carrier_id = $1 AND t.status <> 'removed'
      ORDER BY t.departure_date DESC`,
    [carrierId],
  );
  return rows.map(toDetail);
}

// --- Shipper: browse + book ---

export async function browseTrips(filters: {
  origin?: string; destination?: string; date?: string; excludeCarrierId?: string;
}): Promise<TripListItem[]> {
  const clauses = [`t.status = 'active'`, `t.departure_date >= CURRENT_DATE`];
  const params: unknown[] = [];
  if (filters.origin?.trim()) { params.push(`%${filters.origin.trim()}%`); clauses.push(`t.origin_city ILIKE $${params.length}`); }
  if (filters.destination?.trim()) { params.push(`%${filters.destination.trim()}%`); clauses.push(`t.destination_city ILIKE $${params.length}`); }
  if (filters.date) { params.push(filters.date); clauses.push(`t.departure_date = $${params.length}::date`); }
  if (filters.excludeCarrierId) { params.push(filters.excludeCarrierId); clauses.push(`t.carrier_id <> $${params.length}`); }

  const { rows } = await pool.query<TripRow>(
    `SELECT ${TRIP_SELECT} FROM freight_trips t ${TRIP_JOINS}
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.departure_date ASC
      LIMIT 100`,
    params,
  );
  return rows.map(toListItem);
}

export async function getTripDetail(id: string): Promise<TripDetail | null> {
  const { rows } = await pool.query<TripRow>(
    `SELECT ${TRIP_SELECT} FROM freight_trips t ${TRIP_JOINS} WHERE t.id = $1`,
    [id],
  );
  return rows[0] ? toDetail(rows[0]) : null;
}

export interface ShipperBookingDTO {
  id: string;
  originCity: string;
  destinationCity: string;
  departureDate: string;
  cargoDescription: string;
  weightKg: number;
  totalMru: number;
  status: FreightBookingStatus;
  carrierName: string;
  carrierPhone: string | null;
  createdAt: string;
}

export async function requestBooking(shipperId: string, input: { tripId: string; cargoDescription: string; weightKg: number }): Promise<ShipperBookingDTO> {
  const trip = await pool.query<{
    carrier_id: string; status: TripStatus; capacity_kg: number;
    price_per_kg_mru: number; min_price_mru: number; booked_kg: string;
  }>(
    `SELECT carrier_id, status, capacity_kg, price_per_kg_mru, min_price_mru,
            (SELECT COALESCE(SUM(weight_kg),0) FROM freight_bookings b WHERE b.trip_id = $1 AND b.status = 'confirmed')::text AS booked_kg
       FROM freight_trips WHERE id = $1`,
    [input.tripId],
  );
  const t = trip.rows[0];
  if (!t || t.status !== 'active') throw new HttpError(404, 'trip_unavailable', 'Trajet indisponible');
  if (t.carrier_id === shipperId) throw new HttpError(400, 'own_trip', 'Vous ne pouvez pas réserver votre propre trajet');
  const remaining = t.capacity_kg - Number(t.booked_kg);
  if (input.weightKg > remaining) throw new HttpError(409, 'capacity_exceeded', `Capacité restante : ${remaining} kg`);

  const total = bookingTotal(input.weightKg, t.price_per_kg_mru, t.min_price_mru);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO freight_bookings (trip_id, shipper_id, cargo_description, weight_kg, total_mru)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.tripId, shipperId, input.cargoDescription.trim(), input.weightKg, total],
  );

  void sendNotification({
    target: { type: 'user', userId: t.carrier_id },
    title: 'Fret : nouvelle demande d\'envoi',
    body: `Une demande d'envoi (${input.weightKg} kg) attend votre confirmation.`,
    type: 'info',
    data: { feature: 'freight', bookingId: rows[0]!.id },
    sentBy: null,
  }).catch(() => {});

  return (await getShipperBookingById(rows[0]!.id, shipperId))!;
}

type ShipperBookingRow = {
  id: string; cargo_description: string; weight_kg: number; total_mru: number;
  status: FreightBookingStatus; created_at: Date;
  origin_city: string; destination_city: string; departure_date: Date;
  carrier_name: string | null; carrier_phone: string | null;
};

const SHIPPER_BOOKING_SELECT = `
  SELECT b.id, b.cargo_description, b.weight_kg, b.total_mru, b.status, b.created_at,
         t.origin_city, t.destination_city, t.departure_date,
         u.full_name AS carrier_name,
         CASE WHEN b.status = 'confirmed' THEN u.phone ELSE NULL END AS carrier_phone
    FROM freight_bookings b
    JOIN freight_trips t ON t.id = b.trip_id
    JOIN users u ON u.id = t.carrier_id`;

function toShipperBooking(r: ShipperBookingRow): ShipperBookingDTO {
  return {
    id: r.id,
    originCity: r.origin_city,
    destinationCity: r.destination_city,
    departureDate: r.departure_date.toISOString().slice(0, 10),
    cargoDescription: r.cargo_description,
    weightKg: r.weight_kg,
    totalMru: r.total_mru,
    status: r.status,
    carrierName: r.carrier_name ?? 'Transporteur',
    carrierPhone: r.carrier_phone,
    createdAt: r.created_at.toISOString(),
  };
}

async function getShipperBookingById(id: string, shipperId: string): Promise<ShipperBookingDTO | null> {
  const { rows } = await pool.query<ShipperBookingRow>(
    `${SHIPPER_BOOKING_SELECT} WHERE b.id = $1 AND b.shipper_id = $2`,
    [id, shipperId],
  );
  return rows[0] ? toShipperBooking(rows[0]) : null;
}

export async function listMyBookings(shipperId: string): Promise<ShipperBookingDTO[]> {
  const { rows } = await pool.query<ShipperBookingRow>(
    `${SHIPPER_BOOKING_SELECT} WHERE b.shipper_id = $1 ORDER BY b.created_at DESC`,
    [shipperId],
  );
  return rows.map(toShipperBooking);
}

export async function cancelBooking(id: string, shipperId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE freight_bookings SET status = 'cancelled'
      WHERE id = $1 AND shipper_id = $2 AND status IN ('pending','confirmed')`,
    [id, shipperId],
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Carrier: incoming bookings ---

export interface CarrierBookingDTO {
  id: string;
  originCity: string;
  destinationCity: string;
  cargoDescription: string;
  weightKg: number;
  totalMru: number;
  status: FreightBookingStatus;
  shipperName: string;
  shipperPhone: string | null;
  createdAt: string;
}

type CarrierBookingRow = {
  id: string; cargo_description: string; weight_kg: number; total_mru: number;
  status: FreightBookingStatus; created_at: Date; origin_city: string; destination_city: string;
  shipper_name: string | null; shipper_phone: string | null;
};

const CARRIER_BOOKING_SELECT = `
  SELECT b.id, b.cargo_description, b.weight_kg, b.total_mru, b.status, b.created_at,
         t.origin_city, t.destination_city,
         su.full_name AS shipper_name,
         CASE WHEN b.status = 'confirmed' THEN su.phone ELSE NULL END AS shipper_phone
    FROM freight_bookings b
    JOIN freight_trips t ON t.id = b.trip_id
    JOIN users su ON su.id = b.shipper_id`;

function toCarrierBooking(r: CarrierBookingRow): CarrierBookingDTO {
  return {
    id: r.id,
    originCity: r.origin_city,
    destinationCity: r.destination_city,
    cargoDescription: r.cargo_description,
    weightKg: r.weight_kg,
    totalMru: r.total_mru,
    status: r.status,
    shipperName: r.shipper_name ?? 'Expéditeur',
    shipperPhone: r.shipper_phone,
    createdAt: r.created_at.toISOString(),
  };
}

async function getCarrierBookingById(id: string, carrierId: string): Promise<CarrierBookingDTO | null> {
  const { rows } = await pool.query<CarrierBookingRow>(
    `${CARRIER_BOOKING_SELECT} WHERE b.id = $1 AND t.carrier_id = $2`,
    [id, carrierId],
  );
  return rows[0] ? toCarrierBooking(rows[0]) : null;
}

export async function listIncomingBookings(carrierId: string): Promise<CarrierBookingDTO[]> {
  const { rows } = await pool.query<CarrierBookingRow>(
    `${CARRIER_BOOKING_SELECT} WHERE t.carrier_id = $1 ORDER BY (b.status = 'pending') DESC, b.created_at DESC`,
    [carrierId],
  );
  return rows.map(toCarrierBooking);
}

export async function respondBooking(id: string, carrierId: string, action: 'confirm' | 'decline'): Promise<CarrierBookingDTO> {
  const client = instrumentClient(await pool.connect());
  try {
    await client.query('BEGIN');

    const b = await client.query<{ trip_id: string; weight_kg: number; status: FreightBookingStatus; shipper_id: string }>(
      `SELECT b.trip_id, b.weight_kg, b.status, b.shipper_id
         FROM freight_bookings b JOIN freight_trips t ON t.id = b.trip_id
        WHERE b.id = $1 AND t.carrier_id = $2
        FOR UPDATE OF b`,
      [id, carrierId],
    );
    const row = b.rows[0];
    if (!row) { await client.query('ROLLBACK'); throw new HttpError(404, 'booking_not_found', 'Demande introuvable'); }
    if (row.status !== 'pending') { await client.query('ROLLBACK'); throw new HttpError(409, 'not_pending', 'Cette demande a déjà été traitée'); }

    if (action === 'confirm') {
      const cap = await client.query<{ capacity_kg: number; booked_kg: string }>(
        `SELECT capacity_kg,
                (SELECT COALESCE(SUM(weight_kg),0) FROM freight_bookings x WHERE x.trip_id = $1 AND x.status = 'confirmed')::text AS booked_kg
           FROM freight_trips WHERE id = $1 FOR UPDATE`,
        [row.trip_id],
      );
      const remaining = cap.rows[0]!.capacity_kg - Number(cap.rows[0]!.booked_kg);
      if (row.weight_kg > remaining) { await client.query('ROLLBACK'); throw new HttpError(409, 'capacity_exceeded', `Capacité restante : ${remaining} kg`); }
    }

    const newStatus: FreightBookingStatus = action === 'confirm' ? 'confirmed' : 'declined';
    await client.query(`UPDATE freight_bookings SET status = $2, responded_at = now() WHERE id = $1`, [id, newStatus]);

    await client.query('COMMIT');

    void sendNotification({
      target: { type: 'user', userId: row.shipper_id },
      title: action === 'confirm' ? 'Envoi confirmé ✅' : 'Envoi refusé',
      body: action === 'confirm'
        ? 'Le transporteur a confirmé. Son numéro est dans « Mes envois ».'
        : 'Le transporteur n\'a pas pu confirmer votre envoi.',
      type: 'info',
      data: { feature: 'freight', bookingId: id },
      sentBy: null,
    }).catch(() => {});

    return (await getCarrierBookingById(id, carrierId))!;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
