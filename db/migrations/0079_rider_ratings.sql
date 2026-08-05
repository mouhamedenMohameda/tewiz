-- Let reputation flow both ways.
--
-- The `ratings` table has always been generic over (rater_id, ratee_id) — it
-- was designed for this — but only one direction was ever written: the rider
-- rating the captain. Nothing rated the rider.
--
-- That gap was visible in the product, not just the schema. ride_insights
-- already shows a captain, at the moment they decide whether to accept, a
-- `rider.avgRating` field. With no captain→rider rating anywhere in the
-- codebase that field could only ever be null: the UI promised a signal the
-- backend had no way to produce.
--
-- `captains` carries rating_avg / rating_count for exactly the same purpose;
-- these two columns are that pair's counterpart on `users`. Recomputed from
-- scratch on every rating (a rider has at most a few hundred), so an edited
-- rating can never leave a drifted average behind.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rating_avg   numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer      NOT NULL DEFAULT 0;

-- Backfill from any ratings that already point at a rider. Normally a no-op —
-- nothing wrote them before this migration — but it keeps the columns
-- consistent with the ledger rather than trusting that.
UPDATE users u
   SET rating_avg   = agg.avg,
       rating_count = agg.cnt
  FROM (
    SELECT ratee_id,
           COALESCE(AVG(stars), 0)::numeric(3,2) AS avg,
           COUNT(*)::int                         AS cnt
      FROM ratings
     GROUP BY ratee_id
  ) agg
 WHERE u.id = agg.ratee_id
   AND u.role = 'rider';

COMMIT;
