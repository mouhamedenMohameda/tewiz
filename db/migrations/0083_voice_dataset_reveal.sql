-- Records whether the tester had to reveal an assigned place's name.
--
-- Assigned mode withholds the written name so the tester speaks spontaneously
-- rather than reading a label. That only works when the place's identity is
-- common knowledge: "the maternity in Sebkha" is answerable, "a school in
-- Ksar" is not — you can know where it is without knowing what it is called,
-- and a name you cannot recall is a name you cannot say.
--
-- Rather than trap the tester, the screen lets them reveal the name. That
-- reintroduces read speech for those samples, so it is recorded: an evaluation
-- that cannot separate read from spontaneous speech cannot tell you which of
-- the two your production numbers resemble.

BEGIN;

ALTER TABLE voice_dataset_samples
  ADD COLUMN IF NOT EXISTS name_revealed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN voice_dataset_samples.name_revealed IS
  'true when the tester displayed the assigned place name before speaking. '
  'Such samples carry read-speech characteristics (slower, canonical '
  'pronunciation, no hesitation) and flatter an ASR — report them separately.';

CREATE INDEX IF NOT EXISTS voice_dataset_name_revealed_idx
  ON voice_dataset_samples (name_revealed) WHERE name_revealed;

COMMIT;
