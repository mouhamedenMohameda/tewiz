import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config.js';
import { fuzzyMatchTranscript, formatPoiForPrompt } from './pois.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/**
 * A place mentioned in the transcript, with optional landmark context.
 *
 * "I'm leaving from Carrefour Oum Ghasser near Banque Populaire and
 *  Carrefour Bekar, going to Stade Olympique near the University"
 *  → primary='Carrefour Oum Ghasser', landmarks=['Banque Populaire','Carrefour Bekar']
 *
 * The landmarks are used downstream as spatial filters: when several POIs
 * share the same name, the one nearest the landmarks wins.
 */
export interface ExtractedPlace {
  /** Main place name the user wants to go to / be picked up at. */
  primary: string;
  /** Nearby reference places the user mentioned to disambiguate "primary". */
  landmarks: string[];
  /** The exact phrase from the transcript that describes this place. */
  raw_phrase: string | null;
  /** City / neighborhood mentioned (for fallback geocoder query). */
  locality: string | null;
  /** How confidently the model parsed this place: high / medium / low. */
  confidence: 'high' | 'medium' | 'low';
  /** Empty if the description is concrete; populated if it's vague. */
  ambiguity_note: string | null;
}

export interface ExtractedTrip {
  pickup: ExtractedPlace | null;
  destination: ExtractedPlace | null;
  intent: 'pickup_only' | 'destination_only' | 'both' | 'neither';
}

/** Kept for backward compatibility with previous single-address shape. */
export interface ExtractedAddress {
  query: string;
  place_name: string | null;
  locality: string | null;
  landmark: string | null;
  confidence: 'high' | 'medium' | 'low';
  ambiguity_note: string | null;
}

