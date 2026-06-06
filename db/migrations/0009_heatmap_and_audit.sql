-- "Zones chaudes" demand heatmap (cache table) + admin audit log.

-- Demand heatmap. Recomputed every few minutes by a background job.
-- We use H3 hexes (resolution 9 ≈ 170m) keyed as strings.
-- For MVP we only keep the CURRENT snapshot (delete + reinsert each run).
CREATE TABLE demand_heatmap (
  h3_index       TEXT PRIMARY KEY,
  centroid       GEOGRAPHY(POINT, 4326) NOT NULL,
  demand_score   REAL NOT NULL,            -- normalized 0..1
  ride_count_30m INT NOT NULL,             -- raw count, last 30 min
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX demand_heatmap_score_idx ON demand_heatmap(demand_score DESC);
CREATE INDEX demand_heatmap_geo_gix   ON demand_heatmap USING GIST (centroid);

-- Admin audit log: every administrative action is recorded.
CREATE TABLE admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL,           -- 'approve_application', 'reject_topup', 'suspend_captain', ...
  target_type  TEXT NOT NULL,           -- 'captain_application', 'topup_request', 'captain', ...
  target_id    UUID,
  before_json  JSONB,
  after_json   JSONB,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_admin_time_idx  ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX audit_log_target_idx      ON admin_audit_log(target_type, target_id);
