-- Down Migration for 0013_voiceloc_confirmations.sql
DROP INDEX IF EXISTS voiceloc_confirmations_time_idx;
DROP INDEX IF EXISTS voiceloc_confirmations_place_idx;
DROP INDEX IF EXISTS voiceloc_confirmations_request_idx;
DROP TABLE IF EXISTS voiceloc_confirmations;

DROP INDEX IF EXISTS voiceloc_requests_expires_idx;
DROP INDEX IF EXISTS voiceloc_requests_key_time_idx;
DROP TABLE IF EXISTS voiceloc_requests;
