-- Assigned-places collection mode.
--
-- The first version of the collection screen constrained only the SHAPE of the
-- request (structure, noise, language, difficulty, zone) and let the tester
-- pick the places. That had one flaw nothing downstream could catch: the
-- tester spoke first and searched afterwards, so attaching the wrong homonym —
-- one of the three "Carrefour X" in Nouakchott — produced a mislabelled sample
-- that looks exactly like a good one. A wrong gold label silently caps the
-- measured accuracy of every architecture scored against the corpus.
--
-- In assigned mode the server names the two POIs up front, so the ground truth
-- is the assigned id rather than a post-hoc choice, and that class of error
-- becomes structurally impossible.
--
-- The cost is that assigned mode risks turning spontaneous speech into READ
-- speech, which is measurably easier for an ASR: slower, better articulated,
-- canonical pronunciation, no hesitation or code-switching. The screen
-- mitigates it by showing the place on a map with its category and nearby
-- landmarks while WITHHOLDING the written name, so the tester still produces
-- the name from their own vocabulary. The mitigation is partial, which is why
-- the mode is recorded per sample: an evaluation that mixes read and
-- spontaneous speech without being able to separate them cannot tell you which
-- of the two your production numbers resemble.

BEGIN;

ALTER TABLE voice_dataset_samples
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'free'
    CHECK (assignment_mode IN ('assigned', 'free'));

-- Free mode is kept alongside: the assigner can only ever propose POIs that
-- exist in the OSM corpus, and the places where the pipeline actually fails
-- today are disproportionately the ones missing from it.
COMMENT ON COLUMN voice_dataset_samples.assignment_mode IS
  'assigned = server named both places before recording (exact gold label, '
  'read-speech risk); free = tester chose the places themselves (spontaneous, '
  'annotation-error risk). Report metrics per mode, never pooled blindly.';

-- The export and the coverage dashboard both slice on this.
CREATE INDEX IF NOT EXISTS voice_dataset_assignment_mode_idx
  ON voice_dataset_samples (assignment_mode);

COMMIT;
