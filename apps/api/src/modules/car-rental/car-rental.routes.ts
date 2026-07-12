import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import {
  browseCars,
  cancelBooking,
  confirmReturn,
  createCar,
  getCarDetail,
  getMyBookings,
  listIncomingBookings,
  listMyCars,
  markNoReturn,
  markNoShow,
  openDispute,
  pickupBooking,
  rateBooking,
  requestBooking,
  respondBooking,
  returnBooking,
  updateCar,
} from './car-rental.service.js';

export const carRentalRouter = Router();

const photoUrl = z.string().refine(
  (v) => v.startsWith('/') || z.string().url().safeParse(v).success,
  { message: 'Invalid photo URL' },
);

const carBody = z.object({
  title: z.string().trim().min(3).max(120),
  brand_model: z.string().trim().max(120).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  city: z.string().trim().min(2).max(80),
  price_per_day_mru: z.number().int().min(1).max(10_000_000),
  deposit_mru: z.number().int().min(0).max(100_000_000).optional(),
  with_driver: z.boolean().optional(),
  driver_day_rate_mru: z.number().int().min(0).max(10_000_000).optional(),
  transmission: z.enum(['auto', 'manual']).optional(),
  seats: z.number().int().min(1).max(60).optional(),
  description: z.string().trim().max(2000).optional(),
  photos: z.array(photoUrl).max(8).optional(),
});

const carPatch = carBody.partial().extend({
  status: z.enum(['active', 'paused', 'removed']).optional(),
});

function toInput(b: z.infer<typeof carBody>) {
  return {
    title: b.title,
    brandModel: b.brand_model,
    year: b.year,
    city: b.city,
    pricePerDayMru: b.price_per_day_mru,
    depositMru: b.deposit_mru,
    withDriver: b.with_driver,
    driverDayRateMru: b.driver_day_rate_mru,
    transmission: b.transmission,
    seats: b.seats,
    description: b.description,
    photos: b.photos,
  };
}

