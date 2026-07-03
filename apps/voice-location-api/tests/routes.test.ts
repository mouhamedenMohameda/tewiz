import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { keysMock, requestsMock, transcribeMock, extractTripMock, geocodeMock, resolvePlaceMock, seedMock } =
  vi.hoisted(() => ({
    keysMock: {
      hashKey: (raw: string) => `hash:${raw}`,
      findKeyByHash: vi.fn(),
      countUsageThisMonth: vi.fn(),
      touchLastUsed: vi.fn().mockResolvedValue(undefined),
      logUsage: vi.fn().mockResolvedValue(undefined),
    },
    requestsMock: {
      insertRequest: vi.fn(),
      findRequestById: vi.fn(),
      insertConfirmation: vi.fn(),
    },
    transcribeMock: vi.fn(),
    extractTripMock: vi.fn(),
    geocodeMock: vi.fn(),
    resolvePlaceMock: vi.fn(),
    seedMock: {
      autoSeedFromGoogle: vi.fn(),
      bumpPopularity: vi.fn(),
    },
  }));

vi.mock('../src/config.js', () => ({
  env: { MAX_AUDIO_BYTES: 10 * 1024 * 1024 },
}));
vi.mock('../src/db/keys.js', () => keysMock);
vi.mock('../src/db/requests.js', () => requestsMock);
vi.mock('../src/services/whisper.js', () => ({ transcribe: transcribeMock }));
vi.mock('../src/services/extractor.js', () => ({ extractTrip: extractTripMock }));
vi.mock('../src/services/geocoder.js', () => ({ geocode: geocodeMock }));
vi.mock('../src/services/poi-resolver.js', () => ({ resolvePlace: resolvePlaceMock }));
vi.mock('../src/services/auto-seed.js', () => seedMock);

import { healthRouter } from '../src/routes/health.js';
import { voiceRouter } from '../src/routes/voice.js';
import { confirmRouter } from '../src/routes/confirm.js';
import { errorHandler, notFound } from '../src/middleware/error.js';

const API_KEY = 'vk_test_key_123456';
const KEY_ROW = { id: 'key-1', is_active: true, monthly_quota: 0 };

let server: Server | null = null;

async function startApp(): Promise<string> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRouter);
  app.use(voiceRouter);
  app.use(confirmRouter);
  app.use(notFound);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return `http://127.0.0.1:${addr.port}`;
}

async function postAudio(
  baseUrl: string,
  opts: { key?: string; file?: { name: string; type: string } | null; languageHint?: string } = {},
) {
  const form = new FormData();
  const file = opts.file === undefined ? { name: 'memo.m4a', type: 'audio/m4a' } : opts.file;
  if (file) {
    form.set('audio', new Blob([Buffer.from('audio-bytes')], { type: file.type }), file.name);
  }
  if (opts.languageHint) form.set('language_hint', opts.languageHint);
  const res = await fetch(`${baseUrl}/v1/voice-to-location`, {
    method: 'POST',
    headers: opts.key === undefined ? { 'x-api-key': API_KEY } : opts.key ? { 'x-api-key': opts.key } : {},
    body: form,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

beforeEach(() => {
  keysMock.findKeyByHash.mockReset();
  keysMock.countUsageThisMonth.mockReset();
  keysMock.findKeyByHash.mockResolvedValue(KEY_ROW);
  keysMock.countUsageThisMonth.mockResolvedValue(0);
  for (const fn of Object.values(requestsMock)) fn.mockReset();
  transcribeMock.mockReset();
  extractTripMock.mockReset();
  geocodeMock.mockReset();
  resolvePlaceMock.mockReset();
  seedMock.autoSeedFromGoogle.mockReset();
  seedMock.bumpPopularity.mockReset();
});

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = null;
});

describe('GET /health', () => {
  it('answers ok without any auth', async () => {
    const baseUrl = await startApp();
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ ok: true, service: 'voice-location-api' });
  });
});

