import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { env } from '../config.js';
import { getWhisperHint } from './pois.js';

// maxRetries: SDK handles 429 / 5xx with exponential backoff transparently.
// timeout: a single STT call shouldn't exceed ~15 s for a 10 s clip;
// 20 s gives headroom for cold-start on OpenAI's side.
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 20_000,
});

export interface TranscriptResult {
  text: string;
  /**
   * Language tag (ISO-639-1) the caller hinted, if any. The gpt-4o-mini
   * transcribe model does not return detected language in `json` mode, so
   * we just propagate the hint downstream. Claude's extractor is robust to
   * `null` here (it parses fr/ar/en directly from the transcript).
   */
  language: string | null;
}

/**
 * Static fallback used when the POI corpus is empty or unreachable.
 * Kept short so it never crowds out the real hint.
 */
const FALLBACK_HINT =
  'Nouakchott, Tevragh-Zeina, Ksar, Sebkha, Riyad, Arafat, Toujounine, ' +
  'Dar Naim, El Mina, Teyarett, Carrefour Madrid, Marché Capitale.';

/**
 * Accepted ISO-639-1 language hints. We only enable the languages we
 * actually train the extractor for, otherwise OpenAI will reject the call.
 * Mauritanian Hassaniya doesn't have an ISO code — we route it to "ar".
 */
const ALLOWED_LANGUAGES = new Set(['fr', 'ar', 'en']);

function normalizeLanguageHint(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const base = hint.toLowerCase().split(/[-_]/)[0];
  return base && ALLOWED_LANGUAGES.has(base) ? base : null;
}

export async function transcribe(
  audio: Buffer,
  filename: string,
  languageHint?: string | null,
): Promise<TranscriptResult> {
  const file = await toFile(audio, filename);

  // Pull the dynamic Mauritania POI hint. If the corpus query fails for
  // any reason we still get a transcription with the static fallback.
  let prompt = FALLBACK_HINT;
  try {
    const dynamic = await getWhisperHint();
    if (dynamic && dynamic.length > 20) prompt = dynamic;
  } catch {
    // swallow — fallback is fine
  }

  const language = normalizeLanguageHint(languageHint);

  // gpt-4o-mini-transcribe only supports response_format: 'json' | 'text'
  // (no verbose_json / no word timestamps). We don't need timestamps here.
  const res = await openai.audio.transcriptions.create({
    file,
    model: env.OPENAI_TRANSCRIBE_MODEL,
    prompt,
    response_format: 'json',
    // Only set `language` when we have a confident hint — otherwise let the
    // model auto-detect (better than forcing the wrong language).
    ...(language ? { language } : {}),
  });

  return {
    text: (res as { text: string }).text.trim(),
    language,
  };
}
