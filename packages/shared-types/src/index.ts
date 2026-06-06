// Shared types between API, captain-app, rider-app, and admin-web.
// Keep this dependency-free.

export type UserRole = 'rider' | 'captain' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'banned' | 'deleted';
export type Language = 'fr' | 'ar' | 'en';

export interface UserPublic {
  id: string;
  phone: string;
  role: UserRole;
  fullName: string | null;
  language: Language;
  createdAt: string;
}

// --- Money ---
// All amounts on the wire are integer khoums. 1 MRU = 5 khoums.
export type Khoums = number;

export const KHOUMS_PER_MRU = 5;
export const mruToKhoums = (mru: number): Khoums => Math.round(mru * KHOUMS_PER_MRU);
export const khoumsToMru = (k: Khoums): number => k / KHOUMS_PER_MRU;
export const formatMru = (k: Khoums): string =>
  `${(k / KHOUMS_PER_MRU).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} MRU`;

// --- Geo ---
export interface LatLng {
  lat: number;
  lng: number;
}

export interface Location extends LatLng {
  label?: string;
}

// --- KYC ---
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_correction'
  | 'approved'
  | 'rejected';

export type DocumentType =
  | 'selfie'
  | 'nni_front'
  | 'nni_back'
  | 'license_front'
  | 'license_back'
  | 'carte_grise'
  | 'assurance'
  | 'vignette'
  | 'visite_technique'
  | 'car_front'
  | 'car_back'
  | 'car_left'
  | 'car_right'
  | 'car_interior';

export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export const DOCUMENTS_WITH_EXPIRY: DocumentType[] = [
  'assurance',
  'vignette',
  'visite_technique',
];

// --- Wallet ---
export type TopupProvider = 'bankily' | 'masrivi' | 'sedad' | 'cash_office';
export type TopupStatus = 'pending' | 'approved' | 'partial' | 'rejected' | 'duplicate';
export type WalletTxType =
  | 'topup'
  | 'commission'
  | 'commission_refund'
  | 'manual_adjustment'
  | 'bonus';

// --- Captain state ---
export type CaptainPresence = 'offline' | 'online' | 'on_ride' | 'paused';
export type CaptainStatus = 'active' | 'suspended' | 'banned';

// --- Rides ---
export type RideType = 'passenger' | 'colis';

export type RideStatus =
  | 'pending_passenger_confirm'
  | 'searching'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled_by_rider'
  | 'cancelled_by_captain'
  | 'cancelled_by_system'
  | 'no_show';

export type PaymentMethod = 'cash' | 'wallet';

// --- Going home ---
export type GoingHomeStatus = 'active' | 'completed' | 'cancelled' | 'expired';

// --- Road reports ---
export type RoadReportReason =
  | 'sand'
  | 'flood'
  | 'construction'
  | 'police_checkpoint'
  | 'accident'
  | 'protest'
  | 'other';

// --- Recurring rides ---
export type RecurringStatus = 'proposed' | 'active' | 'paused' | 'cancelled' | 'expired';

// Bitmap helpers (bit 0 = Mon … bit 6 = Sun).
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DAYS_WEEKDAYS = 0b0011111; // Mon-Fri
export const DAYS_WEEKEND = 0b1100000;  // Sat-Sun
export const DAYS_ALL = 0b1111111;
