import { pool, withTx } from '../../db/pool.js';

/**
 * Mark documents as 'expired' once their expires_at is in the past, and
 * auto-suspend the captain so they can no longer go online until they
 * re-upload and an admin re-approves.
 *
 * Designed to be called daily by cron.
 */
export async function expireDocumentsAndSuspendCaptains() {
  return withTx(async (client) => {
    // 1. Mark documents that just expired.
    const expired = await client.query<{ application_id: string; type: string }>(
      `UPDATE application_documents
          SET status = 'expired'
        WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at < now()
     RETURNING application_id, type`,
    );

    if ((expired.rowCount ?? 0) === 0) {
      return { expiredDocuments: 0, suspendedCaptains: 0 };
    }

    // 2. For each affected application, suspend the captain (if active).
    const affectedAppIds = [...new Set(expired.rows.map((r) => r.application_id))];
    const suspended = await client.query<{ user_id: string; doc_type: string }>(
      `UPDATE captains c
          SET status = 'suspended',
              suspended_reason = 'Document expiré: ' || d.type
         FROM (SELECT DISTINCT application_id, type FROM application_documents
                WHERE application_id = ANY($1::uuid[])
                  AND status = 'expired') d
        WHERE c.application_id = d.application_id
          AND c.status = 'active'
     RETURNING c.user_id, d.type AS doc_type`,
      [affectedAppIds],
    );

    // 3. Also kick them offline immediately.
    if ((suspended.rowCount ?? 0) > 0) {
      const ids = suspended.rows.map((r) => r.user_id);
      await client.query(
        `UPDATE captain_state
            SET presence = 'offline', updated_at = now()
          WHERE captain_id = ANY($1::uuid[]) AND presence IN ('online', 'paused')`,
        [ids],
      );
      // End any active going-home session.
      await client.query(
        `UPDATE captain_going_home_sessions
            SET status = 'cancelled',
                ended_at = now(),
                end_reason = 'captain_suspended'
          WHERE captain_id = ANY($1::uuid[]) AND status = 'active'`,
        [ids],
      );
    }

    return {
      expiredDocuments: expired.rowCount ?? 0,
      suspendedCaptains: suspended.rowCount ?? 0,
    };
  });
}

/**
 * For visibility: list documents expiring in the next N days. Admin can
 * surface this in the dashboard so they can prompt captains to renew early.
 */
export async function listExpiringSoon(days = 14) {
  const r = await pool.query(
    `SELECT d.id, d.type, d.expires_at, d.application_id,
            a.full_name, a.phone
       FROM application_documents d
       JOIN captain_applications a ON a.id = d.application_id
      WHERE d.status = 'approved'
        AND d.expires_at IS NOT NULL
        AND d.expires_at BETWEEN now() AND now() + ($1 || ' days')::interval
      ORDER BY d.expires_at ASC`,
    [days.toString()],
  );
  return r.rows;
}
