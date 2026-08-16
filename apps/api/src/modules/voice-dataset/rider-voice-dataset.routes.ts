import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../middleware/error.js';
import { perUserLimiter } from '../../middleware/rate-limit.js';
import { uploadAudio } from '../../middleware/upload.js';
import { requireTester } from './require-tester.js';
import { nextScenario, getCoverage } from './scenario.js';
import * as dataset from './voice-dataset.service.js';

// Parent (riderRouter) enforces requireAuth + requireRole('rider', 'captain').
export const riderVoiceDatasetRouter = Router();
riderVoiceDatasetRouter.use(requireTester);

// Generous compared with the voice-ride limiter: recording samples IS the job
// here, and a productive session is dozens of uploads in an hour. The cap only
// exists so a stuck client retrying in a loop cannot fill the disk.
const uploadLimiter = perUserLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  message: 'Trop d\'enregistrements envoyés. Réessayez dans une heure.',
});

/**
 * GET /rider/voice-dataset/scenario
 * The next recording assignment, chosen from the least-covered value on each
 * stratification axis. Handed out BEFORE recording; carries no place names, so
 * the tester picks the actual locations from their own knowledge and speaks
 * them naturally instead of reading a label off the screen.
 */
riderVoiceDatasetRouter.get('/scenario', async (_req, res) => {
  res.json(await nextScenario());
});

/**
 * GET /rider/voice-dataset/coverage
 * Per-axis counts, so the collection screen can show what is still missing.
 */
riderVoiceDatasetRouter.get('/coverage', async (_req, res) => {
  res.json(await getCoverage());
});

/**
 * GET /rider/voice-dataset/pois?q=...&zone=...
 * POI picker backing the annotation step. `q` fuzzy-searches the whole corpus;
 * `zone` (no `q`) returns the popular POIs of the assigned moughataa for the
 * one-tap chips.
 */
riderVoiceDatasetRouter.get('/pois', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const zone = typeof req.query.zone === 'string' ? req.query.zone : '';

  if (q.trim().length >= 2) {
    res.json(await dataset.searchPois(q));
    return;
  }
  if (zone) {
    res.json(await dataset.zonePois(zone));
    return;
  }
  res.json([]);
});

/**
 * GET /rider/voice-dataset/samples?pendingTranscript=1
 * The caller's own submissions. With the flag, only those whose transcript is
 * still missing — the queue the tester works through when they have a keyboard
 * and a spare moment.
 */
riderVoiceDatasetRouter.get('/samples', async (req, res) => {
  const pendingTranscriptOnly = req.query.pendingTranscript === '1';
  res.json(
    await dataset.listSamplesForCollector(req.user!.id, { pendingTranscriptOnly }),
  );
});

/** GET /rider/voice-dataset/stats — contribution counters for the screen. */
riderVoiceDatasetRouter.get('/stats', async (req, res) => {
  res.json(await dataset.getCollectorStats(req.user!.id));
});

/**
 * POST /rider/voice-dataset/samples
 * Multipart: field "audio" (m4a) plus the annotation as text fields.
 *
 * The scenario fields are echoed back by the client rather than re-read from
 * the server, because a tester is allowed to correct them: if the assignment
 * said "round_trip" but what came out of their mouth was a plain "from → to",
 * the row must record what was actually said. Storing the assignment instead
 * of the reality would quietly mislabel the corpus.
 */
riderVoiceDatasetRouter.post(
  '/samples',
  uploadLimiter,
  uploadAudio.single('audio'),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new HttpError(400, 'audio_required', 'Upload the audio as multipart field "audio".');
    }

    const body = req.body ?? {};
    const str = (k: string): string | undefined =>
      typeof body[k] === 'string' && body[k].trim() ? body[k].trim() : undefined;

    const poiId = (k: string): number | null => {
      const raw = str(k);
      if (raw === undefined) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new HttpError(400, 'bad_poi_id', `${k} must be a positive integer POI id.`);
      }
      return n;
    };

    const durationRaw = str('durationS');
    const durationParsed = durationRaw ? Number(durationRaw) : undefined;

    const sample = await dataset.createSample({
      collectorUserId: req.user!.id,
      audio: { buffer: file.buffer, mimetype: file.mimetype },
      durationS:
        durationParsed !== undefined && Number.isFinite(durationParsed) && durationParsed > 0
          ? Math.round(durationParsed)
          : undefined,
      pickupPoiId: poiId('pickupPoiId'),
      destinationPoiId: poiId('destinationPoiId'),
      isOpen: str('isOpen') === 'true',
      transcriptGold: str('transcriptGold') ?? null,
      structure: dataset.parseStructure(str('structure')),
      noise: dataset.parseNoise(str('noise')),
      language: dataset.parseLanguage(str('language')),
      difficulty: dataset.parseDifficulty(str('difficulty')),
      zone: dataset.parseZone(str('zone')),
      speakerGender: str('speakerGender') ?? null,
      speakerAgeBand: str('speakerAgeBand') ?? null,
    });

    res.status(201).json(sample);
  },
);

/**
 * PATCH /rider/voice-dataset/samples/:id/transcript
 * Fills in a transcript that was skipped at recording time.
 */
const transcriptBody = z.object({ transcriptGold: z.string().trim().min(1).max(2000) });

riderVoiceDatasetRouter.patch('/samples/:id/transcript', async (req, res) => {
  const { transcriptGold } = transcriptBody.parse(req.body);
  res.json(await dataset.setTranscript(req.params.id!, req.user!.id, transcriptGold));
});
