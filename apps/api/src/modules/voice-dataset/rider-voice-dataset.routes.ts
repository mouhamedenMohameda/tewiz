import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../middleware/error.js';
import { perUserLimiter } from '../../middleware/rate-limit.js';
import { uploadAudio } from '../../middleware/upload.js';
import { requireTester } from './require-tester.js';
import {
  nextScenario, getCoverage, zoneCentre, SCENARIO_ZONE_CODES, SCENARIO_NOISES,
} from './scenario.js';
import { buildAssignment } from './assignment.js';
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
 * GET /rider/voice-dataset/assignment
 * The same assignment plus the two concrete POIs the tester should speak.
 *
 * The response DOES carry each place's written name — the client withholds it
 * during recording and reveals it afterwards for confirmation. Keeping it
 * server-side until a second request would cost a round trip at the exact
 * moment the tester is waiting, and the name is not a secret: the point is
 * only that it is not on screen while they speak.
 */
riderVoiceDatasetRouter.get('/assignment', async (req, res) => {
  const scenario = await nextScenario();

  // Two axes the tester declares rather than receives, because they describe
  // where the tester ALREADY is — they record along their ordinary journeys,
  // not on trips made for collection.
  //
  //   zone  — someone standing in Arafat can name Arafat's landmarks; someone
  //           who has never been there cannot, and an unnameable place yields
  //           no sample at all.
  //   noise — the server used to assign "in the street" to a tester sitting at
  //           a desk. You cannot manufacture a street on demand; asking is the
  //           only version of this axis that can actually be satisfied.
  //
  // Both stay recorded on the sample, so the analysis can see that zone
  // correlates with collector rather than being blind to it.
  const declaredZone = typeof req.query.zone === 'string' ? req.query.zone : '';
  const declaredNoise = typeof req.query.noise === 'string' ? req.query.noise : '';

  if (declaredZone && SCENARIO_ZONE_CODES.includes(declaredZone)) {
    scenario.zone = declaredZone;
  }
  if (declaredNoise && (SCENARIO_NOISES as readonly string[]).includes(declaredNoise)) {
    scenario.noise = declaredNoise as typeof scenario.noise;
  }

  res.json(await buildAssignment(scenario));
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
    // The assigned zone biases ranking towards the moughataa the tester was
    // told to draw places from — the cheapest available fix for homonyms,
    // which Nouakchott has plenty of.
    res.json(await dataset.searchPois(q, { near: zoneCentre(zone) ?? undefined }));
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
      // Defaults to 'free': an older client that does not send the field was
      // necessarily picking its own places.
      assignmentMode: str('assignmentMode') === 'assigned' ? 'assigned' : 'free',
      nameRevealed: str('nameRevealed') === 'true',
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
