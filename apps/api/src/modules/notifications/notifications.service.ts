/**
 * Generic notifications fan-out.
 *
 * One admin "send" produces ONE campaign row + ONE notification row per
 * recipient, then fires push messages in batches. Recipients are resolved
 * from the target descriptor:
 *
 *   all_captains   → every user with role = 'captain' (excluding guests).
 *   group          → a named cohort:
 *                      'active_captains' — online or seen in the last 7 days
 *                      'bonus_active'    — currently inside an active bonus
 *   user           → one specific recipient by user id.
 *
 * Persistence + push are intentionally decoupled: the inbox is the durable
 * source of truth, push is fire-and-forget. A captain who killed the app
 * still sees the message when they open the inbox.
 */

import type { PoolClient } from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { sendPush } from '../push/expo-push.js';

export type NotificationTarget =
  | { type: 'all_captains' }
  | { type: 'all_riders' }
  | { type: 'all_guests' }
  | { type: 'all_users' }
  | { type: 'group'; group: 'active_captains' | 'bonus_active' }
  | { type: 'user'; userId: string };

export type NotificationType = 'info' | 'bonus_config' | 'bonus_earned' | 'system';

export interface SendInput {
  target: NotificationTarget;
  title: string;
  body: string;
  type?: NotificationType;
  data?: Record<string, unknown>;
  sentBy?: string | null; // admin user id, null for system-generated
}

