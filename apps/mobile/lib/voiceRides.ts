/**
 * Voice-ride client (human-in-the-loop).
 *
 * The rider records a voice memo; we upload it to the main API where a human
 * dispatcher listens and places the ride. The app then polls for status and,
 * once confirmed, jumps to ride tracking. Replaces the old fully-automated
 * voice-to-location flow (lib/voiceLocation.ts).
 */

import { api } from './api';

export type VoiceRideStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface VoiceRideRide {
  id: string;
  status: string;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
}

export interface VoiceRideRequest {
  id: string;
  status: VoiceRideStatus;
  audioDurationS: number | null;
  pickup: { lat: number; lng: number; label: string | null } | null;
  dropoff: { lat: number; lng: number; label: string | null } | null;
  rideId: string | null;
  rejectReason: string | null;
  createdAt: string;
  processedAt: string | null;
  /** Embedded once confirmed (GET only). */
  ride?: VoiceRideRide | null;
}

/**
 * Upload a recorded memo (m4a). `audioUri` is the expo-av Recording URI
 * (file:// on native). Returns the created pending request.
 */
export async function createVoiceRide(
  audioUri: string,
  durationS?: number,
): Promise<VoiceRideRequest> {
  const form = new FormData();
  form.append('audio', {
    uri: audioUri,
    name: filenameFromUri(audioUri),
    type: mimeFromUri(audioUri),
  } as unknown as Blob);
  if (durationS && durationS > 0) {
    form.append('durationS', String(Math.round(durationS)));
  }

  const { data } = await api.post<VoiceRideRequest>('/rider/voice-rides', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30_000,
  });
  return data;
}

/**
 * The rider's currently pending request, or null. Lets the screen resume the
 * waiting phase (and offer cancel) for a request left open in a previous
 * session, instead of soft-locking the rider out of new recordings.
 */
export async function getCurrentVoiceRide(): Promise<VoiceRideRequest | null> {
  const { data } = await api.get<VoiceRideRequest | null>('/rider/voice-rides/current');
  return data ?? null;
}

/** Poll a request's status (embeds the linked ride once confirmed). */
export async function getVoiceRide(id: string): Promise<VoiceRideRequest> {
  const { data } = await api.get<VoiceRideRequest>(`/rider/voice-rides/${id}`);
  return data;
}

/** Cancel while still pending. */
export async function cancelVoiceRide(id: string): Promise<VoiceRideRequest> {
  const { data } = await api.post<VoiceRideRequest>(`/rider/voice-rides/${id}/cancel`);
  return data;
}

// ---------------------------------------------------------------------------
// Helpers (shared shape with the retired voiceLocation client)
// ---------------------------------------------------------------------------

function filenameFromUri(uri: string): string {
  const last = uri.split('/').pop() ?? 'audio.m4a';
  return last.includes('.') ? last : `${last}.m4a`;
}

function mimeFromUri(uri: string): string {
  const ext = (uri.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'webm': return 'audio/webm';
    case 'caf': return 'audio/x-caf';
    case 'm4a':
    case 'mp4':
    default: return 'audio/m4a';
  }
}
