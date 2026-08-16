-- Voice dataset collection — ground-truth corpus for the Hassaniya
-- voice-to-ride pipeline.
--
-- WHY THIS EXISTS
--
-- apps/voice-location-api runs a cascade: STT (gpt-4o-mini-transcribe) →
-- Claude extractor → POI resolver → geocoder. Nothing in that chain is
-- measured. We cannot tell whether a prompt tweak helps or hurts, and we
-- cannot compare it against a different architecture, because there is no
-- labelled set of real Hassaniya ride requests to score against.
--
-- This table is that set. Each row is one voice memo plus the answer a
-- human says is correct.
--
-- WHY POI IDS AND NOT TEXT
--
-- The gold pickup/destination are foreign keys into voiceloc_pois, not free
-- text. The metric that matters commercially is "did we route the rider to
-- the right place", and that is only decidable against a stable identifier.
-- Scoring on strings would mean the evaluation harness itself does fuzzy
-- matching — measuring the pipeline with the pipeline's own weakest step.
--
-- WHY THERE IS NO rider_gps COLUMN
--
-- The geo-filter that shortlists POIs near the rider is worth evaluating,
-- but a collected GPS cannot serve that purpose. A tester records from
-- their desk, not from the pickup point, so the real device position is
-- noise; a randomly drawn Nouakchott coordinate is worse noise, because it
-- would push the correct POI outside the filter radius on roughly half the
-- samples and make geo-filtering look harmful when it is not.
--
-- The evaluation harness derives it instead: rider_gps = coordinates of the
-- gold pickup POI plus 300-800 m of jitter. That is reproducible, is
-- computed from ground truth, and faithfully models a rider hailing from
-- where they actually stand. Deriving beats storing here.
--
-- WHY THE SCENARIO AXES ARE STORED
--
-- Left to themselves, testers record the same handful of trips
-- ("marché capitale → stade") in the same quiet room. The scenario axes are
-- assigned by the server BEFORE recording, chosen from whichever value is
-- currently least represented, so the corpus stays balanced on the
-- dimensions that actually break the pipeline.
--
-- Coverage is tracked per axis (marginal), not per combination (joint):
-- the joint space is 5 x 4 x 4 x 4 x 9 = 2880 cells, which no realistic
-- corpus fills, whereas the ~26 marginal buckets reach a usable count at a
-- few hundred samples.

BEGIN;

-- ---------------------------------------------------------------------------
-- Tester flag
--
-- Deliberately a flag and not a fourth UserRole. `role` is wired into the
-- JWT payload, the mobile navigation split, requireRole() guards across every
-- module, and a CHECK constraint on users — a new value there touches all of
-- them. A tester is an ordinary rider who additionally sees the collection
-- screen, which is exactly what a boolean expresses.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_tester boolean NOT NULL DEFAULT false;

-- Testers are a handful of accounts among many; a partial index keeps the
-- admin roster lookup off a sequential scan.
CREATE INDEX IF NOT EXISTS users_is_tester_idx
  ON users (id) WHERE is_tester;

-- ---------------------------------------------------------------------------
-- Samples

