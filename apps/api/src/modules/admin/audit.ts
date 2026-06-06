import { pool } from '../../db/pool.js';

/**
 * Log a single admin action to admin_audit_log.
 * `before` and `after` are stored as JSONB; pass plain objects or null.
 */
export async function audit(input: {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log
       (admin_id, action, target_type, target_id, before_json, after_json, reason)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      input.adminId,
      input.action,
      input.targetType,
      input.targetId,
      input.before == null ? null : JSON.stringify(input.before),
      input.after == null ? null : JSON.stringify(input.after),
      input.reason ?? null,
    ],
  );
}
