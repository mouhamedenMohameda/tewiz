/**
 * Voice-to-Location proxy.
 *
 * The mobile app uploads audio with a rider JWT; this module re-uploads
 * it to the internal voice-location-api with the server-side API key the
 * client must never see. Same for the /confirm follow-up.
 *
 * Routes (mounted under /rider):
 *   POST /rider/voice-to-location          — multipart "audio"
 *   POST /rider/voice-to-location/confirm  — JSON body
 */

import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';

export const voiceRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // Keep this in sync with voice-location-api MAX_AUDIO_BYTES.
  limits: { fileSize: 10 * 1024 * 1024 },
});

function ensureKey(): string {
  const k = env.VOICE_API_KEY;
  if (!k) {
    throw new Error('VOICE_API_KEY is not configured on the main API');
  }
  return k;
}

// ---------------------------------------------------------------------------
// POST /rider/voice-to-location
// ---------------------------------------------------------------------------

voiceRouter.post('/voice-to-location', upload.single('audio'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({
        error: 'audio_required',
        message: 'Upload the audio file as multipart field "audio".',
      });
      return;
    }

    const url = `${env.VOICE_API_INTERNAL_URL.replace(/\/$/, '')}/v1/voice-to-location`;

    // Build a fresh multipart body from the buffer we received. Node's
    // built-in FormData + Blob handle the boundary header for us.
    const form = new FormData();
    const blob = new Blob([new Uint8Array(file.buffer)], {
      type: file.mimetype || 'application/octet-stream',
    });
    form.append('audio', blob, file.originalname || 'audio.m4a');

    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'X-API-Key': ensureKey() },
      body: form,
    });

    const body = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.send(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /rider/voice-to-location/confirm
// ---------------------------------------------------------------------------

voiceRouter.post('/voice-to-location/confirm', async (req, res, next) => {
  try {
    const url = `${env.VOICE_API_INTERNAL_URL.replace(/\/$/, '')}/v1/voice-to-location/confirm`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': ensureKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const body = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.send(body);
  } catch (err) {
    next(err);
  }
});
