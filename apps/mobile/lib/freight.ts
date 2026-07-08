import { api } from './api';

export type TripStatus = 'active' | 'paused' | 'departed' | 'removed';
export type FreightBookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed';

export interface FreightTrip {
  id: string;
  originCity: string;
  destinationCity: string;
  departureDate: string;
  capacityKg: number;
  remainingKg: number;
  pricePerKgMru: number;
  minPriceMru: number;
  vehicleType: string | null;
  note: string | null;
  carrierName: string;
  carrierRating: number | null;
  status?: TripStatus;
}

export interface ShipperBooking {
  id: string;
  originCity: string;
  destinationCity: string;
  departureDate: string;
  cargoDescription: string;
  weightKg: number;
  totalMru: number;
  status: FreightBookingStatus;
  carrierName: string;
  carrierPhone: string | null;
  createdAt: string;
}

export interface CarrierBooking {
  id: string;
  originCity: string;
  destinationCity: string;
  cargoDescription: string;
  weightKg: number;
  totalMru: number;
  status: FreightBookingStatus;
  shipperName: string;
  shipperPhone: string | null;
  createdAt: string;
}

export const FREIGHT_STATUS_KEYS: Record<FreightBookingStatus, string> = {
  pending: 'freight.status.pending',
  confirmed: 'freight.status.confirmed',
  declined: 'freight.status.declined',
  cancelled: 'freight.status.cancelled',
  completed: 'freight.status.completed',
};

export interface TripPayload {
  origin_city: string;
  destination_city: string;
  departure_date: string;
  capacity_kg: number;
  price_per_kg_mru: number;
  min_price_mru?: number;
  vehicle_type?: string;
  note?: string;
}

export async function browseTrips(filters: { origin?: string; destination?: string; date?: string } = {}): Promise<FreightTrip[]> {
  const qs = new URLSearchParams();
  if (filters.origin?.trim()) qs.set('origin', filters.origin.trim());
  if (filters.destination?.trim()) qs.set('destination', filters.destination.trim());
  if (filters.date?.trim()) qs.set('date', filters.date.trim());
  const path = qs.toString() ? `/freight/trips?${qs}` : '/freight/trips';
  const r = await api.get<{ trips: FreightTrip[] }>(path);
  return r.data.trips;
}

export async function getTrip(id: string): Promise<FreightTrip> {
  const r = await api.get<{ trip: FreightTrip }>(`/freight/trips/${encodeURIComponent(id)}`);
  return r.data.trip;
}

export async function createTrip(payload: TripPayload): Promise<FreightTrip> {
  const r = await api.post<{ trip: FreightTrip }>('/freight/trips', payload);
  return r.data.trip;
}

export async function updateTrip(id: string, patch: Partial<TripPayload> & { status?: TripStatus }): Promise<FreightTrip> {
  const r = await api.patch<{ trip: FreightTrip }>(`/freight/trips/${encodeURIComponent(id)}`, patch);
  return r.data.trip;
}

export async function listMyTrips(): Promise<FreightTrip[]> {
  const r = await api.get<{ trips: FreightTrip[] }>('/freight/trips/mine');
  return r.data.trips;
}

export async function requestBooking(payload: { trip_id: string; cargo_description: string; weight_kg: number }): Promise<ShipperBooking> {
  const r = await api.post<{ booking: ShipperBooking }>('/freight/bookings', payload);
  return r.data.booking;
}

export async function listMyBookings(): Promise<ShipperBooking[]> {
  const r = await api.get<{ bookings: ShipperBooking[] }>('/freight/bookings/mine');
  return r.data.bookings;
}

export async function cancelBooking(id: string): Promise<void> {
  await api.post(`/freight/bookings/${encodeURIComponent(id)}/cancel`);
}

export async function listIncomingBookings(): Promise<CarrierBooking[]> {
  const r = await api.get<{ bookings: CarrierBooking[] }>('/freight/bookings/incoming');
  return r.data.bookings;
}

export async function respondBooking(id: string, action: 'confirm' | 'decline'): Promise<CarrierBooking> {
  const r = await api.post<{ booking: CarrierBooking }>(`/freight/bookings/${encodeURIComponent(id)}/respond`, { action });
  return r.data.booking;
}
