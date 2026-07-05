import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import {
  cancelMyTrip,
  getTripById,
  listMyTrips,
  listTrips,
  publishTrip,
  revealDriverContact,
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

carpoolingRouter.get('/trips', async (req, res) => {
  const q = listQuery.parse(req.query);
  const trips = await listTrips({
    origin: q.origin,
    destination: q.destination,
    date: q.date,
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

carpoolingRouter.post('/trips/:id/reveal', requireAuth, async (req, res) => {
  const contact = await revealDriverContact(String(req.params.id), req.user!.id);
  res.json({
    driver_phone: contact.driverPhone,
    driver_name: contact.driverName,
  });
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
