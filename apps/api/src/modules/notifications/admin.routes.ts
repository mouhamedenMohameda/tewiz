/**
 * Admin endpoints to send and review notifications.
 *
 *   POST /admin/notifications        — send a new notification
 *   GET  /admin/notifications        — list past campaigns
 *
 * Mounted under the admin router so admin role is already enforced.
 */

import { Router } from 'express';
import { z } from 'zod';
import { sendNotification, listCampaigns, type NotificationTarget } from './notifications.service.js';

export const adminNotificationsRouter = Router();

const sendBody = z.object({
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('all_captains') }),
    z.object({
      type: z.literal('group'),
      group: z.enum(['active_captains', 'bonus_active']),
    }),
    z.object({ type: z.literal('user'), userId: z.string().uuid() }),
  ]),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  type: z.enum(['info', 'system', 'bonus_config', 'bonus_earned']).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

adminNotificationsRouter.post('/', async (req, res) => {
  const parsed = sendBody.parse(req.body);
  const result = await sendNotification({
    target: parsed.target as NotificationTarget,
    title: parsed.title,
    body: parsed.body,
    type: parsed.type,
    data: parsed.data,
    sentBy: req.user!.id,
  });
  res.json(result);
});

adminNotificationsRouter.get('/', async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(await listCampaigns({ limit }));
});
