-- Accent-folded POI search.
--
-- THE BUG THIS FIXES
--
-- voiceloc_pois.search_text concatenates every name variant a POI carries
-- (name, name:fr, name:ar, name:en, alt_name, short_name…), lowercased. Two
-- consequences went unnoticed until testers actually used the picker:
--
--   1. NOTHING MATCHES WITHOUT THE ACCENT. Nobody types "Marché" on a phone
--      keyboard; they type "marche". `ILIKE '%marche%'` does not match
--      "marché", so the POI the tester is looking at on the street simply does
--      not exist as far as the search is concerned.
--
--   2. RANKING BY similarity() BURIES EXACT MATCHES. similarity(a, b) is
--      shared trigrams over the UNION of both trigram sets. search_text is
--      long — often three scripts' worth of names — so a short query scores
--      near zero against it even when it appears verbatim inside. Ordering by
--      that score puts genuine matches below vague ones, and a `> 0.25`
--      threshold is unreachable for a long search_text, which quietly reduced
--      the whole query to a plain substring scan ordered by noise.
--
-- The fold below fixes (1) and gives (2) something meaningful to index;
-- the ranking itself is rebuilt in voice-dataset.service.ts, which switches to
-- word_similarity() — asymmetric, normalised by the QUERY's trigrams rather
-- than the union, which is precisely the "is this query a word inside that
-- text" question being asked here.

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE is a deliberate, standard overstatement: unaccent() is declared
-- STABLE because it reads a dictionary file, and a STABLE expression cannot be
-- indexed. Pinning the dictionary explicitly ('unaccent') removes the
-- search_path dependency that makes it non-immutable in practice. The residual
-- risk is that replacing the unaccent dictionary on disk would silently
-- invalidate the index below — REINDEX after any such change.
CREATE OR REPLACE FUNCTION voiceloc_fold(input text)
RETURNS text AS $$
  SELECT lower(unaccent('unaccent', input))
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- Trigram index over the folded text, so both the ILIKE substring branch and
-- word_similarity() are served without a sequential scan as the corpus grows.
CREATE INDEX IF NOT EXISTS voiceloc_pois_fold_trgm_idx
  ON voiceloc_pois USING gin (voiceloc_fold(search_text) gin_trgm_ops);

COMMIT;
