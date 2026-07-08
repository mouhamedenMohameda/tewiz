import { api } from './api';

export type ProblemType =
  | 'pneu' | 'batterie' | 'essence' | 'moteur' | 'remorquage' | 'accident' | 'autre';

export const PROBLEM_META: Record<ProblemType, { labelKey: string; emoji: string }> = {
  pneu:       { labelKey: 'roadside.problem.pneu',       emoji: '🛞' },
  batterie:   { labelKey: 'roadside.problem.batterie',   emoji: '🔋' },
  essence:    { labelKey: 'roadside.problem.essence',    emoji: '⛽' },
  moteur:     { labelKey: 'roadside.problem.moteur',     emoji: '🛠️' },
  remorquage: { labelKey: 'roadside.problem.remorquage', emoji: '🚛' },
  accident:   { labelKey: 'roadside.problem.accident',   emoji: '💥' },
  autre:      { labelKey: 'roadside.problem.autre',      emoji: '❓' },
};

export const PROBLEM_ORDER: ProblemType[] =
  ['pneu', 'batterie', 'essence', 'moteur', 'remorquage', 'accident', 'autre'];

export type RoadsideStatus =
  'searching' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' | 'unresolved';

export interface RoadsideRequest {
  id: string;
  problemType: ProblemType;
  note: string | null;
  addressLabel: string | null;
  status: RoadsideStatus;
  location: { lat: number; lng: number };
  searchRadiusM: number;
  createdAt: string;
  provider: {
    name: string;
    phone: string;
    ratingAvg: number | null;
    location: { lat: number; lng: number } | null;
  } | null;
  hotlinePhone: string | null;
}

export interface ProviderInboxItem {
  id: string;
  problemType: ProblemType;
  note: string | null;
  addressLabel: string | null;
  location: { lat: number; lng: number };
  distanceM: number;
  requesterName: string;
  createdAt: string;
}

export interface CreateRoadsidePayload {
  problem_type: ProblemType;
  lat: number;
  lng: number;
  address_label?: string;
  note?: string;
  radius_m?: number;
}

export async function createRoadside(payload: CreateRoadsidePayload): Promise<{
  request: RoadsideRequest;
  providersNotified: number;
}> {
  const r = await api.post<{ request: RoadsideRequest; providersNotified: number }>('/roadside/requests', payload);
  return r.data;
}

export async function getCurrentRoadside(): Promise<RoadsideRequest | null> {
  const r = await api.get<{ request: RoadsideRequest }>('/roadside/requests/current', {
    validateStatus: (s) => s === 200 || s === 204,
  });
  return r.status === 204 ? null : r.data.request;
}

export async function cancelRoadside(id: string, reason?: string): Promise<void> {
  await api.post(`/roadside/requests/${encodeURIComponent(id)}/cancel`, { reason });
}

// --- Provider ---

export interface ProviderProfile {
  offersRoadside: boolean;
  specialties: ProblemType[];
}

export async function getRoadsideProfile(): Promise<ProviderProfile> {
  const r = await api.get<ProviderProfile>('/roadside/provider');
  return r.data;
}

export async function setRoadsideProfile(offersRoadside: boolean, specialties: ProblemType[]): Promise<ProviderProfile> {
  const r = await api.put<ProviderProfile>('/roadside/provider', {
    offers_roadside: offersRoadside,
    specialties,
  });
  return r.data;
}

export async function roadsideInbox(lat: number, lng: number): Promise<ProviderInboxItem[]> {
  const r = await api.get<{ requests: ProviderInboxItem[] }>(
    `/roadside/inbox?lat=${lat}&lng=${lng}`,
  );
  return r.data.requests;
}

export interface AcceptResult {
  request_id: string;
  problem_type: ProblemType;
  note: string | null;
  location: { lat: number; lng: number };
  address_label: string | null;
  requester_name: string;
  requester_phone: string;
}

export async function acceptRoadside(id: string): Promise<AcceptResult> {
  const r = await api.post<AcceptResult>(`/roadside/requests/${encodeURIComponent(id)}/accept`);
  return r.data;
}

export async function declineRoadside(id: string): Promise<void> {
  await api.post(`/roadside/requests/${encodeURIComponent(id)}/decline`);
}

export async function setRoadsideStatus(id: string, status: 'in_progress' | 'completed'): Promise<void> {
  await api.post(`/roadside/requests/${encodeURIComponent(id)}/status`, { status });
}
