export type VoiceRideStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface LatLngLabel {
  lat: number;
  lng: number;
  label: string | null;
}

export interface VoiceRideRequest {
  id: string;
  userId: string;
  status: VoiceRideStatus;
  audioMime: string;
  audioDurationS: number | null;
  transcript: string | null;
  pickup: LatLngLabel | null;
  dropoff: LatLngLabel | null;
  rideId: string | null;
  rejectReason: string | null;
  createdAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  user: { id: string; fullName: string | null; phone: string };
}

export type PoiSource = 'local' | 'google' | 'nominatim';

export interface PoiCandidate {
  source: PoiSource;
  placeId: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  types: string[];
  similarity?: number;
  popularity?: number;
}

export interface PoiSearchResponse {
  candidates: PoiCandidate[];
  local: number;
  external: number;
}

/** A pin the dispatcher has placed, carrying POI provenance for auto-seed. */
export interface Pin {
  lat: number;
  lng: number;
  label?: string;
  placeId?: string;
  name?: string;
  source?: PoiSource;
  types?: string[];
}

export type PinSide = 'pickup' | 'dropoff';
