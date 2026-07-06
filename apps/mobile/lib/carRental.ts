import { api } from './api';

export type Transmission = 'auto' | 'manual';
export type CarStatus = 'active' | 'paused' | 'removed';
export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed';

export interface Car {
  id: string;
  title: string;
  brandModel: string | null;
  year: number | null;
  city: string;
  pricePerDayMru: number;
  depositMru: number;
  withDriver: boolean;
  driverDayRateMru: number | null;
  transmission: Transmission | null;
  seats: number | null;
  photos: string[];
  ownerName: string;
  ownerRating: number | null;
  description?: string | null;
  status?: CarStatus;
}

export interface RenterBooking {
  id: string;
  carTitle: string;
  carPhoto: string | null;
  city: string;
  startDate: string;
  endDate: string;
  days: number;
  withDriver: boolean;
  totalMru: number;
  status: BookingStatus;
  ownerName: string;
  ownerPhone: string | null;
  createdAt: string;
}

export interface OwnerBooking {
  id: string;
  carTitle: string;
  startDate: string;
  endDate: string;
  days: number;
  withDriver: boolean;
  totalMru: number;
  status: BookingStatus;
  renterName: string;
  renterPhone: string | null;
  createdAt: string;
}

export interface CarInputPayload {
  title: string;
  brand_model?: string;
  year?: number;
  city: string;
  price_per_day_mru: number;
  deposit_mru?: number;
  with_driver?: boolean;
  driver_day_rate_mru?: number;
  transmission?: Transmission;
  seats?: number;
  description?: string;
  photos?: string[];
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  declined: 'Refusée',
  cancelled: 'Annulée',
  completed: 'Terminée',
};

export async function browseCars(filters: {
  city?: string; maxPrice?: number; withDriver?: boolean; search?: string;
} = {}): Promise<Car[]> {
  const qs = new URLSearchParams();
  if (filters.city?.trim()) qs.set('city', filters.city.trim());
  if (filters.maxPrice) qs.set('max_price', String(filters.maxPrice));
  if (filters.withDriver) qs.set('with_driver', 'true');
  if (filters.search?.trim()) qs.set('search', filters.search.trim());
  const path = qs.toString() ? `/car-rental/cars?${qs}` : '/car-rental/cars';
  const r = await api.get<{ cars: Car[] }>(path);
  return r.data.cars;
}

export async function getCar(id: string): Promise<Car> {
  const r = await api.get<{ car: Car }>(`/car-rental/cars/${encodeURIComponent(id)}`);
  return r.data.car;
}

export async function createCar(payload: CarInputPayload): Promise<Car> {
  const r = await api.post<{ car: Car }>('/car-rental/cars', payload);
  return r.data.car;
}

export async function updateCar(id: string, patch: Partial<CarInputPayload> & { status?: CarStatus }): Promise<Car> {
  const r = await api.patch<{ car: Car }>(`/car-rental/cars/${encodeURIComponent(id)}`, patch);
  return r.data.car;
}

export async function listMyCars(): Promise<Car[]> {
  const r = await api.get<{ cars: Car[] }>('/car-rental/cars/mine');
  return r.data.cars;
}

export async function requestBooking(payload: {
  listing_id: string; start_date: string; end_date: string; with_driver?: boolean;
}): Promise<RenterBooking> {
  const r = await api.post<{ booking: RenterBooking }>('/car-rental/bookings', payload);
  return r.data.booking;
}

export async function listMyBookings(): Promise<RenterBooking[]> {
  const r = await api.get<{ bookings: RenterBooking[] }>('/car-rental/bookings/mine');
  return r.data.bookings;
}

export async function cancelBooking(id: string): Promise<void> {
  await api.post(`/car-rental/bookings/${encodeURIComponent(id)}/cancel`);
}

export async function listIncomingBookings(): Promise<OwnerBooking[]> {
  const r = await api.get<{ bookings: OwnerBooking[] }>('/car-rental/bookings/incoming');
  return r.data.bookings;
}

export async function respondBooking(id: string, action: 'confirm' | 'decline'): Promise<OwnerBooking> {
  const r = await api.post<{ booking: OwnerBooking }>(`/car-rental/bookings/${encodeURIComponent(id)}/respond`, { action });
  return r.data.booking;
}

export async function uploadCarPhoto(uri: string): Promise<string> {
  const form = new FormData();
  form.append('file', { uri, name: 'car.jpg', type: 'image/jpeg' } as any);
  const r = await api.post<{ url: string }>('/car-rental/upload-photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return r.data.url;
}
