import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { HttpError } from '../../middleware/error.js';
import * as topupSvc from '../wallet/topup.service.js';
import * as walletSvc from '../wallet/wallet.service.js';

// Parent (captainRouter) already enforces requireAuth + requireRole('captain').
export const captainWalletRouter = Router();

/**
 * GET /captain/wallet
 * Balance + 20 most recent transactions.
 */
captainWalletRouter.get('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await walletSvc.getWalletSummary(userId, 20));
});

/**
 * GET /captain/wallet/transactions?limit=100
 */
const txQuery = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
});
captainWalletRouter.get('/transactions', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const q = txQuery.parse(req.query);
  const s = await walletSvc.getWalletSummary(userId, q.limit);
  res.json(s.transactions);
});

/**
 * POST /captain/wallet/topups
 * Multipart: file (screenshot), provider, claimedAmountKhoums, providerRefNumber?
 */
const createTopupBody = z.object({
  provider: z.enum(['bankily', 'masrivi', 'sedad', 'cash_office']),
  claimedAmountKhoums: z.coerce.number().int().min(1).max(10_000_000),
  providerRefNumber: z.string().min(2).max(100).optional(),
});

captainWalletRouter.post('/topups', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'no_file', 'Missing "file" field');
  const userId = (req as AuthedRequest).user.id;
  const body = createTopupBody.parse(req.body);
  const t = await topupSvc.createTopup({
    captainId: userId,
    provider: body.provider,
    claimedAmountKhoums: body.claimedAmountKhoums,
    providerRefNumber: body.providerRefNumber ?? null,
    screenshot: { buffer: req.file.buffer, mimeType: req.file.mimetype },
  });
  res.json(t);
});

/**
 * GET /captain/wallet/topups
 */
captainWalletRouter.get('/topups', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await topupSvc.listMyTopups(userId));
});
