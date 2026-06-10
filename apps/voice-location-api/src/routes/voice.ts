import { Router } from 'express';
import multer from 'multer';
import { env } from '../config.js';
import { requireApiKey } from '../middleware/auth.js';
import { logUsage } from '../db/keys.js';
import { insertRequest } from '../db/requests.js';
import { transcribe } from '../services/whisper.js';
import { extractTrip, type ExtractedPlace } from '../services/extractor.js';
import { geocode, type GeocodeResult } from '../services/geocoder.js';
import { resolvePlace, type ResolverResult, type ResolverCandidate } from '../services/poi-resolver.js';

export const voiceRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_AUDIO_BYTES },
});

const ACCEPTED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
]);

const ACCEPTED_EXT = new Set([
  '.mp3', '.m4a', '.mp4', '.wav', '.ogg', '.oga', '.webm', '.flac', '.aac',
]);

function isAcceptedAudio(mime: string | undefined, filename: string | undefined): boolean {
  if (mime && ACCEPTED_MIME.has(mime)) return true;
  if (!filename) return false;
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return ACCEPTED_EXT.has(filename.slice(dot).toLowerCase());
}

// ---------------------------------------------------------------------------
// Per-side resolution: tries the POI corpus first, then falls back to Google
// Geocoding if no candidates are found.
// ---------------------------------------------------------------------------

type LocationPayload = {
  lat: number;
  lng: number;
  address: string;
  place_id: string;
  types: string[];
  precision: 'high' | 'medium' | 'low';
  viewport_diagonal_m: number | null;
};

function geocodeResultToLocation(g: GeocodeResult): LocationPayload {
  return {
    lat: g.lat,
    lng: g.lng,
    address: g.formatted_address,
    place_id: g.place_id,
    types: g.types,
    precision: g.precision,
    viewport_diagonal_m: g.viewport_diagonal_m,
  };
}

function candidateToLocation(c: ResolverCandidate): LocationPayload {
  return {
    lat: c.lat,
    lng: c.lng,
    address: `${c.name}, Nouakchott, Mauritanie`,
    place_id: c.google_place_id ?? `osm:${c.poi_id}`,
    types: [c.osm_kind, c.osm_value].filter((x): x is string => !!x),
    precision: c.confidence,
    viewport_diagonal_m: null,
  };
}

interface SideResult {
  extracted: ExtractedPlace;
  /** Resolution from local POI corpus — top + alternates + landmark info. */
  resolver: ResolverResult | null;
  /** Google fallback result, when used (corpus empty). */
  google: GeocodeResult | null;
  /** Final picked location (top candidate, or Google, or null). */
  location: LocationPayload | null;
  /** True if multiple candidates are close → client should ask the user. */
  needs_confirmation: boolean;
  /** Source of the final location (for clients to badge in UI). */
  source: 'local' | 'google' | 'none';
  /** For logging. */
  geocode_status: string;
}

async function resolveSide(place: ExtractedPlace | null): Promise<SideResult | null> {
  if (!place) return null;

  // 1. Try local corpus with landmark-aware ranking.
  let resolver: ResolverResult | null = null;
  try {
    resolver = await resolvePlace(place);
  } catch {
    // Corpus errors are non-fatal — fall through to Google.
  }

  if (resolver && resolver.top) {
    return {
      extracted: place,
      resolver,
      google: null,
      location: candidateToLocation(resolver.top),
      needs_confirmation: resolver.needs_confirmation,
      source: 'local',
      geocode_status: 'LOCAL_HIT',
    };
  }

  // 2. Fallback: ask Google. Build a geocoder-friendly query from primary +
  //    landmarks + locality so Google can leverage the same context.
  const parts = [place.primary, ...place.landmarks, place.locality ?? 'Nouakchott', 'Mauritania']
    .filter((x, i, a) => x && a.indexOf(x) === i);
  const query = parts.join(', ');

  let google: GeocodeResult | null = null;
  try {
    google = await geocode(query);
  } catch (err) {
    return {
      extracted: place,
      resolver,
      google: null,
      location: null,
      needs_confirmation: false,
      source: 'none',
      geocode_status: `GOOGLE_ERROR:${(err as Error).message.slice(0, 60)}`,
    };
  }

  if (!google) {
    return {
      extracted: place,
      resolver,
      google: null,
      location: null,
      needs_confirmation: false,
      source: 'none',
      geocode_status: 'ZERO_RESULTS',
    };
  }

  // Google gave us a single point. We mark needs_confirmation when its
  // precision is "low" (i.e. it geocoded to a wide area, not a specific
  // address), so the client can prompt the user.
  return {
    extracted: place,
    resolver,
    google,
    location: geocodeResultToLocation(google),
    needs_confirmation: google.precision === 'low',
    source: 'google',
    geocode_status: 'GOOGLE_OK',
  };
}

