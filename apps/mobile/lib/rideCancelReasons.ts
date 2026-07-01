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