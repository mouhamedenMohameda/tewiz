-- Down migration for 0015_voice_ride_requests.sql
DROP INDEX IF EXISTS voice_ride_requests_ride_idx;
DROP INDEX IF EXISTS voice_ride_requests_user_time_idx;
DROP INDEX IF EXISTS voice_ride_requests_pending_idx;
DROP TABLE IF EXISTS voice_ride_requests;
DROP TYPE IF EXISTS voice_ride_status;
