import { api } from './api';

export interface CarpoolingTrip {
  id: string;
  originCity: string;
  destinationCity: string;
  departureAt: string;
  totalSeats: number;
  availableSeats: number;
  pricePerSeatMru: number;
  notes: string | null;
  isBoosted: boolean;
  boostedUntil: string | null;
  driverName: string;
  viewsCount?: number;
  status?: 'active' | 'full' | 'expired' | 'cancelled';
  publicationFeeMru?: number;
}

export interface PublishCarpoolingPayload {
  origin_city: string;
  destination_city: string;
  departure_at: string;
  total_seats: number;
  price_per_seat_mru: number;
  driver_phone?: string;
  notes?: string;
  boost?: boolean;
}

export async function listCarpoolingTrips(params: {
  origin?: string;
  destination?: string;
  date?: string;
} = {}): Promise<CarpoolingTrip[]> {
  const qs = new URLSearchParams();
  if (params.origin?.trim()) qs.set('origin', params.origin.trim());
  if (params.destination?.trim()) qs.set('destination', params.destination.trim());
  if (params.date?.trim()) qs.set('date', params.date.trim());
  const path = qs.toString() ? `/carpooling/trips?${qs.toString()}` : '/carpooling/trips';
  const r = await api.get<{ trips: CarpoolingTrip[] }>(path);
  return r.data.trips;
}

export async function publishCarpoolingTrip(payload: PublishCarpoolingPayload): Promise<CarpoolingTrip> {
  const r = await api.post<{ trip: CarpoolingTrip }>('/carpooling/trips', payload);
  return r.data.trip;
}

export type CarpoolingBookingStatus =
  | 'requested' | 'accepted' | 'declined'
  | 'cancelled' | 'completed' | 'no_show' | 'expired';

export interface CarpoolingBooking {
  id: string;
  tripId: string;
  status: CarpoolingBookingStatus;
  seats: number;
  fareMru: number;
  commissionMru: number;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  originCity: string;
  destinationCity: string;
  departureAt: string;
  pricePerSeatMru: number;
  driverName: string;
  passengerName: string;
  // Revealed only once the driver accepts, and only to the relevant side.
  driverPhone: string | null;
  passengerPhone: string | null;
  otpCode: string | null;
}

/* ---- Passenger side ---- */

export async function requestCarpoolingBooking(tripId: string, seats = 1): Promise<CarpoolingBooking> {
  const r = await api.post<{ booking: CarpoolingBooking }>(
    `/carpooling/trips/${encodeURIComponent(tripId)}/bookings`,
    { seats },
  );
  return r.data.booking;
}

export async function listMyCarpoolingBookings(): Promise<CarpoolingBooking[]> {
  const r = await api.get<{ bookings: CarpoolingBooking[] }>('/carpooling/my-bookings');
  return r.data.bookings;
}

/* ---- Driver side ---- */

export async function listDriverCarpoolingBookings(): Promise<CarpoolingBooking[]> {
  const r = await api.get<{ bookings: CarpoolingBooking[] }>('/carpooling/driver-bookings');
  return r.data.bookings;
}

export async function acceptCarpoolingBooking(bookingId: string): Promise<CarpoolingBooking> {
  const r = await api.post<{ booking: CarpoolingBooking }>(
    `/carpooling/bookings/${encodeURIComponent(bookingId)}/accept`,
  );
  return r.data.booking;
}

export async function declineCarpoolingBooking(bookingId: string): Promise<CarpoolingBooking> {
  const r = await api.post<{ booking: CarpoolingBooking }>(
    `/carpooling/bookings/${encodeURIComponent(bookingId)}/decline`,
  );
  return r.data.booking;
}

export async function completeCarpoolingBooking(bookingId: string, otp: string): Promise<CarpoolingBooking> {
  const r = await api.post<{ booking: CarpoolingBooking }>(
    `/carpooling/bookings/${encodeURIComponent(bookingId)}/complete`,
    { otp },
  );
  return r.data.booking;
}

export async function noShowCarpoolingBooking(bookingId: string): Promise<CarpoolingBooking> {
  const r = await api.post<{ booking: CarpoolingBooking }>(
    `/carpooling/bookings/${encodeURIComponent(bookingId)}/no-show`,
  );
  return r.data.booking;
}

/* ---- Either side ---- */

export async function cancelCarpoolingBooking(bookingId: string): Promise<CarpoolingBooking> {
  const r = await api.post<{ booking: CarpoolingBooking }>(
    `/carpooling/bookings/${encodeURIComponent(bookingId)}/cancel`,
  );
  return r.data.booking;
}

export async function listMyCarpoolingTrips(): Promise<CarpoolingTrip[]> {
  const r = await api.get<{ trips: CarpoolingTrip[] }>('/carpooling/my-trips');
  return r.data.trips;
}

export async function updateCarpoolingSeats(tripId: string, availableSeats: number): Promise<CarpoolingTrip> {
  const r = await api.patch<{ trip: CarpoolingTrip }>(
    `/carpooling/trips/${encodeURIComponent(tripId)}/seats`,
    { available_seats: availableSeats },
  );
  return r.data.trip;
}

export async function cancelCarpoolingTrip(tripId: string): Promise<void> {
  await api.delete(`/carpooling/trips/${encodeURIComponent(tripId)}`);
}
