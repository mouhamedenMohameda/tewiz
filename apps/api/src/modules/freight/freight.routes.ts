import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import {
  browseTrips,
  cancelBooking,
  createTrip,
  getTripDetail,
  listIncomingBookings,
  listMyBookings,
  listMyTrips,
  requestBooking,
  respondBooking,
  updateTrip,
} from './freight.service.js';

export const freightRouter = Router();

const tripBody = z.object({
  origin_city: z.string().trim().min(2).max(80),
  destination_city: z.string().trim().min(2).max(80),
  departure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capacity_kg: z.number().int().min(1).max(100_000),
  price_per_kg_mru: z.number().int().min(0).max(1_000_000),
  min_price_mru: z.number().int().min(0).max(100_000_000).optional(),
  vehicle_type: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});

const tripPatch = tripBody.partial().extend({
  status: z.enum(['active', 'paused', 'departed', 'removed']).optional(),
});

function toInput(b: z.infer<typeof tripBody>) {
  return {
    originCity: b.origin_city,
    destinationCity: b.destination_city,
    departureDate: b.departure_date,
    capacityKg: b.capacity_kg,
    pricePerKgMru: b.price_per_kg_mru,
    minPriceMru: b.min_price_mru,
    vehicleType: b.vehicle_type,
    note: b.note,
  };
}

// --- Carrier: trips ---
freightRouter.post('/trips', requireAuth, async (req, res) => {
  const b = tripBody.parse(req.body);
  res.status(201).json({ trip: await createTrip(req.user!.id, toInput(b)) });
});

freightRouter.get('/trips/mine', requireAuth, async (req, res) => {
  res.json({ trips: await listMyTrips(req.user!.id) });
});

freightRouter.patch('/trips/:id', requireAuth, async (req, res) => {
  const b = tripPatch.parse(req.body);
  res.json({ trip: await updateTrip(String(req.params.id), req.user!.id, { ...toInput({ ...b } as z.infer<typeof tripBody>), status: b.status }) });
});

freightRouter.get('/bookings/incoming', requireAuth, async (req, res) => {
  res.json({ bookings: await listIncomingBookings(req.user!.id) });
});

const respondBody = z.object({ action: z.enum(['confirm', 'decline']) });
freightRouter.post('/bookings/:id/respond', requireAuth, async (req, res) => {
  const b = respondBody.parse(req.body);
  res.json({ booking: await respondBooking(String(req.params.id), req.user!.id, b.action) });
});

// --- Shipper: browse + book ---
const browseQuery = z.object({
  origin: z.string().trim().min(1).max(80).optional(),
  destination: z.string().trim().min(1).max(80).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

freightRouter.get('/trips', requireAuth, async (req, res) => {
  const q = browseQuery.parse(req.query);
  res.json({
    trips: await browseTrips({
      origin: q.origin, destination: q.destination, date: q.date, excludeCarrierId: req.user!.id,
    }),
  });
});

freightRouter.get('/trips/:id', requireAuth, async (req, res) => {
  const trip = await getTripDetail(String(req.params.id));
  if (!trip || trip.status === 'removed') throw new HttpError(404, 'trip_not_found', 'Trajet introuvable');
  res.json({ trip });
});

const bookingBody = z.object({
  trip_id: z.string().uuid(),
  cargo_description: z.string().trim().min(2).max(500),
  weight_kg: z.number().int().min(1).max(100_000),
});

freightRouter.post('/bookings', requireAuth, async (req, res) => {
  const b = bookingBody.parse(req.body);
  res.status(201).json({
    booking: await requestBooking(req.user!.id, {
      tripId: b.trip_id, cargoDescription: b.cargo_description, weightKg: b.weight_kg,
    }),
  });
});

freightRouter.get('/bookings/mine', requireAuth, async (req, res) => {
  res.json({ bookings: await listMyBookings(req.user!.id) });
});

freightRouter.post('/bookings/:id/cancel', requireAuth, async (req, res) => {
  const ok = await cancelBooking(String(req.params.id), req.user!.id);
  if (!ok) throw new HttpError(404, 'booking_not_found', 'Envoi introuvable');
  res.json({ ok: true });
});
