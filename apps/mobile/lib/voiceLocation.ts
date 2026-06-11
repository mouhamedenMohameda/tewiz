/**
 * Voice-to-Location client.
 *
 * Talks to the main Tewiz API which proxies to the internal
 * voice-location-api. Rider auth is the regular JWT (added by `api.ts`),
 * so this file doesn't ship any API key.
 */

import { NativeModules, Platform } from 'react-native';
import { api } from './api';

/**
 * Best-effort device-locale lookup with zero deps.
 *
 * Voice STT accuracy improves substantially when we hint the language
 * (Whisper auto-detect is unreliable on short utterances, especially for
 * fr/ar mixed Hassaniya). We send whatever the device reports; the server
 * normalizes to its allow-list (fr / ar / en).
 */
function detectDeviceLocale(): string | null {
  try {
    if (Platform.OS === 'ios') {
      const settings = (NativeModules as { SettingsManager?: { settings?: Record<string, unknown> } })
        .SettingsManager?.settings;
      const raw = (settings?.AppleLocale ?? (settings?.AppleLanguages as string[] | undefined)?.[0]);
      return typeof raw === 'string' ? raw : null;
    }
    if (Platform.OS === 'android') {
      const i18n = (NativeModules as { I18nManager?: { localeIdentifier?: string } }).I18nManager;
      return i18n?.localeIdentifier ?? null;
    }
  } catch {
    // NativeModules layout varies between RN versions — never let this crash a ride.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type Side = 'pickup' | 'destination';

export interface ExtractedPlace {
  primary: string;
  landmarks: string[];
  raw_phrase: string | null;
  locality: string | null;
  confidence: 'high' | 'medium' | 'low';
  ambiguity_note: string | null;
}

export interface Candidate {
  poi_id: number;
  name: string;
  name_fr: string | null;
  name_ar: string | null;
  osm_kind: string;
  osm_value: string | null;
  lat: number;
  lng: number;
  google_place_id: string | null;
  popularity: number;
  similarity: number;
  distance_to_landmarks_m: number | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface MatchedLandmark {
  query: string;
  name: string;
  lat: number;
  lng: number;
  similarity: number;
}

export interface Location {
  lat: number;
  lng: number;
  address: string;
  place_id: string;
  types: string[];
  precision: 'high' | 'medium' | 'low';
  viewport_diagonal_m: number | null;
}

export interface SideBlock {
  extracted: ExtractedPlace;
  location: Location | null;
  needs_confirmation: boolean;
  source: 'local' | 'google' | 'none';
  candidates: Candidate[];
  matched_landmarks: MatchedLandmark[];
}

export interface VoiceToLocationResponse {
  ok: boolean;
  request_id: string | null;
  transcript: { text: string; language: string | null };
  intent: 'pickup_only' | 'destination_only' | 'both' | 'neither';
  pickup: SideBlock | null;
  destination: SideBlock | null;
  needs_confirmation: boolean;
}

export interface ConfirmResponse {
  ok: boolean;
  confirmation_id: number;
  candidate_rank: number | null;
  was_top_candidate: boolean | null;
  source: 'local' | 'google' | 'manual' | 'free_text';
  popularity_updated: boolean;
  seeded: 'seeded' | 'updated' | 'skipped_already_in_corpus' | 'skipped_low_quality' | 'not_applicable';
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Upload a recorded audio file (m4a/wav/webm) to the backend.
 *
 * `audioUri` comes from expo-av Recording.getURI(). On native platforms
 * it's a file:// path; on web it's a blob: URL. Both are handed straight
 * to React Native's FormData which knows how to stream them.
 */
export async function voiceToLocation(audioUri: string): Promise<VoiceToLocationResponse> {
  const form = new FormData();
  // React Native's FormData accepts the {uri, name, type} shape and
  // streams the file from disk — no need to read it into memory.
  form.append('audio', {
    uri: audioUri,
    name: filenameFromUri(audioUri),
    type: mimeFromUri(audioUri),
  } as unknown as Blob);

  // Hint Whisper with the device locale. Server treats this as optional
  // and falls back to auto-detect if it's missing or unsupported.
  const locale = detectDeviceLocale();
  if (locale) form.append('language_hint', locale);

  const { data } = await api.post<VoiceToLocationResponse>(
    '/rider/voice-to-location',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Whisper + Claude + Google can take a few seconds.
      timeout: 30_000,
    },
  );
  return data;
}

export interface ConfirmPayload {
  request_id: string;
  side: Side;
  place_id: string | null;
  lat: number;
  lng: number;
  name?: string | null;
}

export async function confirmLocation(payload: ConfirmPayload): Promise<ConfirmResponse> {
  const { data } = await api.post<ConfirmResponse>(
    '/rider/voice-to-location/confirm',
    payload,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
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