// --- Photo upload (any authed user) ---
carRentalRouter.post('/upload-photo', requireAuth, upload.single('file'), async (req, res) => {
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) throw new HttpError(400, 'no_file', 'Aucune image fournie');
  const key = `cars/${randomUUID()}.webp`;
  const optimized = await sharp(file.buffer)
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await defaultStorage.put(key, optimized, 'image/webp');
  const filename = key.replace('cars/', '');
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${base}/public/car-photos/${filename}` });
});

// --- Owner: manage cars ---
carRentalRouter.post('/cars', requireAuth, async (req, res) => {
  const b = carBody.parse(req.body);
  res.status(201).json({ car: await createCar(req.user!.id, toInput(b)) });
});

carRentalRouter.get('/cars/mine', requireAuth, async (req, res) => {
  res.json({ cars: await listMyCars(req.user!.id) });
});

carRentalRouter.patch('/cars/:id', requireAuth, async (req, res) => {
  const b = carPatch.parse(req.body);
  const car = await updateCar(String(req.params.id), req.user!.id, {
    ...toInput({ ...b } as z.infer<typeof carBody>),
    status: b.status,
  });
  res.json({ car });
});

// --- Owner: incoming booking requests ---
carRentalRouter.get('/bookings/incoming', requireAuth, async (req, res) => {
  res.json({ bookings: await listIncomingBookings(req.user!.id) });
});

const respondBody = z.object({ action: z.enum(['confirm', 'decline']) });
carRentalRouter.post('/bookings/:id/respond', requireAuth, async (req, res) => {
  const b = respondBody.parse(req.body);
  res.json({ booking: await respondBooking(String(req.params.id), req.user!.id, b.action) });
});

// --- Renter: browse + book ---
const browseQuery = z.object({
  city: z.string().trim().min(1).max(80).optional(),
  max_price: z.coerce.number().int().min(1).optional(),
  with_driver: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

carRentalRouter.get('/cars', requireAuth, async (req, res) => {
  const q = browseQuery.parse(req.query);
  res.json({
    cars: await browseCars({
      city: q.city,
      maxPricePerDay: q.max_price,
      withDriver: q.with_driver,
      search: q.search,
      excludeOwnerId: req.user!.id,
    }),
  });
});

carRentalRouter.get('/cars/:id', requireAuth, async (req, res) => {
  const car = await getCarDetail(String(req.params.id));
  if (!car || car.status === 'removed') throw new HttpError(404, 'car_not_found', 'Voiture introuvable');
  // Keep `status` in the response: the owner's edit screen reads it to show the
  // correct pause state. Without it the pause toggle always renders as "off",
  // making a paused car impossible to reliably reactivate.
  res.json({ car });
});

const bookingBody = z.object({
  listing_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  with_driver: z.boolean().optional(),
}).refine((b) => b.end_date >= b.start_date, {
  message: 'La date de fin doit être >= date de début',
  path: ['end_date'],
});

carRentalRouter.post('/bookings', requireAuth, async (req, res) => {
  const b = bookingBody.parse(req.body);
  res.status(201).json({
    booking: await requestBooking(req.user!.id, {
      listingId: b.listing_id,
      startDate: b.start_date,
      endDate: b.end_date,
      withDriver: b.with_driver,
    }),
  });
});

carRentalRouter.get('/bookings/mine', requireAuth, async (req, res) => {
  res.json({ bookings: await getMyBookings(req.user!.id) });
});

carRentalRouter.post('/bookings/:id/cancel', requireAuth, async (req, res) => {
  const ok = await cancelBooking(String(req.params.id), req.user!.id);
  if (!ok) throw new HttpError(404, 'booking_not_found', 'Réservation introuvable');
  res.json({ ok: true });
});

// --- Trust checkpoints ---
const otpBody = z.object({ otp: z.string().trim().min(3).max(10) });
const otpPhotosBody = otpBody.extend({ photos: z.array(photoUrl).max(8).optional() });
const photosBody = z.object({ photos: z.array(photoUrl).max(8).optional() });
const rateBody = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

// Owner enters the renter's pickup code (+ état-des-lieux photos) -> in_progress.
carRentalRouter.post('/bookings/:id/pickup', requireAuth, async (req, res) => {
  const b = otpPhotosBody.parse(req.body ?? {});
  res.json({ booking: await pickupBooking(req.user!.id, String(req.params.id), b.otp, b.photos ?? []) });
});

// Renter enters the owner's return code (+ photos) -> completed, commission charged.
carRentalRouter.post('/bookings/:id/return', requireAuth, async (req, res) => {
  const b = otpPhotosBody.parse(req.body ?? {});
  res.json({ booking: await returnBooking(req.user!.id, String(req.params.id), b.otp, b.photos ?? []) });
});

// Owner confirms the return (photos) and marks the deposit restituted.
carRentalRouter.post('/bookings/:id/confirm-return', requireAuth, async (req, res) => {
  const b = photosBody.parse(req.body ?? {});
  res.json({ booking: await confirmReturn(req.user!.id, String(req.params.id), b.photos ?? []) });
});

carRentalRouter.post('/bookings/:id/no-show', requireAuth, async (req, res) => {
  res.json({ booking: await markNoShow(req.user!.id, String(req.params.id)) });
});

carRentalRouter.post('/bookings/:id/no-return', requireAuth, async (req, res) => {
  res.json({ booking: await markNoReturn(req.user!.id, String(req.params.id)) });
});

carRentalRouter.post('/bookings/:id/dispute', requireAuth, async (req, res) => {
  const b = photosBody.parse(req.body ?? {});
  res.json({ booking: await openDispute(req.user!.id, String(req.params.id), b.photos ?? []) });
});

carRentalRouter.post('/bookings/:id/rate', requireAuth, async (req, res) => {
  const b = rateBody.parse(req.body);
  res.json({ booking: await rateBooking(req.user!.id, String(req.params.id), b.stars, b.comment ?? null) });
});
