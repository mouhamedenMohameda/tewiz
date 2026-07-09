import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import {
  acceptBooking,
  cancelBooking,
  cancelMyTrip,
  completeBooking,
  declineBooking,
  getTripById,
  listDriverBookings,
  listMyTrips,
  listPassengerBookings,
  listTrips,
  markBookingNoShow,
  publishTrip,
  rateBooking,
  requestBooking,
  updateTripSeats,
} from './carpooling.service.js';

export const carpoolingRouter = Router();

const publishBody = z.object({
  origin_city: z.string().trim().min(2).max(80),
  destination_city: z.string().trim().min(2).max(80),
  departure_at: z.string().datetime(),
  total_seats: z.number().int().min(1).max(8),
  price_per_seat_mru: z.number().int().min(1).max(100_000),
  driver_phone: z.string().trim().min(6).max(30).optional(),
  notes: z.string().trim().max(500).optional(),
  boost: z.boolean().optional(),
}).refine((body) => body.origin_city.toLowerCase() !== body.destination_city.toLowerCase(), {
  message: 'La ville de depart et la destination doivent etre differentes',
});

const listQuery = z.object({
  origin: z.string().trim().min(1).max(80).optional(),
  destination: z.string().trim().min(1).max(80).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const seatsBody = z.object({
  available_seats: z.number().int().min(0).max(8),
});

const bookingBody = z.object({
  seats: z.number().int().min(1).max(8).optional(),
});

const completeBody = z.object({
  otp: z.string().trim().min(3).max(10),
});

const rateBody = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

/* ---- Trips -------------------------------------------------------- */

carpoolingRouter.post('/trips', requireAuth, requireRole('captain'), async (req, res) => {
  const body = publishBody.parse(req.body);
  const trip = await publishTrip(req.user!.id, {
    originCity: body.origin_city,
    destinationCity: body.destination_city,
    departureAt: body.departure_at,
    totalSeats: body.total_seats,
    pricePerSeatMru: body.price_per_seat_mru,
    driverPhone: body.driver_phone,
    notes: body.notes,
    boost: body.boost,
  });
  res.status(201).json({ trip });
});

carpoolingRouter.get('/trips', optionalAuth, async (req, res) => {
  const q = listQuery.parse(req.query);
  const trips = await listTrips({
    origin: q.origin,
    destination: q.destination,
    date: q.date,
    excludeDriverId: req.user?.id,
  });
  res.json({ trips });
});

carpoolingRouter.get('/trips/:id', async (req, res) => {
  const trip = await getTripById(String(req.params.id));
  if (!trip) {
    throw new HttpError(404, 'trip_not_found', 'Trajet introuvable');
  }
  const { driverId: _driverId, ...safeTrip } = trip;
  res.json({ trip: safeTrip });
});

carpoolingRouter.patch('/trips/:id/seats', requireAuth, requireRole('captain'), async (req, res) => {
  const body = seatsBody.parse(req.body);
  const trip = await updateTripSeats(String(req.params.id), req.user!.id, body.available_seats);
  res.json({ trip });
});

carpoolingRouter.get('/my-trips', requireAuth, requireRole('captain'), async (req, res) => {
  const trips = await listMyTrips(req.user!.id);
  res.json({ trips });
});

carpoolingRouter.delete('/trips/:id', requireAuth, requireRole('captain'), async (req, res) => {
  const ok = await cancelMyTrip(String(req.params.id), req.user!.id);
  if (!ok) {
    throw new HttpError(404, 'trip_not_found', 'Trajet introuvable');
  }
  res.json({ ok: true });
});

/* ---- Bookings ----------------------------------------------------- */

// Passenger requests a seat. Creates a timestamped booking (the receipt) and
// notifies the driver. Contact is NOT revealed here.
carpoolingRouter.post('/trips/:id/bookings', requireAuth, async (req, res) => {
  const body = bookingBody.parse(req.body ?? {});
  const booking = await requestBooking(req.user!.id, String(req.params.id), body.seats ?? 1);
  res.status(201).json({ booking });
});

// Passenger: my own booking requests (status, revealed contact + OTP once accepted).
carpoolingRouter.get('/my-bookings', requireAuth, async (req, res) => {
  const bookings = await listPassengerBookings(req.user!.id);
  res.json({ bookings });
});

// Driver: all requests on my trips (requested first).
carpoolingRouter.get('/driver-bookings', requireAuth, requireRole('captain'), async (req, res) => {
  const bookings = await listDriverBookings(req.user!.id);
  res.json({ bookings });
});

carpoolingRouter.post('/bookings/:id/accept', requireAuth, requireRole('captain'), async (req, res) => {
  const booking = await acceptBooking(req.user!.id, String(req.params.id));
  res.json({ booking });
});

carpoolingRouter.post('/bookings/:id/decline', requireAuth, requireRole('captain'), async (req, res) => {
  const booking = await declineBooking(req.user!.id, String(req.params.id));
  res.json({ booking });
});

// Driver closes the trip with the code the passenger reads out. This is the
// proof the ride happened and the only moment a commission is charged.
carpoolingRouter.post('/bookings/:id/complete', requireAuth, requireRole('captain'), async (req, res) => {
  const body = completeBody.parse(req.body);
  const booking = await completeBooking(req.user!.id, String(req.params.id), body.otp);
  res.json({ booking });
});

carpoolingRouter.post('/bookings/:id/no-show', requireAuth, requireRole('captain'), async (req, res) => {
  const booking = await markBookingNoShow(req.user!.id, String(req.params.id));
  res.json({ booking });
});

// Either side can cancel while still requested/accepted.
carpoolingRouter.post('/bookings/:id/cancel', requireAuth, async (req, res) => {
  const booking = await cancelBooking(req.user!.id, String(req.params.id));
  res.json({ booking });
});

// Bilateral rating on a completed trip (passenger rates driver, driver rates
// passenger — one each).
carpoolingRouter.post('/bookings/:id/rate', requireAuth, async (req, res) => {
  const body = rateBody.parse(req.body);
  const booking = await rateBooking(req.user!.id, String(req.params.id), body.stars, body.comment ?? null);
  res.json({ booking });
});