describe('API key gate', () => {
  it('rejects a missing key (401 missing_api_key)', async () => {
    const baseUrl = await startApp();
    const res = await postAudio(baseUrl, { key: '' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_api_key');
  });

  it('rejects an unknown or inactive key (401 invalid_api_key)', async () => {
    keysMock.findKeyByHash.mockResolvedValue(null);
    const baseUrl = await startApp();
    const res = await postAudio(baseUrl);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_api_key');
  });

  it('enforces the monthly quota (429)', async () => {
    keysMock.findKeyByHash.mockResolvedValue({ ...KEY_ROW, monthly_quota: 100 });
    keysMock.countUsageThisMonth.mockResolvedValue(100);
    const baseUrl = await startApp();
    const res = await postAudio(baseUrl);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('quota_exceeded');
  });
});

describe('POST /v1/voice-to-location', () => {
  const extractedPlace = { primary: 'marché capitale', landmarks: [], locality: null };
  const localCandidate = {
    poi_id: 42,
    name: 'Marché Capitale',
    lat: 18.08,
    lng: -15.97,
    google_place_id: null,
    osm_kind: 'amenity',
    osm_value: 'marketplace',
    confidence: 'high',
  };

  it('requires the audio part (400 audio_required)', async () => {
    const baseUrl = await startApp();
    const res = await postAudio(baseUrl, { file: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('audio_required');
  });

  it('rejects a non-audio upload (415)', async () => {
    const baseUrl = await startApp();
    const res = await postAudio(baseUrl, { file: { name: 'notes.txt', type: 'text/plain' } });
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('unsupported_audio_format');
  });

  it('maps a silent recording to 422 empty_transcript', async () => {
    transcribeMock.mockResolvedValue({ text: '', language: null });
    const baseUrl = await startApp();
    const res = await postAudio(baseUrl);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('empty_transcript');
  });

  it('returns ok:false when no place is mentioned', async () => {
    transcribeMock.mockResolvedValue({ text: 'bonjour ça va', language: 'fr' });
    extractTripMock.mockResolvedValue({ intent: 'neither', pickup: null, destination: null });
    const baseUrl = await startApp();
    const res = await postAudio(baseUrl);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: 'no_place_in_transcript' });
  });

  it('resolves via the local corpus first (source: local)', async () => {
    transcribeMock.mockResolvedValue({ text: 'je vais au marché capitale', language: 'fr' });
    extractTripMock.mockResolvedValue({
      intent: 'destination',
      pickup: null,
      destination: extractedPlace,
    });
    resolvePlaceMock.mockResolvedValue({
      top: localCandidate,
      candidates: [localCandidate],
      needs_confirmation: false,
      matched_landmarks: [],
    });
    requestsMock.insertRequest.mockResolvedValue({ id: 'req-1' });
    const baseUrl = await startApp();

    const res = await postAudio(baseUrl, { languageHint: 'fr' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.request_id).toBe('req-1');
    expect(res.body.destination.source).toBe('local');
    expect(res.body.destination.location).toMatchObject({ lat: 18.08, place_id: 'osm:42' });
    expect(geocodeMock).not.toHaveBeenCalled();
    expect(transcribeMock).toHaveBeenCalledWith(expect.anything(), 'memo.m4a', 'fr');
  });

  it('falls back to Google when the corpus is empty (source: google)', async () => {
    transcribeMock.mockResolvedValue({ text: 'vers tevragh zeina', language: 'fr' });
    extractTripMock.mockResolvedValue({
      intent: 'destination',
      pickup: null,
      destination: extractedPlace,
    });
    resolvePlaceMock.mockResolvedValue({ top: null, candidates: [], needs_confirmation: false });
    geocodeMock.mockResolvedValue({
      lat: 18.1,
      lng: -15.95,
      formatted_address: 'Tevragh Zeina, Nouakchott',
      place_id: 'ChIJ123',
      types: ['sublocality'],
      precision: 'medium',
      viewport_diagonal_m: 800,
    });
    requestsMock.insertRequest.mockResolvedValue({ id: 'req-2' });
    const baseUrl = await startApp();

    const res = await postAudio(baseUrl);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.destination.source).toBe('google');
    expect(res.body.destination.location.place_id).toBe('ChIJ123');
  });

  it('still answers when persistence fails (request_id null)', async () => {
    transcribeMock.mockResolvedValue({ text: 'marché', language: 'fr' });
    extractTripMock.mockResolvedValue({
      intent: 'destination',
      pickup: null,
      destination: extractedPlace,
    });
    resolvePlaceMock.mockResolvedValue({
      top: localCandidate,
      candidates: [localCandidate],
      needs_confirmation: false,
      matched_landmarks: [],
    });
    requestsMock.insertRequest.mockRejectedValue(new Error('db down'));
    const baseUrl = await startApp();

    const res = await postAudio(baseUrl);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.request_id).toBeNull();
  });
});

describe('POST /v1/voice-to-location/confirm', () => {
  const REQ_UUID = '5f1e7a10-1111-4222-8333-444455556666';
  const storedRequest = {
    id: REQ_UUID,
    api_key_id: 'key-1',
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    transcript: 'je vais au marché',
    pickup: null,
    destination: {
      candidates: [
        { poi_id: 42, name: 'Marché Capitale', lat: 18.08, lng: -15.97, google_place_id: null },
      ],
      location: { place_id: 'osm:42', lat: 18.08, lng: -15.97, precision: 'high', types: [], address: 'x' },
      source: 'local',
    },
  };

  async function postConfirm(baseUrl: string, body: unknown) {
    const res = await fetch(`${baseUrl}/v1/voice-to-location/confirm`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  const validBody = {
    request_id: REQ_UUID,
    side: 'destination',
    place_id: 'osm:42',
    lat: 18.08,
    lng: -15.97,
    name: 'Marché Capitale',
  };

  it('rejects a body without request_id (400 invalid_body)', async () => {
    const baseUrl = await startApp();
    const res = await postConfirm(baseUrl, { side: 'pickup', lat: 1, lng: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('returns 404 for an unknown request', async () => {
    requestsMock.findRequestById.mockResolvedValue(null);
    const baseUrl = await startApp();
    const res = await postConfirm(baseUrl, validBody);
    expect(res.status).toBe(404);
  });

  it("returns 403 when the request belongs to another key", async () => {
    requestsMock.findRequestById.mockResolvedValue({ ...storedRequest, api_key_id: 'other-key' });
    const baseUrl = await startApp();
    const res = await postConfirm(baseUrl, validBody);
    expect(res.status).toBe(403);
  });

  it('returns 410 when the request has expired', async () => {
    requestsMock.findRequestById.mockResolvedValue({
      ...storedRequest,
      expires_at: new Date(Date.now() - 1000),
    });
    const baseUrl = await startApp();
    const res = await postConfirm(baseUrl, validBody);
    expect(res.status).toBe(410);
  });

  it('records a local top-candidate confirmation and bumps popularity', async () => {
    requestsMock.findRequestById.mockResolvedValue(storedRequest);
    requestsMock.insertConfirmation.mockResolvedValue({ id: 'conf-1' });
    seedMock.bumpPopularity.mockResolvedValue({ updated: true });
    const baseUrl = await startApp();

    const res = await postConfirm(baseUrl, validBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      confirmation_id: 'conf-1',
      was_top_candidate: true,
      candidate_rank: 0,
      source: 'local',
      popularity_updated: true,
    });
    expect(seedMock.bumpPopularity).toHaveBeenCalledWith('osm:42', 5);
  });

  it('auto-seeds a confirmed Google pick that was missing from the corpus', async () => {
    const googleRequest = {
      ...storedRequest,
      destination: {
        candidates: [],
        location: { place_id: 'ChIJ123', lat: 18.1, lng: -15.95, precision: 'medium', types: ['sublocality'], address: 'TZ' },
        source: 'google',
      },
    };
    requestsMock.findRequestById.mockResolvedValue(googleRequest);
    requestsMock.insertConfirmation.mockResolvedValue({ id: 'conf-2' });
    seedMock.bumpPopularity.mockResolvedValue({ updated: false });
    seedMock.autoSeedFromGoogle.mockResolvedValue({ status: 'seeded' });
    const baseUrl = await startApp();

    const res = await postConfirm(baseUrl, {
      ...validBody,
      place_id: 'ChIJ123',
      lat: 18.1,
      lng: -15.95,
      name: 'Tevragh Zeina',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, source: 'google', seeded: 'seeded' });
    expect(seedMock.autoSeedFromGoogle).toHaveBeenCalled();
  });

  it('accepts a free-text pick without place_id', async () => {
    requestsMock.findRequestById.mockResolvedValue(storedRequest);
    requestsMock.insertConfirmation.mockResolvedValue({ id: 'conf-3' });
    const baseUrl = await startApp();

    const res = await postConfirm(baseUrl, { ...validBody, place_id: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, source: 'free_text' });
    expect(seedMock.bumpPopularity).not.toHaveBeenCalled();
  });
});
