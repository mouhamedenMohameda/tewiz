import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import * as topupSvc from '../wallet/topup.service.js';
import { audit } from './audit.js';

// Parent (adminRouter) already enforces requireAuth + requireRole('admin').
export const adminTopupRouter = Router();

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'partial', 'rejected', 'duplicate']).default('pending'),
  limit: z.coerce.number().min(1).max(200).default(50),
});

adminTopupRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  res.json(await topupSvc.listTopupsForAdmin(q));
});

adminTopupRouter.get('/:id', async (req, res) => {
  res.json(await topupSvc.getTopupForAdmin(req.params.id!));
});

adminTopupRouter.get('/:id/screenshot', async (req, res) => {
  const key = await topupSvc.getTopupScreenshotKey(req.params.id!);
  const buf = await defaultStorage.get(key);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(buf);
});

const approveBody = z.object({
  approvedAmountKhoums: z.coerce.number().int().min(1).optional(),
  providerRefNumber: z.string().min(2).max(100).optional(),
});

adminTopupRouter.post('/:id/approve', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = approveBody.parse(req.body ?? {});
  const result = await topupSvc.approveTopup({
    adminId,
    topupId: req.params.id!,
    approvedAmountKhoums: body.approvedAmountKhoums,
    providerRefNumber: body.providerRefNumber,
  });
  await audit({
    adminId,
    action: result.topup.status === 'partial' ? 'partial_approve_topup' : 'approve_topup',
    targetType: 'topup_request',
    targetId: req.params.id!,
    after: result.topup,
    reason: body.providerRefNumber ? `ref=${body.providerRefNumber}` : null,
  });
  res.json(result);
});

const rejectBody = z.object({
  reason: z.string().min(2).max(500),
});

adminTopupRouter.post('/:id/reject', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = rejectBody.parse(req.body);
  const topup = await topupSvc.rejectTopup({
    adminId,
    topupId: req.params.id!,
    reason: body.reason,
  });
  await audit({
    adminId,
    action: 'reject_topup',
    targetType: 'topup_request',
    targetId: req.params.id!,
    after: topup,
    reason: body.reason,
  });
  res.json(topup);
});