const SYSTEM = `You are a location-extraction engine for a ride-hailing app in Nouakchott, Mauritania.

Input: a raw transcript of a user speaking in French, Hassaniya Arabic, Modern Standard Arabic, or English. The user is describing where they want to be picked up (pickup) and/or where they want to go (destination). They often add nearby reference places ("landmarks") to disambiguate, because many places share the same name in Nouakchott.

Output: a single JSON object with up to two places — pickup and destination. Each place has a main name ("primary") and an optional list of nearby reference places ("landmarks"). Another system will use the landmarks to pick the right geographic instance when several POIs share the same primary name.

────────────────────────────────────────────────────────
HOW TO SPLIT THE TRANSCRIPT
────────────────────────────────────────────────────────

Pickup vs destination — read the prepositions carefully:

A. Standalone pickup phrasing:
   - "Je suis à X" / "I'm at X" / "viens me chercher à X" / "أنا في X" → pickup=X
   - "ماشي من X"  (going FROM X)  → pickup=X    ← the preposition "من" (from) is CRUCIAL
   - "Je pars de X" / "from X"    → pickup=X

B. Standalone destination phrasing:
   - "Emmène-moi à Y" / "take me to Y" / "je veux aller à Y" / "ودّيني إلى Y" → destination=Y
   - "ماشي Y" (going Y, no preposition) / "ماشي إلى Y" / "ماشي لـ Y" → destination=Y

C. Combined "from X to Y":
   - "Je pars de X vers Y" / "from X to Y" / "من X إلى Y" / "ماشي من X لـ Y" → pickup=X, destination=Y

D. Round-trip phrasing (PRIORITY RULES — read in order):

   D1. If the sentence has BOTH "ماشي من X" (from X) AND "وعاد Y" / "وعادة Y":
       → pickup=X (the "from"), destination=Y (the return point).
       Example: "ماشي من ستة دار موهوب ... وعاد أم القصر"
       → pickup="Cité Dar Mouhoub", destination="Oum Ghasser"

   D2. Otherwise, plain "ماشي X وعادة Y" / "je vais à X et je rentre à Y":
       → destination=X (the going-to), pickup=Y (the return-home point).
       Example: "ماشي نعيم وعادة الكسر" → destination="Dar Naim", pickup="Ksar"

   The distinction: "من" (from) flips the role of the first place from
   destination to pickup. Always look for "من" before applying D2.

────────────────────────────────────────────────────────
HOW TO PARSE LANDMARKS
────────────────────────────────────────────────────────

Users often say: "X à côté de Y, Z et T" / "X près de Y" / "X qui est à côté de Y" / "X بجانب Y" / "X جنب Y" / "X next to Y".

For each place, extract:
- primary = the actual place the user wants (X)
- landmarks = the array [Y, Z, T] used as nearby references
- raw_phrase = the exact substring of the transcript describing this side ("from X near Y, Z and T")

Examples:
1. "Je pars de Carrefour Oum Ghasser à côté de Banque Populaire et Carrefour Bekar, vers Stade Olympique à côté de l'Université"
   → pickup={primary:"Carrefour Oum Ghasser", landmarks:["Banque Populaire","Carrefour Bekar"]},
     destination={primary:"Stade Olympique", landmarks:["Université"]}

2. "أنا في الكسر قريب من مستشفى الأم والطفل وماشي الستاد"
   → pickup={primary:"Ksar", landmarks:["Hôpital Mère et Enfant"]},
     destination={primary:"Stade", landmarks:[]}

3. "viens me chercher au marché capitale"
   → pickup={primary:"Marché Capitale", landmarks:[]}, destination=null

4. "ماشي نستدر نعيم وعادة أم القصر"  (no "من" preposition — rule D2 applies)
   → destination={primary:"Dar Naim", raw_phrase:"ماشي نستدر نعيم", landmarks:[]},
     pickup={primary:"Oum Ghasser", raw_phrase:"وعادة أم القصر", landmarks:[]}
   IMPORTANT: do NOT keep Hassaniya verbs in the primary name.
   "نستدر" = "I head to" (verb, NOT a place). The place is "نعيم" → "Dar Naim".
   "عادة" = "back" (adverb, NOT a place). The place is "أم القصر" → "Oum Ghasser" / "Oum Ksar".

5. "ماشي من ستة دار موهوب، حزا دار فاطمة، حزا أبوتي، وعاد أم القصر، حزا الكبيدة، حزا كرفور بكر"
   (note the "من" before Dar Mouhoub — rule D1 applies, NOT D2)
   → pickup={primary:"Cité Dar Mouhoub",
             landmarks:["Dar Fatima","Aboutilimit"],
             raw_phrase:"ماشي من ستة دار موهوب، حزا دار فاطمة، حزا أبوتي"},
     destination={primary:"Oum Ghasser",
             landmarks:["Lakbeida","Carrefour Bekar"],
             raw_phrase:"وعاد أم القصر، حزا الكبيدة، حزا كرفور بكر"}
   Note: "ستة" in Hassaniya is the loanword "Cité" (French for neighborhood),
         so "ستة دار موهوب" = "Cité Dar Mouhoub".
         "حزا" = "near / next to" — introduces a landmark, NOT a place name.

────────────────────────────────────────────────────────
VERBS TO STRIP OUT (these are NOT places)
────────────────────────────────────────────────────────

When parsing Hassaniya / Arabic transcripts, strip these direction/motion
verbs before deciding what the place name is:
  - ماشي / مشيت / يمشي         → "going"
  - نستدر / نتجه / استدار       → "I head to" / "head to"
  - رايح / رايحة                 → "going"
  - عادة / عاد / يعود            → "back" / "returning"
  - من / من ناحية / من جهة       → "from" / "from the side of"
  - إلى / لـ / لـعند             → "to" / "to the"
  - بجانب / جنب / قريب من / حزا  → "near" / "next to"
  - ستة                          → "Cité" (French loanword for "neighborhood")
French equivalents: pars de, vers, à, près de, à côté de, je vais, je rentre.

────────────────────────────────────────────────────────
NAMING NORMALIZATION
────────────────────────────────────────────────────────

- Prefer French (Mauritanian) spellings ("Marché Capitale", "Carrefour Madrid", "Tevragh-Zeina", "Nouakchott", "Stade Olympique", "Dar Naim"). NEVER use academic Arabic romanizations like "Umm Al-Qasoor" or "Naa'im" — those don't match real Mauritanian usage.
- Translate Hassaniya / Arabic place names to the local French form:
    سوق العاصمة      → "Marché Capitale"
    انواكشوط         → "Nouakchott"
    دار النعيم / نعيم → "Dar Naim"
    أم قصر / أم القصر → "Oum Ghasser" (preferred — that's how Google labels it) or "Oum Ksar"
    الكسر / القصر    → "Ksar"
    تفرغ زينة        → "Tevragh-Zeina"
    عرفات            → "Arafat"
    السبخة           → "Sebkha"
- KEEP "Carrefour" / "Marché" / "Stade" prefixes when they are part of the name.
- If a place is only described generically ("near my house", "the airport"), set ambiguity_note and confidence="low" — never invent specifics.
- Never include personal data (names of people, phone numbers) in any field.

────────────────────────────────────────────────────────
USING THE LOCAL POI CANDIDATES BLOCK
────────────────────────────────────────────────────────

You will receive a "Local POI candidates" list at the end of the prompt — real Nouakchott POIs whose names fuzzy-match the transcript. Use them to fix probable transcription errors:
- transcript "Ksar" but candidate "Stade du Ksar" or "Collège Ksar" matches the context → prefer the specific name
- transcript "stade" alone but candidate "Stade Olympique" is in the list and the speaker said "ستاد" → use "Stade Olympique"
- If NONE fit, ignore the list and use what the speaker said verbatim.

────────────────────────────────────────────────────────
INTENT FIELD
────────────────────────────────────────────────────────

Set "intent" to:
- "pickup_only"     → only a pickup was extracted
- "destination_only"→ only a destination was extracted
- "both"            → both
- "neither"         → nothing usable

Output ONLY valid JSON. No prose, no markdown fences.`;