export interface CampaignSummary {
  id: string;
  targetType: string;
  targetValue: string | null;
  type: string;
  title: string;
  body: string;
  recipientCount: number;
  readCount: number;
  sentBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** Resolve a target into the list of recipient user ids. */
async function resolveRecipients(
  client: PoolClient,
  target: NotificationTarget,
): Promise<string[]> {
  if (target.type === 'user') {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [target.userId],
    );
    return rows.map((r) => r.id);
  }
  if (target.type === 'all_captains') {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM users
        WHERE role = 'captain' AND COALESCE(is_guest, false) = false`,
    );
    return rows.map((r) => r.id);
  }
  if (target.type === 'all_riders') {
    // All passengers, guests included (a guest keeps role = 'rider').
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'rider'`,
    );
    return rows.map((r) => r.id);
  }
  if (target.type === 'all_guests') {
    // Only the anonymous guest accounts (a subset of the riders). Many may be
    // orphans from reinstalls with no live push token — inbox rows are harmless,
    // push is best-effort.
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE COALESCE(is_guest, false) = true`,
    );
    return rows.map((r) => r.id);
  }
  if (target.type === 'all_users') {
    // Everyone who can hold an inbox: riders (guests included) + captains,
    // excluding admins.
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE role IN ('rider', 'captain')`,
    );
    return rows.map((r) => r.id);
  }
  // group
  if (target.group === 'active_captains') {
    const { rows } = await client.query<{ id: string }>(
      `SELECT u.id FROM users u
         LEFT JOIN captain_state cs ON cs.captain_id = u.id
        WHERE u.role = 'captain'
          AND COALESCE(u.is_guest, false) = false
          AND (cs.presence IN ('online', 'on_ride')
               OR u.last_seen_at > now() - interval '7 days')`,
    );
    return rows.map((r) => r.id);
  }
  if (target.group === 'bonus_active') {
    const { rows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM captains
        WHERE commission_bonus_until > now()`,
    );
    return rows.map((r) => r.user_id);
  }
  return [];
}

/**
 * Send a notification. Returns the created campaign id and recipient count.
 */
export async function sendNotification(input: SendInput): Promise<{
  campaignId: string;
  recipientCount: number;
}> {
  const type = input.type ?? 'info';
  const data = input.data ?? {};
  const sentBy = input.sentBy ?? null;

  const result = await withTx(async (client) => {
    const recipients = await resolveRecipients(client, input.target);
    const targetValue =
      input.target.type === 'user'   ? input.target.userId :
      input.target.type === 'group'  ? input.target.group  :
      null;

    const campaign = await client.query<{ id: string }>(
      `INSERT INTO notification_campaigns
         (target_type, target_value, type, title, body, data, recipient_count, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING id`,
      [
        input.target.type, targetValue, type,
        input.title, input.body, JSON.stringify(data),
        recipients.length, sentBy,
      ],
    );
    const campaignId = campaign.rows[0]!.id;

    if (recipients.length > 0) {
      // Bulk-insert one row per recipient. UNNEST keeps it to a single query
      // even for thousands of captains.
      await client.query(
        `INSERT INTO notifications (campaign_id, recipient_id, type, title, body, data)
         SELECT $1, unnest($2::uuid[]), $3, $4, $5, $6::jsonb`,
        [campaignId, recipients, type, input.title, input.body, JSON.stringify(data)],
      );
    }

    return { campaignId, recipients };
  });

  // Push happens outside the tx — never block the inbox write on a push hiccup.
  if (result.recipients.length > 0) {
    const tokens = await getPushTokensForUsers(result.recipients);
    if (tokens.length > 0) {
      for (let i = 0; i < tokens.length; i += 100) {
        await sendPush({
          to: tokens.slice(i, i + 100),
          sound: 'default',
          title: input.title,
          body: input.body,
          data: {
            type: `notification:${type}`,
            campaignId: result.campaignId,
            ...data,
          },
          channelId: 'general',
          priority: 'high',
          ttl: 86_400,
        });
      }
    }
  }

  return { campaignId: result.campaignId, recipientCount: result.recipients.length };
}

async function getPushTokensForUsers(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { rows } = await pool.query<{ token: string }>(
    `SELECT token FROM push_tokens WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return rows.map((r) => r.token);
}

// ── Convenience helpers (called by other services) ──────────────────────────

/**
 * Auto-send when admin updates bonus settings: every captain learns the new
 * X / Y / Z so they can adjust their behavior. Non-blocking — caller should
 * `void` the promise.
 */
export async function notifyCaptainsBonusConfigChanged(args: {
  enabled: boolean;
  thresholdMru: number;
  windowDays: number;
  rewardDays: number;
  adminId: string;
}): Promise<void> {
  const title = args.enabled
    ? '🎁 Nouveau bonus Captain'
    : 'ℹ️ Bonus Captain désactivé';
  const body = args.enabled
    ? `Atteins ${args.thresholdMru} MRU de commission en ${args.windowDays} jours et ta commission est divisée par 2 pendant ${args.rewardDays} jours.`
    : 'Le programme de bonus est désactivé pour le moment.';
  try {
    await sendNotification({
      target: { type: 'all_captains' },
      title,
      body,
      type: 'bonus_config',
      data: {
        enabled: args.enabled,
        thresholdMru: args.thresholdMru,
        windowDays: args.windowDays,
        rewardDays: args.rewardDays,
      },
      sentBy: args.adminId,
    });
  } catch (err) {
    // Notifications must never break the settings update they accompany.
    // eslint-disable-next-line no-console
    console.warn('[notifications] bonus config broadcast failed', err);
  }
}

/**
 * Fire when a captain just earned the bonus. Single-user push + inbox row.
 */
export async function notifyCaptainBonusEarned(
  captainId: string,
  bonusUntil: Date,
): Promise<void> {
  try {
    await sendNotification({
      target: { type: 'user', userId: captainId },
      title: '🎉 Bonus débloqué !',
      body: `Ta commission est divisée par 2 jusqu'au ${bonusUntil.toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })}. Profite-en !`,
      type: 'bonus_earned',
      data: { bonusUntil: bonusUntil.toISOString() },
      sentBy: null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] bonus-earned send failed', err);
  }
}

// ── Inbox reads ─────────────────────────────────────────────────────────────

export async function getInboxForUser(
  userId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<{ items: InboxItem[]; unreadCount: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const before = opts.before ?? null;
  const { rows } = await pool.query<{
    id: string; type: string; title: string; body: string;
    data: Record<string, unknown>; read_at: Date | null; created_at: Date;
  }>(
    `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications n
      WHERE recipient_id = $1
        AND n.created_at >= COALESCE((SELECT u.created_at FROM users u WHERE u.id = $1), '-infinity'::timestamptz)
        AND ($2::timestamptz IS NULL OR created_at < $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [userId, before, limit],
  );
  const { rows: cntRows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM notifications n
      WHERE n.recipient_id = $1
        AND n.read_at IS NULL
        AND n.created_at >= COALESCE((SELECT u.created_at FROM users u WHERE u.id = $1), '-infinity'::timestamptz)`,
    [userId],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      data: r.data,
      readAt: r.read_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    })),
    unreadCount: Number(cntRows[0]?.c ?? 0),
  };
}

export async function markRead(notificationId: string, userId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE notifications
        SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND recipient_id = $2`,
    [notificationId, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const r = await pool.query(
    `UPDATE notifications
        SET read_at = now()
      WHERE recipient_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return r.rowCount ?? 0;
}

// ── Admin edit / delete ─────────────────────────────────────────────────────

export interface UpdateCampaignInput {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

/**
 * Edit an already-sent campaign in place. Rewrites the campaign row AND every
 * per-recipient `notifications` row so the correction shows up in each inbox on
 * the next poll/refresh. Read state is preserved and NO new push is fired —
 * this is a silent remote update, not a re-send.
 *
 * Returns false when the campaign id doesn't exist.
 */
export async function updateCampaign(
  campaignId: string,
  input: UpdateCampaignInput,
): Promise<boolean> {
  // Nothing to change → treat as a successful no-op if the campaign exists.
  const hasChanges =
    input.title !== undefined || input.body !== undefined || input.data !== undefined;

  return withTx(async (client) => {
    const existing = await client.query<{
      title: string; body: string; data: Record<string, unknown>;
    }>(
      `SELECT title, body, data FROM notification_campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );
    if (existing.rowCount === 0) return false;
    if (!hasChanges) return true;

    const current = existing.rows[0]!;
    const title = input.title ?? current.title;
    const body = input.body ?? current.body;
    const data = input.data ?? current.data;

    await client.query(
      `UPDATE notification_campaigns
          SET title = $2, body = $3, data = $4::jsonb, updated_at = now()
        WHERE id = $1`,
      [campaignId, title, body, JSON.stringify(data)],
    );
    // Rewrite the fan-out rows in place; read_at is untouched.
    await client.query(
      `UPDATE notifications
          SET title = $2, body = $3, data = $4::jsonb
        WHERE campaign_id = $1`,
      [campaignId, title, body, JSON.stringify(data)],
    );
    return true;
  });
}

/**
 * Delete a campaign and, via ON DELETE CASCADE on notifications.campaign_id,
 * every inbox row it produced. The message disappears from all inboxes on the
 * next poll/refresh. Already-delivered OS push banners can't be recalled.
 *
 * Returns false when the campaign id doesn't exist.
 */
export async function deleteCampaign(campaignId: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM notification_campaigns WHERE id = $1`,
    [campaignId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ── Admin reads ─────────────────────────────────────────────────────────────

export async function listCampaigns(opts: { limit?: number } = {}): Promise<CampaignSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { rows } = await pool.query<{
    id: string; target_type: string; target_value: string | null;
    type: string; title: string; body: string;
    recipient_count: number; sent_by: string | null; created_at: Date;
    updated_at: Date | null; read_count: string;
  }>(
    `SELECT c.id, c.target_type, c.target_value, c.type, c.title, c.body,
            c.recipient_count, c.sent_by, c.created_at, c.updated_at,
            COALESCE((SELECT COUNT(*) FROM notifications n
                       WHERE n.campaign_id = c.id AND n.read_at IS NOT NULL), 0)::text AS read_count
       FROM notification_campaigns c
      ORDER BY c.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetValue: r.target_value,
    type: r.type,
    title: r.title,
    body: r.body,
    recipientCount: r.recipient_count,
    readCount: Number(r.read_count),
    sentBy: r.sent_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at?.toISOString() ?? null,
  }));
}
