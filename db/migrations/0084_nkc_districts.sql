-- Real district boundaries for Nouakchott.
--
-- WHY POLYGONS AND NOT CENTRES
--
-- The voice-dataset assigner needed to answer one question: does this POI
-- belong to the moughataa the tester says they are standing in. Two
-- approximations were tried and both failed in the field:
--
--   1. A RADIUS around a centre. The real centroids of Arafat and El Mina sit
--      2.1 km apart, so any radius wide enough to offer a useful choice of
--      places necessarily reached into the neighbour. A tester declaring
--      El Mina was handed Arafat neighbourhoods.
--
--   2. A VORONOI partition of the same centres. No overlap, but a moughataa is
--      not a disc and its boundary is not equidistant between two centres, so
--      places near any edge still landed on the wrong side.
--
-- Both shared the same defect: they modelled a district as a point plus a rule,
-- when a district is an area with a surveyed edge. The neighbourhood Elveloudja
-- was reported as Arafat while the app called it El Mina — and no refinement of
-- a centre could have fixed that, only a boundary can.
--
-- So this table holds the actual OSM administrative polygons, and membership
-- becomes ST_Covers: exact, with no radius to tune and no tie to break.
--
-- WHY A REFERENCE POINT PER DISTRICT
--
-- A fetched polygon can be the wrong feature — Nominatim will happily return a
-- street or a building that shares the name. reference_lat/lng hold published
-- centroids supplied by the project owner, and the ingester REFUSES a polygon
-- that does not contain its district's reference point. That turns those
-- coordinates from a guess we depend on into a check we can fail.

BEGIN;

CREATE TABLE IF NOT EXISTS nkc_districts (
  -- Matches SCENARIO_ZONES[].code in the voice-dataset module, so the two stay
  -- joinable without a translation table.
  code            text PRIMARY KEY,

  name_fr         text NOT NULL,
  name_ar         text,

  -- geography, not geometry: containment and distance are then computed on the
  -- spheroid, so no projection has to be chosen and metres mean metres.
  geom            geography(MultiPolygon, 4326) NOT NULL,

  -- Published centroid used to validate `geom` on ingest. Nullable: four
  -- moughataas had no published figure available at the time of writing, and a
  -- missing check is honest where an invented one would not be.
  reference_lat   double precision,
  reference_lng   double precision,

  -- Where the polygon came from, so a bad boundary can be traced rather than
  -- guessed at.
  source          text NOT NULL,
  osm_id          bigint,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Point-in-polygon is the hot path: every candidate POI in an assignment is
-- tested against the declared district.
CREATE INDEX IF NOT EXISTS nkc_districts_geom_gist
  ON nkc_districts USING gist (geom);

CREATE TRIGGER trg_nkc_districts_touch
  BEFORE UPDATE ON nkc_districts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
