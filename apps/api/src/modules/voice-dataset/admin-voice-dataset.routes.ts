import { Router, type Response } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { audit } from '../admin/audit.js';
import { getCoverage } from './scenario.js';
import { tarAppend, tarFinalize } from './tar.js';
import * as dataset from './voice-dataset.service.js';

// Parent (adminRouter) enforces requireAuth + requireRole('admin'); the
// sub-role gate is applied where this router is mounted.
export const adminVoiceDatasetRouter = Router();

// ─── Coverage & samples ──────────────────────────────────────────────────────

/** GET /admin/voice-dataset/coverage — per-axis counts for the dashboard. */
adminVoiceDatasetRouter.get('/coverage', async (_req, res) => {
  res.json(await getCoverage());
});

const listQuery = z.object({
  status: z.enum(['collected', 'validated', 'rejected']).optional(),
  split: z.enum(['dev', 'test', 'none']).optional(),
  collectorUserId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminVoiceDatasetRouter.get('/samples', async (req, res) => {
  res.json(await dataset.listSamplesForAdmin(listQuery.parse(req.query)));
});

/** GET /admin/voice-dataset/samples/:id/audio — reviewer playback. */
adminVoiceDatasetRouter.get('/samples/:id/audio', async (req, res) => {
  const { buffer, mime } = await dataset.getSampleAudio(req.params.id!);
  res.setHeader('Content-Type', mime || 'audio/m4a');
  res.send(buffer);
});

/**
 * POST /admin/voice-dataset/samples/:id/review
 *
 * Nothing enters an evaluation split until a reviewer has listened to the
 * audio and confirmed the labels match it. A wrong gold label is worse than a
 * missing sample: it caps the measured accuracy of every architecture tested
 * against the corpus, and it does so invisibly.
 */
const reviewBody = z.object({
  status: z.enum(['validated', 'rejected']),
  note: z.string().trim().max(500).nullable().optional(),
});

adminVoiceDatasetRouter.post('/samples/:id/review', async (req, res) => {
  const body = reviewBody.parse(req.body);
  const sample = await dataset.reviewSample({
    id: req.params.id!,
    reviewerId: req.user!.id,
    status: body.status,
    note: body.note ?? null,
  });
  await audit({
    adminId: req.user!.id,
    action: `voice_dataset.${body.status}`,
    targetType: 'voice_dataset_sample',
    targetId: sample.id,
    after: { status: sample.status },
    reason: body.note ?? null,
  });
  res.json(sample);
});

/**
 * POST /admin/voice-dataset/split
 *
 * Assigns validated samples to dev / test, grouped by collector so no voice
 * appears on both sides. Idempotent in the sense that it only ever touches
 * rows whose split is still NULL — a sample's split, once given, is permanent,
 * because a test sample that later drifts into dev has been looked at and is
 * no longer a holdout.
 */
const splitBody = z.object({
  testRatio: z.number().min(0.1).max(0.9).optional(),
});

adminVoiceDatasetRouter.post('/split', async (req, res) => {
  const { testRatio } = splitBody.parse(req.body ?? {});
  const result = await dataset.assignSplits(testRatio);
  await audit({
    adminId: req.user!.id,
    action: 'voice_dataset.split',
    targetType: 'voice_dataset',
    targetId: null,
    after: result,
  });
  res.json(result);
});

// ─── Export ──────────────────────────────────────────────────────────────────

const exportQuery = z.object({ split: z.enum(['dev', 'test']).optional() });

/**
 * Wait until the socket has drained, so a slow client cannot make us buffer the
 * whole corpus in memory.
 *
 * `res.write` returning false means Node is now holding the bytes for us.
 * Without this the export loop writes every clip as fast as the disk serves
 * them, and a reviewer on a weak connection turns a 300 MB archive into 300 MB
 * of resident memory on the API box.
 *
 * Also settles on 'close': if the client aborts mid-download the 'drain' event
 * never fires, and awaiting it alone would leave the handler suspended for the
 * life of the process.
 */
function drained(res: Response): Promise<void> {
  if (!res.writableNeedDrain || res.writableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}

/**
 * GET /admin/voice-dataset/export.jsonl?split=dev|test
 * Manifest only — one JSON object per line, validated samples.
 */
adminVoiceDatasetRouter.get('/export.jsonl', async (req, res) => {
  const { split } = exportQuery.parse(req.query);
  const rows = await dataset.exportRows(split);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="voice-dataset-${split ?? 'all'}.jsonl"`,
  );
  res.send(rows.map((r) => JSON.stringify(r)).join('\n'));
});

/**
 * GET /admin/voice-dataset/export.tar?split=dev|test
 *
 * The manifest and every audio file it references, in one archive:
 *   manifest.jsonl
 *   audio/<sample-id>.m4a
 *
 * Audio is fetched and written one file at a time so peak memory stays at one
 * clip rather than the whole corpus. A missing object is skipped rather than
 * fatal — losing one clip should not cost the reviewer the other 299 — and the
 * skipped ids come back in a trailing `missing.txt` so the gap is visible
 * instead of silent.
 */
adminVoiceDatasetRouter.get('/export.tar', async (req, res) => {
  const { split } = exportQuery.parse(req.query);
  const rows = await dataset.exportRows(split);
  const keys = await dataset.exportAudioKeys(split);

  res.setHeader('Content-Type', 'application/x-tar');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="voice-dataset-${split ?? 'all'}.tar"`,
  );

  tarAppend(res, 'manifest.jsonl', Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n'), 'utf8'));

  const missing: string[] = [];
  for (const { id } of keys) {
    // A client that closed the connection is no longer reading; keep writing
    // and we just burn disk reads into a dead socket.
    if (res.writableEnded || res.destroyed) return;
    try {
      const { buffer } = await dataset.getSampleAudio(id);
      tarAppend(res, `audio/${id}.m4a`, buffer);
      await drained(res);
    } catch {
      missing.push(id);
    }
  }
  if (missing.length > 0) {
    tarAppend(res, 'missing.txt', Buffer.from(`${missing.join('\n')}\n`, 'utf8'));
  }

  tarFinalize(res);
  res.end();
});

// ─── Tester roster ───────────────────────────────────────────────────────────

/** GET /admin/voice-dataset/testers — accounts that can collect, with counts. */
adminVoiceDatasetRouter.get('/testers', async (_req, res) => {
  const { rows } = await pool.query<{
    id: string; phone: string | null; full_name: string | null;
    samples: string; validated: string;
  }>(
    `SELECT u.id, u.phone, u.full_name,
            COUNT(s.id)::text AS samples,
            COUNT(s.id) FILTER (WHERE s.status = 'validated')::text AS validated
       FROM users u
       LEFT JOIN voice_dataset_samples s ON s.collector_user_id = u.id
      WHERE u.is_tester
      GROUP BY u.id, u.phone, u.full_name
      ORDER BY COUNT(s.id) DESC`,
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      fullName: r.full_name,
      samples: Number(r.samples),
      validated: Number(r.validated),
    })),
  );
});

/** POST /admin/voice-dataset/testers/:userId — grant or revoke the flag. */
const testerBody = z.object({ isTester: z.boolean() });

adminVoiceDatasetRouter.post('/testers/:userId', async (req, res) => {
  const { isTester } = testerBody.parse(req.body);
  const userId = req.params.userId!;

  const { rows } = await pool.query<{ id: string; is_tester: boolean }>(
    `UPDATE users SET is_tester = $1 WHERE id = $2 RETURNING id, is_tester`,
    [isTester, userId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'User not found');

  await audit({
    adminId: req.user!.id,
    action: isTester ? 'voice_dataset.tester_granted' : 'voice_dataset.tester_revoked',
    targetType: 'user',
    targetId: userId,
    after: { isTester: row.is_tester },
  });

  res.json({ id: row.id, isTester: row.is_tester });
});
