import { Router } from 'express';
import { type AuthedRequest } from '../../middleware/auth.js';
import { requirePhone } from '../../middleware/require-phone.js';
import { HttpError } from '../../middleware/error.js';
import { uploadAudio } from '../../middleware/upload.js';
import * as voiceRides from './voice-rides.service.js';

// Parent (riderRouter) enforces requireAuth + requireRole('rider', 'captain').
export const riderVoiceRidesRouter = Router();

/**
 * POST /rider/voice-rides
 * Multipart upload, field "audio" (m4a). Optional "durationS" field.
 * Creates a pending voice request for an admin to process. Returns the
 * request (without the internal audio key) so the app can open the waiting
 * screen and start polling GET /rider/voice-rides/:id.
 */
riderVoiceRidesRouter.post('/', requirePhone, uploadAudio.single('audio'), async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const file = req.file;
  if (!file) {
    throw new HttpError(
      400,
      'audio_required',
      'Upload the audio file as multipart field "audio".',
    );
  }

  // durationS arrives as a multipart text field, so it's a string if present.
  const durationRaw = typeof req.body?.durationS === 'string' ? req.body.durationS : undefined;
  const durationParsed = durationRaw ? Number(durationRaw) : undefined;
  const durationS =
    durationParsed !== undefined && Number.isFinite(durationParsed) && durationParsed > 0
      ? Math.round(durationParsed)
      : undefined;

  const request = await voiceRides.createVoiceRideRequest({
    userId,
    audio: { buffer: file.buffer, mimetype: file.mimetype },
    durationS,
  });
  res.status(201).json(request);
});

/**
 * GET /rider/voice-rides/:id
 * Polling endpoint for the waiting screen. Embeds the linked ride once the
 * request has been confirmed by an admin.
 */
riderVoiceRidesRouter.get('/:id', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await voiceRides.getVoiceRideRequestForUser(req.params.id!, userId));
});

/**
 * POST /rider/voice-rides/:id/cancel
 * Rider cancels while the request is still pending (waiting-screen button).
 */
riderVoiceRidesRouter.post('/:id/cancel', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await voiceRides.cancelVoiceRideRequest(req.params.id!, userId));
});
