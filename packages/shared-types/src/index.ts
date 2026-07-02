// Shared types between API, mobile app, and admin-web.
// Keep this dependency-free.

export type UserRole = 'rider' | 'captain' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'banned' | 'deleted';
export type Language = 'fr' | 'ar' | 'en';

// Sub-role inside the admin panel (RBAC). Set only when role='admin'.
// See migration 0029_admin_roles.sql for the per-role permission matrix.
export type AdminRole =
  | 'super_admin'
  | 'ops_manager'
  | 'dispatcher'
  | 'kyc_reviewer'
  | 'finance'
  | 'support';

export const ADMIN_ROLES: readonly AdminRole[] = [
  'super_admin',
  'ops_manager',
  'dispatcher',
  'kyc_reviewer',
  'finance',
  'support',
] as const;

export interface UserPublic {
  id: string;
  phone: string;
  role: UserRole;
  adminRole: AdminRole | null;
  fullName: string | null;
  language: Language;
  createdAt: string;
}

// --- Money ---
// All amounts on the wire are integer MRU (ouguiyas). The legacy khoums
// unit (1 MRU = 5 khoums) was removed by migration 0017 — the constant
// conversion between input units and storage units was a recurring source
// of off-by-5 bugs.
export type Mru = number;

export const formatMru = (mru: Mru): string =>
  `${Math.round(mru).toLocaleString('fr-FR')} MRU`;

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
export type VehicleType = 'car' | 'moto';

// --- Rides ---
export type RideType = 'passenger' | 'colis';

// 'restaurant' = booked by a restaurant partner account for a phone-in
// customer; 'partner' = booked by an individual member. Both carry
// rides.origin_partner_id for commission sharing (migration 0041).
export type RideSource = 'app' | 'operator' | 'restaurant' | 'partner';

// --- Partners (migration 0041) ---
// Partners bring us supply (agencies register couriers) or demand
// (restaurants/members create rides) and earn a share of OUR platform
// commission — in basis points, never of the fare. Amounts in integer MRU.
export type PartnerType = 'agency' | 'restaurant' | 'individual';
export type PartnerStatus = 'active' | 'suspended' | 'ended';
export type PartnerEarningRole =
  | 'ride_creator'      // creation side: restaurant/member who booked the ride
  | 'captain_provider'  // captain side: agency of the courier, inside his window
  | 'closure_bonus'     // one-shot when a courier window closes in good standing
  | 'conversion_bonus'; // one-shot when a member's customer self-orders
export type PartnerEarningStatus = 'pending' | 'on_hold' | 'settled' | 'cancelled';
export type PartnerSettlementStatus = 'draft' | 'paid';

export interface Partner {
  id: string;
  type: PartnerType;
  name: string;
  phone: string | null;
  code: string;
  userId: string | null;
  restaurantId: string | null;
  status: PartnerStatus;
  shareBps: number;
  windowMonths: number;
  windowMaxCourses: number;
  closureBonusMru: Mru;
  quotaCourses: number;
  quotaMonths: number;
  conversionBonusMru: Mru;
  createdAt: string;
}

export interface CaptainPartnerLink {
  captainId: string;
  partnerId: string;
  attachedAt: string;
  expiresAt: string;
  coursesCounted: number;
  closedAt: string | null;
  closureBonusPaid: boolean;
}

export interface PartnerEarning {
  id: string;
  partnerId: string;
  rideId: string;
  role: PartnerEarningRole;
  baseCommissionMru: Mru;
  shareBps: number;
  amountMru: Mru;
  status: PartnerEarningStatus;
  holdReason: string | null;
  settlementId: string | null;
  createdAt: string;
}

export interface PartnerSettlement {
  id: string;
  partnerId: string;
  periodStart: string;
  periodEnd: string;
  totalMru: Mru;
  status: PartnerSettlementStatus;
  paidAt: string | null;
  paidBy: string | null;
  note: string | null;
  createdAt: string;
}

export const RIDER_RIDE_CANCEL_REASONS = [
  'change_of_plans',
  'booked_by_mistake',
  'long_wait',
  'driver_not_moving',
  'cannot_contact_driver',
  'other',
] as const;

export const CAPTAIN_RIDE_CANCEL_REASONS = [
  'passenger_no_show',
  'cannot_contact_passenger',
  'vehicle_issue',
  'traffic_delay',
  'unsafe_area',
  'other',
] as const;

export type RiderRideCancelReason = typeof RIDER_RIDE_CANCEL_REASONS[number];
export type CaptainRideCancelReason = typeof CAPTAIN_RIDE_CANCEL_REASONS[number];
export type RideCancelReasonKey = RiderRideCancelReason | CaptainRideCancelReason;

export const RIDE_CANCEL_REASON_LABEL_FR: Record<RideCancelReasonKey, string> = {
  change_of_plans: 'Changement de programme',
  booked_by_mistake: 'Course demandee par erreur',
  long_wait: 'Attente trop longue',
  driver_not_moving: 'Le chauffeur ne se rapproche pas',
  cannot_contact_driver: 'Impossible de joindre le chauffeur',
  passenger_no_show: 'Passager introuvable',
  cannot_contact_passenger: 'Impossible de joindre le passager',
  vehicle_issue: 'Probleme de vehicule',
  traffic_delay: 'Retard important sur la route',
  unsafe_area: 'Zone jugee non sure',
  other: 'Autre raison',
};

export const CAPTAIN_ALERT_SOUND_MODES = ['standard', 'critical'] as const;
export type CaptainAlertSoundMode = typeof CAPTAIN_ALERT_SOUND_MODES[number];

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