const SCHEMA_HINT = `{
  "pickup": {
    "primary": "string",
    "landmarks": ["string", ...],
    "raw_phrase": "string | null",
    "locality": "string | null",
    "confidence": "high | medium | low",
    "ambiguity_note": "string | null"
  } | null,
  "destination": {
    "primary": "string",
    "landmarks": ["string", ...],
    "raw_phrase": "string | null",
    "locality": "string | null",
    "confidence": "high | medium | low",
    "ambiguity_note": "string | null"
  } | null,
  "intent": "pickup_only | destination_only | both | neither"
}`;

function normalizePlace(p: unknown): ExtractedPlace | null {
  if (p === null || p === undefined) return null;
  if (typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
  if (!primary) return null;
  const landmarks = Array.isArray(o.landmarks)
    ? o.landmarks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim())
    : [];
  const conf = (o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low')
    ? o.confidence
    : 'medium';
  return {
    primary,
    landmarks,
    raw_phrase: typeof o.raw_phrase === 'string' ? o.raw_phrase : null,
    locality: typeof o.locality === 'string' ? o.locality : null,
    confidence: conf,
    ambiguity_note: typeof o.ambiguity_note === 'string' ? o.ambiguity_note : null,
  };
}

export async function extractTrip(
  transcript: string,
  detectedLanguage: string | null,
): Promise<ExtractedTrip> {
  // Fuzzy-match the transcript against the local POI corpus and feed
  // Claude a small shortlist so it can correct ambiguous transcriptions.
  // Soft-failure: if the DB is unreachable we still run the extractor
  // with no hints.
  let candidatesBlock = '';
  try {
    const candidates = await fuzzyMatchTranscript(transcript, 15);
    if (candidates.length > 0) {
      candidatesBlock = [
        '',
        'Local POI candidates (fuzzy-matched against the transcript — use only if clearly relevant):',
        ...candidates.map((c, i) => `  ${i + 1}. ${formatPoiForPrompt(c)} (sim=${c.similarity.toFixed(2)})`),
      ].join('\n');
    }
  } catch {
    // Ignore corpus errors — the extractor still works without hints.
  }

  const userMsg = [
    `Transcript language (detected): ${detectedLanguage ?? 'unknown'}`,
    `Transcript: """${transcript}"""`,
    `Return JSON matching this shape:\n${SCHEMA_HINT}${candidatesBlock}`,
  ].join('\n\n');

  const res = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Strip markdown fence if the model adds one despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new Error(`Extractor returned non-JSON output: ${cleaned.slice(0, 200)}`);
  }

  const pickup = normalizePlace(raw.pickup);
  const destination = normalizePlace(raw.destination);

  let intent: ExtractedTrip['intent'];
  const rawIntent = raw.intent;
  if (rawIntent === 'pickup_only' || rawIntent === 'destination_only' || rawIntent === 'both' || rawIntent === 'neither') {
    intent = rawIntent;
  } else {
    intent = pickup && destination ? 'both' : pickup ? 'pickup_only' : destination ? 'destination_only' : 'neither';
  }

  return { pickup, destination, intent };
}

/**
 * Backward-compatible single-address extractor. Returns the pickup if present,
 * otherwise the destination. The "query" is constructed by joining the
 * primary name with the locality and Mauritania.
 */
export async function extractAddress(
  transcript: string,
  detectedLanguage: string | null,
): Promise<ExtractedAddress> {
  const trip = await extractTrip(transcript, detectedLanguage);
  const place = trip.pickup ?? trip.destination;
  if (!place) {
    throw new Error('Extractor found no usable place in transcript');
  }
  const parts = [place.primary, place.locality ?? 'Nouakchott', 'Mauritania']
    .filter((x, i, a) => x && a.indexOf(x) === i);
  return {
    query: parts.join(', '),
    place_name: place.primary,
    locality: place.locality,
    landmark: place.landmarks[0] ?? null,
    confidence: place.confidence,
    ambiguity_note: place.ambiguity_note,
  };
}
