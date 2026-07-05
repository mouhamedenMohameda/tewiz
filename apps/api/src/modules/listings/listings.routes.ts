import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import {
  cancelMyListing,
  getListingById,
  listCategories,
  listListings,
  listMyListings,
  publishListing,
  revealProviderContact,
} from './listings.service.js';

export const listingsRouter = Router();

const CATEGORIES = [
  'private_driver', 'convoyage', 'car_rental', 'roadside_assistance',
  'light_moving', 'intercity_freight', 'equipment_rental',
] as const;

const publishBody = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).optional(),
  price_mru: z.number().int().min(1).max(10_000_000),
  price_unit: z.enum(['fixed', 'per_hour', 'per_day', 'per_km', 'per_trip']),
  provider_phone: z.string().trim().min(6).max(30).optional(),
  window_days: z.number().int().min(1).max(90),
});

const listQuery = z.object({
  category: z.enum(CATEGORIES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

// Public list of enabled categories + their publication fees, so the app can
// build the "publier" screen and show the fee before the captain pays.
listingsRouter.get('/categories', async (_req, res) => {
  const categories = await listCategories(true);
  res.json({ categories });
});

listingsRouter.post('/', requireAuth, requireRole('captain'), async (req, res) => {
  const body = publishBody.parse(req.body);
  const listing = await publishListing(req.user!.id, {
    category: body.category,
    title: body.title,
    description: body.description,
    priceMru: body.price_mru,
    priceUnit: body.price_unit,
    providerPhone: body.provider_phone,
    windowDays: body.window_days,
  });
  res.status(201).json({ listing });
});

listingsRouter.get('/', optionalAuth, async (req, res) => {
  const q = listQuery.parse(req.query);
  const listings = await listListings({
    category: q.category,
    search: q.search,
    excludeProviderId: req.user?.id,
  });
  res.json({ listings });
});

listingsRouter.get('/mine', requireAuth, requireRole('captain'), async (req, res) => {
  const listings = await listMyListings(req.user!.id);
  res.json({ listings });
});

listingsRouter.get('/:id', async (req, res) => {
  const listing = await getListingById(String(req.params.id));
  if (!listing) {
    throw new HttpError(404, 'listing_not_found', 'Annonce introuvable');
  }
  // Hide provider identity/phone in the public detail; phone comes via /reveal.
  const { providerId: _pid, providerPhone: _phone, ...safe } = listing;
  res.json({ listing: safe });
});

listingsRouter.post('/:id/reveal', requireAuth, async (req, res) => {
  const contact = await revealProviderContact(String(req.params.id), req.user!.id);
  res.json({
    provider_phone: contact.providerPhone,
    provider_name: contact.providerName,
  });
});

listingsRouter.delete('/:id', requireAuth, requireRole('captain'), async (req, res) => {
  const ok = await cancelMyListing(String(req.params.id), req.user!.id);
  if (!ok) {
    throw new HttpError(404, 'listing_not_found', 'Annonce introuvable');
  }
  res.json({ ok: true });
});
