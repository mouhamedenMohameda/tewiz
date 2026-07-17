import { api } from './api';

export type PriceUnit = 'fixed' | 'per_hour' | 'per_day' | 'per_km' | 'per_trip';

export interface ListingCategory {
  category: string;
  label: string;
  enabled: boolean;
  publicationFeeMru: number;
}

export interface ServiceListing {
  id: string;
  category: string;
  title: string;
  description: string | null;
  priceMru: number;
  priceUnit: PriceUnit;
  providerName: string;
  publishedUntil: string;
  createdAt: string;
  // Only present on "my listings"
  providerPhone?: string;
  publicationFeeMru?: number;
  windowDays?: number;
  viewsCount?: number;
  status?: 'active' | 'expired' | 'cancelled';
}

export interface PublishListingPayload {
  category: string;
  title: string;
  description?: string;
  price_mru: number;
  price_unit: PriceUnit;
  provider_phone?: string;
  window_days: number;
}

/** UI metadata per category: price wording + category-specific form hints. */
export const CATEGORY_META: Record<string, {
  label: string;
  priceUnit: PriceUnit;
  unitSuffix: string;
  pricePrompt: string;
  titlePlaceholder: string;
  descPlaceholder: string;
}> = {
  private_driver: {
    label: 'Captain Privé', priceUnit: 'per_hour', unitSuffix: '/h', pricePrompt: 'Tarif horaire',
    titlePlaceholder: 'Ex: Captain dispo soir & week-end',
    descPlaceholder: 'Ex: Berline climatisée, +5 ans d\'expérience, Nouakchott et environs',
  },
  convoyage: {
    label: 'Convoyage', priceUnit: 'per_trip', unitSuffix: '/trajet', pricePrompt: 'Tarif par trajet',
    titlePlaceholder: 'Ex: Convoyage Nouakchott ↔ Nouadhibou',
    descPlaceholder: 'Ex: Je conduis votre véhicule, permis toutes catégories, ponctuel',
  },
  car_rental: {
    label: 'Location Auto', priceUnit: 'per_day', unitSuffix: '/jour', pricePrompt: 'Tarif journalier',
    titlePlaceholder: 'Ex: Toyota Corolla 2020 à louer',
    descPlaceholder: 'Ex: Climatisée, avec ou sans Captain, caution demandée',
  },
  roadside_assistance: {
    label: 'Assistance Routière', priceUnit: 'fixed', unitSuffix: '', pricePrompt: 'Tarif de base',
    titlePlaceholder: 'Ex: Dépannage & remorquage 24h/24',
    descPlaceholder: 'Ex: Batterie, pneu, remorquage, intervention rapide',
  },
  light_moving: {
    label: 'Déménagement Léger', priceUnit: 'per_trip', unitSuffix: '/trajet', pricePrompt: 'Tarif par trajet',
    titlePlaceholder: 'Ex: Déménagement & transport d\'objets',
    descPlaceholder: 'Ex: Camionnette + aide au chargement, meubles et cartons',
  },
  intercity_freight: {
    label: 'Fret Intercité', priceUnit: 'per_trip', unitSuffix: '/trajet', pricePrompt: 'Tarif par trajet',
    titlePlaceholder: 'Ex: Transport marchandises inter-villes',
    descPlaceholder: 'Ex: Camion 3T, Nouakchott ↔ Rosso, chargement sécurisé',
  },
  equipment_rental: {
    label: 'Location Équipement', priceUnit: 'per_day', unitSuffix: '/jour', pricePrompt: 'Tarif journalier',
    titlePlaceholder: 'Ex: Groupe électrogène 5 kVA à louer',
    descPlaceholder: 'Ex: Livraison possible, caution demandée, bon état',
  },
};

export const PRICE_UNIT_SUFFIX: Record<PriceUnit, string> = {
  fixed: '',
  per_hour: '/h',
  per_day: '/jour',
  per_km: '/km',
  per_trip: '/trajet',
};

export const WINDOW_OPTIONS = [7, 15, 30] as const;

export async function listCategories(): Promise<ListingCategory[]> {
  const r = await api.get<{ categories: ListingCategory[] }>('/listings/categories');
  return r.data.categories;
}

export async function listListings(category: string, search?: string): Promise<ServiceListing[]> {
  const qs = new URLSearchParams({ category });
  if (search?.trim()) qs.set('search', search.trim());
  const r = await api.get<{ listings: ServiceListing[] }>(`/listings?${qs.toString()}`);
  return r.data.listings;
}

export async function publishListing(payload: PublishListingPayload): Promise<ServiceListing> {
  const r = await api.post<{ listing: ServiceListing }>('/listings', payload);
  return r.data.listing;
}

export async function revealListingContact(listingId: string): Promise<{ providerPhone: string; providerName: string }> {
  const r = await api.post<{ provider_phone: string; provider_name: string }>(
    `/listings/${encodeURIComponent(listingId)}/reveal`,
  );
  return { providerPhone: r.data.provider_phone, providerName: r.data.provider_name };
}

export async function listMyListings(): Promise<ServiceListing[]> {
  const r = await api.get<{ listings: ServiceListing[] }>('/listings/mine');
  return r.data.listings;
}

export async function cancelListing(listingId: string): Promise<void> {
  await api.delete(`/listings/${encodeURIComponent(listingId)}`);
}
