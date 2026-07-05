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

export async function revealTripContact(tripId: string): Promise<{ driverPhone: string; driverName: string }> {
  const r = await api.post<{ driver_phone: string; driver_name: string }>(
    `/carpooling/trips/${encodeURIComponent(tripId)}/reveal`,
  );
  return {
    driverPhone: r.data.driver_phone,
    driverName: r.data.driver_name,
  };
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
