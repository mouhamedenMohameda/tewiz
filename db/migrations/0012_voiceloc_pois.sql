-- Up Migration
-- POI corpus for Nouakchott (and later other Mauritanian cities).
-- Ingested from OpenStreetMap via Overpass API by
-- apps/voice-location-api/scripts/ingest-poi-nouakchott.ts.
--
-- Purposes:
--   1. Bias Whisper STT with frequent local place names.
--   2. Give Claude an extraction-time glossary for fuzzy correction
--      of Hassaniya transcripts ("Ksar" → "Oum Ksar" when ambiguous).
--   3. Short-circuit the Google Geocoding call when we already know
--      a place locally (latency + cost win).

CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- trigram fuzzy match on names

CREATE TABLE IF NOT EXISTS voiceloc_pois (
  id              bigserial PRIMARY KEY,

  -- OSM provenance. (osm_type, osm_id) is globally unique on the OSM side.
  osm_type        text NOT NULL CHECK (osm_type IN ('node','way','relation')),
  osm_id          bigint NOT NULL,

  -- Names. name_default is the canonical OSM "name" tag; the localized
  -- variants come from name:fr / name:ar / name:en when present.
  name_default    text NOT NULL,
  name_fr         text,
  name_ar         text,
  name_en         text,

  -- Free-text "all names" column used for trigram search across every
  -- variant at once (default + fr + ar + en + alt_name, lowercased,
  -- separated by space). Computed by the ingester.
  search_text     text NOT NULL,

  -- Rough category (amenity, shop, place, tourism, leisure, office,
  -- highway, building) plus the raw subcategory ("market", "mosque", …).
  osm_kind        text NOT NULL,
  osm_value       text,

  -- Geometry in WGS-84. PostGIS is not installed in this database, so we
  -- store plain lat/lng. Bounding-box queries are cheap with the btree
  -- index below and Nouakchott fits in a small area (~25 km wide).
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,

  -- Popularity / ranking hint. Higher = should appear earlier in the
  -- Whisper hint and in fuzzy-match shortlists. Computed by the
  -- ingester from heuristics (centrality, OSM tag importance, ...).
  popularity      integer NOT NULL DEFAULT 0,

  -- Pre-resolved Google Place identifier (optional). When present we
  -- skip the Google Geocoding call for known locations.
  google_place_id text,

  -- Raw OSM tags kept for debugging and future enrichment.
  raw_tags        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (osm_type, osm_id)
);

-- Trigram index for fuzzy ILIKE / similarity() lookups against any name.
CREATE INDEX IF NOT EXISTS voiceloc_pois_search_trgm_idx
  ON voiceloc_pois USING gin (search_text gin_trgm_ops);

-- Quick filtering / ordering.
CREATE INDEX IF NOT EXISTS voiceloc_pois_popularity_idx
  ON voiceloc_pois (popularity DESC);

CREATE INDEX IF NOT EXISTS voiceloc_pois_kind_idx
  ON voiceloc_pois (osm_kind, osm_value);

-- Lat/lng bounding-box prefilter (cheap btree on lat works fine at this scale).
CREATE INDEX IF NOT EXISTS voiceloc_pois_lat_idx ON voiceloc_pois (lat);
CREATE INDEX IF NOT EXISTS voiceloc_pois_lng_idx ON voiceloc_pois (lng);

-- (Down migration in a separate file: 0012_voiceloc_pois.down.sql)