CREATE TABLE IF NOT EXISTS voice_dataset_samples (
  id                 uuid PRIMARY KEY,

  -- Who recorded it. RESTRICT rather than CASCADE: a collected sample is
  -- research data that outlives the account that produced it, and silently
  -- deleting labelled audio when a tester account is removed would corrupt
  -- an evaluation split that may already be published.
  collector_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Audio, stored through the same StorageProvider as voice_ride_requests.
  audio_key          text NOT NULL,
  audio_mime         text NOT NULL DEFAULT 'audio/m4a',
  audio_duration_s   integer,

  -- ── Ground truth ────────────────────────────────────────────────────────
  pickup_poi_id      bigint REFERENCES voiceloc_pois(id) ON DELETE RESTRICT,
  destination_poi_id bigint REFERENCES voiceloc_pois(id) ON DELETE RESTRICT,

  -- "Course ouverte": the rider wants a taxi with no fixed destination.
  -- Mirrors ExtractedTrip.is_open in the extractor, which the pipeline must
  -- also get right — an open ride priced as a point-to-point trip is wrong
  -- even when both POIs are wrong-but-irrelevant.
  is_open            boolean NOT NULL DEFAULT false,

  -- Human transcription in Hassaniya. Nullable on purpose: typing Arabic on
  -- a phone keyboard is slow, and blocking submission on it would cost more
  -- in collection volume than the transcript is worth. Testers can fill it
  -- later from the pending queue. Only architecture C (ASR fine-tuning)
  -- needs it; the headline metrics do not.
  transcript_gold    text,

  -- ── Assigned scenario (stratification axes) ─────────────────────────────
  scenario_structure text NOT NULL CHECK (scenario_structure IN (
    'pickup_only', 'destination_only', 'from_to', 'round_trip', 'open_ride'
  )),
  scenario_noise text NOT NULL CHECK (scenario_noise IN (
    'quiet_indoor', 'street', 'moving_car', 'wind'
  )),
  scenario_language text NOT NULL CHECK (scenario_language IN (
    'hassaniya', 'hassaniya_french', 'french', 'arabic'
  )),
  -- How hard the place references are. 'plain' is a bare name; 'landmarks'
  -- adds "حزا X" style references; 'homonym' targets names carried by
  -- several distinct POIs; 'vague' is deliberately under-specified
  -- ("chez moi") and the pipeline is expected to ask rather than guess.
  scenario_difficulty text NOT NULL CHECK (scenario_difficulty IN (
    'plain', 'landmarks', 'homonym', 'vague'
  )),
  -- Nouakchott moughataa the tester was asked to draw places from, so the
  -- corpus is not concentrated on the city centre.
  scenario_zone text NOT NULL,

  -- ── Speaker metadata ────────────────────────────────────────────────────
  -- Per sample, not per collector: testers are encouraged to hand the phone
  -- to family and colleagues, and that speaker diversity is the point. The
  -- client prefills both from the last submission so it costs one tap.
  speaker_gender     text CHECK (speaker_gender IN ('f', 'm', 'other')),
  speaker_age_band   text CHECK (speaker_age_band IN ('18_25', '26_40', '41_60', '60_plus')),

  -- ── Review lifecycle ────────────────────────────────────────────────────
  -- 'collected' is unreviewed. Nothing enters an evaluation split until a
  -- reviewer has listened and confirmed the labels match the audio: a wrong
  -- gold label is worse than a missing sample, because it silently caps the
  -- measured accuracy of every architecture tested against it.
  status             text NOT NULL DEFAULT 'collected'
                     CHECK (status IN ('collected', 'validated', 'rejected')),
  review_note        text,
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,

  -- dev = iterate freely. test = frozen holdout, assigned once and never
  -- looked at during development. NULL = not yet assigned to either.
  split              text CHECK (split IN ('dev', 'test')),

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- An open ride has no destination by definition. The extractor enforces
  -- the same invariant in code (it nulls the destination when is_open is
  -- set); duplicating it here means a mislabelled row cannot reach the
  -- export in the first place.
  CONSTRAINT voice_dataset_open_has_no_destination
    CHECK (NOT is_open OR destination_poi_id IS NULL),

  -- A sample with neither endpoint and no open-ride flag carries no
  -- supervision signal at all.
  CONSTRAINT voice_dataset_has_ground_truth
    CHECK (is_open OR pickup_poi_id IS NOT NULL OR destination_poi_id IS NOT NULL),

  -- A round trip needs both ends: it is the structure the extractor most
  -- often gets backwards (rules D1/D2 on the "من" preposition), so a sample
  -- labelled 'round_trip' with one endpoint would test nothing.
  CONSTRAINT voice_dataset_round_trip_has_both
    CHECK (scenario_structure <> 'round_trip'
           OR (pickup_poi_id IS NOT NULL AND destination_poi_id IS NOT NULL))
);

-- Contribution counters on the collection screen, and per-tester review.
CREATE INDEX IF NOT EXISTS voice_dataset_collector_idx
  ON voice_dataset_samples (collector_user_id, created_at DESC);

-- Review queue: reviewers page through unreviewed samples oldest-first.
CREATE INDEX IF NOT EXISTS voice_dataset_status_idx
  ON voice_dataset_samples (status, created_at);

-- Export reads one split at a time.
CREATE INDEX IF NOT EXISTS voice_dataset_split_idx
  ON voice_dataset_samples (split) WHERE split IS NOT NULL;

-- Coverage aggregation and next-scenario selection group on these five
-- columns on every call to the collection screen.
CREATE INDEX IF NOT EXISTS voice_dataset_scenario_idx
  ON voice_dataset_samples (
    scenario_structure, scenario_noise, scenario_language,
    scenario_difficulty, scenario_zone
  );

-- "Transcripts still to fill" queue on the tester's screen. Partial, because
-- once the corpus is mostly transcribed this is a small tail of a big table.
CREATE INDEX IF NOT EXISTS voice_dataset_pending_transcript_idx
  ON voice_dataset_samples (collector_user_id, created_at)
  WHERE transcript_gold IS NULL;

CREATE TRIGGER trg_voice_dataset_samples_touch
  BEFORE UPDATE ON voice_dataset_samples
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
