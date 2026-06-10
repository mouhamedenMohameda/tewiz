-- Down Migration for 0012_voiceloc_pois.sql
DROP INDEX IF EXISTS voiceloc_pois_lng_idx;
DROP INDEX IF EXISTS voiceloc_pois_lat_idx;
DROP INDEX IF EXISTS voiceloc_pois_kind_idx;
DROP INDEX IF EXISTS voiceloc_pois_popularity_idx;
DROP INDEX IF EXISTS voiceloc_pois_search_trgm_idx;
DROP TABLE IF EXISTS voiceloc_pois;
