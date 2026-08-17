/**
 * Voice-dataset client — ground-truth collection for the Hassaniya
 * voice-to-ride pipeline.
 *
 * Only accounts flagged `isTester` can reach these endpoints; the server
 * enforces it and the screen is hidden otherwise.
 */

import { api } from './api';

export type ScenarioStructure =
  | 'pickup_only'
  | 'destination_only'
  | 'from_to'
  | 'round_trip'
  | 'open_ride';

export type ScenarioNoise = 'quiet_indoor' | 'street' | 'moving_car' | 'wind';

export type ScenarioLanguage = 'hassaniya' | 'hassaniya_french' | 'french' | 'arabic';

export type ScenarioDifficulty = 'plain' | 'landmarks' | 'homonym' | 'vague';

export interface Scenario {
  structure: ScenarioStructure;
  noise: ScenarioNoise;
  language: ScenarioLanguage;
  difficulty: ScenarioDifficulty;
  zone: string;
}

export type AssignmentMode = 'assigned' | 'free';

export interface AssignedLandmark {
  label: string;
  kind: string;
  distanceM: number;
}

export interface AssignedPlace {
  poiId: number;
  /**
   * The moughataa the POI actually sits in — not the scenario's assigned zone.
   *
   * Optional because Metro ships JS ahead of the API deploy: a client running
   * against an older server receives assignments without this field.
   */
  district?: string;
  /** Deliberately NOT shown while recording — see getAssignment. */
  label: string;
  nameAr: string | null;
  kind: string;
  lat: number;
  lng: number;
  /** POIs in the corpus sharing this exact name. 1 = unique. */
  nameCount: number;
  /** POIs of the same category within ~2 km. 1 = the descriptor identifies it. */
  descriptorCount?: number;
  landmarks: AssignedLandmark[];
}

export interface Assignment {
  scenario: Scenario;
  pickup: AssignedPlace | null;
  destination: AssignedPlace | null;
  tripDistanceM: number | null;
}

export interface PoiOption {
  id: number;
  label: string;
  nameAr: string | null;
  kind: string;
  lat: number;
  lng: number;
}

export interface DatasetSample {
  id: string;
  audioDurationS: number | null;
  pickup: { poiId: number; label: string | null } | null;
  destination: { poiId: number; label: string | null } | null;
  isOpen: boolean;
  transcriptGold: string | null;
  scenario: Scenario;
  status: 'collected' | 'validated' | 'rejected';
  assignmentMode: AssignmentMode;
  reviewNote: string | null;
  createdAt: string;
}

export interface CollectorStats {
  total: number;
  withTranscript: number;
  validated: number;
  rejected: number;
}

export interface AxisBucket {
  value: string;
  count: number;
}

export interface Coverage {
  structure: AxisBucket[];
  noise: AxisBucket[];
  language: AxisBucket[];
  difficulty: AxisBucket[];
  zone: AxisBucket[];
  total: number;
}

const BASE = '/rider/voice-dataset';

/** The next recording assignment, drawn from the least-covered axis values. */
export async function getScenario(): Promise<Scenario> {
  const { data } = await api.get<Scenario>(`${BASE}/scenario`);
  return data;
}

/**
 * A scenario PLUS the two concrete POIs to speak.
 *
 * The response carries each place's written name, but the screen withholds it
 * until after the recording: showing it would turn spontaneous speech into read
 * speech, which is measurably easier for an ASR and would flatter every
 * architecture measured on the corpus.
 */
export async function getAssignment(): Promise<Assignment> {
  const { data } = await api.get<Assignment>(`${BASE}/assignment`);
  return data;
}

export async function getCoverage(): Promise<Coverage> {
  const { data } = await api.get<Coverage>(`${BASE}/coverage`);
  return data;
}

export async function getStats(): Promise<CollectorStats> {
  const { data } = await api.get<CollectorStats>(`${BASE}/stats`);
  return data;
}

/**
 * POI search across the whole corpus (2+ characters).
 *
 * `zone` is not a filter — it biases ranking towards the assigned moughataa so
 * that, among several POIs sharing a name, the nearby one comes first.
 */
export async function searchPois(q: string, zone?: string): Promise<PoiOption[]> {
  const { data } = await api.get<PoiOption[]>(`${BASE}/pois`, { params: { q, zone } });
  return data;
}

/** Popular POIs of a moughataa, for the one-tap chips. */
export async function zonePois(zone: string): Promise<PoiOption[]> {
  const { data } = await api.get<PoiOption[]>(`${BASE}/pois`, { params: { zone } });
  return data;
}

export async function listPendingTranscripts(): Promise<DatasetSample[]> {
  const { data } = await api.get<DatasetSample[]>(`${BASE}/samples`, {
    params: { pendingTranscript: '1' },
  });
  return data;
}

export interface SubmitSampleInput {
  audioUri: string;
  durationS: number;
  pickupPoiId: number | null;
  destinationPoiId: number | null;
  isOpen: boolean;
  transcriptGold: string | null;
  scenario: Scenario;
  speakerGender: string | null;
  speakerAgeBand: string | null;
  assignmentMode: AssignmentMode;
  /** True when the tester displayed an assigned name before speaking. */
  nameRevealed: boolean;
}

export async function submitSample(input: SubmitSampleInput): Promise<DatasetSample> {
  const form = new FormData();
  form.append('audio', {
    uri: input.audioUri,
    name: filenameFromUri(input.audioUri),
    type: mimeFromUri(input.audioUri),
  } as unknown as Blob);

  form.append('durationS', String(Math.round(input.durationS)));
  form.append('isOpen', input.isOpen ? 'true' : 'false');
  form.append('structure', input.scenario.structure);
  form.append('noise', input.scenario.noise);
  form.append('language', input.scenario.language);
  form.append('difficulty', input.scenario.difficulty);
  form.append('zone', input.scenario.zone);

  // Omit rather than send empty: the server reads a missing field as null, and
  // an empty string would fail the positive-integer guard on the POI fields.
  if (input.pickupPoiId !== null) form.append('pickupPoiId', String(input.pickupPoiId));
  if (input.destinationPoiId !== null) {
    form.append('destinationPoiId', String(input.destinationPoiId));
  }
  if (input.transcriptGold) form.append('transcriptGold', input.transcriptGold);
  if (input.speakerGender) form.append('speakerGender', input.speakerGender);
  if (input.speakerAgeBand) form.append('speakerAgeBand', input.speakerAgeBand);
  form.append('assignmentMode', input.assignmentMode);
  form.append('nameRevealed', input.nameRevealed ? 'true' : 'false');

  const { data } = await api.post<DatasetSample>(`${BASE}/samples`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30_000,
  });
  return data;
}

export async function setTranscript(id: string, transcriptGold: string): Promise<DatasetSample> {
  const { data } = await api.patch<DatasetSample>(`${BASE}/samples/${id}/transcript`, {
    transcriptGold,
  });
  return data;
}

function filenameFromUri(uri: string): string {
  const last = uri.split('/').pop();
  return last && last.includes('.') ? last : 'sample.m4a';
}

function mimeFromUri(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'mp4') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
  if (ext === '3gp') return 'audio/3gpp';
  return 'audio/m4a';
}
