import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { env } from '../config.js';
import { getWhisperHint } from './pois.js';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export interface TranscriptResult {
  text: string;
  language: string | null;
}

/**
 * Static fallback used when the POI corpus is empty or unreachable.
 * Kept short so it never crowds out the real hint.
 */
const FALLBACK_HINT =
  'Nouakchott, Tevragh-Zeina, Ksar, Sebkha, Riyad, Arafat, Toujounine, ' +
  'Dar Naim, El Mina, Teyarett, Carrefour Madrid, Marché Capitale.';

export async function transcribe(
  audio: Buffer,
  filename: string,
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

  const res = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    prompt,
    response_format: 'verbose_json',
    temperature: 0,
  });

  return {
    text: (res as { text: string }).text.trim(),
    language: (res as { language?: string }).language ?? null,
  };
}
