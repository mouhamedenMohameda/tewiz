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

// Display labels are resolved at render time via i18n (`rideCancelReasons.<key>`),
// so the app follows the active language. The backend still maps the reasonKey to
// a stored French label independently (see @tewiz/shared-types).