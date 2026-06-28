/**
 * Authenticated user endpoints for the notification inbox.
 *
 *   GET   /notifications                 — list (paginated)
 *   POST  /notifications/:id/read        — mark one as read
 *   POST  /notifications/read-all        — mark all unread as read
 *
 * Any signed-in user can read their own inbox; the recipient_id filter in
 * the service guarantees they only ever see their own rows.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { getInboxForUser, markRead, markAllRead } from './notifications.service.js';

export const userNotificationsRouter = Router();
userNotificationsRouter.use(requireAuth);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().datetime().optional(),
});

userNotificationsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  res.json(await getInboxForUser(req.user!.id, q));
});

userNotificationsRouter.post('/:id/read', async (req, res) => {
  const ok = await markRead(req.params.id!, req.user!.id);
  if (!ok) throw new HttpError(404, 'not_found', 'Notification not found');
  res.json({ ok: true });
});

userNotificationsRouter.post('/read-all', async (req, res) => {
  const updated = await markAllRead(req.user!.id);
  res.json({ updated });
});