function sideToResponseBlock(side: SideResult | null) {
  if (!side) return null;
  return {
    extracted: side.extracted,
    location: side.location,
    needs_confirmation: side.needs_confirmation,
    source: side.source,
    candidates: side.resolver?.candidates ?? [],
    matched_landmarks: side.resolver?.matched_landmarks ?? [],
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

voiceRouter.post(
  '/v1/voice-to-location',
  requireApiKey,
  upload.single('audio'),
  async (req, res, next) => {
    const t0 = Date.now();
    const apiKey = req.apiKey!;
    const file = req.file;

    const usage = {
      apiKeyId: apiKey.id,
      endpoint: '/v1/voice-to-location',
      statusCode: 200,
      durationMs: 0,
      audioBytes: file?.size,
      transcriptChars: 0,
      detectedLang: undefined as string | undefined,
      geocodeStatus: undefined as string | undefined,
      errorMessage: undefined as string | undefined,
    };

    try {
      if (!file) {
        usage.statusCode = 400;
        usage.errorMessage = 'audio file missing';
        res.status(400).json({
          error: 'audio_required',
          message: 'Upload the audio file as multipart field "audio".',
        });
        return;
      }
      if (!isAcceptedAudio(file.mimetype, file.originalname)) {
        usage.statusCode = 415;
        usage.errorMessage = `unsupported mime=${file.mimetype} name=${file.originalname}`;
        res.status(415).json({
          error: 'unsupported_audio_format',
          message: `mime "${file.mimetype}" / filename "${file.originalname}" not supported`,
          accepted_mime: [...ACCEPTED_MIME],
          accepted_extensions: [...ACCEPTED_EXT],
        });
        return;
      }

      // 1. Whisper STT
      const transcript = await transcribe(file.buffer, file.originalname || 'audio.m4a');
      usage.transcriptChars = transcript.text.length;
      usage.detectedLang = transcript.language ?? undefined;

      if (!transcript.text) {
        usage.statusCode = 422;
        usage.errorMessage = 'empty transcript';
        res.status(422).json({
          error: 'empty_transcript',
          message: 'Whisper returned no text — audio was silent or unintelligible.',
        });
        return;
      }

      // 2. Claude extracts pickup + destination (each may be null)
      const trip = await extractTrip(transcript.text, transcript.language);

      if (trip.intent === 'neither' || (!trip.pickup && !trip.destination)) {
        res.status(200).json({
          ok: false,
          reason: 'no_place_in_transcript',
          transcript: { text: transcript.text, language: transcript.language },
          trip,
          pickup: null,
          destination: null,
          location: null,
        });
        return;
      }

      // 3. Resolve each side via local corpus (with landmark ranking),
      //    falling back to Google when the corpus comes up empty.
      const [pickupSide, destinationSide] = await Promise.all([
        resolveSide(trip.pickup),
        resolveSide(trip.destination),
      ]);

      usage.geocodeStatus = [
        pickupSide ? `P:${pickupSide.geocode_status}` : null,
        destinationSide ? `D:${destinationSide.geocode_status}` : null,
      ].filter(Boolean).join(' ') || 'NONE';

      const pickupBlock = sideToResponseBlock(pickupSide);
      const destinationBlock = sideToResponseBlock(destinationSide);

      // Backward-compatibility: the original response had a single
      // "location" + "extracted" pair. We mirror those from whichever
      // side we have (pickup first, else destination).
      const primary = pickupBlock ?? destinationBlock;

      const anyLocated = !!(pickupSide?.location || destinationSide?.location);
      const anyNeedsConfirm = !!(pickupSide?.needs_confirmation || destinationSide?.needs_confirmation);

      // Persist the resolved blocks so /confirm can validate the user's
      // pick against the candidates we actually offered. Soft-failure so
      // a DB hiccup doesn't break the response.
      let requestId: string | null = null;
      try {
        const rec = await insertRequest({
          apiKeyId: apiKey.id,
          transcript: transcript.text,
          detectedLang: transcript.language,
          intent: trip.intent,
          pickup: pickupBlock,
          destination: destinationBlock,
        });
        requestId = rec.id;
      } catch {
        // Persistence is best-effort; client just won't get a request_id.
      }

      res.status(200).json({
        ok: anyLocated,
        request_id: requestId,
        transcript: { text: transcript.text, language: transcript.language },
        intent: trip.intent,
        pickup: pickupBlock,
        destination: destinationBlock,
        // Aggregate flag the client can use to decide whether to render
        // the candidate-picker UI for either side.
        needs_confirmation: anyNeedsConfirm,

        // ----- Legacy fields (deprecated, kept for old clients) -----
        extracted: primary?.extracted
          ? {
              query: [primary.extracted.primary, primary.extracted.locality ?? 'Nouakchott', 'Mauritania']
                .filter((x, i, a) => x && a.indexOf(x) === i)
                .join(', '),
              place_name: primary.extracted.primary,
              locality: primary.extracted.locality,
              landmark: primary.extracted.landmarks[0] ?? null,
              confidence: primary.extracted.confidence,
              ambiguity_note: primary.extracted.ambiguity_note,
            }
          : null,
        location: primary?.location ?? null,
        confidence: primary?.location?.precision ?? 'low',
      });
    } catch (err) {
      usage.statusCode = 500;
      usage.errorMessage = err instanceof Error ? err.message : 'unknown';
      next(err);
    } finally {
      usage.durationMs = Date.now() - t0;
      logUsage(usage).catch(() => undefined);
    }
  },
);
